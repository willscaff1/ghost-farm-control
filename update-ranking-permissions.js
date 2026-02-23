const db = require('./database/db');

async function updateRankingPermissions() {
    try {
        console.log('📋 Atualizando permissões do ranking semanal...\n');
        
        // Grupos que DEVEM ter acesso ao weekly-ranking
        const groupsWithAccess = ['super_admin', 'gerente_geral', '01', '02'];
        
        // Buscar todas as permissões atuais
        const roles = await db.getAll('SELECT * FROM role_permissions');
        
        for (const role of roles) {
            const permissions = JSON.parse(role.permissions || '[]');
            const hasWeeklyRanking = permissions.includes('weekly-ranking');
            const shouldHaveAccess = groupsWithAccess.includes(role.role_name);
            
            if (shouldHaveAccess && !hasWeeklyRanking) {
                // Adicionar permissão
                permissions.push('weekly-ranking');
                await db.runQuery(
                    'UPDATE role_permissions SET permissions = ? WHERE role_name = ?',
                    [JSON.stringify(permissions), role.role_name]
                );
                console.log(`✅ ${role.display_name}: ADICIONADO weekly-ranking`);
            } else if (!shouldHaveAccess && hasWeeklyRanking) {
                // Remover permissão
                const newPermissions = permissions.filter(p => p !== 'weekly-ranking');
                await db.runQuery(
                    'UPDATE role_permissions SET permissions = ? WHERE role_name = ?',
                    [JSON.stringify(newPermissions), role.role_name]
                );
                console.log(`❌ ${role.display_name}: REMOVIDO weekly-ranking`);
            } else if (shouldHaveAccess && hasWeeklyRanking) {
                console.log(`✓  ${role.display_name}: já tem acesso`);
            } else {
                console.log(`-  ${role.display_name}: sem acesso (correto)`);
            }
        }
        
        console.log('\n✅ Permissões atualizadas com sucesso!');
        console.log('\nGrupos com acesso ao Ranking Semanal:');
        console.log('  - Super Admin');
        console.log('  - Gerente Geral');
        console.log('  - 01 (Primeiro Líder)');
        console.log('  - 02 (Segundo Líder)');
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro:', error);
        process.exit(1);
    }
}

updateRankingPermissions();
