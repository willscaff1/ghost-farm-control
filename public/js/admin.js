let currentUser = null;
let currentWeek = null;
let selectedWeekOffset = 0; // 0 = semana atual, +1 = próxima, +2 = próxima+1, etc
let selectedWeek = null;
let adminNotifications = [];
let currentUserPermissions = null; // Permissões carregadas do banco

// Helper para escapar HTML e evitar XSS quando usamos innerHTML
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
const adminRoles = ['super_admin', '01', '02', 'gerente_farm', 'gerente_acao', 'gerente_recrutamento', 'gerente_encomendas', 'gerente_geral'];

// Nomes de exibição dos grupos (carregados dinamicamente do banco)
let roleNames = {};

// Função para mostrar notificação toast
function showNotification(message, type = 'success') {
    // Remover notificação existente
    const existing = document.getElementById('toastNotification');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.id = 'toastNotification';
    toast.className = `toast-notification ${type}`;
    
    const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️';
    
    toast.innerHTML = `
        <span class="toast-icon">${icon}</span>
        <span class="toast-message">${escapeHtml(message)}</span>
    `;
    
    document.body.appendChild(toast);
    
    // Animar entrada
    setTimeout(() => toast.classList.add('show'), 10);
    
    // Remover após 3 segundos
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Verificar se usuário pode visualizar competições
function canViewCompetitions() {
    if (!currentUser) return false;
    const userGroup = currentUser.group || currentUser.role;
    const userGroups = currentUser.groups || [userGroup];
    const canView = userGroups.some(g => ['super_admin', '01', '02', 'gerente_geral'].includes(g));
    return canView;
}

// Carregar nomes de exibição dos grupos do banco
async function loadRoleNames() {
    try {
        const response = await fetch('/api/admin/role-permissions');
        if (response.ok) {
            const data = await response.json();
            roleNames = {};
            data.roles.forEach(role => {
                roleNames[role.role_name] = role.display_name;
            });
            console.log('📋 Nomes dos grupos carregados:', roleNames);
        }
    } catch (error) {
        console.error('Erro ao carregar nomes dos grupos:', error);
        // Fallback básico
        roleNames = {
            'member': 'Membro',
            'super_admin': 'Super Admin',
            'gerente_geral': 'Gerente Geral'
        };
    }
}

// Verificar se usuário pode alterar cargos (superadmin, 01, 02, gerente_geral)
function canChangeRoles() {
    if (!currentUser) return false;
    
    // Passaporte 6999 (superadmin) sempre pode
    if (currentUser.passport === '6999') return true;
    
    // Verificar se tem grupos 01, 02 ou gerente_geral
    const userGroups = currentUser.groups || [currentUser.role];
    return userGroups.some(g => ['01', '02', 'gerente_geral', 'super_admin'].includes(g));
}

// Carregar permissões do banco de dados
async function loadUserPermissions(userGroups) {
    try {
        // Se receber apenas uma string, converter para array
        const groups = Array.isArray(userGroups) ? userGroups : [userGroups];
        
        // Carregar permissões de todos os grupos
        const allPermissions = [];
        let mergedPermissions = new Set();
        let canConfig = false;
        
        for (const groupName of groups) {
            const response = await fetch(`/api/admin/role-permissions/${groupName}`);
            if (response.ok) {
                const groupPerms = await response.json();
                allPermissions.push(groupPerms);
                
                // Merge: se qualquer grupo tem a permissão, o usuário tem
                if (groupPerms.permissions) {
                    groupPerms.permissions.forEach(perm => mergedPermissions.add(perm));
                }
                
                // Se qualquer grupo pode configurar, o usuário pode
                if (groupPerms.can_config) {
                    canConfig = true;
                }
            }
        }
        
        // Criar objeto de permissões combinadas
        currentUserPermissions = {
            permissions: Array.from(mergedPermissions),
            can_config: canConfig
        };
        
        console.log('🔐 Permissões combinadas de', groups.length, 'grupos:', currentUserPermissions);
        return currentUserPermissions;
        
    } catch (error) {
        console.error('Erro ao carregar permissões:', error);
    }
    // Fallback para permissão total se erro
    return { permissions: ['all'], can_config: true };
}

// Verificar se o usuário tem acesso a uma tab
function hasAccessToTab(tabId) {
    if (!currentUserPermissions) return true;
    if (currentUserPermissions.permissions.includes('all')) return true;
    return currentUserPermissions.permissions.includes(tabId);
}

// Aplicar permissões na sidebar - ocultar tabs não permitidas
function applyRolePermissions() {
    if (!currentUser || !currentUserPermissions) return;
    
    const perms = currentUserPermissions;
    
    // Ocultar/mostrar tabs baseado nas permissões
    document.querySelectorAll('.sidebar-item[data-tab]').forEach(item => {
        const tabId = item.dataset.tab;
        
        if (perms.permissions.includes('all') || perms.permissions.includes(tabId)) {
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
        if (title.textContent.includes('Configurações') && !perms.can_config) {
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
        if (item.textContent.includes('Gerenciar Materiais') && !perms.can_config) {
            item.style.display = 'none';
        }
        if (item.textContent.includes('Cadastrar Membro') && !perms.permissions.includes('new-member') && !perms.permissions.includes('all')) {
            item.style.display = 'none';
        }
    });
}

// Verifica autenticação e permissão de admin
async function checkAuth() {
    try {
        const response = await fetch('/api/auth/me');
        
        if (response.status === 403) {
            // Usuário desativado
            alert('Sua conta foi desativada. Entre em contato com um administrador.');
            window.location.href = '/';
            return;
        }
        
        const data = await response.json();
        
        // Verificar se o usuário tem pelo menos um grupo administrativo
        const userGroups = data.user?.groups || [data.user?.role];
        // Considerar admin qualquer grupo que não seja apenas "member"
        const hasAdminAccess = userGroups.some(group => group !== 'member');
        
        if (data.user && hasAdminAccess) {
            currentUser = data.user;
            
            // Usar o primeiro grupo administrativo para display
            const primaryAdminRole = userGroups.find(g => adminRoles.includes(g)) || userGroups[0];
            
            document.getElementById('userName').textContent = currentUser.name;
            document.getElementById('userRole').textContent = roleNames[primaryAdminRole] || primaryAdminRole;
            document.getElementById('userRole').className = 'role-badge-mini';
            
            // Dropdown info
            document.getElementById('dropdownUserName').textContent = currentUser.name;
            document.getElementById('dropdownUserRole').textContent = roleNames[primaryAdminRole] || primaryAdminRole;
            
            // Carregar permissões de TODOS os grupos do usuário (merge com OR - mais permissões ganham)
            await loadUserPermissions(userGroups);
            
            // Aplicar permissões baseadas no cargo
            applyRolePermissions();
            
            // Carregar dados iniciais de forma otimizada (paralela)
            await loadInitialData();
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
        case 'weekly-ranking': 
            loadWeeklyRankingTab(); 
            break;
        case 'members-overview': loadMembersOverview(); break;
        case 'absences': loadJustifications(); break;
        case 'pending': loadPendingDeliveries(); break;
        case 'password-resets': loadPasswordResets(); break;
        case 'members': loadMembers(); break; // Sempre recarregar para pegar grupos atualizados
        case 'new-member': break;
        case 'farm-settings': loadFarmSettings(); break;
        case 'competitions': 
            // Iframe carrega automaticamente
            console.log('🏆 Aba de competições aberta (iframe)');
            break;
        case 'manage-materials': loadMaterials(); break;
        case 'manage-payment-types': loadPaymentTypes(); break;
        case 'goals':
            loadGoalsTab();
            break;
        case 'manager-goals': loadManagerGoals(); break;
        case 'whitelist': loadWhitelist(); break;
        case 'edit-permissions': loadEditPermissions(); break;
        case 'ranking': loadRanking(); break;
        case 'all-deliveries': loadAllDeliveries(); break;
        case 'weekly-report': populateReportWeekSelect(); loadWeeklyReport(); break;
        case 'role-permissions': 
            // Recarregar iframe para pegar dados atualizados
            const iframe = document.querySelector('#role-permissions-tab iframe');
            if (iframe) {
                iframe.src = iframe.src; // Force reload
            }
            break;
        case 'members-adv': loadMembersForAdv(); break;
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
        
        // Controlar visibilidade do botão anterior (permitir voltar até 8 semanas atrás)
        const btnPrev = document.getElementById('btnPrevWeek');
        if (btnPrev) {
            btnPrev.style.visibility = selectedWeekOffset > -8 ? 'visible' : 'hidden';
        }
    } catch (error) {
        console.error('Erro ao carregar semana:', error);
    }
}

// Cache para dados das semanas
const weekDataCache = new Map();
let isLoadingWeek = false;

// Navegar entre semanas
function previousWeek() {
    if (selectedWeekOffset > -8 && !isLoadingWeek) {
        selectedWeekOffset--;
        loadWeekData();
    }
}

function nextWeek() {
    if (!isLoadingWeek) {
        selectedWeekOffset++;
        loadWeekData();
    }
}

// Carregar dados da semana de forma otimizada
async function loadWeekData() {
    if (isLoadingWeek) return;
    
    isLoadingWeek = true;
    
    try {
        // Verificar se já temos no cache (válido por 30 segundos)
        const cacheKey = `week_${selectedWeekOffset}`;
        const cached = weekDataCache.get(cacheKey);
        
        if (cached && (Date.now() - cached.timestamp < 30000)) {
            // Usar dados do cache
            selectedWeek = cached.weekData.week;
            weeklyStatusData = cached.statusData;
            
            // Atualizar labels
            let sidebarLabel;
            if (selectedWeekOffset === 0) {
                sidebarLabel = `${cached.weekData.week.label} (Atual)`;
            } else if (selectedWeekOffset === 1) {
                sidebarLabel = `${cached.weekData.week.label} (Próxima)`;
            } else if (selectedWeekOffset > 1) {
                sidebarLabel = `${cached.weekData.week.label} (+${selectedWeekOffset})`;
            } else {
                sidebarLabel = `${cached.weekData.week.label} (${selectedWeekOffset})`;
            }
            document.getElementById('selectedWeekLabel').textContent = sidebarLabel;
            
            const currentWeekLabel = document.getElementById('currentWeekLabel');
            if (currentWeekLabel) {
                currentWeekLabel.textContent = cached.weekData.week.label;
            }
            
            // Contadores
            const statusData = cached.statusData;
            const completedFull = (statusData.completed || []).filter(m => !m.is_partial).length;
            const completedPartial = (statusData.completed || []).filter(m => m.is_partial).length;
            const partialFromList = statusData.partial ? statusData.partial.length : 0;
            
            document.getElementById('completedCount').textContent = completedFull;
            document.getElementById('partialCount').textContent = completedPartial + partialFromList;
            document.getElementById('pendingApprovalCount').textContent = statusData.pendingApproval.length;
            document.getElementById('notDeliveredCount').textContent = statusData.notDelivered.length;
            document.getElementById('justifiedCount').textContent = statusData.justified.length;
            
            // Renderizar tabela
            renderWeeklyTable(currentFilter);
            isLoadingWeek = false;
            return;
        }
        
        // Mostrar indicador de loading
        const tbody = document.getElementById('weeklyTableBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="6" class="loading">⏳</td></tr>';
        }
        
        // Buscar semana e status em paralelo
        const weekPromise = fetch(`/api/admin/week/${selectedWeekOffset}`);
        const weekResponse = await weekPromise;
        const weekData = await weekResponse.json();
        selectedWeek = weekData.week;
        
        // Agora buscar o status COM os dados corretos da semana
        const statusParams = `?week_start=${selectedWeek.start}&week_end=${selectedWeek.end}`;
        const statusResponse = await fetch(`/api/admin/weekly-status${statusParams}`);
        const statusData = await statusResponse.json();
        
        // Atualizar labels
        let sidebarLabel;
        if (selectedWeekOffset === 0) {
            sidebarLabel = `${weekData.week.label} (Atual)`;
        } else if (selectedWeekOffset === 1) {
            sidebarLabel = `${weekData.week.label} (Próxima)`;
        } else if (selectedWeekOffset > 1) {
            sidebarLabel = `${weekData.week.label} (+${selectedWeekOffset})`;
        } else {
            sidebarLabel = `${weekData.week.label} (${selectedWeekOffset})`;
        }
        
        document.getElementById('selectedWeekLabel').textContent = sidebarLabel;
        
        const currentWeekLabel = document.getElementById('currentWeekLabel');
        if (currentWeekLabel) {
            currentWeekLabel.textContent = weekData.week.label;
        }
        
        // Controlar visibilidade do botão anterior
        const btnPrev = document.getElementById('btnPrevWeek');
        if (btnPrev) {
            btnPrev.style.visibility = selectedWeekOffset > -8 ? 'visible' : 'hidden';
        }
        
        // Atualizar status
        weeklyStatusData = statusData;
        
        // Contadores - separar completos de parciais
        const completedFull = (statusData.completed || []).filter(m => !m.is_partial).length;
        const completedPartial = (statusData.completed || []).filter(m => m.is_partial).length;
        const partialFromList = statusData.partial ? statusData.partial.length : 0;
        
        document.getElementById('completedCount').textContent = completedFull;
        document.getElementById('partialCount').textContent = completedPartial + partialFromList;
        document.getElementById('pendingApprovalCount').textContent = statusData.pendingApproval.length;
        document.getElementById('notDeliveredCount').textContent = statusData.notDelivered.length;
        document.getElementById('justifiedCount').textContent = statusData.justified.length;
        
        // Renderizar tabela
        renderWeeklyTable(currentFilter);
        
        // Armazenar no cache (válido por 30 segundos)
        weekDataCache.set(cacheKey, {
            weekData,
            statusData,
            timestamp: Date.now()
        });
        
        // Limpar cache antigo
        setTimeout(() => {
            const now = Date.now();
            for (const [key, value] of weekDataCache.entries()) {
                if (now - value.timestamp > 30000) {
                    weekDataCache.delete(key);
                }
            }
        }, 100);
        
    } catch (error) {
        console.error('Erro ao carregar dados da semana:', error);
        const tbody = document.getElementById('weeklyTableBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="6" class="loading">❌ Erro ao carregar dados</td></tr>';
        }
    } finally {
        isLoadingWeek = false;
    }
}

// Carregar dados iniciais de forma otimizada (evita chamadas duplicadas)
async function loadInitialData() {
    try {
        // 0. Carregar configuração de competição primeiro (para visibilidade correta das abas)
        try {
            const settingsRes = await fetch('/api/admin/farm-settings');
            if (settingsRes.ok) {
                const settingsData = await settingsRes.json();
                competitionEnabled = settingsData.settings?.competition_enabled === 'true';
                updateCompetitionVisibility();
            }
        } catch (e) {
            console.log('Erro ao carregar config de competição:', e);
        }
        
        // 1. Buscar dados da semana primeiro (uma única vez)
        const weekResponse = await fetch(`/api/admin/week/${selectedWeekOffset}`);
        const weekData = await weekResponse.json();
        selectedWeek = weekData.week;
        
        // Atualizar labels da semana
        let sidebarLabel;
        if (selectedWeekOffset === 0) {
            sidebarLabel = `${weekData.week.label} (Atual)`;
        } else if (selectedWeekOffset === 1) {
            sidebarLabel = `${weekData.week.label} (Próxima)`;
        } else {
            sidebarLabel = `${weekData.week.label} (+${selectedWeekOffset})`;
        }
        document.getElementById('selectedWeekLabel').textContent = sidebarLabel;
        
        const currentWeekLabel = document.getElementById('currentWeekLabel');
        if (currentWeekLabel) {
            currentWeekLabel.textContent = weekData.week.label;
        }
        
        const btnPrev = document.getElementById('btnPrevWeek');
        if (btnPrev) {
            btnPrev.style.visibility = selectedWeekOffset > -8 ? 'visible' : 'hidden';
        }
        
        // 2. Carregar em paralelo: stats, weekly-status e notificações base
        const statusParams = `?week_start=${selectedWeek.start}&week_end=${selectedWeek.end}`;
        const [statsRes, statusRes, pendingRes, justRes, passwordRes] = await Promise.all([
            fetch(`/api/admin/stats${statusParams}`),
            fetch(`/api/admin/weekly-status${statusParams}`),
            fetch('/api/admin/deliveries/pending'),
            fetch('/api/admin/justifications/pending'),
            fetch('/api/admin/password-resets/pending').catch(() => ({ ok: false }))
        ]);
        
        // 3. Processar stats
        if (statsRes.ok) {
            const statsData = await statsRes.json();
            const totalMembersEl = document.getElementById('totalMembers');
            const pendingDeliveriesEl = document.getElementById('pendingDeliveries');
            const approvedCountEl = document.getElementById('approvedCount');
            if (totalMembersEl) totalMembersEl.textContent = statsData.stats?.total_members || 0;
            if (pendingDeliveriesEl) pendingDeliveriesEl.textContent = statsData.stats?.pending_deliveries || 0;
            if (approvedCountEl) approvedCountEl.textContent = statsData.stats?.approved_count || 0;
        }
        
        // 4. Processar weekly-status
        if (statusRes.ok) {
            const statusData = await statusRes.json();
            weeklyStatusData = statusData;
            
            // Contadores
            const completedFull = (statusData.completed || []).filter(m => !m.is_partial).length;
            const completedPartial = (statusData.completed || []).filter(m => m.is_partial).length;
            const partialFromList = statusData.partial ? statusData.partial.length : 0;
            
            document.getElementById('completedCount').textContent = completedFull;
            document.getElementById('partialCount').textContent = completedPartial + partialFromList;
            document.getElementById('pendingApprovalCount').textContent = statusData.pendingApproval.length;
            document.getElementById('notDeliveredCount').textContent = statusData.notDelivered.length;
            document.getElementById('justifiedCount').textContent = statusData.justified.length;
            
            // Renderizar tabela
            renderWeeklyTable(currentFilter);
            
            // Processar notificações usando dados já carregados (evita chamadas duplicadas)
            processNotificationsWithData(
                pendingRes.ok ? await pendingRes.json() : { deliveries: [] },
                justRes.ok ? await justRes.json() : { justifications: [] },
                passwordRes.ok ? await passwordRes.json() : { requests: [] },
                statusData
            );
        }
        
        // Armazenar no cache
        const cacheKey = `week_${selectedWeekOffset}`;
        weekDataCache.set(cacheKey, {
            weekData,
            statusData: weeklyStatusData,
            timestamp: Date.now()
        });
        
    } catch (error) {
        console.error('Erro ao carregar dados iniciais:', error);
    }
}

// Carregar todos os dados da semana (para compatibilidade)
function loadAll() {
    // Nada a fazer - loadInitialData já carrega tudo
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
        
        // Mostrar seletor de semanas apenas no Status da Semana
        const weekSelector = document.querySelector('.sidebar-week-selector');
        if (weekSelector) {
            if (tabId === 'weekly-status') {
                weekSelector.classList.add('show-week-selector');
            } else {
                weekSelector.classList.remove('show-week-selector');
            }
        }
        
        switch (tabId) {
            case 'weekly-status':
                loadWeeklyStatus();
                break;
            case 'weekly-ranking':
                loadWeeklyRankingTab();
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
            case 'goals':
                loadGoalsTab();
                break;
            case 'manager-goals':
                loadManagerGoals();
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

// Dados da visão geral para ordenação
let overviewData = [];
let overviewSortColumn = 'name';
let overviewSortDirection = 'asc';

// Carregar visão geral dos membros - SIMPLIFICADA
async function loadMembersOverview() {
    try {
        const response = await fetch('/api/admin/members');
        const data = await response.json();
        
        if (data.members && data.members.length > 0) {
            // Filtrar apenas membros ativos
            const activeMembers = data.members.filter(m => m.active === 1 || m.active === '1' || m.active === true);
            
            // Buscar contagem de ADVs para cada membro
            overviewData = await Promise.all(activeMembers.map(async (member) => {
                try {
                    const advResponse = await fetch(`/api/admin/members/${member.id}/warnings`);
                    const advData = await advResponse.json();
                    return {
                        ...member,
                        warningsCount: advData.warnings ? advData.warnings.length : 0,
                        warnings: advData.warnings || []
                    };
                } catch {
                    return { ...member, warningsCount: 0, warnings: [] };
                }
            }));
            
            renderOverviewTable();
        } else {
            document.getElementById('overviewTableBody').innerHTML = 
                '<tr><td colspan="3" class="loading">👥 Nenhum membro cadastrado</td></tr>';
        }
    } catch (error) {
        console.error('Erro ao carregar visão geral:', error);
        document.getElementById('overviewTableBody').innerHTML = 
            '<tr><td colspan="3" class="loading">Erro ao carregar dados</td></tr>';
    }
}

// Renderizar tabela de visão geral
function renderOverviewTable() {
    const tbody = document.getElementById('overviewTableBody');
    const searchTerm = document.getElementById('searchOverview')?.value?.toLowerCase() || '';
    
    // Filtrar por busca
    let filtered = overviewData.filter(m => {
        if (!searchTerm) return true;
        return m.name.toLowerCase().includes(searchTerm) || 
               m.passport?.toLowerCase().includes(searchTerm);
    });
    
    // Filtrar por ADV
    if (overviewAdvFilter === 'with') {
        filtered = filtered.filter(m => m.warningsCount > 0);
    } else if (overviewAdvFilter === 'without') {
        filtered = filtered.filter(m => m.warningsCount === 0);
    }
    
    // Ordenar
    filtered.sort((a, b) => {
        let valA, valB;
        
        switch (overviewSortColumn) {
            case 'passport':
                valA = parseInt(a.passport) || 999999;
                valB = parseInt(b.passport) || 999999;
                break;
            case 'name':
                valA = a.name.toLowerCase();
                valB = b.name.toLowerCase();
                break;
            case 'adv':
                valA = a.warningsCount;
                valB = b.warningsCount;
                break;
            default:
                valA = a.name.toLowerCase();
                valB = b.name.toLowerCase();
        }
        
        if (overviewSortDirection === 'asc') {
            return valA > valB ? 1 : valA < valB ? -1 : 0;
        } else {
            return valA < valB ? 1 : valA > valB ? -1 : 0;
        }
    });
    
    // Atualizar headers com indicadores de ordenação
    updateOverviewSortIndicators();
    
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="loading">Nenhum membro encontrado</td></tr>';
        return;
    }
    
    tbody.innerHTML = filtered.map(member => {
        const safeName = escapeHtml(member.name);
        const safePassport = escapeHtml(member.passport || '');
        const initial = safeName.charAt(0).toUpperCase();
        
        // Classe baseada no número de ADVs
        let advClass = '';
        let advBadge = '';
        if (member.warningsCount >= 3) {
            advClass = 'adv-critical';
            advBadge = '🔴';
        } else if (member.warningsCount >= 2) {
            advClass = 'adv-high';
            advBadge = '🟠';
        } else if (member.warningsCount >= 1) {
            advClass = 'adv-warning';
            advBadge = '🟡';
        } else {
            advBadge = '🟢';
        }
        
        return `
            <tr class="${advClass}" data-name="${safeName.toLowerCase()}" data-passport="${safePassport}">
                <td>${safePassport || '-'}</td>
                <td><span class="member-avatar">${initial}</span><span class="member-name">${safeName}</span></td>
                <td>${advBadge} ${member.warningsCount}</td>
                <td>
                    <button class="action-btn add-adv" onclick="showAdvModal(${member.id}, '${escapeHtml(member.name.replace(/'/g, "\\'"))}', ${member.warningsCount})">➕ ADV</button>
                    ${member.warningsCount > 0 ? `<button class="action-btn view-adv" onclick="showMemberWarningsModal(${member.id}, '${escapeHtml(member.name.replace(/'/g, "\\'"))}')">👁️ Ver</button>` : ''}
                </td>
            </tr>
        `;
    }).join('');
}

// Ordenar visão geral por coluna
function sortOverview(column) {
    if (overviewSortColumn === column) {
        // Inverter direção se clicar na mesma coluna
        overviewSortDirection = overviewSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        overviewSortColumn = column;
        // ADV começa decrescente, passaporte crescente
        overviewSortDirection = column === 'adv' ? 'desc' : 'asc';
    }
    renderOverviewTable();
}

// Atualizar indicadores de ordenação
function updateOverviewSortIndicators() {
    const headers = document.querySelectorAll('#overviewTable th.sortable');
    headers.forEach(th => {
        const col = th.getAttribute('data-sort');
        const arrow = th.querySelector('.sort-arrow');
        if (arrow) {
            if (col === overviewSortColumn) {
                arrow.textContent = overviewSortDirection === 'asc' ? ' ▲' : ' ▼';
                arrow.style.opacity = '1';
            } else {
                arrow.textContent = ' ▲';
                arrow.style.opacity = '0.3';
            }
        }
    });
}

// Filtro de ADV ativo
let overviewAdvFilter = 'all';

// Filtrar por quantidade de ADV
function filterOverviewByAdv(filter) {
    overviewAdvFilter = filter;
    
    // Atualizar botões ativos
    document.querySelectorAll('.overview-filters .filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');
    
    renderOverviewTable();
}

// Filtrar tabela de visão geral
function filterOverviewTable() {
    renderOverviewTable();
}

// ========== RELATÓRIO DE ADV ==========

let advReportData = [];

// Alternar entre abas de ADV
function switchAdvTab(tab) {
    // Trocar abas
    const buttons = document.querySelectorAll('#members-overview-tab .justif-tab-btn');
    const contents = document.querySelectorAll('#members-overview-tab .justif-tab-content');
    
    buttons.forEach(btn => btn.classList.remove('active'));
    contents.forEach(content => content.classList.remove('active'));
    
    if (tab === 'manage') {
        buttons[0].classList.add('active');
        document.getElementById('adv-manage-content').classList.add('active');
    } else if (tab === 'report') {
        buttons[1].classList.add('active');
        document.getElementById('adv-report-content').classList.add('active');
        loadAdvReport();
    }
}

// Carregar relatório de ADVs
async function loadAdvReport() {
    const container = document.getElementById('advReportList');
    
    try {
        container.innerHTML = '<p class="loading">Carregando relatório...</p>';
        
        const response = await fetch('/api/admin/warnings/all');
        const data = await response.json();
        
        advReportData = data.warnings || [];
        
        // Calcular estatísticas
        updateAdvStats(advReportData);
        
        // Preencher filtro de meses
        populateMonthFilter(advReportData);
        
        // Renderizar lista
        renderAdvReport();
        
    } catch (error) {
        console.error('Erro ao carregar relatório:', error);
        container.innerHTML = '<p class="error">❌ Erro ao carregar relatório de ADVs</p>';
    }
}

// Atualizar estatísticas do relatório
function updateAdvStats(warnings) {
    // Total de ADVs
    document.getElementById('totalAdvs').textContent = warnings.length;
    
    // Membros únicos com ADV
    const uniqueMembers = [...new Set(warnings.map(w => w.user_id))];
    document.getElementById('membersWithAdv').textContent = uniqueMembers.length;
    
    // ADVs deste mês
    const now = new Date();
    const thisMonth = warnings.filter(w => {
        const wDate = new Date(w.created_at);
        return wDate.getMonth() === now.getMonth() && wDate.getFullYear() === now.getFullYear();
    });
    document.getElementById('advsThisMonth').textContent = thisMonth.length;
    
    // Membros com 3+ ADVs
    const advCounts = {};
    warnings.forEach(w => {
        advCounts[w.user_id] = (advCounts[w.user_id] || 0) + 1;
    });
    const highRisk = Object.values(advCounts).filter(count => count >= 3).length;
    document.getElementById('membersHighRisk').textContent = highRisk;
}

// Preencher filtro de meses
function populateMonthFilter(warnings) {
    const select = document.getElementById('filterAdvMonth');
    const months = new Set();
    
    warnings.forEach(w => {
        const date = new Date(w.created_at);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        months.add(monthKey);
    });
    
    const sortedMonths = Array.from(months).sort().reverse();
    
    select.innerHTML = '<option value="all">Todos os Períodos</option>';
    sortedMonths.forEach(monthKey => {
        const [year, month] = monthKey.split('-');
        const date = new Date(year, parseInt(month) - 1, 1);
        const monthName = date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        select.innerHTML += `<option value="${monthKey}">${monthName}</option>`;
    });
}

// Renderizar relatório
function renderAdvReport() {
    const container = document.getElementById('advReportList');
    const searchTerm = document.getElementById('searchAdvReport')?.value?.toLowerCase() || '';
    const monthFilter = document.getElementById('filterAdvMonth')?.value || 'all';
    
    let filtered = advReportData;
    
    // Filtrar por busca
    if (searchTerm) {
        filtered = filtered.filter(w => 
            w.user_name?.toLowerCase().includes(searchTerm) ||
            w.user_passport?.toLowerCase().includes(searchTerm) ||
            w.reason?.toLowerCase().includes(searchTerm) ||
            w.applied_by_name?.toLowerCase().includes(searchTerm)
        );
    }
    
    // Filtrar por mês
    if (monthFilter !== 'all') {
        filtered = filtered.filter(w => {
            const date = new Date(w.created_at);
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            return monthKey === monthFilter;
        });
    }
    
    if (filtered.length === 0) {
        container.innerHTML = '<p class="empty-state">📋 Nenhuma ADV encontrada com os filtros aplicados</p>';
        return;
    }
    
    // Ordenar por data (mais recentes primeiro)
    filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    container.innerHTML = filtered.map(adv => {
        const date = new Date(adv.created_at).toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        return `
            <div class="adv-report-item">
                <div class="adv-report-header">
                    <div class="adv-member-info">
                        <span class="adv-member-name">${adv.user_name}</span>
                        <span class="adv-member-passport">📋 ${adv.user_passport}</span>
                    </div>
                    <div class="adv-date">${date}</div>
                </div>
                <div class="adv-report-body">
                    <div class="adv-reason">
                        <strong>Motivo:</strong> ${adv.reason || 'Não especificado'}
                    </div>
                    <div class="adv-applied-by">
                        <strong>Aplicada por:</strong> ${adv.applied_by_name} (${adv.applied_by_passport})
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Filtrar relatório
function filterAdvReport() {
    renderAdvReport();
}

// Modal rápido para adicionar ADV
function openQuickAdvModal(memberId, memberName) {
    // Criar modal se não existir
    let modal = document.getElementById('quickAdvModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'quickAdvModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 500px;">
                <div class="modal-header">
                    <h3>⚠️ Adicionar Advertência</h3>
                    <button class="close-btn" onclick="closeQuickAdvModal()">×</button>
                </div>
                <div class="modal-body">
                    <p><strong>Membro:</strong> <span id="quickAdvMemberName"></span></p>
                    <input type="hidden" id="quickAdvMemberId">
                    
                    <div class="form-group">
                        <label>Motivo da Advertência:</label>
                        <textarea id="quickAdvReason" rows="3" placeholder="Descreva o motivo da advertência..."></textarea>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="closeQuickAdvModal()">Cancelar</button>
                    <button class="btn btn-danger" onclick="saveQuickAdv()">⚠️ Aplicar ADV</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    
    document.getElementById('quickAdvMemberId').value = memberId;
    document.getElementById('quickAdvMemberName').textContent = memberName;
    document.getElementById('quickAdvReason').value = '';
    modal.style.display = 'flex';
}

function closeQuickAdvModal() {
    const modal = document.getElementById('quickAdvModal');
    if (modal) modal.style.display = 'none';
}

async function saveQuickAdv() {
    const memberId = document.getElementById('quickAdvMemberId').value;
    const reason = document.getElementById('quickAdvReason').value.trim();
    
    if (!reason) {
        alert('Por favor, informe o motivo da advertência!');
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
            alert('✅ Advertência aplicada com sucesso!');
            closeQuickAdvModal();
            loadMembersOverview(); // Recarregar tabela
        } else {
            alert(data.error || 'Erro ao aplicar advertência');
        }
    } catch (error) {
        console.error('Erro ao aplicar ADV:', error);
        alert('Erro ao aplicar advertência');
    }
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
        
        // Exibir grupos
        let groupsText = '';
        if (data.member.groups && data.member.groups.length > 0) {
            const displayGroups = data.member.groups.filter(g => g !== 'member' || data.member.groups.length === 1);
            groupsText = displayGroups.map(g => roleNames[g] || g).join(', ');
        } else {
            groupsText = roleNames[data.member.role] || data.member.role;
        }
        
        document.getElementById('extractMemberDetails').textContent = '';
        
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
        
        // Preencher farms - USAR MESMA LÓGICA DO PAYMENT HISTORY
        const farmsList = document.getElementById('extractFarmsList');
        
        // Gerar últimas 4 semanas (incluindo semana atual)
        function generateLast3Weeks() {
            const weeks = [];
            const now = new Date();
            now.setHours(12, 0, 0, 0);
            
            // Encontrar a segunda-feira da SEMANA ATUAL
            const todayDayOfWeek = now.getDay();
            const daysToCurrentMonday = (todayDayOfWeek === 0 ? 6 : todayDayOfWeek - 1);
            const currentMonday = new Date(now.getTime() - (daysToCurrentMonday * 24 * 60 * 60 * 1000));
            currentMonday.setHours(12, 0, 0, 0);
            
            // A partir da semana ATUAL, pegar 4 semanas (0=atual, 1=passada, 2, 3)
            for (let i = 0; i <= 3; i++) {
                // Segunda-feira de i semanas atrás
                const monday = new Date(currentMonday.getTime() - (i * 7 * 24 * 60 * 60 * 1000));
                monday.setHours(12, 0, 0, 0);
                
                // Domingo (6 dias depois)
                const sunday = new Date(monday.getTime() + (6 * 24 * 60 * 60 * 1000));
                sunday.setHours(12, 0, 0, 0);
                
                // Formatar no formato local
                const formatLocalDate = (date) => {
                    const year = date.getFullYear();
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const day = String(date.getDate()).padStart(2, '0');
                    return `${year}-${month}-${day}`;
                };
                
                weeks.push({
                    week_start: formatLocalDate(monday),
                    week_end: formatLocalDate(sunday)
                });
            }
            return weeks;
        }
        
        const allWeeks = generateLast3Weeks();
        
        // Combinar deliveries, justifications e semanas vazias
        const allRecords = allWeeks.map(week => {
            // Normalizar datas para comparação
            const weekStartNorm = week.week_start.split('T')[0];
            const weekEndNorm = week.week_end.split('T')[0];
            
            const delivery = data.deliveries.find(d => {
                const dStartNorm = String(d.week_start).split('T')[0];
                const dEndNorm = String(d.week_end).split('T')[0];
                return dStartNorm === weekStartNorm && dEndNorm === weekEndNorm;
            });
            
            const justification = data.justifications.find(j => {
                const jStartNorm = String(j.week_start).split('T')[0];
                const jEndNorm = String(j.week_end).split('T')[0];
                return jStartNorm === weekStartNorm && jEndNorm === weekEndNorm;
            });
            
            if (justification) {
                return { ...justification, type: 'justification' };
            } else if (delivery) {
                return { ...delivery, type: 'delivery' };
            } else {
                return {
                    ...week,
                    type: 'delivery',
                    status: 'not_delivered',
                    items: []
                };
            }
        });
        
        farmsList.innerHTML = allRecords.map(record => {
            const weekLabel = formatWeekLabel(record.week_start, record.week_end);
                
                if (record.type === 'justification') {
                    return `
                        <div class="extract-farm-item">
                            <div class="extract-farm-left">
                                <div class="extract-farm-week">${weekLabel}</div>
                                <span class="extract-farm-status justified">📋 Justificado</span>
                                <div class="extract-farm-materials">
                                    <span class="extract-farm-material">${record.reason || 'Sem motivo informado'}</span>
                                </div>
                            </div>
                        </div>
                    `;
                }
                
                const statusClass = record.status;
                let statusText = getExtractStatusText(record.status);
                
                // Verificar se a semana já passou primeiro
                const weekEndStr = String(record.week_end).split('T')[0];
                const weekEnd = new Date(weekEndStr + 'T23:59:59');
                const today = new Date();
                const isWeekPassed = weekEnd < today;
                
                // Ajustar status baseado se a semana passou
                if (record.status === 'not_delivered') {
                    statusText = '❌ Não Entregou';
                } else if ((record.status === 'in_progress' || record.status === 'pending') && isWeekPassed) {
                    statusText = '❌ Não Entregou';
                }
                
                const materials = record.items?.map(item => 
                    `<span class="extract-farm-material">${item.material_icon || '📦'} ${item.amount}</span>`
                ).join('') || '';
                
                // Verificar se deve mostrar botão ADV
                const canHaveAdv = record.status === 'rejected' || 
                                   record.status === 'not_delivered' || 
                                   ((record.status === 'in_progress' || record.status === 'pending') && isWeekPassed);
                
                // Verificar se já existe ADV para esta semana (normalizar datas)
                const recordStartNorm = String(record.week_start).split('T')[0];
                const recordEndNorm = String(record.week_end).split('T')[0];
                
                console.log('🔍 [Modal Deliveries] Verificando ADV para semana:', recordStartNorm, '-', recordEndNorm);
                
                const hasAdv = data.warnings.some(w => {
                    if (!w.week_start || !w.week_end) return false;
                    const wStartNorm = String(w.week_start).split('T')[0];
                    const wEndNorm = String(w.week_end).split('T')[0];
                    const match = wStartNorm === recordStartNorm && wEndNorm === recordEndNorm;
                    if (match) {
                        console.log('✅ [Modal Deliveries] ADV encontrada:', w);
                    }
                    return match;
                });
                
                // Mostrar botão de ADV apenas se: semana passou + pode ter ADV + não tem ADV ainda
                const showAdvBtn = isWeekPassed && canHaveAdv && !hasAdv;
                
                const advButton = showAdvBtn 
                    ? `<button class="btn-apply-adv-extract" onclick='applyAdvFromExtract(${JSON.stringify(data.member).replace(/'/g, "&apos;")}, "${record.week_start}", "${record.week_end}")'>⚠️ Aplicar ADV</button>`
                    : (hasAdv && canHaveAdv ? `<span class="extract-adv-applied">⚠️ ADV JÁ APLICADA</span>` : '');
                
                // Botão de editar entrega (qualquer admin pode editar)
                const canEditDeliveries = currentUser && currentUser.role && currentUser.role !== 'member';
                const editButton = canEditDeliveries && record.id 
                    ? `<button class="btn-edit-delivery" onclick="openEditDeliveryModal(${record.id}, ${data.member.id})" style="background: #3498db; color: white; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; margin-right: 5px;">✏️ Editar</button>`
                    : '';
                
                // Botão para criar entrega (quando não existe)
                const createButton = canEditDeliveries && !record.id && record.status === 'not_delivered'
                    ? `<button class="btn-create-delivery" onclick="openCreateDeliveryModal(${data.member.id}, '${record.week_start}', '${record.week_end}')" style="background: #9b59b6; color: white; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; margin-right: 5px;">✏️ Editar</button>`
                    : '';
                
                // Verificar se tem farms extras
                let extraFarmsHtml = '';
                if (record.extraFarms && record.extraFarms.length > 0) {
                    extraFarmsHtml = `
                        <div class="extract-extra-farms">
                            ${record.extraFarms.map(extra => {
                                let extraStatusClass = extra.status;
                                let extraStatusText = extra.status === 'approved' ? '✅ Aprovado' : 
                                                      extra.status === 'rejected' ? '❌ Rejeitado' : '⏳ Pendente';
                                
                                const extraMaterials = extra.materialDetails?.map(m => 
                                    `<span class="extract-farm-material extra-material">${m.material_icon || '📦'} ${m.formatted || m.amount}</span>`
                                ).join('') || '';
                                
                                return `
                                    <div class="extract-extra-farm-item ${extraStatusClass}">
                                        <div class="extract-extra-farm-header">
                                            <span class="extract-extra-label">🏆 Farm Extra</span>
                                            <span class="extract-extra-status ${extraStatusClass}">${extraStatusText}</span>
                                        </div>
                                        <div class="extract-farm-materials">${extraMaterials}</div>
                                        ${extra.totalMaterials ? `<span class="extract-extra-total">Total: ${extra.totalMaterials} materiais</span>` : ''}
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    `;
                }
                
                return `
                    <div class="extract-farm-item">
                        <div class="extract-farm-left">
                            <div class="extract-farm-week">${weekLabel}</div>
                            <span class="extract-farm-status ${statusClass}">${statusText}</span>
                            <div class="extract-farm-section">
                                <span class="extract-farm-section-label">📦 Meta:</span>
                                <div class="extract-farm-materials">${materials || '<span class="extract-farm-material">-</span>'}</div>
                            </div>
                            ${extraFarmsHtml}
                        </div>
                        <div class="extract-farm-actions">
                            ${editButton}${createButton}${advButton}
                        </div>
                    </div>
                `;
            }).join('');
        
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
                        <div class="extract-warning-reason">${escapeHtml(warning.reason || 'Sem motivo informado')}</div>
                        <div class="extract-warning-meta">
                            Por ${escapeHtml(warning.given_by_name)} em ${new Date(warning.created_at).toLocaleDateString('pt-BR')}
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

// ========== MODAL PAYMENT HISTORY ==========

// Abrir modal de histórico de pagamentos
async function openPaymentHistory(memberId) {
    const modal = document.getElementById('paymentHistoryModal');
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
        document.getElementById('extractMemberDetails').textContent = '';
        
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
        
        // Gerar últimas 4 semanas (incluindo semana atual)
        function generateLast3Weeks() {
            const weeks = [];
            const now = new Date();
            now.setHours(12, 0, 0, 0);
            
            console.log('🔍 EXTRATO - HOJE:', now.toLocaleDateString('pt-BR'), '(', now.getDay(), ')');
            
            // Encontrar a segunda-feira da SEMANA ATUAL
            const todayDayOfWeek = now.getDay();
            const daysToCurrentMonday = (todayDayOfWeek === 0 ? 6 : todayDayOfWeek - 1);
            const currentMonday = new Date(now.getTime() - (daysToCurrentMonday * 24 * 60 * 60 * 1000));
            currentMonday.setHours(12, 0, 0, 0);
            
            console.log('🔍 Segunda da semana atual:', currentMonday.toLocaleDateString('pt-BR'));
            
            // A partir da semana ATUAL, pegar 4 semanas (0=atual, 1=passada, 2, 3)
            for (let i = 0; i <= 3; i++) {
                // Segunda-feira de i semanas atrás
                const monday = new Date(currentMonday.getTime() - (i * 7 * 24 * 60 * 60 * 1000));
                monday.setHours(12, 0, 0, 0);
                
                // Domingo (6 dias depois)
                const sunday = new Date(monday.getTime() + (6 * 24 * 60 * 60 * 1000));
                sunday.setHours(12, 0, 0, 0);
                
                console.log(`🔍 Semana ${i}:`, monday.toLocaleDateString('pt-BR'), '-', sunday.toLocaleDateString('pt-BR'));
                
                // Formatar no formato local
                const formatLocalDate = (date) => {
                    const year = date.getFullYear();
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const day = String(date.getDate()).padStart(2, '0');
                    return `${year}-${month}-${day}`;
                };
                
                weeks.push({
                    week_start: formatLocalDate(monday),
                    week_end: formatLocalDate(sunday)
                });
            }
            return weeks;
        }
        
        const allWeeks = generateLast3Weeks();
        
        // Combinar deliveries, justifications e semanas vazias
        const allRecords = allWeeks.map(week => {
            // Normalizar datas para comparação
            const weekStartNorm = week.week_start.split('T')[0];
            const weekEndNorm = week.week_end.split('T')[0];
            
            // Verificar se existe delivery para esta semana
            const delivery = data.deliveries.find(d => {
                const dStartNorm = String(d.week_start).split('T')[0];
                const dEndNorm = String(d.week_end).split('T')[0];
                return dStartNorm === weekStartNorm && dEndNorm === weekEndNorm;
            });
            
            // Verificar se existe justificativa para esta semana
            const justification = data.justifications.find(j => {
                const jStartNorm = String(j.week_start).split('T')[0];
                const jEndNorm = String(j.week_end).split('T')[0];
                return jStartNorm === weekStartNorm && jEndNorm === weekEndNorm;
            });
            
            if (justification) {
                return { ...justification, type: 'justification' };
            } else if (delivery) {
                return { ...delivery, type: 'delivery' };
            } else {
                // Semana sem entrega - criar registro virtual
                return {
                    ...week,
                    type: 'delivery',
                    status: 'not_delivered',
                    items: []
                };
            }
        });
        
        console.log('📋 Registros combinados (incluindo semanas vazias):', allRecords);
        
        // SEMPRE mostrar as semanas geradas
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
                let statusText = getExtractStatusText(record.status);
                
                // Verificar se a semana já passou
                const weekEndStr = String(record.week_end).split('T')[0];
                const weekEnd = new Date(weekEndStr + 'T23:59:59');
                const today = new Date();
                const isWeekPassed = weekEnd < today;
                
                // Se é not_delivered, ajustar texto
                if (record.status === 'not_delivered') {
                    statusText = '❌ Não Entregou';
                }
                
                // Se está em progresso/pendente mas a semana passou, tratar como não entregou
                if ((record.status === 'in_progress' || record.status === 'pending') && isWeekPassed) {
                    statusText = '❌ Não Entregou';
                }
                
                const materials = record.items?.map(item => 
                    `<span class="extract-farm-material">${item.material_icon || '📦'} ${item.amount}</span>`
                ).join('') || '';
                
                // Verificar se deve mostrar botão ADV
                // Incluir in_progress/pending que já passaram da semana
                const canHaveAdv = record.status === 'rejected' || 
                                   record.status === 'not_delivered' || 
                                   ((record.status === 'in_progress' || record.status === 'pending') && isWeekPassed);
                
                // Verificar se já existe ADV para esta semana (normalizar datas)
                const recordStartNorm = String(record.week_start).split('T')[0];
                const recordEndNorm = String(record.week_end).split('T')[0];
                
                console.log('🔍 Verificando ADV para semana:', recordStartNorm, '-', recordEndNorm);
                console.log('📋 Total de advertências:', data.warnings.length);
                
                const hasAdv = data.warnings.some(w => {
                    if (!w.week_start || !w.week_end) {
                        console.log('❌ ADV sem week_start/week_end:', w);
                        return false;
                    }
                    const wStartNorm = String(w.week_start).split('T')[0];
                    const wEndNorm = String(w.week_end).split('T')[0];
                    const match = wStartNorm === recordStartNorm && wEndNorm === recordEndNorm;
                    if (match) {
                        console.log('✅ ADV encontrada para esta semana:', w);
                    }
                    return match;
                });
                
                console.log('🎯 Tem ADV para esta semana?', hasAdv);
                
                // Mostrar botão de ADV apenas se: semana passou + pode ter ADV + não tem ADV ainda
                const showAdvBtn = isWeekPassed && canHaveAdv && !hasAdv;
                
                const advButton = showAdvBtn 
                    ? `<button class="btn-apply-adv-extract" onclick='applyAdvFromExtract(${JSON.stringify(data.member).replace(/'/g, "&apos;")}, "${record.week_start}", "${record.week_end}")'>⚠️ Aplicar ADV</button>`
                    : (hasAdv && canHaveAdv ? `<span class="extract-adv-applied">⚠️ ADV JÁ APLICADA</span>` : '');
                
                return `
                    <div class="extract-farm-item">
                        <div class="extract-farm-left">
                            <div class="extract-farm-week">${weekLabel}</div>
                            <span class="extract-farm-status ${statusClass}">${statusText}</span>
                            <div class="extract-farm-materials">${materials || '<span class="extract-farm-material">-</span>'}</div>
                        </div>
                        ${advButton ? `<div class="extract-farm-actions">${advButton}</div>` : ''}
                    </div>
                `;
            }).join('');
        
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
                        <div class="extract-warning-reason">${escapeHtml(warning.reason || 'Sem motivo informado')}</div>
                        <div class="extract-warning-meta">
                            Por ${escapeHtml(warning.given_by_name)} em ${new Date(warning.created_at).toLocaleDateString('pt-BR')}
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

// ========== MODAL PAYMENT HISTORY ==========

// Abrir modal de histórico de pagamentos
async function openPaymentHistory(memberId) {
    const modal = document.getElementById('paymentHistoryModal');
    modal.style.display = 'flex';
    
    // Mostrar loading
    document.getElementById('paymentHistoryMemberName').textContent = 'Carregando...';
    document.getElementById('paymentHistoryMemberDetails').textContent = '';
    document.getElementById('paymentHistoryStats').innerHTML = '<p class="loading">Carregando...</p>';
    document.getElementById('paymentHistoryList').innerHTML = '<p class="loading">Carregando...</p>';
    
    try {
        const response = await fetch(`/api/admin/member-extract/${memberId}`);
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Erro ao carregar histórico');
        }
        
        // Preencher header
        document.getElementById('paymentHistoryMemberName').textContent = data.member.name;
        
        // Exibir grupos
        let groupsText = '';
        if (data.member.groups && data.member.groups.length > 0) {
            const displayGroups = data.member.groups.filter(g => g !== 'member' || data.member.groups.length === 1);
            groupsText = displayGroups.map(g => roleNames[g] || g).join(', ');
        } else {
            groupsText = roleNames[data.member.role] || data.member.role;
        }
        
        document.getElementById('paymentHistoryMemberDetails').textContent = '';
        
        // Preencher estatísticas
        document.getElementById('paymentHistoryStats').innerHTML = `
            <div class="payment-stat-card approved">
                <span class="payment-stat-number">${data.stats.totalApproved}</span>
                <span class="payment-stat-label">✅ Aprovados</span>
            </div>
            <div class="payment-stat-card pending">
                <span class="payment-stat-number">${data.stats.totalPending}</span>
                <span class="payment-stat-label">⏳ Pendentes</span>
            </div>
            <div class="payment-stat-card missing">
                <span class="payment-stat-number">${data.deliveries.filter(d => d.status === 'rejected' || d.status === 'not_delivered').length}</span>
                <span class="payment-stat-label">❌ Não Pagos</span>
            </div>
            <div class="payment-stat-card justified">
                <span class="payment-stat-number">${data.stats.totalJustified}</span>
                <span class="payment-stat-label">📋 Justificados</span>
            </div>
            <div class="payment-stat-card warnings">
                <span class="payment-stat-number">${data.stats.totalWarnings}</span>
                <span class="payment-stat-label">⚠️ ADVs</span>
            </div>
        `;
        
        // Preencher histórico
        const historyList = document.getElementById('paymentHistoryList');
        
        // Gerar últimas 4 semanas (incluindo semana atual) - MESMA LÓGICA DO EXTRATO
        function generateLast3Weeks() {
            const weeks = [];
            const now = new Date();
            now.setHours(12, 0, 0, 0);
            
            // Encontrar a segunda-feira da SEMANA ATUAL
            const todayDayOfWeek = now.getDay();
            const daysToCurrentMonday = (todayDayOfWeek === 0 ? 6 : todayDayOfWeek - 1);
            const currentMonday = new Date(now.getTime() - (daysToCurrentMonday * 24 * 60 * 60 * 1000));
            currentMonday.setHours(12, 0, 0, 0);
            
            // A partir da semana ATUAL, pegar 4 semanas (0=atual, 1=passada, 2, 3)
            for (let i = 0; i <= 3; i++) {
                // Segunda-feira de i semanas atrás
                const monday = new Date(currentMonday.getTime() - (i * 7 * 24 * 60 * 60 * 1000));
                monday.setHours(12, 0, 0, 0);
                
                // Domingo (6 dias depois)
                const sunday = new Date(monday.getTime() + (6 * 24 * 60 * 60 * 1000));
                sunday.setHours(12, 0, 0, 0);
                
                // Formatar no formato local
                const formatLocalDate = (date) => {
                    const year = date.getFullYear();
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const day = String(date.getDate()).padStart(2, '0');
                    return `${year}-${month}-${day}`;
                };
                
                weeks.push({
                    week_start: formatLocalDate(monday),
                    week_end: formatLocalDate(sunday)
                });
            }
            return weeks;
        }
        
        const allWeeks = generateLast3Weeks();
        
        // Combinar com deliveries e justifications existentes
        const allRecords = allWeeks.map(week => {
            // Normalizar datas para comparação
            const weekStartNorm = week.week_start.split('T')[0];
            const weekEndNorm = week.week_end.split('T')[0];
            
            const delivery = data.deliveries.find(d => {
                const dStartNorm = String(d.week_start).split('T')[0];
                const dEndNorm = String(d.week_end).split('T')[0];
                return dStartNorm === weekStartNorm && dEndNorm === weekEndNorm;
            });
            
            const justification = data.justifications.find(j => {
                const jStartNorm = String(j.week_start).split('T')[0];
                const jEndNorm = String(j.week_end).split('T')[0];
                return jStartNorm === weekStartNorm && jEndNorm === weekEndNorm;
            });
            
            if (justification) {
                return { ...justification, type: 'justification' };
            } else if (delivery) {
                return { ...delivery, type: 'delivery' };
            } else {
                return {
                    ...week,
                    type: 'delivery',
                    status: 'not_delivered',
                    items: []
                };
            }
        });
        
        historyList.innerHTML = allRecords.map(record => {
            const weekLabel = formatWeekLabel(record.week_start, record.week_end);
                
                if (record.type === 'justification') {
                    // Justificativa aprovada
                    return `
                        <div class="payment-history-item">
                            <div class="payment-history-item-left">
                                <div class="payment-history-week">${weekLabel}</div>
                                <span class="payment-history-status justified">📋 Justificado</span>
                                <div class="payment-history-materials">
                                    <span class="payment-history-material">${record.reason || 'Sem motivo informado'}</span>
                                </div>
                            </div>
                        </div>
                    `;
                }
                
                // Delivery
                let statusClass = '';
                let statusText = '';
                let showAdvBtn = false;
                
                // Verificar se a semana já passou primeiro
                const weekEndStr = String(record.week_end).split('T')[0];
                const weekEnd = new Date(weekEndStr + 'T23:59:59');
                const today = new Date();
                const isWeekPassed = weekEnd < today;
                
                if (record.status === 'approved') {
                    statusClass = 'approved';
                    statusText = '✅ Pago';
                } else if (record.status === 'pending' || record.status === 'in_progress') {
                    if (isWeekPassed) {
                        // Semana passou e ainda está pendente/em progresso = não entregou
                        statusClass = 'missing';
                        statusText = '❌ Não Entregou';
                        showAdvBtn = true;
                    } else {
                        // Semana vigente, manter como pendente
                        statusClass = 'pending';
                        statusText = record.status === 'pending' ? '⏳ Aguardando' : '⚡ Em Progresso';
                        showAdvBtn = false;
                    }
                } else if (record.status === 'rejected' || record.status === 'not_delivered') {
                    statusClass = 'missing';
                    statusText = '❌ Não Entregou';
                    showAdvBtn = true;
                } else {
                    statusClass = 'pending';
                    statusText = '⚡ Em Progresso';
                    showAdvBtn = false;
                }
                
                // Verificar se já existe ADV para esta semana (normalizar datas)
                const recordStartNorm = String(record.week_start).split('T')[0];
                const recordEndNorm = String(record.week_end).split('T')[0];
                
                const hasAdv = data.warnings.some(w => {
                    if (!w.week_start || !w.week_end) return false;
                    const wStartNorm = String(w.week_start).split('T')[0];
                    const wEndNorm = String(w.week_end).split('T')[0];
                    return wStartNorm === recordStartNorm && wEndNorm === recordEndNorm;
                });
                
                const materials = record.items?.map(item => 
                    `<span class="payment-history-material">${item.material_icon || '📦'} ${item.amount}</span>`
                ).join('') || '<span class="payment-history-material">-</span>';
                
                // Só mostrar botão se a semana passou, não está pago e não tem ADV
                const canApplyAdv = isWeekPassed && showAdvBtn && !hasAdv;
                
                const advButton = canApplyAdv 
                    ? `<button class="btn-apply-adv" onclick='applyAdvFromHistory(${JSON.stringify(data.member).replace(/'/g, "&apos;")}, "${record.week_start}", "${record.week_end}")'>⚠️ Aplicar ADV</button>`
                    : (hasAdv && showAdvBtn ? `<span class="payment-history-status missing">⚠️ ADV JÁ APLICADA</span>` : '');
                
                return `
                    <div class="payment-history-item">
                        <div class="payment-history-item-left">
                            <div class="payment-history-week">${weekLabel}</div>
                            <span class="payment-history-status ${statusClass}">${statusText}</span>
                            <div class="payment-history-materials">${materials}</div>
                        </div>
                        <div class="payment-history-item-actions">
                            ${advButton}
                        </div>
                    </div>
                `;
            }).join('');
        
    } catch (error) {
        console.error('Erro ao carregar histórico de pagamentos:', error);
        document.getElementById('paymentHistoryList').innerHTML = 
            '<p class="payment-history-empty">Erro ao carregar dados</p>';
    }
}

// Fechar modal de histórico de pagamentos
function closePaymentHistoryModal() {
    document.getElementById('paymentHistoryModal').style.display = 'none';
}

// Aplicar advertência a partir do histórico
async function applyAdvFromHistory(member, weekStart, weekEnd) {
    const reason = prompt(`🚨 Aplicar advertência para ${member.name}\n\nSemana: ${formatWeekLabel(weekStart, weekEnd)}\n\nMotivo da advertência:`);
    
    if (!reason || reason.trim() === '') {
        alert('⚠️ Você precisa informar um motivo para a advertência');
        return;
    }
    
    if (!confirm(`Confirmar advertência para ${member.name}?\n\nMotivo: ${reason}`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/members/${member.id}/warnings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                reason: reason.trim(),
                week_start: weekStart,
                week_end: weekEnd
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert(`✅ ${data.message}`);
            // Recarregar o modal para atualizar a visualização
            openPaymentHistory(member.id);
        } else {
            alert(`❌ Erro: ${data.error}`);
        }
    } catch (error) {
        console.error('Erro ao aplicar advertência:', error);
        alert(`❌ Erro: ${error.message}`);
    }
}

// Fechar modal ao clicar fora
document.addEventListener('click', (e) => {
    const modal = document.getElementById('paymentHistoryModal');
    if (e.target === modal) {
        closePaymentHistoryModal();
    }
});

// Aplicar advertência a partir do modal de extrato
async function applyAdvFromExtract(member, weekStart, weekEnd) {
    const reason = prompt(`🚨 Aplicar advertência para ${member.name}\n\nSemana: ${formatWeekLabel(weekStart, weekEnd)}\n\nMotivo da advertência:`);
    
    if (!reason || reason.trim() === '') {
        alert('⚠️ Você precisa informar um motivo para a advertência');
        return;
    }
    
    if (!confirm(`Confirmar advertência para ${member.name}?\n\nMotivo: ${reason}`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/members/${member.id}/warnings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                reason: reason.trim(),
                week_start: weekStart,
                week_end: weekEnd
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert(`✅ ${data.message}`);
            // Recarregar o modal para atualizar a visualização
            openMemberExtract(member.id);
        } else {
            alert(`❌ Erro: ${data.error}`);
        }
    } catch (error) {
        console.error('Erro ao aplicar advertência:', error);
        alert(`❌ Erro: ${error.message}`);
    }
}

// ========== FIM MODAL PAYMENT HISTORY ==========

// Formatar label da semana
function formatWeekLabel(start, end) {
    if (!start || !end) {
        console.warn('formatWeekLabel: start ou end vazio', { start, end });
        return '-';
    }
    
    try {
        // Remover parte de hora se existir e garantir formato correto
        const startStr = String(start).split('T')[0];
        const endStr = String(end).split('T')[0];
        
        const startDate = new Date(startStr + 'T00:00:00');
        const endDate = new Date(endStr + 'T00:00:00');
        
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            console.error('formatWeekLabel: Datas inválidas', { start, end, startDate, endDate });
            return `${startStr} - ${endStr}`;
        }
        
        // Formato DD-MM-YYYY
        const formatDate = (date) => {
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();
            return `${day}-${month}-${year}`;
        };
        
        return `${formatDate(startDate)} - ${formatDate(endDate)}`;
    } catch (error) {
        console.error('formatWeekLabel: Erro ao formatar', error, { start, end });
        return '-';
    }
}

// Texto do status no extrato
function getExtractStatusText(status) {
    const texts = {
        'approved': '✅ Completo',
        'pending': '⏳ Aguardando',
        'rejected': '❌ Não Entregou',
        'in_progress': '⚡ Em Progresso',
        'not_delivered': '❌ Não Entregou'
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
    // Se já temos dados em cache válidos, apenas renderizar
    const cacheKey = `week_${selectedWeekOffset}`;
    const cached = weekDataCache.get(cacheKey);
    if (cached && weeklyStatusData && (Date.now() - cached.timestamp < 30000)) {
        // Dados ainda válidos, apenas re-renderizar
        renderWeeklyTable(currentFilter);
        return;
    }
    
    // Se já temos selectedWeek, usar loadWeekData que é mais rápido
    if (selectedWeek) {
        return loadWeekData();
    }
    
    try {
        const response = await fetch(`/api/admin/weekly-status`);
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
            tbody.innerHTML = '<tr><td colspan="5" class="loading">❌ Erro ao carregar dados</td></tr>';
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
    
    // Adicionar completos (aprovados: is_partial = false = Completo, is_partial = true = Em progresso)
    data.completed.forEach(member => {
        const isPartial = !!member.is_partial || member.is_partial === 1 || member.is_partial === '1';
        if (isPartial) {
            // Farm aprovado mas não completo = Em Progresso
            if (weekPassed) {
                allMembers.push({
                    ...member,
                    status: 'partial',
                    statusLabel: '⚡ Em Progresso',
                    statusClass: 'partial'
                });
            } else {
                allMembers.push({
                    ...member,
                    status: 'partial',
                    statusLabel: '⚡ Em Progresso',
                    statusClass: 'partial'
                });
            }
        } else {
            // Farm aprovado completo (bateu meta em todos os materiais)
            allMembers.push({
                ...member,
                status: 'completed',
                statusLabel: '✅ Completo',
                statusClass: 'completed'
            });
        }
    });
    
    // Adicionar em progresso (lista separada - caso exista)
    if (data.partial) {
        data.partial.forEach(member => {
            // Se a semana passou e está em progresso, mudar para "Não Entregou"
            if (weekPassed) {
                allMembers.push({
                    ...member,
                    status: 'partial',
                    statusLabel: '❌ Não Entregou',
                    statusClass: 'missing'
                });
            } else {
                allMembers.push({
                    ...member,
                    status: 'partial',
                    statusLabel: '⚡ Em Progresso',
                    statusClass: 'partial'
                });
            }
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
    
    // Adicionar não entregaram (incluindo rejeitados)
    data.notDelivered.forEach(member => {
        if (member.was_rejected) {
            // Farm foi rejeitado - mostrar como "Não Entregou" para permitir nova entrega
            // Mas manter a info de rejeição para visualização
            allMembers.push({
                ...member,
                status: 'missing',
                statusLabel: '❌ Não Entregou',
                statusClass: 'missing',
                was_rejected: true // Manter flag para mostrar histórico
            });
        } else {
            allMembers.push({
                ...member,
                status: 'missing',
                statusLabel: '❌ Não Entregou',
                statusClass: 'missing'
            });
        }
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
    
    // Guardar para o modal Editar Entrega poder usar o mesmo status da tabela
    window.__weeklyStatusMembersFull = allMembers;
    
    if (allMembers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="loading">😴 Nenhum membro encontrado com este filtro</td></tr>';
        return;
    }
    
    // Gerar linhas da tabela
    tbody.innerHTML = allMembers.map(member => {
        const initial = member.name.charAt(0).toUpperCase();
        
        // Exibir grupos como badges (similar à Lista de Membros)
        let groupsDisplay = '';
        if (member.groups && member.groups.length > 0) {
            const displayGroups = member.groups.filter(g => g !== 'member' || member.groups.length === 1);
            groupsDisplay = displayGroups.map(group => 
                `<span class="role-badge badge-${group}">${roleNames[group] || group}</span>`
            ).join(' ');
        } else {
            groupsDisplay = `<span class="no-role">${roleNames[member.role] || member.role || '-'}</span>`;
        }
        
        // Qualquer admin pode editar entregas
        const canEditDeliveries = currentUser && currentUser.role && currentUser.role !== 'member';
        
        // Montar botões de ação em linha
        let buttons = [];
        
        // Botão de editar sempre primeiro (se admin)
        if (canEditDeliveries) {
            if (member.delivery_id) {
                buttons.push(`<button class="action-btn" onclick="openEditDeliveryModal(${member.id}, '${selectedWeek.start}', '${selectedWeek.end}', '${member.status}')" style="background: #9b59b6;" title="Editar Entrega">✏️</button>`);
            } else {
                buttons.push(`<button class="action-btn" onclick="openCreateDeliveryFromStatus(${member.id}, '${escapeHtml(member.name.replace(/'/g, "\\'"))}', '${member.status}')" style="background: #9b59b6;" title="Criar Entrega">✏️</button>`);
            }
        }
        
        // Botões específicos por status
        switch (member.status) {
            case 'completed':
            case 'partial':
                buttons.push(`<button class="action-btn view" onclick='showDeliveryExtract(${JSON.stringify(member).replace(/'/g, "&apos;")})'>👁️</button>`);
                break;
            case 'pending':
                if (member.has_justification_pending) {
                    buttons.push(`<button class="action-btn approve" onclick='showJustificationModal(${JSON.stringify(member).replace(/'/g, "&apos;")})'>📝</button>`);
                } else {
                    buttons.push(`<button class="action-btn approve" onclick='showApprovalModal(${JSON.stringify(member).replace(/'/g, "&apos;")})'>✔️</button>`);
                    buttons.push(`<button class="action-btn view" onclick='showDeliveryExtract(${JSON.stringify(member).replace(/'/g, "&apos;")})'>👁️</button>`);
                }
                break;
            case 'justified':
                buttons.push(`<button class="action-btn view" onclick='showJustifiedDetails(${JSON.stringify(member).replace(/'/g, "&apos;")})'>📋</button>`);
                break;
            case 'missing':
                // Se foi rejeitado, mostrar botão para ver histórico da rejeição
                if (member.was_rejected) {
                    buttons.push(`<button class="action-btn view" onclick='showDeliveryExtract(${JSON.stringify(member).replace(/'/g, "&apos;")})' title="Ver extrato">👁️</button>`);
                }
                break;
        }
        
        const actionHtml = buttons.length > 0 ? buttons.join('') : '<span class="no-action">-</span>';
        
        // Badge de farm extra pendente
        let pendingExtraBadge = '';
        if (member.pending_extra && member.pending_extra.id) {
            pendingExtraBadge = `<span class="pending-extra-badge" onclick="showPendingExtraModal(${member.pending_extra.id}, '${escapeHtml(member.name.replace(/'/g, "\\'"))}')">🏆 Extra Pendente</span>`;
        }
        
        return `
            <tr class="status-${member.status}">
                <td class="passport-cell">${escapeHtml(member.passport || '-')}</td>
                <td class="member-cell"><span class="member-avatar">${initial}</span><span class="member-name" onclick="openPaymentHistory(${member.id})">${escapeHtml(member.name)}${member.is_late_payment ? ' ⏰' : ''}</span>${pendingExtraBadge}</td>
                <td class="role-cell">${groupsDisplay}</td>
                <td><span class="status-badge ${member.statusClass}">${member.statusLabel}${member.is_late_payment ? ' (Atrasado)' : ''}</span></td>
                <td style="white-space: nowrap;">${actionHtml}</td>
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

// Modal: Editar status de pagamento (apenas gerente_geral)
let editingMember = null;

function openEditStatusModal(member) {
    editingMember = member;
    
    const modal = document.getElementById('editStatusModal');
    if (!modal) {
        // Criar modal se não existir
        createEditStatusModal();
    }
    
    document.getElementById('editStatusMemberName').textContent = member.name;
    document.getElementById('editStatusMemberId').value = member.id;
    
    // Selecionar status atual
    const statusSelect = document.getElementById('editStatusSelect');
    if (member.status === 'completed') {
        statusSelect.value = 'approved';
    } else if (member.status === 'partial') {
        statusSelect.value = 'partial';
    } else if (member.status === 'pending') {
        statusSelect.value = 'pending';
    } else if (member.status === 'missing') {
        statusSelect.value = 'not_delivered';
    } else if (member.status === 'justified') {
        statusSelect.value = 'justified';
    } else {
        statusSelect.value = 'not_delivered';
    }
    
    const modalEl = document.getElementById('editStatusModal');
    modalEl.style.display = 'flex';
    setTimeout(() => modalEl.classList.add('show'), 10);
}

function createEditStatusModal() {
    const modalHtml = `
        <div id="editStatusModal" class="modal-edit-status">
            <div class="modal-edit-overlay" onclick="closeEditStatusModal()"></div>
            <div class="modal-edit-window">
                <div class="modal-edit-header">
                    <div class="modal-edit-icon">✏️</div>
                    <h2 class="modal-edit-title">Editar Status do Membro</h2>
                    <button class="modal-edit-close" onclick="closeEditStatusModal()">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                
                <div class="modal-edit-body">
                    <input type="hidden" id="editStatusMemberId">
                    
                    <div class="modal-edit-info">
                        <div class="info-item">
                            <span class="info-label">👤 Membro:</span>
                            <span class="info-value" id="editStatusMemberName"></span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">📅 Semana:</span>
                            <span class="info-value">${selectedWeek ? selectedWeek.label : 'Atual'}</span>
                        </div>
                    </div>
                    
                    <div class="modal-edit-field">
                        <label class="field-label">Status</label>
                        <select id="editStatusSelect" class="field-select">
                            <option value="approved">✅ Meta Completa (Aprovado)</option>
                            <option value="partial">🔄 Em Progresso (Parcial)</option>
                            <option value="pending">⏳ Aguardando Aprovação</option>
                            <option value="not_delivered">❌ Não Entregou</option>
                            <option value="justified">📋 Justificado</option>
                        </select>
                    </div>
                    
                    <div class="modal-edit-field">
                        <label class="field-label">Observação <span class="field-optional">(opcional)</span></label>
                        <textarea id="editStatusNote" class="field-textarea" rows="3" placeholder="Digite o motivo da alteração..."></textarea>
                    </div>
                </div>
                
                <div class="modal-edit-footer">
                    <button class="btn-edit-cancel" onclick="closeEditStatusModal()">Cancelar</button>
                    <button class="btn-edit-save" onclick="saveEditStatus()">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                            <polyline points="17 21 17 13 7 13 7 21"></polyline>
                            <polyline points="7 3 7 8 15 8"></polyline>
                        </svg>
                        Salvar Alterações
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function closeEditStatusModal() {
    const modalEl = document.getElementById('editStatusModal');
    modalEl.classList.remove('show');
    setTimeout(() => modalEl.style.display = 'none', 300);
    editingMember = null;
}

function saveEditStatus() {
    const memberId = document.getElementById('editStatusMemberId').value;
    const newStatus = document.getElementById('editStatusSelect').value;
    const note = document.getElementById('editStatusNote').value;
    
    if (!selectedWeek) {
        showNotification('Selecione uma semana primeiro!', 'error');
        return;
    }
    
    const statusLabels = {
        'approved': 'Completo',
        'partial': 'Em Progresso',
        'pending': 'Aguardando',
        'not_delivered': 'Não Entregou',
        'justified': 'Justificado'
    };
    
    showPermConfirmModal(
        '✏️ Alterar Status',
        `Tem certeza que deseja alterar o status para <strong>${statusLabels[newStatus] || newStatus}</strong>?`,
        'success',
        () => confirmSaveEditStatus(memberId, newStatus, note)
    );
}

async function confirmSaveEditStatus(memberId, newStatus, note) {
    closePermConfirmModal();
    
    try {
        const response = await fetch('/api/admin/edit-member-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: memberId,
                week_start: selectedWeek.start,
                week_end: selectedWeek.end,
                new_status: newStatus,
                note: note
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            // Limpar TODO o cache de dados da semana
            weekDataCache.clear();
            
            showNotification('✅ Status atualizado com sucesso!', 'success');
            closeEditStatusModal();
            
            // Recarregar página após 500ms
            setTimeout(() => {
                location.reload();
            }, 500);
        } else {
            showNotification(data.error || 'Erro ao atualizar status', 'error');
        }
    } catch (error) {
        console.error('Erro ao salvar status:', error);
        showNotification('Erro ao atualizar status', 'error');
    }
}

// Modal: Mostrar extrato de farm — todos os envios da semana (aprovados e rejeitados)
async function showDeliveryExtract(member) {
    let submissions = [];
    // Usar a semana que está na tela (selectedWeek) ou a que veio no status (weeklyStatusData.week) ou semana atual
    const week = (selectedWeek && selectedWeek.start && selectedWeek.end)
        ? { start: selectedWeek.start, end: selectedWeek.end }
        : (weeklyStatusData && weeklyStatusData.week && weeklyStatusData.week.start && weeklyStatusData.week.end)
            ? weeklyStatusData.week
            : (typeof getCurrentWeek === 'function')
                ? getCurrentWeek()
                : null;
    if (member.id && week && week.start && week.end) {
        try {
            const res = await fetch(`/api/admin/week-submissions?userId=${member.id}&week_start=${encodeURIComponent(week.start)}&week_end=${encodeURIComponent(week.end)}`, { credentials: 'same-origin' });
            if (res.ok) {
                const data = await res.json();
                if (data.success && Array.isArray(data.submissions)) {
                    submissions = data.submissions;
                }
            }
        } catch (e) {
            console.warn('Falha ao carregar submissões da semana:', e);
        }
    }
    if (submissions.length === 0 && member.weekly_submissions && member.weekly_submissions.length > 0) {
        submissions = member.weekly_submissions;
    }
    if (submissions.length === 0) {
        submissions = [{
            id: member.delivery_id,
            status: member.status,
            is_partial: member.is_partial,
            delivered_at: member.delivered_at,
            created_at: member.delivered_at,
            screenshot_url: member.screenshot_url,
            screenshots: member.screenshots || [],
            description: member.description,
            items: member.items || [],
            payment_type: member.payment_type,
            dirty_money_amount: member.dirty_money_amount || 0,
            approved_by_name: member.approved_by_name,
            approved_at: member.approved_at,
            approval_note: member.approval_note
        }];
    }

    const sortedSubmissions = [...submissions].sort((a, b) => new Date(b.created_at || b.delivered_at) - new Date(a.created_at || a.delivered_at));

    // Barra de progresso do farm na semana (por material) — só dentro do modal
    // 1) Buscar todos os materiais com meta ajustada para o membro (mesmo os não entregues)
    let allMaterialsForMember = [];
    try {
        const matsRes = await fetch(`/api/admin/materials?memberId=${member.id}`, { credentials: 'same-origin' });
        if (matsRes.ok) {
            const matsData = await matsRes.json();
            allMaterialsForMember = (matsData.materials || []).filter(m => m.active === 1 || m.active === '1' || m.active === true);
        }
    } catch (e) {
        console.warn('Não foi possível carregar materiais para barra de progresso:', e);
    }

    const progressByMaterial = {};

    // 2) Inicializar todos os materiais com 0 / meta
    if (allMaterialsForMember.length > 0) {
        allMaterialsForMember.forEach(mat => {
            const key = String(mat.id);
            progressByMaterial[key] = {
                name: mat.name,
                icon: mat.icon || '📦',
                total: 0,
                goal: mat.weekly_goal != null ? parseInt(mat.weekly_goal, 10) || 700 : 700
            };
        });
    }

    // 3) Somar apenas os envios APROVADOS da semana (não contar o que ainda está pendente)
    const approvedSubs = submissions.filter(sub => sub.status === 'approved');
    for (const sub of approvedSubs) {
        if (sub.payment_type === 'dirty_money') continue;
        (sub.items || []).forEach(item => {
            const key = item.material_id != null ? String(item.material_id) : (item.material_name || '');
            if (!progressByMaterial[key]) {
                // fallback se não conseguimos carregar allMaterialsForMember
                progressByMaterial[key] = {
                    name: item.material_name || 'Material',
                    icon: item.material_icon || '📦',
                    total: 0,
                    goal: item.weekly_goal != null ? parseInt(item.weekly_goal, 10) || 700 : 700
                };
            }
            progressByMaterial[key].total += parseInt(item.amount, 10) || 0;
        });
    }

    // Meta batida = todos os materiais com total >= meta
    const metaBatida = Object.keys(progressByMaterial).length > 0 &&
        Object.values(progressByMaterial).every(p => (p.total || 0) >= (p.goal || 700));

    const progressBarsHtml = metaBatida
        ? `
        <div class="extract-section progress-week meta-batida">
            <div class="extract-section-header">
                <span class="extract-section-title">✅ Meta batida</span>
            </div>
            <div class="extract-section-body">
                <p style="margin: 0; color: rgba(255,255,255,0.8);">Todos os materiais atingiram a meta desta semana.</p>
            </div>
        </div>
        `
        : (Object.keys(progressByMaterial).length > 0
        ? `
        <div class="extract-section progress-week">
            <div class="extract-section-header">
                <span class="extract-section-title">📊 Progresso da semana (meta)</span>
            </div>
            <div class="extract-section-body">
                ${Object.values(progressByMaterial).map(p => {
                    const goal = p.goal || 700;
                    const pct = goal > 0 ? Math.min(100, Math.round((p.total / goal) * 100)) : 0;
                    const cls = pct >= 100 ? 'complete' : pct >= 50 ? 'partial' : 'low';
                    return `
                    <div class="progress-week-row">
                        <span class="progress-week-label">${p.icon} ${p.name}</span>
                        <div class="progress-week-bar-wrap">
                            <div class="progress-week-bar ${cls}" style="width: ${pct}%"></div>
                        </div>
                        <span class="progress-week-value">${formatNumber(p.total)} / ${formatNumber(goal)}</span>
                    </div>`;
                }).join('')}
            </div>
        </div>
        `
        : '');

    const statusLabel = (submission) => {
        const s = (submission.status || '').toLowerCase();
        if (s === 'approved') {
            return submission.is_partial ? { text: '✅ Aprovado', cls: 'approved' } : { text: '✅ Aprovado', cls: 'approved' };
        }
        if (s === 'pending') return { text: '⏳ Aguardando Aprovação', cls: 'pending' };
        if (s === 'rejected') return { text: '❌ Rejeitado', cls: 'rejected' };
        if (s === 'not_delivered' && submission.approved_by_name) return { text: '❌ Rejeitado', cls: 'rejected' };
        return { text: `📌 ${submission.status || 'Enviado'}`, cls: 'pending' };
    };

    const submissionsHtml = sortedSubmissions.map((submission, index) => {
        const isDirtyMoney = submission.payment_type === 'dirty_money';
        const status = statusLabel(submission);
        const s = (submission.status || '').toLowerCase();
        const isRejected = s === 'rejected' || (s === 'not_delivered' && submission.approved_by_name);

        let printsHtml = '';
        if (submission.screenshots && submission.screenshots.length > 0) {
            printsHtml = submission.screenshots.map((s, idx) => `
                <img src="${s.screenshot_url}" class="extract-thumb" onclick="openModal('${s.screenshot_url}')" alt="Print ${idx + 1}">
            `).join('');
        } else if (submission.screenshot_url) {
            printsHtml = `<img src="${submission.screenshot_url}" class="extract-thumb" onclick="openModal('${submission.screenshot_url}')">`;
        } else {
            printsHtml = '<span class="no-prints-text">Sem prints</span>';
        }

        let contentHtml = '';
        if (isDirtyMoney) {
            const amount = submission.dirty_money_amount || 0;
            contentHtml = `<div class="extract-dirty-money"><div class="dirty-value">💰 R$ ${amount.toLocaleString('pt-BR')}</div></div>`;
        } else {
            contentHtml = submission.items && submission.items.length > 0
                ? `<div class="extract-materials">${submission.items.map(item => `
                    <span class="extract-mat-tag">${item.material_icon || '📦'} ${item.material_name}: ${formatNumber(item.amount)}</span>
                `).join('')}</div>`
                : '<p class="no-items">Sem materiais</p>';
        }

        let approvalInfoHtml = '';
        // Só mostrar "Aprovado por" quando a meta estiver toda completa (aprovado e não parcial)
        if (metaBatida && (submission.status || '').toLowerCase() === 'approved' && !submission.is_partial && submission.approved_by_name) {
            approvalInfoHtml = `
                <div class="approval-info">
                    <div class="approver">✅ Aprovado por: ${submission.approved_by_name}</div>
                    ${submission.approved_at ? `<div style="color: rgba(255,255,255,0.6); font-size: 12px;">📅 ${new Date(submission.approved_at).toLocaleDateString('pt-BR')} às ${new Date(submission.approved_at).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}</div>` : ''}
                    ${submission.approval_note ? `<div class="approval-note">📝 ${submission.approval_note}</div>` : ''}
                </div>
            `;
        }

        return `
            <div class="extract-section meta ${isRejected ? 'status-rejected' : ''}" style="margin-bottom: 16px;">
                <div class="extract-section-header">
                    <span class="extract-section-title">📦 Envio #${sortedSubmissions.length - index}</span>
                </div>
                <div class="extract-section-body">
                    ${contentHtml}
                    <div class="extract-prints">${printsHtml}</div>
                </div>
                <div class="extract-section-footer">
                    📤 ${new Date(submission.created_at || submission.delivered_at).toLocaleString('pt-BR')}
                    ${submission.description ? ` • ${submission.description}` : ''}
                </div>
                ${approvalInfoHtml}
            </div>
        `;
    }).join('');
    
    // Mostrar farms extras - primeiro usa dados que já vieram do backend, senão busca via API
    let extraFarmsHtml = '';
    
    // Se já temos dados de extra do backend (vem do weekly-status)
    if (member.extra_items && member.extra_items.length > 0) {
        const extraMaterials = member.extra_items.map(m => `
            <span class="extract-mat-tag extra">${m.material_icon || '📦'} ${m.material_name}: ${formatNumber(m.amount)}</span>
        `).join('');
        
        let extraScreenshotsHtml = '';
        if (member.extra_screenshots && member.extra_screenshots.length > 0) {
            extraScreenshotsHtml = member.extra_screenshots.map((s, idx) => `
                <img src="${s.screenshot_url}" class="extract-thumb extra" onclick="openModal('${s.screenshot_url}')" alt="Print Extra ${idx + 1}">
            `).join('');
        } else {
            extraScreenshotsHtml = '<span class="no-prints-text">Sem prints</span>';
        }
        
        extraFarmsHtml = `
            <div class="extract-section extra">
                <div class="extract-section-header">
                    <span class="extract-section-title">🏆 Farm Extra (Ranking)</span>
                    <span class="extract-status approved">✅ Aprovado</span>
                </div>
                <div class="extract-section-body">
                    <div class="extract-materials">${extraMaterials}</div>
                    <div class="extract-prints">${extraScreenshotsHtml}</div>
                </div>
                <div class="extract-section-footer">Total extra: ${(member.total_extra_materials || 0).toLocaleString('pt-BR')} materiais</div>
            </div>
        `;
    } 
    // Senão, buscar via API se competição ativa
    else if (member.delivery_id && competitionEnabled) {
        try {
            const response = await fetch(`/api/admin/extra-farms/by-delivery/${member.delivery_id}`);
            const data = await response.json();
            
            if (data.success && data.extras && data.extras.length > 0) {
                extraFarmsHtml = data.extras.map(extra => {
                    const statusClass = extra.status;
                    const statusText = extra.status === 'approved' ? '✅ Aprovado' : 
                                      extra.status === 'rejected' ? '❌ Rejeitado' : '⏳ Pendente';
                    
                    // Materiais do extra
                    const extraMaterials = extra.materialDetails?.map(m => `
                        <span class="extract-mat-tag extra">${m.icon || '📦'} ${escapeHtml(m.name)}: ${formatNumber(m.amount)}</span>
                    `).join('') || '';
                    
                    // Screenshots do extra
                    let extraScreenshotsHtml = '';
                    if (extra.screenshots && extra.screenshots.length > 0) {
                        extraScreenshotsHtml = extra.screenshots.map((s, idx) => `
                            <img src="${s.screenshot_url}" class="extract-thumb extra" onclick="openModal('${s.screenshot_url}')" alt="Print Extra ${idx + 1}">
                        `).join('');
                    } else {
                        extraScreenshotsHtml = '<span class="no-prints-text">Sem prints</span>';
                    }
                    
                    return `
                        <div class="extract-section extra">
                            <div class="extract-section-header">
                                <span class="extract-section-title">🏆 Farm Extra</span>
                                <span class="extract-status ${statusClass}">${statusText}</span>
                            </div>
                            <div class="extract-section-body">
                                <div class="extract-materials">${extraMaterials || '<span class="no-items">-</span>'}</div>
                                <div class="extract-prints">${extraScreenshotsHtml}</div>
                            </div>
                            <div class="extract-section-footer">📤 ${formatDate(extra.created_at)}</div>
                        </div>
                    `;
                }).join('');
            }
        } catch (e) {
            console.log('Erro ao carregar farms extras via API:', e);
        }
    }
    
    showActionModal(`
        <div class="extract-modal-v2">
            <div class="extract-modal-header">
                <h2>📋 Extrato do Farm</h2>
                <div class="extract-member-info">
                    <span class="extract-member-name">👤 ${escapeHtml(member.name)}</span>
                </div>
            </div>

            ${progressBarsHtml}

            ${submissionsHtml}
            
            ${extraFarmsHtml}
            
            <div class="extract-modal-footer">
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
                <span class="extract-member">👤 ${escapeHtml(member.name)}</span>
            </div>
            <div class="extract-info">
                <p>📅 Enviado em: ${new Date(member.delivered_at).toLocaleDateString('pt-BR')}</p>
                ${member.description ? `<p>📝 ${escapeHtml(member.description)}</p>` : ''}
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
            <div class="approval-note-container">
                <h3>📝 Observação (obrigatória para rejeição)</h3>
                <textarea id="approvalNoteInput" class="approval-note-input" placeholder="Digite uma observação (ao rejeitar, esse motivo será mostrado ao membro)..." rows="3"></textarea>
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

// Aprovar entrega com possível edição de dinheiro sujo - MODAL DE CONFIRMAÇÃO
function approveDeliveryFromModal(deliveryId) {
    // Salvar o valor de dinheiro sujo se aplicável
    let dirtyMoneyAmount = null;
    if (window.currentApprovalIsDirtyMoney && window.currentApprovalDeliveryId === deliveryId) {
        const amountInput = document.getElementById('editDirtyMoneyAmount');
        if (amountInput) {
            dirtyMoneyAmount = parseInt(amountInput.value) || 0;
        }
    }
    
    // Pegar observação
    const approvalNoteInput = document.getElementById('approvalNoteInput');
    const approvalNote = approvalNoteInput ? approvalNoteInput.value.trim() : '';
    
    // Mostrar modal de confirmação
    showConfirmationModal(
        '✅ Confirmar Aprovação',
        'Tem certeza que deseja <strong>APROVAR</strong> este farm da meta?',
        'success',
        () => confirmApproveDeliveryFromModal(deliveryId, dirtyMoneyAmount, approvalNote)
    );
}

// Confirmar aprovação do farm (após modal)
async function confirmApproveDeliveryFromModal(deliveryId, dirtyMoneyAmount, approvalNote) {
    closeConfirmationModal();
    
    // Se for dinheiro sujo, primeiro salvar o valor editado
    if (dirtyMoneyAmount !== null) {
        try {
            await fetch(`/api/admin/deliveries/${deliveryId}/dirty-money`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dirty_money_amount: dirtyMoneyAmount })
            });
        } catch (e) {
            console.error('Erro ao atualizar dinheiro sujo:', e);
        }
    }
    
    // Aprovar a entrega
    try {
        const response = await fetch(`/api/admin/deliveries/${deliveryId}/approve`, { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ approval_note: approvalNote || null })
        });
        const data = await response.json();
        
        if (data.success) {
            // Limpar TODO o cache de dados da semana
            weekDataCache.clear();
            
            closeActionModal();
            showNotification(data.message, 'success');
            
            // Recarregar página após 500ms
            setTimeout(() => {
                location.reload();
            }, 500);
        } else {
            showNotification('Erro: ' + (data.error || 'Erro desconhecido'), 'error');
        }
    } catch (error) {
        console.error('Erro ao aprovar:', error);
        showNotification('Erro ao aprovar. Tente novamente.', 'error');
    }
}

// Modal: Aprovar/Rejeitar justificativa pendente
function showJustificationModal(member) {
    showActionModal(`
        <div class="justification-modal">
            <div class="extract-header">
                <h2>📝 Avaliar Justificativa</h2>
                <span class="extract-member">👤 ${escapeHtml(member.name)}</span>
            </div>
            <div class="justification-content">
                <h3>Motivo da Ausência:</h3>
                <div class="justification-reason-box">
                    ${escapeHtml(member.justification_reason)}
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
                <span class="extract-member">👤 ${escapeHtml(member.name)}</span>
            </div>
            <div class="justification-content">
                <h3>Motivo da Ausência:</h3>
                <div class="justification-reason-box">
                    ${escapeHtml(member.justification_reason)}
                </div>
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="closeActionModal()">Fechar</button>
            </div>
        </div>
    `);
}

// Modal: Ver detalhes de farm rejeitado
function showRejectedDetails(member) {
    // Montar lista de materiais que foram rejeitados
    let materialsHtml = '';
    if (member.rejected_items && member.rejected_items.length > 0) {
        materialsHtml = member.rejected_items.map(item => `
            <span class="extract-mat-tag rejected">${item.material_icon || '📦'} ${item.material_name}: ${formatNumber(item.amount)}</span>
        `).join('');
    } else {
        materialsHtml = '<span class="no-items">Sem materiais registrados</span>';
    }
    
    // Montar galeria de screenshots
    let screenshotsHtml = '';
    if (member.rejected_screenshots && member.rejected_screenshots.length > 0) {
        screenshotsHtml = member.rejected_screenshots.map((s, idx) => `
            <img src="${s.screenshot_url}" class="extract-thumb" onclick="openModal('${s.screenshot_url}')" alt="Print ${idx + 1}">
        `).join('');
    } else {
        screenshotsHtml = '<span class="no-prints-text">Sem prints</span>';
    }
    
    showActionModal(`
        <div class="extract-modal-v2 rejected-modal">
            <div class="extract-modal-header" style="border-left: 4px solid #e74c3c;">
                <h2>🚫 Farm Rejeitado</h2>
                <div class="extract-member-info">
                    <span class="extract-member-name">👤 ${escapeHtml(member.name)}</span>
                </div>
            </div>
            
            <div class="extract-section" style="border-left: 3px solid #e74c3c;">
                <div class="extract-section-header">
                    <span class="extract-section-title">📦 Materiais Enviados</span>
                    <span class="extract-status rejected">🚫 Rejeitado</span>
                </div>
                <div class="extract-section-body">
                    <div class="extract-materials">${materialsHtml}</div>
                    <div class="extract-prints">${screenshotsHtml}</div>
                </div>
            </div>
            
            <div class="rejection-info">
                <div class="rejector">❌ Rejeitado por: <strong>${member.rejected_by_name || 'Desconhecido'}</strong></div>
                ${member.rejected_at ? `<div style="color: rgba(255,255,255,0.6); font-size: 12px;">📅 ${new Date(member.rejected_at).toLocaleDateString('pt-BR')} às ${new Date(member.rejected_at).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}</div>` : ''}
                ${member.rejection_note ? `<div class="rejection-note">📝 Motivo: ${member.rejection_note}</div>` : ''}
            </div>
            
            <div class="extract-modal-footer">
                <button class="btn btn-secondary" onclick="closeActionModal()">Fechar</button>
            </div>
        </div>
    `);
}

// Função para rejeitar do modal
// Rejeitar entrega - MODAL DE CONFIRMAÇÃO
function rejectDeliveryFromModal(deliveryId) {
    // Pegar observação do campo (mesmo campo usado para aprovação)
    const approvalNoteInput = document.getElementById('approvalNoteInput');
    const rejectionNote = approvalNoteInput ? approvalNoteInput.value.trim() : '';

    if (!rejectionNote) {
        showNotification('Informe o motivo da reprovação.', 'warning');
        if (approvalNoteInput) approvalNoteInput.focus();
        return;
    }
    
    showConfirmationModal(
        '❌ Confirmar Rejeição',
        'Tem certeza que deseja <strong>REJEITAR</strong> este farm da meta?<br><br><small style="color: #e74c3c;">O motivo será enviado ao membro e ele poderá refazer o farm.</small>',
        'danger',
        () => confirmRejectDeliveryFromModal(deliveryId, rejectionNote)
    );
}

// Confirmar rejeição do farm (após modal)
async function confirmRejectDeliveryFromModal(deliveryId, rejectionNote) {
    closeConfirmationModal();
    
    try {
        const response = await fetch(`/api/admin/deliveries/${deliveryId}/reject`, { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rejection_note: rejectionNote || null })
        });
        const data = await response.json();
        
        if (data.success) {
            // Limpar TODO o cache de dados da semana
            weekDataCache.clear();
            
            closeActionModal();
            showNotification('Farm rejeitado com sucesso!', 'success');
            
            // Recarregar página após 500ms
            setTimeout(() => {
                location.reload();
            }, 500);
        } else {
            showNotification(data.error || 'Erro ao rejeitar', 'error');
        }
    } catch (error) {
        showNotification('Erro ao rejeitar entrega', 'error');
    }
}

// ==================== OBSERVAÇÕES DOS MEMBROS ====================

let currentObservationsMemberId = null;
let currentObservationsMemberName = '';

async function openObservationsModal(memberId, memberName) {
    currentObservationsMemberId = memberId;
    currentObservationsMemberName = memberName;
    
    // Buscar observações existentes
    const weekStart = selectedWeek ? selectedWeek.start : getCurrentWeek().start;
    const weekEnd = selectedWeek ? selectedWeek.end : getCurrentWeek().end;
    
    let observationsHtml = '<p class="loading">Carregando...</p>';
    
    showActionModal(`
        <div class="observations-modal">
            <div class="extract-header">
                <h2>💬 Observações</h2>
                <span class="extract-member">👤 ${memberName}</span>
            </div>
            
            <div class="observation-form">
                <textarea id="newObservationInput" class="observation-input" placeholder="Digite uma observação sobre este membro..." rows="3"></textarea>
                <button class="btn btn-primary" onclick="addObservation()">➕ Adicionar Observação</button>
            </div>
            
            <div class="observations-list" id="observationsList">
                ${observationsHtml}
            </div>
            
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="closeActionModal()">Fechar</button>
            </div>
        </div>
    `);
    
    // Carregar observações
    await loadObservations();
}

async function loadObservations() {
    const weekStart = selectedWeek ? selectedWeek.start : getCurrentWeek().start;
    const weekEnd = selectedWeek ? selectedWeek.end : getCurrentWeek().end;
    
    try {
        const response = await fetch(`/api/admin/member/${currentObservationsMemberId}/observations?week_start=${weekStart}&week_end=${weekEnd}`);
        const data = await response.json();
        
        const container = document.getElementById('observationsList');
        
        if (data.observations && data.observations.length > 0) {
            container.innerHTML = data.observations.map(obs => `
                <div class="observation-item">
                    <div class="observation-header">
                        <span class="observation-author">👤 ${escapeHtml(obs.created_by_name)}</span>
                        <span class="observation-date">${new Date(obs.created_at).toLocaleDateString('pt-BR')} ${new Date(obs.created_at).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}</span>
                        <button class="btn-delete-obs" onclick="deleteObservation(${obs.id})" title="Remover">🗑️</button>
                    </div>
                    <div class="observation-text">${escapeHtml(obs.observation)}</div>
                </div>
            `).join('');
        } else {
            container.innerHTML = '<div class="empty-observations">📝 Nenhuma observação registrada nesta semana</div>';
        }
    } catch (error) {
        console.error('Erro ao carregar observações:', error);
        document.getElementById('observationsList').innerHTML = '<div class="error">Erro ao carregar observações</div>';
    }
}

async function addObservation() {
    const input = document.getElementById('newObservationInput');
    const observation = input.value.trim();
    
    if (!observation) {
        showNotification('Digite uma observação', 'warning');
        return;
    }
    
    const weekStart = selectedWeek ? selectedWeek.start : getCurrentWeek().start;
    const weekEnd = selectedWeek ? selectedWeek.end : getCurrentWeek().end;
    
    try {
        const response = await fetch(`/api/admin/member/${currentObservationsMemberId}/observations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                week_start: weekStart,
                week_end: weekEnd,
                observation
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            input.value = '';
            showNotification('Observação adicionada!', 'success');
            await loadObservations();
        } else {
            showNotification(data.error || 'Erro ao adicionar', 'error');
        }
    } catch (error) {
        console.error('Erro ao adicionar observação:', error);
        showNotification('Erro ao adicionar observação', 'error');
    }
}

async function deleteObservation(obsId) {
    if (!confirm('Remover esta observação?')) return;
    
    try {
        const response = await fetch(`/api/admin/observations/${obsId}`, { method: 'DELETE' });
        const data = await response.json();
        
        if (data.success) {
            showNotification('Observação removida!', 'success');
            await loadObservations();
        } else {
            showNotification(data.error || 'Erro ao remover', 'error');
        }
    } catch (error) {
        console.error('Erro ao remover observação:', error);
        showNotification('Erro ao remover observação', 'error');
    }
}

function getCurrentWeek() {
    const now = new Date();
    const day = now.getDay();
    const diffToMonday = (day === 0 ? -6 : 1) - day;
    
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);
    monday.setHours(0, 0, 0, 0);
    
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    
    return {
        start: monday.toISOString().split('T')[0],
        end: sunday.toISOString().split('T')[0]
    };
}

async function approveJustificationFromModal(justificationId) {
    try {
        const response = await fetch(`/api/admin/justifications/${justificationId}/approve`, {
            method: 'PUT'
        });
        
        const data = await response.json();
        
        if (response.ok) {
            // Limpar TODO o cache de dados da semana
            weekDataCache.clear();
            
            closeActionModal();
            showNotification('Justificativa aprovada com sucesso!', 'success');
            
            // Recarregar página após 500ms
            setTimeout(() => {
                location.reload();
            }, 500);
        } else {
            showNotification(data.error || 'Erro ao aprovar justificativa', 'error');
        }
    } catch (error) {
        showNotification('Erro ao aprovar justificativa', 'error');
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
            // Limpar TODO o cache de dados da semana
            weekDataCache.clear();
            
            closeActionModal();
            showNotification('Justificativa rejeitada!', 'success');
            
            // Recarregar página após 500ms
            setTimeout(() => {
                location.reload();
            }, 500);
        } else {
            showNotification(data.error || 'Erro ao rejeitar justificativa', 'error');
        }
    } catch (error) {
        showNotification('Erro ao rejeitar justificativa', 'error');
    }
}

// Mostrar modal de ação genérico
// Modal de confirmação genérico
function showConfirmationModal(title, message, type, onConfirm) {
    // Remover modal existente se houver
    const existingModal = document.getElementById('confirmationModal');
    if (existingModal) existingModal.remove();
    
    const colorClass = type === 'danger' ? 'btn-danger' : 'btn-success';
    const iconColor = type === 'danger' ? '#e74c3c' : '#00b894';
    const icon = type === 'danger' ? '⚠️' : '✅';
    
    const modal = document.createElement('div');
    modal.id = 'confirmationModal';
    modal.className = 'action-modal-overlay';
    modal.style.zIndex = '10001'; // Acima do action modal
    modal.innerHTML = `
        <div class="action-modal-content" style="max-width: 400px; text-align: center;">
            <div style="font-size: 48px; margin-bottom: 15px;">${icon}</div>
            <h2 style="color: ${iconColor}; margin-bottom: 15px;">${title}</h2>
            <p style="margin-bottom: 25px; color: #bdc3c7; line-height: 1.6;">${message}</p>
            <div class="modal-actions" style="display: flex; gap: 15px; justify-content: center;">
                <button class="btn ${colorClass}" id="confirmModalBtn">
                    ${type === 'danger' ? '❌ Sim, Rejeitar' : '✅ Sim, Aprovar'}
                </button>
                <button class="btn btn-secondary" onclick="closeConfirmationModal()">
                    Cancelar
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    // Adicionar evento ao botão de confirmar
    document.getElementById('confirmModalBtn').addEventListener('click', onConfirm);
    
    // Fechar ao clicar fora
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeConfirmationModal();
    });
}

function closeConfirmationModal() {
    const modal = document.getElementById('confirmationModal');
    if (modal) modal.remove();
}

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
    const container = document.getElementById('justificationsList');
    
    try {
        const params = selectedWeek ? `?week_start=${selectedWeek.start}&week_end=${selectedWeek.end}` : '';
        const response = await fetch(`/api/admin/justifications/pending${params}`);
        const data = await response.json();
        
        // Suporta tanto { justifications: [...] } quanto array direto
        const justifications = data.justifications || data || [];
        
        if (!justifications || justifications.length === 0) {
            container.innerHTML = '<div class="empty-state">✅ Nenhuma justificativa pendente nesta semana</div>';
            return;
        }
        
        container.innerHTML = justifications.map(j => {
            // Exibir grupos
            let groupsDisplay = '';
            if (j.user_groups && j.user_groups.length > 0) {
                const displayGroups = j.user_groups.filter(g => g !== 'member' || j.user_groups.length === 1);
                groupsDisplay = displayGroups.map(group => roleNames[group] || group).join(', ');
            } else {
                groupsDisplay = roleNames[j.user_role || j.role] || j.user_role || j.role;
            }
            
            return `
            <div class="justification-card">
                <div class="justification-header">
                    <div class="justification-user">
                        <span class="user-name">👤 ${escapeHtml(j.user_name || j.name)}</span>
                        <span class="user-role">${groupsDisplay}</span>
                    </div>
                    <div class="justification-date">
                        📅 Semana: ${formatWeekDate(j.week_start)} - ${formatWeekDate(j.week_end)}
                    </div>
                </div>
                <div class="justification-content">
                    <div class="justification-reason">
                        <strong>📝 Motivo:</strong>
                        <p>${escapeHtml(j.reason)}</p>
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
        `;
        }).join('');
        
    } catch (error) {
        console.error('Erro ao carregar justificativas:', error);
        container.innerHTML = '<div class="empty-state">❌ Erro ao carregar justificativas</div>';
    }
}

function formatWeekDate(dateStr) {
    if (!dateStr) return '';
    // Normaliza a string de data para evitar problemas de timezone
    const dateOnly = String(dateStr).split('T')[0]; // Remove horário se existir
    const [year, month, day] = dateOnly.split('-');
    // Retorna no formato DD/MM/YYYY sem usar new Date() para evitar conversão de timezone
    return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
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
            // Limpar TODO o cache de dados da semana
            weekDataCache.clear();
            
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
            // Limpar TODO o cache de dados da semana
            weekDataCache.clear();
            
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

// ==================== ABAS DE JUSTIFICATIVAS ====================

let justifExtractData = [];

function switchJustificationTab(tab) {
    // Trocar abas
    document.querySelectorAll('.justif-tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.justif-tab-content').forEach(content => content.classList.remove('active'));
    
    document.querySelector(`.justif-tab-btn[onclick*="${tab}"]`).classList.add('active');
    document.getElementById(`justif-${tab}-content`).classList.add('active');
    
    // Carregar dados da aba
    if (tab === 'pending') {
        loadJustifications();
    } else if (tab === 'extract') {
        loadJustificationsExtract();
    }
}

async function loadJustificationsExtract() {
    const container = document.getElementById('justificationsExtract');
    
    try {
        container.innerHTML = '<p class="loading">Carregando extrato...</p>';
        
        const response = await fetch('/api/admin/justifications/all');
        const data = await response.json();
        
        justifExtractData = data.justifications || [];
        
        if (justifExtractData.length === 0) {
            container.innerHTML = '<div class="empty-state">📝 Nenhuma justificativa registrada</div>';
            return;
        }
        
        renderJustifExtract();
        
    } catch (error) {
        console.error('Erro ao carregar extrato:', error);
        container.innerHTML = '<div class="empty-state">❌ Erro ao carregar extrato</div>';
    }
}

function renderJustifExtract() {
    const container = document.getElementById('justificationsExtract');
    const searchTerm = document.getElementById('searchJustifExtract')?.value.toLowerCase() || '';
    const statusFilter = document.getElementById('filterJustifStatus')?.value || 'all';
    
    let filtered = justifExtractData;
    
    // Filtrar por busca
    if (searchTerm) {
        filtered = filtered.filter(j => 
            j.user_name.toLowerCase().includes(searchTerm) ||
            j.passport?.toString().includes(searchTerm)
        );
    }
    
    // Filtrar por status
    if (statusFilter !== 'all') {
        filtered = filtered.filter(j => j.status === statusFilter);
    }
    
    if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-state">🔍 Nenhuma justificativa encontrada</div>';
        return;
    }
    
    container.innerHTML = filtered.map(j => {
        const statusClass = j.status;
        const statusText = {
            'approved': '✅ Aprovada',
            'rejected': '❌ Rejeitada',
            'pending': '⏳ Pendente'
        }[j.status] || j.status;
        
        return `
            <div class="justif-extract-item status-${statusClass}">
                <div class="justif-extract-header">
                    <div class="justif-extract-member">
                        <strong>${escapeHtml(j.user_name)}</strong>
                        <span class="passport">#${escapeHtml(j.passport || 'N/A')}</span>
                    </div>
                    <span class="justif-extract-status ${statusClass}">${statusText}</span>
                </div>
                
                <div class="justif-extract-body">
                    <div class="justif-extract-reason">
                        ${escapeHtml(j.reason)}
                    </div>
                </div>
                
                <div class="justif-extract-footer">
                    <span class="justif-extract-week">
                        📅 Semana: ${new Date(j.week_start).toLocaleDateString('pt-BR')} - ${new Date(j.week_end).toLocaleDateString('pt-BR')}
                    </span>
                    <span class="justif-extract-date">
                        🕒 Enviada: ${new Date(j.created_at).toLocaleDateString('pt-BR')} ${new Date(j.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                </div>
            </div>
        `;
    }).join('');
}

function filterJustifExtract() {
    renderJustifExtract();
}

// ==================== ABAS DE FARMS ====================

let farmsExtractData = [];
let extraFarmsExtractData = [];

function switchFarmsTab(tab) {
    // Trocar abas
    document.querySelectorAll('.justif-tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.justif-tab-content').forEach(content => content.classList.remove('active'));
    
    const activeButton = Array.from(document.querySelectorAll('.justif-tab-btn')).find(btn => btn.onclick.toString().includes(`switchFarmsTab('${tab}')`));
    if (activeButton) activeButton.classList.add('active');
    
    document.getElementById(`farms-${tab}-content`).classList.add('active');
    
    // Carregar dados da aba
    if (tab === 'pending') {
        loadPendingDeliveries();
    } else if (tab === 'extract') {
        loadFarmsExtract();
    } else if (tab === 'extra-extract') {
        loadExtraFarmsExtract();
    }
}

async function loadFarmsExtract() {
    const container = document.getElementById('farmsExtract');
    
    try {
        container.innerHTML = '<p class="loading">Carregando extrato...</p>';
        
        const response = await fetch('/api/admin/deliveries/all-farms');
        const data = await response.json();
        
        farmsExtractData = data.deliveries || [];
        
        if (farmsExtractData.length === 0) {
            container.innerHTML = '<div class="empty-state">📦 Nenhum farm registrado</div>';
            return;
        }
        
        renderFarmsExtract();
        
    } catch (error) {
        console.error('Erro ao carregar extrato:', error);
        container.innerHTML = '<div class="empty-state">❌ Erro ao carregar extrato</div>';
    }
}

function renderFarmsExtract() {
    const container = document.getElementById('farmsExtract');
    const searchTerm = document.getElementById('searchFarmsExtract')?.value.toLowerCase() || '';
    const statusFilter = document.getElementById('filterFarmsStatus')?.value || 'all';
    
    let filtered = farmsExtractData;
    
    // Filtrar por busca
    if (searchTerm) {
        filtered = filtered.filter(f => 
            f.user_name.toLowerCase().includes(searchTerm) ||
            f.passport?.toString().includes(searchTerm)
        );
    }
    
    // Filtrar por status
    if (statusFilter !== 'all') {
        filtered = filtered.filter(f => f.status === statusFilter);
    }
    
    if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-state">🔍 Nenhum farm encontrado</div>';
        return;
    }
    
    container.innerHTML = filtered.map(f => {
        const statusClass = f.status;
        const statusText = {
            'approved': '✅ Aprovado',
            'rejected': '❌ Rejeitado',
            'pending': '⏳ Pendente'
        }[f.status] || f.status;
        
        // Montar lista de materiais
        let materialsHtml = '';
        if (f.items && f.items.length > 0) {
            materialsHtml = f.items.map(item => 
                `<span class="material-tag">${item.material_icon || '📦'} ${item.material_name}: ${formatNumber(item.amount)}</span>`
            ).join('');
        }
        
        // Montar galeria de screenshots
        let screenshotsHtml = '';
        if (f.screenshots && f.screenshots.length > 0) {
            screenshotsHtml = `
                <div class="farm-extract-screenshots">
                    ${f.screenshots.map(s => `
                        <img src="${s.screenshot_url}" onclick="openModal('${s.screenshot_url}')" alt="Screenshot">
                    `).join('')}
                </div>
            `;
        }
        
        // Info de aprovação
        let approvalInfoHtml = '';
        if (f.status === 'approved' && f.approved_by_name) {
            approvalInfoHtml = `
                <div class="approval-info">
                    <div class="approver">✅ Aprovado por: ${f.approved_by_name}</div>
                    ${f.approved_at ? `<span style="color: rgba(255,255,255,0.6); font-size: 11px;">📅 ${new Date(f.approved_at).toLocaleDateString('pt-BR')} às ${new Date(f.approved_at).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}</span>` : ''}
                    ${f.approval_note ? `<div class="approval-note">📝 ${f.approval_note}</div>` : ''}
                </div>
            `;
        } else if (f.status === 'rejected' && f.approved_by_name) {
            approvalInfoHtml = `
                <div class="rejection-info">
                    <div class="rejector">❌ Rejeitado por: ${f.approved_by_name}</div>
                    ${f.approved_at ? `<span style="color: rgba(255,255,255,0.6); font-size: 11px;">📅 ${new Date(f.approved_at).toLocaleDateString('pt-BR')} às ${new Date(f.approved_at).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}</span>` : ''}
                    ${f.approval_note ? `<div class="rejection-note">📝 Motivo: ${f.approval_note}</div>` : ''}
                </div>
            `;
        }

        return `
            <div class="justif-extract-item">
                <div class="justif-extract-header">
                    <div class="justif-extract-member">
                        <strong>${f.user_name}</strong>
                        <span class="passport">#${f.passport || 'N/A'}</span>
                    </div>
                    <span class="justif-extract-status ${statusClass}">${statusText}</span>
                </div>
                
                <div class="justif-extract-body">
                    <div class="farm-extract-materials">
                        ${materialsHtml || '<span style="color:#888;">Sem materiais</span>'}
                    </div>
                    ${f.description ? `<p style="margin-top:10px;color:#bbb;">${f.description}</p>` : ''}
                    ${screenshotsHtml}
                    ${approvalInfoHtml}
                </div>
                
                <div class="justif-extract-footer">
                    <span class="justif-extract-week">
                        📅 Semana: ${new Date(f.week_start).toLocaleDateString('pt-BR')} - ${new Date(f.week_end).toLocaleDateString('pt-BR')}
                    </span>
                    <span class="justif-extract-date">
                        🕒 Entregue: ${new Date(f.created_at).toLocaleDateString('pt-BR')} ${new Date(f.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                </div>
            </div>
        `;
    }).join('');
}

function filterFarmsExtract() {
    renderFarmsExtract();
}

// ==================== EXTRATO DE FARMS EXTRAS ====================

async function loadExtraFarmsExtract() {
    const container = document.getElementById('extraFarmsExtract');
    
    try {
        container.innerHTML = '<p class="loading">Carregando extrato de farms extras...</p>';
        
        const response = await fetch('/api/admin/extra-farms/extract');
        const data = await response.json();
        
        extraFarmsExtractData = data.extras || [];
        
        if (extraFarmsExtractData.length === 0) {
            container.innerHTML = '<div class="empty-state">🏆 Nenhum farm extra registrado</div>';
            return;
        }
        
        renderExtraFarmsExtract();
        
    } catch (error) {
        console.error('Erro ao carregar extrato de farms extras:', error);
        container.innerHTML = '<div class="empty-state">❌ Erro ao carregar extrato</div>';
    }
}

function renderExtraFarmsExtract() {
    const container = document.getElementById('extraFarmsExtract');
    const searchTerm = document.getElementById('searchExtraFarmsExtract')?.value.toLowerCase() || '';
    const statusFilter = document.getElementById('filterExtraFarmsStatus')?.value || 'all';
    
    let filtered = extraFarmsExtractData;
    
    // Filtrar por busca
    if (searchTerm) {
        filtered = filtered.filter(f => 
            f.user_name.toLowerCase().includes(searchTerm) || 
            (f.user_passport && f.user_passport.toLowerCase().includes(searchTerm))
        );
    }
    
    // Filtrar por status
    if (statusFilter !== 'all') {
        filtered = filtered.filter(f => f.status === statusFilter);
    }
    
    if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-state">🔍 Nenhum farm extra encontrado com esses filtros</div>';
        return;
    }
    
    container.innerHTML = filtered.map(f => {
        let statusClass = '';
        let statusText = '';
        
        switch (f.status) {
            case 'approved':
                statusClass = 'status-approved';
                statusText = '✅ Aprovado';
                break;
            case 'rejected':
                statusClass = 'status-rejected';
                statusText = '❌ Rejeitado';
                break;
            case 'pending':
                statusClass = 'status-pending';
                statusText = '⏳ Pendente';
                break;
            default:
                statusText = f.status;
        }
        
        // Materiais
        const materialsHtml = f.materialDetails.map(mat => `
            <span class="material-tag" style="background: linear-gradient(135deg, #ffd700 0%, #ff8c00 100%); color: #000;">
                ${mat.icon || '📦'} ${mat.name}: ${mat.amount}
            </span>
        `).join('');
        
        // Screenshots
        let screenshotsHtml = '';
        if (f.screenshots && f.screenshots.length > 0) {
            screenshotsHtml = `
                <div class="farm-extract-screenshots">
                    ${f.screenshots.map(s => `
                        <img src="${s.screenshot_url}" onclick="openModal('${s.screenshot_url}')" alt="Screenshot">
                    `).join('')}
                </div>
            `;
        }
        
        // Info do revisor
        let reviewerInfo = '';
        if (f.reviewed_at && f.reviewer_name) {
            reviewerInfo = `
                <span class="justif-extract-reviewer">
                    👤 Por: ${f.reviewer_name} em ${new Date(f.reviewed_at).toLocaleDateString('pt-BR')}
                </span>
            `;
        }
        
        return `
            <div class="justif-extract-item" style="border-left: 3px solid #ffd700;">
                <div class="justif-extract-header">
                    <div class="justif-extract-member">
                        <strong>🏆 ${f.user_name}</strong>
                        <span class="passport">#${f.user_passport || 'N/A'}</span>
                    </div>
                    <span class="justif-extract-status ${statusClass}">${statusText}</span>
                </div>
                
                <div class="justif-extract-body">
                    <div class="farm-extract-materials">
                        ${materialsHtml || '<span style="color:#888;">Sem materiais</span>'}
                    </div>
                    <p style="margin-top:8px;color:#ffd700;font-size:0.85em;">
                        📊 Total: ${f.totalMaterials} materiais extras
                    </p>
                    ${screenshotsHtml}
                </div>
                
                <div class="justif-extract-footer">
                    <span class="justif-extract-week">
                        📅 Semana: ${new Date(f.week_start).toLocaleDateString('pt-BR')} - ${new Date(f.week_end).toLocaleDateString('pt-BR')}
                    </span>
                    <span class="justif-extract-date">
                        🕒 Enviado: ${new Date(f.created_at).toLocaleDateString('pt-BR')} ${new Date(f.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    ${reviewerInfo}
                </div>
            </div>
        `;
    }).join('');
}

function filterExtraFarmsExtract() {
    renderExtraFarmsExtract();
}

// ==================== RECUPERAÇÃO DE SENHA ====================
// Versão atualizada: v2

// Carregar solicitações de recuperação de senha
async function loadPasswordResets() {
    console.log('🔑 loadPasswordResets() chamada');
    const container = document.getElementById('passwordResetsList');
    
    if (!container) {
        console.error('❌ Container passwordResetsList não encontrado');
        return;
    }
    
    console.log('🔑 Container encontrado, buscando dados...');
    container.innerHTML = '<p class="loading">Buscando solicitações...</p>';
    
    try {
        const response = await fetch('/api/admin/password-resets/pending');
        console.log('🔑 Response status:', response.status);
        
        const data = await response.json();
        console.log('🔑 Dados recebidos:', JSON.stringify(data));
        
        if (!response.ok) {
            container.innerHTML = `<div class="empty-state">❌ Erro: ${data.error || 'Falha ao carregar'}</div>`;
            return;
        }
        
        if (!data.requests || data.requests.length === 0) {
            console.log('🔑 Nenhuma solicitação encontrada');
            container.innerHTML = '<div class="empty-state">✅ Nenhuma solicitação de recuperação pendente</div>';
            return;
        }
        
        console.log('🔑 Renderizando', data.requests.length, 'solicitações');
        
        container.innerHTML = data.requests.map(r => `
            <div class="password-reset-card" id="reset-card-${r.id}">
                <div class="password-reset-header">
                    <div class="password-reset-user">
                        <span class="user-name">👤 ${r.user_name}</span>
                        <span class="user-passport">🎫 Passaporte: ${r.user_passport}</span>
                    </div>
                    <div class="password-reset-date">
                        📅 Solicitado em ${new Date(r.requested_at).toLocaleDateString('pt-BR')} às ${new Date(r.requested_at).toLocaleTimeString('pt-BR')}
                    </div>
                </div>
                ${r.reset_code ? `
                <div class="reset-code-display" style="background: #0f0f1a; border: 1px solid #6c5ce7; border-radius: 8px; padding: 12px 16px; margin: 10px 0; display: flex; align-items: center; justify-content: space-between; gap: 10px;">
                    <div>
                        <span style="color: #a29bfe; font-size: 0.85rem;">🔑 Código de Recuperação:</span>
                        <span style="font-size: 1.4rem; font-weight: bold; font-family: monospace; letter-spacing: 3px; color: #fff; margin-left: 8px;">${r.reset_code}</span>
                    </div>
                    <button class="btn" style="background: #6c5ce7; color: white; font-size: 0.8rem; padding: 6px 12px;" onclick="navigator.clipboard.writeText('${r.reset_code}').then(() => this.textContent = '✅ Copiado!').catch(() => prompt('Copie o código:', '${r.reset_code}'))">📋 Copiar</button>
                </div>
                ` : ''}
                <div class="password-reset-actions">
                    <button class="btn btn-approve" onclick="approvePasswordReset(${r.id})">
                        ✅ Gerar Nova Senha
                    </button>
                    <button class="btn btn-reject" onclick="rejectPasswordReset(${r.id})">
                        ❌ Rejeitar
                    </button>
                </div>
            </div>
        `).join('');
        
        console.log('🔑 Renderização concluída!');
        
    } catch (error) {
        console.error('❌ Erro ao carregar solicitações:', error);
        container.innerHTML = `<div class="empty-state">❌ Erro: ${error.message}</div>`;
    }
}

// Aprovar recuperação de senha
async function approvePasswordReset(id) {
    if (!confirm('Gerar uma nova senha para este usuário?')) return;
    
    try {
        const response = await fetch(`/api/admin/password-resets/${id}/approve`, {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            // Mostrar a nova senha na interface
            const card = document.getElementById(`reset-card-${id}`);
            if (card) {
                card.innerHTML = `
                    <div class="new-password-display">
                        <h3>✅ Senha Resetada com Sucesso!</h3>
                        <p><strong>👤 Usuário:</strong> ${data.user_name}</p>
                        <p><strong>🎫 Passaporte:</strong> ${data.user_passport}</p>
                        <div class="password-value">${data.new_password}</div>
                        <p class="password-info">⚠️ Anote ou envie essa senha para o membro. Ela não será exibida novamente!</p>
                        <button class="btn btn-primary" onclick="copyPassword('${data.new_password}')" style="margin-top: 15px;">
                            📋 Copiar Senha
                        </button>
                    </div>
                `;
            }
        } else {
            alert(data.error || 'Erro ao resetar senha');
        }
    } catch (error) {
        alert('Erro ao resetar senha');
    }
}

// Rejeitar solicitação de recuperação
async function rejectPasswordReset(id) {
    if (!confirm('Rejeitar esta solicitação de recuperação?')) return;
    
    try {
        const response = await fetch(`/api/admin/password-resets/${id}/reject`, {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (response.ok) {
            alert('❌ Solicitação rejeitada');
            loadPasswordResets();
        } else {
            alert(data.error || 'Erro ao rejeitar solicitação');
        }
    } catch (error) {
        alert('Erro ao rejeitar solicitação');
    }
}

// Copiar senha para clipboard
function copyPassword(password) {
    navigator.clipboard.writeText(password).then(() => {
        alert('✅ Senha copiada para a área de transferência!');
    }).catch(() => {
        prompt('Copie a senha manualmente:', password);
    });
}

// Carregar estatísticas admin (da semana selecionada)
async function loadAdminStats() {
    try {
        // Verificar se os elementos existem na página antes de tentar atualizá-los
        const totalMembersEl = document.getElementById('totalMembers');
        const pendingDeliveriesEl = document.getElementById('pendingDeliveries');
        const approvedCountEl = document.getElementById('approvedCount');
        
        if (!totalMembersEl || !pendingDeliveriesEl || !approvedCountEl) {
            return; // Elementos não existem nesta página
        }
        
        const params = selectedWeek ? `?week_start=${selectedWeek.start}&week_end=${selectedWeek.end}` : '';
        const response = await fetch(`/api/admin/stats${params}`);
        const data = await response.json();
        
        if (data.stats) {
            totalMembersEl.textContent = data.stats.total_members || 0;
            pendingDeliveriesEl.textContent = data.stats.pending_deliveries || 0;
            approvedCountEl.textContent = data.stats.approved_count || 0;
        }
    } catch (error) {
        console.error('Erro ao carregar estatísticas:', error);
    }
}

// Carregar entregas pendentes (da semana selecionada)
async function loadPendingDeliveries() {
    console.log('📦 Iniciando loadPendingDeliveries...');
    try {
        // Farms pendentes: mostrar TODOS sem filtro de semana (para aprovar farms de qualquer semana)
        const response = await fetch('/api/admin/deliveries/pending');
        const data = await response.json();
        
        const pendingList = document.getElementById('pendingList');
        
        if (!pendingList) {
            console.error('❌ Elemento pendingList não encontrado!');
            // Mesmo assim, tentar carregar farms extras
            await loadPendingExtraFarms();
            return;
        }
        
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
                
                // Badge para farms em progresso (já aprovados antes, voltaram para aprovação)
                const inProgressBadge = delivery.is_partial ? `
                    <span class="status-badge in-progress" title="Este farm foi aprovado antes como 'Em Progresso' e o membro adicionou mais materiais">
                        ⏳ Em Progresso
                    </span>
                ` : '';
                
                return `
                    <div class="delivery-item" id="delivery-${delivery.id}">
                        <div class="delivery-info">
                            <h3>📦 Farm de ${delivery.user_name} ${inProgressBadge}</h3>
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
        
        // Carregar farms extras também (sempre, independente do resultado acima)
        console.log('📦 Chamando loadPendingExtraFarms...');
        await loadPendingExtraFarms();
    } catch (error) {
        console.error('Erro ao carregar entregas pendentes:', error);
        // Mesmo com erro, tentar carregar farms extras
        await loadPendingExtraFarms();
    }
}

// Carregar farms extras pendentes
async function loadPendingExtraFarms() {
    // Se competição não estiver ativa, nunca mostrar farms extras
    if (!competitionEnabled) {
        const extraSection = document.getElementById('extraFarmsSection');
        const extraList = document.getElementById('extraFarmsList');
        if (extraSection) extraSection.style.display = 'none';
        if (extraList) extraList.innerHTML = '';
        return;
    }
    try {
        console.log('🏆 Carregando farms extras pendentes...');
        const response = await fetch('/api/admin/extra-farms/pending');
        const data = await response.json();
        console.log('🏆 Resposta farms extras:', data);
        
        const extraSection = document.getElementById('extraFarmsSection');
        const extraList = document.getElementById('extraFarmsList');
        
        if (!extraSection || !extraList) {
            console.log('🏆 Elementos não encontrados:', { extraSection: !!extraSection, extraList: !!extraList });
            return;
        }
        
        if (data.success && data.extras && data.extras.length > 0) {
            console.log('🏆 Exibindo', data.extras.length, 'farms extras pendentes');
            extraSection.style.display = 'block';
            
            extraList.innerHTML = data.extras.map(extra => {
                // Galeria de screenshots
                let screenshotsHtml = '';
                if (extra.screenshots && extra.screenshots.length > 0) {
                    screenshotsHtml = `
                        <div class="pending-screenshots-gallery">
                            ${extra.screenshots.map((s, idx) => `
                                <img src="${s.screenshot_url}" class="delivery-screenshot" onclick="openModal('${s.screenshot_url}')" alt="Print ${idx + 1}">
                            `).join('')}
                        </div>
                    `;
                } else {
                    screenshotsHtml = '<span class="no-prints">Sem prints</span>';
                }
                
                return `
                    <div class="delivery-item extra-farm-item" id="extra-farm-${extra.id}" style="border-left: 3px solid #ffd700;">
                        <div class="delivery-info">
                            <h3>🏆 Farm Extra de ${extra.user_name}</h3>
                            <p class="week-info">📅 Semana: ${formatWeekDate(extra.week_start)} - ${formatWeekDate(extra.week_end)}</p>
                            <div class="materials-list">
                                ${extra.materialDetails.map(mat => `
                                    <span class="material-tag" style="background: linear-gradient(135deg, #ffd700 0%, #ff8c00 100%); color: #000;">
                                        ${mat.icon || '📦'} ${mat.name}: ${mat.amount}
                                    </span>
                                `).join('')}
                            </div>
                            <p style="color: #888; font-size: 0.9em;">Este é um farm extra (além da meta) - a meta original já foi aprovada</p>
                            <p>📤 Enviado: ${formatDate(extra.created_at)}</p>
                        </div>
                        <div class="delivery-actions">
                            <div class="delivery-screenshots-container">
                                <h4>🖼️ Prints (${extra.screenshots ? extra.screenshots.length : 0})</h4>
                                ${screenshotsHtml}
                            </div>
                            <div class="action-buttons">
                                <button class="btn btn-success" onclick="approveExtraFarm(${extra.id})">
                                    ✅ Aprovar Extra
                                </button>
                                <button class="btn btn-danger" onclick="rejectExtraFarm(${extra.id})">
                                    ❌ Rejeitar Extra
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            console.log('🏆 Nenhum farm extra pendente ou erro:', data);
            extraSection.style.display = 'none';
            extraList.innerHTML = '';
        }
    } catch (error) {
        console.error('Erro ao carregar farms extras:', error);
    }
}

// Mostrar modal de farm extra pendente (do Status da Semana)
async function showPendingExtraModal(extraId, memberName) {
    try {
        // Buscar detalhes do farm extra
        const response = await fetch(`/api/admin/extra-farms/${extraId}`);
        const data = await response.json();
        
        if (!data.success || !data.extra) {
            showNotification('Erro ao carregar farm extra', 'error');
            return;
        }
        
        const extra = data.extra;
        
        // Materiais
        let materialsHtml = '';
        if (extra.materialDetails && extra.materialDetails.length > 0) {
            materialsHtml = extra.materialDetails.map(mat => `
                <div class="extra-modal-material">
                    <span class="mat-icon">${mat.icon || '📦'}</span>
                    <span class="mat-name">${mat.name}</span>
                    <span class="mat-amount">${formatNumber(mat.amount)}</span>
                </div>
            `).join('');
        }
        
        // Screenshots
        let screenshotsHtml = '';
        if (extra.screenshots && extra.screenshots.length > 0) {
            screenshotsHtml = extra.screenshots.map((s, idx) => `
                <img src="${s.screenshot_url}" class="extra-modal-screenshot" onclick="openModal('${s.screenshot_url}')" alt="Print ${idx + 1}">
            `).join('');
        } else {
            screenshotsHtml = '<p class="no-screenshots">Sem prints</p>';
        }
        
        showActionModal(`
            <div class="pending-extra-modal">
                <div class="extra-modal-header" style="border-bottom: 2px solid #ffd700;">
                    <span class="extra-modal-icon">🏆</span>
                    <h2 style="color: #ffd700;">Farm Extra Pendente</h2>
                </div>
                
                <div class="extra-modal-member">
                    <span class="member-icon">👤</span>
                    <span class="member-name">${memberName}</span>
                </div>
                
                <div class="extra-modal-materials">
                    <h3>📋 Materiais do Farm Extra</h3>
                    <div class="materials-list">
                        ${materialsHtml || '<p>Sem materiais</p>'}
                    </div>
                </div>
                
                <div class="extra-modal-screenshots">
                    <h3>🖼️ Prints (${extra.screenshots ? extra.screenshots.length : 0})</h3>
                    <div class="screenshots-grid">
                        ${screenshotsHtml}
                    </div>
                </div>
                
                <div class="extra-modal-info">
                    <span>📅 Enviado em: ${new Date(extra.created_at).toLocaleDateString('pt-BR')}</span>
                </div>
                
                <div class="extra-modal-actions">
                    <button class="btn btn-success" onclick="approveExtraFarm(${extraId})">
                        ✅ Aprovar Farm Extra
                    </button>
                    <button class="btn btn-danger" onclick="rejectExtraFarm(${extraId})">
                        ❌ Rejeitar
                    </button>
                    <button class="btn btn-secondary" onclick="closeActionModal()">
                        Cancelar
                    </button>
                </div>
            </div>
        `);
    } catch (error) {
        console.error('Erro ao carregar farm extra:', error);
        showNotification('Erro ao carregar farm extra', 'error');
    }
}

// Aprovar farm extra
async function approveExtraFarm(id) {
    // Modal de confirmação personalizado
    showActionModal(`
        <div style="text-align: center; padding: 20px;">
            <div style="font-size: 48px; margin-bottom: 15px;">🏆</div>
            <h2 style="color: #ffd700; margin-bottom: 15px;">Aprovar Farm Extra?</h2>
            <p style="color: #ccc; margin-bottom: 20px;">Os materiais serão somados ao total do membro no ranking.</p>
            <div style="display: flex; gap: 15px; justify-content: center;">
                <button class="btn btn-success" onclick="confirmApproveExtraFarm(${id})">✅ Sim, Aprovar</button>
                <button class="btn btn-secondary" onclick="closeActionModal()">❌ Cancelar</button>
            </div>
        </div>
    `);
}

// Confirmar aprovação do farm extra
async function confirmApproveExtraFarm(id) {
    try {
        const response = await fetch(`/api/admin/extra-farms/${id}/approve`, {
            method: 'POST'
        });
        const data = await response.json();
        
        if (data.success) {
            closeActionModal();
            showNotification('Farm extra aprovado com sucesso!', 'success');
            // Recarregar página após 500ms para dar tempo de ver a notificação
            setTimeout(() => {
                location.reload();
            }, 500);
        } else {
            showNotification(data.error || 'Erro ao aprovar', 'error');
        }
    } catch (error) {
        showNotification('Erro ao aprovar farm extra', 'error');
    }
}

// Rejeitar farm extra
async function rejectExtraFarm(id) {
    // Modal de confirmação para rejeição
    showActionModal(`
        <div style="text-align: center; padding: 20px;">
            <div style="font-size: 48px; margin-bottom: 15px;">❌</div>
            <h2 style="color: #e74c3c; margin-bottom: 15px;">Rejeitar Farm Extra?</h2>
            <p style="color: #ccc; margin-bottom: 20px;">Esta ação não pode ser desfeita.</p>
            <div style="display: flex; gap: 15px; justify-content: center;">
                <button class="btn btn-danger" onclick="confirmRejectExtraFarm(${id})">❌ Sim, Rejeitar</button>
                <button class="btn btn-secondary" onclick="closeActionModal()">Cancelar</button>
            </div>
        </div>
    `);
}

// Confirmar rejeição do farm extra
async function confirmRejectExtraFarm(id) {
    try {
        const response = await fetch(`/api/admin/extra-farms/${id}/reject`, {
            method: 'POST'
        });
        const data = await response.json();
        
        if (data.success) {
            closeActionModal();
            showNotification('Farm extra rejeitado', 'warning');
            setTimeout(() => {
                location.reload();
            }, 500);
        } else {
            showNotification(data.error || 'Erro ao rejeitar', 'error');
        }
    } catch (error) {
        showNotification('Erro ao rejeitar farm extra', 'error');
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
                        <span class="member-name">👤 ${escapeHtml(member.name)}</span>
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
                        <span class="member-name">👤 ${escapeHtml(member.name)}</span>
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
    // Modal de confirmação personalizado
    showActionModal(`
        <div style="text-align: center; padding: 20px;">
            <div style="font-size: 48px; margin-bottom: 15px;">✅</div>
            <h2 style="color: #00b894; margin-bottom: 15px;">Aprovar Farm?</h2>
            <p style="color: #ccc; margin-bottom: 20px;">O farm será marcado como aprovado.</p>
            <div style="display: flex; gap: 15px; justify-content: center;">
                <button class="btn btn-success" onclick="confirmApproveDelivery(${id})">✅ Sim, Aprovar</button>
                <button class="btn btn-secondary" onclick="closeActionModal()">❌ Cancelar</button>
            </div>
        </div>
    `);
}

// Confirmar aprovação de entrega
async function confirmApproveDelivery(id) {
    try {
        const response = await fetch(`/api/admin/deliveries/${id}/approve`, { method: 'POST' });
        const data = await response.json();
        
        if (data.success) {
            // Limpar TODO o cache de dados da semana
            weekDataCache.clear();
            
            closeActionModal();
            showNotification(data.message, 'success');
            
            // Recarregar página após 500ms
            setTimeout(() => {
                location.reload();
            }, 500);
        } else {
            showNotification(data.error || 'Erro ao aprovar', 'error');
        }
    } catch (error) {
        showNotification('Erro ao aprovar entrega', 'error');
    }
}

// Rejeitar entrega
async function rejectDelivery(id) {
    // Modal de confirmação personalizado
    showActionModal(`
        <div style="text-align: center; padding: 20px;">
            <div style="font-size: 48px; margin-bottom: 15px;">❌</div>
            <h2 style="color: #e74c3c; margin-bottom: 15px;">Rejeitar Farm?</h2>
            <p style="color: #ccc; margin-bottom: 20px;">O membro poderá refazer a entrega.</p>
            <textarea id="rejectReasonInput" class="approval-note-input" placeholder="Informe o motivo da reprovação (obrigatório)" rows="3" style="margin-bottom: 15px;"></textarea>
            <div style="display: flex; gap: 15px; justify-content: center;">
                <button class="btn btn-danger" onclick="confirmRejectDelivery(${id})">❌ Sim, Rejeitar</button>
                <button class="btn btn-secondary" onclick="closeActionModal()">Cancelar</button>
            </div>
        </div>
    `);
}

// Confirmar rejeição de entrega
async function confirmRejectDelivery(id) {
    const reasonInput = document.getElementById('rejectReasonInput');
    const rejectionNote = reasonInput ? reasonInput.value.trim() : '';

    if (!rejectionNote) {
        showNotification('Informe o motivo da reprovação.', 'warning');
        if (reasonInput) reasonInput.focus();
        return;
    }

    try {
        const response = await fetch(`/api/admin/deliveries/${id}/reject`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rejection_note: rejectionNote })
        });
        const data = await response.json();
        
        if (data.success) {
            // Limpar TODO o cache de dados da semana
            weekDataCache.clear();
            
            closeActionModal();
            showNotification(data.message, 'warning');
            
            // Recarregar página após 500ms
            setTimeout(() => {
                location.reload();
            }, 500);
        } else {
            showNotification(data.error || 'Erro ao rejeitar', 'error');
        }
    } catch (error) {
        showNotification('Erro ao rejeitar entrega', 'error');
    }
}

// Carregar membros
// Variáveis para lista de membros
let membersTableData = [];
let membersSortColumn = 'passport';
let membersSortDirection = 'asc';
let membersStatusFilter = 'all';

async function loadMembers() {
    try {
        const response = await fetch('/api/admin/members');
        const data = await response.json();
        
        membersTableData = data.members || [];
        
        // Atualizar roleNames com os dados do backend
        if (data.roleNames) {
            Object.assign(roleNames, data.roleNames);
        }
        
        renderMembersTable();
    } catch (error) {
        console.error('Erro ao carregar membros:', error);
        document.getElementById('membersTableBody').innerHTML = '<tr><td colspan="4" class="loading">Erro ao carregar membros</td></tr>';
    }
}

function renderMembersTable() {
    const tbody = document.getElementById('membersTableBody');
    const searchTerm = document.getElementById('searchMembers')?.value?.toLowerCase() || '';
    const isSuperAdmin = currentUser && currentUser.passport === '6999';
    const isManager = currentUser && (
        isSuperAdmin ||
        currentUser.groups?.some(g => 
            g === 'gerente_geral' || 
            g === 'gerente_farm' ||
            g === 'gerente_acao' ||
            g === 'gerente_recrutamento' ||
            g === 'gerente_encomendas' ||
            g === 'gerente_de_fabricacao' ||
            g === '01' ||
            g === '02'
        )
    );
    
    // Filtrar por busca
    let filtered = membersTableData.filter(m => {
        if (!searchTerm) return true;
        return m.name.toLowerCase().includes(searchTerm) || 
               m.passport?.toLowerCase().includes(searchTerm);
    });
    
    // Filtrar por status
    if (membersStatusFilter === 'active') {
        filtered = filtered.filter(m => m.active);
    } else if (membersStatusFilter === 'inactive') {
        filtered = filtered.filter(m => !m.active);
    }
    
    // Ordenar
    filtered.sort((a, b) => {
        let valA, valB;
        
        switch (membersSortColumn) {
            case 'passport':
                valA = parseInt(a.passport) || 999999;
                valB = parseInt(b.passport) || 999999;
                break;
            case 'name':
                valA = a.name.toLowerCase();
                valB = b.name.toLowerCase();
                break;
            case 'role':
                valA = roleNames[a.role] || a.role;
                valB = roleNames[b.role] || b.role;
                break;
            default:
                valA = a.name.toLowerCase();
                valB = b.name.toLowerCase();
        }
        
        if (membersSortDirection === 'asc') {
            return valA > valB ? 1 : valA < valB ? -1 : 0;
        } else {
            return valA < valB ? 1 : valA > valB ? -1 : 0;
        }
    });
    
    // Atualizar headers com indicadores de ordenação
    updateMembersSortIndicators();
    
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="loading">Nenhum membro encontrado</td></tr>';
        return;
    }
    
    tbody.innerHTML = filtered.map(member => {
        const initial = member.name.charAt(0).toUpperCase();
        const statusClass = member.active ? '' : 'inactive-row';
        const statusIcon = member.active ? '' : '🚫 ';
        
        // Exibir grupos do usuário (apenas leitura)
        // Se tem outros grupos além de "member", não mostrar "member"
        let groups = member.groups || [];
        if (groups.length > 1 && groups.includes('member')) {
            groups = groups.filter(g => g !== 'member');
        }
        
        const groupsDisplay = groups.length > 0 
            ? groups.map(g => `<span class="role-badge badge-${g}">${roleNames[g] || g}</span>`).join(' ')
            : '<span class="no-role">Sem grupo</span>';

        
        return `
            <tr class="${statusClass}" data-name="${escapeHtml(member.name.toLowerCase())}" data-passport="${escapeHtml(member.passport || '')}" data-member-id="${member.id}">
                <td><input type="checkbox" class="member-checkbox" ${member.passport === '6999' ? 'disabled' : ''} data-member-id="${member.id}" data-member-name="${escapeHtml(member.name)}" onchange="updateBulkActions()"></td>
                <td>${escapeHtml(member.passport || '-')}</td>
                <td><span class="member-avatar">${initial}</span><span class="member-name">${statusIcon}${escapeHtml(member.name)}</span></td>
                <td>
                    ${groupsDisplay}
                </td>
                <td>
                    ${isManager && member.passport !== '6999' ? `
                        <button class="action-btn-small edit" onclick="openEditMemberModal(${member.id}, '${escapeHtml(member.name.replace(/'/g, "\\'"))}', '${escapeHtml(member.passport)}', '${escapeHtml(member.email || '')}')">✏️ Editar</button>
                        <button class="action-btn-small ${member.active ? 'toggle' : 'activate'}" onclick="toggleMember(${member.id})">
                            ${member.active ? '🚫 Desativar' : '✅ Ativar'}
                        </button>
                        <button class="action-btn-small delete" onclick="deleteMember(${member.id}, '${escapeHtml(member.name.replace(/'/g, "\\'"))}'  )">🗑️</button>
                    ` : (!member.active && isManager ? `<button class="action-btn-small activate" onclick="toggleMember(${member.id})">✅ Ativar</button>` : '<span class="no-actions">-</span>')}
                </td>
            </tr>
        `;
    }).join('');
    
    // Limpar seleção após renderizar
    updateBulkActions();

    // Contagem discreta no rodapé (apenas ativos)
    const footerEl = document.getElementById('membersFooterStats');
    if (footerEl) {
        const managerRoles = ['gerente_farm','gerente_acao','gerente_recrutamento','gerente_encomendas','gerente_de_fabricacao'];
        const activeMembers = membersTableData.filter(m => m.active);
        const activeManagers = activeMembers.filter(m => {
            const g = m.groups || (m.role ? [m.role] : []);
            return g.some(r => managerRoles.includes(r));
        });
        const regularCount = activeMembers.length - activeManagers.length;
        footerEl.innerHTML = `<span>👥 ${regularCount} membros</span><span>🛡️ ${activeManagers.length} gerentes</span><span>Total: ${activeMembers.length} ativos</span>`;
    }
}

function sortMembersTable(column) {
    if (membersSortColumn === column) {
        membersSortDirection = membersSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        membersSortColumn = column;
        membersSortDirection = 'asc';
    }
    renderMembersTable();
}

function updateMembersSortIndicators() {
    const headers = document.querySelectorAll('#membersTable th.sortable');
    headers.forEach(th => {
        const arrow = th.querySelector('.sort-arrow');
        arrow.textContent = '';
    });
    
    const activeHeader = Array.from(headers).find(th => {
        const text = th.textContent.toLowerCase();
        return text.includes(membersSortColumn);
    });
    
    if (activeHeader) {
        const arrow = activeHeader.querySelector('.sort-arrow');
        arrow.textContent = membersSortDirection === 'asc' ? ' ▲' : ' ▼';
    }
}

function filterMembersTable() {
    renderMembersTable();
}

function filterMembersByStatus(type) {
    membersStatusFilter = type;
    
    document.querySelectorAll('.members-filters .filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');
    
    renderMembersTable();
}

// ========== SELEÇÃO EM MASSA DE MEMBROS ==========

// Selecionar/desselecionar todos os membros
function toggleSelectAll() {
    const selectAllCheckbox = document.getElementById('selectAllMembers');
    const checkboxes = document.querySelectorAll('.member-checkbox:not([disabled])');
    
    checkboxes.forEach(checkbox => {
        checkbox.checked = selectAllCheckbox.checked;
    });
    
    updateBulkActions();
}

// Atualizar barra de ações em massa
function updateBulkActions() {
    const checkboxes = document.querySelectorAll('.member-checkbox:checked');
    const count = checkboxes.length;
    const bulkBar = document.getElementById('bulkActionsBar');
    const countElement = document.getElementById('selectedCount');
    
    if (count > 0) {
        bulkBar.classList.add('visible');
        countElement.textContent = count;
    } else {
        bulkBar.classList.remove('visible');
    }
    
    // Atualizar checkbox "selecionar todos"
    const allCheckboxes = document.querySelectorAll('.member-checkbox:not([disabled])');
    const selectAllCheckbox = document.getElementById('selectAllMembers');
    if (selectAllCheckbox) {
        selectAllCheckbox.checked = allCheckboxes.length > 0 && count === allCheckboxes.length;
    }
}

// Limpar seleção
function clearMemberSelection() {
    const checkboxes = document.querySelectorAll('.member-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.checked = false;
    });
    
    const selectAllCheckbox = document.getElementById('selectAllMembers');
    if (selectAllCheckbox) {
        selectAllCheckbox.checked = false;
    }
    
    updateBulkActions();
}

// Excluir membros selecionados
async function deleteSelectedMembers() {
    const checkboxes = document.querySelectorAll('.member-checkbox:checked');
    
    if (checkboxes.length === 0) {
        alert('Nenhum membro selecionado!');
        return;
    }
    
    const memberNames = Array.from(checkboxes).map(cb => cb.dataset.memberName).join(', ');
    
    if (!confirm(`Tem certeza que deseja DELETAR permanentemente ${checkboxes.length} membro(s)?\n\nMembros: ${memberNames}\n\nTodas as entregas e justificativas serão removidas!`)) {
        return;
    }
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const checkbox of checkboxes) {
        const memberId = checkbox.dataset.memberId;
        
        try {
            const response = await fetch(`/api/admin/members/${memberId}`, { method: 'DELETE' });
            const data = await response.json();
            
            if (data.success) {
                successCount++;
            } else {
                errorCount++;
                console.error(`Erro ao deletar membro ${memberId}:`, data.error);
            }
        } catch (error) {
            errorCount++;
            console.error(`Erro ao deletar membro ${memberId}:`, error);
        }
    }
    
    if (successCount > 0) {
        alert(`✅ ${successCount} membro(s) deletado(s) com sucesso!${errorCount > 0 ? `\n❌ ${errorCount} erro(s)` : ''}`);
        clearMemberSelection();
        loadMembers();
        loadAdminStats();
    } else {
        alert(`❌ Erro ao deletar membros. Nenhum membro foi removido.`);
    }
}

// ========== FIM SELEÇÃO EM MASSA ==========

// Abrir modal de edição de membro
let editingMemberId = null;

function openEditMemberModal(id, name, passport, email) {
    editingMemberId = id;
    document.getElementById('editMemberName').value = name;
    document.getElementById('editMemberPassport').value = passport;
    document.getElementById('editMemberEmail').value = email || '';
    document.getElementById('editMemberPassword').value = '';
    
    // Verificar se pode alterar cargos
    const canChange = canChangeRoles();
    const roleContainer = document.getElementById('editMemberRole').closest('.edit-form-group');
    
    if (canChange) {
        roleContainer.style.display = 'block';
        
        // Preencher dropdown de grupos
        const roleSelect = document.getElementById('editMemberRole');
        roleSelect.innerHTML = Object.keys(roleNames).map(groupName => {
            return `<option value="${groupName}">${roleNames[groupName] || groupName}</option>`;
        }).join('');
        
        // Carregar grupo atual do membro
        const member = membersTableData.find(m => m.id === id);
        if (member && member.groups) {
            let groups = member.groups || [];
            if (groups.length > 1 && groups.includes('member')) {
                groups = groups.filter(g => g !== 'member');
            }
            const primaryGroup = groups.length > 0 ? groups[0] : 'member';
            roleSelect.value = primaryGroup;
        }
    } else {
        // Ocultar campo de cargo se não tiver permissão
        roleContainer.style.display = 'none';
    }
    
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
    const newPassword = document.getElementById('editMemberPassword').value;
    
    if (!name || !passport) {
        alert('Nome e passaporte são obrigatórios!');
        return;
    }
    
    try {
        const member = membersTableData.find(m => m.id === editingMemberId);
        if (!member) {
            alert('Erro: Membro não encontrado');
            return;
        }

        const currentName = (member.name || '').trim();
        const currentPassport = (member.passport || '').trim();
        const currentEmail = (member.email || '').trim();
        const hasProfileChanges =
            name !== currentName ||
            passport !== currentPassport ||
            email !== currentEmail ||
            !!newPassword;

        // Atualizar dados básicos apenas quando houve alteração
        if (hasProfileChanges) {
            const response = await fetch(`/api/admin/members/${editingMemberId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, passport, email, newPassword: newPassword || undefined })
            });

            const data = await response.json();
            if (!response.ok || !data.success) {
                alert(data.error || 'Erro ao editar membro');
                return;
            }
        }

        // Atualizar grupo se mudou e se tiver permissão
        let roleChanged = false;
        if (canChangeRoles()) {
            const newRole = document.getElementById('editMemberRole').value;
            let currentGroups = member.groups || [];
            if (currentGroups.length > 1 && currentGroups.includes('member')) {
                currentGroups = currentGroups.filter(g => g !== 'member');
            }
            const currentPrimaryGroup = currentGroups.length > 0 ? currentGroups[0] : 'member';
            
            if (currentPrimaryGroup !== newRole) {
                const ok = await changeMemberRole(editingMemberId, newRole, name, { silent: true, reload: false });
                if (!ok) {
                    alert('❌ Não foi possível trocar o cargo. Dados básicos podem ter sido atualizados.');
                }
                roleChanged = ok;
            }
        }
        
        alert('✅ Membro atualizado com sucesso!');
        closeEditMemberModal();
        if (typeof weekDataCache !== 'undefined' && roleChanged) weekDataCache.clear();
        await loadMembers();
        
        // Se editou o próprio usuário, recarregar a página para atualizar sessão
        if (editingMemberId === currentUser?.id) {
            window.location.reload();
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

// Trocar grupo/cargo do membro
// Retorna true/false para quem chama decidir se recarrega a UI.
async function changeMemberRole(memberId, newGroup, memberName, { silent = false, reload = true } = {}) {
    try {
        const member = membersTableData.find(m => m.id === memberId);
        if (!member) {
            if (!silent) alert('Erro: Membro não encontrado');
            return false;
        }
        
        let currentGroups = (member.groups || []).slice();
        if (currentGroups.length > 1 && currentGroups.includes('member')) {
            currentGroups = currentGroups.filter(g => g !== 'member');
        }
        const currentPrimaryGroup = currentGroups.length > 0 ? currentGroups[0] : 'member';
        
        if (currentPrimaryGroup === newGroup) {
            return true;
        }
        
        // Remover dos grupos atuais (exceto 'member' padrão)
        for (const group of currentGroups) {
            if (group !== 'member') {
                const removeResponse = await fetch(`/api/admin/role-permissions/${group}/members/${memberId}`, {
                    method: 'DELETE'
                });
                if (!removeResponse.ok && removeResponse.status !== 404) {
                    const removeData = await removeResponse.json().catch(() => ({}));
                    throw new Error(removeData.error || `Falha ao remover do grupo ${group}`);
                }
            }
        }
        
        // Atualizar coluna role (compatibilidade). Falha silenciosa se sem permissão.
        try {
            const roleResponse = await fetch(`/api/admin/members/${memberId}/role`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: newGroup })
            });
            if (!roleResponse.ok && roleResponse.status !== 403) {
                const roleData = await roleResponse.json().catch(() => ({}));
                console.warn('Falha ao atualizar users.role:', roleData.error || roleResponse.status);
            }
        } catch (e) {
            console.warn('Erro ao atualizar users.role:', e);
        }
        
        // Adicionar ao novo grupo (se não for 'member')
        if (newGroup !== 'member') {
            const response = await fetch(`/api/admin/role-permissions/${newGroup}/members`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: memberId })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Falha ao trocar grupo');
            }
        }
        
        if (!silent) {
            alert(`✅ ${memberName} agora é ${roleNames[newGroup] || newGroup}`);
        }
        
        if (reload) {
            if (typeof weekDataCache !== 'undefined') weekDataCache.clear();
            if (typeof loadMembers === 'function') await loadMembers();
        }
        return true;
    } catch (error) {
        console.error('Erro ao trocar grupo:', error);
        if (!silent) {
            alert(`❌ Erro ao trocar grupo: ${error.message || 'falha desconhecida'}`);
        }
        if (reload && typeof loadMembers === 'function') {
            await loadMembers();
        }
        return false;
    }
}

// Carregar ranking (da semana selecionada)
async function loadRanking() {
    try {
        const farmsRankingList = document.getElementById('farmsRankingList');
        if (!farmsRankingList) return; // Página não existe mais
        
        // Ranking sempre mostra o total de TODAS as semanas (não filtra por semana)
        const response = await fetch(`/api/admin/ranking`);
        const data = await response.json();
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
        const statsList = document.getElementById('materialsStatsList');
        if (!statsList) return; // Página não existe mais
        
        const params = selectedWeek ? `?week_start=${selectedWeek.start}&week_end=${selectedWeek.end}` : '';
        const response = await fetch(`/api/admin/materials-stats${params}`);
        const data = await response.json();
        
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
        const allDeliveriesList = document.getElementById('allDeliveriesList');
        if (!allDeliveriesList) return; // Página não existe mais
        
        const params = selectedWeek ? `?week_start=${selectedWeek.start}&week_end=${selectedWeek.end}` : '';
        const response = await fetch(`/api/admin/deliveries/all${params}`);
        const data = await response.json();
        
        if (data.deliveries && data.deliveries.length > 0) {
            allDeliveriesList.innerHTML = data.deliveries.map(delivery => `
                <div class="delivery-item">
                    <div class="delivery-info">
                        <h3>📦 Farm de ${delivery.user_name}</h3>
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
        if (!materialsList) return;
        
        if (data.materials && data.materials.length > 0) {
            materialsList.innerHTML = data.materials.map(mat => `
                <div class="material-manage-item ${mat.active ? '' : 'inactive'}">
                    <div class="material-info">
                        <span class="material-icon">${mat.icon}</span>
                        <span class="material-name">${mat.name}</span>
                        <span class="material-goal-display">Meta: <strong>${mat.weekly_goal || 700}</strong></span>
                        <span class="material-status ${mat.active ? 'active' : 'inactive'}">${mat.active ? '✅ Visível para Usuários' : '❌ Oculto'}</span>
                    </div>
                    <div class="material-actions">
                        <button class="btn btn-secondary btn-small" onclick="editMaterial(${mat.id}, '${mat.name}', '${mat.icon}', ${mat.weekly_goal || 700})">
                            ✏️ Editar Meta
                        </button>
                        <button class="btn ${mat.active ? 'btn-danger' : 'btn-success'} btn-small" onclick="toggleMaterial(${mat.id})">
                            ${mat.active ? '❌ Ocultar' : '✅ Mostrar'}
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

// Editar material (apenas meta semanal)
async function editMaterial(id, currentName, currentIcon, currentGoal) {
    const modalHtml = `
        <div class="edit-modal-overlay" id="editMaterialModal">
            <div class="edit-modal-content">
                <h3>✏️ Editar Meta Semanal</h3>
                <div class="edit-form">
                    <div class="form-group">
                        <label>Material:</label>
                        <div style="display: flex; align-items: center; gap: 10px; padding: 10px; background: #1a1a2e; border-radius: 8px;">
                            <span style="font-size: 32px;">${currentIcon}</span>
                            <span style="font-size: 18px; font-weight: 600;">${currentName}</span>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Meta Semanal:</label>
                        <input type="number" id="editMatGoal" value="${currentGoal}" min="1" class="edit-input">
                    </div>
                    <div class="modal-buttons">
                        <button class="btn btn-primary" onclick="saveEditMaterial(${id})">💾 Salvar</button>
                        <button class="btn btn-secondary" onclick="closeEditModal()">❌ Cancelar</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function saveEditMaterial(id) {
    const newGoal = parseInt(document.getElementById('editMatGoal').value);
    
    if (isNaN(newGoal) || newGoal < 1) {
        showNotification('❌ Meta semanal inválida', 'error');
        return;
    }
    
    showPermConfirmModal(
        '💾 Salvar Material',
        `Tem certeza que deseja alterar a meta semanal para <strong>${newGoal}</strong>?`,
        'success',
        () => confirmSaveEditMaterial(id, newGoal)
    );
}

async function confirmSaveEditMaterial(id, newGoal) {
    closePermConfirmModal();
    
    try {
        const response = await fetch(`/api/admin/materials/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ weekly_goal: newGoal })
        });
        
        const data = await response.json();
        
        if (data.success) {
            closeEditModal();
            showNotification('✅ Material atualizado!', 'success');
            loadMaterials();
            loadMaterialsStats();
        } else {
            showNotification(data.error || 'Erro ao atualizar material', 'error');
        }
    } catch (error) {
        showNotification('Erro ao atualizar material', 'error');
    }
}

function closeEditModal() {
    const modal = document.getElementById('editMaterialModal') ||
        document.getElementById('editPaymentModal') ||
        document.getElementById('editManagerMaterialModal') ||
        document.getElementById('editManagerPaymentModal') ||
        document.getElementById('editMaterialGoalsModal') ||
        document.getElementById('editPaymentTypeGoalsModal');
    if (modal) modal.remove();
}

// Ativar/Desativar material (ocultar/mostrar para usuários)
async function toggleMaterial(id) {
    try {
        const response = await fetch(`/api/admin/materials/${id}/toggle`, { method: 'POST' });
        const data = await response.json();
        if (data.success) {
            const goalsTab = document.getElementById('goals-tab');
            if (goalsTab && goalsTab.classList.contains('active')) {
                loadGoalsTab();
            } else {
                loadMaterials();
            }
            loadMaterialsStats();
        } else {
            showNotification(data.error || 'Erro ao atualizar material', 'error');
        }
    } catch (error) {
        showNotification('Erro ao atualizar material', 'error');
    }
}

// Adicionar novo material (aba Metas - botão)
document.getElementById('btnAddMaterial')?.addEventListener('click', async () => {
    const dropdown = document.getElementById('materialSelectDropdown');
    const nameInput = document.getElementById('newMaterialName');
    const nameWrap = document.getElementById('newMaterialNameWrap');
    const iconWrap = document.getElementById('newMaterialIconWrap');
    const messageEl = document.getElementById('materialMessage');
    const val = dropdown && dropdown.value;
    let name, icon;
    if (val === '' || !val) {
        if (messageEl) { messageEl.textContent = 'Selecione um material na lista ou "Adicionar novo material".'; messageEl.className = 'goals-message show error'; }
        setTimeout(() => { if (messageEl) messageEl.className = 'goals-message'; }, 4000);
        return;
    }
    const weekly_goal = parseInt(document.getElementById('newMaterialGoal')?.value) || 700;
    const manager_weekly_goal = parseInt(document.getElementById('newMaterialManagerGoal')?.value) || weekly_goal;
    if (val === '__new__') {
        name = nameInput && nameInput.value ? nameInput.value.trim() : '';
        if (!name) {
            if (messageEl) { messageEl.textContent = 'Digite o nome do novo material.'; messageEl.className = 'goals-message show error'; }
            setTimeout(() => { if (messageEl) messageEl.className = 'goals-message'; }, 4000);
            return;
        }
        icon = (document.getElementById('newMaterialIcon') && document.getElementById('newMaterialIcon').value) || '📦';
        try {
            const response = await fetch('/api/admin/materials', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, icon, weekly_goal, manager_weekly_goal })
            });
            const data = await response.json();
            if (data.success) {
                messageEl.textContent = data.message || 'Material adicionado.';
                messageEl.className = 'goals-message show success';
                if (nameInput) nameInput.value = '';
                dropdown.value = '';
                if (nameWrap) nameWrap.style.display = 'none';
                if (iconWrap) iconWrap.style.display = 'none';
                document.getElementById('newMaterialGoal').value = '700';
                document.getElementById('newMaterialManagerGoal').value = '700';
                loadGoalsTab();
            } else {
                messageEl.textContent = data.error || 'Erro ao adicionar material.';
                messageEl.className = 'goals-message show error';
            }
            setTimeout(() => { if (messageEl) messageEl.className = 'goals-message'; }, 4000);
        } catch (err) {
            messageEl.textContent = 'Erro de conexão.';
            messageEl.className = 'goals-message show error';
            setTimeout(() => { if (messageEl) messageEl.className = 'goals-message'; }, 4000);
        }
        return;
    }
    const opt = dropdown && dropdown.options[dropdown.selectedIndex];
    if (!opt) return;
    name = opt.getAttribute('data-name') || '';
    icon = opt.getAttribute('data-icon') || '📦';
    const isInactive = opt.getAttribute('data-active') === '0';
    try {
        if (isInactive) {
            const response = await fetch('/api/admin/materials', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, icon, weekly_goal, manager_weekly_goal })
            });
            const data = await response.json();
            if (data.success) {
                messageEl.textContent = data.message || 'Material reativado e metas definidas.';
                messageEl.className = 'goals-message show success';
                dropdown.value = '';
                document.getElementById('newMaterialGoal').value = '700';
                document.getElementById('newMaterialManagerGoal').value = '700';
                loadGoalsTab();
            } else {
                messageEl.textContent = data.error || 'Erro ao reativar material.';
                messageEl.className = 'goals-message show error';
            }
        } else {
            const response = await fetch(`/api/admin/materials/${val}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, icon, weekly_goal, manager_weekly_goal })
            });
            const data = await response.json();
            if (data.success) {
                messageEl.textContent = data.message || 'Metas do material atualizadas.';
                messageEl.className = 'goals-message show success';
                dropdown.value = '';
                document.getElementById('newMaterialGoal').value = '700';
                document.getElementById('newMaterialManagerGoal').value = '700';
                loadGoalsTab();
            } else {
                messageEl.textContent = data.error || 'Erro ao atualizar material.';
                messageEl.className = 'goals-message show error';
            }
        }
        setTimeout(() => { if (messageEl) messageEl.className = 'goals-message'; }, 4000);
    } catch (err) {
        messageEl.textContent = 'Erro de conexão.';
        messageEl.className = 'goals-message show error';
        setTimeout(() => { if (messageEl) messageEl.className = 'goals-message'; }, 4000);
    }
});

document.getElementById('materialSelectDropdown')?.addEventListener('change', function () {
    const wrap = document.getElementById('newMaterialNameWrap');
    const iconWrap = document.getElementById('newMaterialIconWrap');
    const nameInput = document.getElementById('newMaterialName');
    if (this.value === '__new__') {
        if (wrap) wrap.style.display = 'flex';
        if (iconWrap) iconWrap.style.display = 'flex';
        if (nameInput) { nameInput.value = ''; nameInput.disabled = false; nameInput.placeholder = 'Ex: Ópio, Farinha de Trigo'; }
    } else {
        if (wrap) wrap.style.display = 'none';
        if (iconWrap) iconWrap.style.display = 'none';
        if (nameInput) nameInput.value = '';
    }
});

// Adicionar novo tipo de pagamento (aba Metas - botão)
document.getElementById('btnAddPaymentType')?.addEventListener('click', async () => {
    const dropdown = document.getElementById('paymentTypeSelectDropdown');
    const nameInput = document.getElementById('newPaymentTypeName');
    const nameWrap = document.getElementById('newPaymentTypeNameWrap');
    const iconWrap = document.getElementById('newPaymentTypeIconWrap');
    const unitWrap = document.getElementById('newPaymentTypeUnitWrap');
    const messageEl = document.getElementById('paymentTypeMessage');
    const val = dropdown && dropdown.value;
    let name, icon;
    if (val === '' || !val) {
        if (messageEl) { messageEl.textContent = 'Selecione um tipo na lista ou "Adicionar novo tipo de pagamento".'; messageEl.className = 'goals-message show error'; }
        setTimeout(() => { if (messageEl) messageEl.className = 'goals-message'; }, 4000);
        return;
    }
    const weekly_goal = parseInt(document.getElementById('newPaymentTypeGoal')?.value) || 50000;
    const manager_weekly_goal = parseInt(document.getElementById('newPaymentTypeManagerGoal')?.value) || weekly_goal;
    if (val === '__new__') {
        name = nameInput && nameInput.value ? nameInput.value.trim() : '';
        if (!name) {
            if (messageEl) { messageEl.textContent = 'Digite o nome do novo tipo de pagamento.'; messageEl.className = 'goals-message show error'; }
            setTimeout(() => { if (messageEl) messageEl.className = 'goals-message'; }, 4000);
            return;
        }
        icon = (document.getElementById('newPaymentTypeIcon') && document.getElementById('newPaymentTypeIcon').value) || '💰';
        const unitType = (document.getElementById('newPaymentTypeUnit') && document.getElementById('newPaymentTypeUnit').value) || 'R$';
        const defaultGoal = unitType === 'unidade' ? 700 : 50000;
        const weekly_goal = parseInt(document.getElementById('newPaymentTypeGoal')?.value) || defaultGoal;
        const manager_weekly_goal = parseInt(document.getElementById('newPaymentTypeManagerGoal')?.value) || weekly_goal;
        try {
            const response = await fetch('/api/admin/payment-types', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, icon, weekly_goal, manager_weekly_goal, unit_type: unitType })
            });
            const data = await response.json();
            if (data.success) {
                messageEl.textContent = data.message || 'Tipo de pagamento adicionado.';
                messageEl.className = 'goals-message show success';
                if (nameInput) nameInput.value = '';
                dropdown.value = '';
                if (nameWrap) nameWrap.style.display = 'none';
                if (iconWrap) iconWrap.style.display = 'none';
                if (unitWrap) unitWrap.style.display = 'none';
                document.getElementById('newPaymentTypeGoal').value = '50000';
                document.getElementById('newPaymentTypeManagerGoal').value = '50000';
                loadGoalsTab();
            } else {
                messageEl.textContent = data.error || 'Erro ao adicionar.';
                messageEl.className = 'goals-message show error';
            }
            setTimeout(() => { if (messageEl) messageEl.className = 'goals-message'; }, 4000);
        } catch (err) {
            messageEl.textContent = 'Erro de conexão.';
            messageEl.className = 'goals-message show error';
            setTimeout(() => { if (messageEl) messageEl.className = 'goals-message'; }, 4000);
        }
        return;
    }
    const opt = dropdown && dropdown.options[dropdown.selectedIndex];
    if (!opt) return;
    name = opt.getAttribute('data-name') || '';
    icon = opt.getAttribute('data-icon') || '💰';
    const unitType = opt.getAttribute('data-unit-type') || 'R$';
    const isInactive = opt.getAttribute('data-active') === '0';
    try {
        if (isInactive) {
            const response = await fetch('/api/admin/payment-types', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, icon, weekly_goal, manager_weekly_goal, unit_type: unitType })
            });
            const data = await response.json();
            if (data.success) {
                messageEl.textContent = data.message || 'Tipo reativado e metas definidas.';
                messageEl.className = 'goals-message show success';
                dropdown.value = '';
                document.getElementById('newPaymentTypeGoal').value = '50000';
                document.getElementById('newPaymentTypeManagerGoal').value = '50000';
                loadGoalsTab();
            } else {
                messageEl.textContent = data.error || 'Erro ao reativar.';
                messageEl.className = 'goals-message show error';
            }
        } else {
            const response = await fetch(`/api/admin/payment-types/${val}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, icon, weekly_goal, manager_weekly_goal, unit_type: unitType })
            });
            const data = await response.json();
            if (data.success) {
                messageEl.textContent = data.message || 'Metas do tipo atualizadas.';
                messageEl.className = 'goals-message show success';
                dropdown.value = '';
                document.getElementById('newPaymentTypeGoal').value = '50000';
                document.getElementById('newPaymentTypeManagerGoal').value = '50000';
                loadGoalsTab();
            } else {
                messageEl.textContent = data.error || 'Erro ao atualizar.';
                messageEl.className = 'goals-message show error';
            }
        }
        setTimeout(() => { if (messageEl) messageEl.className = 'goals-message'; }, 4000);
    } catch (err) {
        messageEl.textContent = 'Erro de conexão.';
        messageEl.className = 'goals-message show error';
        setTimeout(() => { if (messageEl) messageEl.className = 'goals-message'; }, 4000);
    }
});

document.getElementById('paymentTypeSelectDropdown')?.addEventListener('change', function () {
    const wrap = document.getElementById('newPaymentTypeNameWrap');
    const iconWrap = document.getElementById('newPaymentTypeIconWrap');
    const unitWrap = document.getElementById('newPaymentTypeUnitWrap');
    const nameInput = document.getElementById('newPaymentTypeName');
    const goalInput = document.getElementById('newPaymentTypeGoal');
    const managerGoalInput = document.getElementById('newPaymentTypeManagerGoal');
    const goalLabel = document.getElementById('paymentTypeGoalLabel');
    const managerGoalLabel = document.getElementById('paymentTypeManagerGoalLabel');
    if (this.value === '__new__') {
        if (wrap) wrap.style.display = 'flex';
        if (iconWrap) iconWrap.style.display = 'flex';
        if (unitWrap) unitWrap.style.display = 'flex';
        if (nameInput) { nameInput.value = ''; nameInput.placeholder = 'Ex: Dinheiro Sujo'; }
        if (goalInput) { goalInput.value = '50000'; goalInput.max = '999999999'; }
        if (managerGoalInput) managerGoalInput.value = '50000';
        if (goalLabel) goalLabel.textContent = 'Meta (membros)';
        if (managerGoalLabel) managerGoalLabel.textContent = 'Meta (gerentes)';
    } else {
        if (wrap) wrap.style.display = 'none';
        if (iconWrap) iconWrap.style.display = 'none';
        if (unitWrap) unitWrap.style.display = 'none';
        if (nameInput) nameInput.value = '';
        const opt = this.options[this.selectedIndex];
        const unitType = opt?.getAttribute('data-unit-type') || 'R$';
        const def = unitType === 'unidade' ? 700 : 50000;
        const max = unitType === 'unidade' ? 999999 : 999999999;
        if (goalInput) { goalInput.value = def; goalInput.max = max; }
        if (managerGoalInput) managerGoalInput.value = def;
        if (goalLabel) goalLabel.textContent = unitType === 'unidade' ? 'Meta (membros) un.' : 'Meta R$ (membros)';
        if (managerGoalLabel) managerGoalLabel.textContent = unitType === 'unidade' ? 'Meta (gerentes) un.' : 'Meta R$ (gerentes)';
    }
});

document.getElementById('newPaymentTypeUnit')?.addEventListener('change', function () {
    const goalInput = document.getElementById('newPaymentTypeGoal');
    const managerGoalInput = document.getElementById('newPaymentTypeManagerGoal');
    const def = this.value === 'unidade' ? 700 : 50000;
    const max = this.value === 'unidade' ? 999999 : 999999999;
    if (goalInput) { goalInput.value = def; goalInput.max = max; }
    if (managerGoalInput) managerGoalInput.value = def;
});

// Carregar tipos de pagamento
async function loadPaymentTypes() {
    try {
        const response = await fetch('/api/admin/payment-types');
        const data = await response.json();
        
        const list = document.getElementById('paymentTypesList');
        if (!list) return;
        
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
    const iconOptions = [
        { icon: '💰', name: 'Saco de Dinheiro' },
        { icon: '💵', name: 'Nota de Dólar' },
        { icon: '💸', name: 'Dinheiro Voando' },
        { icon: '🪙', name: 'Moeda' },
        { icon: '💎', name: 'Diamante' },
        { icon: '👑', name: 'Coroa' },
        { icon: '🏆', name: 'Troféu' },
        { icon: '⭐', name: 'Estrela' },
        { icon: '💳', name: 'Cartão' },
        { icon: '🎯', name: 'Alvo' },
        { icon: '💼', name: 'Maleta' },
        { icon: '🎁', name: 'Presente' },
        { icon: '🔑', name: 'Chave' },
        { icon: '🔥', name: 'Fogo' },
        { icon: '⚡', name: 'Raio' }
    ];
    
    const iconOptionsHtml = iconOptions.map(opt => 
        `<option value="${opt.icon}" ${opt.icon === currentIcon ? 'selected' : ''}>${opt.icon} ${opt.name}</option>`
    ).join('');
    
    const modalHtml = `
        <div class="edit-modal-overlay" id="editPaymentModal">
            <div class="edit-modal-content">
                <h3>✏️ Editar Tipo de Pagamento</h3>
                <div class="edit-form">
                    <div class="form-group">
                        <label>Nome:</label>
                        <input type="text" id="editPayName" value="${currentName}" class="edit-input">
                    </div>
                    <div class="form-group">
                        <label>Ícone:</label>
                        <select id="editPayIcon" class="icon-select">${iconOptionsHtml}</select>
                    </div>
                    <div class="form-group">
                        <label>Meta Semanal (R$):</label>
                        <input type="number" id="editPayGoal" value="${currentGoal}" min="1" class="edit-input">
                    </div>
                    <div class="modal-buttons">
                        <button class="btn btn-primary" onclick="saveEditPaymentType(${id})">💾 Salvar</button>
                        <button class="btn btn-secondary" onclick="closeEditModal()">❌ Cancelar</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function saveEditPaymentType(id) {
    const newName = document.getElementById('editPayName').value;
    const newIcon = document.getElementById('editPayIcon').value;
    const newGoal = parseInt(document.getElementById('editPayGoal').value);
    
    if (!newName || !newIcon || isNaN(newGoal) || newGoal < 1) {
        showNotification('❌ Preencha todos os campos corretamente', 'error');
        return;
    }
    
    showPermConfirmModal(
        '💾 Salvar Tipo de Pagamento',
        `Tem certeza que deseja salvar as alterações em <strong>${newName}</strong>?`,
        'success',
        () => confirmSaveEditPaymentType(id, newName, newIcon, newGoal)
    );
}

async function confirmSaveEditPaymentType(id, newName, newIcon, newGoal) {
    closePermConfirmModal();
    
    try {
        const response = await fetch(`/api/admin/payment-types/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                name: newName, 
                icon: newIcon, 
                weekly_goal: newGoal 
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            closeEditModal();
            showNotification('✅ Tipo de pagamento atualizado!', 'success');
            loadPaymentTypes();
        } else {
            showNotification(data.error || 'Erro ao atualizar tipo de pagamento', 'error');
        }
    } catch (error) {
        showNotification('Erro ao atualizar tipo de pagamento', 'error');
    }
}

// Ativar/Desativar tipo de pagamento
async function togglePaymentType(id) {
    try {
        const response = await fetch(`/api/admin/payment-types/${id}/toggle`, { method: 'POST' });
        const data = await response.json();
        
        if (data.success) {
            const goalsTab = document.getElementById('goals-tab');
            if (goalsTab && goalsTab.classList.contains('active')) {
                loadGoalsTab();
            } else {
                loadPaymentTypes();
            }
        } else {
            alert(data.error || 'Erro ao atualizar tipo de pagamento');
        }
    } catch (error) {
        alert('Erro ao atualizar tipo de pagamento');
    }
}

// ===== ABA METAS (GOALS) =====

async function loadManagerGoals() {
    await loadGoalsTab();
}

async function loadGoalsTab() {
    await Promise.all([
        loadGoalsMaterials(),
        loadGoalsPaymentTypes()
    ]);
}

async function loadGoalsMaterials() {
    const tbody = document.getElementById('goalsMaterialsBody');
    if (!tbody) return;
    try {
        const response = await fetch('/api/admin/materials');
        const data = await response.json();
        const all = data.materials || data || [];
        populateMaterialSelectDropdown(all);
        const inGoals = all.filter(m => m.active === 1 || m.active === true || m.active === '1');
        if (inGoals.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#888;padding:24px;">Nenhum material nas metas. Adicione pelo dropdown acima.</td></tr>';
            return;
        }
        tbody.innerHTML = inGoals.map(m => {
            const nameEsc = (m.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
            const iconEsc = (m.icon || '📦').replace(/'/g, "\\'");
            const goalM = m.weekly_goal ?? 700;
            const goalG = m.manager_weekly_goal ?? m.weekly_goal ?? 700;
            return `<tr>
                <td class="goals-cell-icon">${m.icon || '📦'}</td>
                <td class="goals-cell-name">${escapeHtml(m.name || '-')}</td>
                <td class="goals-cell-meta">${Number(goalM).toLocaleString('pt-BR')}</td>
                <td class="goals-cell-meta">${Number(goalG).toLocaleString('pt-BR')}</td>
                <td><span class="goals-status-active">Ativo</span></td>
                <td class="goals-actions">
                    <button type="button" class="btn btn-secondary btn-small" onclick="openEditMaterialGoalsModal(${m.id}, '${nameEsc}', '${iconEsc}', ${goalM}, ${goalG})">✏️ Editar metas</button>
                    <button type="button" class="btn btn-danger btn-small goals-btn-remove" onclick="removeMaterialFromGoals(${m.id})" title="Excluir este material da meta">Excluir da meta</button>
                </td>
            </tr>`;
        }).join('');
    } catch (err) {
        console.error(err);
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#e74c3c;">Erro ao carregar.</td></tr>';
    }
}

function populateMaterialSelectDropdown(allMaterials) {
    const sel = document.getElementById('materialSelectDropdown');
    if (!sel) return;
    const list = Array.isArray(allMaterials) ? allMaterials : [];
    sel.innerHTML = '';
    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = 'Selecione um material...';
    sel.appendChild(opt0);
    list.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.setAttribute('data-name', m.name || '');
        opt.setAttribute('data-icon', m.icon || '📦');
        opt.setAttribute('data-active', (m.active === 1 || m.active === true || m.active === '1') ? '1' : '0');
        opt.textContent = m.name || '';
        sel.appendChild(opt);
    });
    const optNew = document.createElement('option');
    optNew.value = '__new__';
    optNew.textContent = '➕ Adicionar novo material';
    sel.appendChild(optNew);
}

async function loadGoalsPaymentTypes() {
    const tbody = document.getElementById('goalsPaymentTypesBody');
    if (!tbody) return;
    try {
        const response = await fetch('/api/admin/payment-types');
        const data = await response.json();
        const all = data.paymentTypes || data || [];
        populatePaymentTypeSelectDropdown(all);
        const inGoals = all.filter(pt => pt.active === 1 || pt.active === true || pt.active === '1');
        if (inGoals.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#888;padding:24px;">Nenhum tipo de pagamento nas metas. Adicione pelo dropdown acima.</td></tr>';
            return;
        }
        tbody.innerHTML = inGoals.map(pt => {
            const nameEsc = (pt.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
            const iconEsc = (pt.icon || '💰').replace(/'/g, "\\'");
            const goalM = pt.weekly_goal ?? (pt.unit_type === 'unidade' ? 700 : 50000);
            const goalG = pt.manager_weekly_goal ?? pt.weekly_goal ?? goalM;
            const fmt = (v) => pt.unit_type === 'unidade' ? `${Number(v).toLocaleString('pt-BR')} un.` : `R$ ${Number(v).toLocaleString('pt-BR')}`;
            return `<tr>
                <td class="goals-cell-icon">${pt.icon || '💰'}</td>
                <td class="goals-cell-name">${pt.name || '-'}</td>
                <td class="goals-cell-meta">${fmt(goalM)}</td>
                <td class="goals-cell-meta">${fmt(goalG)}</td>
                <td><span class="goals-status-active">Ativo</span></td>
                <td class="goals-actions">
                    <button type="button" class="btn btn-secondary btn-small" onclick="openEditPaymentTypeGoalsModal(${pt.id}, '${nameEsc}', '${iconEsc}', ${goalM}, ${goalG}, '${(pt.unit_type || 'R$').replace(/'/g, "\\'")}')">✏️ Editar metas</button>
                    <button type="button" class="btn btn-danger btn-small goals-btn-remove" onclick="removePaymentTypeFromGoals(${pt.id})" title="Excluir da meta">Excluir da meta</button>
                </td>
            </tr>`;
        }).join('');
    } catch (err) {
        console.error(err);
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#e74c3c;">Erro ao carregar.</td></tr>';
    }
}

function populatePaymentTypeSelectDropdown(allPaymentTypes) {
    const sel = document.getElementById('paymentTypeSelectDropdown');
    if (!sel) return;
    const list = Array.isArray(allPaymentTypes) ? allPaymentTypes : [];
    sel.innerHTML = '';
    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = 'Selecione um tipo de pagamento...';
    sel.appendChild(opt0);
    list.forEach(pt => {
        const opt = document.createElement('option');
        opt.value = pt.id;
        opt.setAttribute('data-name', pt.name || '');
        opt.setAttribute('data-icon', pt.icon || '💰');
        opt.setAttribute('data-unit-type', (pt.unit_type === 'unidade') ? 'unidade' : 'R$');
        opt.setAttribute('data-active', (pt.active === 1 || pt.active === true || pt.active === '1') ? '1' : '0');
        opt.textContent = pt.name || '';
        sel.appendChild(opt);
    });
    const optNew = document.createElement('option');
    optNew.value = '__new__';
    optNew.textContent = '➕ Adicionar novo tipo de pagamento';
    sel.appendChild(optNew);
}

function removeMaterialFromGoals(id) {
    if (!confirm('Excluir este material da meta? O membro não precisará mais pagar essa meta. Você pode incluí-lo de novo pelo botão "Incluir nas metas" quando quiser.')) return;
    toggleMaterial(id);
}

function addMaterialToGoals(id) {
    toggleMaterial(id);
}

function removePaymentTypeFromGoals(id) {
    if (!confirm('Excluir este tipo de pagamento da meta? O membro não precisará mais pagar essa meta. Você pode incluí-lo de novo pelo dropdown quando quiser.')) return;
    togglePaymentType(id);
}

function openEditMaterialGoalsModal(id, name, icon, goalMembros, goalGerentes) {
    const modalHtml = `
        <div class="edit-modal-overlay" id="editMaterialGoalsModal">
            <div class="edit-modal-content">
                <h3>✏️ Editar metas do material</h3>
                <div class="edit-form">
                    <div class="form-group" style="margin-bottom:12px;">
                        <label>Material</label>
                        <div style="display:flex;align-items:center;gap:10px;padding:10px;background:rgba(0,0,0,0.2);border-radius:8px;">
                            <span style="font-size:28px;">${icon}</span>
                            <span style="font-weight:600;">${name}</span>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Meta (membros)</label>
                        <input type="number" id="editMatGoalMembros" value="${goalMembros}" min="1" class="edit-input" style="width:120px;">
                    </div>
                    <div class="form-group">
                        <label>Meta (gerentes)</label>
                        <input type="number" id="editMatGoalGerentes" value="${goalGerentes}" min="1" class="edit-input" style="width:120px;">
                    </div>
                    <div class="modal-buttons" style="margin-top:16px;">
                        <button class="btn btn-primary" onclick="saveMaterialGoals(${id})">💾 Salvar</button>
                        <button class="btn btn-secondary" onclick="closeEditModal()">❌ Cancelar</button>
                    </div>
                </div>
            </div>
        </div>`;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

async function saveMaterialGoals(id) {
    const goalM = parseInt(document.getElementById('editMatGoalMembros')?.value);
    const goalG = parseInt(document.getElementById('editMatGoalGerentes')?.value);
    if (isNaN(goalM) || goalM < 1 || isNaN(goalG) || goalG < 1) {
        showNotification('Metas inválidas.', 'error');
        return;
    }
    try {
        const res = await fetch(`/api/admin/materials/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ weekly_goal: goalM, manager_weekly_goal: goalG })
        });
        const data = await res.json();
        if (data.success) {
            closeEditModal();
            showNotification('Metas atualizadas.', 'success');
            loadGoalsTab();
        } else {
            showNotification(data.error || 'Erro ao salvar', 'error');
        }
    } catch (e) {
        showNotification('Erro ao salvar.', 'error');
    }
}

function openEditPaymentTypeGoalsModal(id, name, icon, goalMembros, goalGerentes, unitType) {
    const isUnidade = unitType === 'unidade';
    const labelM = isUnidade ? 'Meta (membros) un.' : 'Meta R$ (membros)';
    const labelG = isUnidade ? 'Meta (gerentes) un.' : 'Meta R$ (gerentes)';
    const modalHtml = `
        <div class="edit-modal-overlay" id="editPaymentTypeGoalsModal">
            <div class="edit-modal-content">
                <h3>✏️ Editar metas do tipo de pagamento</h3>
                <div class="edit-form">
                    <div class="form-group" style="margin-bottom:12px;">
                        <label>Tipo</label>
                        <div style="display:flex;align-items:center;gap:10px;padding:10px;background:rgba(0,0,0,0.2);border-radius:8px;">
                            <span style="font-size:28px;">${icon}</span>
                            <span style="font-weight:600;">${name}</span>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>${labelM}</label>
                        <input type="number" id="editPayGoalMembros" value="${goalMembros}" min="1" class="edit-input" style="width:140px;">
                    </div>
                    <div class="form-group">
                        <label>${labelG}</label>
                        <input type="number" id="editPayGoalGerentes" value="${goalGerentes}" min="1" class="edit-input" style="width:140px;">
                    </div>
                    <div class="modal-buttons" style="margin-top:16px;">
                        <button class="btn btn-primary" onclick="savePaymentTypeGoals(${id})">💾 Salvar</button>
                        <button class="btn btn-secondary" onclick="closeEditModal()">❌ Cancelar</button>
                    </div>
                </div>
            </div>
        </div>`;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

async function savePaymentTypeGoals(id) {
    const goalM = parseInt(document.getElementById('editPayGoalMembros')?.value);
    const goalG = parseInt(document.getElementById('editPayGoalGerentes')?.value);
    if (isNaN(goalM) || goalM < 1 || isNaN(goalG) || goalG < 1) {
        showNotification('Metas inválidas.', 'error');
        return;
    }
    try {
        const res = await fetch(`/api/admin/payment-types/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ weekly_goal: goalM, manager_weekly_goal: goalG })
        });
        const data = await res.json();
        if (data.success) {
            closeEditModal();
            showNotification('Metas atualizadas.', 'success');
            loadGoalsTab();
        } else {
            showNotification(data.error || 'Erro ao salvar', 'error');
        }
    } catch (e) {
        showNotification('Erro ao salvar.', 'error');
    }
}

// ===== METAS DE GERENTES (compatibilidade - redireciona para goals) =====

async function loadManagerMaterialsGoals() {
    try {
        const response = await fetch('/api/admin/materials');
        const data = await response.json();
        const list = document.getElementById('managerMaterialsList');
        if (!list) return;

        const materials = data.materials || data;

        if (materials && materials.length > 0) {
            list.innerHTML = materials.map(mat => `
                <div class="material-manage-item ${mat.active ? '' : 'inactive'}">
                    <div class="material-info">
                        <span class="material-icon">${mat.icon}</span>
                        <span class="material-name">${mat.name}</span>
                        <span class="material-goal-display">Meta Membros: <strong>${mat.weekly_goal || 700}</strong></span>
                        <span class="material-goal-display">Meta Gerentes: <strong>${mat.manager_weekly_goal ?? mat.weekly_goal ?? 700}</strong></span>
                    </div>
                    <div class="material-actions">
                        <button class="btn btn-secondary btn-small" onclick="editManagerMaterialGoal(${mat.id}, '${mat.name}', '${mat.icon}', ${mat.manager_weekly_goal ?? mat.weekly_goal ?? 700})">
                            🎯 Editar Meta Gerentes
                        </button>
                    </div>
                </div>
            `).join('');
        } else {
            list.innerHTML = `
                <div class="empty-state">
                    <span>📦</span>
                    <p>Nenhum material cadastrado.</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('Erro ao carregar metas de materiais (gerentes):', error);
    }
}

function editManagerMaterialGoal(id, currentName, currentIcon, currentGoal) {
    const modalHtml = `
        <div class="edit-modal-overlay" id="editManagerMaterialModal">
            <div class="edit-modal-content">
                <h3>🎯 Meta Semanal (Gerentes)</h3>
                <div class="edit-form">
                    <div class="form-group">
                        <label>Material:</label>
                        <div style="display: flex; align-items: center; gap: 10px; padding: 10px; background: #1a1a2e; border-radius: 8px;">
                            <span style="font-size: 32px;">${currentIcon}</span>
                            <span style="font-size: 18px; font-weight: 600;">${currentName}</span>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Meta Semanal (Gerentes):</label>
                        <input type="number" id="editManagerMatGoal" value="${currentGoal}" min="1" class="edit-input">
                    </div>
                    <div class="modal-buttons">
                        <button class="btn btn-primary" onclick="saveManagerMaterialGoal(${id})">💾 Salvar</button>
                        <button class="btn btn-secondary" onclick="closeEditModal()">❌ Cancelar</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function saveManagerMaterialGoal(id) {
    const newGoal = parseInt(document.getElementById('editManagerMatGoal').value);
    if (isNaN(newGoal) || newGoal < 1) {
        showNotification('❌ Meta semanal inválida', 'error');
        return;
    }

    showPermConfirmModal(
        '🎯 Salvar Meta de Gerentes',
        `Tem certeza que deseja alterar a meta dos gerentes para <strong>${newGoal}</strong>?`,
        'success',
        () => confirmSaveManagerMaterialGoal(id, newGoal)
    );
}

async function confirmSaveManagerMaterialGoal(id, newGoal) {
    closePermConfirmModal();
    try {
        const response = await fetch(`/api/admin/materials/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ manager_weekly_goal: newGoal })
        });
        const data = await response.json();
        if (data.success) {
            closeEditModal();
            showNotification('✅ Meta de gerentes atualizada!', 'success');
            loadManagerMaterialsGoals();
        } else {
            showNotification(data.error || 'Erro ao atualizar meta de gerentes', 'error');
        }
    } catch (error) {
        showNotification('Erro ao atualizar meta de gerentes', 'error');
    }
}

async function loadManagerPaymentGoals() {
    try {
        const response = await fetch('/api/admin/payment-types');
        const data = await response.json();
        const list = document.getElementById('managerPaymentTypesList');
        if (!list) return;

        const paymentTypes = data.paymentTypes || [];

        if (paymentTypes.length > 0) {
            list.innerHTML = paymentTypes.map(pt => `
                <div class="material-manage-item ${pt.active ? '' : 'inactive'}">
                    <div class="material-info">
                        <span class="material-icon">${pt.icon}</span>
                        <span class="material-name">${pt.name}</span>
                        <span class="material-goal-display">Meta Membros: <strong>R$ ${pt.weekly_goal.toLocaleString('pt-BR')}</strong></span>
                        <span class="material-goal-display">Meta Gerentes: <strong>R$ ${(pt.manager_weekly_goal ?? pt.weekly_goal).toLocaleString('pt-BR')}</strong></span>
                    </div>
                    <div class="material-actions">
                        <button class="btn btn-secondary btn-small" onclick="editManagerPaymentGoal(${pt.id}, '${pt.name.replace(/'/g, "\\'")}', '${pt.icon}', ${pt.manager_weekly_goal ?? pt.weekly_goal})">
                            🎯 Editar Meta Gerentes
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
        console.error('Erro ao carregar metas de pagamentos (gerentes):', error);
    }
}

function editManagerPaymentGoal(id, currentName, currentIcon, currentGoal) {
    const modalHtml = `
        <div class="edit-modal-overlay" id="editManagerPaymentModal">
            <div class="edit-modal-content">
                <h3>🎯 Meta Semanal (Gerentes)</h3>
                <div class="edit-form">
                    <div class="form-group">
                        <label>Tipo:</label>
                        <div style="display: flex; align-items: center; gap: 10px; padding: 10px; background: #1a1a2e; border-radius: 8px;">
                            <span style="font-size: 32px;">${currentIcon}</span>
                            <span style="font-size: 18px; font-weight: 600;">${currentName}</span>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Meta Semanal (Gerentes - R$):</label>
                        <input type="number" id="editManagerPayGoal" value="${currentGoal}" min="1" class="edit-input">
                    </div>
                    <div class="modal-buttons">
                        <button class="btn btn-primary" onclick="saveManagerPaymentGoal(${id})">💾 Salvar</button>
                        <button class="btn btn-secondary" onclick="closeEditModal()">❌ Cancelar</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function saveManagerPaymentGoal(id) {
    const newGoal = parseInt(document.getElementById('editManagerPayGoal').value);
    if (isNaN(newGoal) || newGoal < 1) {
        showNotification('❌ Meta semanal inválida', 'error');
        return;
    }

    showPermConfirmModal(
        '🎯 Salvar Meta de Gerentes',
        `Tem certeza que deseja alterar a meta dos gerentes para <strong>R$ ${newGoal.toLocaleString('pt-BR')}</strong>?`,
        'success',
        () => confirmSaveManagerPaymentGoal(id, newGoal)
    );
}

async function confirmSaveManagerPaymentGoal(id, newGoal) {
    closePermConfirmModal();
    try {
        const response = await fetch(`/api/admin/payment-types/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ manager_weekly_goal: newGoal })
        });
        const data = await response.json();
        if (data.success) {
            closeEditModal();
            showNotification('✅ Meta de gerentes atualizada!', 'success');
            loadManagerPaymentGoals();
        } else {
            showNotification(data.error || 'Erro ao atualizar meta de gerentes', 'error');
        }
    } catch (error) {
        showNotification('Erro ao atualizar meta de gerentes', 'error');
    }
}

