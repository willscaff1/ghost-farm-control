let currentUser = null;
let currentWeek = null;
let selectedWeekOffset = 0; // 0 = semana atual, +1 = próxima, +2 = próxima+1, etc
let selectedWeek = null;
let adminNotifications = [];
const adminRoles = ['01', '02', 'gerente_farm', 'gerente_acao', 'gerente_recrutamento', 'gerente_encomendas', 'gerente_geral'];

const roleNames = {
    'member': 'Membro',
    '01': '01 (Primeiro Líder)',
    '02': '02 (Segundo Líder)',
    'gerente_farm': 'Gerente de Farm',
    'gerente_acao': 'Gerente de Ação',
    'gerente_recrutamento': 'Gerente de Recrutamento',
    'gerente_encomendas': 'Gerente de Encomendas',
    'gerente_geral': 'Gerente Geral'
};

// Permissões por cargo - quais tabs cada cargo pode acessar
const rolePermissions = {
    // 01 e 02 - Acesso total EXCETO configurações
    '01': {
        tabs: ['weekly-status', 'members-panel', 'members-overview', 'pending', 'absences', 
               'members', 'members-adv', 'new-member', 'ranking', 'materials-stats', 
               'all-deliveries', 'weekly-report'],
        canConfig: false
    },
    '02': {
        tabs: ['weekly-status', 'members-panel', 'members-overview', 'pending', 'absences', 
               'members', 'members-adv', 'new-member', 'ranking', 'materials-stats', 
               'all-deliveries', 'weekly-report'],
        canConfig: false
    },
    // Gerente Geral - Acesso total
    'gerente_geral': {
        tabs: 'all',
        canConfig: true
    },
    // Gerente de Farm - Acesso específico para farm
    'gerente_farm': {
        tabs: ['weekly-status', 'members-panel', 'members-overview', 'pending', 'absences', 
               'members', 'members-adv', 'ranking', 'materials-stats', 'all-deliveries'],
        canConfig: false
    },
    // Demais gerentes - Acesso básico
    'gerente_acao': {
        tabs: ['weekly-status', 'members-panel', 'members-overview', 'members', 'members-adv',
               'ranking', 'materials-stats', 'all-deliveries', 'weekly-report'],
        canConfig: false
    },
    'gerente_recrutamento': {
        tabs: ['weekly-status', 'members-panel', 'members-overview', 'members', 'members-adv',
               'ranking', 'materials-stats', 'all-deliveries', 'weekly-report'],
        canConfig: false
    },
    'gerente_encomendas': {
        tabs: ['weekly-status', 'members-panel', 'members-overview', 'members', 'members-adv',
               'ranking', 'materials-stats', 'all-deliveries', 'weekly-report'],
        canConfig: false
    }
};

// Verificar se o usuário tem acesso a uma tab
function hasAccessToTab(tabId) {
    if (!currentUser) return false;
    const perms = rolePermissions[currentUser.role];
    if (!perms) return true; // Role não definido = acesso total (admin antigo)
    if (perms.tabs === 'all') return true;
    return perms.tabs.includes(tabId);
}

// Aplicar permissões na sidebar - ocultar tabs não permitidas
function applyRolePermissions() {
    if (!currentUser) return;
    
    const perms = rolePermissions[currentUser.role];
    if (!perms) return; // Role não definido = admin antigo, não esconder nada
    
    // Ocultar/mostrar tabs baseado nas permissões
    document.querySelectorAll('.sidebar-item[data-tab]').forEach(item => {
        const tabId = item.dataset.tab;
        if (perms.tabs === 'all' || perms.tabs.includes(tabId)) {
            item.style.display = '';
        } else {
            item.style.display = 'none';
        }
    });
    
    // Ocultar seções da sidebar que estão completamente vazias
    document.querySelectorAll('.sidebar-section').forEach(section => {
        const title = section.querySelector('.sidebar-section-title');
        if (!title) return;
        
        // Verificar se é seção de configurações
        if (title.textContent.includes('Configurações') && !perms.canConfig) {
            section.style.display = 'none';
            return;
        }
        
        // Verificar se todos os itens da seção estão ocultos
        const items = section.querySelectorAll('.sidebar-item[data-tab]');
        const visibleItems = Array.from(items).filter(item => item.style.display !== 'none');
        
        if (visibleItems.length === 0) {
            section.style.display = 'none';
        } else {
            section.style.display = '';
        }
    });
    
    // Ocultar itens do dropdown do usuário se não tiver permissão
    const dropdownItems = document.querySelectorAll('.user-dropdown .dropdown-item');
    dropdownItems.forEach(item => {
        if (item.textContent.includes('Gerenciar Materiais') && !perms.canConfig) {
            item.style.display = 'none';
        }
        if (item.textContent.includes('Cadastrar Membro') && !perms.tabs.includes('new-member') && perms.tabs !== 'all') {
            item.style.display = 'none';
        }
    });
}

// Verifica autenticação e permissão de admin
async function checkAuth() {
    try {
        const response = await fetch('/api/auth/me');
        const data = await response.json();
        
        if (data.user && adminRoles.includes(data.user.role)) {
            currentUser = data.user;
            document.getElementById('userName').textContent = currentUser.name;
            document.getElementById('userRole').textContent = roleNames[currentUser.role] || currentUser.role;
            document.getElementById('userRole').className = 'role-badge-mini';
            
            // Dropdown info
            document.getElementById('dropdownUserName').textContent = currentUser.name;
            document.getElementById('dropdownUserRole').textContent = roleNames[currentUser.role] || currentUser.role;
            
            // Aplicar permissões baseadas no cargo
            applyRolePermissions();
            
            await loadSelectedWeek();
            loadAll();
            loadAdminNotifications(); // Carregar notificações
        } else {
            window.location.href = '/dashboard';
        }
    } catch (error) {
        window.location.href = '/';
    }
}

// Toggle User Dropdown
function toggleUserDropdown() {
    const dropdown = document.getElementById('userDropdown');
    const container = document.querySelector('.user-dropdown-container');
    dropdown.classList.toggle('show');
    container.classList.toggle('open');
}

// Fechar User Dropdown
function closeUserDropdown() {
    const dropdown = document.getElementById('userDropdown');
    const container = document.querySelector('.user-dropdown-container');
    dropdown.classList.remove('show');
    container.classList.remove('open');
}

// Mostrar Tab específica (para uso no dropdown)
function showTab(tabId) {
    // Verificar permissão de acesso
    if (!hasAccessToTab(tabId)) {
        alert('Você não tem permissão para acessar esta área.');
        return;
    }
    
    document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    // Ativar o item da sidebar correspondente
    const sidebarItem = document.querySelector(`.sidebar-item[data-tab="${tabId}"]`);
    if (sidebarItem) sidebarItem.classList.add('active');
    
    // Mostrar a tab
    const tab = document.getElementById(`${tabId}-tab`);
    if (tab) tab.classList.add('active');
    
    // Carregar dados da tab
    switch (tabId) {
        case 'weekly-status': loadWeeklyStatus(); break;
        case 'members-panel': loadMembersPanel(); break;
        case 'members-overview': loadMembersOverview(); break;
        case 'absences': loadJustifications(); break;
        case 'pending': loadPendingDeliveries(); break;
        case 'members': loadMembers(); break;
        case 'new-member': break;
        case 'farm-settings': loadFarmSettings(); break;
        case 'manage-materials': loadMaterials(); break;
        case 'manage-payment-types': loadPaymentTypes(); break;
        case 'whitelist': loadWhitelist(); break;
        case 'edit-permissions': loadEditPermissions(); break;
        case 'ranking': loadRanking(); break;
        case 'all-deliveries': loadAllDeliveries(); break;
        case 'weekly-report': loadWeeklyReport(); break;
    }
}
// Carregar semana selecionada
async function loadSelectedWeek() {
    try {
        const response = await fetch(`/api/admin/week/${selectedWeekOffset}`);
        const data = await response.json();
        selectedWeek = data.week;
        
        let sidebarLabel;
        if (selectedWeekOffset === 0) {
            sidebarLabel = `${data.week.label} (Atual)`;
        } else if (selectedWeekOffset === 1) {
            sidebarLabel = `${data.week.label} (Próxima)`;
        } else {
            sidebarLabel = `${data.week.label} (+${selectedWeekOffset})`;
        }
        document.getElementById('selectedWeekLabel').textContent = sidebarLabel;
        
        // Atualizar também o label no conteúdo principal
        const currentWeekLabel = document.getElementById('currentWeekLabel');
        if (currentWeekLabel) {
            currentWeekLabel.textContent = data.week.label;
        }
        
        // Controlar visibilidade do botão anterior (não pode voltar antes da semana atual)
        const btnPrev = document.getElementById('btnPrevWeek');
        if (btnPrev) {
            btnPrev.style.visibility = selectedWeekOffset > 0 ? 'visible' : 'hidden';
        }
    } catch (error) {
        console.error('Erro ao carregar semana:', error);
    }
}

// Navegar entre semanas
function previousWeek() {
    if (selectedWeekOffset > 0) {
        selectedWeekOffset--;
        loadSelectedWeek().then(() => loadAll());
    }
}

function nextWeek() {
    selectedWeekOffset++;
    loadSelectedWeek().then(() => loadAll());
}

// Carregar todos os dados da semana
function loadAll() {
    loadAdminStats();
    loadWeeklyStatus();
    loadMembersOverview();
    loadPendingDeliveries();
    loadJustifications();
    loadRanking();
    loadMaterialsStats();
    loadAllDeliveries();
}

// Logout
async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/';
}

// Sidebar Items
document.querySelectorAll('.sidebar-item').forEach(item => {
    item.addEventListener('click', () => {
        document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        
        item.classList.add('active');
        const tabId = item.dataset.tab;
        document.getElementById(`${tabId}-tab`).classList.add('active');
        
        switch (tabId) {
            case 'weekly-status':
                loadWeeklyStatus();
                break;
            case 'members-panel':
                loadMembersPanel();
                break;
            case 'members-overview':
                loadMembersOverview();
                break;
            case 'absences':
                loadJustifications();
                break;
            case 'pending':
                loadPendingDeliveries();
                break;
            case 'farm-status':
                loadFarmStatus();
                break;
            case 'members':
                loadMembers();
                break;
            case 'new-member':
                // Nada a carregar, apenas mostrar o formulário
                break;
            case 'members-adv':
                loadMembersForAdv();
                break;
            case 'ranking':
                loadRanking();
                break;
            case 'materials-stats':
                loadMaterialsStats();
                break;
            case 'farm-settings':
                loadFarmSettings();
                break;
            case 'manage-materials':
                loadMaterials();
                break;
            case 'manage-payment-types':
                loadPaymentTypes();
                break;
            case 'all-deliveries':
                loadAllDeliveries();
                break;
            case 'weekly-report':
                loadWeeklyReport();
                break;
            case 'whitelist':
                loadWhitelist();
                loadMembersForWhitelist();
                break;
            case 'edit-permissions':
                loadEditPermissions();
                break;
        }
    });
});

