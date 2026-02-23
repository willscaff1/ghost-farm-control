const db = require('./database/db');

async function testAPI() {
    await db.initialize();
    
    const userId = 1;
    const offset = 0;
    
    // Calcular semana
    const now = new Date();
    now.setDate(now.getDate() + (offset * 7));
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    monday.setHours(0, 0, 0, 0);
    
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    
    const weekStart = monday.toISOString().split('T')[0];
    const weekEnd = sunday.toISOString().split('T')[0];
    
    console.log('\n=== TESTE API RESPONSE ===');
    console.log('Usuário:', userId);
    console.log('Semana:', weekStart, '-', weekEnd);
    
    // Buscar entrega
    const delivery = await db.getOne(
        'SELECT * FROM deliveries WHERE user_id = ? AND week_start = ? AND week_end = ? AND status != ?',
        [userId, weekStart, weekEnd, 'rejected']
    );
    
    console.log('\n--- DELIVERY ---');
    if (delivery) {
        console.log('✅ TEM ENTREGA');
        console.log('Status:', delivery.status);
        console.log('Is Partial:', delivery.is_partial);
        console.log('ID:', delivery.id);
    } else {
        console.log('❌ SEM ENTREGA');
    }
    
    // Calcular canDeliver
    let canDeliver = true;
    let statusMessage = null;
    
    if (delivery) {
        if (delivery.status === 'approved' && !delivery.is_partial) {
            canDeliver = false;
            statusMessage = 'Farm completo aprovado!';
        } else if (delivery.status === 'pending' && !delivery.is_partial) {
            canDeliver = false;
            statusMessage = '⏳ Farm enviado para aprovação';
        } else if (delivery.is_partial) {
            canDeliver = true;
            statusMessage = 'Farm em progresso';
        }
    }
    
    console.log('\n--- RESULTADO ---');
    console.log('canDeliver:', canDeliver);
    console.log('statusMessage:', statusMessage);
    console.log('hasDelivery:', !!delivery);
    console.log('deliveryStatus:', delivery ? delivery.status : null);
    
    process.exit(0);
}

testAPI().catch(err => {
    console.error('Erro:', err);
    process.exit(1);
});
