const { runQuery, getAll } = require('./database/db');

async function addCompetitionsPermission() {
    try {
        console.log('🏆 Adicionando permissão "competitions" aos grupos...\n');
        
        const roles = await getAll('SELECT * FROM role_permissions WHERE role_name != "member"');
        
        for (const role of roles) {
            let perms = JSON.parse(role.permissions || '[]');
            
            // Se já tem 'all', não precisa adicionar
            if (perms.includes('all')) {
                console.log(`✅ ${role.display_name}: Já tem permissão 'all'`);
                continue;
            }
            
            // Se já tem 'competitions', pular
            if (perms.includes('competitions')) {
                console.log(`✅ ${role.display_name}: Já tem 'competitions'`);
                continue;
            }
            
            // Adicionar 'competitions'
            perms.push('competitions');
            
            await runQuery(
                'UPDATE role_permissions SET permissions = ? WHERE id = ?',
                [JSON.stringify(perms), role.id]
            );
            
            console.log(`✅ ${role.display_name}: Adicionado 'competitions'`);
        }
        
        console.log('\n✅ Permissões atualizadas!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro:', error);
        process.exit(1);
    }
}

addCompetitionsPermission();