// Carregar visão geral dos membros
async function loadMembersOverview() {
    try {
        const params = selectedWeek ? `?week_start=${selectedWeek.start}&week_end=${selectedWeek.end}` : '';
        const response = await fetch(`/api/admin/members-overview${params}`);
        const data = await response.json();
        
        const grid = document.getElementById('membersOverviewGrid');
        
        if (data.members && data.members.length > 0) {
            grid.innerHTML = data.members.map(member => {
                // Determinar ícone e classe do status do farm
                let farmIcon, farmText, farmClass;
                switch (member.farmStatus) {
                    case 'approved':
                        farmIcon = '✅';
                        farmText = 'Farm Pago';
                        farmClass = 'status-approved';
                        break;
                    case 'pending':
                        farmIcon = '⏳';
                        farmText = 'Aguardando';
                        farmClass = 'status-pending';
                        break;
                    case 'rejected':
                        farmIcon = '❌';
                        farmText = 'Rejeitado';
                        farmClass = 'status-rejected';
                        break;
                    case 'justified':
                        farmIcon = '📋';
                        farmText = 'Justificado';
                        farmClass = 'status-justified';
                        break;
                    case 'justification_pending':
                        farmIcon = '📝';
                        farmText = 'Just. Pendente';
                        farmClass = 'status-pending';
                        break;
                    default:
                        farmIcon = '❌';
                        farmText = 'Não Entregou';
                        farmClass = 'status-missing';
                }
                
                // Determinar classe das ADVs
                let advClass = 'adv-zero';
                if (member.warningsCount >= 3) advClass = 'adv-critical';
                else if (member.warningsCount >= 2) advClass = 'adv-high';
                else if (member.warningsCount >= 1) advClass = 'adv-warning';
                
                // Dados para os cliques
                const memberData = JSON.stringify({
                    id: member.id,
                    name: member.name,
                    farmStatus: member.farmStatus,
                    warningsCount: member.warningsCount
                }).replace(/"/g, '&quot;');
                
                return `
                    <div class="member-overview-card">
                        <div class="member-overview-header">
                            <span class="member-overview-name">👤 ${member.name}</span>
                            <span class="member-overview-role">${roleNames[member.role] || member.role}</span>
                        </div>
                        <div class="member-overview-stats">
                            <div class="overview-stat ${farmClass} clickable-stat" onclick="showMemberFarmDetails(${member.id}, '${member.name.replace(/'/g, "\\'")}')">
                                <span class="overview-icon">${farmIcon}</span>
                                <span class="overview-label">${farmText}</span>
                                <span class="stat-hint">🔍</span>
                            </div>
                            <div class="overview-stat ${advClass} clickable-stat" onclick="showMemberWarningsModal(${member.id}, '${member.name.replace(/'/g, "\\'")}')">
                                <span class="overview-icon">⚠️</span>
                                <span class="overview-value">${member.warningsCount}</span>
                                <span class="overview-label">ADV${member.warningsCount !== 1 ? 's' : ''}</span>
                                <span class="stat-hint">🔍</span>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            grid.innerHTML = '<div class="empty-state">👥 Nenhum membro cadastrado</div>';
        }
    } catch (error) {
        console.error('Erro ao carregar visão geral:', error);
    }
}

// ========== PAINEL DE MEMBROS - EXTRATO ==========
let membersPanelData = [];

// Carregar painel de membros
async function loadMembersPanel() {
    try {
        const response = await fetch('/api/admin/members');
        const data = await response.json();
        
        membersPanelData = data.members || [];
        
        // Ordenar por passaporte
        membersPanelData.sort((a, b) => {
            const passA = parseInt(a.passport) || 0;
            const passB = parseInt(b.passport) || 0;
            return passA - passB;
        });
        
        renderMembersList();
        
    } catch (error) {
        console.error('Erro ao carregar painel de membros:', error);
        document.getElementById('membersExtractList').innerHTML = 
            '<p class="loading">Erro ao carregar dados</p>';
    }
}

// Renderizar lista de membros
function renderMembersList() {
    const searchTerm = document.getElementById('searchMembersPanel')?.value?.toLowerCase() || '';
    
    // Filtrar
    const filtered = membersPanelData.filter(m => {
        if (!searchTerm) return true;
        return m.name?.toLowerCase().includes(searchTerm) || 
               m.passport?.toLowerCase().includes(searchTerm);
    });
    
    const list = document.getElementById('membersExtractList');
    
    if (filtered.length === 0) {
        list.innerHTML = '<p class="extract-empty">Nenhum membro encontrado</p>';
        return;
    }
    
    list.innerHTML = filtered.map(member => `
        <div class="member-extract-card" onclick="openMemberExtract(${member.id})">
            <div class="member-extract-avatar">👤</div>
            <div class="member-extract-card-info">
                <div class="member-extract-card-name">${member.name}</div>
                <div class="member-extract-card-details">
                    <span class="member-extract-card-passport">#${member.passport}</span>
                    <span>${roleNames[member.role] || member.role}</span>
                </div>
            </div>
            <div class="member-extract-card-stats">
                <span class="member-mini-stat advs ${parseInt(member.warnings_count) === 0 ? 'zero' : ''}">
                    ⚠️ ${parseInt(member.warnings_count) || 0}
                </span>
            </div>
        </div>
    `).join('');
}

// Filtrar painel de membros
function filterMembersPanel() {
    renderMembersList();
}

// Abrir modal de extrato do membro
async function openMemberExtract(memberId) {
    const modal = document.getElementById('memberExtractModal');
    modal.style.display = 'flex';
    
    // Mostrar loading
    document.getElementById('extractMemberName').textContent = 'Carregando...';
    document.getElementById('extractMemberDetails').textContent = '';
    document.getElementById('extractStats').innerHTML = '<p class="loading">Carregando...</p>';
    document.getElementById('extractFarmsList').innerHTML = '<p class="loading">Carregando...</p>';
    document.getElementById('extractWarningsList').innerHTML = '<p class="loading">Carregando...</p>';
    
    try {
        const response = await fetch(`/api/admin/member-extract/${memberId}`);
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Erro ao carregar extrato');
        }
        
        // Preencher header
        document.getElementById('extractMemberName').textContent = data.member.name;
        document.getElementById('extractMemberDetails').textContent = 
            `Passaporte: ${data.member.passport} | Cargo: ${roleNames[data.member.role] || data.member.role}`;
        
        // Preencher estatísticas
        document.getElementById('extractStats').innerHTML = `
            <div class="extract-stat-card approved">
                <span class="extract-stat-number">${data.stats.totalApproved}</span>
                <span class="extract-stat-label">✅ Aprovados</span>
            </div>
            <div class="extract-stat-card pending">
                <span class="extract-stat-number">${data.stats.totalPending}</span>
                <span class="extract-stat-label">⏳ Pendentes</span>
            </div>
            <div class="extract-stat-card rejected">
                <span class="extract-stat-number">${data.stats.totalRejected}</span>
                <span class="extract-stat-label">❌ Rejeitados</span>
            </div>
            <div class="extract-stat-card justified">
                <span class="extract-stat-number">${data.stats.totalJustified}</span>
                <span class="extract-stat-label">📋 Justificados</span>
            </div>
            <div class="extract-stat-card warnings">
                <span class="extract-stat-number">${data.stats.totalWarnings}</span>
                <span class="extract-stat-label">⚠️ ADVs</span>
            </div>
        `;
        
        // Preencher farms
        const farmsList = document.getElementById('extractFarmsList');
        if (data.deliveries.length === 0 && data.justifications.length === 0) {
            farmsList.innerHTML = '<p class="extract-empty">Nenhum farm registrado</p>';
        } else {
            // Combinar deliveries e justifications e ordenar por data
            const allRecords = [
                ...data.deliveries.map(d => ({ ...d, type: 'delivery' })),
                ...data.justifications.map(j => ({ ...j, type: 'justification' }))
            ].sort((a, b) => new Date(b.week_start) - new Date(a.week_start)).slice(0, 10);
            
            farmsList.innerHTML = allRecords.map(record => {
                const weekLabel = formatWeekLabel(record.week_start, record.week_end);
                
                if (record.type === 'justification') {
                    return `
                        <div class="extract-justified-item">
                            <div class="extract-farm-week">${weekLabel}</div>
                            <span class="extract-farm-status">📋 Justificado</span>
                            <div class="extract-farm-materials">
                                <span class="extract-farm-material">${record.reason || 'Sem motivo informado'}</span>
                            </div>
                        </div>
                    `;
                }
                
                const statusClass = record.status;
                const statusText = getExtractStatusText(record.status);
                const materials = record.items?.map(item => 
                    `<span class="extract-farm-material">${item.material_icon || '📦'} ${item.amount}</span>`
                ).join('') || '';
                
                return `
                    <div class="extract-farm-item">
                        <div class="extract-farm-week">${weekLabel}</div>
                        <span class="extract-farm-status ${statusClass}">${statusText}</span>
                        <div class="extract-farm-materials">${materials || '<span class="extract-farm-material">-</span>'}</div>
                    </div>
                `;
            }).join('');
        }
        
        // Preencher advertências
        document.getElementById('extractWarningsCount').textContent = data.warnings.length;
        const warningsList = document.getElementById('extractWarningsList');
        if (data.warnings.length === 0) {
            warningsList.innerHTML = '<p class="extract-empty">🎉 Nenhuma advertência</p>';
        } else {
            warningsList.innerHTML = data.warnings.map(warning => `
                <div class="extract-warning-item">
                    <span class="extract-warning-icon">⚠️</span>
                    <div class="extract-warning-info">
                        <div class="extract-warning-reason">${warning.reason || 'Sem motivo informado'}</div>
                        <div class="extract-warning-meta">
                            Por ${warning.given_by_name} em ${new Date(warning.created_at).toLocaleDateString('pt-BR')}
                            ${warning.week_start ? ` | Semana: ${formatWeekLabel(warning.week_start, warning.week_end)}` : ''}
                        </div>
                    </div>
                </div>
            `).join('');
        }
        
    } catch (error) {
        console.error('Erro ao carregar extrato:', error);
        document.getElementById('extractFarmsList').innerHTML = 
            '<p class="extract-empty">Erro ao carregar dados</p>';
    }
}

// Fechar modal de extrato
function closeMemberExtractModal() {
    document.getElementById('memberExtractModal').style.display = 'none';
}

// Formatar label da semana
function formatWeekLabel(start, end) {
    if (!start || !end) return '-';
    const startDate = new Date(start + 'T00:00:00');
    const endDate = new Date(end + 'T00:00:00');
    return `${startDate.toLocaleDateString('pt-BR')} - ${endDate.toLocaleDateString('pt-BR')}`;
}

// Texto do status no extrato
function getExtractStatusText(status) {
    const texts = {
        'approved': '✅ Aprovado',
        'pending': '⏳ Pendente',
        'rejected': '❌ Rejeitado',
        'in_progress': '⚡ Em Progresso'
    };
    return texts[status] || status;
}

// Fechar modal ao clicar fora
document.addEventListener('click', (e) => {
    const modal = document.getElementById('memberExtractModal');
    if (e.target === modal) {
        closeMemberExtractModal();
    }
});

// ========== FIM PAINEL DE MEMBROS ==========

// Variável global para armazenar os dados do status semanal
let weeklyStatusData = null;
let currentFilter = 'all';

// Carregar status semanal (da semana selecionada)
async function loadWeeklyStatus() {
    try {
        const params = selectedWeek ? `?week_start=${selectedWeek.start}&week_end=${selectedWeek.end}` : '';
        const response = await fetch(`/api/admin/weekly-status${params}`);
        const data = await response.json();
        
        weeklyStatusData = data;
        
        // Contadores
        document.getElementById('completedCount').textContent = data.completed.length;
        document.getElementById('partialCount').textContent = data.partial ? data.partial.length : 0;
        document.getElementById('pendingApprovalCount').textContent = data.pendingApproval.length;
        document.getElementById('notDeliveredCount').textContent = data.notDelivered.length;
        document.getElementById('justifiedCount').textContent = data.justified.length;
        
        // Renderizar tabela
        renderWeeklyTable(currentFilter);
        
    } catch (error) {
        console.error('Erro ao carregar status semanal:', error);
        const tbody = document.getElementById('weeklyTableBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="4" class="loading">❌ Erro ao carregar dados</td></tr>';
        }
    }
}

// Renderizar tabela com filtro
function renderWeeklyTable(filter) {
    const tbody = document.getElementById('weeklyTableBody');
    if (!tbody || !weeklyStatusData) return;
    
    currentFilter = filter;
    const data = weeklyStatusData;
    const weekPassed = data.weekPassed;
    
    // Combinar todos os membros com seus status
    let allMembers = [];
    
    // Adicionar completos
    data.completed.forEach(member => {
        allMembers.push({
            ...member,
            status: 'completed',
            statusLabel: '✅ Completo',
            statusClass: 'completed'
        });
    });
    
    // Adicionar em progresso
    if (data.partial) {
        data.partial.forEach(member => {
            allMembers.push({
                ...member,
                status: 'partial',
                statusLabel: '⚡ Em Progresso',
                statusClass: 'partial'
            });
        });
    }
    
    // Adicionar pendentes de aprovação
    data.pendingApproval.forEach(member => {
        allMembers.push({
            ...member,
            status: 'pending',
            statusLabel: member.has_justification_pending ? '📝 Justificativa' : '⏳ Aguardando',
            statusClass: 'pending'
        });
    });
    
    // Adicionar não entregaram
    data.notDelivered.forEach(member => {
        allMembers.push({
            ...member,
            status: 'missing',
            statusLabel: '❌ Não Entregou',
            statusClass: 'missing'
        });
    });
    
    // Adicionar justificados
    data.justified.forEach(member => {
        allMembers.push({
            ...member,
            status: 'justified',
            statusLabel: '📋 Justificado',
            statusClass: 'justified'
        });
    });
    
    // Aplicar filtro
    if (filter !== 'all') {
        allMembers = allMembers.filter(m => m.status === filter);
    }
    
    // Ordenar por nome
    allMembers.sort((a, b) => a.name.localeCompare(b.name));
    
    if (allMembers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="loading">😴 Nenhum membro encontrado com este filtro</td></tr>';
        return;
    }
    
    // Gerar linhas da tabela
    tbody.innerHTML = allMembers.map(member => {
        const initial = member.name.charAt(0).toUpperCase();
        const roleName = roleNames[member.role] || member.role || '-';
        
        // Determinar ação
        let actionHtml = '';
        switch (member.status) {
            case 'completed':
                actionHtml = `<button class="action-btn view" onclick='showDeliveryExtract(${JSON.stringify(member).replace(/'/g, "&apos;")})'>👁️ Ver Extrato</button>`;
                break;
            case 'partial':
                actionHtml = `<button class="action-btn view" onclick='showDeliveryExtract(${JSON.stringify(member).replace(/'/g, "&apos;")})'>👁️ Ver Detalhes</button>`;
                break;
            case 'pending':
                if (member.has_justification_pending) {
                    actionHtml = `<button class="action-btn approve" onclick='showJustificationModal(${JSON.stringify(member).replace(/'/g, "&apos;")})'>📝 Avaliar</button>`;
                } else {
                    actionHtml = `<button class="action-btn approve" onclick='showApprovalModal(${JSON.stringify(member).replace(/'/g, "&apos;")})'>✔️ Aprovar</button>`;
                }
                break;
            case 'missing':
                if (weekPassed) {
                    actionHtml = `<button class="action-btn adv" onclick="applyWeeklyAdv(${member.id}, '${member.name.replace(/'/g, "\\'")}', '${selectedWeek ? selectedWeek.start : ''}', '${selectedWeek ? selectedWeek.end : ''}')">⚠️ Aplicar ADV</button>`;
                } else {
                    actionHtml = '<span class="no-action">⏳ Semana em andamento</span>';
                }
                break;
            case 'justified':
                actionHtml = `<button class="action-btn view" onclick='showJustifiedDetails(${JSON.stringify(member).replace(/'/g, "&apos;")})'>📋 Ver Justificativa</button>`;
                break;
            default:
                actionHtml = '<span class="no-action">-</span>';
        }
        
        return `
            <tr class="status-${member.status}">
                <td>
                    <div class="member-cell">
                        <div class="member-avatar">${initial}</div>
                        <div>
                            <div class="member-name">${member.name}</div>
                            <div class="member-passport">ID: ${member.passport || member.id}</div>
                        </div>
                    </div>
                </td>
                <td class="role-cell">${roleName}</td>
                <td><span class="status-badge ${member.statusClass}">${member.statusLabel}</span></td>
                <td>${actionHtml}</td>
            </tr>
        `;
    }).join('');
}

// Função para filtrar tabela (chamada pelos botões)
function filterWeeklyTable(filter) {
    // Atualizar botões ativos
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.filter === filter) {
            btn.classList.add('active');
        }
    });
    
    renderWeeklyTable(filter);
}

