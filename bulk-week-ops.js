/**
 * Operação em lote por semana (one-shot).
 *
 * 08/06–14/06: aprova TODAS as entregas (status=approved, is_partial=0).
 * 15/06–21/06: marca como não entregue (not_delivered) e ZERA quantidades,
 *              prints (inline + delivery_screenshots) e farms extras da semana.
 *
 * Uso:
 *   Simulação (não altera nada):  node bulk-week-ops.js
 *   Executar de verdade:          node bulk-week-ops.js --run
 *
 * No Railway:  railway run node bulk-week-ops.js --run
 */

const db = require('./database/db');
const { runQuery, getAll, getOne, pool, dbType } = db;

const APPROVE_WEEK = { start: '2026-06-08', end: '2026-06-14' };
const CLEAR_WEEK = { start: '2026-06-15', end: '2026-06-21' };

const DO_RUN = process.argv.includes('--run');

async function begin() {
    if (dbType === 'postgres') await pool.query('BEGIN');
}
async function commit() {
    if (dbType === 'postgres') await pool.query('COMMIT');
}
async function rollback() {
    if (dbType === 'postgres') { try { await pool.query('ROLLBACK'); } catch (e) {} }
}

async function main() {
    console.log('==============================================');
    console.log(`Banco: ${dbType}`);
    console.log(`Modo:  ${DO_RUN ? '*** EXECUÇÃO REAL (--run) ***' : 'SIMULAÇÃO (use --run para aplicar)'}`);
    console.log('==============================================\n');

    // ---------- Semana A: aprovar tudo ----------
    const approveTargets = await getAll(
        `SELECT id, user_id, status, is_partial FROM deliveries WHERE week_start = ? AND week_end = ?`,
        [APPROVE_WEEK.start, APPROVE_WEEK.end]
    );
    console.log(`[A] Semana ${APPROVE_WEEK.start} a ${APPROVE_WEEK.end} -> APROVAR`);
    console.log(`    Entregas encontradas: ${approveTargets.length}`);
    const notApproved = approveTargets.filter(d => d.status !== 'approved' || d.is_partial);
    console.log(`    Serão alteradas (não aprovadas/parciais): ${notApproved.length}\n`);

    // ---------- Semana B: zerar tudo ----------
    const clearTargets = await getAll(
        `SELECT id FROM deliveries WHERE week_start = ? AND week_end = ?`,
        [CLEAR_WEEK.start, CLEAR_WEEK.end]
    );
    const clearIds = clearTargets.map(d => d.id);
    console.log(`[B] Semana ${CLEAR_WEEK.start} a ${CLEAR_WEEK.end} -> NÃO ENTREGUE + ZERAR`);
    console.log(`    Entregas encontradas: ${clearTargets.length}`);

    let itemsCount = 0, shotsCount = 0, extraCount = 0;
    if (clearIds.length > 0) {
        const ph = clearIds.map(() => '?').join(',');
        itemsCount = (await getOne(`SELECT COUNT(*) AS c FROM delivery_items WHERE delivery_id IN (${ph})`, clearIds))?.c || 0;
        try { shotsCount = (await getOne(`SELECT COUNT(*) AS c FROM delivery_screenshots WHERE delivery_id IN (${ph})`, clearIds))?.c || 0; } catch (e) {}
        try { extraCount = (await getOne(`SELECT COUNT(*) AS c FROM extra_farm_requests WHERE delivery_id IN (${ph})`, clearIds))?.c || 0; } catch (e) {}
    }
    console.log(`    Itens (quantidades) a apagar: ${itemsCount}`);
    console.log(`    Prints (delivery_screenshots) a apagar: ${shotsCount}`);
    console.log(`    Farms extras a apagar: ${extraCount}\n`);

    if (!DO_RUN) {
        console.log('SIMULAÇÃO concluída. Nada foi alterado. Rode com --run para aplicar.');
        await closePool();
        return;
    }

    await begin();
    try {
        // ===== Semana A: aprovar =====
        const resA = await runQuery(
            `UPDATE deliveries SET status = 'approved', is_partial = 0, approved_at = CURRENT_TIMESTAMP
             WHERE week_start = ? AND week_end = ?`,
            [APPROVE_WEEK.start, APPROVE_WEEK.end]
        );
        console.log(`[A] Entregas aprovadas: ${resA?.changes ?? 'ok'}`);

        // ===== Semana B: zerar =====
        if (clearIds.length > 0) {
            const ph = clearIds.map(() => '?').join(',');

            // Farms extras (filhos primeiro)
            try {
                await runQuery(
                    `DELETE FROM extra_farm_screenshots WHERE extra_farm_id IN (
                        SELECT id FROM extra_farm_requests WHERE delivery_id IN (${ph})
                    )`, clearIds
                );
            } catch (e) { console.log('   (extra_farm_screenshots) ', e.message); }
            try {
                await runQuery(`DELETE FROM extra_farm_requests WHERE delivery_id IN (${ph})`, clearIds);
            } catch (e) { console.log('   (extra_farm_requests) ', e.message); }

            // Prints
            try {
                await runQuery(`DELETE FROM delivery_screenshots WHERE delivery_id IN (${ph})`, clearIds);
            } catch (e) { console.log('   (delivery_screenshots) ', e.message); }

            // Quantidades
            await runQuery(`DELETE FROM delivery_items WHERE delivery_id IN (${ph})`, clearIds);

            // Print inline + status + parcial + dinheiro
            await runQuery(
                `UPDATE deliveries
                 SET status = 'not_delivered', is_partial = 0, screenshot_url = NULL, dirty_money_amount = 0
                 WHERE id IN (${ph})`,
                clearIds
            );
            console.log(`[B] Entregas marcadas como não entregue e zeradas: ${clearIds.length}`);
        } else {
            console.log('[B] Nenhuma entrega nessa semana — nada a zerar.');
        }

        await commit();
        console.log('\n✅ Concluído com sucesso.');
    } catch (error) {
        await rollback();
        console.error('\n❌ Erro — alterações revertidas:', error.message);
        process.exitCode = 1;
    }

    await closePool();
}

async function closePool() {
    try {
        if (dbType === 'postgres') await pool.end();
        else pool.close();
    } catch (e) {}
}

main().catch(async (e) => {
    console.error('Erro fatal:', e);
    await closePool();
    process.exit(1);
});
