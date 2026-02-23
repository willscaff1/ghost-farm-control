const db = require('./database/db');

async function test() {
    try {
        // Buscar entregas da semana 2026-01-26
        const deliveries = await db.getAll(`
            SELECT d.*, u.name, u.passport 
            FROM deliveries d
            JOIN users u ON d.user_id = u.id
            WHERE d.week_start = '2026-01-26' 
            AND d.status = 'approved'
        `);
        
        console.log('\n📊 Entregas aprovadas na semana 26/01/2026:');
        console.log('Total:', deliveries.length);
        console.log(JSON.stringify(deliveries, null, 2));
        
        // Buscar todas as semanas disponíveis
        const weeks = await db.getAll(`
            SELECT DISTINCT week_start, status, COUNT(*) as count
            FROM deliveries 
            WHERE status = 'approved'
            GROUP BY week_start, status
            ORDER BY week_start DESC
            LIMIT 10
        `);
        
        console.log('\n📅 Semanas com entregas aprovadas:');
        console.log(weeks);
        
        process.exit(0);
    } catch (error) {
        console.error('Erro:', error);
        process.exit(1);
    }
}

test();
