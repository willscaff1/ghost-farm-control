// Script para adicionar índices ao banco de dados PostgreSQL
// Isso vai melhorar MUITO a performance das queries

const { Client } = require('pg');

// Usar DATABASE_URL diretamente ou definir aqui
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    console.log('❌ DATABASE_URL não definida. Defina a variável de ambiente.');
    console.log('   Exemplo: set DATABASE_URL=postgres://...');
    process.exit(1);
}

async function createClient() {
    const client = new Client({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 30000,
        query_timeout: 60000,
    });
    await client.connect();
    return client;
}

async function runQuery(sql) {
    const client = await createClient();
    try {
        await client.query(sql);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    } finally {
        await client.end();
    }
}

async function addIndexes() {
    console.log('🚀 Adicionando índices para melhorar performance...\n');
    console.log('⏳ Cada índice será criado com uma nova conexão...\n');
    
    const indexes = [
        // Tabela users
        { name: 'idx_users_passport', table: 'users', columns: 'passport' },
        { name: 'idx_users_role', table: 'users', columns: 'role' },
        { name: 'idx_users_active', table: 'users', columns: 'active' },
        
        // Tabela deliveries - mais acessada
        { name: 'idx_deliveries_user_id', table: 'deliveries', columns: 'user_id' },
        { name: 'idx_deliveries_status', table: 'deliveries', columns: 'status' },
        { name: 'idx_deliveries_week', table: 'deliveries', columns: 'week_start, week_end' },
        { name: 'idx_deliveries_user_week', table: 'deliveries', columns: 'user_id, week_start, week_end' },
        { name: 'idx_deliveries_created', table: 'deliveries', columns: 'created_at DESC' },
        
        // Tabela delivery_items
        { name: 'idx_delivery_items_delivery', table: 'delivery_items', columns: 'delivery_id' },
        { name: 'idx_delivery_items_material', table: 'delivery_items', columns: 'material_id' },
        
        // Tabela delivery_screenshots
        { name: 'idx_delivery_screenshots_delivery', table: 'delivery_screenshots', columns: 'delivery_id' },
        
        // Tabela justifications
        { name: 'idx_justifications_user', table: 'justifications', columns: 'user_id' },
        { name: 'idx_justifications_status', table: 'justifications', columns: 'status' },
        { name: 'idx_justifications_week', table: 'justifications', columns: 'week_start, week_end' },
        { name: 'idx_justifications_user_week', table: 'justifications', columns: 'user_id, week_start, week_end' },
        
        // Tabela warnings
        { name: 'idx_warnings_user', table: 'warnings', columns: 'user_id' },
        { name: 'idx_warnings_week', table: 'warnings', columns: 'week_start, week_end' },
        
        // Tabela extra_farm_requests
        { name: 'idx_extra_farm_delivery', table: 'extra_farm_requests', columns: 'delivery_id' },
        { name: 'idx_extra_farm_user', table: 'extra_farm_requests', columns: 'user_id' },
        { name: 'idx_extra_farm_status', table: 'extra_farm_requests', columns: 'status' },
        
        // Tabela extra_farm_screenshots
        { name: 'idx_extra_screenshots_farm', table: 'extra_farm_screenshots', columns: 'extra_farm_id' },
        
        // Tabela materials
        { name: 'idx_materials_active', table: 'materials', columns: 'active' },
        
        // Tabela user_groups
        { name: 'idx_user_groups_user', table: 'user_groups', columns: 'user_id' },
        { name: 'idx_user_groups_group', table: 'user_groups', columns: 'group_name' },
        
        // Tabela farm_whitelist
        { name: 'idx_whitelist_user', table: 'farm_whitelist', columns: 'user_id' },
    ];
    
    let created = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const idx of indexes) {
        const sql = `CREATE INDEX IF NOT EXISTS ${idx.name} ON ${idx.table} (${idx.columns})`;
        const result = await runQuery(sql);
        
        if (result.success) {
            console.log(`✅ ${idx.name}`);
            created++;
        } else if (result.error.includes('already exists')) {
            console.log(`⏭️  ${idx.name} (já existe)`);
            skipped++;
        } else if (result.error.includes('does not exist')) {
            console.log(`⚠️  ${idx.name} (tabela não existe)`);
            skipped++;
        } else {
            console.log(`❌ ${idx.name}: ${result.error}`);
            errors++;
        }
        
        // Pequena pausa entre queries para não sobrecarregar
        await new Promise(r => setTimeout(r, 500));
    }
    
    console.log(`\n📊 Resultado:`);
    console.log(`   ✅ Criados: ${created}`);
    console.log(`   ⏭️  Já existiam/pulados: ${skipped}`);
    console.log(`   ❌ Erros: ${errors}`);
    
    // Executar ANALYZE para atualizar estatísticas
    console.log('\n🔄 Executando ANALYZE para atualizar estatísticas...');
    const analyzeResult = await runQuery('ANALYZE');
    if (analyzeResult.success) {
        console.log('✅ ANALYZE concluído!');
    } else {
        console.log('⚠️ ANALYZE falhou:', analyzeResult.error);
    }
    
    console.log('\n🎉 Pronto! O banco de dados deve estar mais rápido agora.');
}

addIndexes().catch(console.error);
