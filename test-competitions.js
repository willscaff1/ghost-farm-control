const { getAll } = require('./database/db');

async function testCompetitions() {
    try {
        console.log('\n🏆 Testando sistema de competições...\n');
        
        // Buscar competições
        const competitions = await getAll('SELECT * FROM competitions ORDER BY created_at DESC');
        
        console.log(`📊 Total de competições: ${competitions.length}`);
        console.log('\n📋 Lista de competições:');
        
        competitions.forEach((comp, index) => {
            console.log(`\n${index + 1}. ${comp.name}`);
            console.log(`   ID: ${comp.id}`);
            console.log(`   Início: ${comp.start_date}`);
            console.log(`   Fim: ${comp.end_date}`);
            console.log(`   Status: ${comp.active ? '✅ ATIVA' : '❌ Inativa'}`);
            console.log(`   Criada em: ${comp.created_at}`);
        });
        
        // Buscar competição ativa
        const now = new Date().toISOString();
        const activeComp = await getAll(`
            SELECT * FROM competitions 
            WHERE active = 1 
            AND datetime(start_date) <= datetime(?) 
            AND datetime(end_date) >= datetime(?)
        `, [now, now]);
        
        console.log(`\n🎯 Competições ativas agora: ${activeComp.length}`);
        if (activeComp.length > 0) {
            activeComp.forEach(comp => {
                console.log(`   - ${comp.name} (ID: ${comp.id})`);
            });
        }
        
        // Buscar entradas de competição
        const entries = await getAll('SELECT * FROM competition_entries');
        console.log(`\n📝 Total de entradas: ${entries.length}`);
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro:', error);
        process.exit(1);
    }
}

testCompetitions();
