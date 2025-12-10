const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database', 'ghosts.db');
const db = new sqlite3.Database(dbPath);

console.log('Corrigindo tabela edit_permissions...');

db.serialize(() => {
    // Dropar tabela antiga
    db.run('DROP TABLE IF EXISTS edit_permissions', (err) => {
        if (err) console.log('Erro ao dropar:', err);
        else console.log('✅ Tabela antiga removida');
    });
    
    // Criar nova tabela sem week_start/week_end
    db.run(`
        CREATE TABLE IF NOT EXISTS edit_permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            reason TEXT,
            granted_by INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (granted_by) REFERENCES users(id)
        )
    `, (err) => {
        if (err) console.log('Erro ao criar:', err);
        else console.log('✅ Nova tabela criada (sem week_start/week_end)');
        
        db.close();
        console.log('✅ Concluído!');
    });
});
