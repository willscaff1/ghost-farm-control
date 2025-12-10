const bcrypt = require('bcryptjs');

// Detectar se está em produção (Railway) ou local
const isProduction = process.env.DATABASE_URL ? true : false;

let pool;
let dbType;

if (isProduction) {
    // PostgreSQL para produção
    const { Pool } = require('pg');
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
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

// Função para obter a semana atual (segunda a domingo)
const getCurrentWeek = () => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    monday.setHours(0, 0, 0, 0);
    
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    
    return {
        start: monday.toISOString().split('T')[0],
        end: sunday.toISOString().split('T')[0],
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
    
    // Converter valores booleanos em INSERT para is_partial (ex: , 1, $6) -> , TRUE, $6)
    converted = converted.replace(/, 1, (\$\d+)\)/gi, ', TRUE, $1)');
    converted = converted.replace(/is_partial = 0,/gi, 'is_partial = FALSE,');
    
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

        // Tabela de liberação de edição
        await pool.query(`
            CREATE TABLE IF NOT EXISTS edit_permissions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                week_start DATE NOT NULL,
                week_end DATE NOT NULL,
                reason TEXT,
                granted_by INTEGER NOT NULL REFERENCES users(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, week_start, week_end)
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

        // Criar super admin
        const superAdminPassword = bcrypt.hashSync('6999', 10);
        const existing = await pool.query(`SELECT id FROM users WHERE passport = '6999'`);
        if (existing.rows.length === 0) {
            await pool.query(
                `INSERT INTO users (name, passport, password, role, active) VALUES ($1, $2, $3, $4, $5)`,
                ['Willian Scaff', '6999', superAdminPassword, 'gerente_geral', 1]
            );
            console.log('👑 Super Admin criado: Willian Scaff (Passaporte: 6999, Senha: 6999)');
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
        
        // Atualizar materials existentes que não tem weekly_goal
        try {
            await pool.query(`UPDATE materials SET weekly_goal = 700 WHERE weekly_goal IS NULL`);
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
        
        console.log('✅ Migrações concluídas');

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

            // Tabela de liberação de edição
            pool.run(`
                CREATE TABLE IF NOT EXISTS edit_permissions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    week_start TEXT NOT NULL,
                    week_end TEXT NOT NULL,
                    reason TEXT,
                    granted_by INTEGER NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id),
                    FOREIGN KEY (granted_by) REFERENCES users(id),
                    UNIQUE(user_id, week_start, week_end)
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

            // Criar super admin
            const superAdminPassword = bcrypt.hashSync('6999', 10);
            pool.run(`
                INSERT OR IGNORE INTO users (name, passport, password, role, active) 
                VALUES ('Willian Scaff', '6999', ?, 'gerente_geral', 1)
            `, [superAdminPassword], function(err) {
                if (!err && this.changes > 0) {
                    console.log('👑 Super Admin criado: Willian Scaff (Passaporte: 6999, Senha: 6999)');
                }
            });

            console.log('✅ Banco de dados SQLite inicializado');
            resolve();
        });
    });
};

module.exports = {
    db: pool,
    pool,
    initialize,
    runQuery,
    getOne,
    getAll,
    getCurrentWeek,
    dbType
};