// ===== CONFIGURAÇÕES DO FARM =====

// Variável global para estado da competição
let competitionEnabled = false;

// Carregar configurações do farm
async function loadFarmSettings() {
    try {
        const response = await fetch('/api/admin/farm-settings');
        const data = await response.json();
        
        const settings = data.settings || {};
        
        // Atualizar checkboxes
        const materialsEnabled = document.getElementById('farmMaterialsEnabled');
        const paymentEnabled = document.getElementById('farmPaymentEnabled');
        const competitionEnabledEl = document.getElementById('competitionEnabled');
        
        if (materialsEnabled) {
            materialsEnabled.checked = settings.farm_materials_enabled === 'true';
        }
        if (paymentEnabled) {
            paymentEnabled.checked = settings.farm_payment_enabled === 'true';
        }
        if (competitionEnabledEl) {
            competitionEnabledEl.checked = settings.competition_enabled === 'true';
            competitionEnabled = settings.competition_enabled === 'true';
            updateCompetitionStatus(competitionEnabled);
        }
        
        // Atualizar radio buttons do modo
        const mode = settings.farm_payment_mode || 'either';
        const radioBtn = document.querySelector(`input[name="paymentMode"][value="${mode}"]`);
        if (radioBtn) {
            radioBtn.checked = true;
        }
        
        // Mostrar/ocultar aba de ranking baseado na competição
        updateCompetitionVisibility();
        
    } catch (error) {
        console.error('Erro ao carregar configurações:', error);
    }
}

