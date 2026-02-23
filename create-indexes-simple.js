// Script simples para criar índices
// Execute com: node create-indexes-simple.js

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    console.log('❌ DATABASE_URL não definida');
    console.log('   set DATABASE_URL=postgres://...');
    process.exit(1);
}

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 1,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_deliveries_week ON deliveries (week_start, week_end)',
    'CREATE INDEX IF NOT EXISTS idx_deliveries_user_week ON deliveries (user_id, week_start, week_end)',
    'CREATE INDEX IF NOT EXISTS idx_deliveries_status ON deliveries (status)',
    'CREATE INDEX IF NOT EXISTS idx_delivery_items_delivery ON delivery_items (delivery_id)',
    'CREATE INDEX IF NOT EXISTS idx_justifications_week ON justifications (week_start, week_end)',
    'CREATE INDEX IF NOT EXISTS idx_warnings_week ON warnings (week_start, week_end)',
    'CREATE INDEX IF NOT EXISTS idx_extra_farm_delivery ON extra_farm_requests (delivery_id)',
    'CREATE INDEX IF NOT EXISTS idx_users_active ON users (active)',
];

async function run() {
    console.log('🚀 Conectando ao banco...');
    
    try {
        const client = await pool.connect();
        console.log('✅ Conectado!\n');
        
        for (const sql of indexes) {
            const name = sql.match(/idx_\w+/)[0];
            try {
                await client.query(sql);
                console.log(`✅ ${name}`);
            } catch (e) {
                console.log(`❌ ${name}: ${e.message}`);
            }
        }
        
        console.log('\n🔄 Executando ANALYZE...');
        await client.query('ANALYZE');
        console.log('✅ ANALYZE OK');
        
        client.release();
        await pool.end();
        console.log('\n🎉 Pronto!');
    } catch (e) {
        console.error('❌ Erro:', e.message);
    }
}

run();
