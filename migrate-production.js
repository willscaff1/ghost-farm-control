const bcrypt = require('bcryptjs');
const { runQuery, getAll, getOne } = require('./database/db');
const rootAdminPassword = process.env.ROOT_ADMIN_PASSWORD;

if (!rootAdminPassword) {
    console.error('❌ ROOT_ADMIN_PASSWORD é obrigatório para executar a migração com criação de usuário root.');
    console.error('   Exemplo: ROOT_ADMIN_PASSWORD="senha-forte" node migrate-production.js');
    process.exit(1);
}

async function migrateProduction() {
    try {
        console.log('🚀 Iniciando migração para produção...');
        
        // 1. Verificar se tabela user_groups existe
        console.log('\n📋 Verificando tabela user_groups...');
        try {
            await getAll('SELECT * FROM user_groups LIMIT 1');
            console.log('✅ Tabela user_groups já existe');
        } catch (error) {
            console.log('⚠️ Tabela user_groups não existe, criando...');
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
            console.log('✅ Tabela user_groups criada');
        }
        
        // 2. Migrar usuários existentes para user_groups
        console.log('\n👥 Migrando usuários para sistema de grupos...');
        const users = await getAll('SELECT id, role FROM users WHERE active = 1');
        
        for (const user of users) {
            // Verificar se já tem entrada no user_groups
            const existing = await getOne('SELECT id FROM user_groups WHERE user_id = ? AND group_name = ?', 
                [user.id, user.role]);
            
            if (!existing) {
                await runQuery('INSERT INTO user_groups (user_id, group_name) VALUES (?, ?)', 
                    [user.id, user.role]);
                console.log(`  ✓ Usuário ${user.id} adicionado ao grupo ${user.role}`);
            }
        }
        
        // 3. Verificar se existe super_admin na role_permissions
        console.log('\n🔐 Verificando grupo super_admin...');
        const superAdmin = await getOne('SELECT * FROM role_permissions WHERE role_name = ?', ['super_admin']);
        
        if (!superAdmin) {
            console.log('⚠️ Grupo super_admin não existe, criando...');
            await runQuery(`
                INSERT INTO role_permissions (role_name, display_name, permissions, can_config)
                VALUES (?, ?, ?, ?)
            `, ['super_admin', 'Super Admin', JSON.stringify(['all']), 1]);
            console.log('✅ Grupo super_admin criado');
        }
        
        // 3.5. Verificar se existe member na role_permissions
        console.log('\n👤 Verificando grupo member...');
        const memberGroup = await getOne('SELECT * FROM role_permissions WHERE role_name = ?', ['member']);
        
        if (!memberGroup) {
            console.log('⚠️ Grupo member não existe, criando...');
            await runQuery(`
                INSERT INTO role_permissions (role_name, display_name, permissions, can_config)
                VALUES (?, ?, ?, ?)
            `, ['member', 'Membro', JSON.stringify([]), 0]);
            console.log('✅ Grupo member criado');
        }
        
        // 4. Criar usuário root se não existir
        console.log('\n👤 Verificando usuário root...');
        const rootUser = await getOne('SELECT id FROM users WHERE passport = ?', ['0']);
        
        if (!rootUser) {
            console.log('⚠️ Usuário root não existe, criando...');
            const passwordHash = await bcrypt.hash(rootAdminPassword, 10);
            const result = await runQuery(`
                INSERT INTO users (name, passport, password, role, active)
                VALUES (?, ?, ?, ?, ?)
            `, ['Admin', '0', passwordHash, 'super_admin', 1]);
            
            const userId = result.lastID;
            
            // Adicionar ao grupo super_admin
            await runQuery(`
                INSERT INTO user_groups (user_id, group_name)
                VALUES (?, ?)
            `, [userId, 'super_admin']);
            
            console.log('✅ Usuário root criado (passaporte 0) com senha definida por ROOT_ADMIN_PASSWORD');
        } else {
            console.log('✅ Usuário root já existe');
            
            // Garantir que está no grupo super_admin
            const rootGroup = await getOne('SELECT id FROM user_groups WHERE user_id = ? AND group_name = ?', 
                [rootUser.id, 'super_admin']);
            
            if (!rootGroup) {
                await runQuery('INSERT INTO user_groups (user_id, group_name) VALUES (?, ?)', 
                    [rootUser.id, 'super_admin']);
                console.log('✅ Usuário root adicionado ao grupo super_admin');
            }
        }
        
        // 5. Resumo
        console.log('\n📊 Resumo da migração:');
        const totalUsers = await getOne('SELECT COUNT(*) as count FROM users WHERE active = 1');
        const totalGroups = await getOne('SELECT COUNT(DISTINCT group_name) as count FROM user_groups');
        const totalRoles = await getOne('SELECT COUNT(*) as count FROM role_permissions');
        
        console.log(`  👥 Usuários ativos: ${totalUsers.count}`);
        console.log(`  🔐 Grupos únicos em uso: ${totalGroups.count}`);
        console.log(`  📋 Grupos disponíveis: ${totalRoles.count}`);
        
        console.log('\n✅ Migração concluída com sucesso!');
        console.log('🔄 Reinicie o servidor para aplicar as mudanças.');
        
    } catch (error) {
        console.error('❌ Erro na migração:', error);
        throw error;
    }
    
    process.exit(0);
}

migrateProduction();