// Atualizar status visual da competição
function updateCompetitionStatus(enabled) {
    const statusEl = document.getElementById('competitionStatus');
    if (statusEl) {
        if (enabled) {
            statusEl.innerHTML = '<span class="status-indicator on">🟢 Competição ATIVA - Ranking e Farm Extra disponíveis</span>';
        } else {
            statusEl.innerHTML = '<span class="status-indicator off">⚪ Competição DESATIVADA - Apenas meta básica</span>';
        }
    }
}

// Mostrar/ocultar elementos baseado na competição
function updateCompetitionVisibility() {
    // Ocultar botão da sidebar
    const rankingTab = document.querySelector('[data-tab="weekly-ranking"]');
    if (rankingTab) {
        rankingTab.style.display = competitionEnabled ? 'block' : 'none';
    }
    
    // Ocultar sub-abas e seções relacionadas a farms extras quando competição estiver desabilitada
    const farmsExtraTab = document.getElementById('farmsExtraExtractTab');
    const farmsExtraContent = document.getElementById('farms-extra-extract-content');
    const extraFarmsSection = document.getElementById('extraFarmsSection');
    if (!competitionEnabled) {
        if (farmsExtraTab) farmsExtraTab.style.display = 'none';
        if (farmsExtraContent) farmsExtraContent.style.display = 'none';
        if (extraFarmsSection) extraFarmsSection.style.display = 'none';
    } else {
        if (farmsExtraTab) farmsExtraTab.style.display = 'inline-block';
        // Conteúdo só aparece quando a aba é clicada (switchFarmsTab), então não ativamos aqui
    }
    
    // Se a aba de ranking está ativa e competição desabilitada, voltar para status da semana
    if (!competitionEnabled) {
        const activeTab = document.querySelector('.sidebar-item.active');
        if (activeTab && activeTab.dataset.tab === 'weekly-ranking') {
            switchTab('weekly-status');
        }
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
            
            // Se mudou a competição, atualizar visibilidade
            if (key === 'competition_enabled') {
                competitionEnabled = value === true || value === 'true';
                updateCompetitionStatus(competitionEnabled);
                updateCompetitionVisibility();
            }
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

// ========== TROCAR SENHA E EDITAR PERFIL ==========

// Mostrar modal de trocar senha
function showChangePassword() {
    document.getElementById('changePasswordForm').reset();
    document.getElementById('changePasswordMessage').innerHTML = '';
    document.getElementById('changePasswordModal').classList.add('show');
}

// Fechar modal de trocar senha
function closeChangePasswordModal() {
    document.getElementById('changePasswordModal').classList.remove('show');
}

// Processar formulário de troca de senha
document.getElementById('changePasswordForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmNewPassword = document.getElementById('confirmNewPassword').value;
    const messageEl = document.getElementById('changePasswordMessage');
    
    // Validações
    if (newPassword.length < 6) {
        messageEl.innerHTML = '<span style="color: #e74c3c;">A nova senha deve ter pelo menos 6 caracteres</span>';
        return;
    }
    
    if (newPassword !== confirmNewPassword) {
        messageEl.innerHTML = '<span style="color: #e74c3c;">As senhas não coincidem</span>';
        return;
    }
    
    try {
        messageEl.innerHTML = '<span style="color: #3498db;">Alterando senha...</span>';
        
        const response = await fetch('/api/auth/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword, newPassword })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            messageEl.innerHTML = '<span style="color: #27ae60;">✅ ' + data.message + '</span>';
            document.getElementById('changePasswordForm').reset();
            setTimeout(() => {
                closeChangePasswordModal();
            }, 2000);
        } else {
            messageEl.innerHTML = '<span style="color: #e74c3c;">❌ ' + data.error + '</span>';
        }
    } catch (error) {
        messageEl.innerHTML = '<span style="color: #e74c3c;">❌ Erro ao trocar senha</span>';
    }
});

// Mostrar modal de editar perfil
function showEditProfile() {
    // Preencher campos com dados atuais
    document.getElementById('editName').value = currentUser.name || '';
    document.getElementById('editEmail').value = currentUser.email || '';
    document.getElementById('editPassport').value = currentUser.passport || '';
    document.getElementById('editProfileMessage').innerHTML = '';
    document.getElementById('editProfileModal').classList.add('show');
}

// Fechar modal de editar perfil
function closeEditProfileModal() {
    document.getElementById('editProfileModal').classList.remove('show');
}

// Processar formulário de editar perfil
document.getElementById('editProfileForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const name = document.getElementById('editName').value.trim();
    const email = document.getElementById('editEmail').value.trim();
    const messageEl = document.getElementById('editProfileMessage');
    
    // Validações
    if (!name) {
        messageEl.innerHTML = '<span style="color: #e74c3c;">O nome é obrigatório</span>';
        return;
    }
    
    try {
        messageEl.innerHTML = '<span style="color: #3498db;">Salvando alterações...</span>';
        
        const response = await fetch('/api/auth/update-profile', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            messageEl.innerHTML = '<span style="color: #27ae60;">✅ ' + data.message + '</span>';
            
            // Atualizar dados locais
            currentUser.name = name;
            currentUser.email = email;
            document.getElementById('userName').textContent = name;
            document.getElementById('dropdownUserName').textContent = name;
            
            setTimeout(() => {
                closeEditProfileModal();
            }, 2000);
        } else {
            messageEl.innerHTML = '<span style="color: #e74c3c;">❌ ' + data.error + '</span>';
        }
    } catch (error) {
        messageEl.innerHTML = '<span style="color: #e74c3c;">❌ Erro ao salvar alterações</span>';
    }
});

