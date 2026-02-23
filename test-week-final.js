// Teste final do cálculo de semana - Frontend vs Backend

// ============ BACKEND (db.js) ============
function getCurrentWeekBackend() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    
    const dayOfWeek = now.getDay();
    const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    
    const monday = new Date(now);
    monday.setDate(now.getDate() - daysFromMonday);
    monday.setHours(0, 0, 0, 0);
    
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    
    const formatDate = (date) => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };
    
    return {
        start: formatDate(monday),
        end: formatDate(sunday)
    };
}

// ============ FRONTEND (admin.js) - CORRIGIDO ============
function getWeekStartDateFrontend(offset = 0) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    
    const dayOfWeek = now.getDay();
    const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    
    const monday = new Date(now);
    monday.setDate(now.getDate() - daysFromMonday + (offset * 7));
    monday.setHours(0, 0, 0, 0);
    
    const year = monday.getFullYear();
    const month = String(monday.getMonth() + 1).padStart(2, '0');
    const day = String(monday.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// ============ TESTE ============
console.log('📅 Hoje:', new Date().toLocaleDateString('pt-BR'), '- Dia da semana:', new Date().getDay());
console.log('');

const backend = getCurrentWeekBackend();
console.log('🔧 BACKEND getCurrentWeek():');
console.log('   start:', backend.start);
console.log('   end:', backend.end);
console.log('');

const frontend = getWeekStartDateFrontend(0);
console.log('🖥️ FRONTEND getWeekStartDate(0):');
console.log('   start:', frontend);
console.log('');

if (backend.start === frontend) {
    console.log('✅ MATCH! Backend e Frontend calculam a mesma semana');
} else {
    console.log('❌ ERRO! Datas diferentes:');
    console.log('   Backend:', backend.start);
    console.log('   Frontend:', frontend);
}
