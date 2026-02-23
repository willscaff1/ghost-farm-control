const { getAll } = require('./database/db');

async function checkTables() {
    try {
        const tables = await getAll("SELECT name FROM sqlite_master WHERE type='table'");
        console.log('📋 Tabelas no banco:');
        tables.forEach(t => console.log('  -', t.name));
        
        // Verificar se competitions existe
        const hasCompetitions = tables.some(t => t.name === 'competitions');
        console.log('\n🏆 Tabela competitions existe?', hasCompetitions ? '✅ SIM' : '❌ NÃO');
        
        // Verificar deliveries
        const deliveries = await getAll("SELECT id, user_id, status, week_start FROM deliveries LIMIT 5");
        console.log('\n📦 Últimas deliveries:');
        console.log(deliveries);
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro:', error);
        process.exit(1);
    }
}

checkTables();