// Fechar modais ao clicar fora
document.addEventListener('click', function(e) {
    if (e.target === document.getElementById('changePasswordModal')) {
        closeChangePasswordModal();
    }
    if (e.target === document.getElementById('editProfileModal')) {
        closeEditProfileModal();
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
                    select.innerHTML += `<option value="${member.id}">${escapeHtml(member.name)} (${escapeHtml(member.passport)})</option>`;
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
                        <strong>⚠️ ${escapeHtml(w.member_name)}</strong> <small>(${escapeHtml(w.member_passport)})</small>
                        <p class="warning-reason">${escapeHtml(w.reason)}</p>
                        <small>Por: ${escapeHtml(w.given_by_name)} em ${formatDate(w.created_at)}</small>
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

// Remover advertência (super_admin, 01, 02)
async function removeWarning(warningId) {
    if (!confirm('Tem certeza que deseja remover esta advertência?')) {
        return;
    }
    
    const removal_reason = prompt('Motivo para remover a ADV:');
    
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
            availableMembers.map(m => `<option value="${m.id}">${escapeHtml(m.name)} (${escapeHtml(m.passport)})</option>`).join('');
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

// ===== PERMISSÕES DE GRUPOS =====

async function loadRolePermissions() {
    var container = document.getElementById('permissoesContainer');
    if (!container) return;
    
    container.innerHTML = '<p>Carregando...</p>';
    
    var res = await fetch('/api/admin/role-permissions');
    var data = await res.json();
    
    if (data.error) {
        container.innerHTML = '<p style="color:red;">' + data.error + '</p>';
        return;
    }
    
    if (!data.roles || !data.roles.length) {
        container.innerHTML = '<p>Nenhum grupo</p>';
        return;
    }
    
    window.permRoles = data.roles;
    window.permTabs = data.availableTabs || [];
    
    var icons = {'gerente_geral':'👑','01':'🥇','02':'🥈','gerente_farm':'🌾','gerente_acao':'⚡','gerente_recrutamento':'📋','gerente_encomendas':'📦'};
    var h = '';
    
    for (var i = 0; i < data.roles.length; i++) {
        var r = data.roles[i];
        var p = r.permissions || [];
        var all = p.indexOf('all') >= 0;
        var ic = icons[r.role_name] || '👤';
        var gg = r.role_name === 'gerente_geral';
        
        h += '<div style="background:#1e1e3f;border-radius:8px;margin:10px 0;padding:15px;">';
        h += '<div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;" onclick="document.getElementById(\'body_'+r.role_name+'\').style.display=document.getElementById(\'body_'+r.role_name+'\').style.display===\'none\'?\'block\':\'none\'">';
        h += '<b>' + ic + ' ' + r.display_name + '</b><span>▼</span></div>';
        h += '<div id="body_'+r.role_name+'" style="display:none;margin-top:15px;">';
        
        h += '<label style="display:block;margin:10px 0;cursor:pointer;"><input type="checkbox" id="all_'+r.role_name+'" '+(all?'checked':'')+' '+(gg?'disabled':'')+' onchange="window.toggleAllPerm(\''+r.role_name+'\',this.checked)"> ✅ Acesso Total</label>';
        h += '<label style="display:block;margin:10px 0;cursor:pointer;"><input type="checkbox" id="cfg_'+r.role_name+'" '+(r.can_config?'checked':'')+' '+(gg?'disabled':'')+'> ⚙️ Pode Configurar</label>';
        
        h += '<div id="tabs_'+r.role_name+'" style="margin:15px 0;'+(all?'opacity:0.5;pointer-events:none;':'')+'"><b>Tabs:</b><br>';
        for (var j = 0; j < window.permTabs.length; j++) {
            var t = window.permTabs[j];
            var chk = all || p.indexOf(t.id) >= 0;
            h += '<label style="display:inline-block;margin:5px;padding:5px 10px;background:#2a2a4a;border-radius:4px;cursor:pointer;"><input type="checkbox" class="tcb_'+r.role_name+'" data-tab="'+t.id+'" '+(chk?'checked':'')+' '+(gg?'disabled':'')+'> '+t.icon+' '+t.name+'</label>';
        }
        h += '</div>';
        
        if (!gg) h += '<button onclick="window.salvarPerm(\''+r.role_name+'\')" style="background:#4CAF50;color:white;border:none;padding:10px 20px;border-radius:5px;cursor:pointer;">💾 Salvar</button>';
        h += '</div></div>';
    }
    
    container.innerHTML = h;
}

window.toggleAllPerm = function(name, checked) {
    var r = window.permRoles.find(function(x){return x.role_name===name;});
    if (r) r.permissions = checked ? ['all'] : [];
    var d = document.getElementById('tabs_'+name);
    d.style.opacity = checked ? '0.5' : '1';
    d.style.pointerEvents = checked ? 'none' : 'auto';
    var cbs = document.querySelectorAll('.tcb_'+name);
    for (var i=0;i<cbs.length;i++) cbs[i].checked = checked;
};

window.salvarPerm = async function(name) {
    // Modal de confirmação
    showPermConfirmModal(
        '💾 Salvar Permissões',
        `Tem certeza que deseja <strong>salvar</strong> as permissões do grupo?`,
        'success',
        () => confirmarSalvarPerm(name)
    );
};

window.confirmarSalvarPerm = async function(name) {
    closePermConfirmModal();
    
    var r = window.permRoles.find(function(x){return x.role_name===name;});
    if (!r) return;
    
    var perms = [];
    if (document.getElementById('all_'+name).checked) {
        perms = ['all'];
    } else {
        var cbs = document.querySelectorAll('.tcb_'+name+':checked');
        for (var i=0;i<cbs.length;i++) perms.push(cbs[i].dataset.tab);
    }
    
    var cfg = document.getElementById('cfg_'+name).checked ? 1 : 0;
    
    var res = await fetch('/api/admin/role-permissions/'+name, {
        method: 'PUT',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({display_name:r.display_name, permissions:perms, can_config:cfg})
    });
    var data = await res.json();
    
    if (data.success) {
        showNotification('✅ Permissões salvas com sucesso!', 'success');
        loadRolePermissions();
    } else {
        showNotification('❌ ' + (data.error || 'Erro ao salvar'), 'error');
    }
};

// Modal de confirmação para permissões
function showPermConfirmModal(title, message, type, onConfirm) {
    const existing = document.getElementById('permConfirmModal');
    if (existing) existing.remove();
    
    const colorClass = type === 'danger' ? 'btn-danger' : 'btn-success';
    const iconColor = type === 'danger' ? '#e74c3c' : '#00b894';
    const icon = type === 'danger' ? '⚠️' : '💾';
    
    const modal = document.createElement('div');
    modal.id = 'permConfirmModal';
    modal.className = 'action-modal-overlay';
    modal.style.zIndex = '10002';
    modal.innerHTML = `
        <div class="action-modal-content" style="max-width: 400px; text-align: center;">
            <div style="font-size: 48px; margin-bottom: 15px;">${icon}</div>
            <h2 style="color: ${iconColor}; margin-bottom: 15px;">${title}</h2>
            <p style="margin-bottom: 25px; color: #bdc3c7; line-height: 1.6;">${message}</p>
            <div class="modal-actions" style="display: flex; gap: 15px; justify-content: center;">
                <button class="btn ${colorClass}" id="permConfirmBtn">
                    ✅ Sim, Salvar
                </button>
                <button class="btn btn-secondary" onclick="closePermConfirmModal()">
                    Cancelar
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    document.getElementById('permConfirmBtn').addEventListener('click', onConfirm);
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closePermConfirmModal();
    });
}

function closePermConfirmModal() {
    const modal = document.getElementById('permConfirmModal');
    if (modal) modal.remove();
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
        
        // Filtrar apenas membros ativos
        const activeMembers = data.members.filter(m => m.active === 1);
        
        allMembersForAdv = activeMembers;
        renderMembersAdvGrid(activeMembers);
        updateMembersAdvStats(activeMembers);
        
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
                        <h4>${escapeHtml(member.name)}</h4>
                        <span class="passport">📋 Passaporte: ${escapeHtml(member.passport)}</span>
                        <span class="role">👤 ${formatRole(member.role)}</span>
                    </div>
                    <div class="adv-count-badge ${advCountClass}">
                        ${advCount} ADV${advCount !== 1 ? 's' : ''}
                    </div>
                </div>
                <button class="btn-apply-adv" onclick="showAdvModal(${member.id}, '${escapeHtml(member.name.replace(/'/g, "\\'"))}', ${advCount})">
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
        
        // Permitir remover ADV para super_admin, 01, 02, gerente_geral
        const userGroups = currentUser && currentUser.groups ? currentUser.groups : [currentUser?.role];
        const canRemoveAdv = currentUser && (
            currentUser.passport === '6999' || 
            userGroups.some(g => ['super_admin', '01', '02', 'gerente_geral'].includes(g))
        );
        
        let content = `
            <div class="adv-modal-header-info">
                <div class="adv-member-name">👤 ${memberName}</div>
                <div class="adv-count-badge ${data.count >= 3 ? 'critical' : data.count >= 2 ? 'high' : data.count >= 1 ? 'warning' : 'zero'}">
                    ${data.count} ADV${data.count !== 1 ? 's' : ''}
                </div>
            </div>
        `;
        
        if (data.warnings && data.warnings.length > 0) {
            content += `<div class="adv-list">`;
            data.warnings.forEach((warning, index) => {
                const date = warning.created_at ? new Date(warning.created_at).toLocaleDateString('pt-BR', { 
                    day: '2-digit', 
                    month: '2-digit', 
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                }) : 'Data não disponível';
                
                content += `
                    <div class="adv-item">
                        <div class="adv-item-header">
                            <span class="adv-number">#${data.warnings.length - index}</span>
                            <span class="adv-date">📅 ${date}</span>
                        </div>
                        <div class="adv-reason">📝 ${escapeHtml(warning.reason)}</div>
                        <div class="adv-footer">
                            <span class="adv-by">Aplicada por: <strong>${escapeHtml(warning.given_by_name || 'Sistema')}</strong></span>
                            ${canRemoveAdv ? `<button class="btn-remove-adv" onclick="removeWarning(${warning.id}, '${memberName.replace(/'/g, "\\'")}')">🗑️ Remover</button>` : ''}
                        </div>
                    </div>
                `;
            });
            content += `</div>`;
        } else {
            content += `
                <div class="adv-empty">
                    <div class="adv-empty-icon">✅</div>
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

// Processar notificações com dados já carregados (evita chamadas duplicadas)
function processNotificationsWithData(pendingData, justData, passwordData, statusData) {
    adminNotifications = [];
    
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
                message: `${escapeHtml(j.user_name)} enviou justificativa de ausência`,
                time: formatTimeAgo(j.created_at),
                action: 'absences',
                userId: j.user_id
            });
        });
    }
    
    // Notificações de recuperação de senha pendentes
    if (passwordData.requests && passwordData.requests.length > 0) {
        passwordData.requests.forEach(r => {
            adminNotifications.push({
                id: `password_${r.id}`,
                type: 'warning',
                icon: '🔑',
                title: 'Recuperação de Senha',
                message: `${r.user_name} (${r.user_passport}) solicitou nova senha`,
                time: formatTimeAgo(r.requested_at),
                action: 'password-resets',
                userId: r.user_id
            });
        });
    }
    
    // Notificações de membros sem farm (nos últimos 2 dias da semana)
    if ((dayOfWeek === 6 || dayOfWeek === 0) && statusData) {
        if (statusData.notDelivered && statusData.notDelivered.length > 0) {
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
                    message: `${escapeHtml(m.name)} (${escapeHtml(m.passport)}) não entregou farm`,
                    time: 'Esta semana',
                    action: 'adv',
                    userId: m.id,
                    userName: m.name
                });
            });
        }
    }
    
    updateAdminNotificationBadge();
}

