const db = require('./database/db');

async function check() {
    try {
        // Buscar todas as entregas recentes (últimos 7 dias)
        const allDeliveries = await db.getAll(`
            SELECT d.*, u.name, u.passport, d.created_at
            FROM deliveries d
            JOIN users u ON d.user_id = u.id
            ORDER BY d.created_at DESC
            LIMIT 20
        `);
        
        console.log('\n📦 Últimas 20 entregas:');
        allDeliveries.forEach(d => {
            console.log(`- ${d.name} (${d.passport}) | Semana: ${d.week_start} | Status: ${d.status} | Criada: ${d.created_at}`);
        });
        
        // Buscar entregas da semana 26/01
        const weekDeliveries = await db.getAll(`
            SELECT d.*, u.name, u.passport
            FROM deliveries d
            JOIN users u ON d.user_id = u.id
            WHERE d.week_start = '2026-01-26'
        `);
        
        console.log('\n📅 Entregas da semana 26/01/2026:');
        console.log('Total:', weekDeliveries.length);
        weekDeliveries.forEach(d => {
            console.log(`- ${d.name} (${d.passport}) | Status: ${d.status}`);
        });
        
        // Buscar entregas aprovadas da semana 26/01
        const approved = await db.getAll(`
            SELECT d.*, u.name, u.passport
            FROM deliveries d
            JOIN users u ON d.user_id = u.id
            WHERE d.week_start = '2026-01-26' AND d.status = 'approved'
        `);
        
        console.log('\n✅ Entregas APROVADAS da semana 26/01/2026:');
        console.log('Total:', approved.length);
        approved.forEach(d => {
            console.log(`- ${d.name} (${d.passport})`);
        });
        
        process.exit(0);
    } catch (error) {
        console.error('Erro:', error);
        process.exit(1);
    }
}

check();
