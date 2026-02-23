const db = require('./database/db');

async function addSuperAdmin() {
    try {
        // Verifica se super_admin já existe
        const existing = await db.getOne('SELECT * FROM role_permissions WHERE role_name = ?', ['super_admin']);
        
        if (existing) {
            console.log('✅ Super Admin já existe no banco');
            console.log(existing);
        } else {
            // Insere super_admin
            await db.runQuery(`
                INSERT INTO role_permissions (role_name, display_name, permissions, can_config, active)
                VALUES (?, ?, ?, ?, ?)
            `, ['super_admin', '⚡ Super Admin', JSON.stringify(['all']), 1, 1]);
            
            console.log('✅ Super Admin criado com sucesso!');
        }
        
        // Atualiza usuário 6999 para super_admin
        await db.runQuery('UPDATE users SET role = ? WHERE passport = ?', ['super_admin', '6999']);
        console.log('✅ Usuário 6999 (Willian Scaff) atualizado para Super Admin');
        
        // Mostra todos os roles
        const roles = await db.getAll('SELECT * FROM role_permissions ORDER BY rowid');
        console.log('\n📋 Roles no banco:');
        roles.forEach(r => {
            console.log(`  - ${r.role_name}: ${r.display_name} | Permissões: ${r.permissions} | Can Config: ${r.can_config}`);
        });
        
        // Mostra o usuário atualizado
        const user = await db.getOne('SELECT passport, name, role FROM users WHERE passport = ?', ['6999']);
        console.log('\n👤 Usuário 6999:');
        console.log(`  - Nome: ${user.name}`);
        console.log(`  - Role: ${user.role}`);
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro:', error);
        process.exit(1);
    }
}

addSuperAdmin();
