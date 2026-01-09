const db = require('./database/db');

async function migrateToGroups() {
    try {
        console.log('🔄 Iniciando migração para sistema de grupos...');
        
        // 1. Criar tabela de relacionamento usuário-grupo
        if (db.dbType === 'postgres') {
            await db.pool.query(`
                CREATE TABLE IF NOT EXISTS user_groups (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    group_name TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(user_id, group_name)
                )
            `);
        } else {
            await db.runQuery(`
                CREATE TABLE IF NOT EXISTS user_groups (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    group_name TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(user_id, group_name),
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            `);
        }
        console.log('✅ Tabela user_groups criada');
        
        // 2. Migrar roles existentes para grupos
        const users = await db.getAll('SELECT id, role FROM users WHERE role IS NOT NULL AND role != ""');
        console.log(`📋 Migrando ${users.length} usuários para o sistema de grupos...`);
        
        for (const user of users) {
            // Verificar se já existe
            const existing = await db.getOne(
                'SELECT id FROM user_groups WHERE user_id = ? AND group_name = ?',
                [user.id, user.role]
            );
            
            if (!existing) {
                await db.runQuery(
                    'INSERT INTO user_groups (user_id, group_name) VALUES (?, ?)',
                    [user.id, user.role]
                );
                console.log(`  ✓ Usuário ${user.id} adicionado ao grupo ${user.role}`);
            }
        }
        
        console.log('✅ Migração concluída com sucesso!');
        console.log('');
        console.log('📊 Resumo:');
        const groupCount = await db.getAll(`
            SELECT group_name, COUNT(*) as count 
            FROM user_groups 
            GROUP BY group_name
        `);
        groupCount.forEach(g => {
            console.log(`  - ${g.group_name}: ${g.count} usuário(s)`);
        });
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro na migração:', error);
        process.exit(1);
    }
}

migrateToGroups();
