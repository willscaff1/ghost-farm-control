// Simular a data de hoje como 26/01/2026 (segunda-feira)
const today = new Date('2026-01-26');
console.log('📅 Hoje:', today.toLocaleDateString('pt-BR'), '- Dia da semana:', today.getDay(), '(0=dom, 1=seg)');

function getWeekStartDate(offset = 0) {
    const now = new Date('2026-01-26'); // Fixar para teste
    const dayOfWeek = now.getDay();
    
    const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    
    const monday = new Date(now);
    monday.setDate(now.getDate() + daysToMonday + (offset * 7));
    monday.setHours(0, 0, 0, 0);
    
    return formatDateISO(monday);
}

function formatDateISO(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatWeekLabel(weekStart) {
    const monday = new Date(weekStart);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    
    return `${monday.toLocaleDateString('pt-BR')} até ${sunday.toLocaleDateString('pt-BR')}`;
}

console.log('\n📊 Testando cálculo de semanas:');
for (let i = -2; i <= 2; i++) {
    const week = getWeekStartDate(i);
    const label = formatWeekLabel(week);
    console.log(`Offset ${i}: ${week} -> ${label}${i===0?' (Esta semana)':''}`);
}
