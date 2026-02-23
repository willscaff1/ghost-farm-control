const { getOne, getAll } = require('./database/db');

async function checkDelivery13() {
    try {
        const delivery = await getOne('SELECT * FROM deliveries WHERE id = 13');
        console.log('\n📦 Delivery 13:');
        console.log(delivery);
        
        const items = await getAll('SELECT di.*, m.name, m.weekly_goal FROM delivery_items di JOIN materials m ON di.material_id = m.id WHERE di.delivery_id = 13');
        console.log('\n📦 Items do delivery 13:');
        console.log(items);
        
        const screenshots = await getAll('SELECT id, LEFT(screenshot_url, 50) as preview FROM delivery_screenshots WHERE delivery_id = 13');
        console.log('\n📸 Screenshots:');
        console.log(screenshots);
        
        // Ver se está completo
        console.log('\n✅ Verificando completude:');
        let isComplete = true;
        for (const item of items) {
            const complete = item.amount >= (item.weekly_goal || 700);
            console.log(`  ${item.name}: ${item.amount}/${item.weekly_goal || 700} - ${complete ? '✅' : '❌'}`);
            if (!complete) isComplete = false;
        }
        
        console.log('\n🎯 Farm completo?', isComplete ? '✅ SIM' : '❌ NÃO');
        console.log('📊 Status atual:', delivery.status);
        console.log('📊 Deveria estar:', isComplete ? 'pending' : 'in_progress');
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro:', error);
        process.exit(1);
    }
}

checkDelivery13();
