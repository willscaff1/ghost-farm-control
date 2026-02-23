// Script para corrigir delivery_items no POSTGRESQL (Produção)
// Executar com: DATABASE_URL=... node fix-extra-sums-production.js

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    console.log('❌ DATABASE_URL não definida!');
    console.log('Execute com: DATABASE_URL="postgresql://..." node fix-extra-sums-production.js');
    process.exit(1);
}

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function fixExtraSums() {
    console.log('🐘 Conectando ao PostgreSQL...');
    console.log('🔍 Procurando deliveries com extras somados indevidamente...\n');
    
    const client = await pool.connect();
    
    try {
        // Buscar todos os farm extras aprovados
        const extrasResult = await client.query(`
            SELECT 
                ef.id,
                ef.delivery_id,
                ef.materials,
                ef.status,
                ef.reviewed_at,
                d.user_id,
                u.name as user_name
            FROM extra_farm_requests ef
            JOIN deliveries d ON d.id = ef.delivery_id
            JOIN users u ON u.id = d.user_id
            WHERE ef.status = 'approved'
            ORDER BY ef.reviewed_at DESC
        `);
        
        const extrasApproved = extrasResult.rows;
        console.log(`📊 Encontrados ${extrasApproved.length} farm extras aprovados\n`);
        
        let fixedCount = 0;
        
        for (const extra of extrasApproved) {
            console.log(`\n👤 ${extra.user_name} - Delivery #${extra.delivery_id}`);
            
            // Parse dos materiais do extra
            let extraMaterials;
            try {
                extraMaterials = typeof extra.materials === 'string' 
                    ? JSON.parse(extra.materials) 
                    : extra.materials;
            } catch (e) {
                console.log(`   ⚠️ Não foi possível parsear materiais do extra #${extra.id}`);
                continue;
            }
            
            if (!extraMaterials || !Array.isArray(extraMaterials)) {
                console.log(`   ⚠️ Materiais inválidos no extra #${extra.id}`);
                continue;
            }
            
            // Buscar delivery_items atuais
            const itemsResult = await client.query(`
                SELECT di.*, m.name as material_name
                FROM delivery_items di
                JOIN materials m ON m.id = di.material_id
                WHERE di.delivery_id = $1
            `, [extra.delivery_id]);
            
            const currentItems = itemsResult.rows;
            
            console.log('   📦 Materiais atuais na meta:');
            for (const item of currentItems) {
                console.log(`      - ${item.material_name}: ${item.amount}`);
            }
            
            console.log('   🏆 Materiais do extra:');
            for (const mat of extraMaterials) {
                console.log(`      - Material ${mat.material_id || mat.id}: ${mat.amount}`);
            }
            
            // Para cada material do extra, verificar se foi somado no delivery_item
            for (const extraMat of extraMaterials) {
                const materialId = extraMat.material_id || extraMat.id;
                const extraAmount = parseInt(extraMat.amount) || 0;
                
                const currentItem = currentItems.find(i => i.material_id == materialId);
                
                if (currentItem && extraAmount > 0) {
                    const currentAmount = parseInt(currentItem.amount) || 0;
                    
                    // Se o valor atual for maior que o extra, provavelmente foi somado
                    if (currentAmount >= extraAmount) {
                        const originalAmount = currentAmount - extraAmount;
                        
                        console.log(`   🔧 CORRIGINDO: ${currentItem.material_name}: ${currentAmount} - ${extraAmount} = ${originalAmount}`);
                        
                        // CORRIGIR!
                        await client.query(`
                            UPDATE delivery_items 
                            SET amount = $1 
                            WHERE delivery_id = $2 AND material_id = $3
                        `, [originalAmount, extra.delivery_id, materialId]);
                        
                        fixedCount++;
                    }
                }
            }
        }
        
        console.log(`\n\n✅ Correção concluída!`);
        console.log(`📊 ${fixedCount} valores corrigidos`);
        
    } catch (error) {
        console.error('❌ Erro:', error);
    } finally {
        client.release();
        await pool.end();
        process.exit(0);
    }
}

fixExtraSums();
