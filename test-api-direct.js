const db = require('./database/db');
const { getCurrentWeek } = require('./database/db');

async function testAPI() {
    try {
        // Testar getCurrentWeek
        const currentWeek = getCurrentWeek();
        console.log('📅 getCurrentWeek():', currentWeek);
        
        // Testar com a data 26/01/2026
        const weekStart = '2026-01-26';
        const weekEnd = '2026-02-01';
        
        console.log('\n🔍 Testando API com:', { weekStart, weekEnd });
        
        // Buscar entregas aprovadas
        const deliveries = await db.getAll(`
            SELECT d.*, u.name, u.passport
            FROM deliveries d
            JOIN users u ON d.user_id = u.id
            WHERE d.week_start = ? AND d.status = 'approved'
        `, [weekStart]);
        
        console.log('\n✅ Entregas aprovadas encontradas:', deliveries.length);
        
        for (const d of deliveries) {
            const items = await db.getAll(`
                SELECT di.amount, m.name as material_name
                FROM delivery_items di
                JOIN materials m ON di.material_id = m.id
                WHERE di.delivery_id = ?
            `, [d.id]);
            
            const totalMaterials = items.reduce((sum, item) => sum + item.amount, 0);
            
            console.log(`\n👤 ${d.name} (${d.passport})`);
            console.log('   Delivery ID:', d.id);
            console.log('   Items:', items);
            console.log('   Total Materiais:', totalMaterials);
        }
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro:', error);
        process.exit(1);
    }
}

testAPI();
