const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database', 'ghosts.db');
const db = new sqlite3.Database(dbPath);

console.log('Verificando banco:', dbPath);

db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
    if (err) {
        console.error('Erro:', err);
    } else {
        console.log('\nTabelas no banco:');
        tables.forEach(t => console.log(' -', t.name));
    }
    
    // Verificar usuários
    db.all("SELECT id, name, role, active FROM users", (err, users) => {
        if (err) {
            console.error('Erro users:', err);
        } else {
            console.log('\nUsuários:');
            users.forEach(u => console.log(` - ${u.id}: ${u.name} (${u.role}) active=${u.active}`));
        }
        
        db.close();
    });
});