// Modal: Mostrar extrato de farm aprovado
function showDeliveryExtract(member) {
    const isDirtyMoney = member.payment_type === 'dirty_money';
    
    let contentHtml = '';
    if (isDirtyMoney) {
        // Mostrar dinheiro sujo
        const amount = member.dirty_money_amount || 0;
        const goal = 50000;
        const percentage = Math.min(100, Math.round((amount / goal) * 100));
        contentHtml = `
            <div class="dirty-money-extract">
                <div class="dirty-money-info">
                    <span class="dirty-money-icon">💰</span>
                    <span class="dirty-money-label">Dinheiro Sujo</span>
                </div>
                <div class="dirty-money-value">R$ ${amount.toLocaleString('pt-BR')} / R$ ${goal.toLocaleString('pt-BR')}</div>
                <div class="dirty-money-bar">
                    <div class="dirty-money-bar-fill" style="width: ${percentage}%"></div>
                </div>
                <div class="dirty-money-edit">
                    <label>Editar valor:</label>
                    <div class="dirty-money-input-group">
                        <span class="currency-prefix">R$</span>
                        <input type="number" id="editDirtyMoneyAmount" value="${amount}" min="0" step="1000">
                        <button class="btn btn-primary" onclick="saveDirtyMoneyEdit(${member.delivery_id})">💾 Salvar</button>
                    </div>
                </div>
            </div>
        `;
    } else {
        // Mostrar materiais
        contentHtml = member.items && member.items.length > 0 
            ? member.items.map(item => `
                <div class="extract-item">
                    <span class="item-icon">${item.material_icon || '📦'}</span>
                    <span class="item-name">${item.material_name}</span>
                    <span class="item-amount">${formatNumber(item.amount)}</span>
                </div>
            `).join('')
            : '<p class="no-items">Sem itens registrados</p>';
    }
    
    // Montar galeria de screenshots
    let screenshotsHtml = '';
    if (member.screenshots && member.screenshots.length > 0) {
        screenshotsHtml = `
            <div class="screenshots-gallery">
                ${member.screenshots.map((s, idx) => `
                    <img src="${s.screenshot_url}" class="gallery-screenshot" onclick="openModal('${s.screenshot_url}')" alt="Print ${idx + 1}">
                `).join('')}
            </div>
        `;
    } else if (member.screenshot_url) {
        screenshotsHtml = `<img src="${member.screenshot_url}" class="extract-screenshot" onclick="openModal('${member.screenshot_url}')">`;
    } else {
        screenshotsHtml = '<p class="no-screenshot">Sem prints</p>';
    }
    
    showActionModal(`
        <div class="extract-modal">
            <div class="extract-header">
                <h2>${isDirtyMoney ? '💰 Extrato Dinheiro Sujo' : '📦 Extrato do Farm'}</h2>
                <span class="extract-member">👤 ${member.name}</span>
            </div>
            <div class="extract-info">
                <p>📅 Entregue em: ${new Date(member.delivered_at).toLocaleDateString('pt-BR')}</p>
                ${member.description ? `<p>📝 ${member.description}</p>` : ''}
                ${isDirtyMoney ? '<span class="payment-type-badge dirty-money">💰 Dinheiro Sujo</span>' : '<span class="payment-type-badge material">📦 Materiais</span>'}
            </div>
            <div class="extract-items">
                <h3>${isDirtyMoney ? '💵 Valor Entregue' : '📋 Materiais Entregues'}</h3>
                ${contentHtml}
            </div>
            <div class="extract-screenshot-container">
                <h3>🖼️ Prints (${member.screenshots ? member.screenshots.length : (member.screenshot_url ? 1 : 0)})</h3>
                ${screenshotsHtml}
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="closeActionModal()">Fechar</button>
            </div>
        </div>
    `);
}

