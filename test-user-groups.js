const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'database', 'ghosts.db'));

console.log('🔍 Verificando estrutura das tabelas...\n');

// Primeiro, verificar schema das tabelas
db.all(`SELECT sql FROM sqlite_master WHERE type='table' AND name IN ('users', 'user_groups')`, (err, tables) => {
    if (err) {
        console.error('Erro ao verificar schema:', err);
        db.close();
        return;
    }

    console.log('📊 Schema das tabelas:');
    tables.forEach(t => console.log(t.sql));
    console.log('\n' + '━'.repeat(80) + '\n');

    // Agora verificar os usuários e seus grupos
    db.all(`
        SELECT 
            u.id, 
            u.passport, 
            u.name,
            u.role as legacy_role,
            GROUP_CONCAT(ug.group_name) as groups
        FROM users u
        LEFT JOIN user_groups ug ON u.id = ug.user_id
        GROUP BY u.id
        ORDER BY u.id
    `, (err2, users) => {
        if (err2) {
            console.error('Erro ao buscar usuários:', err2);
            db.close();
            return;
        }

        console.log('🔍 Verificando usuários e seus grupos...\n');
        console.log('━'.repeat(80));
        users.forEach(user => {
            console.log(`👤 ${user.name} (${user.passport})`);
            console.log(`   ID: ${user.id}`);
            console.log(`   Role Legado: ${user.legacy_role}`);
            console.log(`   Grupos: ${user.groups || 'nenhum'}`);
            
            // Verificar se seria detectado como admin
            const groups = user.groups ? user.groups.split(',') : [];
            const nonMemberGroups = groups.filter(g => g !== 'member');
            const hasAdminGroups = nonMemberGroups.length > 0;
            const hasAdminRole = groups.some(group => 
                group.includes('gerente') || 
                group.includes('admin') ||
                group === '01' || 
                group === '02' ||
                group === 'super_admin'
            );
            
            // Fallback para role legado se não tiver grupos
            const legacyAccess = !user.groups && user.legacy_role !== 'member' && user.legacy_role !== null;
            
            const hasAdminAccess = hasAdminGroups || hasAdminRole || legacyAccess;
            
            console.log(`   🔐 Teria acesso admin? ${hasAdminAccess ? '✅ SIM' : '❌ NÃO'}`);
            if (legacyAccess) {
                console.log(`      (via role legado: ${user.legacy_role})`);
            }
            console.log('━'.repeat(80));
        });

        db.close();
    });
});
