const bcrypt = require('bcryptjs');

// Detectar se está em produção (Railway) ou local
const isProduction = process.env.DATABASE_URL ? true : false;
// Senha de bootstrap para super admin: deve ser sempre definida explicitamente via ambiente
const superAdminBootstrapPassword = process.env.SUPERADMIN_BOOTSTRAP_PASSWORD || null;

let pool;
let dbType;

if (isProduction) {
    // PostgreSQL para produção
    const { Pool } = require('pg');
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
        statement_timeout: 30000
    });
    dbType = 'postgres';
    console.log('🐘 Usando PostgreSQL (Produção)');
} else {
    // SQLite para desenvolvimento local
    const sqlite3 = require('sqlite3').verbose();
    const path = require('path');
    const dbPath = path.join(__dirname, 'ghosts.db');
    pool = new sqlite3.Database(dbPath);
    dbType = 'sqlite';
    console.log('📁 Usando SQLite (Local)');
}

// Função para obter a semana atual (segunda a domingo) - PADRONIZADO
const getCurrentWeek = () => {
    // Usar data local sem conversão UTC
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    
    // Calcular segunda-feira
    const dayOfWeek = now.getDay();
    const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    
    const monday = new Date(now);
    monday.setDate(now.getDate() - daysFromMonday);
    monday.setHours(0, 0, 0, 0);
    
    // Domingo é exatamente 6 dias depois da segunda
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    
    // Formatar SEMPRE como YYYY-MM-DD (ISO 8601)
    const formatDate = (date) => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };
    
    return {
        start: formatDate(monday),
        end: formatDate(sunday),
        label: `${monday.toLocaleDateString('pt-BR')} até ${sunday.toLocaleDateString('pt-BR')}`
    };
};

// Helper functions para PostgreSQL
const runQueryPG = async (sql, params = []) => {
    // Adicionar RETURNING id para INSERTs no PostgreSQL
    let modifiedSql = sql;
    if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
        modifiedSql = sql.replace(/;?\s*$/, '') + ' RETURNING id';
    }
    const result = await pool.query(modifiedSql, params);
    return { lastID: result.rows[0]?.id, changes: result.rowCount };
};

const getOnePG = async (sql, params = []) => {
    const result = await pool.query(sql, params);
    return result.rows[0];
};

const getAllPG = async (sql, params = []) => {
    const result = await pool.query(sql, params);
    return result.rows;
};

// Helper functions para SQLite
const runQuerySQLite = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        pool.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
};

const getOneSQLite = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        pool.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
};

const getAllSQLite = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        pool.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