// Salvar edição de dinheiro sujo
async function saveDirtyMoneyEdit(deliveryId) {
    const amount = parseInt(document.getElementById('editDirtyMoneyAmount').value) || 0;
    
    if (amount < 0) {
        alert('O valor não pode ser negativo!');
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/deliveries/${deliveryId}/dirty-money`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dirty_money_amount: amount })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert(data.message);
            closeActionModal();
            loadWeeklyStatus();
        } else {
            alert('Erro: ' + (data.error || 'Erro desconhecido'));
        }
    } catch (error) {
        console.error('Erro ao salvar dinheiro sujo:', error);
        alert('Erro ao salvar. Tente novamente.');
    }
}

// Modal: Aprovar/Rejeitar farm pendente
function showApprovalModal(member) {
    const isDirtyMoney = member.payment_type === 'dirty_money';
    
    let contentHtml = '';
    if (isDirtyMoney) {
        // Mostrar dinheiro sujo
        const amount = member.dirty_money_amount || 0;
        const goal = 50000;
        const percentage = Math.min(100, Math.round((amount / goal) * 100));
        contentHtml = `
            <div class="dirty-money-extract">
                <div class="dirty-money-info">
                    <span class="dirty-money-icon">💰</span>
                    <span class="dirty-money-label">Dinheiro Sujo</span>
                </div>
                <div class="dirty-money-value">R$ ${amount.toLocaleString('pt-BR')} / R$ ${goal.toLocaleString('pt-BR')}</div>
                <div class="dirty-money-bar">
                    <div class="dirty-money-bar-fill" style="width: ${percentage}%"></div>
                </div>
                <div class="dirty-money-edit">
                    <label>Editar valor antes de aprovar:</label>
                    <div class="dirty-money-input-group">
                        <span class="currency-prefix">R$</span>
                        <input type="number" id="editDirtyMoneyAmount" value="${amount}" min="0" step="1000">
                        <button class="btn btn-secondary btn-small" onclick="updateDirtyMoneyPreview()">Atualizar</button>
                    </div>
                </div>
            </div>
        `;
    } else {
        // Mostrar materiais
        contentHtml = member.items && member.items.length > 0 
            ? member.items.map(item => `
                <div class="extract-item">
                    <span class="item-icon">${item.material_icon || '📦'}</span>
                    <span class="item-name">${item.material_name}</span>
                    <span class="item-amount">${formatNumber(item.amount)}</span>
                </div>
            `).join('')
            : '<p class="no-items">Sem itens registrados</p>';
    }
    
    // Montar galeria de screenshots
    let screenshotsHtml = '';
    if (member.screenshots && member.screenshots.length > 0) {
        screenshotsHtml = `
            <div class="screenshots-gallery">
                ${member.screenshots.map((s, idx) => `
                    <img src="${s.screenshot_url}" class="gallery-screenshot" onclick="openModal('${s.screenshot_url}')" alt="Print ${idx + 1}">
                `).join('')}
            </div>
        `;
    } else if (member.screenshot_url) {
        screenshotsHtml = `<img src="${member.screenshot_url}" class="extract-screenshot" onclick="openModal('${member.screenshot_url}')">`;
    } else {
        screenshotsHtml = '<p class="no-screenshot">Sem prints</p>';
    }
    
    // Guardar o delivery_id para uso na aprovação com edição
    window.currentApprovalDeliveryId = member.delivery_id;
    window.currentApprovalIsDirtyMoney = isDirtyMoney;
    
    showActionModal(`
        <div class="approval-modal">
            <div class="extract-header">
                <h2>${isDirtyMoney ? '💰 Aprovar Dinheiro Sujo' : '⏳ Aprovar Farm'}</h2>
                <span class="extract-member">👤 ${member.name}</span>
            </div>
            <div class="extract-info">
                <p>📅 Enviado em: ${new Date(member.delivered_at).toLocaleDateString('pt-BR')}</p>
                ${member.description ? `<p>📝 ${member.description}</p>` : ''}
                ${isDirtyMoney ? '<span class="payment-type-badge dirty-money">💰 Dinheiro Sujo</span>' : '<span class="payment-type-badge material">📦 Materiais</span>'}
            </div>
            <div class="extract-items">
                <h3>${isDirtyMoney ? '💵 Valor a Aprovar' : '📋 Materiais'}</h3>
                ${contentHtml}
            </div>
            <div class="extract-screenshot-container">
                <h3>🖼️ Prints (${member.screenshots ? member.screenshots.length : (member.screenshot_url ? 1 : 0)})</h3>
                ${screenshotsHtml}
            </div>
            <div class="modal-actions approval-actions">
                <button class="btn btn-success btn-large" onclick="approveDeliveryFromModal(${member.delivery_id})">
                    ✅ Aprovar Farm
                </button>
                <button class="btn btn-danger btn-large" onclick="rejectDeliveryFromModal(${member.delivery_id})">
                    ❌ Rejeitar Farm
                </button>
                <button class="btn btn-secondary" onclick="closeActionModal()">Cancelar</button>
            </div>
        </div>
    `);
}

// Atualizar preview do dinheiro sujo no modal de aprovação
function updateDirtyMoneyPreview() {
    const amount = parseInt(document.getElementById('editDirtyMoneyAmount').value) || 0;
    const goal = 50000;
    const percentage = Math.min(100, Math.round((amount / goal) * 100));
    
    const valueEl = document.querySelector('.dirty-money-value');
    const barFillEl = document.querySelector('.dirty-money-bar-fill');
    
    if (valueEl) {
        valueEl.textContent = `R$ ${amount.toLocaleString('pt-BR')} / R$ ${goal.toLocaleString('pt-BR')}`;
    }
    if (barFillEl) {
        barFillEl.style.width = `${percentage}%`;
    }
}

// Aprovar entrega com possível edição de dinheiro sujo
async function approveDeliveryFromModal(deliveryId) {
    // Se for dinheiro sujo, primeiro salvar o valor editado
    if (window.currentApprovalIsDirtyMoney && window.currentApprovalDeliveryId === deliveryId) {
        const amountInput = document.getElementById('editDirtyMoneyAmount');
        if (amountInput) {
            const amount = parseInt(amountInput.value) || 0;
            try {
                await fetch(`/api/admin/deliveries/${deliveryId}/dirty-money`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dirty_money_amount: amount })
                });
            } catch (e) {
                console.error('Erro ao atualizar dinheiro sujo:', e);
            }
        }
    }
    
    // Aprovar a entrega
    try {
        const response = await fetch(`/api/admin/deliveries/${deliveryId}/approve`, { method: 'POST' });
        const data = await response.json();
        
        if (data.success) {
            alert(data.message);
            closeActionModal();
            loadWeeklyStatus();
            loadPendingDeliveries();
            loadAdminStats();
        } else {
            alert('Erro: ' + (data.error || 'Erro desconhecido'));
        }
    } catch (error) {
        console.error('Erro ao aprovar:', error);
        alert('Erro ao aprovar. Tente novamente.');
    }
}

// Modal: Aprovar/Rejeitar justificativa pendente
function showJustificationModal(member) {
    showActionModal(`
        <div class="justification-modal">
            <div class="extract-header">
                <h2>📝 Avaliar Justificativa</h2>
                <span class="extract-member">👤 ${member.name}</span>
            </div>
            <div class="justification-content">
                <h3>Motivo da Ausência:</h3>
                <div class="justification-reason-box">
                    ${member.justification_reason}
                </div>
                <p class="justification-date">📅 Enviada em: ${new Date(member.justification_created_at).toLocaleDateString('pt-BR')}</p>
            </div>
            <div class="modal-actions approval-actions">
                <button class="btn btn-success btn-large" onclick="approveJustificationFromModal(${member.justification_id})">
                    ✅ Aprovar Justificativa
                </button>
                <button class="btn btn-danger btn-large" onclick="rejectJustificationFromModal(${member.justification_id})">
                    ❌ Rejeitar Justificativa
                </button>
                <button class="btn btn-secondary" onclick="closeActionModal()">Cancelar</button>
            </div>
        </div>
    `);
}

// Modal: Ver detalhes de justificativa aprovada
function showJustifiedDetails(member) {
    showActionModal(`
        <div class="justified-modal">
            <div class="extract-header">
                <h2>📋 Justificativa Aprovada</h2>
                <span class="extract-member">👤 ${member.name}</span>
            </div>
            <div class="justification-content">
                <h3>Motivo da Ausência:</h3>
                <div class="justification-reason-box">
                    ${member.justification_reason}
                </div>
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="closeActionModal()">Fechar</button>
            </div>
        </div>
    `);
}

// Função para rejeitar do modal
async function rejectDeliveryFromModal(deliveryId) {
    if (!confirm('Confirma a rejeição desta entrega?')) return;
    
    try {
        const response = await fetch(`/api/admin/deliveries/${deliveryId}/reject`, { method: 'POST' });
        const data = await response.json();
        
        if (data.success) {
            closeActionModal();
            loadWeeklyStatus();
            loadAdminStats();
            loadPendingDeliveries();
        } else {
            alert(data.error || 'Erro ao rejeitar');
        }
    } catch (error) {
        alert('Erro ao rejeitar entrega');
    }
}

async function approveJustificationFromModal(justificationId) {
    try {
        const response = await fetch(`/api/admin/justifications/${justificationId}/approve`, {
            method: 'PUT'
        });
        
        const data = await response.json();
        
        if (response.ok) {
            closeActionModal();
            loadWeeklyStatus();
            loadJustifications();
        } else {
            alert(data.error || 'Erro ao aprovar justificativa');
        }
    } catch (error) {
        alert('Erro ao aprovar justificativa');
    }
}

async function rejectJustificationFromModal(justificationId) {
    const reason = prompt('Motivo da rejeição (opcional):');
    if (reason === null) return;
    
    try {
        const response = await fetch(`/api/admin/justifications/${justificationId}/reject`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rejection_reason: reason })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            closeActionModal();
            loadWeeklyStatus();
            loadJustifications();
        } else {
            alert(data.error || 'Erro ao rejeitar justificativa');
        }
    } catch (error) {
        alert('Erro ao rejeitar justificativa');
    }
}

// Mostrar modal de ação genérico
function showActionModal(content) {
    // Remover modal existente se houver
    const existingModal = document.getElementById('actionModal');
    if (existingModal) existingModal.remove();
    
    const modal = document.createElement('div');
    modal.id = 'actionModal';
    modal.className = 'action-modal-overlay';
    modal.innerHTML = `
        <div class="action-modal-content">
            <span class="action-modal-close" onclick="closeActionModal()">&times;</span>
            ${content}
        </div>
    `;
    document.body.appendChild(modal);
    
    // Fechar ao clicar fora
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeActionModal();
    });
}

function closeActionModal() {
    const modal = document.getElementById('actionModal');
    if (modal) modal.remove();
}

// Carregar justificativas pendentes (da semana selecionada)
async function loadJustifications() {
    try {
        const params = selectedWeek ? `?week_start=${selectedWeek.start}&week_end=${selectedWeek.end}` : '';
        const response = await fetch(`/api/admin/justifications/pending${params}`);
        const justifications = await response.json();
        
        const container = document.getElementById('justificationsList');
        
        if (justifications.length === 0) {
            container.innerHTML = '<div class="empty-state">✅ Nenhuma justificativa pendente nesta semana</div>';
            return;
        }
        
        container.innerHTML = justifications.map(j => `
            <div class="justification-card">
                <div class="justification-header">
                    <div class="justification-user">
                        <span class="user-name">👤 ${j.name}</span>
                        <span class="user-role">${roleNames[j.role] || j.role}</span>
                    </div>
                    <div class="justification-date">
                        📅 Semana: ${formatWeekDate(j.week_start)} - ${formatWeekDate(j.week_end)}
                    </div>
                </div>
                <div class="justification-content">
                    <div class="justification-reason">
                        <strong>📝 Motivo:</strong>
                        <p>${j.reason}</p>
                    </div>
                    <div class="justification-submitted">
                        Enviada em ${new Date(j.created_at).toLocaleDateString('pt-BR')} às ${new Date(j.created_at).toLocaleTimeString('pt-BR')}
                    </div>
                </div>
                <div class="justification-actions">
                    <button class="btn btn-approve" onclick="approveJustification(${j.id})">
                        ✅ Aprovar
                    </button>
                    <button class="btn btn-reject" onclick="rejectJustification(${j.id})">
                        ❌ Rejeitar
                    </button>
                </div>
            </div>
        `).join('');
        
    } catch (error) {
        console.error('Erro ao carregar justificativas:', error);
    }
}

function formatWeekDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('pt-BR');
}

// Aprovar justificativa
async function approveJustification(id) {
    if (!confirm('Aprovar esta justificativa?')) return;
    
    try {
        const response = await fetch(`/api/admin/justifications/${id}/approve`, {
            method: 'PUT'
        });
        
        const data = await response.json();
        
        if (response.ok) {
            alert('✅ Justificativa aprovada com sucesso!');
            loadJustifications();
            loadWeeklyStatus();
        } else {
            alert(data.error || 'Erro ao aprovar justificativa');
        }
    } catch (error) {
        alert('Erro ao aprovar justificativa');
    }
}

// Rejeitar justificativa
async function rejectJustification(id) {
    const reason = prompt('Motivo da rejeição (opcional):');
    if (reason === null) return; // Cancelou
    
    try {
        const response = await fetch(`/api/admin/justifications/${id}/reject`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rejection_reason: reason })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            alert('❌ Justificativa rejeitada');
            loadJustifications();
            loadWeeklyStatus();
        } else {
            alert(data.error || 'Erro ao rejeitar justificativa');
        }
    } catch (error) {
        alert('Erro ao rejeitar justificativa');
    }
}

// Carregar estatísticas admin (da semana selecionada)
async function loadAdminStats() {
    try {
        const params = selectedWeek ? `?week_start=${selectedWeek.start}&week_end=${selectedWeek.end}` : '';
        const response = await fetch(`/api/admin/stats${params}`);
        const data = await response.json();
        
        if (data.stats) {
            document.getElementById('totalMembers').textContent = data.stats.total_members || 0;
            document.getElementById('pendingDeliveries').textContent = data.stats.pending_deliveries || 0;
            document.getElementById('approvedCount').textContent = data.stats.approved_count || 0;
        }
    } catch (error) {
        console.error('Erro ao carregar estatísticas:', error);
    }
}

// Carregar entregas pendentes (da semana selecionada)
async function loadPendingDeliveries() {
    try {
        // Farms pendentes: mostrar TODOS sem filtro de semana (para aprovar farms de qualquer semana)
        const response = await fetch('/api/admin/deliveries/pending');
        const data = await response.json();
        
        const pendingList = document.getElementById('pendingList');
        
        if (data.deliveries && data.deliveries.length > 0) {
            pendingList.innerHTML = data.deliveries.map(delivery => {
                // Montar galeria de screenshots
                let screenshotsHtml = '';
                if (delivery.screenshots && delivery.screenshots.length > 0) {
                    screenshotsHtml = `
                        <div class="pending-screenshots-gallery">
                            ${delivery.screenshots.map((s, idx) => `
                                <img src="${s.screenshot_url}" class="delivery-screenshot" onclick="openModal('${s.screenshot_url}')" alt="Print ${idx + 1}">
                            `).join('')}
                        </div>
                    `;
                } else if (delivery.screenshot_url) {
                    screenshotsHtml = `<img src="${delivery.screenshot_url}" class="delivery-screenshot" onclick="openModal('${delivery.screenshot_url}')">`;
                } else {
                    screenshotsHtml = '<span class="no-prints">Sem prints</span>';
                }
                
                // Determinar tipo de pagamento
                let paymentInfo = '';
                if (delivery.payment_type === 'dirty_money' || delivery.payment_type?.startsWith('payment_')) {
                    const paymentName = delivery.payment_type_name || 'Dinheiro Sujo';
                    const paymentIcon = delivery.payment_type_icon || '💰';
                    const amount = delivery.dirty_money_amount || 0;
                    paymentInfo = `
                        <div class="payment-type-badge dirty-money">
                            <span class="payment-icon">${paymentIcon}</span>
                            <span class="payment-label">${paymentName}: R$ ${formatNumber(amount)}</span>
                        </div>
                    `;
                } else {
                    paymentInfo = `
                        <div class="payment-type-badge materials">
                            <span class="payment-icon">📦</span>
                            <span class="payment-label">Materiais</span>
                        </div>
                    `;
                }
                
                return `
                    <div class="delivery-item" id="delivery-${delivery.id}">
                        <div class="delivery-info">
                            <h3>📦 Farm de ${delivery.name}</h3>
                            ${paymentInfo}
                            <p class="week-info">📅 Semana: ${formatWeekDate(delivery.week_start)} - ${formatWeekDate(delivery.week_end)}</p>
                            <div class="materials-list">
                                ${delivery.items && delivery.items.length > 0 ? delivery.items.map(item => `
                                    <span class="material-tag">${item.material_icon} ${item.material_name}: ${formatNumber(item.amount)}</span>
                                `).join('') : '<span class="no-materials">Sem materiais (pagamento em dinheiro)</span>'}
                            </div>
                            <p>${delivery.description || 'Sem descrição'}</p>
                            <p>📤 Enviado: ${formatDate(delivery.created_at)}</p>
                        </div>
                        <div class="delivery-actions">
                            <div class="delivery-screenshots-container">
                                <h4>🖼️ Prints (${delivery.screenshots ? delivery.screenshots.length : (delivery.screenshot_url ? 1 : 0)})</h4>
                                ${screenshotsHtml}
                            </div>
                            <div class="action-buttons">
                                <button class="btn btn-success" onclick="approveDelivery(${delivery.id})">✅ Aprovar</button>
                                <button class="btn btn-danger" onclick="rejectDelivery(${delivery.id})">❌ Rejeitar</button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            pendingList.innerHTML = `
                <div class="empty-state">
                    <span>✨</span>
                    <p>Nenhuma entrega pendente de aprovação!</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('Erro ao carregar entregas pendentes:', error);
    }
}

// Carregar status de farm dos membros
async function loadFarmStatus() {
    try {
        const response = await fetch('/api/admin/members-farm-status');
        const data = await response.json();
        
        const pendingMembersList = document.getElementById('pendingMembersList');
        const completedMembersList = document.getElementById('completedMembersList');
        
        // Membros com farm pendente
        if (data.pendingMembers && data.pendingMembers.length > 0) {
            pendingMembersList.innerHTML = data.pendingMembers.map(member => `
                <div class="member-farm-card pending">
                    <div class="member-header">
                        <span class="member-name">👤 ${member.name}</span>
                        <span class="pending-badge">${member.pending_count} pendente(s)</span>
                    </div>
                    <div class="member-deliveries">
                        ${member.pending_deliveries.map(d => `
                            <div class="pending-delivery-item">
                                <div class="delivery-materials">
                                    ${d.items.map(item => `<span class="material-mini">${item.icon} ${item.name}: ${formatNumber(item.amount)}</span>`).join('')}
                                </div>
                                <span class="delivery-date">📅 ${formatDate(d.created_at)}</span>
                                <div class="delivery-quick-actions">
                                    ${d.screenshot ? `<button class="btn btn-small btn-secondary" onclick="openModal('/uploads/${d.screenshot}')">🖼️ Ver Print</button>` : ''}
                                    <button class="btn btn-small btn-success" onclick="approveDelivery(${d.id}); loadFarmStatus();">✅</button>
                                    <button class="btn btn-small btn-danger" onclick="rejectDelivery(${d.id}); loadFarmStatus();">❌</button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `).join('');
        } else {
            pendingMembersList.innerHTML = `
                <div class="empty-state">
                    <span>✨</span>
                    <p>Nenhum membro com farm pendente!</p>
                </div>
            `;
        }
        
        // Membros com farm completo
        if (data.completedMembers && data.completedMembers.length > 0) {
            completedMembersList.innerHTML = data.completedMembers.map(member => `
                <div class="member-farm-card completed">
                    <div class="member-header">
                        <span class="member-name">👤 ${member.name}</span>
                        <span class="approved-badge">${member.approved_count} aprovado(s)</span>
                    </div>
                    <div class="member-stats">
                        <span class="total-materials">📦 Total: ${formatNumber(member.total_materials)} materiais</span>
                    </div>
                </div>
            `).join('');
        } else {
            completedMembersList.innerHTML = `
                <div class="empty-state">
                    <span>📭</span>
                    <p>Nenhum membro com farm aprovado ainda.</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('Erro ao carregar status de farm:', error);
    }
}

// Aprovar entrega
async function approveDelivery(id) {
    if (!confirm('Confirma a aprovação desta entrega?')) return;
    
    try {
        const response = await fetch(`/api/admin/deliveries/${id}/approve`, { method: 'POST' });
        const data = await response.json();
        
        if (data.success) {
            alert(data.message);
            document.getElementById(`delivery-${id}`).remove();
            loadAdminStats();
            
            const pendingList = document.getElementById('pendingList');
            if (!pendingList.querySelector('.delivery-item')) {
                pendingList.innerHTML = `
                    <div class="empty-state">
                        <span>✨</span>
                        <p>Nenhuma entrega pendente de aprovação!</p>
                    </div>
                `;
            }
        } else {
            alert(data.error || 'Erro ao aprovar');
        }
    } catch (error) {
        alert('Erro ao aprovar entrega');
    }
}

// Rejeitar entrega
async function rejectDelivery(id) {
    if (!confirm('Confirma a rejeição desta entrega?')) return;
    
    try {
        const response = await fetch(`/api/admin/deliveries/${id}/reject`, { method: 'POST' });
        const data = await response.json();
        
        if (data.success) {
            alert(data.message);
            document.getElementById(`delivery-${id}`).remove();
            loadAdminStats();
            
            const pendingList = document.getElementById('pendingList');
            if (!pendingList.querySelector('.delivery-item')) {
                pendingList.innerHTML = `
                    <div class="empty-state">
                        <span>✨</span>
                        <p>Nenhuma entrega pendente de aprovação!</p>
                    </div>
                `;
            }
        } else {
            alert(data.error || 'Erro ao rejeitar');
        }
    } catch (error) {
        alert('Erro ao rejeitar entrega');
    }
}

// Carregar membros
async function loadMembers() {
    try {
        const response = await fetch('/api/admin/members');
        const data = await response.json();
        
        const membersList = document.getElementById('membersList');
        const isSuperAdmin = currentUser && currentUser.passport === '6999';
        
        if (data.members && data.members.length > 0) {
            membersList.innerHTML = data.members.map(member => `
                <div class="member-item ${member.active ? '' : 'inactive'}" id="member-${member.id}">
                    <div class="member-info">
                        <span class="member-passport">${member.passport}</span>
                        <span class="member-name">${member.name}</span>
                        ${isSuperAdmin && member.passport !== '6999' ? `
                            <select class="role-select" onchange="changeRole(${member.id}, this.value)">
                                <option value="member" ${member.role === 'member' ? 'selected' : ''}>Membro</option>
                                <option value="01" ${member.role === '01' ? 'selected' : ''}>01</option>
                                <option value="02" ${member.role === '02' ? 'selected' : ''}>02</option>
                                <option value="gerente_farm" ${member.role === 'gerente_farm' ? 'selected' : ''}>Gerente de Farm</option>
                                <option value="gerente_acao" ${member.role === 'gerente_acao' ? 'selected' : ''}>Gerente de Ação</option>
                                <option value="gerente_recrutamento" ${member.role === 'gerente_recrutamento' ? 'selected' : ''}>Gerente de Recrutamento</option>
                                <option value="gerente_encomendas" ${member.role === 'gerente_encomendas' ? 'selected' : ''}>Gerente de Encomendas</option>
                                <option value="gerente_geral" ${member.role === 'gerente_geral' ? 'selected' : ''}>Gerente Geral</option>
                            </select>
                        ` : `
                            <span class="role ${member.role}">${roleNames[member.role] || member.role}${member.passport === '6999' ? ' 👑' : ''}</span>
                        `}
                    </div>
                    <div class="member-actions">
                        ${isSuperAdmin && member.passport !== '6999' ? `
                            <button class="btn btn-small btn-secondary" onclick="openEditMemberModal(${member.id}, '${member.name.replace(/'/g, "\\'") }', '${member.passport}', '${member.email || ''}', '${member.role}')">✏️ Editar</button>
                            <button class="btn ${member.active ? 'btn-warning' : 'btn-success'} btn-small" onclick="toggleMember(${member.id})">
                                ${member.active ? '🚫 Desativar' : '✅ Ativar'}
                            </button>
                            <button class="btn btn-danger btn-small" onclick="deleteMember(${member.id}, '${member.name.replace(/'/g, "\\'")}')">🗑️ Deletar</button>
                        ` : ''}
                    </div>
                </div>
            `).join('');
        } else {
            membersList.innerHTML = `
                <div class="empty-state">
                    <span>👥</span>
                    <p>Nenhum membro cadastrado.</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('Erro ao carregar membros:', error);
    }
}

// Abrir modal de edição de membro
let editingMemberId = null;

function openEditMemberModal(id, name, passport, email, role) {
    editingMemberId = id;
    document.getElementById('editMemberName').value = name;
    document.getElementById('editMemberPassport').value = passport;
    document.getElementById('editMemberEmail').value = email || '';
    document.getElementById('editMemberRole').value = role;
    document.getElementById('editMemberModal').style.display = 'flex';
}

function closeEditMemberModal() {
    document.getElementById('editMemberModal').style.display = 'none';
    editingMemberId = null;
}

// Salvar edição do membro
async function saveEditMember() {
    if (!editingMemberId) return;
    
    const name = document.getElementById('editMemberName').value.trim();
    const passport = document.getElementById('editMemberPassport').value.trim();
    const email = document.getElementById('editMemberEmail').value.trim();
    const role = document.getElementById('editMemberRole').value;
    const newPassword = document.getElementById('editMemberPassword').value;
    
    if (!name || !passport) {
        alert('Nome e passaporte são obrigatórios!');
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/members/${editingMemberId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, passport, email, role, newPassword: newPassword || undefined })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert(data.message);
            closeEditMemberModal();
            loadMembers();
        } else {
            alert(data.error || 'Erro ao editar membro');
        }
    } catch (error) {
        alert('Erro ao editar membro');
    }
}

// Deletar membro
function deleteMember(id, name) {
    if (!confirm(`Tem certeza que deseja DELETAR permanentemente o membro "${name}"?\n\nTodas as entregas e justificativas serão removidas!`)) {
        return;
    }
    
    fetch(`/api/admin/members/${id}`, { method: 'DELETE' })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            alert(data.message);
            loadMembers();
            loadAdminStats();
        } else {
            alert(data.error || 'Erro ao deletar membro');
        }
    })
    .catch(() => alert('Erro ao deletar membro'));
}

// Alterar cargo do membro
async function changeRole(memberId, newRole) {
    try {
        const response = await fetch(`/api/admin/members/${memberId}/role`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: newRole })
        });
        const data = await response.json();
        
        if (data.success) {
            alert(data.message);
        } else {
            alert(data.error || 'Erro ao alterar cargo');
            loadMembers(); // Recarregar para voltar ao estado anterior
        }
    } catch (error) {
        alert('Erro ao alterar cargo');
        loadMembers();
    }
}

// Ativar/Desativar membro
async function toggleMember(id) {
    try {
        const response = await fetch(`/api/admin/members/${id}/toggle`, { method: 'POST' });
        const data = await response.json();
        
        if (data.success) {
            loadMembers();
            loadAdminStats();
        }
    } catch (error) {
        alert('Erro ao atualizar membro');
    }
}

