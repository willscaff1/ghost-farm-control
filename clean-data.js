const db = require('./database/db');

async function cleanData() {
    const { runQuery, getAll } = await db;
    
    console.log('🧹 Limpando dados de entregas...');
    
    try {
        await runQuery('DELETE FROM delivery_screenshots');
        console.log('  ✓ delivery_screenshots limpo');
    } catch (e) { console.log('  - delivery_screenshots não existe'); }
    
    try {
        await runQuery('DELETE FROM delivery_items');
        console.log('  ✓ delivery_items limpo');
    } catch (e) { console.log('  - delivery_items não existe'); }
    
    try {
        await runQuery('DELETE FROM deliveries');
        console.log('  ✓ deliveries limpo');
    } catch (e) { console.log('  - deliveries não existe'); }
    
    try {
        await runQuery('DELETE FROM justifications');
        console.log('  ✓ justifications limpo');
    } catch (e) { console.log('  - justifications não existe'); }
    
    try {
        await runQuery('DELETE FROM warnings');
        console.log('  ✓ warnings limpo');
    } catch (e) { console.log('  - warnings não existe'); }
    
    try {
        await runQuery('DELETE FROM edit_permissions');
        console.log('  ✓ edit_permissions limpo');
    } catch (e) { console.log('  - edit_permissions não existe'); }
    
    console.log('\n✅ Dados de entregas limpos! Usuários mantidos.');
    process.exit(0);
}

cleanData();
