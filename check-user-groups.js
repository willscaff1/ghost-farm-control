const db = require('./database/db');

async function checkUserGroups() {
    try {
        console.log('🔍 Verificando grupos de usuários...\n');
        
        // Buscar todos os usuários e seus grupos
        const users = await db.getAll(`
            SELECT u.id, u.name, u.passport, u.role
            FROM users u
            ORDER BY u.name
        `);
        
        for (const user of users) {
            const groups = await db.getAll(
                'SELECT group_name FROM user_groups WHERE user_id = ? ORDER BY group_name',
                [user.id]
            );
            
            const groupNames = groups.map(g => g.group_name).join(', ');
            console.log(`👤 ${user.name} (ID: ${user.id}, Passaporte: ${user.passport})`);
            console.log(`   Role antigo: ${user.role}`);
            console.log(`   Grupos atuais: ${groupNames || 'NENHUM'}`);
            console.log('');
        }
        
        // Verificar especificamente o Eduardo
        const eduardo = await db.getOne(
            "SELECT id, name, passport, role FROM users WHERE name LIKE '%Eduardo%' OR name LIKE '%Bartoski%'",
            []
        );
        
        if (eduardo) {
            console.log('\n🎯 Verificação detalhada do Eduardo:');
            console.log('ID:', eduardo.id);
            console.log('Nome:', eduardo.name);
            console.log('Passaporte:', eduardo.passport);
            console.log('Role antigo:', eduardo.role);
            
            const eduardoGroups = await db.getAll(
                'SELECT group_name, created_at FROM user_groups WHERE user_id = ?',
                [eduardo.id]
            );
            
            console.log('Grupos:', eduardoGroups.length > 0 ? JSON.stringify(eduardoGroups, null, 2) : 'NENHUM');
        }
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro:', error);
        process.exit(1);
    }
}

checkUserGroups();
