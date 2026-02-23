const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

const dbPath = path.join(__dirname, 'database', 'ghosts.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // Limpar todas as tabelas
    db.run('DELETE FROM delivery_items');
    db.run('DELETE FROM deliveries');
    db.run('DELETE FROM justifications');
    db.run('DELETE FROM users');
    
    // Criar apenas 1 admin
    const hash = bcrypt.hashSync('admin123', 10);
    db.run('INSERT INTO users (name, passport, email, password, role) VALUES (?, ?, ?, ?, ?)',
        ['Administrador', 'ADMIN', 'admin@ghosts.com', hash, 'gerente_geral'],
        function(err) {
            if (err) {
                console.error('Erro:', err);
            } else {
                console.log('✅ Banco limpo!');
                console.log('');
                console.log('Usuário Admin criado:');
                console.log('  Passaporte: ADMIN');
                console.log('  Senha: admin123');
            }
            db.close();
        }
    );
});
