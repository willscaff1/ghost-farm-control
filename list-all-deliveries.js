const db = require('./database/db');

async function listAll() {
    await db.initialize();
    
    const all = await db.getAll('SELECT * FROM deliveries WHERE user_id = 1 ORDER BY week_start DESC');
    
    console.log('\n=== TODAS ENTREGAS USUÁRIO 1 ===');
    if (all.length === 0) {
        console.log('NENHUMA ENTREGA');
    } else {
        all.forEach(d => {
            console.log(`\nID: ${d.id}`);
            console.log(`Status: ${d.status}`);
            console.log(`Parcial: ${d.is_partial}`);
            console.log(`Semana: ${d.week_start} - ${d.week_end}`);
            console.log(`Criado: ${d.created_at}`);
        });
    }
    
    process.exit(0);
}

listAll().catch(err => {
    console.error('Erro:', err);
    process.exit(1);
});
