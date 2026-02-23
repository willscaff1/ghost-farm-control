// Script para corrigir delivery_items que tiveram extras somados indevidamente
// O bug antigo somava os materiais dos farm extras nos delivery_items quando aprovava
// Este script identifica e corrige esses casos

const { getAll, runQuery } = require('./database/db');

async function fixExtraSums() {
    console.log('🔍 Procurando deliveries com extras somados indevidamente...\n');
    
    try {
        // Buscar todos os farm extras aprovados
        const extrasApproved = await getAll(`
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
            const currentItems = await getAll(`
                SELECT di.*, m.name as material_name
                FROM delivery_items di
                JOIN materials m ON m.id = di.material_id
                WHERE di.delivery_id = ?
            `, [extra.delivery_id]);
            
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
                    
                    // Se o valor atual for maior que o extra, pode ter sido somado
                    if (currentAmount >= extraAmount) {
                        const originalAmount = currentAmount - extraAmount;
                        
                        console.log(`   🔧 CORRIGIR: ${currentItem.material_name}: ${currentAmount} - ${extraAmount} = ${originalAmount}`);
                        
                        // CORRIGIR!
                        await runQuery(`
                            UPDATE delivery_items 
                            SET amount = ? 
                            WHERE delivery_id = ? AND material_id = ?
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
        process.exit(0);
    }
}

fixExtraSums();