// Carregar ranking (da semana selecionada)
async function loadRanking() {
    try {
        const params = selectedWeek ? `?week_start=${selectedWeek.start}&week_end=${selectedWeek.end}` : '';
        const response = await fetch(`/api/admin/ranking${params}`);
        const data = await response.json();
        
        // Ranking de Farms
        const farmsRankingList = document.getElementById('farmsRankingList');
        const farmsRanking = data.ranking.filter(p => p.farms_count > 0).sort((a, b) => b.farms_count - a.farms_count);
        
        if (farmsRanking.length > 0) {
            farmsRankingList.innerHTML = farmsRanking.map((player, index) => `
                <div class="ranking-item ${index < 3 ? 'top-' + (index + 1) : ''}">
                    <div class="ranking-position">${index + 1}º</div>
                    <div class="ranking-info">
                        <h4>${player.name}</h4>
                        <small>${player.passport}</small>
                    </div>
                    <div class="ranking-count farms">
                        <span class="count-number">${player.farms_count}</span>
                        <span class="count-label">farms</span>
                    </div>
                </div>
            `).join('');
        } else {
            farmsRankingList.innerHTML = `
                <div class="empty-state">
                    <span>🏆</span>
                    <p>Nenhum farm entregue ainda.</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('Erro ao carregar ranking:', error);
    }
}

// Carregar estatísticas de materiais (da semana selecionada)
async function loadMaterialsStats() {
    try {
        const params = selectedWeek ? `?week_start=${selectedWeek.start}&week_end=${selectedWeek.end}` : '';
        const response = await fetch(`/api/admin/materials-stats${params}`);
        const data = await response.json();
        
        const statsList = document.getElementById('materialsStatsList');
        
        if (data.stats && data.stats.length > 0) {
            statsList.innerHTML = data.stats.map(mat => `
                <div class="material-stat-row">
                    <span class="material-icon-large">${mat.icon}</span>
                    <span class="material-name">${mat.name}</span>
                    <span class="material-count">${mat.deliveries_count} entregas</span>
                    <span class="material-total">${formatNumber(mat.total)} unidades</span>
                </div>
            `).join('');
        } else {
            statsList.innerHTML = `
                <div class="empty-state">
                    <span>📊</span>
                    <p>Nenhum material registrado ainda.</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('Erro ao carregar estatísticas de materiais:', error);
    }
}

// Carregar todas as entregas
async function loadAllDeliveries() {
    try {
        const params = selectedWeek ? `?week_start=${selectedWeek.start}&week_end=${selectedWeek.end}` : '';
        const response = await fetch(`/api/admin/deliveries/all${params}`);
        const data = await response.json();
        
        const allDeliveriesList = document.getElementById('allDeliveriesList');
        
        if (data.deliveries && data.deliveries.length > 0) {
            allDeliveriesList.innerHTML = data.deliveries.map(delivery => `
                <div class="delivery-item">
                    <div class="delivery-info">
                        <h3>📦 Farm de ${delivery.name}</h3>
                        <div class="materials-list">
                            ${delivery.items.map(item => `
                                <span class="material-tag">${item.material_icon} ${item.material_name}: ${formatNumber(item.amount)}</span>
                            `).join('')}
                        </div>
                        ${delivery.description ? `<p>📝 ${delivery.description}</p>` : ''}
                        <p>📅 ${formatDate(delivery.created_at)}</p>
                        <span class="status ${delivery.status}">${getStatusText(delivery.status)}</span>
                        ${delivery.approved_by_name ? `<p style="margin-top: 10px;">Por: <strong>${delivery.approved_by_name}</strong></p>` : ''}
                    </div>
                    <div class="delivery-actions">
                        ${delivery.screenshot ? `<img src="/uploads/${delivery.screenshot}" class="delivery-screenshot" onclick="openModal('/uploads/${delivery.screenshot}')">` : ''}
                    </div>
                </div>
            `).join('');
        } else {
            allDeliveriesList.innerHTML = `
                <div class="empty-state">
                    <span>📋</span>
                    <p>Nenhuma entrega registrada.</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('Erro ao carregar entregas:', error);
    }
}

// Carregar materiais para gerenciamento
async function loadMaterials() {
    try {
        const response = await fetch('/api/admin/materials');
        const data = await response.json();
        
        const materialsList = document.getElementById('materialsList');
        
        if (data.materials && data.materials.length > 0) {
            materialsList.innerHTML = data.materials.map(mat => `
                <div class="material-manage-item ${mat.active ? '' : 'inactive'}">
                    <div class="material-info">
                        <span class="material-icon">${mat.icon}</span>
                        <span class="material-name">${mat.name}</span>
                        <span class="material-goal-display">Meta: <strong>${mat.weekly_goal || 700}</strong></span>
                        <span class="material-status ${mat.active ? 'active' : 'inactive'}">${mat.active ? '✅ Ativo' : '❌ Inativo'}</span>
                    </div>
                    <div class="material-actions">
                        <button class="btn btn-secondary btn-small" onclick="editMaterial(${mat.id}, '${mat.name}', '${mat.icon}', ${mat.weekly_goal || 700})">
                            ✏️ Editar
                        </button>
                        <button class="btn ${mat.active ? 'btn-danger' : 'btn-success'} btn-small" onclick="toggleMaterial(${mat.id})">
                            ${mat.active ? '🚫 Desativar' : '✅ Ativar'}
                        </button>
                    </div>
                </div>
            `).join('');
        } else {
            materialsList.innerHTML = `
                <div class="empty-state">
                    <span>📦</span>
                    <p>Nenhum material cadastrado.</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('Erro ao carregar materiais:', error);
    }
}

// Editar material
async function editMaterial(id, currentName, currentIcon, currentGoal) {
    const newName = prompt('Nome do material:', currentName);
    if (newName === null) return;
    
    const newIcon = prompt('Ícone do material:', currentIcon);
    if (newIcon === null) return;
    
    const newGoal = prompt('Meta semanal:', currentGoal);
    if (newGoal === null) return;
    
    const goalNum = parseInt(newGoal);
    if (isNaN(goalNum) || goalNum < 1) {
        alert('Meta deve ser um número válido maior que 0');
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/materials/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                name: newName || currentName, 
                icon: newIcon || currentIcon, 
                weekly_goal: goalNum 
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            loadMaterials();
            loadMaterialsStats();
        } else {
            alert(data.error || 'Erro ao atualizar material');
        }
    } catch (error) {
        alert('Erro ao atualizar material');
    }
}

// Ativar/Desativar material
async function toggleMaterial(id) {
    try {
        const response = await fetch(`/api/admin/materials/${id}/toggle`, { method: 'POST' });
        const data = await response.json();
        
        if (data.success) {
            loadMaterials();
        } else {
            alert(data.error || 'Erro ao atualizar material');
        }
    } catch (error) {
        alert('Erro ao atualizar material');
    }
}

// Adicionar novo material
document.getElementById('newMaterialForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('materialName').value;
    const icon = document.getElementById('materialIcon').value || '📦';
    const weekly_goal = parseInt(document.getElementById('materialGoal').value) || 700;
    
    const messageEl = document.getElementById('materialMessage');
    
    try {
        const response = await fetch('/api/admin/materials', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, icon, weekly_goal })
        });
        
        const data = await response.json();
        
        if (data.success) {
            messageEl.textContent = 'Material adicionado com sucesso!';
            messageEl.className = 'message show success';
            document.getElementById('newMaterialForm').reset();
            document.getElementById('materialGoal').value = '700';
            loadMaterials();
            loadMaterialsStats();
        } else {
            messageEl.textContent = data.error || 'Erro ao adicionar material';
            messageEl.className = 'message show error';
        }
    } catch (error) {
        messageEl.textContent = 'Erro de conexão';
        messageEl.className = 'message show error';
    }
    
    setTimeout(() => {
        messageEl.className = 'message';
    }, 5000);
});

// ===== TIPOS DE PAGAMENTO =====

// Carregar tipos de pagamento
async function loadPaymentTypes() {
    try {
        const response = await fetch('/api/admin/payment-types');
        const data = await response.json();
        
        const list = document.getElementById('paymentTypesList');
        
        if (data.paymentTypes && data.paymentTypes.length > 0) {
            list.innerHTML = data.paymentTypes.map(pt => `
                <div class="material-manage-item ${pt.active ? '' : 'inactive'}">
                    <div class="material-info">
                        <span class="material-icon">${pt.icon}</span>
                        <span class="material-name">${pt.name}</span>
                        <span class="material-goal-display">Meta: <strong>R$ ${pt.weekly_goal.toLocaleString('pt-BR')}</strong></span>
                        <span class="material-status ${pt.active ? 'active' : 'inactive'}">${pt.active ? '✅ Ativo' : '❌ Inativo'}</span>
                    </div>
                    <div class="material-actions">
                        <button class="btn btn-secondary btn-small" onclick="editPaymentType(${pt.id}, '${pt.name.replace(/'/g, "\\'")}', '${pt.icon}', ${pt.weekly_goal})">
                            ✏️ Editar
                        </button>
                        <button class="btn ${pt.active ? 'btn-danger' : 'btn-success'} btn-small" onclick="togglePaymentType(${pt.id})">
                            ${pt.active ? '🚫 Desativar' : '✅ Ativar'}
                        </button>
                    </div>
                </div>
            `).join('');
        } else {
            list.innerHTML = `
                <div class="empty-state">
                    <span>💰</span>
                    <p>Nenhum tipo de pagamento cadastrado.</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('Erro ao carregar tipos de pagamento:', error);
    }
}

// Editar tipo de pagamento
async function editPaymentType(id, currentName, currentIcon, currentGoal) {
    const newName = prompt('Nome do tipo de pagamento:', currentName);
    if (newName === null) return;
    
    const newIcon = prompt('Ícone:', currentIcon);
    if (newIcon === null) return;
    
    const newGoal = prompt('Meta semanal (R$):', currentGoal);
    if (newGoal === null) return;
    
    const goalNum = parseInt(newGoal);
    if (isNaN(goalNum) || goalNum < 1) {
        alert('Meta deve ser um número válido maior que 0');
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/payment-types/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                name: newName || currentName, 
                icon: newIcon || currentIcon, 
                weekly_goal: goalNum 
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            loadPaymentTypes();
        } else {
            alert(data.error || 'Erro ao atualizar tipo de pagamento');
        }
    } catch (error) {
        alert('Erro ao atualizar tipo de pagamento');
    }
}

// Ativar/Desativar tipo de pagamento
async function togglePaymentType(id) {
    try {
        const response = await fetch(`/api/admin/payment-types/${id}/toggle`, { method: 'POST' });
        const data = await response.json();
        
        if (data.success) {
            loadPaymentTypes();
        } else {
            alert(data.error || 'Erro ao atualizar tipo de pagamento');
        }
    } catch (error) {
        alert('Erro ao atualizar tipo de pagamento');
    }
}

// Adicionar novo tipo de pagamento
document.getElementById('newPaymentTypeForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('paymentTypeName').value;
    const icon = document.getElementById('paymentTypeIcon').value || '💰';
    const weekly_goal = parseInt(document.getElementById('paymentTypeGoal').value) || 50000;
    
    const messageEl = document.getElementById('paymentTypeMessage');
    
    try {
        const response = await fetch('/api/admin/payment-types', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, icon, weekly_goal })
        });
        
        const data = await response.json();
        
        if (data.success) {
            messageEl.textContent = 'Tipo de pagamento adicionado com sucesso!';
            messageEl.className = 'message show success';
            document.getElementById('newPaymentTypeForm').reset();
            document.getElementById('paymentTypeGoal').value = '50000';
            loadPaymentTypes();
        } else {
            messageEl.textContent = data.error || 'Erro ao adicionar tipo de pagamento';
            messageEl.className = 'message show error';
        }
    } catch (error) {
        messageEl.textContent = 'Erro de conexão';
        messageEl.className = 'message show error';
    }
    
    setTimeout(() => {
        messageEl.className = 'message';
    }, 5000);
});

// ===== CONFIGURAÇÕES DO FARM =====

// Carregar configurações do farm
async function loadFarmSettings() {
    try {
        const response = await fetch('/api/admin/farm-settings');
        const data = await response.json();
        
        const settings = data.settings || {};
        
        // Atualizar checkboxes
        const materialsEnabled = document.getElementById('farmMaterialsEnabled');
        const paymentEnabled = document.getElementById('farmPaymentEnabled');
        
        if (materialsEnabled) {
            materialsEnabled.checked = settings.farm_materials_enabled === 'true';
        }
        if (paymentEnabled) {
            paymentEnabled.checked = settings.farm_payment_enabled === 'true';
        }
        
        // Atualizar radio buttons do modo
        const mode = settings.farm_payment_mode || 'either';
        const radioBtn = document.querySelector(`input[name="paymentMode"][value="${mode}"]`);
        if (radioBtn) {
            radioBtn.checked = true;
        }
        
    } catch (error) {
        console.error('Erro ao carregar configurações:', error);
    }
}

// Atualizar configuração do farm
async function updateFarmSetting(key, value) {
    const messageEl = document.getElementById('farmSettingsMessage');
    
    try {
        const response = await fetch(`/api/admin/farm-settings/${key}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: String(value) })
        });
        
        const data = await response.json();
        
        if (data.success) {
            messageEl.textContent = '✅ Configuração atualizada!';
            messageEl.className = 'message show success';
        } else {
            messageEl.textContent = data.error || 'Erro ao atualizar';
            messageEl.className = 'message show error';
        }
    } catch (error) {
        messageEl.textContent = 'Erro de conexão';
        messageEl.className = 'message show error';
    }
    
    setTimeout(() => {
        messageEl.className = 'message';
    }, 3000);
}

// Criar novo membro
document.getElementById('newMemberForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('newName').value.trim();
    const passport = document.getElementById('newPassport').value.trim().toUpperCase();
    const email = document.getElementById('newEmail').value.trim();
    const password = document.getElementById('newPassword').value;
    const role = document.getElementById('newRole').value;
    
    const messageEl = document.getElementById('memberMessage');
    
    if (!name || !passport || !password) {
        messageEl.textContent = 'Nome, passaporte e senha são obrigatórios';
        messageEl.className = 'message show error';
        return;
    }
    
    try {
        const response = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, passport, email, password, role })
        });
        
        const data = await response.json();
        
        if (data.success) {
            messageEl.textContent = 'Membro cadastrado com sucesso!';
            messageEl.className = 'message show success';
            document.getElementById('newMemberForm').reset();
            loadAdminStats();
            loadMembers();
        } else {
            messageEl.textContent = data.error || 'Erro ao cadastrar membro';
            messageEl.className = 'message show error';
        }
    } catch (error) {
        messageEl.textContent = 'Erro de conexão';
        messageEl.className = 'message show error';
    }
    
    setTimeout(() => {
        messageEl.className = 'message';
    }, 5000);
});

