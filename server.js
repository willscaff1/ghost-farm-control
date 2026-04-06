const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('./database/db');
const authRoutes = require('./routes/auth');
const deliveryRoutes = require('./routes/delivery');
const adminRoutes = require('./routes/admin');

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

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/delivery', deliveryRoutes);
app.use('/api/admin', adminRoutes);

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
                'CREATE INDEX IF NOT EXISTS idx_deliveries_status ON deliveries (status)',
                'CREATE INDEX IF NOT EXISTS idx_deliveries_user_id ON deliveries (user_id)',
                'CREATE INDEX IF NOT EXISTS idx_delivery_items_delivery ON delivery_items (delivery_id)',
                'CREATE INDEX IF NOT EXISTS idx_delivery_items_material ON delivery_items (material_id)',
                'CREATE INDEX IF NOT EXISTS idx_delivery_screenshots_delivery ON delivery_screenshots (delivery_id)',
                'CREATE INDEX IF NOT EXISTS idx_justifications_week ON justifications (week_start, week_end)',
                'CREATE INDEX IF NOT EXISTS idx_justifications_user ON justifications (user_id)',
                'CREATE INDEX IF NOT EXISTS idx_warnings_week ON warnings (week_start, week_end)',
                'CREATE INDEX IF NOT EXISTS idx_warnings_user ON warnings (user_id)',
                'CREATE INDEX IF NOT EXISTS idx_extra_farm_delivery ON extra_farm_requests (delivery_id)',
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
        
        // Atualizar permissões do ranking semanal
        await updateRankingPermissions();
        
        // Migrar farms in_progress para pending (novo fluxo de aprovação)
        await migrateInProgressToPending();
        
        // Criar índices para performance (muito importante!)
        await createPerformanceIndexes();
        
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
