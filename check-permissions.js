const { getAll } = require('./database/db');

async function checkPermissions() {
    try {
        console.log('🔐 Verificando permissões...\n');
        
        const roles = await getAll('SELECT * FROM role_permissions');
        
        roles.forEach(role => {
            console.log(`\n📋 ${role.display_name} (${role.role_name})`);
            console.log(`   Ativo: ${role.active ? '✅' : '❌'}`);
            console.log(`   Pode config: ${role.can_config ? '✅' : '❌'}`);
            const perms = JSON.parse(role.permissions || '[]');
            console.log(`   Permissões: ${perms.join(', ')}`);
            console.log(`   Tem 'competitions': ${perms.includes('competitions') ? '✅' : '❌'}`);
            console.log(`   Tem 'all': ${perms.includes('all') ? '✅' : '❌'}`);
        });
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro:', error);
        process.exit(1);
    }
}

checkPermissions();