// Modal de imagem
function openModal(src) {
    document.getElementById('modalImage').src = src;
    document.getElementById('imageModal').classList.add('show');
}

function closeModal() {
    document.getElementById('imageModal').classList.remove('show');
}

document.getElementById('imageModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
        closeModal();
    }
});

// Helpers
function formatNumber(num) {
    return new Intl.NumberFormat('pt-BR').format(num);
}

function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getStatusText(status) {
    const texts = {
        pending: '⏳ Aguardando Aprovação',
        approved: '✅ Aprovado',
        rejected: '❌ Rejeitado',
        in_progress: '⚡ Em Progresso'
    };
    return texts[status] || status;
}

// ===================== ADVERTÊNCIAS =====================

// Carregar membros para o select de advertência
async function loadMembersForWarning() {
    try {
        const response = await fetch('/api/admin/members');
        const data = await response.json();
        
        const select = document.getElementById('warningMember');
        select.innerHTML = '<option value="">Selecione um membro...</option>';
        
        if (data.members) {
            data.members
                .filter(m => m.passport !== '6999' && m.active)
                .forEach(member => {
                    select.innerHTML += `<option value="${member.id}">${member.name} (${member.passport})</option>`;
                });
        }
    } catch (error) {
        console.error('Erro ao carregar membros:', error);
    }
}

// Carregar histórico de advertências
async function loadWarnings() {
    try {
        const response = await fetch('/api/admin/warnings');
        const data = await response.json();
        
        const warningsList = document.getElementById('warningsList');
        const isSuperAdmin = currentUser && currentUser.passport === '6999';
        
        if (data.warnings && data.warnings.length > 0) {
            warningsList.innerHTML = data.warnings.map(w => `
                <div class="warning-item">
                    <div class="warning-info">
                        <strong>⚠️ ${w.member_name}</strong> <small>(${w.member_passport})</small>
                        <p class="warning-reason">${w.reason}</p>
                        <small>Por: ${w.given_by_name} em ${formatDate(w.created_at)}</small>
                    </div>
                    ${isSuperAdmin ? `
                        <button class="btn btn-danger btn-small" onclick="removeWarning(${w.id})">🗑️ Remover</button>
                    ` : ''}
                </div>
            `).join('');
        } else {
            warningsList.innerHTML = `
                <div class="empty-state">
                    <span>✅</span>
                    <p>Nenhuma advertência registrada.</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('Erro ao carregar advertências:', error);
    }
}

// Aplicar advertência
async function applyWarning() {
    const memberId = document.getElementById('warningMember').value;
    const reason = document.getElementById('warningReason').value.trim();
    
    if (!memberId) {
        alert('Selecione um membro');
        return;
    }
    
    if (!reason) {
        alert('Informe o motivo da advertência');
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/members/${memberId}/warnings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert(data.message);
            document.getElementById('warningMember').value = '';
            document.getElementById('warningReason').value = '';
            loadWarnings();
        } else {
            alert(data.error || 'Erro ao aplicar advertência');
        }
    } catch (error) {
        alert('Erro ao aplicar advertência');
    }
}

// Aplicar ADV por não entregar farm da semana
async function applyWeeklyAdv(memberId, memberName, weekStart, weekEnd) {
    const weekLabel = weekStart && weekEnd ? 
        `${formatWeekDate(weekStart)} - ${formatWeekDate(weekEnd)}` : 
        'semana selecionada';
    
    const confirmMsg = `⚠️ APLICAR ADVERTÊNCIA\n\nMembro: ${memberName}\nMotivo: Não entregou o farm da semana ${weekLabel}\n\nTem certeza?`;
    
    if (!confirm(confirmMsg)) {
        return;
    }
    
    const reason = `Não entregou o farm da semana ${weekLabel}`;
    
    try {
        const response = await fetch(`/api/admin/members/${memberId}/warnings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason, week_start: weekStart, week_end: weekEnd })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert(`✅ ADV aplicada para ${memberName}!`);
            loadWeeklyStatus();
            loadWarnings();
            loadAdminStats();
        } else {
            alert(data.error || 'Erro ao aplicar advertência');
        }
    } catch (error) {
        alert('Erro ao aplicar advertência');
    }
}

// Remover advertência (somente 6999)
async function removeWarning(warningId) {
    if (!confirm('Tem certeza que deseja remover esta advertência?')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/warnings/${warningId}`, { method: 'DELETE' });
        const data = await response.json();
        
        if (data.success) {
            alert(data.message);
            loadWarnings();
        } else {
            alert(data.error || 'Erro ao remover advertência');
        }
    } catch (error) {
        alert('Erro ao remover advertência');
    }
}

// ===== WHITELIST =====

// Carregar whitelist
async function loadWhitelist() {
    try {
        const response = await fetch('/api/admin/whitelist');
        const data = await response.json();
        
        const container = document.getElementById('whitelistList');
        
        if (data.whitelist && data.whitelist.length > 0) {
            container.innerHTML = data.whitelist.map(item => `
                <div class="whitelist-item">
                    <div class="whitelist-info">
                        <span class="whitelist-name">🛡️ ${item.member_name}</span>
                        <span class="whitelist-passport">Passaporte: ${item.member_passport}</span>
                        <span class="whitelist-reason">📝 ${item.reason || 'Sem motivo'}</span>
                        <span class="whitelist-added">Adicionado por ${item.added_by_name} em ${new Date(item.created_at).toLocaleDateString('pt-BR')}</span>
                    </div>
                    <div class="whitelist-actions">
                        <button class="btn btn-danger btn-small" onclick="removeFromWhitelist(${item.user_id}, '${item.member_name}')">
                            ❌ Remover
                        </button>
                    </div>
                </div>
            `).join('');
        } else {
            container.innerHTML = '<div class="empty-state">📋 Nenhum membro na whitelist</div>';
        }
    } catch (error) {
        console.error('Erro ao carregar whitelist:', error);
    }
}

// Carregar membros para select da whitelist
async function loadMembersForWhitelist() {
    try {
        // Buscar todos os membros
        const membersResponse = await fetch('/api/admin/members');
        const membersData = await membersResponse.json();
        
        // Buscar whitelist atual
        const whitelistResponse = await fetch('/api/admin/whitelist');
        const whitelistData = await whitelistResponse.json();
        
        const whitelistIds = whitelistData.whitelist ? whitelistData.whitelist.map(w => w.user_id) : [];
        
        const select = document.getElementById('whitelistMember');
        if (!select) return;
        
        // Filtrar membros que não estão na whitelist
        const availableMembers = membersData.members.filter(m => !whitelistIds.includes(m.id));
        
        select.innerHTML = '<option value="">Selecione um membro...</option>' +
            availableMembers.map(m => `<option value="${m.id}">${m.name} (${m.passport})</option>`).join('');
    } catch (error) {
        console.error('Erro ao carregar membros para whitelist:', error);
    }
}

// Adicionar à whitelist
async function addToWhitelist() {
    const userId = document.getElementById('whitelistMember').value;
    const reason = document.getElementById('whitelistReason').value;
    
    if (!userId) {
        alert('Selecione um membro!');
        return;
    }
    
    try {
        const response = await fetch('/api/admin/whitelist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, reason })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert(data.message);
            document.getElementById('whitelistMember').value = '';
            document.getElementById('whitelistReason').value = '';
            loadWhitelist();
            loadMembersForWhitelist();
            loadWeeklyStatus();
            loadMembersOverview();
        } else {
            alert(data.error || 'Erro ao adicionar à whitelist');
        }
    } catch (error) {
        alert('Erro ao adicionar à whitelist');
    }
}

// Remover da whitelist
async function removeFromWhitelist(userId, memberName) {
    if (!confirm(`Remover ${memberName} da whitelist? Ele voltará a precisar pagar farm.`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/whitelist/${userId}`, { method: 'DELETE' });
        const data = await response.json();
        
        if (data.success) {
            alert(data.message);
            loadWhitelist();
            loadMembersForWhitelist();
            loadWeeklyStatus();
            loadMembersOverview();
        } else {
            alert(data.error || 'Erro ao remover da whitelist');
        }
    } catch (error) {
        alert('Erro ao remover da whitelist');
    }
}

// ===== MEMBERS + ADV =====

let allMembersForAdv = []; // Cache para filtro

// Carregar todos os membros com contagem de ADVs
async function loadMembersForAdv() {
    try {
        const response = await fetch('/api/admin/members-with-advs');
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error);
        }
        
        allMembersForAdv = data.members;
        renderMembersAdvGrid(allMembersForAdv);
        updateMembersAdvStats(data.members);
        
    } catch (error) {
        console.error('Erro ao carregar membros:', error);
        document.getElementById('membersAdvGrid').innerHTML = 
            '<div class="empty-state">❌ Erro ao carregar membros</div>';
    }
}

// Renderizar grid de membros
function renderMembersAdvGrid(members) {
    const container = document.getElementById('membersAdvGrid');
    
    if (!members || members.length === 0) {
        container.innerHTML = '<div class="empty-state">📋 Nenhum membro encontrado</div>';
        return;
    }
    
    container.innerHTML = members.map(member => {
        const advCount = parseInt(member.adv_count) || 0;
        const advCountClass = advCount === 0 ? 'zero' : (advCount >= 3 ? 'high' : '');
        
        return `
            <div class="member-adv-card">
                <div class="member-adv-info">
                    <div class="member-adv-details">
                        <h4>${member.name}</h4>
                        <span class="passport">📋 Passaporte: ${member.passport}</span>
                        <span class="role">👤 ${formatRole(member.role)}</span>
                    </div>
                    <div class="adv-count-badge ${advCountClass}">
                        ${advCount} ADV${advCount !== 1 ? 's' : ''}
                    </div>
                </div>
                <button class="btn-apply-adv" onclick="showAdvModal(${member.id}, '${member.name.replace(/'/g, "\\'")}', ${advCount})">
                    ⚠️ Aplicar ADV
                </button>
            </div>
        `;
    }).join('');
}

// Atualizar estatísticas
function updateMembersAdvStats(members) {
    const totalMembers = members.length;
    const membersWithAdv = members.filter(m => parseInt(m.adv_count) > 0).length;
    const totalAdvs = members.reduce((sum, m) => sum + (parseInt(m.adv_count) || 0), 0);
    
    // Atualizar se existirem elementos de stats
    const statsContainer = document.querySelector('.members-adv-stats');
    if (statsContainer) {
        statsContainer.innerHTML = `
            <div class="stat-item">
                <div class="number">${totalMembers}</div>
                <div class="label">Total Membros</div>
            </div>
            <div class="stat-item">
                <div class="number">${membersWithAdv}</div>
                <div class="label">Com ADV</div>
            </div>
            <div class="stat-item">
                <div class="number">${totalAdvs}</div>
                <div class="label">Total ADVs</div>
            </div>
        `;
    }
}

// Filtrar membros
function filterMembersAdv(searchTerm) {
    const filtered = allMembersForAdv.filter(member => 
        member.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        member.passport.toString().includes(searchTerm)
    );
    renderMembersAdvGrid(filtered);
}

// Abrir modal de ADV
function showAdvModal(memberId, memberName, advCount) {
    const modal = document.getElementById('advMemberModal');
    const memberInfo = modal.querySelector('.modal-member-info');
    const advCountClass = advCount === 0 ? 'zero' : '';
    
    memberInfo.innerHTML = `
        <h3>👤 ${memberName}</h3>
        <p>ID: ${memberId}</p>
        <div class="current-advs ${advCountClass}">
            ⚠️ ADVs atuais: ${advCount}
        </div>
    `;
    
    // Guardar ID do membro no modal
    modal.dataset.memberId = memberId;
    modal.dataset.memberName = memberName;
    
    // Limpar textarea
    document.getElementById('advReason').value = '';
    
    // Mostrar modal
    modal.style.display = 'flex';
}

// Fechar modal de ADV
function closeAdvModal() {
    document.getElementById('advMemberModal').style.display = 'none';
}

// Aplicar ADV pelo modal
async function applyAdvFromModal() {
    const modal = document.getElementById('advMemberModal');
    const memberId = modal.dataset.memberId;
    const memberName = modal.dataset.memberName;
    const reason = document.getElementById('advReason').value.trim();
    
    if (!reason) {
        alert('Por favor, informe o motivo da advertência!');
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/members/${memberId}/warnings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                reason: reason
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert(`✅ Advertência aplicada com sucesso!\n\nMembro: ${memberName}\nMotivo: ${reason}`);
            closeAdvModal();
            loadMembersForAdv(); // Recarregar lista
        } else {
            alert(data.error || 'Erro ao aplicar advertência');
        }
    } catch (error) {
        console.error('Erro ao aplicar ADV:', error);
        alert('Erro ao aplicar advertência');
    }
}

// Formatar role para exibição
function formatRole(role) {
    const roles = {
        'member': 'Membro',
        '01': 'Oficial 01',
        '02': 'Oficial 02',
        'gerente_farm': 'Gerente de Farm',
        'gerente_acao': 'Gerente de Ação',
        'gerente_recrutamento': 'Gerente de Recrutamento',
        'gerente_encomendas': 'Gerente de Encomendas',
        'gerente_geral': 'Gerente Geral'
    };
    return roles[role] || role;
}

// ===== MODAIS DA VISÃO GERAL =====

