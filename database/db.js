const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

const dbPath = path.join(__dirname, 'ghosts.db');
const db = new sqlite3.Database(dbPath);

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

const initialize = () => {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Tabela de usuários com cargos
            db.run(`
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

            // Tabela de tipos de materiais
            db.run(`
                CREATE TABLE IF NOT EXISTS materials (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE NOT NULL,
                    icon TEXT DEFAULT '📦',
                    active INTEGER DEFAULT 1
                )
            `);

            // Tabela de semanas de farm
            db.run(`
                CREATE TABLE IF NOT EXISTS farm_weeks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    week_start DATE NOT NULL,
                    week_end DATE NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(week_start, week_end)
                )
            `);

            // Tabela de entregas (farm submissions) - agora com referência à semana
            db.run(`
                CREATE TABLE IF NOT EXISTS deliveries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    week_start DATE NOT NULL,
                    week_end DATE NOT NULL,
                    description TEXT,
                    screenshot TEXT,
                    status TEXT DEFAULT 'pending',
                    approved_by INTEGER,
                    approved_at DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id),
                    FOREIGN KEY (approved_by) REFERENCES users(id)
                )
            `);

            // Tabela de itens da entrega
            db.run(`
                CREATE TABLE IF NOT EXISTS delivery_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    delivery_id INTEGER NOT NULL,
                    material_id INTEGER NOT NULL,
                    amount INTEGER NOT NULL,
                    FOREIGN KEY (delivery_id) REFERENCES deliveries(id),
                    FOREIGN KEY (material_id) REFERENCES materials(id)
                )
            `);

            // Tabela de justificativas de ausência
            db.run(`
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
            db.run(`
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

            // Tabela de whitelist (membros isentos de farm)
            db.run(`
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

            // Inserir materiais padrão
            const defaultMaterials = [
                ['Folha', '🍃'],
                ['Ópio', '💊'],
                ['Embalagem Plástica', '📦'],
                ['Farinha de Trigo', '🌾']
            ];

            defaultMaterials.forEach(([name, icon]) => {
                db.run(`INSERT OR IGNORE INTO materials (name, icon) VALUES (?, ?)`, [name, icon]);
            });

            // Criar super admin automaticamente (passaporte 6999 - Willian Scaff)
            const bcrypt = require('bcryptjs');
            const superAdminPassword = bcrypt.hashSync('6999', 10);
            db.run(`
                INSERT OR IGNORE INTO users (name, passport, password, role, active) 
                VALUES ('Willian Scaff', '6999', ?, 'gerente_geral', 1)
            `, [superAdminPassword], function(err) {
                if (!err && this.changes > 0) {
                    console.log('👑 Super Admin criado: Willian Scaff (Passaporte: 6999, Senha: 6999)');
                }
            });

            console.log('✅ Banco de dados inicializado');
            resolve();
        });
    });
};

// Helper functions
const runQuery = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
};

const getOne = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
};

const getAll = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

module.exports = {
    db,
    initialize,
    runQuery,
    getOne,
    getAll,
    getCurrentWeek
};
