const bcrypt = require('bcryptjs');
const { runQuery, getOne } = require('./database/db');

async function createRootUser() {
    try {
        console.log('🔐 Criando usuário root do sistema...');
        
        // Verificar se já existe
        const existing = await getOne('SELECT id FROM users WHERE passport = ?', ['0']);
        if (existing) {
            console.log('⚠️ Usuário root já existe (ID:', existing.id, ')');
            return;
        }
        
        // Hash da senha P@ssw0rd123
        const passwordHash = await bcrypt.hash('P@ssw0rd123', 10);
        
        // Criar usuário root com passaporte 0
        const result = await runQuery(`
            INSERT INTO users (name, passport, password, role, active)
            VALUES (?, ?, ?, ?, ?)
        `, ['Admin', '0', passwordHash, 'super_admin', 1]);
        
        const userId = result.lastID;
        console.log('✅ Usuário root criado com ID:', userId);
        
        // Adicionar ao grupo super_admin
        await runQuery(`
            INSERT OR IGNORE INTO user_groups (user_id, group_name)
            VALUES (?, ?)
        `, [userId, 'super_admin']);
        
        console.log('✅ Usuário adicionado ao grupo super_admin');
        console.log('\n📋 Credenciais:');
        console.log('   Usuário: admin');
        console.log('   Senha: P@ssw0rd123');
        console.log('   Passaporte: 0');
        console.log('\n⚠️ Este usuário não aparece em listas operacionais, apenas em administração.');
        
    } catch (error) {
        console.error('❌ Erro ao criar usuário root:', error);
    }
    process.exit(0);
}

createRootUser();