// Mostrar detalhes do farm do membro
async function showMemberFarmDetails(memberId, memberName) {
    try {
        const weekParams = selectedWeek ? `?week_start=${selectedWeek.start}&week_end=${selectedWeek.end}` : '';
        const response = await fetch(`/api/admin/member-farm-details/${memberId}${weekParams}`);
        const data = await response.json();
        
        if (!data.success) {
            alert(data.error || 'Erro ao carregar dados');
            return;
        }
        
        const modal = document.getElementById('farmDetailsModal');
        const body = document.getElementById('farmDetailsBody');
        
        // Formatar semana
        const weekText = selectedWeek ? 
            `${new Date(selectedWeek.start + 'T00:00:00').toLocaleDateString('pt-BR')} - ${new Date(selectedWeek.end + 'T00:00:00').toLocaleDateString('pt-BR')}` :
            'Semana atual';
        
        let content = `
            <div class="farm-details-member">
                <h3>👤 ${memberName}</h3>
                <p class="week-info">📅 Semana: ${weekText}</p>
            </div>
        `;
        
        if (data.delivery) {
            const statusClass = data.delivery.status === 'approved' ? 'approved' : 
                               (data.delivery.status === 'pending' ? 'pending' : 'rejected');
            const statusText = data.delivery.status === 'approved' ? '✅ Aprovado' : 
                              (data.delivery.status === 'pending' ? '⏳ Aguardando' : '❌ Rejeitado');
            
            content += `
                <div class="farm-details-status ${statusClass}">
                    <span class="status-badge">${statusText}</span>
                    <span class="delivery-date">Entregue em ${new Date(data.delivery.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                
                <div class="farm-details-items">
                    <h4>📦 Materiais Entregues:</h4>
                    <div class="materials-list">
                        ${data.items.map(item => `
                            <div class="material-item">
                                <span class="material-icon">${item.material_icon}</span>
                                <span class="material-name">${item.material_name}</span>
                                <span class="material-amount">${item.amount.toLocaleString('pt-BR')}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
            
            if (data.delivery.description) {
                content += `
                    <div class="farm-details-description">
                        <h4>📝 Observações:</h4>
                        <p>${data.delivery.description}</p>
                    </div>
                `;
            }
            
            if (data.delivery.approved_by_name) {
                content += `
                    <div class="farm-details-approved">
                        <p>✅ Aprovado por: <strong>${data.delivery.approved_by_name}</strong></p>
                    </div>
                `;
            }
            
            if (data.delivery.screenshot_url) {
                content += `
                    <div class="farm-details-screenshot">
                        <h4>📸 Print:</h4>
                        <img src="${data.delivery.screenshot_url}" alt="Screenshot" onclick="window.open('${data.delivery.screenshot_url}', '_blank')">
                    </div>
                `;
            }
        } else if (data.justification) {
            const statusClass = data.justification.status === 'approved' ? 'approved' : 
                               (data.justification.status === 'pending' ? 'pending' : 'rejected');
            const statusText = data.justification.status === 'approved' ? '✅ Justificativa Aceita' : 
                              (data.justification.status === 'pending' ? '⏳ Justificativa Pendente' : '❌ Justificativa Rejeitada');
            
            content += `
                <div class="farm-details-status ${statusClass}">
                    <span class="status-badge">${statusText}</span>
                </div>
                <div class="farm-details-justification">
                    <h4>📋 Justificativa Enviada:</h4>
                    <p>${data.justification.reason}</p>
                </div>
            `;
            
            if (data.justification.status === 'approved' && data.justification.approved_by_name) {
                content += `
                    <div class="farm-details-approved">
                        <p>✅ Aprovada por: <strong>${data.justification.approved_by_name}</strong></p>
                        <p class="approved-date">Em ${new Date(data.justification.updated_at || data.justification.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                `;
            } else if (data.justification.status === 'rejected' && data.justification.approved_by_name) {
                content += `
                    <div class="farm-details-rejected">
                        <p>❌ Rejeitada por: <strong>${data.justification.approved_by_name}</strong></p>
                        <p class="rejected-info">O membro precisa entregar o farm ou enviar nova justificativa.</p>
                    </div>
                `;
            }
        } else {
            content += `
                <div class="farm-details-empty">
                    <div class="empty-icon">❌</div>
                    <p>Nenhum farm entregue nesta semana</p>
                </div>
            `;
        }
        
        body.innerHTML = content;
        modal.style.display = 'flex';
    } catch (error) {
        console.error('Erro ao carregar detalhes do farm:', error);
        alert('Erro ao carregar detalhes');
    }
}

// Fechar modal de detalhes do farm
function closeFarmDetailsModal() {
    document.getElementById('farmDetailsModal').style.display = 'none';
}

// Mostrar advertências do membro
async function showMemberWarningsModal(memberId, memberName) {
    try {
        const response = await fetch(`/api/admin/member-warnings/${memberId}`);
        const data = await response.json();
        
        if (!data.success) {
            alert(data.error || 'Erro ao carregar dados');
            return;
        }
        
        const modal = document.getElementById('memberWarningsModal');
        const body = document.getElementById('memberWarningsBody');
        
        // Guardar dados para refresh
        modal.dataset.memberId = memberId;
        modal.dataset.memberName = memberName;
        
        let content = `
            <div class="warnings-member-info">
                <h3>👤 ${memberName}</h3>
                <p class="warnings-total">Total de advertências: <strong>${data.count}</strong></p>
            </div>
        `;
        
        if (data.warnings && data.warnings.length > 0) {
            content += `
                <div class="warnings-list">
                    ${data.warnings.map((warning, index) => `
                        <div class="warning-detail-item">
                            <div class="warning-number">#${data.warnings.length - index}</div>
                            <div class="warning-content">
                                <div class="warning-reason-text">📝 ${warning.reason}</div>
                                <div class="warning-meta-info">
                                    <span>👤 Aplicada por: <strong>${warning.given_by_name}</strong></span>
                                    <span>📅 ${new Date(warning.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                            </div>
                            <button class="btn btn-danger btn-small" onclick="removeWarning(${warning.id}, '${memberName.replace(/'/g, "\\'")}')">
                                🗑️ Remover
                            </button>
                        </div>
                    `).join('')}
                </div>
            `;
        } else {
            content += `
                <div class="no-warnings-found">
                    <div class="icon">✅</div>
                    <p>Este membro não possui advertências!</p>
                </div>
            `;
        }
        
        body.innerHTML = content;
        modal.style.display = 'flex';
    } catch (error) {
        console.error('Erro ao carregar advertências:', error);
        alert('Erro ao carregar advertências');
    }
}

// Remover advertência
async function removeWarning(warningId, memberName) {
    const removal_reason = prompt(`Motivo para remover a ADV de ${memberName}:`);
    
    if (removal_reason === null) return; // Cancelou
    
    if (!removal_reason.trim()) {
        alert('É obrigatório informar o motivo da remoção!');
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/warnings/${warningId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ removal_reason: removal_reason.trim() })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert(data.message);
            
            // Recarregar o modal
            const modal = document.getElementById('memberWarningsModal');
            const memberId = modal.dataset.memberId;
            const name = modal.dataset.memberName;
            
            if (memberId && name) {
                showMemberWarningsModal(memberId, name);
            }
            
            // Recarregar dados das páginas
            loadWeeklyStatus();
            loadMembersForAdv();
        } else {
            alert(data.error || 'Erro ao remover advertência');
        }
    } catch (error) {
        console.error('Erro ao remover advertência:', error);
        alert('Erro ao remover advertência');
    }
}

// Fechar modal de advertências do membro
function closeMemberWarningsModal() {
    document.getElementById('memberWarningsModal').style.display = 'none';
}

// Fechar modal ao clicar fora
document.addEventListener('click', function(e) {
    const advModal = document.getElementById('advMemberModal');
    const farmDetailsModal = document.getElementById('farmDetailsModal');
    const memberWarningsModal = document.getElementById('memberWarningsModal');
    const notificationsDropdown = document.getElementById('notificationsDropdown');
    const notificationBell = document.getElementById('notificationBell');
    const userDropdown = document.getElementById('userDropdown');
    const userTrigger = document.querySelector('.user-dropdown-trigger');
    
    if (e.target === advModal) {
        closeAdvModal();
    }
    if (e.target === farmDetailsModal) {
        closeFarmDetailsModal();
    }
    if (e.target === memberWarningsModal) {
        closeMemberWarningsModal();
    }
    // Fechar dropdown de notificações ao clicar fora
    if (notificationsDropdown && notificationBell && 
        !notificationsDropdown.contains(e.target) && !notificationBell.contains(e.target)) {
        notificationsDropdown.classList.remove('show');
    }
    // Fechar dropdown de usuário ao clicar fora
    if (userDropdown && userTrigger && 
        !userDropdown.contains(e.target) && !userTrigger.contains(e.target)) {
        closeUserDropdown();
    }
});

// ==================== SISTEMA DE NOTIFICAÇÕES ADMIN ====================

// Carregar notificações do admin
async function loadAdminNotifications() {
    adminNotifications = [];
    
    try {
        // Buscar farms pendentes
        const pendingRes = await fetch('/api/admin/deliveries/pending');
        if (!pendingRes.ok) throw new Error('Erro ao buscar pendentes');
        const pendingData = await pendingRes.json();
        
        // Buscar justificativas pendentes
        const justRes = await fetch('/api/admin/justifications/pending');
        if (!justRes.ok) throw new Error('Erro ao buscar justificativas');
        const justData = await justRes.json();
        
        const today = new Date();
        const dayOfWeek = today.getDay();
        
        // Notificações de farms pendentes de aprovação
        if (pendingData.deliveries && pendingData.deliveries.length > 0) {
            pendingData.deliveries.forEach(d => {
                adminNotifications.push({
                    id: `pending_${d.id}`,
                    type: 'pending',
                    icon: '📦',
                    title: 'Farm para Aprovar',
                    message: `${d.user_name} (${d.user_passport}) submeteu farm para aprovação`,
                    time: formatTimeAgo(d.created_at),
                    action: 'pending',
                    userId: d.user_id
                });
            });
        }
        
        // Notificações de justificativas pendentes
        if (justData.justifications && justData.justifications.length > 0) {
            justData.justifications.forEach(j => {
                adminNotifications.push({
                    id: `just_${j.id}`,
                    type: 'info',
                    icon: '📝',
                    title: 'Justificativa Pendente',
                    message: `${j.user_name} enviou justificativa de ausência`,
                    time: formatTimeAgo(j.created_at),
                    action: 'absences',
                    userId: j.user_id
                });
            });
        }
        
        // Notificações de membros sem farm (nos últimos 2 dias da semana)
        // Usar weekly-status ao invés de week-status
        if (dayOfWeek === 6 || dayOfWeek === 0) {
            try {
                const statusRes = await fetch('/api/admin/weekly-status');
                if (statusRes.ok) {
                    const statusData = await statusRes.json();
                    if (statusData.notDelivered && statusData.notDelivered.length > 0) {
                        // Agrupar em uma notificação
                        adminNotifications.push({
                            id: 'missing_farms',
                            type: 'warning',
                            icon: '⚠️',
                            title: 'Membros sem Farm!',
                            message: `${statusData.notDelivered.length} membro(s) ainda não pagaram o farm esta semana`,
                            time: dayOfWeek === 0 ? 'ÚLTIMO DIA!' : 'Faltam 2 dias',
                            action: 'weekly-status'
                        });
                        
                        // Notificação individual para os primeiros 5
                        statusData.notDelivered.slice(0, 5).forEach(m => {
                            adminNotifications.push({
                                id: `missing_${m.id}`,
                                type: 'warning',
                                icon: '❌',
                                title: 'Farm Pendente',
                                message: `${m.name} (${m.passport}) não entregou farm`,
                                time: 'Esta semana',
                                action: 'adv',
                                userId: m.id,
                                userName: m.name
                            });
                        });
                    }
                }
            } catch (e) {
                console.log('Aviso: Não foi possível carregar status semanal para notificações');
            }
        }
        
        updateAdminNotificationBadge();
        
    } catch (error) {
        console.error('Erro ao carregar notificações:', error);
    }
}

// Atualizar badge de notificações do admin
function updateAdminNotificationBadge() {
    const badge = document.getElementById('notificationBadge');
    const bell = document.getElementById('notificationBell');
    
    const readIds = JSON.parse(localStorage.getItem('adminReadNotifications') || '[]');
    const unreadCount = adminNotifications.filter(n => !readIds.includes(n.id)).length;
    
    if (unreadCount > 0) {
        badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
        badge.style.display = 'flex';
        bell.classList.add('has-notifications');
    } else {
        badge.style.display = 'none';
        bell.classList.remove('has-notifications');
    }
}

// Toggle dropdown de notificações
function toggleAdminNotifications() {
    const dropdown = document.getElementById('notificationsDropdown');
    dropdown.classList.toggle('show');
    
    if (dropdown.classList.contains('show')) {
        renderAdminNotifications();
    }
}

// Renderizar notificações do admin
function renderAdminNotifications() {
    const list = document.getElementById('notificationsList');
    
    if (adminNotifications.length === 0) {
        list.innerHTML = '<div class="notification-empty">🔕 Nenhuma notificação</div>';
        return;
    }
    
    const readIds = JSON.parse(localStorage.getItem('adminReadNotifications') || '[]');
    
    list.innerHTML = adminNotifications.map(n => {
        const isRead = readIds.includes(n.id);
        let actionBtn = '';
        
        if (n.action === 'adv' && n.userId) {
            actionBtn = `<div class="notification-action"><button class="btn btn-small btn-danger" onclick="openAdvModalFromNotification(${n.userId}, '${n.userName}')">Aplicar ADV</button></div>`;
        } else if (n.action === 'pending') {
            actionBtn = `<div class="notification-action"><button class="btn btn-small btn-primary" onclick="goToTabFromNotification('pending')">Ver Farm</button></div>`;
        } else if (n.action === 'absences') {
            actionBtn = `<div class="notification-action"><button class="btn btn-small btn-secondary" onclick="goToTabFromNotification('absences')">Ver Justificativa</button></div>`;
        } else if (n.action === 'weekly-status') {
            actionBtn = `<div class="notification-action"><button class="btn btn-small btn-warning" onclick="goToTabFromNotification('weekly-status')">Ver Status</button></div>`;
        }
        
        return `
            <div class="notification-item ${n.type} ${isRead ? 'read' : 'unread'}" onclick="markAdminNotificationRead('${n.id}')">
                <span class="notification-icon">${n.icon}</span>
                <div class="notification-content">
                    <div class="notification-title">${n.title}</div>
                    <div class="notification-message">${n.message}</div>
                    <div class="notification-time">${n.time}</div>
                    ${actionBtn}
                </div>
                ${!isRead ? '<span class="unread-dot"></span>' : ''}
            </div>
        `;
    }).join('');
}

// Marcar notificação como lida
function markAdminNotificationRead(id) {
    const readIds = JSON.parse(localStorage.getItem('adminReadNotifications') || '[]');
    if (!readIds.includes(id)) {
        readIds.push(id);
        localStorage.setItem('adminReadNotifications', JSON.stringify(readIds));
        updateAdminNotificationBadge();
        renderAdminNotifications();
    }
}

// Marcar todas como lidas
function markAllAdminAsRead() {
    const readIds = JSON.parse(localStorage.getItem('adminReadNotifications') || '[]');
    adminNotifications.forEach(n => {
        if (!readIds.includes(n.id)) {
            readIds.push(n.id);
        }
    });
    localStorage.setItem('adminReadNotifications', JSON.stringify(readIds));
    updateAdminNotificationBadge();
    renderAdminNotifications();
}

// Ir para aba a partir da notificação
function goToTabFromNotification(tabName) {
    document.getElementById('notificationsDropdown').classList.remove('show');
    
    // Ativar a tab
    document.querySelectorAll('.sidebar-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.tab === tabName) {
            item.classList.add('active');
        }
    });
    
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    
    const targetTab = document.getElementById(`${tabName}-tab`);
    if (targetTab) {
        targetTab.classList.add('active');
    }
}

// Abrir modal de ADV a partir da notificação
function openAdvModalFromNotification(userId, userName) {
    document.getElementById('notificationsDropdown').classList.remove('show');
    openAdvModal(userId, userName);
}