// Carregar notificações do admin (versão standalone para refresh)
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
        
        // Buscar solicitações de recuperação de senha pendentes
        const passwordRes = await fetch('/api/admin/password-resets/pending');
        const passwordData = passwordRes.ok ? await passwordRes.json() : { requests: [] };
        
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
                    message: `${escapeHtml(j.user_name)} enviou justificativa de ausência`,
                    time: formatTimeAgo(j.created_at),
                    action: 'absences',
                    userId: j.user_id
                });
            });
        }
        
        // Notificações de recuperação de senha pendentes
        if (passwordData.requests && passwordData.requests.length > 0) {
            passwordData.requests.forEach(r => {
                adminNotifications.push({
                    id: `password_${r.id}`,
                    type: 'warning',
                    icon: '🔑',
                    title: 'Recuperação de Senha',
                    message: `${r.user_name} (${r.user_passport}) solicitou nova senha`,
                    time: formatTimeAgo(r.requested_at),
                    action: 'password-resets',
                    userId: r.user_id
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
                                message: `${escapeHtml(m.name)} (${escapeHtml(m.passport)}) não entregou farm`,
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
            actionBtn = `<div class="notification-action"><button class="btn btn-small btn-danger" onclick="openAdvModalFromNotification(${n.userId}, '${escapeHtml((n.userName || '').replace(/'/g, "\\'"))}')">Aplicar ADV</button></div>`;
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

// Popular select de semanas com datas legíveis
function populateReportWeekSelect() {
    const select = document.getElementById('reportWeekSelect');
    if (!select) {
        console.error('❌ reportWeekSelect NÃO ENCONTRADO!');
        return;
    }
    
    console.log('✅ Encontrou o select, populando...');
    
    select.innerHTML = '';
    
    // Criar opções manualmente e simples
    const options = [
        { value: '0', text: 'Semana Atual' },
        { value: '-1', text: 'Semana Passada' },
        { value: '-2', text: '2 Semanas Atrás' },
        { value: '-3', text: '3 Semanas Atrás' },
        { value: '-4', text: '4 Semanas Atrás' },
        { value: '-5', text: '5 Semanas Atrás' },
        { value: '-6', text: '6 Semanas Atrás' },
        { value: '-7', text: '7 Semanas Atrás' },
        { value: '-8', text: '8 Semanas Atrás' }
    ];
    
    options.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.text;
        select.appendChild(option);
    });
    
    select.value = '0';
    reportWeekOffset = 0;
    
    console.log('✅ Select populado com', select.options.length, 'opções');
}

// Carregar relatório semanal (alinhado ao Status da Semana: só COMPLETO = pagou; Em Progresso/Pendente/etc = não pagou)
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
        // Pegar informações da semana
        const weekResponse = await fetch(`/api/admin/week/${reportWeekOffset}`);
        const weekData = await weekResponse.json();
        
        // Usar a MESMA API do Status da Semana para ficar tudo alinhado
        const params = `?week_start=${weekData.week.start}&week_end=${weekData.week.end}`;
        const response = await fetch(`/api/admin/weekly-status${params}`);
        const data = await response.json();
        
        if (!response.ok) throw new Error(data.error || 'Erro ao carregar relatório');
        
        const completed = data.completed || [];
        const pendingApproval = data.pendingApproval || [];
        const notDelivered = data.notDelivered || [];
        const justified = data.justified || [];
        
        // Pagaram = APENAS status COMPLETO (aprovado e não parcial) + Justificados
        const paid = [];
        const notPaid = [];
        
        // Completo (meta batida) -> Pagaram
        completed.filter(m => !m.is_partial).forEach(member => {
            let paymentTypeText = 'Materiais';
            if (member.payment_type === 'dirty_money' || (member.dirty_money_amount && member.dirty_money_amount > 0 && (!member.items || member.items.length === 0))) {
                paymentTypeText = `Dinheiro Sujo (R$ ${formatNumber(member.dirty_money_amount || 0)})`;
            }
            const role = (member.groups && member.groups.length > 0) ? (roleNames[member.groups[0]] || member.role) : (roleNames[member.role] || member.role);
            paid.push({
                id: member.id,
                name: member.name,
                passport: member.passport,
                role: role,
                farmStatus: 'approved',
                paymentType: member.payment_type || 'material',
                paymentTypeText: paymentTypeText,
                dirtyMoneyAmount: member.dirty_money_amount || 0,
                isLatePayment: member.is_late_payment || false
            });
        });
        
        // Justificados -> Pagaram
        justified.forEach(member => {
            const role = (member.groups && member.groups.length > 0) ? (roleNames[member.groups[0]] || member.role) : (roleNames[member.role] || member.role);
            paid.push({
                id: member.id,
                name: member.name,
                passport: member.passport,
                role: role,
                farmStatus: 'justified',
                paymentType: null,
                paymentTypeText: '-',
                dirtyMoneyAmount: 0,
                isLatePayment: false
            });
        });
        
        // Em Progresso (aprovado mas parcial) -> Não Pagaram
        completed.filter(m => m.is_partial).forEach(member => {
            const role = (member.groups && member.groups.length > 0) ? (roleNames[member.groups[0]] || member.role) : (roleNames[member.role] || member.role);
            notPaid.push({
                id: member.id,
                name: member.name,
                passport: member.passport,
                role: role,
                farmStatus: 'partial',
                statusLabel: 'Em Progresso'
            });
        });
        
        // Aguardando aprovação -> Não Pagaram
        pendingApproval.forEach(member => {
            const role = (member.groups && member.groups.length > 0) ? (roleNames[member.groups[0]] || member.role) : (roleNames[member.role] || member.role);
            notPaid.push({
                id: member.id,
                name: member.name,
                passport: member.passport,
                role: role,
                farmStatus: member.has_justification_pending ? 'justification_pending' : 'pending',
                statusLabel: member.has_justification_pending ? 'Justificativa Pendente' : 'Aguardando Aprovação'
            });
        });
        
        // Não entregou / Rejeitado -> Não Pagaram
        notDelivered.forEach(member => {
            const role = (member.groups && member.groups.length > 0) ? (roleNames[member.groups[0]] || member.role) : (roleNames[member.role] || member.role);
            notPaid.push({
                id: member.id,
                name: member.name,
                passport: member.passport,
                role: role,
                farmStatus: member.was_rejected ? 'rejected' : 'not_delivered',
                statusLabel: member.was_rejected ? 'Rejeitado' : 'Sem Entrega'
            });
        });
        
        const total = paid.length + notPaid.length;
        
        reportData = {
            week: weekData.week,
            paid,
            notPaid,
            total,
            rate: total > 0 ? Math.round((paid.length / total) * 100) : 0
        };
        
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
                            ${data.paid.length > 0 ? data.paid.map(m => {
                                const lateTag = m.isLatePayment ? '<span class="late-payment-tag">⏰ ATRASADO</span>' : '';
                                const statusText = m.farmStatus === 'justified' ? 'Justificado' : (m.isLatePayment ? 'Pago (Atrasado)' : 'Pago');
                                return `
                                    <tr class="${m.isLatePayment ? 'late-payment-row' : ''}">
                                        <td>${escapeHtml(m.passport)}</td>
                                        <td>${escapeHtml(m.name)} ${lateTag}</td>
                                        <td>${m.role}</td>
                                        <td>${m.farmStatus === 'justified' ? '-' : (m.paymentTypeText || 'Materiais')}</td>
                                        <td>${statusText}</td>
                                    </tr>
                                `;
                            }).join('') : '<tr><td colspan="5" style="text-align:center;color:#888;">Nenhum membro</td></tr>'}
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
                                let statusText = m.statusLabel || 'Sem Entrega';
                                if (!m.statusLabel) {
                                    if (m.farmStatus === 'pending') statusText = 'Aguardando Aprovação';
                                    else if (m.farmStatus === 'rejected') statusText = 'Rejeitado';
                                    else if (m.farmStatus === 'justification_pending') statusText = 'Justificativa Pendente';
                                    else if (m.farmStatus === 'partial') statusText = 'Em Progresso';
                                }
                                return `
                                    <tr>
                                        <td>${escapeHtml(m.passport)}</td>
                                        <td>${escapeHtml(m.name)}</td>
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
                            <td>${escapeHtml(m.passport)}</td>
                            <td>${escapeHtml(m.name)}${m.isLatePayment ? ' ⏰' : ''}</td>
                            <td>${m.role}</td>
                            <td>${m.farmStatus === 'justified' ? '-' : (m.paymentTypeText || 'Materiais')}</td>
                            <td>${m.farmStatus === 'justified' ? 'Justificado' : (m.isLatePayment ? 'Pago (Atrasado)' : 'Pago')}</td>
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
                        let statusText = m.statusLabel || 'Sem Entrega';
                        if (!m.statusLabel) {
                            if (m.farmStatus === 'pending') statusText = 'Aguardando Aprovação';
                            else if (m.farmStatus === 'rejected') statusText = 'Rejeitado';
                            else if (m.farmStatus === 'justification_pending') statusText = 'Justificativa Pendente';
                            else if (m.farmStatus === 'partial') statusText = 'Em Progresso';
                        }
                        return `
                            <tr>
                                <td>${escapeHtml(m.passport)}</td>
                                <td>${escapeHtml(m.name)}</td>
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
                                    <strong>${escapeHtml(member.name)}</strong>
                                    <span class="member-passport">ID: ${escapeHtml(member.passport)}</span>
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
                                    <button class="btn btn-small btn-danger" onclick="revokeEditPermission(${member.id}, '${escapeHtml(member.name.replace(/'/g, "\\'"))}')">
                                        🔒 Bloquear
                                    </button>
                                ` : `
                                    <button class="btn btn-small btn-success" onclick="grantEditPermission(${member.id}, '${escapeHtml(member.name.replace(/'/g, "\\'"))}')">
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
            alert(result.error || 'Erro ao revocar');
        }
    } catch (error) {
        alert('Erro ao revogar permissão');
    }
}

