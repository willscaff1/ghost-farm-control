const db = require('./database/db');

async function checkDelivery() {
    await db.initialize();
    
    const userId = 1; // Willian
    const weekStart = '2026-01-26';
    
    const delivery = await db.getOne(
        'SELECT * FROM deliveries WHERE user_id = ? AND week_start = ?',
        [userId, weekStart]
    );
    
    console.log('\n=== ENTREGA DO USUÁRIO 1 (WILLIAN) ===');
    if (delivery) {
        console.log('ID:', delivery.id);
        console.log('Status:', delivery.status);
        console.log('Is Partial:', delivery.is_partial);
        console.log('Semana:', delivery.week_start, '-', delivery.week_end);
        console.log('Criado em:', delivery.created_at);
    } else {
        console.log('NENHUMA ENTREGA ENCONTRADA');
    }
    
    // Verificar permissão de edição
    const editPerm = await db.getOne('SELECT * FROM edit_permissions WHERE user_id = ?', [userId]);
    console.log('\nPermissão de edição:', editPerm ? 'SIM' : 'NÃO');
    
    process.exit(0);
}

checkDelivery().catch(err => {
    console.error('Erro:', err);
    process.exit(1);
});