// Formatar tempo relativo
function formatTimeAgo(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Agora';
    if (diffMins < 60) return `${diffMins}min atrás`;
    if (diffHours < 24) return `${diffHours}h atrás`;
    if (diffDays < 7) return `${diffDays}d atrás`;
    return date.toLocaleDateString('pt-BR');
}

// ==================== FIM SISTEMA DE NOTIFICAÇÕES ADMIN ====================

// ==================== RELATÓRIO SEMANAL ====================

let reportData = null;
let reportWeekOffset = 0;

// Carregar relatório semanal
async function loadWeeklyReport() {
    const container = document.getElementById('reportPreview');
    if (!container) return;
    
    container.innerHTML = `
        <div class="report-loading">
            <div class="spinner"></div>
            <p>Carregando relatório...</p>
        </div>
    `;
    
    try {
        // Primeiro, pegar informações da semana
        const weekResponse = await fetch(`/api/admin/week/${reportWeekOffset}`);
        const weekData = await weekResponse.json();
        
        // Buscar dados dos membros para a semana
        const params = `?week_start=${weekData.week.start}&week_end=${weekData.week.end}`;
        const response = await fetch(`/api/admin/members-overview${params}`);
        const data = await response.json();
        
        if (!response.ok) throw new Error(data.error || 'Erro ao carregar relatório');
        
        // Separar quem pagou e quem não pagou
        const paid = [];
        const notPaid = [];
        
        data.members.forEach(member => {
            // Determinar texto do tipo de pagamento
            let paymentTypeText = '';
            if (member.paymentType === 'dirty_money' || member.paymentType?.startsWith('payment_')) {
                const typeName = member.paymentTypeName || 'Dinheiro Sujo';
                paymentTypeText = `${typeName} (R$ ${formatNumber(member.dirtyMoneyAmount || 0)})`;
            } else if (member.farmStatus === 'approved') {
                paymentTypeText = 'Materiais';
            }
            
            const memberData = {
                id: member.id,
                name: member.name,
                passport: member.passport,
                role: roleNames[member.role] || member.role,
                farmStatus: member.farmStatus,
                paymentType: member.paymentType,
                paymentTypeText: paymentTypeText,
                dirtyMoneyAmount: member.dirtyMoneyAmount || 0
            };
            
            // Considera "pagou" se tem farm aprovado ou justificativa aprovada
            if (member.farmStatus === 'approved' || member.farmStatus === 'justified') {
                paid.push(memberData);
            } else {
                notPaid.push(memberData);
            }
        });
        
        // Salvar dados para exportação
        reportData = {
            week: weekData.week,
            paid,
            notPaid,
            total: data.members.length,
            rate: data.members.length > 0 ? Math.round((paid.length / data.members.length) * 100) : 0
        };
        
        // Renderizar tabelas
        renderReport(reportData);
        
    } catch (error) {
        console.error('Erro ao carregar relatório:', error);
        container.innerHTML = `
            <div class="report-error">
                <div class="icon">❌</div>
                <p>Erro ao carregar relatório: ${error.message}</p>
            </div>
        `;
    }
}

// Renderizar relatório
function renderReport(data) {
    const container = document.getElementById('reportPreview');
    
    container.innerHTML = `
        <div class="report-content">
            <div class="report-section paid">
                <div class="report-section-header">
                    <span class="icon">✅</span>
                    <span>Pagaram o Farm</span>
                    <span class="count">${data.paid.length}</span>
                </div>
                <div class="report-table-container">
                    <table class="report-table">
                        <thead>
                            <tr>
                                <th>Passaporte</th>
                                <th>Nome</th>
                                <th>Cargo</th>
                                <th>Tipo Pagamento</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.paid.length > 0 ? data.paid.map(m => `
                                <tr>
                                    <td>${m.passport}</td>
                                    <td>${m.name}</td>
                                    <td>${m.role}</td>
                                    <td>${m.farmStatus === 'justified' ? '-' : (m.paymentTypeText || 'Materiais')}</td>
                                    <td>${m.farmStatus === 'justified' ? 'Justificado' : 'Pago'}</td>
                                </tr>
                            `).join('') : '<tr><td colspan="5" style="text-align:center;color:#888;">Nenhum membro</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>
            
            <div class="report-section not-paid">
                <div class="report-section-header">
                    <span class="icon">❌</span>
                    <span>Não Pagaram</span>
                    <span class="count">${data.notPaid.length}</span>
                </div>
                <div class="report-table-container">
                    <table class="report-table">
                        <thead>
                            <tr>
                                <th>Passaporte</th>
                                <th>Nome</th>
                                <th>Cargo</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.notPaid.length > 0 ? data.notPaid.map(m => {
                                let statusText = 'Sem Entrega';
                                if (m.farmStatus === 'pending') statusText = 'Aguardando Aprovação';
                                else if (m.farmStatus === 'rejected') statusText = 'Rejeitado';
                                else if (m.farmStatus === 'justification_pending') statusText = 'Justificativa Pendente';
                                return `
                                    <tr>
                                        <td>${m.passport}</td>
                                        <td>${m.name}</td>
                                        <td>${m.role}</td>
                                        <td>${statusText}</td>
                                    </tr>
                                `;
                            }).join('') : '<tr><td colspan="4" style="text-align:center;color:#888;">Nenhum membro</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
        
        <div class="report-summary">
            <div class="summary-card total">
                <div class="value">${data.total}</div>
                <div class="label">Total de Membros</div>
            </div>
            <div class="summary-card paid">
                <div class="value">${data.paid.length}</div>
                <div class="label">Pagaram</div>
            </div>
            <div class="summary-card not-paid">
                <div class="value">${data.notPaid.length}</div>
                <div class="label">Não Pagaram</div>
            </div>
            <div class="summary-card rate">
                <div class="value">${data.rate}%</div>
                <div class="label">Taxa de Pagamento</div>
            </div>
        </div>
    `;
}

// Mudar semana do relatório
function changeReportWeek() {
    const select = document.getElementById('reportWeekSelect');
    reportWeekOffset = parseInt(select.value);
    loadWeeklyReport();
}

// Gerar PDF do relatório
async function generateReportPDF() {
    if (!reportData) {
        alert('Carregue o relatório primeiro!');
        return;
    }
    
    // Criar conteúdo HTML para impressão
    const printContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Relatório Semanal - Farm Ghosts</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 20px; }
                h1 { color: #333; text-align: center; }
                h2 { color: #666; margin-top: 30px; border-bottom: 2px solid #ddd; padding-bottom: 10px; }
                .info { text-align: center; color: #888; margin-bottom: 30px; }
                table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
                th { background: #f5f5f5; }
                .summary { display: flex; justify-content: space-around; margin: 30px 0; }
                .summary-item { text-align: center; }
                .summary-item .value { font-size: 24px; font-weight: bold; }
                .summary-item .label { color: #888; }
                .paid { color: #27ae60; }
                .not-paid { color: #e74c3c; }
                @media print {
                    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                }
            </style>
        </head>
        <body>
            <h1>📋 Relatório Semanal de Farm</h1>
            <div class="info">
                <strong>Semana:</strong> ${reportData.week.label}<br>
                <strong>Gerado em:</strong> ${new Date().toLocaleString('pt-BR')}
            </div>
            
            <div class="summary">
                <div class="summary-item">
                    <div class="value">${reportData.total}</div>
                    <div class="label">Total</div>
                </div>
                <div class="summary-item">
                    <div class="value paid">${reportData.paid.length}</div>
                    <div class="label">Pagaram</div>
                </div>
                <div class="summary-item">
                    <div class="value not-paid">${reportData.notPaid.length}</div>
                    <div class="label">Não Pagaram</div>
                </div>
                <div class="summary-item">
                    <div class="value">${reportData.rate}%</div>
                    <div class="label">Taxa</div>
                </div>
            </div>
            
            <h2 class="paid">✅ Pagaram o Farm (${reportData.paid.length})</h2>
            <table>
                <thead>
                    <tr>
                        <th>Passaporte</th>
                        <th>Nome</th>
                        <th>Cargo</th>
                        <th>Tipo Pagamento</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${reportData.paid.map(m => `
                        <tr>
                            <td>${m.passport}</td>
                            <td>${m.name}</td>
                            <td>${m.role}</td>
                            <td>${m.farmStatus === 'justified' ? '-' : (m.paymentTypeText || 'Materiais')}</td>
                            <td>${m.farmStatus === 'justified' ? 'Justificado' : 'Pago'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            
            <h2 class="not-paid">❌ Não Pagaram (${reportData.notPaid.length})</h2>
            <table>
                <thead>
                    <tr>
                        <th>Passaporte</th>
                        <th>Nome</th>
                        <th>Cargo</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${reportData.notPaid.map(m => {
                        let statusText = 'Sem Entrega';
                        if (m.farmStatus === 'pending') statusText = 'Aguardando Aprovação';
                        else if (m.farmStatus === 'rejected') statusText = 'Rejeitado';
                        else if (m.farmStatus === 'justification_pending') statusText = 'Justificativa Pendente';
                        return `
                            <tr>
                                <td>${m.passport}</td>
                                <td>${m.name}</td>
                                <td>${m.role}</td>
                                <td>${statusText}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </body>
        </html>
    `;
    
    // Abrir janela para impressão
    const printWindow = window.open('', '_blank');
    printWindow.document.write(printContent);
    printWindow.document.close();
    printWindow.onload = function() {
        printWindow.print();
    };
}

// Gerar Excel do relatório (CSV)
function generateReportExcel() {
    if (!reportData) {
        alert('Carregue o relatório primeiro!');
        return;
    }
    
    // Criar conteúdo CSV
    let csv = 'sep=;\n'; // Para Excel reconhecer separador
    csv += 'RELATÓRIO SEMANAL DE FARM - GHOSTS\n';
    csv += `Semana;${reportData.week.label}\n`;
    csv += `Gerado em;${new Date().toLocaleString('pt-BR')}\n`;
    csv += '\n';
    csv += 'RESUMO\n';
    csv += `Total de Membros;${reportData.total}\n`;
    csv += `Pagaram;${reportData.paid.length}\n`;
    csv += `Não Pagaram;${reportData.notPaid.length}\n`;
    csv += `Taxa de Pagamento;${reportData.rate}%\n`;
    csv += '\n';
    csv += 'PAGARAM O FARM\n';
    csv += 'Passaporte;Nome;Cargo;Tipo Pagamento;Status\n';
    reportData.paid.forEach(m => {
        const status = m.farmStatus === 'justified' ? 'Justificado' : 'Pago';
        const tipoPagamento = m.farmStatus === 'justified' ? '-' : (m.paymentTypeText || 'Materiais');
        csv += `${m.passport};${m.name};${m.role};${tipoPagamento};${status}\n`;
    });
    csv += '\n';
    csv += 'NÃO PAGARAM\n';
    csv += 'Passaporte;Nome;Cargo;Status\n';
    reportData.notPaid.forEach(m => {
        let statusText = 'Sem Entrega';
        if (m.farmStatus === 'pending') statusText = 'Aguardando Aprovação';
        else if (m.farmStatus === 'rejected') statusText = 'Rejeitado';
        else if (m.farmStatus === 'justification_pending') statusText = 'Justificativa Pendente';
        csv += `${m.passport};${m.name};${m.role};${statusText}\n`;
    });
    
    // Criar blob e download
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `relatorio_farm_${reportData.week.start}_${reportData.week.end}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ==================== FIM RELATÓRIO SEMANAL ====================

// ==================== PERMISSÕES DE EDIÇÃO ====================

async function loadEditPermissions() {
    const container = document.getElementById('editPermissionsList');
    if (!container) {
        console.error('Container editPermissionsList não encontrado!');
        return;
    }
    
    container.innerHTML = '<p class="loading">Carregando...</p>';
    
    try {
        console.log('Buscando permissões de edição...');
        const response = await fetch('/api/admin/edit-permissions');
        console.log('Response status:', response.status);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Data recebida:', data);
        
        if (!data.success) {
            container.innerHTML = '<p class="error">Erro ao carregar permissões</p>';
            return;
        }
        
        if (!data.members || data.members.length === 0) {
            container.innerHTML = '<div class="empty-state">😴 Nenhum membro encontrado</div>';
            return;
        }
        
        container.innerHTML = `
            <table class="members-table edit-permissions-table">
                <thead>
                    <tr>
                        <th>Membro</th>
                        <th>Cargo</th>
                        <th>Status</th>
                        <th>Ação</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.members.map(member => `
                        <tr class="${member.hasPermission ? 'has-permission' : ''}">
                            <td>
                                <div class="member-info-cell">
                                    <strong>${member.name}</strong>
                                    <span class="member-passport">ID: ${member.passport}</span>
                                </div>
                            </td>
                            <td>${roleNames[member.role] || member.role}</td>
                            <td>
                                ${member.hasPermission ? `
                                    <span class="permission-badge granted">
                                        ✏️ Liberado
                                    </span>
                                ` : `
                                    <span class="permission-badge locked">🔒 Bloqueado</span>
                                `}
                            </td>
                            <td>
                                ${member.hasPermission ? `
                                    <button class="btn btn-small btn-danger" onclick="revokeEditPermission(${member.id}, '${member.name.replace(/'/g, "\\'")}')">
                                        🔒 Bloquear
                                    </button>
                                ` : `
                                    <button class="btn btn-small btn-success" onclick="grantEditPermission(${member.id}, '${member.name.replace(/'/g, "\\'")}')">
                                        ✏️ Liberar
                                    </button>
                                `}
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch (error) {
        console.error('Erro ao carregar permissões:', error);
        container.innerHTML = `<p class="error">Erro ao carregar: ${error.message}</p>`;
    }
}

async function grantEditPermission(userId, userName) {
    if (!confirm(`Liberar edição de valores para ${userName}?\n\nO membro poderá editar os totais em qualquer semana.`)) return;
    
    try {
        const response = await fetch('/api/admin/edit-permissions/grant', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: userId,
                reason: 'Correção de valores'
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            alert(`✅ Edição liberada para ${userName}!`);
            loadEditPermissions();
        } else {
            alert(result.error || 'Erro ao liberar');
        }
    } catch (error) {
        alert('Erro ao liberar permissão');
    }
}

async function revokeEditPermission(userId, userName) {
    if (!confirm(`Revogar permissão de edição de ${userName}?`)) return;
    
    try {
        const response = await fetch('/api/admin/edit-permissions/revoke', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            alert(`🚫 Permissão revogada de ${userName}`);
            loadEditPermissions();
        } else {
            alert(result.error || 'Erro ao revogar');
        }
    } catch (error) {
        alert('Erro ao revogar permissão');
    }
}

// ==================== FIM PERMISSÕES DE EDIÇÃO ====================

// Inicializa
checkAuth();
