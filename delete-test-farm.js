const { getOne, runQuery, getAll } = require('./database/db');

async function deleteTestFarm() {
    try {
        console.log('🗑️  Buscando último farm do teste...');
        
        // Buscar o delivery mais recente de qualquer usuário (ou específico se passar ID)
        const latestDelivery = await getOne(`
            SELECT * FROM deliveries 
            ORDER BY created_at DESC 
            LIMIT 1
        `);
        
        if (!latestDelivery) {
            console.log('❌ Nenhum farm encontrado para deletar');
            process.exit(0);
        }
        
        console.log(`\n📋 Farm encontrado:`);
        console.log(`   ID: ${latestDelivery.id}`);
        console.log(`   User ID: ${latestDelivery.user_id}`);
        console.log(`   Semana: ${latestDelivery.week_start} até ${latestDelivery.week_end}`);
        console.log(`   Status: ${latestDelivery.status}`);
        console.log(`   Criado em: ${latestDelivery.created_at}`);
        console.log(`   Parcial: ${latestDelivery.is_partial}`);
        
        // Deletar screenshots associados
        const screenshots = await getAll('SELECT id FROM delivery_screenshots WHERE delivery_id = ?', [latestDelivery.id]);
        if (screenshots && screenshots.length > 0) {
            console.log(`\n🖼️  Deletando ${screenshots.length} screenshot(s)...`);
            await runQuery('DELETE FROM delivery_screenshots WHERE delivery_id = ?', [latestDelivery.id]);
        }
        
        // Deletar itens associados
        const items = await getAll('SELECT id FROM delivery_items WHERE delivery_id = ?', [latestDelivery.id]);
        if (items && items.length > 0) {
            console.log(`📦 Deletando ${items.length} item(s) de material...`);
            await runQuery('DELETE FROM delivery_items WHERE delivery_id = ?', [latestDelivery.id]);
        }
        
        // Deletar farm extras associados
        const extras = await getAll('SELECT id FROM extra_farm_requests WHERE delivery_id = ?', [latestDelivery.id]);
        if (extras && extras.length > 0) {
            console.log(`🏆 Deletando ${extras.length} farm(s) extra(s)...`);
            for (const extra of extras) {
                await runQuery('DELETE FROM extra_farm_screenshots WHERE extra_farm_id = ?', [extra.id]);
            }
            await runQuery('DELETE FROM extra_farm_requests WHERE delivery_id = ?', [latestDelivery.id]);
        }
        
        // Deletar o delivery
        console.log(`\n🗑️  Deletando farm ID ${latestDelivery.id}...`);
        await runQuery('DELETE FROM deliveries WHERE id = ?', [latestDelivery.id]);
        
        console.log(`\n✅ Farm deletado com sucesso!`);
        console.log(`\n👉 O membro pode retittar agora. Atualize o painel para validar.`);
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro ao deletar farm:', error);
        process.exit(1);
    }
}

deleteTestFarm();
