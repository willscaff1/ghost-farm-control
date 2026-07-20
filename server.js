const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('./database/db');
const authRoutes = require('./routes/auth');
const deliveryRoutes = require('./routes/delivery');
const adminRoutes = require('./routes/admin');
const { getUserCommandmentStatus } = require('./services/familyCommandments');

const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production' || process.env.DATABASE_URL;
let sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret) {
    sessionSecret = crypto.randomBytes(32).toString('hex');
    if (isProduction) {
        console.warn('⚠️ SESSION_SECRET não definido em produção. Gerado automaticamente. Recomenda-se definir a variável de ambiente SESSION_SECRET.');
    } else {
        console.warn('⚠️ SESSION_SECRET não definido. Usando segredo local de desenvolvimento.');
    }
}

// Trust proxy para Railway
if (isProduction) {
    app.set('trust proxy', 1);
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Session
app.use(session({
    secret: sessionSecret || 'ghosts-farm-dev-secret-key-local-only',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: isProduction, // HTTPS em produção
        httpOnly: true,
        // LAX reduz bastante risco de CSRF sem quebrar navegação direta
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000 // 24 horas
    }
}));

// Auth middleware
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

// Rastreio de "online": atualiza last_seen_at do usuário logado, no máximo 1x/min
const lastSeenWrites = new Map(); // userId -> timestamp do último write
app.use((req, res, next) => {
    const u = req.session && req.session.user;
    if (u && u.id) {
        const now = Date.now();
        const last = lastSeenWrites.get(u.id) || 0;
        if (now - last > 60 * 1000) {
            lastSeenWrites.set(u.id, now);
            const { runQuery } = require('./database/db');
            runQuery('UPDATE users SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?', [u.id])
                .catch(() => {});
        }
    }
    next();
});

// Routes
app.use('/api/auth', authRoutes);

const requireCommandmentsAcceptance = async (req, res, next) => {
    if (!req.session?.user) return next();

    try {
        const status = await getUserCommandmentStatus(req.session.user.id);
        if (status.requiresAcceptance) {
            return res.status(428).json({
                error: 'Aceite os mandamentos da familia para continuar',
                commandments_required: true,
                redirect: '/family-commandments'
            });
        }
        next();
    } catch (error) {
        res.status(500).json({ error: 'Erro ao verificar aceite dos mandamentos' });
    }
};

app.use('/api/delivery', requireCommandmentsAcceptance, deliveryRoutes);
app.use('/api/admin', requireCommandmentsAcceptance, adminRoutes);

// Health check — usado pelo smoke test e monitoramento
app.get('/health', async (req, res) => {
    const start = Date.now();
    try {
        const { getOne } = require('./database/db');
        await getOne('SELECT 1 AS ok');
        res.json({ status: 'ok', db: 'ok', uptime: process.uptime(), latency_ms: Date.now() - start });
    } catch (err) {
        res.status(503).json({ status: 'error', db: 'down', error: err.message, latency_ms: Date.now() - start });
    }
});

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/family-commandments', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'family-commandments.html'));
});

