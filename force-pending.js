const { runQuery, getOne } = require('./database/db');

async function forceDeliveryPending() {
    try {
        console.log('🔧 Forçando delivery 13 para pending...');
        
        await runQuery('UPDATE deliveries SET status = ?, is_partial = 0 WHERE id = 13', ['pending']);
        
        const delivery = await getOne('SELECT * FROM deliveries WHERE id = 13');
        console.log('✅ Atualizado!');
        console.log('   Status:', delivery.status);
        console.log('   Parcial:', delivery.is_partial);
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro:', error);
        process.exit(1);
    }
}

forceDeliveryPending();