// ==================== FIM PERMISSÕES DE EDIÇÃO ====================

// ==================== COMPETIÇÕES ====================

async function loadCompetitions() {
    console.log('🏆 loadCompetitions() CHAMADA!');
    const list = document.getElementById('competitionsList');
    
    if (!list) {
        console.error('❌ Elemento competitionsList não encontrado!');
        return;
    }
    
    try {
        console.log('🏆 Setando loading...');
        list.innerHTML = '<p class="loading">Carregando competições...</p>';
        
        console.log('🏆 Fazendo fetch para /api/admin/competitions');
        const response = await fetch('/api/admin/competitions', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'same-origin'
        });
        
        console.log('🏆 Response recebido:', response.status, response.statusText);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ Erro na resposta:', response.status, response.statusText, errorText);
            list.innerHTML = `<div class="alert alert-error">Erro ${response.status}: ${errorText}</div>`;
            return;
        }
        
        const data = await response.json();
        console.log('🏆 Dados recebidos:', data);
        
        if (data.competitions && data.competitions.length > 0) {
            console.log(`🏆 Renderizando ${data.competitions.length} competições`);
            list.innerHTML = data.competitions.map(comp => {
                const isActive = comp.active === 1;
                const startDate = new Date(comp.start_date).toLocaleString('pt-BR');
                const endDate = new Date(comp.end_date).toLocaleString('pt-BR');
                
                return `
                    <div class="material-manage-item ${isActive ? '' : 'inactive'}">
                        <div class="material-info">
                            <span class="material-icon">🏆</span>
                            <span class="material-name">${comp.name}</span>
                            <span class="material-goal-display">${startDate} até ${endDate}</span>
                            <span class="material-status ${isActive ? 'active' : 'inactive'}">${isActive ? '✅ ATIVA' : '❌ Inativa'}</span>
                        </div>
                        <div class="material-actions">
                            <button class="btn btn-secondary btn-small" onclick="editCompetition(${comp.id})">
                                ✏️ Editar
                            </button>
                            <button class="btn ${isActive ? 'btn-danger' : 'btn-success'} btn-small" onclick="toggleCompetition(${comp.id})">
                                ${isActive ? '❌ Desativar' : '✅ Ativar'}
                            </button>
                            <button class="btn btn-danger btn-small" onclick="deleteCompetition(${comp.id}, '${comp.name.replace(/'/g, "\\'")}')">
                                🗑️ Deletar
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
            console.log('🏆 Competições renderizadas com sucesso');
        } else {
            console.log('🏆 Nenhuma competição encontrada');
            list.innerHTML = '<div class="empty-state"><span>🏆</span><p>Nenhuma competição cadastrada.</p></div>';
        }
        
        console.log('🏆 Tentando carregar ranking...');
        loadCompetitionRanking().catch(err => {
            console.warn('⚠️ Erro ao carregar ranking (não crítico):', err);
        });
        
    } catch (error) {
        console.error('❌ ERRO CRÍTICO ao carregar competições:', error);
        list.innerHTML = `<div class="alert alert-error">Erro: ${error.message}</div>`;
    }
}

async function loadCompetitionRanking() {
    const container = document.getElementById('activeCompetitionRanking');
    
    try {
        container.innerHTML = '<p class="loading">Carregando ranking...</p>';
        
        const response = await fetch('/api/admin/competitions/ranking');
        
        if (!response.ok) {
            if (response.status === 403) {
                container.innerHTML = '';
                return;
            }
            throw new Error('Erro ao carregar ranking');
        }
        
        const data = await response.json();
        
        if (data.competition && data.ranking && data.ranking.length > 0) {
            const prizes = data.competition.prizes ? data.competition.prizes.split('\n').filter(p => p.trim()) : [];
            
            container.innerHTML = `
                <div class="card">
                    <h2>🏆 Ranking - ${data.competition.name}</h2>
                    <p class="subtitle">${data.competition.description || ''}</p>
                    
                    ${prizes.length > 0 ? `
                        <div style="background: #1a1a2e; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                            <h4 style="margin-bottom: 10px;">🎁 Premiação:</h4>
                            ${prizes.map((prize, i) => `<p style="margin: 5px 0;">${i + 1}º lugar: ${prize}</p>`).join('')}
                        </div>
                    ` : ''}
                    
                    <div class="table-container">
                        <table class="weekly-table">
                            <thead>
                                <tr>
                                    <th>Posição</th>
                                    <th>Membro</th>
                                    <th>Passaporte</th>
                                    <th>Farms Completos</th>
                                    <th>Total de Materiais</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${data.ranking.map((member, index) => {
                                    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '';
                                    return `
                                        <tr style="cursor: pointer;" onclick="showMemberCompetitionDetails(${data.competition.id}, ${member.id}, '${escapeHtml(member.name.replace(/'/g, "\\'"))}')" 
                                            onmouseover="this.style.backgroundColor='#2a2a3e'" 
                                            onmouseout="this.style.backgroundColor=''">
                                            <td><strong>${medal} ${index + 1}º</strong></td>
                                            <td>${escapeHtml(member.name)}</td>
                                            <td>${escapeHtml(member.passport)}</td>
                                            <td><strong style="color: #4CAF50; font-size: 18px;">${member.total_farms}</strong></td>
                                            <td>${member.total_materials.toLocaleString('pt-BR')}</td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        } else if (data.competition) {
            container.innerHTML = `
                <div class="card">
                    <h2>🏆 Ranking - ${data.competition.name}</h2>
                    <p class="subtitle">${data.competition.description || ''}</p>
                    <div class="empty-state">
                        <span>📊</span>
                        <p>Ainda não há farms aprovados nesta competição.</p>
                    </div>
                </div>
            `;
        } else {
            container.innerHTML = '';
        }
    } catch (error) {
        console.error('Erro ao carregar ranking:', error);
        container.innerHTML = '<div class="alert alert-error">Erro ao carregar ranking. Tente novamente.</div>';
    }
}

function openNewCompetitionModal() {
    const now = new Date();
    const today = now.toISOString().slice(0, 16);
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    const nextWeekStr = nextWeek.toISOString().slice(0, 16);
    
    const modalHtml = `
        <div class="edit-modal-overlay" id="competitionModal">
            <div class="edit-modal-content">
                <h3>🏆 Nova Competição</h3>
                <div class="edit-form">
                    <div class="form-group">
                        <label>Nome da Competição *</label>
                        <input type="text" id="compName" class="edit-input" placeholder="Ex: Competição de Verão">
                    </div>
                    <div class="form-group">
                        <label>Descrição</label>
                        <textarea id="compDesc" class="edit-input" rows="3" placeholder="Breve descrição da competição"></textarea>
                    </div>
                    <div class="form-group">
                        <label>Data e Hora de Início *</label>
                        <input type="datetime-local" id="compStartDate" class="edit-input" value="${today}">
                    </div>
                    <div class="form-group">
                        <label>Data e Hora de Término *</label>
                        <input type="datetime-local" id="compEndDate" class="edit-input" value="${nextWeekStr}">
                    </div>
                    <div class="form-group">
                        <label>Premiação (uma por linha)</label>
                        <textarea id="compPrizes" class="edit-input" rows="4" placeholder="1º lugar: R$ 1.000.000
2º lugar: R$ 500.000
3º lugar: R$ 250.000"></textarea>
                    </div>
                    <div class="modal-buttons">
                        <button class="btn btn-primary" onclick="saveCompetition()">💾 Criar</button>
                        <button class="btn btn-secondary" onclick="closeCompetitionModal()">❌ Cancelar</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

async function editCompetition(id) {
    try {
        const response = await fetch('/api/admin/competitions');
        const data = await response.json();
        const comp = data.competitions.find(c => c.id === id);
        
        if (!comp) {
            alert('Competição não encontrada');
            return;
        }
        
        const modalHtml = `
            <div class="edit-modal-overlay" id="competitionModal">
                <div class="edit-modal-content">
                    <h3>✏️ Editar Competição</h3>
                    <div class="edit-form">
                        <div class="form-group">
                            <label>Nome da Competição *</label>
                            <input type="text" id="compName" class="edit-input" value="${comp.name}">
                        </div>
                        <div class="form-group">
                            <label>Descrição</label>
                            <textarea id="compDesc" class="edit-input" rows="3">${comp.description || ''}</textarea>
                        </div>
                        <div class="form-group">
                            <label>Data e Hora de Início *</label>
                            <input type="datetime-local" id="compStartDate" class="edit-input" value="${comp.start_date.slice(0, 16)}">
                        </div>
                        <div class="form-group">
                            <label>Data e Hora de Término *</label>
                            <input type="datetime-local" id="compEndDate" class="edit-input" value="${comp.end_date.slice(0, 16)}">
                        </div>
                        <div class="form-group">
                            <label>Premiação (uma por linha)</label>
                            <textarea id="compPrizes" class="edit-input" rows="4">${comp.prizes || ''}</textarea>
                        </div>
                        <div class="modal-buttons">
                            <button class="btn btn-primary" onclick="updateCompetition(${id})">💾 Salvar</button>
                            <button class="btn btn-secondary" onclick="closeCompetitionModal()">❌ Cancelar</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    } catch (error) {
        alert('Erro ao carregar competição');
    }
}

async function saveCompetition() {
    const name = document.getElementById('compName').value.trim();
    const description = document.getElementById('compDesc').value.trim();
    const start_date = document.getElementById('compStartDate').value;
    const end_date = document.getElementById('compEndDate').value;
    const prizes = document.getElementById('compPrizes').value.trim();
    
    if (!name || !start_date || !end_date) {
        alert('❌ Preencha nome, data de início e fim!');
        return;
    }
    
    try {
        console.log('Criando competição...', { name, start_date, end_date });
        const response = await fetch('/api/admin/competitions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description, start_date, end_date, prizes })
        });
        
        const data = await response.json();
        console.log('Resposta da criação:', data);
        
        if (data.success) {
            alert('✅ Competição criada!');
            closeCompetitionModal();
            console.log('Recarregando competições...');
            await loadCompetitions();
            console.log('Competições recarregadas!');
        } else {
            alert(data.error || 'Erro ao criar competição');
        }
    } catch (error) {
        console.error('Erro ao criar competição:', error);
        alert('Erro ao criar competição');
    }
}

async function updateCompetition(id) {
    const name = document.getElementById('compName').value.trim();
    const description = document.getElementById('compDesc').value.trim();
    const start_date = document.getElementById('compStartDate').value;
    const end_date = document.getElementById('compEndDate').value;
    const prizes = document.getElementById('compPrizes').value.trim();
    
    if (!name || !start_date || !end_date) {
        alert('❌ Preencha nome, data de início e fim!');
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/competitions/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description, start_date, end_date, prizes })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert('✅ Competição atualizada!');
            closeCompetitionModal();
            loadCompetitions();
        } else {
            alert(data.error || 'Erro ao atualizar competição');
        }
    } catch (error) {
        alert('Erro ao atualizar competição');
    }
}

async function toggleCompetition(id) {
    try {
        const response = await fetch(`/api/admin/competitions/${id}/toggle`, {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert(data.message);
            loadCompetitions();
        } else {
            alert(data.error || 'Erro ao alterar status');
        }
    } catch (error) {
        alert('Erro ao alterar status');
    }
}

async function deleteCompetition(id, name) {
    if (!confirm(`Tem certeza que deseja deletar a competição "${name}"?\n\nTodos os dados do ranking serão perdidos!`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/competitions/${id}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert('✅ Competição deletada!');
            loadCompetitions();
        } else {
            alert(data.error || 'Erro ao deletar competição');
        }
    } catch (error) {
        alert('Erro ao deletar competição');
    }
}

function closeCompetitionModal() {
    const modal = document.getElementById('competitionModal');
    if (modal) modal.remove();
}

// Mostrar detalhes do membro na competição
async function showMemberCompetitionDetails(competitionId, userId, userName) {
    try {
        const response = await fetch(`/api/admin/competitions/member-details/${competitionId}/${userId}`);
        
        if (!response.ok) {
            throw new Error('Erro ao carregar detalhes');
        }
        
        const data = await response.json();
        
        const modalHtml = `
            <div class="edit-modal-overlay" id="memberDetailsModal">
                <div class="edit-modal-content" style="max-width: 900px;">
                    <h3>📊 Detalhes de ${userName}</h3>
                    <div style="margin: 20px 0;">
                        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 20px;">
                            <div style="background: #1a1a2e; padding: 15px; border-radius: 8px; text-align: center;">
                                <div style="font-size: 24px; font-weight: bold; color: #4CAF50;">
                                    ${data.totalDeliveries}
                                </div>
                                <div style="color: #888; margin-top: 5px;">Farms Completos</div>
                            </div>
                            <div style="background: #1a1a2e; padding: 15px; border-radius: 8px; text-align: center;">
                                <div style="font-size: 24px; font-weight: bold; color: #2196F3;">
                                    ${data.totalMaterials.toLocaleString('pt-BR')}
                                </div>
                                <div style="color: #888; margin-top: 5px;">Total de Materiais</div>
                            </div>
                            <div style="background: #1a1a2e; padding: 15px; border-radius: 8px; text-align: center;">
                                <div style="font-size: 24px; font-weight: bold; color: #FF9800;">
                                    ${data.user.passport}
                                </div>
                                <div style="color: #888; margin-top: 5px;">Passaporte</div>
                            </div>
                        </div>
                        
                        <h4 style="margin-top: 25px; margin-bottom: 15px;">📦 Entregas Aprovadas</h4>
                        <div style="max-height: 500px; overflow-y: auto;">
                            ${data.deliveries.map(delivery => `
                                <div style="background: #1a1a2e; padding: 15px; border-radius: 8px; margin-bottom: 10px;">
                                    <div style="display: flex; justify-content: space-between; align-items: start; gap: 20px;">
                                        <div style="flex: 1;">
                                            <div style="font-weight: bold; margin-bottom: 8px;">
                                                📅 ${delivery.week}
                                            </div>
                                            <div style="color: #888; font-size: 14px; margin-bottom: 8px;">
                                                ${delivery.materials_detail || 'Sem detalhes'}
                                            </div>
                                            <div style="color: #4CAF50; font-weight: bold;">
                                                ✅ ${delivery.material_count} materiais
                                            </div>
                                            <div style="color: #888; font-size: 12px; margin-top: 5px;">
                                                Aprovado em: ${new Date(delivery.approved_at).toLocaleString('pt-BR')}
                                            </div>
                                        </div>
                                        ${delivery.proof_url ? `
                                            <div>
                                                <img src="${delivery.proof_url}" 
                                                     onclick="openImageModal('${delivery.proof_url}')"
                                                     style="width: 150px; height: 100px; object-fit: cover; border-radius: 8px; cursor: pointer; border: 2px solid #333;"
                                                     alt="Print da entrega">
                                            </div>
                                        ` : '<div style="width: 150px; color: #666;">Sem print</div>'}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                        
                        <div class="modal-buttons" style="margin-top: 20px;">
                            <button class="btn btn-secondary" onclick="closeMemberDetailsModal()">❌ Fechar</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    } catch (error) {
        console.error('Erro ao carregar detalhes do membro:', error);
        alert('Erro ao carregar detalhes do membro');
    }
}

function closeMemberDetailsModal() {
    const modal = document.getElementById('memberDetailsModal');
    if (modal) modal.remove();
}

// ==================== FIM COMPETIÇÕES ====================

// ==================== RANKING SEMANAL ====================
// Atualizado: 2026-01-26 - Fix para calcular semana corretamente

function loadWeeklyRankingTab() {
    const select = document.getElementById('rankingWeekSelect');
    if (!select) {
        console.error('Elemento rankingWeekSelect não encontrado');
        return;
    }
    
    let html = '';
    
    // Carregar 3 semanas anteriores e 2 próximas
    for (let i = -3; i <= 2; i++) {
        const week = getWeekStartDate(i);
        const label = formatWeekLabelSingle(week);
        html += `<option value="${week}" ${i===0?'selected':''}>${label}${i===0?' (Esta semana)':''}</option>`;
    }
    
    select.innerHTML = html;
    loadWeeklyRanking();
}

function getWeekStartDate(offset = 0) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    
    const dayOfWeek = now.getDay(); // 0 = domingo, 1 = segunda, etc
    
    // Calcular quantos dias voltar para chegar na SEGUNDA
    // Igual ao backend: se domingo (0), volta 6 dias. Se segunda (1), volta 0 dias.
    const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    
    const monday = new Date(now);
    monday.setDate(now.getDate() - daysFromMonday + (offset * 7));
    monday.setHours(0, 0, 0, 0);
    
    return formatDateISO(monday);
}

function formatDateISO(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatWeekLabelSingle(weekStart) {
    // Adicionar T00:00:00 para garantir interpretação correta da data
    const monday = new Date(weekStart + 'T00:00:00');
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    
    const dayM = String(monday.getDate()).padStart(2, '0');
    const monthM = String(monday.getMonth() + 1).padStart(2, '0');
    const yearM = monday.getFullYear();
    
    const dayS = String(sunday.getDate()).padStart(2, '0');
    const monthS = String(sunday.getMonth() + 1).padStart(2, '0');
    const yearS = sunday.getFullYear();
    
    return `${dayM}/${monthM}/${yearM} até ${dayS}/${monthS}/${yearS}`;
}

async function loadWeeklyRanking() {
    const select = document.getElementById('rankingWeekSelect');
    const tbody = document.getElementById('weeklyRankingBody');
    
    if (!select || !tbody) {
        console.error('Elementos do ranking não encontrados');
        return;
    }
    
    const weekStart = select.value;
    if (!weekStart) {
        console.error('Nenhuma semana selecionada');
        return;
    }
    
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:40px">⏳ Carregando ranking...</td></tr>';
    
    try {
        // Calcular week_end (6 dias depois)
        const startDate = new Date(weekStart + 'T00:00:00');
        const endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 6);
        const weekEnd = formatDateISO(endDate);
        
        // Usar nova rota OTIMIZADA do ranking
        const url = `/api/admin/weekly-ranking-fast?week_start=${weekStart}&week_end=${weekEnd}`;
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        const ranking = data.ranking || [];
        
        if (ranking.length === 0) {
            document.getElementById('rankingWinnersSection').style.display = 'none';
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:60px;color:#888"><div style="font-size:40px;margin-bottom:15px;">📭</div><div>Nenhuma farm aprovada nesta semana</div></td></tr>';
            return;
        }
        
        // Guardar para uso posterior
        window.currentRankingData = ranking;
        
        // Mostrar vencedores (top 3)
        const winnersSection = document.getElementById('rankingWinnersSection');
        if (ranking.length >= 1) {
            winnersSection.style.display = 'block';
            
            // 1º lugar
            document.getElementById('rankingWinner1').textContent = ranking[0]?.name || '-';
            document.getElementById('rankingStats1').textContent = `${ranking[0]?.totalMaterials || 0} materiais`;
            
            // 2º lugar
            if (ranking.length >= 2) {
                document.getElementById('rankingWinner2').textContent = ranking[1]?.name || '-';
                document.getElementById('rankingStats2').textContent = `${ranking[1]?.totalMaterials || 0} materiais`;
            } else {
                document.getElementById('rankingWinner2').textContent = '-';
                document.getElementById('rankingStats2').textContent = '---';
            }
            
            // 3º lugar
            if (ranking.length >= 3) {
                document.getElementById('rankingWinner3').textContent = ranking[2]?.name || '-';
                document.getElementById('rankingStats3').textContent = `${ranking[2]?.totalMaterials || 0} materiais`;
            } else {
                document.getElementById('rankingWinner3').textContent = '-';
                document.getElementById('rankingStats3').textContent = '---';
            }
        } else {
            winnersSection.style.display = 'none';
        }
        
        // Mostrar ranking completo na tabela
        const medals = ['🥇', '🥈', '🥉'];
        let positionCounter = 1;
        tbody.innerHTML = ranking.map((r, i) => {
            const position = i < 3 ? medals[i] : `${positionCounter}º`;
            positionCounter++;
            const bgColor = i === 0 ? 'rgba(255, 215, 0, 0.15)' : i === 1 ? 'rgba(192, 192, 192, 0.15)' : i === 2 ? 'rgba(205, 127, 50, 0.15)' : 'transparent';
            
            // Criar HTML dos itens da META
            const metaItemsHtml = r.items && r.items.length > 0 
                ? r.items.map(item => `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: #1a1a2e; border-radius: 6px; margin: 4px 0;">
                        <span>${item.material_icon || '📦'} ${item.material_name}</span>
                        <span style="font-weight: bold; color: #00b894;">${item.amount.toLocaleString('pt-BR')}</span>
                    </div>
                `).join('')
                : '<div style="color: #888;">Sem itens</div>';
            
            // Criar HTML dos itens EXTRA
            const extraItemsHtml = r.extra_items && r.extra_items.length > 0 
                ? r.extra_items.map(item => `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: #1a1a2e; border-radius: 6px; margin: 4px 0;">
                        <span>${item.material_icon || '📦'} ${item.material_name}</span>
                        <span style="font-weight: bold; color: #f39c12;">${item.amount.toLocaleString('pt-BR')}</span>
                    </div>
                `).join('')
                : '<div style="color: #888;">Sem farm extra</div>';
            
            // Criar HTML dos screenshots da META
            const metaScreenshotsHtml = r.screenshots && r.screenshots.length > 0
                ? `<div style="display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px;">
                    ${r.screenshots.map(s => `
                        <a href="${s.screenshot_url}" target="_blank">
                            <img src="${s.screenshot_url}" style="height: 70px; border-radius: 6px; cursor: pointer; transition: transform 0.2s; border: 2px solid #00b894;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                        </a>
                    `).join('')}
                </div>`
                : '<div style="color: #888;">Sem prints</div>';
            
            // Criar HTML dos screenshots EXTRA
            const extraScreenshotsHtml = r.extra_screenshots && r.extra_screenshots.length > 0
                ? `<div style="display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px;">
                    ${r.extra_screenshots.map(s => `
                        <a href="${s.screenshot_url}" target="_blank">
                            <img src="${s.screenshot_url}" style="height: 70px; border-radius: 6px; cursor: pointer; transition: transform 0.2s; border: 2px solid #f39c12;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                        </a>
                    `).join('')}
                </div>`
                : '<div style="color: #888;">Sem prints</div>';
            
            // Status badge (ranking só mostra aprovados)
            const hasExtra = r.extraMaterials > 0;
            const statusBadge = '<span style="background: #00b894; color: #fff; padding: 3px 8px; border-radius: 4px; font-size: 11px; margin-left: 8px;">✓ APROVADO</span>';
            const extraBadge = hasExtra ? `<span style="background: #f39c12; color: #fff; padding: 3px 8px; border-radius: 4px; font-size: 11px; margin-left: 4px;">🏆 +${r.extraMaterials.toLocaleString('pt-BR')}</span>` : '';
            const borderColor = '#00b894';
            
            // Resumo de materiais
            const materialsSummary = hasExtra 
                ? `<span style="color: #00b894;">${r.metaMaterials.toLocaleString('pt-BR')}</span> <span style="color: #666;">+</span> <span style="color: #f39c12;">${r.extraMaterials.toLocaleString('pt-BR')}</span> <span style="color: #fff;">= ${r.totalMaterials.toLocaleString('pt-BR')}</span>`
                : `<span style="color: #00b894;">${r.totalMaterials.toLocaleString('pt-BR')}</span>`;
            
            return `
                <tr style="background: ${bgColor}; cursor: pointer; transition: all 0.2s;" onclick="toggleRankingDetails(${i})" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">
                    <td style="text-align:center;font-size:22px;padding:15px;">${position}</td>
                    <td style="font-weight:${i<3?'700':'500'};padding:15px;font-size:15px;">${r.name}${statusBadge}${extraBadge}</td>
                    <td style="text-align:center;font-family:monospace;color:#888;padding:15px;">${r.passport}</td>
                    <td style="text-align:center;font-size:16px;font-weight:bold;padding:15px;">${materialsSummary}</td>
                </tr>
                <tr id="rankingDetails-${i}" style="display: none;">
                    <td colspan="4" style="padding: 0;">
                        <div style="background: #12121c; padding: 20px; border-left: 3px solid ${borderColor};">
                            <!-- Farm da Meta -->
                            <div style="margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid #333; background: rgba(0, 184, 148, 0.05); padding: 15px; border-radius: 8px;">
                                <h3 style="margin-bottom: 15px; color: #00b894; font-size: 16px;">📦 FARM DA META</h3>
                                <div style="background: rgba(0,184,148,0.1); padding: 8px 12px; border-radius: 6px; margin-bottom: 15px; display: inline-block;">
                                    <span style="color: #00b894; font-weight: bold; font-size: 18px;">${r.metaMaterials.toLocaleString('pt-BR')}</span>
                                    <span style="color: #888; font-size: 12px;"> materiais da meta</span>
                                </div>
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                                    <div>
                                        <h4 style="margin-bottom: 10px; color: #667eea; font-size: 13px;">Materiais Entregues</h4>
                                        ${metaItemsHtml}
                                    </div>
                                    <div>
                                        <h4 style="margin-bottom: 10px; color: #667eea; font-size: 13px;">📸 Comprovantes</h4>
                                        ${metaScreenshotsHtml}
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Farm Extra -->
                            <div style="background: rgba(243, 156, 18, 0.05); padding: 15px; border-radius: 8px;">
                                <h3 style="margin-bottom: 15px; color: #f39c12; font-size: 16px;">🏆 FARM EXTRA RANKING</h3>
                                <div style="background: rgba(243,156,18,0.1); padding: 8px 12px; border-radius: 6px; margin-bottom: 15px; display: inline-block;">
                                    <span style="color: #f39c12; font-weight: bold; font-size: 18px;">${r.extraMaterials.toLocaleString('pt-BR')}</span>
                                    <span style="color: #888; font-size: 12px;"> materiais extras</span>
                                </div>
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                                    <div>
                                        <h4 style="margin-bottom: 10px; color: #667eea; font-size: 13px;">Materiais Extras</h4>
                                        ${extraItemsHtml}
                                    </div>
                                    <div>
                                        <h4 style="margin-bottom: 10px; color: #667eea; font-size: 13px;">📸 Comprovantes Extra</h4>
                                        ${extraScreenshotsHtml}
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Total Geral -->
                            <div style="margin-top: 15px; padding-top: 15px; border-top: 2px solid #333; text-align: center;">
                                <span style="color: #888; font-size: 12px;">TOTAL GERAL: </span>
                                <span style="color: #00b894; font-weight: bold;">${r.metaMaterials.toLocaleString('pt-BR')}</span>
                                <span style="color: #666;"> + </span>
                                <span style="color: #f39c12; font-weight: bold;">${r.extraMaterials.toLocaleString('pt-BR')}</span>
                                <span style="color: #666;"> = </span>
                                <span style="color: #fff; font-weight: bold; font-size: 18px;">${r.totalMaterials.toLocaleString('pt-BR')}</span>
                            </div>
                            
                            ${r.delivered_at ? `<div style="color: #666; font-size: 11px; margin-top: 15px; text-align: right;">Farm entregue em: ${new Date(r.delivered_at).toLocaleString('pt-BR')}</div>` : ''}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
        
    } catch (error) {
        console.error('Erro ao carregar ranking:', error);
        document.getElementById('rankingWinnersSection').style.display = 'none';
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:40px;color:#ff7675">❌ Erro ao carregar ranking</td></tr>';
    }
}

// Função para expandir/recolher detalhes do membro
function toggleRankingDetails(index) {
    const detailsRow = document.getElementById(`rankingDetails-${index}`);
    if (!detailsRow) return;
    
    // Fechar todas as outras linhas abertas
    document.querySelectorAll('[id^="rankingDetails-"]').forEach(row => {
        if (row.id !== `rankingDetails-${index}`) {
            row.style.display = 'none';
        }
    });
    
    // Toggle da linha clicada
    if (detailsRow.style.display === 'none') {
        detailsRow.style.display = 'table-row';
    } else {
        detailsRow.style.display = 'none';
    }
}

// ==================== FIM RANKING SEMANAL ====================

// ==================== EDIÇÃO DE ENTREGAS (SUPER ADMIN) ====================

let currentEditDeliveryId = null;
let currentEditUserId = null;
let currentEditWeekStart = null;
let currentEditWeekEnd = null;
let currentEditMemberId = null;
let currentCreateMemberId = null;
let currentCreateWeekStart = null;
let currentCreateWeekEnd = null;

// Gerar lista de semanas (16 semanas passadas + atual + 4 futuras)
function generateWeekOptions(selectedStart, selectedEnd) {
    const options = [];
    // -16 até +4 semanas em relação à semana atual
    for (let offset = -16; offset <= 4; offset++) {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + offset * 7);
        const dow = d.getDay();
        const daysFromMon = dow === 0 ? 6 : dow - 1;
        const mon = new Date(d); mon.setDate(d.getDate() - daysFromMon);
        const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
        const fmt = dt => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
        const ws = fmt(mon); const we = fmt(sun);
        const label = `${mon.toLocaleDateString('pt-BR')} – ${sun.toLocaleDateString('pt-BR')}${offset === 0 ? ' (semana atual)' : ''}`;
        options.push({ ws, we, label, isCurrent: offset === 0 });
    }
    return options;
}

function onEditWeekChange() {
    const sel = document.getElementById('editWeekSelect');
    const badge = document.getElementById('editWeekChangedBadge');
    if (!sel || !badge) return;
    const [ws, we] = sel.value.split('|');
    badge.style.display = (ws !== currentEditWeekStart || we !== currentEditWeekEnd) ? 'inline' : 'none';
}

// Abrir modal para editar entrega existente
// Mostra o farm correto (uma entrega por vez, não soma) e status = espelho do Status da Semana
async function openEditDeliveryModal(memberId, weekStart, weekEnd, tableStatus) {
    // Qualquer admin pode editar entregas
    if (!currentUser) {
        showNotification('Você precisa estar logado para editar entregas', 'error');
        return;
    }
    
    currentEditMemberId = memberId;
    
    const modal = document.getElementById('editDeliveryModal');
    modal.style.display = 'flex';
    
    document.getElementById('editDeliveryItems').innerHTML = '<p class="loading">Carregando...</p>';
    document.getElementById('editDeliveryExistingScreenshots').innerHTML = '';
    document.getElementById('editDeliveryNewScreenshotsPreview').innerHTML = '';
    document.getElementById('editDeliveryScreenshotInput').value = '';
    const envioSelEl = document.getElementById('editDeliveryEnvioSelector');
    if (envioSelEl) { envioSelEl.style.display = 'none'; envioSelEl.innerHTML = ''; }
    
    try {
        const response = await fetch(`/api/admin/week-delivery-details?userId=${memberId}&week_start=${weekStart}&week_end=${weekEnd}`, {
            credentials: 'same-origin'
        });
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Erro ao carregar detalhes');
        }
        
        // Usar entregas por envio (farm correto); fallback para formato antigo
        const deliveriesWithItems = data.deliveriesWithItems || [{
            delivery: data.delivery,
            items: data.items || [],
            screenshots: (data.screenshots || []).filter(s => !s.delivery_id || s.delivery_id === data.delivery.id)
        }];
        
        const allMaterials = data.allMaterials || [];
        currentEditUserId = memberId;
        currentEditWeekStart = weekStart;
        currentEditWeekEnd = weekEnd;
        
        // Status = espelho do Status da Semana (prioridade: status passado pelo botão > membro da tabela > backend)
        const memberFromTable = window.__weeklyStatusMembersFull && window.__weeklyStatusMembersFull.find(m => m.id == memberId);
        let displayStatus = data.delivery.status;
        if (data.delivery.status === 'approved' && data.delivery.is_partial) displayStatus = 'in_progress';
        if (tableStatus) {
            if (tableStatus === 'completed') displayStatus = 'approved';
            else if (tableStatus === 'partial') displayStatus = 'in_progress';
            else if (tableStatus === 'pending') displayStatus = 'pending';
            else if (tableStatus === 'missing') displayStatus = 'not_delivered';
        } else if (memberFromTable) {
            if (memberFromTable.status === 'completed') displayStatus = 'approved';
            else if (memberFromTable.status === 'partial') displayStatus = 'in_progress';
            else if (memberFromTable.status === 'pending') displayStatus = 'pending';
            else if (memberFromTable.status === 'missing') displayStatus = 'not_delivered';
        }
        
        // Guardar dados para troca de envio e para save
        window.__currentEditDeliveryDetailsData = {
            deliveriesWithItems,
            allMaterials,
            delivery_count: data.delivery.delivery_count || deliveriesWithItems.length
        };
        
        // Primeira entrega (índice 0) = mais recente
        currentEditDeliveryId = deliveriesWithItems[0].delivery.id;
        
        document.getElementById('editDeliveryMemberName').textContent = data.delivery.member_name;
        const weekLabel = formatWeekLabel(data.delivery.week_start, data.delivery.week_end);
        document.getElementById('editDeliveryWeek').textContent = weekLabel;
        
        const weekSel = document.getElementById('editWeekSelect');
        if (weekSel) {
            const weeks = generateWeekOptions(weekStart, weekEnd);
            weekSel.innerHTML = weeks.map(w => {
                const selected = (w.ws === weekStart && w.we === weekEnd) ? 'selected' : '';
                return `<option value="${w.ws}|${w.we}" ${selected}>${w.label}</option>`;
            }).join('');
            if (!weekSel.value) {
                const fmtBR = s => { const [y,m,d] = s.split('-'); return `${d}/${m}/${y}`; };
                const opt = document.createElement('option');
                opt.value = `${weekStart}|${weekEnd}`;
                opt.textContent = `${fmtBR(weekStart)} – ${fmtBR(weekEnd)} (semana da entrega)`;
                opt.selected = true;
                weekSel.prepend(opt);
            }
            const badge = document.getElementById('editWeekChangedBadge');
            if (badge) badge.style.display = 'none';
        }
        
        // Seletor de envio quando há mais de um
        if (deliveriesWithItems.length > 1 && envioSelEl) {
            envioSelEl.style.display = 'block';
            envioSelEl.innerHTML = `
                <label style="color: #aaa; margin-right: 8px;">Envio:</label>
                <select id="editEnvioSelect" onchange="switchEditDeliveryEnvio(this.selectedIndex)" style="background: #2d2d44; border: 1px solid rgba(255,255,255,0.3); color: #fff; padding: 8px 12px; border-radius: 6px; font-size: 14px; min-width: 120px;">
                    ${deliveriesWithItems.map((_, i) => `<option value="${i}">Envio #${i + 1}</option>`).join('')}
                </select>
            `;
        }
        
        // Status (espelho da tabela)
        const statusOptions = [
            { value: 'approved', label: '✅ Completo', color: '#27ae60' },
            { value: 'in_progress', label: '⚡ Em Progresso', color: '#3498db' },
            { value: 'pending', label: '⏳ Aguardando', color: '#f39c12' },
            { value: 'not_delivered', label: '🚫 Não Entregou', color: '#e74c3c' }
        ];
        let statusSelectHtml = `<select id="editDeliveryStatusSelect" data-original="${displayStatus}" style="padding: 10px 15px; border-radius: 8px; border: 2px solid rgba(255,255,255,0.3); background: #2d2d44; color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; min-width: 180px;">`;
        for (const opt of statusOptions) {
            statusSelectHtml += `<option value="${opt.value}" ${displayStatus === opt.value ? 'selected' : ''} style="background: #2d2d44; color: #fff; padding: 10px;">${opt.label}</option>`;
        }
        statusSelectHtml += `</select>`;
        document.getElementById('editDeliveryStatus').innerHTML = statusSelectHtml;
        
        renderEditDeliveryFormForEnvio(0);
        
    } catch (error) {
        console.error('Erro ao carregar detalhes da entrega:', error);
        document.getElementById('editDeliveryItems').innerHTML = `<p style="color: #ff7675;">❌ ${error.message}</p>`;
    }
}

// Trocar qual envio está sendo editado (farm correto, não soma)
function switchEditDeliveryEnvio(envioIndex) {
    renderEditDeliveryFormForEnvio(envioIndex);
}

// Renderizar itens e screenshots da entrega selecionada (uma entrega por vez)
// Quantidades = apenas o que foi aprovado (entrega pendente mostra 0)
function renderEditDeliveryFormForEnvio(envioIndex) {
    const data = window.__currentEditDeliveryDetailsData;
    if (!data || !data.deliveriesWithItems || !data.deliveriesWithItems[envioIndex]) return;
    
    const { delivery, items: deliveryItems, screenshots } = data.deliveriesWithItems[envioIndex];
    const allMaterials = data.allMaterials || [];
    
    currentEditDeliveryId = delivery.id;
    
    renderExistingScreenshots(screenshots || [], currentEditDeliveryId);
    
    // Só considerar quantidades de entrega aprovada; pendente = 0
    const isApproved = (delivery.status || '').toLowerCase() === 'approved';
    const itemsToShow = isApproved ? deliveryItems : [];
    
    let itemsHtml = '';
    for (const mat of allMaterials) {
        const existingItem = itemsToShow.find(i => i.material_id === mat.id || i.material_id == mat.id);
        const currentAmount = existingItem ? (existingItem.amount || 0) : 0;
        
        itemsHtml += `
            <div class="edit-delivery-item" style="display: flex; align-items: center; gap: 15px; padding: 12px; background: rgba(255,255,255,0.05); border-radius: 8px; margin-bottom: 10px;">
                <span style="font-size: 24px;">${mat.icon || '📦'}</span>
                <div style="flex: 1;">
                    <div style="font-weight: 600; color: #fff;">${mat.name}</div>
                    <div style="font-size: 12px; color: #888;">Meta: ${mat.weekly_goal}</div>
                </div>
                <input type="number" 
                       id="editItem_${mat.id}" 
                       value="${currentAmount}" 
                       min="0" 
                       style="width: 100px; padding: 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.1); color: #fff; text-align: center; font-size: 16px;"
                       data-material-id="${mat.id}"
                       data-original="${currentAmount}"
                       data-name="${mat.name}">
            </div>
        `;
    }
    
    itemsHtml += `
        <button onclick="saveAllDeliveryItems()" 
                style="width: 100%; margin-top: 15px; background: #27ae60; color: white; border: none; padding: 12px 20px; border-radius: 8px; cursor: pointer; font-size: 16px; font-weight: 600;">
            💾 Salvar Alterações
        </button>
    `;
    
    document.getElementById('editDeliveryItems').innerHTML = itemsHtml;
}

// Salvar todas as alterações da entrega
async function saveAllDeliveryItems() {
    // Use the main delivery ID from the aggregated data
    const deliveryId = currentEditDeliveryId;
    if (!deliveryId) {
        showNotification('Erro: ID de entrega não encontrado', 'error');
        return;
    }
    
    // Coletar alterações de materiais
    const changes = [];
    document.querySelectorAll('[id^="editItem_"]').forEach(input => {
        const materialId = parseInt(input.dataset.materialId);
        const amount = parseInt(input.value) || 0;
        const originalAmount = parseInt(input.dataset.original) || 0;
        const materialName = input.dataset.name;
        
        if (amount !== originalAmount) {
            changes.push({ materialId, amount, originalAmount, materialName });
        }
    });
    
    // Verificar alteração de status
    const statusSelect = document.getElementById('editDeliveryStatusSelect');
    const newStatus = statusSelect ? statusSelect.value : null;
    const originalStatus = statusSelect ? statusSelect.dataset.original : null;
    const statusChanged = newStatus && newStatus !== originalStatus;
    
    // Verificar alteração de semana
    const weekSel = document.getElementById('editWeekSelect');
    let newWeekStart = currentEditWeekStart;
    let newWeekEnd = currentEditWeekEnd;
    if (weekSel && weekSel.value) {
        const parts = weekSel.value.split('|');
        newWeekStart = parts[0];
        newWeekEnd = parts[1];
    }
    const weekChanged = newWeekStart !== currentEditWeekStart || newWeekEnd !== currentEditWeekEnd;
    
    // Verificar se há novos screenshots para enviar
    const screenshotInput = document.getElementById('editDeliveryScreenshotInput');
    const hasNewScreenshots = screenshotInput && screenshotInput.files && screenshotInput.files.length > 0;
    
    if (changes.length === 0 && !statusChanged && !hasNewScreenshots && !weekChanged) {
        showNotification('Nenhuma alteração detectada', 'warning');
        return;
    }
    
    // Montar mensagem de confirmação
    let confirmMsg = '⚠️ CONFIRMAR ALTERAÇÕES:\n\n';
    
    if (weekChanged) {
        confirmMsg += `📅 SEMANA: ${currentEditWeekStart} ~ ${currentEditWeekEnd}\n       → ${newWeekStart} ~ ${newWeekEnd}\n\n`;
    }
    
    if (statusChanged) {
        const statusLabels = {
            'approved': '✅ Completo',
            'pending': '⏳ Aguardando',
            'in_progress': '⚡ Em Progresso',
            'not_delivered': '🚫 Não Entregou'
        };
        confirmMsg += `STATUS: ${statusLabels[originalStatus] || originalStatus} → ${statusLabels[newStatus] || newStatus}\n\n`;
    }
    
    if (changes.length > 0) {
        confirmMsg += 'MATERIAIS:\n';
        changes.forEach(c => {
            confirmMsg += `${c.materialName}: ${c.originalAmount} → ${c.amount}\n`;
        });
    }
    
    if (hasNewScreenshots) {
        confirmMsg += `\n📷 ${screenshotInput.files.length} novo(s) print(s) serão adicionados\n`;
    }
    
    confirmMsg += '\nDeseja salvar estas alterações?';
    
    if (!confirm(confirmMsg)) {
        return;
    }
    
    let successCount = 0;
    let errorCount = 0;
    
    // Salvar range de semana se alterado (fazer primeiro pois muda a semana dos deliveries)
    if (weekChanged) {
        try {
            const response = await fetch(`/api/admin/delivery/week-range`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    userId: currentEditUserId,
                    old_week_start: currentEditWeekStart,
                    old_week_end: currentEditWeekEnd,
                    new_week_start: newWeekStart,
                    new_week_end: newWeekEnd
                })
            });
            const data = await response.json();
            if (data.success) {
                currentEditWeekStart = newWeekStart;
                currentEditWeekEnd = newWeekEnd;
                const badge = document.getElementById('editWeekChangedBadge');
                if (badge) badge.style.display = 'none';
                successCount++;
            } else {
                showNotification(`❌ Erro ao alterar semana: ${escapeHtml(data.error)}`, 'error');
                errorCount++;
            }
        } catch (error) {
            console.error('Erro ao alterar semana:', error);
            errorCount++;
        }
    }
    
    // Salvar status se alterado (usa endpoint em lote — atualiza TODOS os deliveries da semana)
    if (statusChanged) {
        try {
            const response = await fetch(`/api/admin/delivery/batch-status`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    userId: currentEditUserId,
                    week_start: currentEditWeekStart,
                    week_end: currentEditWeekEnd,
                    status: newStatus
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                statusSelect.dataset.original = newStatus;
                successCount++;
            } else {
                showNotification(`❌ Erro ao salvar status: ${escapeHtml(data.error)}`, 'error');
                errorCount++;
            }
        } catch (error) {
            console.error('Erro ao salvar status:', error);
            errorCount++;
        }
    }
    
    // Salvar cada alteração de material
    for (const change of changes) {
        try {
            const response = await fetch(`/api/admin/delivery/${deliveryId}/item`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ materialId: change.materialId, amount: change.amount })
            });
            
            const data = await response.json();
            
            if (data.success) {
                // Atualizar o valor original no input
                const input = document.getElementById(`editItem_${change.materialId}`);
                if (input) input.dataset.original = change.amount;
                successCount++;
            } else {
                errorCount++;
            }
        } catch (error) {
            console.error('Erro ao salvar item:', error);
            errorCount++;
        }
    }
    
    // Enviar novos screenshots se houver
    if (hasNewScreenshots) {
        const formData = new FormData();
        for (const file of screenshotInput.files) {
            formData.append('screenshots', file);
        }
        
        try {
            const response = await fetch(`/api/admin/delivery/${deliveryId}/screenshots`, {
                method: 'POST',
                credentials: 'same-origin',
                body: formData
            });
            
            const data = await response.json();
            
            if (data.success) {
                successCount++;
                // Limpar preview e input
                document.getElementById('editDeliveryNewScreenshotsPreview').innerHTML = '';
                screenshotInput.value = '';
                // Recarregar screenshots existentes
                const detailsRes = await fetch(`/api/admin/delivery/${deliveryId}/details`, {
                    credentials: 'same-origin'
                });
                const detailsData = await detailsRes.json();
                if (detailsData.success) {
                    renderExistingScreenshots(detailsData.screenshots || [], deliveryId);
                }
            } else {
                errorCount++;
            }
        } catch (error) {
            console.error('Erro ao enviar screenshots:', error);
            errorCount++;
        }
    }
    
    if (errorCount === 0) {
        showNotification(`✅ Alterações salvas com sucesso!`, 'success');
        // Recarregar Status da Semana
        if (typeof loadWeeklyStatus === 'function') loadWeeklyStatus();
    } else {
        showNotification(`⚠️ ${successCount} salvas, ${errorCount} com erro`, 'warning');
    }
}

// Renderizar screenshots existentes no modal de edição
function renderExistingScreenshots(screenshots, deliveryId) {
    const container = document.getElementById('editDeliveryExistingScreenshots');
    
    if (!screenshots || screenshots.length === 0) {
        container.innerHTML = '<p style="color: #888; font-size: 14px;">Nenhum print enviado ainda</p>';
        return;
    }
    
    container.innerHTML = screenshots.map(s => `
        <div class="edit-screenshot-item" style="position: relative; width: 100px; height: 100px; border-radius: 8px; overflow: hidden; border: 2px solid rgba(255,255,255,0.2);">
            <img src="${s.screenshot_url}" style="width: 100%; height: 100%; object-fit: cover; cursor: pointer;" onclick="window.open('${s.screenshot_url}', '_blank')">
            <button onclick="removeScreenshot(${deliveryId}, ${s.id})" style="position: absolute; top: 2px; right: 2px; background: #e74c3c; color: white; border: none; width: 24px; height: 24px; border-radius: 50%; cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center;">&times;</button>
        </div>
    `).join('');
}

// Preview de novos screenshots antes de enviar
function previewNewScreenshots(input) {
    const preview = document.getElementById('editDeliveryNewScreenshotsPreview');
    
    if (!input.files || input.files.length === 0) {
        preview.innerHTML = '';
        return;
    }
    
    preview.innerHTML = '';
    
    for (const file of input.files) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const div = document.createElement('div');
            div.style.cssText = 'width: 80px; height: 80px; border-radius: 8px; overflow: hidden; border: 2px solid #27ae60;';
            div.innerHTML = `<img src="${e.target.result}" style="width: 100%; height: 100%; object-fit: cover;">`;
            preview.appendChild(div);
        };
        reader.readAsDataURL(file);
    }
}

// Remover screenshot existente
async function removeScreenshot(deliveryId, screenshotId) {
    if (!confirm('Tem certeza que deseja remover este print?')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/delivery/${deliveryId}/screenshot/${screenshotId}`, {
            method: 'DELETE',
            credentials: 'same-origin'
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('✅ Print removido!', 'success');
            
            // Recarregar screenshots existentes
            const detailsRes = await fetch(`/api/admin/delivery/${deliveryId}/details`, {
                credentials: 'same-origin'
            });
            const detailsData = await detailsRes.json();
            if (detailsData.success) {
                renderExistingScreenshots(detailsData.screenshots || [], deliveryId);
            }
        } else {
            throw new Error(data.error || 'Erro ao remover print');
        }
    } catch (error) {
        console.error('Erro ao remover screenshot:', error);
        showNotification(`❌ ${error.message}`, 'error');
    }
}

// Fechar modal de edição
function closeEditDeliveryModal() {
    document.getElementById('editDeliveryModal').style.display = 'none';
    currentEditDeliveryId = null;
    window.__currentEditDeliveryDetailsData = null;
    currentEditUserId = null;
    currentEditWeekStart = null;
    currentEditWeekEnd = null;
    currentEditMemberId = null;
    
    // Recarregar Status da Semana
    if (typeof loadWeeklyStatus === 'function') loadWeeklyStatus();
}

// Abrir modal para criar entrega a partir do Status da Semana (usa semana selecionada)
async function openCreateDeliveryFromStatus(memberId, memberName, tableStatus) {
    if (!currentUser) {
        showNotification('Você precisa estar logado para criar entregas', 'error');
        return;
    }
    if (!selectedWeek || !selectedWeek.start || !selectedWeek.end) {
        showNotification('Erro: Semana não selecionada', 'error');
        return;
    }
    openCreateDeliveryModal(memberId, selectedWeek.start, selectedWeek.end, tableStatus);
}

// Abrir modal para criar entrega manual
async function openCreateDeliveryModal(memberId, weekStart, weekEnd, tableStatus) {
    // Qualquer admin pode criar entregas
    if (!currentUser) {
        showNotification('Você precisa estar logado para criar entregas', 'error');
        return;
    }
    
    currentCreateMemberId = memberId;
    currentCreateWeekStart = weekStart;
    currentCreateWeekEnd = weekEnd;
    
    const modal = document.getElementById('createDeliveryModal');
    modal.style.display = 'flex';
    
    document.getElementById('createDeliveryItems').innerHTML = '<p class="loading">Carregando materiais...</p>';
    
    // Limpar screenshots preview
    document.getElementById('createDeliveryScreenshotsPreview').innerHTML = '';
    document.getElementById('createDeliveryScreenshotInput').value = '';
    
    try {
        // Buscar informações do membro
        const memberRes = await fetch(`/api/admin/member-extract/${memberId}`, {
            credentials: 'same-origin'
        });
        const memberData = await memberRes.json();
        
        if (!memberData.success) {
            throw new Error('Erro ao carregar membro');
        }
        
        document.getElementById('createDeliveryMemberName').textContent = memberData.member.name;
        document.getElementById('createDeliveryWeek').textContent = formatWeekLabel(weekStart, weekEnd);
        
        // Select para status (espelho da tabela: se veio "Não Entregou", já deixa selecionado)
        const statusOptions = [
            { value: 'approved', label: '✅ Completo', color: '#27ae60' },
            { value: 'in_progress', label: '⚡ Em Progresso', color: '#3498db' },
            { value: 'pending', label: '⏳ Aguardando', color: '#f39c12' },
            { value: 'not_delivered', label: '🚫 Não Entregou', color: '#e74c3c' }
        ];
        const defaultStatus = (tableStatus === 'missing') ? 'not_delivered' : 'approved';
        let statusSelectHtml = `<select id="createDeliveryStatus" style="padding: 10px 15px; border-radius: 8px; border: 2px solid rgba(255,255,255,0.3); background: #2d2d44; color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; min-width: 180px;">`;
        for (const opt of statusOptions) {
            const selected = (opt.value === defaultStatus) ? ' selected' : '';
            statusSelectHtml += `<option value="${opt.value}"${selected} style="background: #2d2d44; color: #fff; padding: 10px;">${opt.label}</option>`;
        }
        statusSelectHtml += `</select>`;
        document.getElementById('createDeliveryStatusContainer').innerHTML = statusSelectHtml;
        
        // Buscar materiais
        const matsRes = await fetch(`/api/admin/materials?memberId=${memberId}`, {
            credentials: 'same-origin'
        });
        const matsData = await matsRes.json();
        
        const materials = matsData.materials || matsData;
        
        let itemsHtml = '';
        for (const mat of materials.filter(m => m.active === 1)) {
            itemsHtml += `
                <div class="create-delivery-item" style="display: flex; align-items: center; gap: 15px; padding: 12px; background: rgba(255,255,255,0.05); border-radius: 8px; margin-bottom: 10px;">
                    <span style="font-size: 24px;">${mat.icon || '📦'}</span>
                    <div style="flex: 1;">
                        <div style="font-weight: 600; color: #fff;">${mat.name}</div>
                        <div style="font-size: 12px; color: #888;">Meta: ${mat.weekly_goal}</div>
                    </div>
                    <input type="number" 
                           id="createItem_${mat.id}" 
                           value="0" 
                           min="0" 
                           style="width: 100px; padding: 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.1); color: #fff; text-align: center; font-size: 16px;"
                           data-material-id="${mat.id}"
                           data-name="${mat.name}">
                </div>
            `;
        }
        
        // Adicionar botão de salvar (igual ao estilo do modal de editar)
        itemsHtml += `
            <button onclick="submitCreateDelivery()" 
                    style="width: 100%; margin-top: 15px; background: #9b59b6; color: white; border: none; padding: 12px 20px; border-radius: 8px; cursor: pointer; font-size: 16px; font-weight: 600;">
                💾 Criar Entrega
            </button>
        `;
        
        document.getElementById('createDeliveryItems').innerHTML = itemsHtml;
        
    } catch (error) {
        console.error('Erro ao preparar criação:', error);
        document.getElementById('createDeliveryItems').innerHTML = `<p style="color: #ff7675;">❌ ${error.message}</p>`;
    }
}

// Preview de screenshots para criar entrega
function previewCreateScreenshots(input) {
    const preview = document.getElementById('createDeliveryScreenshotsPreview');
    
    if (!input.files || input.files.length === 0) {
        preview.innerHTML = '';
        return;
    }
    
    preview.innerHTML = '';
    
    for (const file of input.files) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const div = document.createElement('div');
            div.style.cssText = 'width: 80px; height: 80px; border-radius: 8px; overflow: hidden; border: 2px solid #27ae60;';
            div.innerHTML = `<img src="${e.target.result}" style="width: 100%; height: 100%; object-fit: cover;">`;
            preview.appendChild(div);
        };
        reader.readAsDataURL(file);
    }
}

// Submeter criação de entrega manual
async function submitCreateDelivery() {
    if (!currentCreateMemberId || !currentCreateWeekStart || !currentCreateWeekEnd) {
        showNotification('Dados incompletos', 'error');
        return;
    }
    
    // Coletar itens
    const items = [];
    document.querySelectorAll('[id^="createItem_"]').forEach(input => {
        const materialId = parseInt(input.dataset.materialId);
        const amount = parseInt(input.value) || 0;
        if (amount > 0) {
            items.push({ materialId, amount });
        }
    });
    
    const status = document.getElementById('createDeliveryStatus').value;
    if (status !== 'not_delivered' && items.length === 0) {
        showNotification('Adicione pelo menos um material', 'warning');
        return;
    }
    const screenshotInput = document.getElementById('createDeliveryScreenshotInput');
    
    try {
        // Criar a entrega primeiro
        const response = await fetch('/api/admin/delivery/create-manual', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
                userId: currentCreateMemberId,
                weekStart: currentCreateWeekStart,
                weekEnd: currentCreateWeekEnd,
                items,
                status
            })
        });
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Erro ao criar entrega');
        }
        
        // Se há screenshots selecionados, enviar após criar a entrega
        if (screenshotInput.files && screenshotInput.files.length > 0 && data.deliveryId) {
            const formData = new FormData();
            for (const file of screenshotInput.files) {
                formData.append('screenshots', file);
            }
            
            try {
                const screenshotRes = await fetch(`/api/admin/delivery/${data.deliveryId}/screenshots`, {
                    method: 'POST',
                    credentials: 'same-origin',
                    body: formData
                });
                
                const screenshotData = await screenshotRes.json();
                if (screenshotData.success) {
                    showNotification(`✅ Entrega criada com ${screenshotData.screenshots.length} print(s)!`, 'success');
                } else {
                    showNotification('Entrega criada, mas erro ao enviar prints', 'warning');
                }
            } catch (e) {
                console.error('Erro ao enviar screenshots:', e);
                showNotification('Entrega criada, mas erro ao enviar prints', 'warning');
            }
        } else {
            showNotification('✅ Entrega criada com sucesso!', 'success');
        }
        
        closeCreateDeliveryModal();
        
        // Recarregar Status da Semana
        if (typeof loadWeeklyStatus === 'function') loadWeeklyStatus();
        
    } catch (error) {
        console.error('Erro ao criar entrega:', error);
        showNotification('Erro: ' + error.message, 'error');
    }
}

// Fechar modal de criação
function closeCreateDeliveryModal() {
    document.getElementById('createDeliveryModal').style.display = 'none';
    currentCreateMemberId = null;
    currentCreateWeekStart = null;
    currentCreateWeekEnd = null;
}

// ==================== FIM EDIÇÃO DE ENTREGAS ====================

// Inicializa
(async function() {
    await loadRoleNames(); // Carregar nomes dos grupos do banco primeiro
    checkAuth();
})();