// Initialize database and start server
db.initialize().then(async () => {
    // Função para criar tabela de farm extra se não existir
    async function createExtraFarmTable() {
        try {
            const { runQuery, getAll } = require('./database/db');
            const isPostgres = process.env.DATABASE_URL ? true : false;
            
            // Verificar se tabela já existe
            try {
                await getAll('SELECT id FROM extra_farm_requests LIMIT 1');
                console.log('✅ Tabela extra_farm_requests já existe');
                return;
            } catch (e) {
                console.log('🏆 Criando tabela extra_farm_requests...');
            }
            
            if (isPostgres) {
                await runQuery(`
                    CREATE TABLE IF NOT EXISTS extra_farm_requests (
                        id SERIAL PRIMARY KEY,
                        delivery_id INTEGER NOT NULL,
                        user_id INTEGER NOT NULL,
                        materials TEXT NOT NULL,
                        status TEXT DEFAULT 'pending',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        reviewed_at TIMESTAMP,
                        reviewed_by INTEGER,
                        FOREIGN KEY (delivery_id) REFERENCES deliveries(id),
                        FOREIGN KEY (user_id) REFERENCES users(id)
                    )
                `);
                
                await runQuery(`
                    CREATE TABLE IF NOT EXISTS extra_farm_screenshots (
                        id SERIAL PRIMARY KEY,
                        extra_farm_id INTEGER NOT NULL,
                        screenshot_url TEXT NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (extra_farm_id) REFERENCES extra_farm_requests(id)
                    )
                `);
            } else {
                await runQuery(`
                    CREATE TABLE IF NOT EXISTS extra_farm_requests (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        delivery_id INTEGER NOT NULL,
                        user_id INTEGER NOT NULL,
                        materials TEXT NOT NULL,
                        status TEXT DEFAULT 'pending',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        reviewed_at TIMESTAMP,
                        reviewed_by INTEGER,
                        FOREIGN KEY (delivery_id) REFERENCES deliveries(id),
                        FOREIGN KEY (user_id) REFERENCES users(id)
                    )
                `);
                
                await runQuery(`
                    CREATE TABLE IF NOT EXISTS extra_farm_screenshots (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        extra_farm_id INTEGER NOT NULL,
                        screenshot_url TEXT NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (extra_farm_id) REFERENCES extra_farm_requests(id)
                    )
                `);
            }
            
            console.log('✅ Tabelas extra_farm_requests e extra_farm_screenshots criadas!');
        } catch (error) {
            console.error('⚠️ Erro ao criar tabela extra_farm:', error.message);
        }
    }
    
    // Função para criar tabela de competições se não existir
    async function createCompetitionsTable() {
        try {
            const { runQuery, getAll } = require('./database/db');
            const isPostgres = process.env.DATABASE_URL ? true : false;
            
            // Verificar se tabela já existe
            try {
                await getAll('SELECT id FROM competitions LIMIT 1');
                console.log('✅ Tabela competitions já existe');
                return;
            } catch (e) {
                console.log('🏆 Criando tabela competitions...');
            }
            
            if (isPostgres) {
                // PostgreSQL syntax
                await runQuery(`
                    CREATE TABLE IF NOT EXISTS competitions (
                        id SERIAL PRIMARY KEY,
                        name TEXT NOT NULL,
                        description TEXT,
                        start_date DATE NOT NULL,
                        end_date DATE NOT NULL,
                        prizes TEXT,
                        active INTEGER DEFAULT 0,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                `);
                
                await runQuery(`
                    CREATE TABLE IF NOT EXISTS competition_entries (
                        id SERIAL PRIMARY KEY,
                        competition_id INTEGER NOT NULL,
                        user_id INTEGER NOT NULL,
                        delivery_id INTEGER NOT NULL,
                        material_count INTEGER NOT NULL,
                        approved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (competition_id) REFERENCES competitions(id),
                        FOREIGN KEY (user_id) REFERENCES users(id),
                        FOREIGN KEY (delivery_id) REFERENCES deliveries(id)
                    )
                `);
            } else {
                // SQLite syntax
                await runQuery(`
                    CREATE TABLE IF NOT EXISTS competitions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL,
                        description TEXT,
                        start_date DATE NOT NULL,
                        end_date DATE NOT NULL,
                        prizes TEXT,
                        active INTEGER DEFAULT 0,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                `);
                
                await runQuery(`
                    CREATE TABLE IF NOT EXISTS competition_entries (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        competition_id INTEGER NOT NULL,
                        user_id INTEGER NOT NULL,
                        delivery_id INTEGER NOT NULL,
                        material_count INTEGER NOT NULL,
                        approved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (competition_id) REFERENCES competitions(id),
                        FOREIGN KEY (user_id) REFERENCES users(id),
                        FOREIGN KEY (delivery_id) REFERENCES deliveries(id)
                    )
                `);
            }
            
            console.log('✅ Tabelas competitions e competition_entries criadas!');
        } catch (error) {
            console.error('⚠️ Erro ao criar tabela competitions:', error.message);
        }
    }

    async function createWeaponSalesTable() {
        try {
            const { runQuery, getAll } = require('./database/db');
            const isPostgres = process.env.DATABASE_URL ? true : false;

            try {
                await getAll('SELECT id FROM weapon_sales LIMIT 1');
                console.log('✅ Tabela weapon_sales já existe');
                return;
            } catch (e) {
                console.log('🔫 Criando tabela weapon_sales...');
            }

            if (isPostgres) {
                await runQuery(`
                    CREATE TABLE IF NOT EXISTS weapon_sales (
                        id SERIAL PRIMARY KEY,
                        weapon_name TEXT NOT NULL,
                        quantity INTEGER NOT NULL DEFAULT 1,
                        sale_value NUMERIC(12,2) NOT NULL DEFAULT 0,
                        buyer_name TEXT,
                        seller_name TEXT,
                        proof_url TEXT,
                        notes TEXT,
                        sale_date DATE NOT NULL,
                        created_by INTEGER REFERENCES users(id),
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                `);
            } else {
                await runQuery(`
                    CREATE TABLE IF NOT EXISTS weapon_sales (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        weapon_name TEXT NOT NULL,
                        quantity INTEGER NOT NULL DEFAULT 1,
                        sale_value REAL NOT NULL DEFAULT 0,
                        buyer_name TEXT,
                        seller_name TEXT,
                        proof_url TEXT,
                        notes TEXT,
                        sale_date DATE NOT NULL,
                        created_by INTEGER,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (created_by) REFERENCES users(id)
                    )
                `);
            }

            await runQuery('CREATE INDEX IF NOT EXISTS idx_weapon_sales_date ON weapon_sales (sale_date)');
            await runQuery('CREATE INDEX IF NOT EXISTS idx_weapon_sales_created_by ON weapon_sales (created_by)');
            console.log('✅ Tabela weapon_sales criada/verificada');
        } catch (error) {
            console.error('⚠️ Erro ao criar tabela weapon_sales:', error.message);
        }
    }
    
    // Função para atualizar permissões do ranking
    async function updateRankingPermissions() {
        try {
            const { runQuery, getAll } = require('./database/db');
            
            // Grupos que DEVEM ter acesso ao weekly-ranking
            const groupsWithAccess = ['super_admin', 'gerente_geral', '01', '02'];
            
            const roles = await getAll('SELECT * FROM role_permissions');
            let updated = 0;
            
            for (const role of roles) {
                const permissions = JSON.parse(role.permissions || '[]');
                const hasWeeklyRanking = permissions.includes('weekly-ranking');
                const shouldHaveAccess = groupsWithAccess.includes(role.role_name);
                
                if (shouldHaveAccess && !hasWeeklyRanking) {
                    permissions.push('weekly-ranking');
                    await runQuery(
                        'UPDATE role_permissions SET permissions = ? WHERE role_name = ?',
                        [JSON.stringify(permissions), role.role_name]
                    );
                    updated++;
                } else if (!shouldHaveAccess && hasWeeklyRanking) {
                    const newPermissions = permissions.filter(p => p !== 'weekly-ranking');
                    await runQuery(
                        'UPDATE role_permissions SET permissions = ? WHERE role_name = ?',
                        [JSON.stringify(newPermissions), role.role_name]
                    );
                    updated++;
                }
            }
            
            if (updated > 0) {
                console.log(`🏆 Permissões do ranking semanal atualizadas (${updated} grupos)`);
            }
        } catch (error) {
            console.error('⚠️ Erro ao atualizar permissões do ranking:', error.message);
        }
    }

    async function updateWeaponSalesPermissions() {
        try {
            const { runQuery, getAll } = require('./database/db');
            const groupsWithAccess = ['super_admin', 'gerente_geral', '01', '02', 'gerente_vendas', 'gerente_de_vendas'];
            const roles = await getAll('SELECT * FROM role_permissions');
            let updated = 0;

            for (const role of roles) {
                const permissions = JSON.parse(role.permissions || '[]');
                const hasSalesAccess = groupsWithAccess.includes(role.role_name) ||
                    permissions.includes('weapon-sales') ||
                    permissions.includes('weapon-freebies') ||
                    permissions.includes('all');
                if (!hasSalesAccess) continue;

                let changed = false;
                if (!permissions.includes('weapon-sales') && !permissions.includes('all')) {
                    permissions.push('weapon-sales');
                    changed = true;
                }
                if (!permissions.includes('weapon-freebies') && !permissions.includes('all')) {
                    permissions.push('weapon-freebies');
                    changed = true;
                }
                if (!permissions.includes('weapon-catalog') && !permissions.includes('all')) {
                    permissions.push('weapon-catalog');
                    changed = true;
                }

                if (changed) {
                    await runQuery(
                        'UPDATE role_permissions SET permissions = ? WHERE role_name = ?',
                        [JSON.stringify(permissions), role.role_name]
                    );
                    updated++;
                }
            }

            if (updated > 0) {
                console.log(`🔫 Permissão de extrato de vendas atualizada (${updated} grupos)`);
            }
        } catch (error) {
            console.error('⚠️ Erro ao atualizar permissões de vendas:', error.message);
        }
    }
    
    async function updateFamilyCommandmentsPermissions() {
        try {
            const { runQuery, getAll } = require('./database/db');
            const groupsWithAccess = ['super_admin', 'gerente_geral', '01', '02'];
            const roles = await getAll('SELECT * FROM role_permissions');
            let updated = 0;

            for (const role of roles) {
                const permissions = JSON.parse(role.permissions || '[]');
                const shouldHaveAccess = groupsWithAccess.includes(role.role_name) ||
                    permissions.includes('all') ||
                    role.can_config === 1 ||
                    role.can_config === true;

                if (shouldHaveAccess && !permissions.includes('family-commandments') && !permissions.includes('all')) {
                    permissions.push('family-commandments');
                    await runQuery(
                        'UPDATE role_permissions SET permissions = ? WHERE role_name = ?',
                        [JSON.stringify(permissions), role.role_name]
                    );
                    updated++;
                }
            }

            if (updated > 0) {
                console.log(`Mandamentos: permissao atualizada (${updated} grupos)`);
            }
        } catch (error) {
            console.error('Erro ao atualizar permissoes de mandamentos:', error.message);
        }
    }

    // Garante que TODOS os gerentes possam editar o status da entrega (aba Status da Semana)
    // e acessar o novo sistema de Ponto. Idempotente e roda a cada boot.
    async function updateManagerFarmPermissions() {
        try {
            const { runQuery, getAll } = require('./database/db');
            const baseGroups = ['super_admin', 'gerente_geral', '01', '02'];
            const permsToGrant = ['weekly-status', 'attendance'];
            const roles = await getAll('SELECT * FROM role_permissions');
            let updated = 0;

            for (const role of roles) {
                const permissions = JSON.parse(role.permissions || '[]');
                if (permissions.includes('all')) continue;

                const roleName = String(role.role_name || '').toLowerCase();
                // Qualquer grupo de gerência/liderança (alinhado com o requireAdmin do backend)
                const isManager = baseGroups.includes(roleName) ||
                    roleName.includes('gerente') ||
                    roleName.includes('lider') ||
                    roleName.includes('admin') ||
                    roleName === '01' || roleName === '02' ||
                    role.can_config === 1 ||
                    role.can_config === true;
                if (!isManager) continue;

                let changed = false;
                for (const perm of permsToGrant) {
                    if (!permissions.includes(perm)) {
                        permissions.push(perm);
                        changed = true;
                    }
                }

                if (changed) {
                    await runQuery(
                        'UPDATE role_permissions SET permissions = ? WHERE role_name = ?',
                        [JSON.stringify(permissions), roleName]
                    );
                    updated++;
                }
            }

            if (updated > 0) {
                console.log(`Gerentes: permissao de editar status e ponto atualizada (${updated} grupos)`);
            }
        } catch (error) {
            console.error('Erro ao atualizar permissoes de gerentes (status/ponto):', error.message);
        }
    }

    // Função para migrar farms in_progress para pending (novo fluxo de aprovação)
    async function migrateInProgressToPending() {
        try {
            const { runQuery, getAll } = require('./database/db');
            
            const inProgressFarms = await getAll(`SELECT id FROM deliveries WHERE status = 'in_progress'`);
            
            if (inProgressFarms.length > 0) {
                await runQuery(`UPDATE deliveries SET status = 'pending' WHERE status = 'in_progress'`);
                console.log(`📦 ${inProgressFarms.length} farms migrados de in_progress para pending (novo fluxo)`);
            }
        } catch (error) {
            console.error('⚠️ Erro ao migrar farms:', error.message);
        }
    }

    // Limpeza one-shot para novo ciclo de metas iniciado em 18/05/2026.
    async function cleanupGoalHistoryBefore2026_05_18() {
        const markerKey = 'cleanup_goal_history_before_2026_05_18_done';
        const cutoffDate = '2026-05-18';

        try {
            const { runQuery, getOne } = require('./database/db');
            const alreadyDone = await getOne('SELECT setting_value FROM farm_settings WHERE setting_key = ?', [markerKey]);
            if (alreadyDone?.setting_value === 'true') {
                console.log('✅ Limpeza de histórico anterior a 18/05/2026 já executada');
                return;
            }

            console.log('🧹 Limpando histórico de metas/entregas anterior a 18/05/2026...');

            try {
                await runQuery(`
                    DELETE FROM extra_farm_screenshots
                    WHERE extra_farm_id IN (
                        SELECT ef.id
                        FROM extra_farm_requests ef
                        JOIN deliveries d ON ef.delivery_id = d.id
                        WHERE d.week_start < ?
                    )
                `, [cutoffDate]);
            } catch (e) {
                console.log('ℹ️ extra_farm_screenshots:', e.message);
            }

            try {
                await runQuery(`
                    DELETE FROM extra_farm_requests
                    WHERE delivery_id IN (
                        SELECT id FROM deliveries WHERE week_start < ?
                    )
                `, [cutoffDate]);
            } catch (e) {
                console.log('ℹ️ extra_farm_requests:', e.message);
            }

            try {
                await runQuery(`
                    DELETE FROM competition_entries
                    WHERE delivery_id IN (
                        SELECT id FROM deliveries WHERE week_start < ?
                    )
                `, [cutoffDate]);
            } catch (e) {
                console.log('ℹ️ competition_entries:', e.message);
            }

            await runQuery(`
                DELETE FROM delivery_screenshots
                WHERE delivery_id IN (
                    SELECT id FROM deliveries WHERE week_start < ?
                )
            `, [cutoffDate]);

            await runQuery(`
                DELETE FROM delivery_items
                WHERE delivery_id IN (
                    SELECT id FROM deliveries WHERE week_start < ?
                )
            `, [cutoffDate]);

            await runQuery('DELETE FROM deliveries WHERE week_start < ?', [cutoffDate]);
            await runQuery('DELETE FROM justifications WHERE week_start < ?', [cutoffDate]);
            await runQuery('DELETE FROM warnings WHERE week_start IS NOT NULL AND week_start < ?', [cutoffDate]);

            try {
                await runQuery('DELETE FROM member_observations WHERE week_start < ?', [cutoffDate]);
            } catch (e) {
                console.log('ℹ️ member_observations:', e.message);
            }

            await runQuery(
                'INSERT INTO farm_settings (setting_key, setting_value) VALUES (?, ?)',
                [markerKey, 'true']
            );

            console.log('✅ Histórico anterior a 18/05/2026 limpo com sucesso');
        } catch (error) {
            console.error('⚠️ Erro na limpeza de histórico anterior a 18/05/2026:', error.message);
        }
    }
    
    async function deactivateLegacyDefaultMaterials() {
        const markerKey = 'deactivate_legacy_default_materials_done';
        const defaultMaterialNames = [
            'Folha',
            'Ópio',
            'Embalagem Plástica',
            'Farinha de Trigo',
            'Clip',
            'Cabo',
            'Slide',
            'Ferrolho',
            'Culatra',
            'Titanio'
        ];

        try {
            const { runQuery, getOne } = require('./database/db');
            const alreadyDone = await getOne('SELECT setting_value FROM farm_settings WHERE setting_key = ?', [markerKey]);
            if (alreadyDone?.setting_value === 'true') {
                console.log('✅ Materiais padrão antigos já foram desativados');
                return;
            }

            const placeholders = defaultMaterialNames.map(() => '?').join(',');
            const result = await runQuery(
                `UPDATE materials SET active = 0 WHERE name IN (${placeholders})`,
                defaultMaterialNames
            );

            await runQuery(
                'INSERT INTO farm_settings (setting_key, setting_value) VALUES (?, ?)',
                [markerKey, 'true']
            );

            console.log(`✅ Materiais padrão antigos desativados: ${result?.changes || 0}`);
        } catch (error) {
            console.error('⚠️ Erro ao desativar materiais padrão antigos:', error.message);
        }
    }

    // Operação one-shot: aprovar semana 08-14/06 e zerar semana 15-21/06
    async function bulkWeekOps_2026_06() {
        const markerKey = 'bulk_week_ops_2026_06_08_15_done';
        const APPROVE = { start: '2026-06-08', end: '2026-06-14' };
        const CLEAR = { start: '2026-06-15', end: '2026-06-21' };

        try {
            const { runQuery, getOne, getAll } = require('./database/db');
            const alreadyDone = await getOne('SELECT setting_value FROM farm_settings WHERE setting_key = ?', [markerKey]);
            if (alreadyDone?.setting_value === 'true') {
                console.log('✅ Operação em lote 08-14/06 + 15-21/06 já executada');
                return;
            }

            // ===== Semana A: aprovar todas as entregas =====
            const resApprove = await runQuery(
                `UPDATE deliveries SET status = 'approved', is_partial = 0, approved_at = CURRENT_TIMESTAMP
                 WHERE week_start = ? AND week_end = ?`,
                [APPROVE.start, APPROVE.end]
            );
            console.log(`📦 [08-14/06] Entregas aprovadas: ${resApprove?.changes ?? 'ok'}`);

            // ===== Semana B: marcar não entregue + zerar quantidades e prints =====
            const clearTargets = await getAll(
                'SELECT id FROM deliveries WHERE week_start = ? AND week_end = ?',
                [CLEAR.start, CLEAR.end]
            );
            const clearIds = (clearTargets || []).map(d => d.id);

            if (clearIds.length > 0) {
                const ph = clearIds.map(() => '?').join(',');

                try {
                    await runQuery(
                        `DELETE FROM extra_farm_screenshots WHERE extra_farm_id IN (
                            SELECT id FROM extra_farm_requests WHERE delivery_id IN (${ph})
                        )`, clearIds
                    );
                } catch (e) { console.log('ℹ️ extra_farm_screenshots:', e.message); }

                try {
                    await runQuery(`DELETE FROM extra_farm_requests WHERE delivery_id IN (${ph})`, clearIds);
                } catch (e) { console.log('ℹ️ extra_farm_requests:', e.message); }

                try {
                    await runQuery(`DELETE FROM delivery_screenshots WHERE delivery_id IN (${ph})`, clearIds);
                } catch (e) { console.log('ℹ️ delivery_screenshots:', e.message); }

                await runQuery(`DELETE FROM delivery_items WHERE delivery_id IN (${ph})`, clearIds);

                await runQuery(
                    `UPDATE deliveries SET status = 'not_delivered', is_partial = 0, screenshot_url = NULL, dirty_money_amount = 0
                     WHERE id IN (${ph})`,
                    clearIds
                );
                console.log(`🧹 [15-21/06] Entregas zeradas e marcadas como não entregue: ${clearIds.length}`);
            } else {
                console.log('ℹ️ [15-21/06] Nenhuma entrega encontrada para zerar');
            }

            await runQuery(
                'INSERT INTO farm_settings (setting_key, setting_value) VALUES (?, ?)',
                [markerKey, 'true']
            );

            console.log('✅ Operação em lote 08-14/06 + 15-21/06 concluída');
        } catch (error) {
            console.error('⚠️ Erro na operação em lote de semanas:', error.message);
        }
    }

    // One-shot: garante que TODOS os membros ativos fiquem aprovados na semana 08-14/06
    async function bulkApproveAllMembersWeek_08_14() {
        const markerKey = 'bulk_approve_all_week_08_14_done';
        const W = { start: '2026-06-08', end: '2026-06-14' };

        try {
            const { runQuery, getOne, getAll } = require('./database/db');
            const alreadyDone = await getOne('SELECT setting_value FROM farm_settings WHERE setting_key = ?', [markerKey]);
            if (alreadyDone?.setting_value === 'true') {
                console.log('✅ Aprovação total da semana 08-14/06 já executada');
                return;
            }

            // 1) Aprovar todas as entregas existentes da semana
            const resApprove = await runQuery(
                `UPDATE deliveries SET status = 'approved', is_partial = 0, approved_at = CURRENT_TIMESTAMP
                 WHERE week_start = ? AND week_end = ?`,
                [W.start, W.end]
            );
            console.log(`📦 [08-14/06] Entregas existentes aprovadas: ${resApprove?.changes ?? 'ok'}`);

            // 2) Criar entrega aprovada para membros ativos SEM entrega na semana
            const members = await getAll(
                `SELECT id FROM users WHERE active = 1 AND passport NOT IN ('admin', '0')`
            );
            const existing = await getAll(
                'SELECT DISTINCT user_id FROM deliveries WHERE week_start = ? AND week_end = ?',
                [W.start, W.end]
            );
            const haveDelivery = new Set((existing || []).map(r => r.user_id));

            let created = 0;
            for (const member of members || []) {
                if (haveDelivery.has(member.id)) continue;
                await runQuery(
                    `INSERT INTO deliveries (user_id, week_start, week_end, status, is_partial, approved_at, description)
                     VALUES (?, ?, ?, 'approved', 0, CURRENT_TIMESTAMP, '[APROVADO EM LOTE]')`,
                    [member.id, W.start, W.end]
                );
                created++;
            }
            console.log(`✅ [08-14/06] Entregas aprovadas criadas para membros sem entrega: ${created}`);

            await runQuery(
                'INSERT INTO farm_settings (setting_key, setting_value) VALUES (?, ?)',
                [markerKey, 'true']
            );

            console.log('✅ Aprovação total da semana 08-14/06 concluída');
        } catch (error) {
            console.error('⚠️ Erro na aprovação total da semana 08-14/06:', error.message);
        }
    }

    // Função para criar índices de performance (CRÍTICO para velocidade)
    async function createPerformanceIndexes() {
        if (!process.env.DATABASE_URL) return; // Só em produção (PostgreSQL)
        
        try {
            const { Pool } = require('pg');
            const pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: { rejectUnauthorized: false },
                max: 1
            });
            
            console.log('🔧 Verificando índices de performance...');
            
            const indexes = [
                'CREATE INDEX IF NOT EXISTS idx_deliveries_week ON deliveries (week_start, week_end)',
                'CREATE INDEX IF NOT EXISTS idx_deliveries_user_week ON deliveries (user_id, week_start, week_end)',
                'CREATE INDEX IF NOT EXISTS idx_deliveries_week_status_user ON deliveries (week_start, week_end, status, user_id)',
                'CREATE INDEX IF NOT EXISTS idx_deliveries_status ON deliveries (status)',
                'CREATE INDEX IF NOT EXISTS idx_deliveries_user_id ON deliveries (user_id)',
                'CREATE INDEX IF NOT EXISTS idx_delivery_items_delivery ON delivery_items (delivery_id)',
                'CREATE INDEX IF NOT EXISTS idx_delivery_items_material ON delivery_items (material_id)',
                'CREATE INDEX IF NOT EXISTS idx_delivery_screenshots_delivery ON delivery_screenshots (delivery_id)',
                'CREATE INDEX IF NOT EXISTS idx_justifications_week ON justifications (week_start, week_end)',
                'CREATE INDEX IF NOT EXISTS idx_justifications_week_user ON justifications (week_start, week_end, user_id)',
                'CREATE INDEX IF NOT EXISTS idx_justifications_user ON justifications (user_id)',
                'CREATE INDEX IF NOT EXISTS idx_warnings_week ON warnings (week_start, week_end)',
                'CREATE INDEX IF NOT EXISTS idx_warnings_week_user ON warnings (week_start, week_end, user_id)',
                'CREATE INDEX IF NOT EXISTS idx_warnings_user ON warnings (user_id)',
                'CREATE INDEX IF NOT EXISTS idx_extra_farm_delivery ON extra_farm_requests (delivery_id)',
                'CREATE INDEX IF NOT EXISTS idx_extra_farm_delivery_status ON extra_farm_requests (delivery_id, status)',
                'CREATE INDEX IF NOT EXISTS idx_extra_farm_status ON extra_farm_requests (status)',
                'CREATE INDEX IF NOT EXISTS idx_extra_screenshots_farm ON extra_farm_screenshots (extra_farm_id)',
                'CREATE INDEX IF NOT EXISTS idx_users_active ON users (active)',
                'CREATE INDEX IF NOT EXISTS idx_users_passport ON users (passport)',
                'CREATE INDEX IF NOT EXISTS idx_user_groups_user ON user_groups (user_id)',
            ];
            
            let created = 0;
            for (const sql of indexes) {
                try {
                    await pool.query(sql);
                    created++;
                } catch (e) {
                    // Ignorar erros (tabela não existe, etc)
                }
            }
            
            // Adicionar coluna approved_amounts_json se não existir
            try {
                await pool.query(`
                    ALTER TABLE deliveries 
                    ADD COLUMN IF NOT EXISTS approved_amounts_json TEXT
                `);
                console.log('✅ Coluna approved_amounts_json verificada');
            } catch (e) {
                // Coluna já existe ou erro
            }
            
            // Atualizar estatísticas
            try {
                await pool.query('ANALYZE');
            } catch (e) {}
            
            await pool.end();
            console.log(`✅ ${created} índices verificados/criados`);
        } catch (error) {
            console.error('⚠️ Erro ao criar índices:', error.message);
        }
    }
    
    // Auto-migração para v2.0.0 (sistema de grupos)
    try {
        const bcrypt = require('bcryptjs');
        const { runQuery, getAll, getOne } = require('./database/db');
        
        console.log('🔍 Verificando necessidade de migração...');
        
        // Verificar se tabela user_groups existe
        let needsMigration = false;
        try {
            await getAll('SELECT * FROM user_groups LIMIT 1');
            console.log('✅ Sistema de grupos já configurado');
        } catch (error) {
            needsMigration = true;
            console.log('⚠️ Tabela user_groups não encontrada, executando migração...');
            
            // Criar tabela user_groups
            await runQuery(`
                CREATE TABLE IF NOT EXISTS user_groups (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    group_name TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id),
                    UNIQUE(user_id, group_name)
                )
            `);
            
            // Migrar usuários existentes
            const users = await getAll('SELECT id, role FROM users WHERE active = 1');
            for (const user of users) {
                await runQuery('INSERT OR IGNORE INTO user_groups (user_id, group_name) VALUES (?, ?)', 
                    [user.id, user.role]);
            }
            
            // Criar grupo super_admin se não existir
            const superAdmin = await getOne('SELECT * FROM role_permissions WHERE role_name = ?', ['super_admin']);
            if (!superAdmin) {
                await runQuery(`
                    INSERT INTO role_permissions (role_name, display_name, permissions, can_config)
                    VALUES (?, ?, ?, ?)
                `, ['super_admin', 'Super Admin', JSON.stringify(['all']), 1]);
            }
            
            // Criar grupo member se não existir
            const memberGroup = await getOne('SELECT * FROM role_permissions WHERE role_name = ?', ['member']);
            if (!memberGroup) {
                await runQuery(`
                    INSERT INTO role_permissions (role_name, display_name, permissions, can_config)
                    VALUES (?, ?, ?, ?)
                `, ['member', 'Membro', JSON.stringify([]), 0]);
                console.log('✅ Grupo member criado');
            }
            
            console.log('✅ Migração v2.0.0 concluída!');
        }
        
        // Criar tabela de farm extra se não existir
        await createExtraFarmTable();
        
        // Criar tabela de competições se não existir
        await createCompetitionsTable();

        // Criar tabela de extrato de vendas de armas
        await createWeaponSalesTable();
        
        // Atualizar permissões do ranking semanal
        await updateRankingPermissions();

        // Atualizar permissões do extrato de vendas
        await updateWeaponSalesPermissions();

        // Atualizar permissoes dos mandamentos da familia
        await updateFamilyCommandmentsPermissions();

        // Garantir que todos os gerentes editem status da entrega e vejam o Ponto
        await updateManagerFarmPermissions();
        
        // Migrar farms in_progress para pending (novo fluxo de aprovação)
        await migrateInProgressToPending();

        // Esconder materiais padrão antigos e impedir que voltem após reinício
        await deactivateLegacyDefaultMaterials();

        // Zerar slots de baú de membros DESATIVADOS (libera os slots)
        try {
            const { runQuery: rqSlots } = require('./database/db');
            const rSlots = await rqSlots("UPDATE users SET member_slot = NULL, manager_slot = NULL WHERE active = 0 AND (member_slot IS NOT NULL OR manager_slot IS NOT NULL)");
            if (rSlots && rSlots.changes) console.log(`🧹 Slots liberados de ${rSlots.changes} membro(s) desativado(s)`);
        } catch (slotErr) {
            console.error('⚠️ Erro ao zerar slots de desativados:', slotErr.message);
        }

        // One-shot: aprovar semana 08-14/06 e zerar semana 15-21/06
        await bulkWeekOps_2026_06();

        // One-shot: garantir que TODOS os membros fiquem aprovados na semana 08-14/06
        await bulkApproveAllMembersWeek_08_14();
        
        // Criar índices para performance (muito importante!)
        await createPerformanceIndexes();

        // Apagar histórico antigo para início das novas metas em 18/05/2026
        await cleanupGoalHistoryBefore2026_05_18();
        
    } catch (migrationError) {
        console.error('⚠️ Erro na auto-migração (sistema continuará funcionando):', migrationError.message);
    }
    
    app.listen(PORT, async () => {
        console.log(`🎮 Ghosts Farm Control rodando em http://localhost:${PORT}`);
        
        // Criar super admin "Admin Admin" se não existir (one-shot, remover depois)
        try {
            const bcryptBoot = require('bcryptjs');
            const { getOne: getOneBoot, runQuery: runQueryBoot } = require('./database/db');
            const existing = await getOneBoot('SELECT id FROM users WHERE passport = ?', ['admin']);
            if (!existing) {
                const hashed = bcryptBoot.hashSync('admin', 10);
                const result = await runQueryBoot(
                    'INSERT INTO users (name, passport, password, role, active) VALUES (?, ?, ?, ?, ?)',
                    ['Admin Admin', 'admin', hashed, 'super_admin', 1]
                );
                const newId = result.lastID;
                await runQueryBoot(
                    'INSERT INTO user_groups (user_id, group_name) VALUES (?, ?)',
                    [newId, 'super_admin']
                );
                console.log('👑 Super Admin "Admin Admin" criado (passaporte: admin, senha: admin)');
            } else {
                console.log('👑 Super Admin "Admin Admin" já existe');
            }
        } catch (e) {
            console.log('⚠️ Criar Admin Admin:', e.message);
        }

        // Limpeza imediata no boot — aguarda conclusão
        console.log('🧹 Executando limpeza de retenção no boot...');
        try {
            const result = await db.cleanupOldImages();
            console.log('🧹 Resultado da limpeza no boot:', JSON.stringify(result));
        } catch (e) {
            console.error('⚠️ Erro na limpeza de boot:', e.message);
        }

        // Agendar limpeza diária às 3h da manhã
        const now = new Date();
        const nextRun = new Date();
        nextRun.setHours(3, 0, 0, 0);
        if (now > nextRun) nextRun.setDate(nextRun.getDate() + 1);

        const msUntilNextRun = nextRun.getTime() - now.getTime();
        setTimeout(() => {
            db.cleanupOldImages();
            setInterval(() => db.cleanupOldImages(), 24 * 60 * 60 * 1000);
        }, msUntilNextRun);

        console.log(`🕐 Próxima limpeza agendada para ${nextRun.toLocaleString('pt-BR')}`);
    });
}).catch(err => {
    console.error('Erro ao inicializar banco de dados:', err);
});