// Converter SQL SQLite para PostgreSQL
const convertSQL = (sql) => {
    if (dbType === 'sqlite') return sql;
    
    // Converter ? para $1, $2, etc
    let paramIndex = 0;
    let converted = sql.replace(/\?/g, () => `$${++paramIndex}`);
    
    // Converter AUTOINCREMENT para SERIAL
    converted = converted.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY');
    
    // Converter DATETIME para TIMESTAMP
    converted = converted.replace(/DATETIME/gi, 'TIMESTAMP');
    
    // Converter INSERT OR IGNORE para INSERT ... ON CONFLICT DO NOTHING
    converted = converted.replace(/INSERT OR IGNORE/gi, 'INSERT');
    
    // Converter is_partial = 1/0 para TRUE/FALSE (PostgreSQL usa BOOLEAN)
    converted = converted.replace(/is_partial\s*=\s*1/gi, 'is_partial = TRUE');
    converted = converted.replace(/is_partial\s*=\s*0/gi, 'is_partial = FALSE');
    
    // Converter valores booleanos em INSERT para is_partial
    converted = converted.replace(/, 1, (\$\d+)\)/gi, ', TRUE, $1)');
    converted = converted.replace(/is_partial = 0,/gi, 'is_partial = FALSE,');
    
    // Converter valores literais 1 e 0 que são is_partial em INSERTs
    // Padrão: $N, 1, (próximo valor) -> $N, TRUE, (próximo valor)
    converted = converted.replace(/(\$\d+), 1, (\$\d+)/gi, '$1, TRUE, $2');
    converted = converted.replace(/(\$\d+), 0, (\$\d+)/gi, '$1, FALSE, $2');
    converted = converted.replace(/(\$\d+), 1, '/gi, "$1, TRUE, '");
    converted = converted.replace(/(\$\d+), 0, '/gi, "$1, FALSE, '");
    
    return converted;
};

// Funções exportadas que detectam o tipo de banco
const runQuery = async (sql, params = []) => {
    const convertedSQL = convertSQL(sql);
    if (dbType === 'postgres') {
        return runQueryPG(convertedSQL, params);
    }
    return runQuerySQLite(sql, params);
};

const getOne = async (sql, params = []) => {
    const convertedSQL = convertSQL(sql);
    if (dbType === 'postgres') {
        return getOnePG(convertedSQL, params);
    }
    return getOneSQLite(sql, params);
};

const getAll = async (sql, params = []) => {
    const convertedSQL = convertSQL(sql);
    if (dbType === 'postgres') {
        return getAllPG(convertedSQL, params);
    }
    return getAllSQLite(sql, params);
};

// Inicialização do banco
const initialize = async () => {
    if (dbType === 'postgres') {
        return initializePostgres();
    }
    return initializeSQLite();
};

// Inicialização PostgreSQL
const initializePostgres = async () => {
    try {
        // Tabela de usuários
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                passport TEXT UNIQUE NOT NULL,
                email TEXT,
                password TEXT NOT NULL,
                role TEXT DEFAULT 'member',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                active INTEGER DEFAULT 1
            )
        `);

        // Tabela de materiais
        await pool.query(`
            CREATE TABLE IF NOT EXISTS materials (
                id SERIAL PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                icon TEXT DEFAULT '📦',
                weekly_goal INTEGER DEFAULT 700,
                manager_weekly_goal INTEGER DEFAULT 700,
                active INTEGER DEFAULT 1
            )
        `);

        // Tabela de semanas
        await pool.query(`
            CREATE TABLE IF NOT EXISTS farm_weeks (
                id SERIAL PRIMARY KEY,
                week_start DATE NOT NULL,
                week_end DATE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(week_start, week_end)
            )
        `);

        // Tabela de entregas
        await pool.query(`
            CREATE TABLE IF NOT EXISTS deliveries (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                week_start DATE NOT NULL,
                week_end DATE NOT NULL,
                description TEXT,
                screenshot_url TEXT,
                status TEXT DEFAULT 'pending',
                is_partial BOOLEAN DEFAULT FALSE,
                approved_amounts_json TEXT,
                approved_by INTEGER REFERENCES users(id),
                approved_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Tabela de screenshots das entregas
        await pool.query(`
            CREATE TABLE IF NOT EXISTS delivery_screenshots (
                id SERIAL PRIMARY KEY,
                delivery_id INTEGER NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
                screenshot_url TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Tabela de itens da entrega
        await pool.query(`
            CREATE TABLE IF NOT EXISTS delivery_items (
                id SERIAL PRIMARY KEY,
                delivery_id INTEGER NOT NULL REFERENCES deliveries(id),
                material_id INTEGER NOT NULL REFERENCES materials(id),
                amount INTEGER NOT NULL
            )
        `);

        // Tabela de justificativas
        await pool.query(`
            CREATE TABLE IF NOT EXISTS justifications (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                week_start DATE NOT NULL,
                week_end DATE NOT NULL,
                reason TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                approved_by INTEGER REFERENCES users(id),
                approved_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Tabela de advertências
        await pool.query(`
            CREATE TABLE IF NOT EXISTS warnings (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                reason TEXT NOT NULL,
                given_by INTEGER NOT NULL REFERENCES users(id),
                week_start TEXT,
                week_end TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Tabela de whitelist
        await pool.query(`
            CREATE TABLE IF NOT EXISTS farm_whitelist (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
                reason TEXT,
                added_by INTEGER NOT NULL REFERENCES users(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Tabela de liberação de edição (por membro, válido para qualquer semana)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS edit_permissions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
                reason TEXT,
                granted_by INTEGER NOT NULL REFERENCES users(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Tabela de tipos de pagamento (Dinheiro Sujo, Dinheiro Limpo, etc.)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS payment_types (
                id SERIAL PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                icon TEXT DEFAULT '💰',
                weekly_goal INTEGER DEFAULT 50000,
                manager_weekly_goal INTEGER DEFAULT 50000,
                active INTEGER DEFAULT 1
            )
        `);

        // Tabela de configurações do farm
        await pool.query(`
            CREATE TABLE IF NOT EXISTS farm_settings (
                id SERIAL PRIMARY KEY,
                setting_key TEXT UNIQUE NOT NULL,
                setting_value TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Tabela de permissões por grupo (role)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS role_permissions (
                id SERIAL PRIMARY KEY,
                role_name TEXT UNIQUE NOT NULL,
                display_name TEXT NOT NULL,
                permissions TEXT NOT NULL,
                can_config INTEGER DEFAULT 0,
                active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Tabela de solicitações de recuperação de senha
        await pool.query(`
            CREATE TABLE IF NOT EXISTS password_resets (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                status TEXT DEFAULT 'pending',
                new_password TEXT,
                requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                processed_by INTEGER REFERENCES users(id),
                processed_at TIMESTAMP
            )
        `);

        // Inserir materiais padrão
        const defaultMaterials = [
            ['Folha', '🍃'],
            ['Ópio', '💊'],
            ['Embalagem Plástica', '📦'],
            ['Farinha de Trigo', '🌾']
        ];

        for (const [name, icon] of defaultMaterials) {
            await pool.query(
                `INSERT INTO materials (name, icon) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING`,
                [name, icon]
            );
        }

        // Criar super admin (somente com senha de bootstrap configurada)
        const existing = await pool.query(`SELECT id FROM users WHERE passport = '6999'`);
        if (existing.rows.length === 0 && superAdminBootstrapPassword) {
            const superAdminPassword = bcrypt.hashSync(superAdminBootstrapPassword, 10);
            await pool.query(
                `INSERT INTO users (name, passport, password, role, active) VALUES ($1, $2, $3, $4, $5)`,
                ['Willian Scaff', '6999', superAdminPassword, 'gerente_geral', 1]
            );
            console.log('👑 Super Admin bootstrap criado: Willian Scaff (Passaporte: 6999)');
        } else if (existing.rows.length === 0 && !superAdminBootstrapPassword) {
            console.warn('⚠️ SUPERADMIN_BOOTSTRAP_PASSWORD não definido em produção. Usuário 6999 não foi criado automaticamente.');
        }

        // ===== MIGRAÇÕES - Adicionar colunas que podem não existir =====
        console.log('🔄 Executando migrações...');
        
        // Adicionar weekly_goal em materials
        try {
            await pool.query(`ALTER TABLE materials ADD COLUMN IF NOT EXISTS weekly_goal INTEGER DEFAULT 700`);
            console.log('✅ Coluna weekly_goal verificada/adicionada');
        } catch (e) { 
            console.log('ℹ️ weekly_goal:', e.message);
        }

        // Adicionar manager_weekly_goal em materials
        try {
            await pool.query(`ALTER TABLE materials ADD COLUMN IF NOT EXISTS manager_weekly_goal INTEGER DEFAULT 700`);
            console.log('✅ Coluna manager_weekly_goal verificada/adicionada');
        } catch (e) {
            console.log('ℹ️ manager_weekly_goal:', e.message);
        }
        
        // Atualizar materials existentes que não tem weekly_goal
        try {
            await pool.query(`UPDATE materials SET weekly_goal = 700 WHERE weekly_goal IS NULL`);
        } catch (e) { /* ignorar */ }

        // Atualizar materials existentes que não tem manager_weekly_goal
        try {
            await pool.query(`UPDATE materials SET manager_weekly_goal = weekly_goal WHERE manager_weekly_goal IS NULL`);
        } catch (e) { /* ignorar */ }
        
        // Adicionar is_partial em deliveries
        try {
            await pool.query(`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS is_partial BOOLEAN DEFAULT FALSE`);
            console.log('✅ Coluna is_partial verificada/adicionada');
        } catch (e) { 
            console.log('ℹ️ is_partial:', e.message);
        }
        
        // Criar tabela delivery_screenshots se não existir
        await pool.query(`
            CREATE TABLE IF NOT EXISTS delivery_screenshots (
                id SERIAL PRIMARY KEY,
                delivery_id INTEGER NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
                screenshot_url TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Tabela delivery_screenshots verificada/criada');
        
        // Adicionar payment_type em deliveries (material ou dirty_money)
        try {
            await pool.query(`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS payment_type TEXT DEFAULT 'material'`);
            console.log('✅ Coluna payment_type verificada/adicionada');
        } catch (e) { 
            console.log('ℹ️ payment_type:', e.message);
        }
        
        // Adicionar dirty_money_amount em deliveries
        try {
            await pool.query(`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS dirty_money_amount INTEGER DEFAULT 0`);
            console.log('✅ Coluna dirty_money_amount verificada/adicionada');
        } catch (e) { 
            console.log('ℹ️ dirty_money_amount:', e.message);
        }

        // Adicionar payment_type_id em deliveries (referência ao tipo de pagamento)
        try {
            await pool.query(`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS payment_type_id INTEGER DEFAULT NULL`);
            console.log('✅ Coluna payment_type_id verificada/adicionada');
        } catch (e) { 
            console.log('ℹ️ payment_type_id:', e.message);
        }

        // Adicionar approval_note em deliveries
        try {
            await pool.query(`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS approval_note TEXT`);
            console.log('✅ Coluna approval_note verificada/adicionada');
        } catch (e) { 
            console.log('ℹ️ approval_note:', e.message);
        }

        // Adicionar approved_amounts_json em deliveries
        try {
            await pool.query(`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS approved_amounts_json TEXT`);
            console.log('✅ Coluna approved_amounts_json verificada/adicionada');
        } catch (e) {
            console.log('ℹ️ approved_amounts_json:', e.message);
        }

        // Adicionar manager_weekly_goal em payment_types
        try {
            await pool.query(`ALTER TABLE payment_types ADD COLUMN IF NOT EXISTS manager_weekly_goal INTEGER DEFAULT 50000`);
            console.log('✅ Coluna manager_weekly_goal (payment_types) verificada/adicionada');
        } catch (e) {
            console.log('ℹ️ manager_weekly_goal (payment_types):', e.message);
        }

        // Adicionar unit_type em payment_types (R$ ou unidade)
        try {
            await pool.query(`ALTER TABLE payment_types ADD COLUMN IF NOT EXISTS unit_type TEXT DEFAULT 'R$'`);
            console.log('✅ Coluna unit_type (payment_types) verificada/adicionada');
        } catch (e) {
            console.log('ℹ️ unit_type (payment_types):', e.message);
        }

        // Adicionar reset_code em password_resets
        try {
            await pool.query(`ALTER TABLE password_resets ADD COLUMN IF NOT EXISTS reset_code TEXT`);
            console.log('✅ Coluna reset_code verificada/adicionada');
        } catch (e) {
            console.log('ℹ️ reset_code:', e.message);
        }

        // Atualizar payment_types existentes que não tem manager_weekly_goal
        try {
            await pool.query(`UPDATE payment_types SET manager_weekly_goal = weekly_goal WHERE manager_weekly_goal IS NULL`);
        } catch (e) { /* ignorar */ }

        // Tabela de observações dos membros (histórico)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS member_observations (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                week_start DATE NOT NULL,
                week_end DATE NOT NULL,
                observation TEXT NOT NULL,
                created_by INTEGER NOT NULL REFERENCES users(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Tabela member_observations verificada/criada');

        // Inserir tipos de pagamento padrão (R$ = Dinheiro; unidade = Pepita, Ruby, Safira)
        const defaultPaymentTypes = [
            ['Dinheiro Limpo', '💵', 50000, 'R$'],
            ['Dinheiro Sujo', '💰', 50000, 'R$'],
            ['Pepita de Ouro', '🪙', 700, 'unidade'],
            ['Pepita de Prata', '💸', 700, 'unidade'],
            ['Ruby', '💎', 700, 'unidade'],
            ['Safira', '💠', 700, 'unidade']
        ];

        for (const [name, icon, goal, unitType] of defaultPaymentTypes) {
            await pool.query(
                `INSERT INTO payment_types (name, icon, weekly_goal, manager_weekly_goal, unit_type) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (name) DO UPDATE SET unit_type = EXCLUDED.unit_type, weekly_goal = EXCLUDED.weekly_goal, manager_weekly_goal = EXCLUDED.manager_weekly_goal`,
                [name, icon, goal, goal, unitType]
            );
        }
        console.log('✅ Tipos de pagamento padrão inseridos');

        // Inserir configurações padrão do farm
        const defaultSettings = [
            ['farm_materials_enabled', 'true'],      // Habilitar farm de materiais
            ['farm_payment_enabled', 'true'],        // Habilitar pagamento com dinheiro
            ['farm_payment_mode', 'either']          // 'either' = um ou outro, 'both' = ambos obrigatórios
        ];

        for (const [key, value] of defaultSettings) {
            await pool.query(
                `INSERT INTO farm_settings (setting_key, setting_value) VALUES ($1, $2) ON CONFLICT (setting_key) DO NOTHING`,
                [key, value]
            );
        }
        console.log('✅ Configurações padrão do farm inseridas');
        
        console.log('✅ Migrações concluídas');

        // ===== ÍNDICES PARA PERFORMANCE =====
        console.log('🔄 Verificando índices para performance...');
        
        const indexes = [
            // Tabela users
            'CREATE INDEX IF NOT EXISTS idx_users_passport ON users (passport)',
            'CREATE INDEX IF NOT EXISTS idx_users_role ON users (role)',
            'CREATE INDEX IF NOT EXISTS idx_users_active ON users (active)',
            
            // Tabela deliveries - mais acessada
            'CREATE INDEX IF NOT EXISTS idx_deliveries_user_id ON deliveries (user_id)',
            'CREATE INDEX IF NOT EXISTS idx_deliveries_status ON deliveries (status)',
            'CREATE INDEX IF NOT EXISTS idx_deliveries_week ON deliveries (week_start, week_end)',
            'CREATE INDEX IF NOT EXISTS idx_deliveries_user_week ON deliveries (user_id, week_start, week_end)',
            'CREATE INDEX IF NOT EXISTS idx_deliveries_week_status_user ON deliveries (week_start, week_end, status, user_id)',
            'CREATE INDEX IF NOT EXISTS idx_deliveries_created ON deliveries (created_at DESC)',
            
            // Tabela delivery_items
            'CREATE INDEX IF NOT EXISTS idx_delivery_items_delivery ON delivery_items (delivery_id)',
            'CREATE INDEX IF NOT EXISTS idx_delivery_items_material ON delivery_items (material_id)',
            
            // Tabela delivery_screenshots
            'CREATE INDEX IF NOT EXISTS idx_delivery_screenshots_delivery ON delivery_screenshots (delivery_id)',
            
            // Tabela justifications
            'CREATE INDEX IF NOT EXISTS idx_justifications_user ON justifications (user_id)',
            'CREATE INDEX IF NOT EXISTS idx_justifications_status ON justifications (status)',
            'CREATE INDEX IF NOT EXISTS idx_justifications_week ON justifications (week_start, week_end)',
            'CREATE INDEX IF NOT EXISTS idx_justifications_week_user ON justifications (week_start, week_end, user_id)',
            
            // Tabela warnings
            'CREATE INDEX IF NOT EXISTS idx_warnings_user ON warnings (user_id)',
            'CREATE INDEX IF NOT EXISTS idx_warnings_week_user ON warnings (week_start, week_end, user_id)',
            
            // Tabela extra_farm_requests (se existir)
            'CREATE INDEX IF NOT EXISTS idx_extra_farm_delivery ON extra_farm_requests (delivery_id)',
            'CREATE INDEX IF NOT EXISTS idx_extra_farm_user ON extra_farm_requests (user_id)',
            'CREATE INDEX IF NOT EXISTS idx_extra_farm_status ON extra_farm_requests (status)',
            'CREATE INDEX IF NOT EXISTS idx_extra_farm_delivery_status ON extra_farm_requests (delivery_id, status)',
            
            // Tabela materials
            'CREATE INDEX IF NOT EXISTS idx_materials_active ON materials (active)',
            
            // Tabela user_groups (se existir)
            'CREATE INDEX IF NOT EXISTS idx_user_groups_user ON user_groups (user_id)',
            'CREATE INDEX IF NOT EXISTS idx_user_groups_group ON user_groups (group_name)',
            
            // Tabela farm_whitelist
            'CREATE INDEX IF NOT EXISTS idx_whitelist_user ON farm_whitelist (user_id)',
        ];
        
        let indexCount = 0;
        for (const sql of indexes) {
            try {
                await pool.query(sql);
                indexCount++;
            } catch (e) {
                // Ignorar erros de tabela não existente
                if (!e.message.includes('does not exist')) {
                    console.log(`ℹ️ Índice: ${e.message}`);
                }
            }
        }
        console.log(`✅ ${indexCount} índices verificados/criados`);

        console.log('✅ Banco de dados PostgreSQL inicializado');
    } catch (error) {
        console.error('Erro ao inicializar PostgreSQL:', error);
        throw error;
    }
};

// Inicialização SQLite
const initializeSQLite = () => {
    return new Promise((resolve, reject) => {
        pool.serialize(() => {
            // Tabela de usuários
            pool.run(`
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    passport TEXT UNIQUE NOT NULL,
                    email TEXT,
                    password TEXT NOT NULL,
                    role TEXT DEFAULT 'member',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    active INTEGER DEFAULT 1
                )
            `);

            // Tabela de materiais
            pool.run(`
                CREATE TABLE IF NOT EXISTS materials (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE NOT NULL,
                    icon TEXT DEFAULT '📦',
                    weekly_goal INTEGER DEFAULT 700,
                    manager_weekly_goal INTEGER DEFAULT 700,
                    active INTEGER DEFAULT 1
                )
            `);

            // Tabela de semanas
            pool.run(`
                CREATE TABLE IF NOT EXISTS farm_weeks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    week_start DATE NOT NULL,
                    week_end DATE NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(week_start, week_end)
                )
            `);

            // Tabela de entregas
            pool.run(`
                CREATE TABLE IF NOT EXISTS deliveries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    week_start DATE NOT NULL,
                    week_end DATE NOT NULL,
                    description TEXT,
                    screenshot_url TEXT,
                    status TEXT DEFAULT 'pending',
                    is_partial INTEGER DEFAULT 0,
                    approved_amounts_json TEXT,
                    approved_by INTEGER,
                    approved_at DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id),
                    FOREIGN KEY (approved_by) REFERENCES users(id)
                )
            `);

            // Tabela de screenshots das entregas
            pool.run(`
                CREATE TABLE IF NOT EXISTS delivery_screenshots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    delivery_id INTEGER NOT NULL,
                    screenshot_url TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (delivery_id) REFERENCES deliveries(id)
                )
            `);

            // Tabela de itens
            pool.run(`
                CREATE TABLE IF NOT EXISTS delivery_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    delivery_id INTEGER NOT NULL,
                    material_id INTEGER NOT NULL,
                    amount INTEGER NOT NULL,
                    FOREIGN KEY (delivery_id) REFERENCES deliveries(id),
                    FOREIGN KEY (material_id) REFERENCES materials(id)
                )
            `);

            // Tabela de justificativas
            pool.run(`
                CREATE TABLE IF NOT EXISTS justifications (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    week_start DATE NOT NULL,
                    week_end DATE NOT NULL,
                    reason TEXT NOT NULL,
                    status TEXT DEFAULT 'pending',
                    approved_by INTEGER,
                    approved_at DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id),
                    FOREIGN KEY (approved_by) REFERENCES users(id)
                )
            `);

            // Tabela de advertências
            pool.run(`
                CREATE TABLE IF NOT EXISTS warnings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    reason TEXT NOT NULL,
                    given_by INTEGER NOT NULL,
                    week_start TEXT,
                    week_end TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id),
                    FOREIGN KEY (given_by) REFERENCES users(id)
                )
            `);

            // Tabela de whitelist
            pool.run(`
                CREATE TABLE IF NOT EXISTS farm_whitelist (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL UNIQUE,
                    reason TEXT,
                    added_by INTEGER NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id),
                    FOREIGN KEY (added_by) REFERENCES users(id)
                )
            `);

            // Tabela de liberação de edição (por membro, válido para qualquer semana)
            pool.run(`
                CREATE TABLE IF NOT EXISTS edit_permissions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL UNIQUE,
                    reason TEXT,
                    granted_by INTEGER NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id),
                    FOREIGN KEY (granted_by) REFERENCES users(id)
                )
            `);

            // Tabela de tipos de pagamento (Dinheiro Sujo, Dinheiro Limpo, etc.)
            pool.run(`
                CREATE TABLE IF NOT EXISTS payment_types (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE NOT NULL,
                    icon TEXT DEFAULT '💰',
                    weekly_goal INTEGER DEFAULT 50000,
                    manager_weekly_goal INTEGER DEFAULT 50000,
                    active INTEGER DEFAULT 1
                )
            `);

            // Tabela de configurações do farm
            pool.run(`
                CREATE TABLE IF NOT EXISTS farm_settings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    setting_key TEXT UNIQUE NOT NULL,
                    setting_value TEXT NOT NULL,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Tabela de permissões por grupo (role)
            pool.run(`
                CREATE TABLE IF NOT EXISTS role_permissions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    role_name TEXT UNIQUE NOT NULL,
                    display_name TEXT NOT NULL,
                    permissions TEXT NOT NULL,
                    can_config INTEGER DEFAULT 0,
                    active INTEGER DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Tabela de solicitações de recuperação de senha
            pool.run(`
                CREATE TABLE IF NOT EXISTS password_resets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    status TEXT DEFAULT 'pending',
                    new_password TEXT,
                    requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    processed_by INTEGER,
                    processed_at DATETIME,
                    FOREIGN KEY (user_id) REFERENCES users(id),
                    FOREIGN KEY (processed_by) REFERENCES users(id)
                )
            `);

            // Tabela de observações dos membros (histórico)
            pool.run(`
                CREATE TABLE IF NOT EXISTS member_observations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    week_start DATE NOT NULL,
                    week_end DATE NOT NULL,
                    observation TEXT NOT NULL,
                    created_by INTEGER NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id),
                    FOREIGN KEY (created_by) REFERENCES users(id)
                )
            `);

            // Inserir materiais padrão
            const defaultMaterials = [
                ['Folha', '🍃'],
                ['Ópio', '💊'],
                ['Embalagem Plástica', '📦'],
                ['Farinha de Trigo', '🌾']
            ];

            defaultMaterials.forEach(([name, icon]) => {
                pool.run(`INSERT OR IGNORE INTO materials (name, icon) VALUES (?, ?)`, [name, icon]);
            });

            // Criar super admin (somente com senha de bootstrap configurada em produção)
            if (superAdminBootstrapPassword) {
                const superAdminPassword = bcrypt.hashSync(superAdminBootstrapPassword, 10);
                pool.run(`
                    INSERT OR IGNORE INTO users (name, passport, password, role, active) 
                    VALUES ('Willian Scaff', '6999', ?, 'gerente_geral', 1)
                `, [superAdminPassword], function(err) {
                    if (!err && this.changes > 0) {
                        console.log('👑 Super Admin bootstrap criado: Willian Scaff (Passaporte: 6999)');
                    }
                });
            } else if (isProduction) {
                console.warn('⚠️ SUPERADMIN_BOOTSTRAP_PASSWORD não definido em produção. Usuário 6999 não foi criado automaticamente.');
            }

            // Migrações SQLite - adicionar colunas novas
            pool.run(`ALTER TABLE deliveries ADD COLUMN payment_type TEXT DEFAULT 'material'`, (err) => {
                if (!err) console.log('✅ Coluna payment_type adicionada (SQLite)');
            });
            pool.run(`ALTER TABLE deliveries ADD COLUMN dirty_money_amount INTEGER DEFAULT 0`, (err) => {
                if (!err) console.log('✅ Coluna dirty_money_amount adicionada (SQLite)');
            });
            pool.run(`ALTER TABLE deliveries ADD COLUMN payment_type_id INTEGER DEFAULT NULL`, (err) => {
                if (!err) console.log('✅ Coluna payment_type_id adicionada (SQLite)');
            });
            pool.run(`ALTER TABLE deliveries ADD COLUMN approval_note TEXT`, (err) => {
                if (!err) console.log('✅ Coluna approval_note adicionada (SQLite)');
            });
            pool.run(`ALTER TABLE deliveries ADD COLUMN approved_amounts_json TEXT`, (err) => {
                if (!err) console.log('✅ Coluna approved_amounts_json adicionada (SQLite)');
            });

            pool.run(`ALTER TABLE materials ADD COLUMN manager_weekly_goal INTEGER DEFAULT 700`, (err) => {
                if (!err) console.log('✅ Coluna manager_weekly_goal adicionada (SQLite)');
            });
            pool.run(`ALTER TABLE payment_types ADD COLUMN manager_weekly_goal INTEGER DEFAULT 50000`, (err) => {
                if (!err) console.log('✅ Coluna manager_weekly_goal adicionada (SQLite)');
            });
            pool.run(`ALTER TABLE payment_types ADD COLUMN unit_type TEXT DEFAULT 'R$'`, (err) => {
                if (!err) console.log('✅ Coluna unit_type adicionada (SQLite)');
            });

            pool.run(`ALTER TABLE password_resets ADD COLUMN reset_code TEXT`, (err) => {
                if (!err) console.log('✅ Coluna reset_code adicionada (SQLite)');
            });

            // Preencher metas de gerente onde estiverem vazias
            pool.run(`UPDATE materials SET manager_weekly_goal = weekly_goal WHERE manager_weekly_goal IS NULL`);
            pool.run(`UPDATE payment_types SET manager_weekly_goal = weekly_goal WHERE manager_weekly_goal IS NULL`);

            // Inserir tipos de pagamento padrão (R$ = Dinheiro; unidade = Pepita, Ruby, Safira)
            const defaultPaymentTypes = [
                ['Dinheiro Limpo', '💵', 50000, 'R$'],
                ['Dinheiro Sujo', '💰', 50000, 'R$'],
                ['Pepita de Ouro', '🪙', 700, 'unidade'],
                ['Pepita de Prata', '💸', 700, 'unidade'],
                ['Ruby', '💎', 700, 'unidade'],
                ['Safira', '💠', 700, 'unidade']
            ];
            defaultPaymentTypes.forEach(([name, icon, goal, unitType]) => {
                pool.run(`INSERT OR IGNORE INTO payment_types (name, icon, weekly_goal, manager_weekly_goal, unit_type) VALUES (?, ?, ?, ?, ?)`, [name, icon, goal, goal, unitType]);
            });
            // Corrigir tipos em unidade que estavam com 50000
            pool.run(`UPDATE payment_types SET unit_type = 'unidade', weekly_goal = 700, manager_weekly_goal = 700 WHERE name IN ('Pepita de Ouro', 'Pepita de Prata', 'Ruby', 'Safira')`);

            // Inserir configurações padrão do farm
            const defaultSettings = [
                ['farm_materials_enabled', 'true'],
                ['farm_payment_enabled', 'true'],
                ['farm_payment_mode', 'either']
            ];
            defaultSettings.forEach(([key, value]) => {
                pool.run(`INSERT OR IGNORE INTO farm_settings (setting_key, setting_value) VALUES (?, ?)`, [key, value]);
            });

            console.log('✅ Banco de dados SQLite inicializado');
            resolve();
        });
    });
};

// Limpeza de screenshots ANTIGOS — NUNCA toca na semana atual ou anterior
// Só remove imagens de entregas cujo week_end já passou do período de retenção
const cleanupOldImages = async () => {
    try {
        const retentionDays = parseInt(process.env.IMAGE_RETENTION_DAYS, 10) || 14;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - retentionDays);
        const cutoffDate = cutoff.toISOString().split('T')[0];
        let totalRemoved = 0;

        console.log(`🧹 === LIMPEZA DE STORAGE ===`);
        console.log(`🧹 Corte: ${cutoffDate} (entregas com week_end anterior a esta data)`);

        // 1) screenshot_url inline em entregas antigas
        const r1 = await runQuery(`
            UPDATE deliveries SET screenshot_url = NULL
            WHERE week_end < ? AND screenshot_url IS NOT NULL
        `, [cutoffDate]);
        console.log(`🧹 [1] screenshot_url inline limpos: ${r1?.changes || 0}`);

        // 2) delivery_screenshots de entregas antigas
        const r2 = await runQuery(`
            DELETE FROM delivery_screenshots
            WHERE delivery_id IN (SELECT id FROM deliveries WHERE week_end < ?)
        `, [cutoffDate]);
        totalRemoved += r2?.changes || 0;
        console.log(`🧹 [2] delivery_screenshots removidos: ${r2?.changes || 0}`);

        // 3) extra_farm_screenshots de entregas antigas
        try {
            const r3 = await runQuery(`
                DELETE FROM extra_farm_screenshots
                WHERE extra_farm_id IN (
                    SELECT ef.id FROM extra_farm_requests ef
                    JOIN deliveries d ON ef.delivery_id = d.id
                    WHERE d.week_end < ?
                )
            `, [cutoffDate]);
            totalRemoved += r3?.changes || 0;
            console.log(`🧹 [3] extra_farm_screenshots removidos: ${r3?.changes || 0}`);
        } catch (e) {
            console.log('⚠️ extra_farm_screenshots:', e.message);
        }

        // 4) password_resets já usados
        try {
            await runQuery(`DELETE FROM password_resets WHERE status != 'pending'`);
        } catch (e) { /* ok */ }

        // 5) VACUUM para liberar espaço em disco
        if (dbType === 'postgres') {
            try {
                await pool.query('VACUUM delivery_screenshots, extra_farm_screenshots, deliveries');
                console.log('🧹 VACUUM executado');
            } catch (e) {
                try { await pool.query('VACUUM'); } catch (e2) { /* ok */ }
            }
        }

        console.log(`🧹 === LIMPEZA CONCLUÍDA: ${totalRemoved} screenshots removidos ===`);
        return { success: true, cutoffDate, removedScreenshots: totalRemoved };
    } catch (error) {
        console.error('❌ Erro na limpeza de imagens:', error);
        return { success: false, error: error.message };
    }
};

module.exports = {
    db: pool,
    pool,
    initialize,
    runQuery,
    getOne,
    getAll,
    getCurrentWeek,
    dbType,
    cleanupOldImages
};
