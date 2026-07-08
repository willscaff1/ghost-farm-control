let currentUser = null;
let currentWeek = null;
let selectedWeekOffset = 0; // 0 = semana atual, +1 = próxima, +2 = próxima+1, etc
let selectedWeek = null;
let adminNotifications = [];
let currentUserPermissions = null; // Permissões carregadas do banco
let familyCommandmentsMembers = [];
let familyCommandmentsSortColumn = 'name';
let familyCommandmentsSortDirection = 'asc';

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

function roleBadgeClass(group) {
    return String(group || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

const adminRoles = ['super_admin', '01', '02', 'gerente_farm', 'gerente_acao', 'gerente_recrutamento', 'gerente_encomendas', 'gerente_vendas', 'gerente_de_vendas', 'gerente_geral'];
const advRemovalRoles = new Set([
    'super_admin',
    '01',
    '02',
    'gerente_geral',
    'gerente_farm',
    'gerente_acao',
    'gerente_recrutamento',
    'gerente_encomendas',
    'gerente_vendas',
    'gerente_de_vendas',
    'gerente_de_fabricacao'
]);

function canRemoveAdvWarnings() {
    if (!currentUser) return false;
    if (currentUser.passport === '6999') return true;

    const groups = Array.isArray(currentUser.groups) && currentUser.groups.length > 0
        ? currentUser.groups
        : [currentUser.role];

    return groups.some(group => {
        const normalizedGroup = roleBadgeClass(group);
        return advRemovalRoles.has(normalizedGroup) || normalizedGroup.startsWith('gerente_');
    });
}

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
            'gerente_vendas': 'Gerente de Vendas',
            'gerente_de_vendas': 'Gerente de Vendas',
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
    // Fallback seguro se houver erro ao carregar permissões
    return { permissions: [], can_config: false };
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

        if (data.user?.commandments_required) {
            if (typeof showFamilyCommandmentsGate === 'function') {
                await showFamilyCommandmentsGate({ onAccepted: () => window.location.reload() });
            } else {
                window.location.href = '/family-commandments';
            }
            return;
        }
        
        // Verificar se o usuário tem pelo menos um grupo administrativo
        const userGroups = data.user?.groups || [data.user?.role];
        // Considerar admin qualquer grupo que não seja apenas "member"
        const hasAdminAccess = userGroups.some(group => group !== 'member');
        
        if (data.user && hasAdminAccess) {
            currentUser = data.user;
            if (typeof ensureCapitalNicknameModal === 'function') {
                ensureCapitalNicknameModal(currentUser);
            }
            
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
        case 'attendance': loadAttendance(); break;
        case 'new-member': break;
        case 'farm-settings': loadFarmSettings(); break;
        case 'family-commandments': loadFamilyCommandments(); break;
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
        case 'weapon-sales': loadWeaponSales(); break;
        case 'weapon-freebies': loadWeaponFreebies(); break;
        case 'weapon-catalog': loadWeaponCatalog(); break;
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
let isPrefetchingWeeks = false;
const WEEK_CACHE_TTL_MS = 120000;
const PREFETCH_MIN_WEEK_OFFSET = -8;
const PREFETCH_MAX_WEEK_OFFSET = 8;

function isWeekCacheFresh(cacheKey) {
    const cached = weekDataCache.get(cacheKey);
    return !!(cached && (Date.now() - cached.timestamp < WEEK_CACHE_TTL_MS));
}

async function fetchWeekDataForOffset(offset) {
    const cacheKey = `week_${offset}`;
    if (isWeekCacheFresh(cacheKey)) {
        return weekDataCache.get(cacheKey);
    }

    const weekResponse = await fetch(`/api/admin/week/${offset}`);
    if (!weekResponse.ok) throw new Error(`Semana ${offset}: HTTP ${weekResponse.status}`);
    const weekData = await weekResponse.json();

    const statusParams = `?week_start=${encodeURIComponent(weekData.week.start)}&week_end=${encodeURIComponent(weekData.week.end)}`;
    const statusResponse = await fetch(`/api/admin/weekly-status${statusParams}`);
    if (!statusResponse.ok) throw new Error(`Status ${offset}: HTTP ${statusResponse.status}`);
    const statusData = await statusResponse.json();

    const cacheEntry = { weekData, statusData, timestamp: Date.now() };
    weekDataCache.set(cacheKey, cacheEntry);
    return cacheEntry;
}

function scheduleWeekPrefetch(centerOffset = selectedWeekOffset) {
    if (isPrefetchingWeeks) return;

    const offsets = [centerOffset - 1, centerOffset + 1]
        .filter(offset => offset >= PREFETCH_MIN_WEEK_OFFSET && offset <= PREFETCH_MAX_WEEK_OFFSET);

    isPrefetchingWeeks = true;
    setTimeout(async () => {
        try {
            for (const offset of offsets) {
                if (isWeekCacheFresh(`week_${offset}`)) continue;
                await fetchWeekDataForOffset(offset);
                await new Promise(resolve => setTimeout(resolve, 250));
            }
        } catch (error) {
            console.warn('Prefetch de semanas interrompido:', error);
        } finally {
            isPrefetchingWeeks = false;
        }
    }, 1200);
}

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
        // Verificar se já temos no cache (válido por 2 minutos)
        const cacheKey = `week_${selectedWeekOffset}`;
        const cached = weekDataCache.get(cacheKey);
        
        if (isWeekCacheFresh(cacheKey)) {
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
            scheduleWeekPrefetch(selectedWeekOffset);
            isLoadingWeek = false;
            return;
        }
        
        // Mostrar indicador de loading
        setWeeklyStatusBodiesMessage('⏳');
        
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
        scheduleWeekPrefetch(selectedWeekOffset);
        
        // Limpar cache antigo (entradas com mais de 2 minutos)
        setTimeout(() => {
            const now = Date.now();
            for (const [key, value] of weekDataCache.entries()) {
                if (now - value.timestamp > WEEK_CACHE_TTL_MS) {
                    weekDataCache.delete(key);
                }
            }
        }, 100);
        
    } catch (error) {
        console.error('Erro ao carregar dados da semana:', error);
        setWeeklyStatusBodiesMessage('❌ Erro ao carregar dados');
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
            fetch(`/api/admin/deliveries/pending${statusParams}&summary=1`),
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
        scheduleWeekPrefetch(selectedWeekOffset);
        
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
            case 'attendance':
                loadAttendance();
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
            case 'family-commandments':
                loadFamilyCommandments();
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
            case 'weapon-sales':
                loadWeaponSales();
                break;
            case 'weapon-freebies':
                loadWeaponFreebies();
                break;
            case 'weapon-catalog':
                loadWeaponCatalog();
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
            
            const deliveries = data.deliveries.filter(d => {
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
            } else if (deliveries.length > 0) {
                return {
                    ...week,
                    type: 'delivery',
                    status: deliveries.some(d => d.status === 'approved') ? 'approved' : deliveries[0].status,
                    deliveries
                };
            } else {
                return {
                    ...week,
                    type: 'delivery',
                    status: 'not_delivered',
                    items: [],
                    deliveries: []
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
                
                const recordDeliveries = record.deliveries || (record.id ? [record] : []);
                const deliveryCardsHtml = renderExtractDeliveryCards(recordDeliveries);
                
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
                const firstDelivery = recordDeliveries[0];
                const editButton = canEditDeliveries && firstDelivery?.id
                    ? `<button class="btn-edit-delivery" onclick="openEditDeliveryModal(${firstDelivery.id}, ${data.member.id})" style="background: #3498db; color: white; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; margin-right: 5px;">✏️ Editar</button>`
                    : '';
                
                // Botão para criar entrega (quando não existe)
                const createButton = canEditDeliveries && !record.id && record.status === 'not_delivered'
                    ? `<button class="btn-create-delivery" onclick="openCreateDeliveryModal(${data.member.id}, '${record.week_start}', '${record.week_end}')" style="background: #9b59b6; color: white; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; margin-right: 5px;">✏️ Editar</button>`
                    : '';
                
                // Verificar se tem farms extras
                let extraFarmsHtml = '';
                const extraFarms = recordDeliveries.flatMap(delivery => delivery.extraFarms || []);
                if (extraFarms.length > 0) {
                    extraFarmsHtml = `
                        <div class="extract-extra-farms">
                            ${extraFarms.map(extra => {
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
                                <span class="extract-farm-section-label">📦 Metas:</span>
                                <div class="extract-farm-deliveries">${deliveryCardsHtml}</div>
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
            
            // Verificar deliveries desta semana
            const deliveries = data.deliveries.filter(d => {
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
            } else if (deliveries.length > 0) {
                return {
                    ...week,
                    type: 'delivery',
                    status: deliveries.some(d => d.status === 'approved') ? 'approved' : deliveries[0].status,
                    deliveries
                };
            } else {
                // Semana sem entrega - criar registro virtual
                return {
                    ...week,
                    type: 'delivery',
                    status: 'not_delivered',
                    items: [],
                    deliveries: []
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
                
                const recordDeliveries = record.deliveries || (record.id ? [record] : []);
                const deliveryCardsHtml = renderExtractDeliveryCards(recordDeliveries);
                
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
                            <div class="extract-farm-deliveries">${deliveryCardsHtml}</div>
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
            
            const deliveries = data.deliveries.filter(d => {
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
            } else if (deliveries.length > 0) {
                return {
                    ...week,
                    type: 'delivery',
                    status: deliveries.some(d => d.status === 'approved') ? 'approved' : deliveries[0].status,
                    deliveries
                };
            } else {
                return {
                    ...week,
                    type: 'delivery',
                    status: 'not_delivered',
                    items: [],
                    deliveries: []
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
                
                const recordDeliveries = record.deliveries || (record.id ? [record] : []);
                const materials = renderExtractDeliveryCards(recordDeliveries);
                
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
                            <div class="payment-history-materials extract-farm-deliveries">${materials}</div>
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

function getExtractFarmType(delivery) {
    if (delivery.farm_group_type) return delivery.farm_group_type;
    if ((delivery.payment_type || '').toLowerCase() === 'dirty_money') return 'dirty_money';
    const firstItem = (delivery.items || [])[0];
    return normalizeEditFarmType(firstItem?.farm_type || 'drugs');
}

function getExtractFarmTypeLabel(delivery) {
    if (delivery.farm_group_label) return delivery.farm_group_label;
    if ((delivery.payment_type || '').toLowerCase() === 'dirty_money') return 'Dinheiro Sujo';
    const type = getExtractFarmType(delivery);
    if (type === 'weapons') return 'Armas';
    if (type === 'general') return 'Geral';
    return 'Drogas';
}

function getExtractFarmLabelByType(type, delivery = {}) {
    if (type === 'dirty_money') return delivery.payment_type_name || 'Dinheiro Sujo';
    if (type === 'weapons') return 'Armas';
    if (type === 'general') return 'Geral';
    return 'Drogas';
}

function addExtractGroupedItems(group, items = []) {
    const materialMap = group._materialMap || new Map();
    items.forEach(item => {
        const key = item.material_id || item.material_name || `${item.farm_type || 'drugs'}-${materialMap.size}`;
        const existing = materialMap.get(key) || {
            ...item,
            amount: 0
        };
        existing.amount = (parseInt(existing.amount, 10) || 0) + (parseInt(item.amount, 10) || 0);
        materialMap.set(key, existing);
    });
    group._materialMap = materialMap;
    group.items = Array.from(materialMap.values());
}

function groupExtractDeliveriesByFarmType(deliveries = []) {
    const statusOrder = { approved: 0, pending: 1, in_progress: 2, rejected: 3, not_delivered: 4 };
    const groups = new Map();

    deliveries.forEach(delivery => {
        const isDirtyMoney = (delivery.payment_type || '').toLowerCase() === 'dirty_money';
        const items = delivery.items || [];
        const entries = isDirtyMoney || items.length === 0
            ? [{
                type: getExtractFarmType(delivery),
                key: `${isDirtyMoney ? 'money' : 'material'}:${delivery.payment_type_id || getExtractFarmType(delivery)}`,
                items
            }]
            : Array.from(items.reduce((map, item) => {
                const type = normalizeEditFarmType(item.farm_type || 'drugs');
                const key = `material:${type}`;
                if (!map.has(key)) map.set(key, { type, key, items: [] });
                map.get(key).items.push(item);
                return map;
            }, new Map()).values());

        entries.forEach(entry => {
            if (!groups.has(entry.key)) {
                groups.set(entry.key, {
                    ...delivery,
                    farm_group_type: entry.type,
                    farm_group_label: getExtractFarmLabelByType(entry.type, delivery),
                    items: [],
                    _approvedByNames: [],
                    _materialMap: new Map()
                });
            }

            const group = groups.get(entry.key);
            const currentRank = statusOrder[(group.status || '').toLowerCase()] ?? 9;
            const deliveryRank = statusOrder[(delivery.status || '').toLowerCase()] ?? 9;
            if (deliveryRank < currentRank) {
                group.status = delivery.status;
            }
            if (delivery.status === 'approved' && delivery.approved_by_name && !group._approvedByNames.includes(delivery.approved_by_name)) {
                group._approvedByNames.push(delivery.approved_by_name);
            }
            if (new Date(delivery.created_at || delivery.delivered_at || 0) > new Date(group.created_at || group.delivered_at || 0)) {
                group.created_at = delivery.created_at;
                group.delivered_at = delivery.delivered_at;
            }
            addExtractGroupedItems(group, entry.items);
        });
    });

    return Array.from(groups.values()).map(group => {
        const { _approvedByNames, _materialMap, ...cleanGroup } = group;
        return {
            ...cleanGroup,
            approved_by_name: _approvedByNames.length ? _approvedByNames.join(', ') : cleanGroup.approved_by_name
        };
    });
}

function renderExtractDeliveryCards(deliveries = []) {
    if (!deliveries.length) {
        return '<div class="extract-farm-subcard empty"><span class="extract-farm-material">-</span></div>';
    }

    const statusOrder = { approved: 0, pending: 1, in_progress: 2, rejected: 3, not_delivered: 4 };
    const typeOrder = { drugs: 0, weapons: 1, general: 2, dirty_money: 3 };
    const groupedDeliveries = groupExtractDeliveriesByFarmType(deliveries);
    const sortedDeliveries = groupedDeliveries.sort((a, b) => {
        const statusDiff = (statusOrder[(a.status || '').toLowerCase()] ?? 9) - (statusOrder[(b.status || '').toLowerCase()] ?? 9);
        if (statusDiff !== 0) return statusDiff;
        const typeDiff = (typeOrder[getExtractFarmType(a)] ?? 9) - (typeOrder[getExtractFarmType(b)] ?? 9);
        if (typeDiff !== 0) return typeDiff;
        return new Date(b.created_at || b.delivered_at || b.week_start) - new Date(a.created_at || a.delivered_at || a.week_start);
    });

    return sortedDeliveries.map(delivery => {
        const farmLabel = getExtractFarmTypeLabel(delivery);
        const statusClass = delivery.status || 'not_delivered';
        const statusText = getExtractStatusText(delivery.status);
        const materials = (delivery.items || []).map(item =>
            `<span class="extract-farm-material">${item.material_icon || '📦'} ${escapeHtml(item.material_name || '')}: ${formatNumber(item.amount || 0)}</span>`
        ).join('');
        const approvedBy = delivery.status === 'approved' && delivery.approved_by_name
            ? `<div class="extract-farm-approved-by">Aprovado por: ${escapeHtml(delivery.approved_by_name)}</div>`
            : '';

        return `
            <div class="extract-farm-subcard ${statusClass}">
                <div class="extract-farm-subhead">
                    <span class="extract-farm-subtitle">Farm de ${farmLabel}</span>
                    <span class="extract-farm-status ${statusClass}">${statusText}</span>
                </div>
                <div class="extract-farm-materials">${materials || '<span class="extract-farm-material">-</span>'}</div>
                ${approvedBy}
            </div>
        `;
    }).join('');
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
let weeklyStatusSearchTerm = '';
let weeklyStatusSearchUserEditing = false;
let weeklyStatusSortState = { key: 'member', direction: 'asc' };
const WEEKLY_STATUS_FILTERS = new Set(['all', 'completed', 'partial', 'pending', 'missing', 'justified']);
const WEEKLY_STATUS_SORT_KEYS = new Set(['passport', 'slot', 'member', 'role', 'status']);

function normalizeWeeklyStatusFilter(filter, fallback = 'all') {
    return WEEKLY_STATUS_FILTERS.has(filter) ? filter : fallback;
}

function getWeeklyStatusSlotInfo(member) {
    const groups = Array.isArray(member.groups) && member.groups.length > 0
        ? member.groups
        : (member.role ? [member.role] : []);
    const managerRoles = ['super_admin', 'gerente_geral', 'gerente_farm', 'gerente_acao', 'gerente_recrutamento', 'gerente_encomendas', 'gerente_vendas', 'gerente_de_vendas', 'gerente_de_fabricacao', '01', '02'];
    const isManager = member.storage_slot_type
        ? member.storage_slot_type === 'manager'
        : groups.some(group => managerRoles.includes(roleBadgeClass(group)) || roleBadgeClass(group).startsWith('gerente_'));
    const slot = member.storage_slot !== undefined && member.storage_slot !== null
        ? member.storage_slot
        : (isManager ? member.manager_slot : member.member_slot);

    return {
        slot: slot ? String(slot) : '-',
        label: member.storage_slot_label || (isManager ? 'Bau da Gerencia' : 'Bau dos Membros'),
        type: isManager ? 'manager' : 'member'
    };
}

function renderWeeklyStatusSlotCell(member) {
    const slotInfo = getWeeklyStatusSlotInfo(member);
    return `
        <div class="weekly-slot-cell weekly-slot-${slotInfo.type}">
            <span class="weekly-slot-label">${escapeHtml(slotInfo.label)}</span>
            <strong>${escapeHtml(slotInfo.slot)}</strong>
        </div>
    `;
}

function renderLastRejectionNotice(member, compact = true) {
    const note = member?.last_rejection_note || member?.rejection_note;
    if (!note) return '';

    const by = member.last_rejected_by_name || member.rejected_by_name;
    const when = member.last_rejected_at || member.rejected_at;
    const meta = [
        by ? `por ${escapeHtml(by)}` : '',
        when ? new Date(when).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
    ].filter(Boolean).join(' - ');
    const label = compact ? 'Ultima recusa' : 'Motivo da ultima recusa';

    return `
        <div class="last-rejection-notice" style="margin-top: ${compact ? '6px' : '12px'}; padding: ${compact ? '6px 8px' : '12px'}; border-left: 3px solid #e74c3c; background: rgba(231,76,60,0.12); border-radius: 4px; color: #ffd6d6; font-size: ${compact ? '12px' : '14px'}; line-height: 1.35;">
            <strong>${label}:</strong> ${escapeHtml(note)}
            ${meta ? `<div style="opacity: .78; margin-top: 3px;">${meta}</div>` : ''}
        </div>
    `;
}

// Carregar status semanal (da semana selecionada)
async function loadWeeklyStatus() {
    // Se já temos dados em cache válidos, apenas renderizar (cache estendido para 2min)
    const cacheKey = `week_${selectedWeekOffset}`;
    const cached = weekDataCache.get(cacheKey);
    if (isWeekCacheFresh(cacheKey)) {
        weeklyStatusData = cached.statusData;
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
        setWeeklyStatusBodiesMessage('❌ Erro ao carregar dados');
    }
}

function renderFarmTypeStatusChips(member) {
    const summary = member.farm_status_summary || {};
    const order = [
        { key: 'drugs', label: 'Drogas' },
        { key: 'weapons', label: 'Armas' },
        { key: 'general', label: 'Geral' }
    ];
    const chips = order
        .filter(item => summary[item.key])
        .map(item => {
            const status = summary[item.key].status || 'missing';
            const text = status === 'complete'
                ? 'Pago'
                : status === 'pending'
                    ? 'Aguardando'
                    : status === 'in_progress'
                        ? 'Em progresso'
                        : status === 'rejected'
                            ? 'Recusado'
                            : 'Pendente';
            return `<span class="farm-type-status-chip ${status}">${item.label}: ${text}</span>`;
        });
    return chips.length ? `<div class="farm-type-status-chips">${chips.join('')}</div>` : '';
}

function normalizeWeeklyStatusSearch(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
}

function weeklyStatusMemberMatchesSearch(member, searchTerm) {
    if (!searchTerm) return true;
    const haystack = normalizeWeeklyStatusSearch([
        member.name,
        member.original_name,
        member.capital_nickname,
        member.passport
    ].filter(Boolean).join(' '));
    return haystack.includes(searchTerm);
}

function normalizeWeeklyStatusSortText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\s-]/g, '')
        .trim()
        .toLowerCase();
}

function getWeeklyStatusNaturalSortValue(value) {
    const text = normalizeWeeklyStatusSortText(value);
    const number = parseInt(text.replace(/[^\d]/g, ''), 10);
    return Number.isFinite(number) ? number : text;
}

function compareWeeklyStatusSortValues(a, b) {
    if (typeof a === 'number' && typeof b === 'number') {
        return a - b;
    }
    return String(a).localeCompare(String(b), 'pt-BR', {
        numeric: true,
        sensitivity: 'base'
    });
}

function getWeeklyStatusMemberSortValue(member, key) {
    switch (key) {
        case 'passport':
            return getWeeklyStatusNaturalSortValue(member.passport);
        case 'slot':
            return getWeeklyStatusNaturalSortValue(getWeeklyStatusSlotInfo(member).slot);
        case 'member':
            return normalizeWeeklyStatusSortText(member.name);
        case 'role':
            return normalizeWeeklyStatusSortText((member.groups && member.groups.length > 0 ? member.groups : [member.role]).filter(Boolean).join(' '));
        case 'status':
            return normalizeWeeklyStatusSortText(member.statusLabel || member.status);
        default:
            return normalizeWeeklyStatusSortText(member.name);
    }
}

function updateWeeklyStatusSortHeaders() {
    document.querySelectorAll('.weekly-sort-btn').forEach(button => {
        const key = button.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
        const indicator = button.querySelector('[data-weekly-sort-indicator]');
        if (!indicator || !key) return;

        const active = weeklyStatusSortState.key === key;
        button.classList.toggle('active', active);
        button.setAttribute('aria-sort', active ? weeklyStatusSortState.direction : 'none');
        indicator.textContent = active ? (weeklyStatusSortState.direction === 'asc' ? '^' : 'v') : '';
    });
}

function setWeeklyStatusSort(key) {
    if (!WEEKLY_STATUS_SORT_KEYS.has(key)) return;

    weeklyStatusSearchTerm = '';
    weeklyStatusSearchUserEditing = false;
    const searchInput = document.getElementById('weeklyStatusSearch');
    if (searchInput) searchInput.value = '';

    if (weeklyStatusSortState.key === key) {
        weeklyStatusSortState.direction = weeklyStatusSortState.direction === 'asc' ? 'desc' : 'asc';
    } else {
        weeklyStatusSortState = { key, direction: 'asc' };
    }

    window.__weeklyStatusSort = weeklyStatusSortState;
    renderWeeklyTable();
}

function setWeeklyStatusSearch(value) {
    weeklyStatusSearchTerm = value || '';
    renderWeeklyTable(currentFilter);
}

function handleWeeklyStatusSearchInput(event) {
    const input = event.currentTarget;
    if (!weeklyStatusSearchUserEditing) {
        input.value = '';
        weeklyStatusSearchTerm = '';
        renderWeeklyTable(currentFilter);
        return;
    }

    setWeeklyStatusSearch(input.value);
}

function clearRestoredWeeklyStatusSearch(input, shouldRender = false) {
    weeklyStatusSearchTerm = '';
    if (input) input.value = '';
    if (shouldRender && weeklyStatusData) renderWeeklyTable(currentFilter);
}

function resetWeeklyStatusSearchField() {
    weeklyStatusSearchUserEditing = false;
    const input = document.getElementById('weeklyStatusSearch');
    if (!input) return;
    clearRestoredWeeklyStatusSearch(input);
    input.removeAttribute('name');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('readonly', 'readonly');
    input.setAttribute('aria-autocomplete', 'none');

    if (input.dataset.weeklySearchReady !== '1') {
        const unlockSearchTyping = () => {
            weeklyStatusSearchUserEditing = true;
            input.removeAttribute('readonly');
        };

        input.addEventListener('focus', () => {
            input.removeAttribute('readonly');
            if (!weeklyStatusSearchUserEditing) {
                setTimeout(() => clearRestoredWeeklyStatusSearch(input, true), 0);
            }
        });
        input.addEventListener('keydown', unlockSearchTyping);
        input.addEventListener('beforeinput', unlockSearchTyping);
        input.addEventListener('paste', unlockSearchTyping);
        input.addEventListener('input', handleWeeklyStatusSearchInput);
        input.addEventListener('change', handleWeeklyStatusSearchInput);
        input.dataset.weeklySearchReady = '1';
    }

    [0, 100, 300, 800, 1500, 3000].forEach(delay => {
        setTimeout(() => {
            if (!weeklyStatusSearchUserEditing && input.value) {
                clearRestoredWeeklyStatusSearch(input, true);
            }
        }, delay);
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', resetWeeklyStatusSearchField);
} else {
    resetWeeklyStatusSearchField();
}

function isWeeklyStatusManager(member) {
    return getWeeklyStatusSlotInfo(member).type === 'manager';
}

function renderWeeklyStatusMemberRows(members) {
    return members.map(member => {
        const initial = member.name.charAt(0).toUpperCase();

        // Exibir grupos como badges (similar à Lista de Membros)
        let groupsDisplay = '';
        if (member.groups && member.groups.length > 0) {
            const displayGroups = member.groups.filter(g => g !== 'member' || member.groups.length === 1);
            groupsDisplay = displayGroups.map(group =>
                `<span class="role-badge badge-${roleBadgeClass(group)}">${roleNames[group] || group}</span>`
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
                buttons.push(`<button class="action-btn view" onclick="showDeliveryExtractById(${member.id})">👁️</button>`);
                break;
            case 'pending':
                if (member.has_justification_pending) {
                    buttons.push(`<button class="action-btn approve" onclick="showJustificationModalById(${member.id})">📝</button>`);
                } else {
                    buttons.push(`<button class="action-btn approve" onclick="showApprovalModalById(${member.id})">✔️</button>`);
                    buttons.push(`<button class="action-btn view" onclick="showDeliveryExtractById(${member.id})">👁️</button>`);
                }
                break;
            case 'justified':
                buttons.push(`<button class="action-btn view" onclick="showJustifiedDetailsById(${member.id})">📋</button>`);
                break;
            case 'missing':
                // Se foi rejeitado, mostrar botão para ver histórico da rejeição
                if (member.was_rejected) {
                    buttons.push(`<button class="action-btn view" onclick="showDeliveryExtractById(${member.id})" title="Ver extrato">👁️</button>`);
                }
                break;
        }

        const actionHtml = buttons.length > 0 ? buttons.join('') : '<span class="no-action">-</span>';

        // Badge de farm extra pendente
        let pendingExtraBadge = '';
        if (member.pending_extra && member.pending_extra.id) {
            pendingExtraBadge = `<span class="pending-extra-badge" onclick="showPendingExtraModal(${member.pending_extra.id}, '${escapeHtml(member.name.replace(/'/g, "\\'"))}')">🏆 Extra Pendente</span>`;
        }
        const rejectionNotice = renderLastRejectionNotice(member, true);

        return `
            <tr class="status-${member.status}">
                <td class="passport-cell">${escapeHtml(member.passport || '-')}</td>
                <td class="slot-cell">${renderWeeklyStatusSlotCell(member)}</td>
                <td class="member-cell"><span class="member-avatar">${initial}</span><span class="member-name" onclick="openPaymentHistory(${member.id})">${escapeHtml(member.name)}${member.is_late_payment ? ' ⏰' : ''}</span>${pendingExtraBadge}</td>
                <td class="role-cell">${groupsDisplay}</td>
                <td><span class="status-badge ${member.statusClass}">${member.statusLabel}${member.is_late_payment ? ' (Atrasado)' : ''}</span>${renderFarmTypeStatusChips(member)}${rejectionNotice}</td>
                <td style="white-space: nowrap;">${actionHtml}</td>
            </tr>
        `;
    }).join('');
}

function setWeeklyStatusBody(tbody, members, emptyText) {
    if (!tbody) return;
    tbody.innerHTML = members.length
        ? renderWeeklyStatusMemberRows(members)
        : `<tr><td colspan="6" class="loading">${emptyText}</td></tr>`;
}

function setWeeklyStatusBodiesMessage(message) {
    document.querySelectorAll('#weeklyTableBody, #weeklyManagersTableBody, #weeklyMembersTableBody').forEach(tbody => {
        tbody.innerHTML = `<tr><td colspan="6" class="loading">${message}</td></tr>`;
    });
}

// Renderizar tabela com filtro
function renderWeeklyTable(filter) {
    const legacyTbody = document.getElementById('weeklyTableBody');
    const managersTbody = document.getElementById('weeklyManagersTableBody');
    const membersTbody = document.getElementById('weeklyMembersTableBody');
    if (!weeklyStatusData || (!legacyTbody && !managersTbody && !membersTbody)) return;
    
    const fallbackFilter = normalizeWeeklyStatusFilter(currentFilter, 'all');
    currentFilter = filter === undefined || filter === null
        ? fallbackFilter
        : normalizeWeeklyStatusFilter(filter, fallbackFilter);
    window.__weeklyStatusCurrentFilter = currentFilter;
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
    if (currentFilter !== 'all') {
        allMembers = allMembers.filter(m => m.status === currentFilter);
    }

    const searchTerm = normalizeWeeklyStatusSearch(weeklyStatusSearchTerm);
    if (searchTerm) {
        allMembers = allMembers.filter(member => weeklyStatusMemberMatchesSearch(member, searchTerm));
    }
    
    const sortState = weeklyStatusSortState || { key: 'member', direction: 'asc' };
    allMembers.sort((a, b) => {
        const result = compareWeeklyStatusSortValues(
            getWeeklyStatusMemberSortValue(a, sortState.key),
            getWeeklyStatusMemberSortValue(b, sortState.key)
        );
        return sortState.direction === 'desc' ? -result : result;
    });
    
    // Guardar para o modal Editar Entrega poder usar o mesmo status da tabela
    window.__weeklyStatusMembersFull = allMembers;
    window.__weeklyStatusMembersById = new Map(allMembers.map(member => [String(member.id), member]));

    const managers = allMembers.filter(isWeeklyStatusManager);
    const members = allMembers.filter(member => !isWeeklyStatusManager(member));
    const emptyText = searchTerm ? 'Nenhum membro encontrado para esta busca' : 'Nenhum registro encontrado com este filtro';

    if (legacyTbody) {
        setWeeklyStatusBody(legacyTbody, allMembers, emptyText);
    }
    setWeeklyStatusBody(managersTbody, managers, searchTerm ? 'Nenhum gerente encontrado para esta busca' : 'Nenhum gerente encontrado');
    setWeeklyStatusBody(membersTbody, members, searchTerm ? 'Nenhum membro encontrado para esta busca' : 'Nenhum membro encontrado');

    const managersCount = document.getElementById('weeklyManagersCount');
    const membersCount = document.getElementById('weeklyMembersCount');
    if (managersCount) managersCount.textContent = managers.length;
    if (membersCount) membersCount.textContent = members.length;
    updateWeeklyStatusSortHeaders();
    return;
    
    if (allMembers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="loading">${searchTerm ? 'Nenhum membro encontrado para esta busca' : '😴 Nenhum membro encontrado com este filtro'}</td></tr>`;
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
                `<span class="role-badge badge-${roleBadgeClass(group)}">${roleNames[group] || group}</span>`
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
                buttons.push(`<button class="action-btn view" onclick="showDeliveryExtractById(${member.id})">👁️</button>`);
                break;
            case 'pending':
                if (member.has_justification_pending) {
                    buttons.push(`<button class="action-btn approve" onclick="showJustificationModalById(${member.id})">📝</button>`);
                } else {
                    buttons.push(`<button class="action-btn approve" onclick="showApprovalModalById(${member.id})">✔️</button>`);
                    buttons.push(`<button class="action-btn view" onclick="showDeliveryExtractById(${member.id})">👁️</button>`);
                }
                break;
            case 'justified':
                buttons.push(`<button class="action-btn view" onclick="showJustifiedDetailsById(${member.id})">📋</button>`);
                break;
            case 'missing':
                // Se foi rejeitado, mostrar botão para ver histórico da rejeição
                if (member.was_rejected) {
                    buttons.push(`<button class="action-btn view" onclick="showDeliveryExtractById(${member.id})" title="Ver extrato">👁️</button>`);
                }
                break;
        }
        
        const actionHtml = buttons.length > 0 ? buttons.join('') : '<span class="no-action">-</span>';
        
        // Badge de farm extra pendente
        let pendingExtraBadge = '';
        if (member.pending_extra && member.pending_extra.id) {
            pendingExtraBadge = `<span class="pending-extra-badge" onclick="showPendingExtraModal(${member.pending_extra.id}, '${escapeHtml(member.name.replace(/'/g, "\\'"))}')">🏆 Extra Pendente</span>`;
        }
        const rejectionNotice = renderLastRejectionNotice(member, true);

        return `
            <tr class="status-${member.status}">
                <td class="passport-cell">${escapeHtml(member.passport || '-')}</td>
                <td class="slot-cell">${renderWeeklyStatusSlotCell(member)}</td>
                <td class="member-cell"><span class="member-avatar">${initial}</span><span class="member-name" onclick="openPaymentHistory(${member.id})">${escapeHtml(member.name)}${member.is_late_payment ? ' ⏰' : ''}</span>${pendingExtraBadge}</td>
                <td class="role-cell">${groupsDisplay}</td>
                <td><span class="status-badge ${member.statusClass}">${member.statusLabel}${member.is_late_payment ? ' (Atrasado)' : ''}</span>${renderFarmTypeStatusChips(member)}${rejectionNotice}</td>
                <td style="white-space: nowrap;">${actionHtml}</td>
            </tr>
        `;
    }).join('');
}

// Função para filtrar tabela (chamada pelos botões)
function filterWeeklyTable(filter) {
    filter = normalizeWeeklyStatusFilter(filter, 'all');
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
function getWeeklyMemberById(memberId) {
    return window.__weeklyStatusMembersById?.get(String(memberId)) || null;
}

function showDeliveryExtractById(memberId) {
    const member = getWeeklyMemberById(memberId);
    if (member) showDeliveryExtract(member);
}

function mergeWeekSubmissionsById(primary = [], secondary = []) {
    const byId = new Map();
    [...primary, ...secondary].forEach(sub => {
        if (!sub || !sub.id) return;
        const existing = byId.get(Number(sub.id)) || {};
        const merged = { ...existing };
        Object.entries(sub).forEach(([key, value]) => {
            if (key === 'items' || key === 'screenshots') return;
            if (value !== undefined && value !== null && value !== '') {
                merged[key] = value;
            }
        });
        merged.items = (sub.items && sub.items.length ? sub.items : existing.items) || [];
        merged.screenshots = (sub.screenshots && sub.screenshots.length ? sub.screenshots : existing.screenshots) || [];
        byId.set(Number(sub.id), merged);
    });
    return Array.from(byId.values());
}

async function loadWeekDeliveryDetailsAsSubmissions(member, week) {
    if (!member?.id || !week?.start || !week?.end) return [];
    try {
        const res = await fetch(`/api/admin/week-delivery-details?userId=${member.id}&week_start=${encodeURIComponent(week.start)}&week_end=${encodeURIComponent(week.end)}&_=${Date.now()}`, {
            credentials: 'same-origin'
        });
        if (!res.ok) return [];
        const data = await res.json();
        if (!data.success || !Array.isArray(data.deliveriesWithItems)) return [];

        return data.deliveriesWithItems.map(entry => ({
            id: entry.delivery?.id,
            status: entry.delivery?.status,
            is_partial: entry.delivery?.is_partial,
            delivered_at: entry.delivery?.delivered_at || entry.delivery?.created_at,
            created_at: entry.delivery?.created_at,
            screenshot_url: entry.delivery?.screenshot_url,
            screenshots: entry.screenshots || [],
            description: entry.delivery?.description,
            items: entry.items || [],
            payment_type: entry.delivery?.payment_type || 'material',
            dirty_money_amount: entry.delivery?.dirty_money_amount || 0,
            approved_by_name: entry.delivery?.approved_by_name,
            approved_at: entry.delivery?.approved_at,
            approval_note: entry.delivery?.approval_note
        })).filter(sub => sub.id);
    } catch (error) {
        console.warn('Falha ao carregar detalhes completos da semana:', error);
        return [];
    }
}

function showApprovalModalById(memberId) {
    const member = getWeeklyMemberById(memberId);
    if (member) showApprovalModal(member);
}

function showJustificationModalById(memberId) {
    const member = getWeeklyMemberById(memberId);
    if (member) showJustificationModal(member);
}

function showJustifiedDetailsById(memberId) {
    const member = getWeeklyMemberById(memberId);
    if (member) showJustifiedDetails(member);
}

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
            const res = await fetch(`/api/admin/week-submissions?userId=${member.id}&week_start=${encodeURIComponent(week.start)}&week_end=${encodeURIComponent(week.end)}&_=${Date.now()}`, { credentials: 'same-origin' });
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
    if (member.id && week && week.start && week.end) {
        const detailedSubmissions = await loadWeekDeliveryDetailsAsSubmissions(member, week);
        submissions = mergeWeekSubmissionsById(submissions, detailedSubmissions);
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

    const farmTypeOrder = { drugs: 0, weapons: 1, general: 2 };
    const statusOrder = { approved: 0, pending: 1, rejected: 2, not_delivered: 3 };
    const sortedSubmissions = [...submissions].sort((a, b) => {
        const statusDiff = (statusOrder[(a.status || '').toLowerCase()] ?? 9) - (statusOrder[(b.status || '').toLowerCase()] ?? 9);
        if (statusDiff !== 0) return statusDiff;
        const typeDiff = (farmTypeOrder[getSubmissionFarmType(a)] ?? 9) - (farmTypeOrder[getSubmissionFarmType(b)] ?? 9);
        if (typeDiff !== 0) return typeDiff;
        return new Date(b.created_at || b.delivered_at) - new Date(a.created_at || a.delivered_at);
    });

    // Barra de progresso do farm na semana (por material) — só dentro do modal
    // 1) Buscar todos os materiais com meta ajustada para o membro (mesmo os não entregues)
    let allMaterialsForMember = [];
    try {
        const weekParam = week && week.start ? `&week_start=${encodeURIComponent(week.start)}` : '';
        const matsRes = await fetch(`/api/admin/materials?memberId=${member.id}${weekParam}`, { credentials: 'same-origin' });
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
                farm_type: mat.farm_type || 'drugs',
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
                    farm_type: item.farm_type || 'drugs',
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

    const progressGroups = [
        { title: 'Meta de Drogas', items: Object.values(progressByMaterial).filter(p => (p.farm_type || 'drugs') !== 'weapons' && (p.farm_type || 'drugs') !== 'general') },
        { title: 'Meta de Armas', items: Object.values(progressByMaterial).filter(p => (p.farm_type || 'drugs') === 'weapons') },
        { title: 'Meta Geral', items: Object.values(progressByMaterial).filter(p => (p.farm_type || 'drugs') === 'general') }
    ].filter(group => group.items.length > 0);

    const renderProgressRows = (items) => items.map(p => {
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
    }).join('');

    const progressBarsHtml = false && metaBatida
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
                ${progressGroups.map(group => `
                    <div class="progress-week-group">
                        <div class="progress-week-group-title">${group.title}</div>
                        ${renderProgressRows(group.items)}
                    </div>
                `).join('')}
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

    const renderSubmissionMaterials = (items = []) => {
        if (!items.length) return '<p class="no-items">Sem materiais</p>';
        const groups = [
            { title: 'Drogas', items: items.filter(item => (item.farm_type || 'drugs') !== 'weapons' && (item.farm_type || 'drugs') !== 'general') },
            { title: 'Armas', items: items.filter(item => (item.farm_type || 'drugs') === 'weapons') },
            { title: 'Geral', items: items.filter(item => (item.farm_type || 'drugs') === 'general') }
        ].filter(group => group.items.length > 0);

        return `<div class="extract-materials grouped">${groups.map(group => `
            <div class="extract-material-group">
                <div class="extract-material-group-title">${group.title}</div>
                <div class="extract-material-tags">
                    ${group.items.map(item => `
                        <span class="extract-mat-tag">${item.material_icon || '📦'} ${item.material_name}: ${formatNumber(item.amount)}</span>
                    `).join('')}
                </div>
            </div>
        `).join('')}</div>`;
    };

    const submissionsHtml = sortedSubmissions.map((submission, index) => {
        const isDirtyMoney = submission.payment_type === 'dirty_money';
        const status = statusLabel(submission);
        const s = (submission.status || '').toLowerCase();
        const isRejected = s === 'rejected' || (s === 'not_delivered' && submission.approved_by_name);
        const farmLabel = isDirtyMoney ? 'Dinheiro Sujo' : getAdminFarmTypeLabel(getSubmissionFarmType(submission));

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
            contentHtml = renderSubmissionMaterials(submission.items || []);
        }

        let approvalInfoHtml = '';
        // Só mostrar "Aprovado por" quando a meta estiver toda completa (aprovado e não parcial)
        if ((submission.status || '').toLowerCase() === 'approved' && submission.approved_by_name) {
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
                    <span class="extract-section-title">Farm de ${farmLabel}</span>
                    <span class="extract-status ${status.cls}">${status.text}</span>
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

async function hydrateWeeklyMemberDetails(member) {
    if (!member || !member.delivery_id || member._detailsLoaded) return member;

    try {
        const response = await fetch(`/api/admin/delivery/${member.delivery_id}/details`, {
            credentials: 'same-origin'
        });
        if (!response.ok) return member;

        const data = await response.json();
        member.items = data.items || member.items || [];
        member.screenshots = data.screenshots || member.screenshots || [];
        member.description = data.delivery?.description ?? member.description;
        member.screenshot_url = data.delivery?.screenshot_url ?? member.screenshot_url;
        member.payment_type = data.delivery?.payment_type || member.payment_type;
        member.payment_type_id = data.delivery?.payment_type_id || member.payment_type_id;
        member.dirty_money_amount = data.delivery?.dirty_money_amount ?? member.dirty_money_amount;
        member.approved_by_name = data.delivery?.approved_by_name || member.approved_by_name;
        member.approved_at = data.delivery?.approved_at || member.approved_at;
        member.approval_note = data.delivery?.approval_note || member.approval_note;
        member._detailsLoaded = true;
    } catch (error) {
        console.warn('Falha ao carregar detalhes da entrega:', error);
    }

    return member;
}

// Modal: Aprovar/Rejeitar farm pendente
async function showApprovalModal(member) {
    member = await hydrateWeeklyMemberDetails(member);
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
    const lastRejectionHtml = renderLastRejectionNotice(member, false);
    
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
            ${lastRejectionHtml}
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

function getAdminSelectedWeekRange() {
    if (selectedWeek && selectedWeek.start && selectedWeek.end) {
        return { start: selectedWeek.start, end: selectedWeek.end };
    }
    if (weeklyStatusData && weeklyStatusData.week && weeklyStatusData.week.start && weeklyStatusData.week.end) {
        return weeklyStatusData.week;
    }
    return typeof getCurrentWeek === 'function' ? getCurrentWeek() : null;
}

function getAdminFarmTypeLabel(farmType) {
    const type = normalizeEditFarmType(farmType);
    if (type === 'weapons') return 'Armas';
    if (type === 'general') return 'Geral';
    return 'Drogas';
}

function getSubmissionFarmType(submission) {
    const firstItem = (submission.items || [])[0];
    return normalizeEditFarmType(firstItem?.farm_type || 'drugs');
}

async function loadMemberWeekSubmissions(member) {
    const week = getAdminSelectedWeekRange();
    if (!member?.id || !week?.start || !week?.end) return [];

    const response = await fetch(`/api/admin/week-submissions?userId=${member.id}&week_start=${encodeURIComponent(week.start)}&week_end=${encodeURIComponent(week.end)}&_=${Date.now()}`, {
        credentials: 'same-origin'
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.success && Array.isArray(data.submissions) ? data.submissions : [];
}

function renderApprovalFarmCard(submission) {
    const farmType = getSubmissionFarmType(submission);
    const label = getAdminFarmTypeLabel(farmType);
    const status = (submission.status || '').toLowerCase();
    const isPending = status === 'pending';
    const isApproved = status === 'approved';
    const isRejected = status === 'rejected' || (status === 'not_delivered' && submission.approved_by_name);

    const materialsHtml = (submission.items || []).length > 0
        ? submission.items.map(item => `
            <div class="extract-item">
                <span class="item-icon">${item.material_icon || '📦'}</span>
                <span class="item-name">${escapeHtml(item.material_name || 'Material')}</span>
                <span class="item-amount">${formatNumber(item.amount)}</span>
            </div>
        `).join('')
        : '<p class="no-items">Sem itens registrados</p>';

    const screenshotsHtml = (submission.screenshots || []).length > 0
        ? `<div class="screenshots-gallery">${submission.screenshots.map((s, idx) => `
            <img src="${escapeHtml(s.screenshot_url)}" class="gallery-screenshot" onclick="openModal('${escapeHtml(s.screenshot_url)}')" alt="Print ${idx + 1}">
        `).join('')}</div>`
        : (submission.screenshot_url
            ? `<img src="${escapeHtml(submission.screenshot_url)}" class="extract-screenshot" onclick="openModal('${escapeHtml(submission.screenshot_url)}')">`
            : '<p class="no-screenshot">Sem prints</p>');

    const approvalInfo = isApproved && submission.approved_by_name
        ? `<div class="approval-info">
            <div class="approver">Aprovado por: ${escapeHtml(submission.approved_by_name)}</div>
            ${submission.approved_at ? `<div style="color: rgba(255,255,255,0.6); font-size: 12px;">${new Date(submission.approved_at).toLocaleString('pt-BR')}</div>` : ''}
            ${submission.approval_note ? `<div class="approval-note">${escapeHtml(submission.approval_note)}</div>` : ''}
        </div>`
        : '';

    const rejectedInfo = isRejected && submission.approved_by_name
        ? `<div class="rejection-info">
            <div class="rejector">Rejeitado por: <strong>${escapeHtml(submission.approved_by_name)}</strong></div>
            ${submission.approved_at ? `<div style="color: rgba(255,255,255,0.6); font-size: 12px;">${new Date(submission.approved_at).toLocaleString('pt-BR')}</div>` : ''}
            ${submission.approval_note ? `<div class="rejection-note">Motivo: ${escapeHtml(submission.approval_note)}</div>` : ''}
        </div>`
        : '';

    return `
        <section class="approval-farm-card ${farmType} ${status}" data-delivery-id="${submission.id}" data-farm-type="${farmType}">
            <div class="approval-farm-head">
                <div>
                    <h3>Meta de ${label}</h3>
                    <span>Envio #${submission.id} - ${new Date(submission.created_at || submission.delivered_at).toLocaleString('pt-BR')}</span>
                </div>
                <span class="status-badge ${isPending ? 'pending' : isApproved ? 'completed' : isRejected ? 'missing' : 'partial'}">
                    ${isPending ? 'Aguardando' : isApproved ? 'Aprovado' : isRejected ? 'Recusado' : submission.status}
                </span>
            </div>
            <div class="extract-items">${materialsHtml}</div>
            <div class="extract-screenshot-container">
                <h3>Prints (${(submission.screenshots || []).length || (submission.screenshot_url ? 1 : 0)})</h3>
                ${screenshotsHtml}
            </div>
            ${approvalInfo}
            ${rejectedInfo}
            ${isPending ? `
                <div class="approval-card-actions">
                    <button class="btn btn-success" onclick="approveApprovalSubmission(${submission.id}, '${farmType}')">Aprovar ${label}</button>
                    <button class="btn btn-danger" onclick="rejectApprovalSubmission(${submission.id}, '${farmType}')">Rejeitar ${label}</button>
                </div>
            ` : ''}
        </section>
    `;
}

// Versao agrupada: aprova Drogas e Armas no mesmo modal quando existirem os dois envios.
async function showApprovalModal(member) {
    const submissions = await loadMemberWeekSubmissions(member);
    const farmSubmissions = submissions
        .filter(sub => (sub.items || []).length > 0 || sub.payment_type !== 'dirty_money')
        .filter(sub => ['pending', 'approved', 'rejected', 'not_delivered'].includes((sub.status || '').toLowerCase()))
        .sort((a, b) => {
            const order = { drugs: 0, weapons: 1, general: 2 };
            return (order[getSubmissionFarmType(a)] ?? 9) - (order[getSubmissionFarmType(b)] ?? 9);
        });

    if (farmSubmissions.length === 0) {
        member = await hydrateWeeklyMemberDetails(member);
        return showActionModal(`
            <div class="approval-modal">
                <div class="extract-header">
                    <h2>Aprovar Farm</h2>
                    <span class="extract-member">${escapeHtml(member.name)}</span>
                </div>
                <p class="no-items">Nenhum envio de farm encontrado para esta semana.</p>
                <div class="modal-actions approval-actions">
                    <button class="btn btn-secondary" onclick="closeActionModal()">Fechar</button>
                </div>
            </div>
        `);
    }

    window.currentApprovalFarmSubmissions = farmSubmissions;
    const pendingSubmissions = farmSubmissions.filter(sub => (sub.status || '').toLowerCase() === 'pending');
    const pendingTypes = pendingSubmissions.map(getSubmissionFarmType);
    const canApproveBoth = pendingSubmissions.length > 1 && pendingTypes.includes('drugs') && pendingTypes.includes('weapons');
    const lastRejectionHtml = renderLastRejectionNotice(member, false);

    showActionModal(`
        <div class="approval-modal approval-modal-split">
            <div class="extract-header">
                <h2>Aprovar Farms da Semana</h2>
                <span class="extract-member">${escapeHtml(member.name)}</span>
            </div>
            <div class="approval-farm-grid">
                ${farmSubmissions.map(renderApprovalFarmCard).join('')}
            </div>
            ${lastRejectionHtml}
            <div class="approval-note-container">
                <h3>Observacao</h3>
                <textarea id="approvalNoteInput" class="approval-note-input" placeholder="Observacao para aprovacao ou motivo obrigatorio para rejeicao..." rows="3"></textarea>
            </div>
            <div class="modal-actions approval-actions">
                ${canApproveBoth ? `<button class="btn btn-success btn-large" onclick="approveAllPendingApprovalSubmissions()">Aprovar Drogas e Armas</button>` : ''}
                <button class="btn btn-secondary" onclick="closeActionModal()">Cancelar</button>
            </div>
        </div>
    `);
}

function approveApprovalSubmission(deliveryId, farmType) {
    const note = document.getElementById('approvalNoteInput')?.value.trim() || '';
    showConfirmationModal(
        'Confirmar aprovacao',
        `Aprovar meta de <strong>${getAdminFarmTypeLabel(farmType)}</strong>?`,
        'success',
        () => approveApprovalDeliveries([deliveryId], note)
    );
}

function approveAllPendingApprovalSubmissions() {
    const pendingIds = (window.currentApprovalFarmSubmissions || [])
        .filter(sub => (sub.status || '').toLowerCase() === 'pending')
        .map(sub => sub.id);
    const note = document.getElementById('approvalNoteInput')?.value.trim() || '';
    showConfirmationModal(
        'Confirmar aprovacao',
        'Aprovar as metas pendentes de <strong>Drogas e Armas</strong>?',
        'success',
        () => approveApprovalDeliveries(pendingIds, note)
    );
}

async function approveApprovalDeliveries(deliveryIds, approvalNote) {
    closeConfirmationModal();
    try {
        for (const deliveryId of deliveryIds) {
            const response = await fetch(`/api/admin/deliveries/${deliveryId}/approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ approval_note: approvalNote || null })
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || `Erro ao aprovar envio #${deliveryId}`);
            }
        }
        weekDataCache.clear();
        closeActionModal();
        showNotification(deliveryIds.length > 1 ? 'Farms aprovados com sucesso!' : 'Farm aprovado com sucesso!', 'success');
        setTimeout(() => location.reload(), 400);
    } catch (error) {
        showNotification(error.message || 'Erro ao aprovar farm', 'error');
    }
}

function rejectApprovalSubmission(deliveryId, farmType) {
    const noteInput = document.getElementById('approvalNoteInput');
    const rejectionNote = noteInput ? noteInput.value.trim() : '';
    if (!rejectionNote) {
        showNotification('Informe o motivo da reprovacao.', 'warning');
        if (noteInput) noteInput.focus();
        return;
    }
    showConfirmationModal(
        'Confirmar rejeicao',
        `Rejeitar meta de <strong>${getAdminFarmTypeLabel(farmType)}</strong>?<br><br><small style="color: #e74c3c;">O motivo sera mostrado ao membro.</small>`,
        'danger',
        () => confirmRejectDeliveryFromModal(deliveryId, rejectionNote)
    );
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
function renderPendingFarmMemberMeta(member) {
    const slotInfo = getWeeklyStatusSlotInfo(member || {});
    const passport = member?.user_passport || member?.passport || '-';
    const slotClass = slotInfo.type === 'manager' ? 'manager' : 'member';

    return `
        <div class="pending-farm-member-meta">
            <span class="pending-farm-chip">Passaporte: <strong>${escapeHtml(String(passport))}</strong></span>
            <span class="pending-farm-chip pending-farm-slot ${slotClass}">
                ${escapeHtml(slotInfo.label)}: <strong>${escapeHtml(slotInfo.slot)}</strong>
            </span>
        </div>
    `;
}

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
                            ${renderPendingFarmMemberMeta(delivery)}
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
                            ${renderPendingFarmMemberMeta(extra)}
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
const memberManagerSlotRoles = ['super_admin', 'gerente_geral', 'gerente_farm', 'gerente_acao', 'gerente_recrutamento', 'gerente_encomendas', 'gerente_vendas', 'gerente_de_vendas', 'gerente_de_fabricacao', '01', '02'];

function memberUsesManagerSlot(member = {}, roleOverride = null) {
    const groups = roleOverride
        ? [roleOverride]
        : ((member.groups && member.groups.length > 0) ? member.groups : (member.role ? [member.role] : []));
    return groups.some(group => {
        const normalized = roleBadgeClass(group);
        return memberManagerSlotRoles.includes(normalized) || normalized.startsWith('gerente_');
    });
}

function renderMemberSlotCell(member) {
    const isManagerSlot = memberUsesManagerSlot(member);
    const slot = isManagerSlot ? member.manager_slot : member.member_slot;
    const label = isManagerSlot ? 'Gerencia' : 'Membros';

    return `<div class="member-slot-cell"><div class="slot-line"><strong>${label}:</strong> ${slot ? escapeHtml(String(slot)) : '-'}</div></div>`;
}

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
        document.getElementById('membersTableBody').innerHTML = '<tr><td colspan="6" class="loading">Erro ao carregar membros</td></tr>';
    }
}

function renderMembersTable() {
    const tbody = document.getElementById('membersTableBody');
    const searchTerm = document.getElementById('searchMembers')?.value?.toLowerCase() || '';
    const isSuperAdmin = currentUser && currentUser.passport === '6999';
    const isManager = currentUser && (
        isSuperAdmin ||
        currentUser.groups?.some(g => 
            roleBadgeClass(g) === 'gerente_geral' ||
            roleBadgeClass(g) === 'gerente_farm' ||
            roleBadgeClass(g) === 'gerente_acao' ||
            roleBadgeClass(g) === 'gerente_recrutamento' ||
            roleBadgeClass(g) === 'gerente_encomendas' ||
            roleBadgeClass(g) === 'gerente_vendas' ||
            roleBadgeClass(g) === 'gerente_de_vendas' ||
            roleBadgeClass(g) === 'gerente_de_fabricacao' ||
            roleBadgeClass(g) === '01' ||
            roleBadgeClass(g) === '02'
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
        tbody.innerHTML = '<tr><td colspan="6" class="loading">Nenhum membro encontrado</td></tr>';
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
            ? groups.map(g => `<span class="role-badge badge-${roleBadgeClass(g)}">${roleNames[g] || g}</span>`).join(' ')
            : '<span class="no-role">Sem grupo</span>';

        
        return `
            <tr class="${statusClass}" data-name="${escapeHtml(member.name.toLowerCase())}" data-passport="${escapeHtml(member.passport || '')}" data-member-id="${member.id}">
                <td><input type="checkbox" class="member-checkbox" ${member.passport === '6999' ? 'disabled' : ''} data-member-id="${member.id}" data-member-name="${escapeHtml(member.name)}" onchange="updateBulkActions()"></td>
                <td>${escapeHtml(member.passport || '-')}</td>
                <td>${renderMemberSlotCell(member)}</td>
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
        const managerRoles = ['gerente_farm','gerente_acao','gerente_recrutamento','gerente_encomendas','gerente_vendas','gerente_de_vendas','gerente_de_fabricacao'];
        const activeMembers = membersTableData.filter(m => m.active);
        const activeManagers = activeMembers.filter(m => {
            const g = m.groups || (m.role ? [m.role] : []);
            return g.some(r => managerRoles.includes(roleBadgeClass(r)));
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

// ===== SISTEMA DE PONTO =====
let attendanceData = [];
let attendanceFilter = 'all';

async function loadAttendance() {
    const tbody = document.getElementById('attendanceTableBody');
    try {
        const response = await fetch('/api/admin/attendance');
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.json();
        attendanceData = data.members || [];
        if (data.roleNames) Object.assign(roleNames, data.roleNames);
        renderAttendanceSummary();
        renderAttendanceTable();
    } catch (error) {
        console.error('Erro ao carregar ponto:', error);
        if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;">Erro ao carregar ponto</td></tr>';
    }
}

// Coluna "Último login" — mostra a data e há quanto tempo
function attendanceLoginText(m) {
    if (m.never_logged_in) return '<span style="color:#e74c3c;font-weight:600;">Nunca logou</span>';
    const d = m.days_since_login;
    let rel;
    if (d === 0) rel = 'hoje';
    else if (d === 1) rel = 'ontem';
    else rel = `há ${d} dias`;
    const dt = m.last_login_at ? new Date(m.last_login_at) : null;
    const dateStr = dt ? dt.toLocaleDateString('pt-BR') : '';
    const color = d >= 7 ? '#e74c3c' : (d >= 3 ? '#e67e22' : '#27ae60');
    return `<div style="line-height:1.35;"><span style="font-weight:600;">${dateStr}</span><br><small style="color:${color};">${rel}</small></div>`;
}

// Coluna "Status" — online/offline agora
function attendanceOnlineChip(m) {
    if (m.online) {
        return `<span class="status-badge" style="background:#27ae60;color:#fff;padding:3px 10px;border-radius:999px;font-size:12px;white-space:nowrap;">🟢 Online</span>`;
    }
    return `<span class="status-badge" style="background:rgba(149,165,166,0.25);color:#bdc3c7;padding:3px 10px;border-radius:999px;font-size:12px;white-space:nowrap;">⚪ Offline</span>`;
}

function attendanceStatusChip(status) {
    const map = {
        paid: ['✅ Pago', '#27ae60'],
        partial: ['⚡ Parcial', '#f39c12'],
        pending: ['⏳ Aguardando', '#3498db'],
        justified: ['📋 Justificado', '#9b59b6'],
        not_paid: ['❌ Não pago', '#e74c3c']
    };
    const [text, color] = map[status] || map.not_paid;
    return `<span class="status-badge" style="background:${color};color:#fff;padding:3px 8px;border-radius:6px;font-size:12px;white-space:nowrap;">${text}</span>`;
}

function renderAttendanceSummary() {
    const el = document.getElementById('attendanceSummary');
    if (!el) return;
    const total = attendanceData.length;
    const online = attendanceData.filter(m => m.online).length;
    const unpaid = attendanceData.filter(m => m.current_week_status === 'not_paid').length;
    const away = attendanceData.filter(m => m.never_logged_in || (m.days_since_login != null && m.days_since_login >= 7)).length;
    const card = (label, value, color) => `<div style="flex:1;min-width:130px;background:var(--card-bg,rgba(255,255,255,0.04));border:1px solid var(--border-color,rgba(255,255,255,0.1));border-radius:10px;padding:12px 16px;"><div style="font-size:24px;font-weight:700;color:${color};">${value}</div><div style="font-size:12px;color:var(--text-secondary);">${label}</div></div>`;
    el.innerHTML =
        card('Membros ativos', total, 'var(--text-primary, #fff)') +
        card('🟢 Online agora', online, '#27ae60') +
        card('Devendo farm (semana)', unpaid, '#e74c3c') +
        card('Sumidos (7+ dias)', away, '#e67e22');
}

function attendancePassesFilter(m) {
    const d = m.days_since_login;
    switch (attendanceFilter) {
        case 'online': return !!m.online;
        case 'today': return !m.never_logged_in && d === 0;
        case 'd3': return !m.never_logged_in && d != null && d >= 3;
        case 'd7': return !m.never_logged_in && d != null && d >= 7;
        case 'never': return !!m.never_logged_in;
        case 'unpaid': return m.current_week_status === 'not_paid';
        default: return true;
    }
}

function renderAttendanceTable() {
    const tbody = document.getElementById('attendanceTableBody');
    if (!tbody) return;
    const searchTerm = document.getElementById('searchAttendance')?.value?.toLowerCase() || '';

    let filtered = attendanceData.filter(m => {
        if (searchTerm && !((m.name || '').toLowerCase().includes(searchTerm) || (m.passport || '').toLowerCase().includes(searchTerm))) return false;
        return attendancePassesFilter(m);
    });

    // Organizar: online primeiro, depois quem acessou mais recentemente
    filtered.sort((a, b) => {
        if (!!b.online !== !!a.online) return b.online ? 1 : -1;
        const da = a.never_logged_in ? Infinity : (a.days_since_login ?? Infinity);
        const db = b.never_logged_in ? Infinity : (b.days_since_login ?? Infinity);
        return da - db;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;">Nenhum membro encontrado</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(m => {
        let groups = m.groups || [];
        if (groups.length > 1 && groups.includes('member')) groups = groups.filter(g => g !== 'member');
        const groupsDisplay = groups.length > 0
            ? groups.map(g => `<span class="role-badge badge-${roleBadgeClass(g)}">${roleNames[g] || g}</span>`).join(' ')
            : '<span class="no-role">Membro</span>';
        return `
            <tr>
                <td>${escapeHtml(m.passport || '-')}</td>
                <td>${escapeHtml(m.name || '')}</td>
                <td>${groupsDisplay}</td>
                <td>${attendanceOnlineChip(m)}</td>
                <td>${attendanceLoginText(m)}</td>
                <td>${attendanceStatusChip(m.current_week_status)}</td>
            </tr>
        `;
    }).join('');
}

function filterAttendanceTable() {
    renderAttendanceTable();
}

function filterAttendanceByStatus(type, btn) {
    attendanceFilter = type;
    document.querySelectorAll('#attendance-tab .members-filters .filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderAttendanceTable();
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

function updateEditMemberSlotVisibility(member) {
    const memberSlotGroup = document.getElementById('editMemberSlot')?.closest('.edit-form-group');
    const managerSlotGroup = document.getElementById('editManagerSlot')?.closest('.edit-form-group');
    if (!memberSlotGroup || !managerSlotGroup) return;

    const roleSelect = document.getElementById('editMemberRole');
    const roleOverride = roleSelect && roleSelect.closest('.edit-form-group')?.style.display !== 'none'
        ? roleSelect.value
        : null;
    const isManagerSlot = memberUsesManagerSlot(member, roleOverride);

    memberSlotGroup.style.display = isManagerSlot ? 'none' : 'block';
    managerSlotGroup.style.display = isManagerSlot ? 'block' : 'none';
}

function openEditMemberModal(id, name, passport, email) {
    editingMemberId = id;
    const selectedMember = membersTableData.find(m => m.id === id);
    document.getElementById('editMemberName').value = selectedMember?.original_name || selectedMember?.name || name || '';
    document.getElementById('editMemberCapitalNickname').value = selectedMember?.capital_nickname || '';
    document.getElementById('editMemberPassport').value = selectedMember?.passport || passport || '';
    document.getElementById('editMemberEmail').value = selectedMember?.email || email || '';
    document.getElementById('editMemberSlot').value = selectedMember?.member_slot || '';
    document.getElementById('editManagerSlot').value = selectedMember?.manager_slot || '';
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
        const member = selectedMember;
        if (member && member.groups) {
            let groups = member.groups || [];
            if (groups.length > 1 && groups.includes('member')) {
                groups = groups.filter(g => g !== 'member');
            }
            const primaryGroup = groups.length > 0 ? groups[0] : 'member';
            roleSelect.value = primaryGroup;
        }
        roleSelect.onchange = () => updateEditMemberSlotVisibility(selectedMember);
    } else {
        // Ocultar campo de cargo se não tiver permissão
        roleContainer.style.display = 'none';
    }
    
    updateEditMemberSlotVisibility(selectedMember);
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
    const capitalNickname = document.getElementById('editMemberCapitalNickname').value.trim().replace(/\s+/g, ' ');
    const passport = document.getElementById('editMemberPassport').value.trim();
    const email = document.getElementById('editMemberEmail').value.trim();
    const memberSlot = document.getElementById('editMemberSlot').value.trim();
    const managerSlot = document.getElementById('editManagerSlot').value.trim();
    const newPassword = document.getElementById('editMemberPassword').value;
    
    if (!name || !passport) {
        alert('Nome e passaporte são obrigatórios!');
        return;
    }
    if (capitalNickname && (capitalNickname.length < 2 || capitalNickname.length > 40)) {
        alert('O vulgo deve ter entre 2 e 40 caracteres.');
        return;
    }
    
    try {
        const member = membersTableData.find(m => m.id === editingMemberId);
        if (!member) {
            alert('Erro: Membro não encontrado');
            return;
        }

        const selectedRole = canChangeRoles() ? document.getElementById('editMemberRole').value : null;
        const usesManagerSlot = memberUsesManagerSlot(member, selectedRole);
        const relevantSlot = usesManagerSlot ? managerSlot : memberSlot;
        const currentRelevantSlot = ((usesManagerSlot ? member.manager_slot : member.member_slot) || '').trim();

        const currentName = (member.original_name || member.name || '').trim();
        const currentCapitalNickname = (member.capital_nickname || '').trim();
        const currentPassport = (member.passport || '').trim();
        const currentEmail = (member.email || '').trim();
        const hasProfileChanges =
            name !== currentName ||
            capitalNickname !== currentCapitalNickname ||
            passport !== currentPassport ||
            email !== currentEmail ||
            relevantSlot !== currentRelevantSlot ||
            !!newPassword;

        // Atualizar dados básicos apenas quando houve alteração
        if (hasProfileChanges) {
            const response = await fetch(`/api/admin/members/${editingMemberId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    capital_nickname: capitalNickname,
                    passport,
                    email,
                    member_slot: usesManagerSlot ? undefined : memberSlot,
                    manager_slot: usesManagerSlot ? managerSlot : undefined,
                    newPassword: newPassword || undefined
                })
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
            const newRole = selectedRole;
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
    const target_role = document.getElementById('newMaterialTarget')?.value || 'both';
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
                body: JSON.stringify({ name, icon, weekly_goal, manager_weekly_goal, target_role })
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
                body: JSON.stringify({ name, icon, weekly_goal, manager_weekly_goal, target_role })
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
                body: JSON.stringify({ name, icon, weekly_goal, manager_weekly_goal, target_role })
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
    const target_role = document.getElementById('newPaymentTypeTarget')?.value || 'both';
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
                body: JSON.stringify({ name, icon, weekly_goal, manager_weekly_goal, unit_type: unitType, target_role })
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
                body: JSON.stringify({ name, icon, weekly_goal, manager_weekly_goal, unit_type: unitType, target_role })
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
                body: JSON.stringify({ name, icon, weekly_goal, manager_weekly_goal, unit_type: unitType, target_role })
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

const MONEY_ICON_OPTIONS = [
    { icon: '💰', name: 'Dinheiro' },
    { icon: '💵', name: 'Nota' },
    { icon: '💸', name: 'Dinheiro voando' },
    { icon: '🪙', name: 'Moeda' },
    { icon: '💳', name: 'Cartão' },
    { icon: '💼', name: 'Maleta' },
    { icon: '💎', name: 'Diamante' },
    { icon: '💠', name: 'Safira' }
];

function fillIconSelect(id, options) {
    const sel = document.getElementById(id);
    if (!sel || sel.options.length > 0) return;
    sel.innerHTML = options.map(o => `<option value="${o.icon}">${o.icon} ${o.name}</option>`).join('');
}

function populateGoalsIconSelects() {
    fillIconSelect('matIconMembros', MATERIAL_ICON_OPTIONS);
    fillIconSelect('matIconGerentes', MATERIAL_ICON_OPTIONS);
    fillIconSelect('payIconMembros', MONEY_ICON_OPTIONS);
    fillIconSelect('payIconGerentes', MONEY_ICON_OPTIONS);
}

function setGoalsMsg(id, text, type) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = 'goals-message show ' + type;
    setTimeout(() => { if (el) el.className = 'goals-message'; }, 4000);
}

// Adiciona material/produto direto na seção (membro ou gerência)
async function addGoalMaterial(side) {
    const sfx = side === 'manager' ? 'Gerentes' : 'Membros';
    const selectEl = document.getElementById('matSelect' + sfx);
    const nameEl = document.getElementById('matName' + sfx);
    const iconEl = document.getElementById('matIcon' + sfx);
    const farmTypeEl = document.getElementById('matFarmType' + sfx);
    const goalEl = document.getElementById('matGoal' + sfx);
    const msgId = 'matMsg' + sfx;
    const selectedValue = selectEl?.value || '';
    const goal = parseInt(goalEl?.value) || 700;
    const farmType = side === 'manager' ? 'general' : (farmTypeEl?.value === 'weapons' ? 'weapons' : 'drugs');
    let name = '';
    let icon = '📦';

    if (!selectedValue) {
        setGoalsMsg(msgId, 'Selecione um material no dropdown.', 'error');
        return;
    }

    if (selectedValue === '__new__') {
        name = (nameEl?.value || '').trim();
        icon = iconEl?.value || '📦';
        if (!name) {
            setGoalsMsg(msgId, 'Digite o nome do novo material.', 'error');
            return;
        }
    } else {
        const opt = selectEl?.options[selectEl.selectedIndex];
        name = opt?.getAttribute('data-name') || '';
        icon = opt?.getAttribute('data-icon') || '📦';
        if (!name) {
            setGoalsMsg(msgId, 'Material inválido.', 'error');
            return;
        }
    }

    try {
        const isExisting = selectedValue !== '__new__';
        const opt = isExisting ? selectEl?.options[selectEl.selectedIndex] : null;
        const isInactive = opt?.getAttribute('data-active') === '0';
        const url = isExisting && !isInactive ? `/api/admin/materials/${selectedValue}` : '/api/admin/materials';
        const resp = await fetch(url, {
            method: isExisting && !isInactive ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, icon, weekly_goal: goal, manager_weekly_goal: goal, target_role: side, farm_type: farmType })
        });
        const data = await resp.json();
        if (data.success) {
            setGoalsMsg(msgId, data.message || 'Adicionado.', 'success');
            if (nameEl) nameEl.value = '';
            if (selectEl) selectEl.value = '';
            handleGoalMaterialSelectChange(side);
            loadGoalsMaterials();
        } else {
            setGoalsMsg(msgId, data.error || 'Erro ao adicionar.', 'error');
        }
    } catch (e) {
        setGoalsMsg(msgId, 'Erro de conexão.', 'error');
    }
}

// Adiciona tipo de pagamento direto na seção (membro ou gerência)
async function addGoalPayment(side) {
    const sfx = side === 'manager' ? 'Gerentes' : 'Membros';
    const nameEl = document.getElementById('payName' + sfx);
    const iconEl = document.getElementById('payIcon' + sfx);
    const unitEl = document.getElementById('payUnit' + sfx);
    const goalEl = document.getElementById('payGoal' + sfx);
    const msgId = 'payMsg' + sfx;
    const name = (nameEl?.value || '').trim();
    const icon = iconEl?.value || '💰';
    const unit = unitEl?.value === 'unidade' ? 'unidade' : 'R$';
    const goal = parseInt(goalEl?.value) || (unit === 'unidade' ? 700 : 50000);

    if (!name) { setGoalsMsg(msgId, 'Digite o nome do pagamento.', 'error'); return; }

    try {
        const resp = await fetch('/api/admin/payment-types', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, icon, weekly_goal: goal, manager_weekly_goal: goal, unit_type: unit, target_role: side })
        });
        const data = await resp.json();
        if (data.success) {
            setGoalsMsg(msgId, data.message || 'Adicionado.', 'success');
            if (nameEl) nameEl.value = '';
            loadGoalsPaymentTypes();
        } else {
            setGoalsMsg(msgId, data.error || 'Erro ao adicionar.', 'error');
        }
    } catch (e) {
        setGoalsMsg(msgId, 'Erro de conexão.', 'error');
    }
}

document.getElementById('btnAddMatMembros')?.addEventListener('click', () => addGoalMaterial('member'));
document.getElementById('btnAddMatGerentes')?.addEventListener('click', () => addGoalMaterial('manager'));
document.getElementById('matSelectMembros')?.addEventListener('change', () => handleGoalMaterialSelectChange('member'));
document.getElementById('matSelectGerentes')?.addEventListener('change', () => handleGoalMaterialSelectChange('manager'));
document.getElementById('btnAddPayMembros')?.addEventListener('click', () => addGoalPayment('member'));
document.getElementById('btnAddPayGerentes')?.addEventListener('click', () => addGoalPayment('manager'));

async function loadGoalsTab() {
    populateGoalsIconSelects();
    await Promise.all([
        loadGoalsMaterials(),
        loadGoalsPaymentTypes()
    ]);
}

function targetRoleLabel(target) {
    if (target === 'member') return '👤 Membros';
    if (target === 'manager') return '🛡️ Gerência';
    return '👥 Ambos';
}

async function loadGoalsMaterials() {
    const tbodyM = document.getElementById('goalsMaterialsBodyMembros');
    const tbodyMW = document.getElementById('goalsMaterialsBodyMembrosArmas');
    const tbodyG = document.getElementById('goalsMaterialsBodyGerentes');
    if (!tbodyM || !tbodyG) return;
    try {
        const response = await fetch('/api/admin/materials');
        const data = await response.json();
        const all = data.materials || data || [];
        window.goalsMaterialsById = Object.fromEntries(all.map(m => [String(m.id), m]));
        populateMaterialSelectDropdown(all);
        populateGoalMaterialSelects(all);
        const inGoals = all.filter(m => m.active === 1 || m.active === true || m.active === '1');

        const rowHtml = (m, goalCol) => {
            const nameEsc = (m.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
            const iconEsc = (m.icon || '📦').replace(/'/g, "\\'");
            const goalM = m.weekly_goal ?? 700;
            const goalG = m.manager_weekly_goal ?? m.weekly_goal ?? 700;
            const target = m.target_role || 'both';
            return `<tr>
                <td class="goals-cell-icon">${m.icon || '📦'}</td>
                <td class="goals-cell-name">${escapeHtml(m.name || '-')}</td>
                <td class="goals-cell-meta">${Number(goalCol === 'manager' ? goalG : goalM).toLocaleString('pt-BR')}</td>
                <td><span class="goals-status-active">Ativo</span></td>
                <td class="goals-actions">
                    <button type="button" class="btn btn-secondary btn-small" onclick="openEditMaterialGoalsModal(${m.id}, '${nameEsc}', '${iconEsc}', ${goalM}, ${goalG}, '${target}')">✏️ Editar</button>
                    <button type="button" class="btn btn-danger btn-small goals-btn-remove" onclick="removeMaterialFromGoals(${m.id})" title="Excluir este material da meta">Excluir</button>
                </td>
            </tr>`;
        };

        // Cada material aparece em UMA tabela só (independentes): gerência = 'manager', resto = membros
        const gerentes = inGoals.filter(m => (m.target_role || 'both') === 'manager');
        const membros = inGoals.filter(m => (m.target_role || 'both') !== 'manager');
        const membrosDrogas = membros.filter(m => (m.farm_type || 'drugs') !== 'weapons');
        const membrosArmas = membros.filter(m => (m.farm_type || 'drugs') === 'weapons');

        tbodyM.innerHTML = membrosDrogas.length
            ? membrosDrogas.map(m => rowHtml(m, 'member')).join('')
            : '<tr><td colspan="5" style="text-align:center;color:#888;padding:24px;">Nenhum material de drogas para membros.</td></tr>';
        if (tbodyMW) {
            tbodyMW.innerHTML = membrosArmas.length
                ? membrosArmas.map(m => rowHtml(m, 'member')).join('')
                : '<tr><td colspan="5" style="text-align:center;color:#888;padding:24px;">Nenhum material de armas para membros.</td></tr>';
        }
        tbodyG.innerHTML = gerentes.length
            ? gerentes.map(m => rowHtml(m, 'manager')).join('')
            : '<tr><td colspan="5" style="text-align:center;color:#888;padding:24px;">Nenhum material para a gerência. Ex: Capofol 💊</td></tr>';
    } catch (err) {
        console.error(err);
        tbodyM.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#e74c3c;">Erro ao carregar.</td></tr>';
        tbodyG.innerHTML = '';
    }
}

function farmTypeLabel(type) {
    if (type === 'weapons') return 'Armas';
    if (type === 'general') return 'Geral';
    return 'Drogas';
}

function targetRoleShortLabel(target) {
    if (target === 'manager') return 'Gerência';
    if (target === 'member') return 'Membros';
    return 'Membros';
}

function populateGoalMaterialSelects(allMaterials) {
    const list = Array.isArray(allMaterials) ? allMaterials : [];
    [
        { id: 'matSelectMembros', placeholder: 'Selecione um material de membro...', side: 'member' },
        { id: 'matSelectGerentes', placeholder: 'Selecione um material da gerência...', side: 'manager' }
    ].forEach(config => {
        const sel = document.getElementById(config.id);
        if (!sel) return;
        const selectedValue = sel.value || '';
        sel.innerHTML = '';

        const opt0 = document.createElement('option');
        opt0.value = '';
        opt0.textContent = config.placeholder;
        sel.appendChild(opt0);

        list.forEach(m => {
            const opt = document.createElement('option');
            const target = m.target_role || 'member';
            const farmType = m.farm_type || 'drugs';
            const active = (m.active === 1 || m.active === true || m.active === '1');
            opt.value = m.id;
            opt.setAttribute('data-name', m.name || '');
            opt.setAttribute('data-icon', m.icon || '📦');
            opt.setAttribute('data-active', active ? '1' : '0');
            opt.setAttribute('data-target-role', target);
            opt.setAttribute('data-farm-type', farmType);
            opt.textContent = `${m.icon || '📦'} ${m.name || ''} · ${targetRoleShortLabel(target)}${target !== 'manager' ? ` · ${farmTypeLabel(farmType)}` : ''}${active ? '' : ' · inativo'}`;
            sel.appendChild(opt);
        });

        const optNew = document.createElement('option');
        optNew.value = '__new__';
        optNew.textContent = '+ Adicionar novo material';
        sel.appendChild(optNew);

        if ([...sel.options].some(opt => opt.value === selectedValue)) {
            sel.value = selectedValue;
        }
    });
}

function handleGoalMaterialSelectChange(side) {
    const sfx = side === 'manager' ? 'Gerentes' : 'Membros';
    const selectEl = document.getElementById('matSelect' + sfx);
    const newFields = document.getElementById('matNewFields' + sfx);
    const nameEl = document.getElementById('matName' + sfx);
    const farmTypeEl = document.getElementById('matFarmType' + sfx);
    const isNew = selectEl?.value === '__new__';

    if (newFields) newFields.style.display = isNew ? 'flex' : 'none';
    if (nameEl && !isNew) nameEl.value = '';

    if (side !== 'manager' && selectEl && farmTypeEl && selectEl.value && selectEl.value !== '__new__') {
        const opt = selectEl.options[selectEl.selectedIndex];
        const farmType = opt?.getAttribute('data-farm-type');
        if (farmType === 'weapons' || farmType === 'drugs') {
            farmTypeEl.value = farmType;
        }
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
    const tbodyM = document.getElementById('goalsPaymentTypesBodyMembros');
    const tbodyG = document.getElementById('goalsPaymentTypesBodyGerentes');
    if (!tbodyM || !tbodyG) return;
    try {
        const response = await fetch('/api/admin/payment-types');
        const data = await response.json();
        const all = data.paymentTypes || data || [];
        populatePaymentTypeSelectDropdown(all);
        const inGoals = all.filter(pt => pt.active === 1 || pt.active === true || pt.active === '1');

        const rowHtml = (pt, goalCol) => {
            const nameEsc = (pt.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
            const iconEsc = (pt.icon || '💰').replace(/'/g, "\\'");
            const goalM = pt.weekly_goal ?? (pt.unit_type === 'unidade' ? 700 : 50000);
            const goalG = pt.manager_weekly_goal ?? pt.weekly_goal ?? goalM;
            const target = pt.target_role || 'both';
            const fmt = (v) => pt.unit_type === 'unidade' ? `${Number(v).toLocaleString('pt-BR')} un.` : `R$ ${Number(v).toLocaleString('pt-BR')}`;
            return `<tr>
                <td class="goals-cell-icon">${pt.icon || '💰'}</td>
                <td class="goals-cell-name">${pt.name || '-'}</td>
                <td class="goals-cell-meta">${fmt(goalCol === 'manager' ? goalG : goalM)}</td>
                <td><span class="goals-status-active">Ativo</span></td>
                <td class="goals-actions">
                    <button type="button" class="btn btn-secondary btn-small" onclick="openEditPaymentTypeGoalsModal(${pt.id}, '${nameEsc}', '${iconEsc}', ${goalM}, ${goalG}, '${(pt.unit_type || 'R$').replace(/'/g, "\\'")}', '${target}')">✏️ Editar</button>
                    <button type="button" class="btn btn-danger btn-small goals-btn-remove" onclick="removePaymentTypeFromGoals(${pt.id})" title="Excluir da meta">Excluir</button>
                </td>
            </tr>`;
        };

        // Cada tipo aparece em UMA tabela só (independentes): gerência = 'manager', resto = membros
        const gerentes = inGoals.filter(pt => (pt.target_role || 'both') === 'manager');
        const membros = inGoals.filter(pt => (pt.target_role || 'both') !== 'manager');

        tbodyM.innerHTML = membros.length
            ? membros.map(pt => rowHtml(pt, 'member')).join('')
            : '<tr><td colspan="5" style="text-align:center;color:#888;padding:24px;">Nenhum pagamento para membros.</td></tr>';
        tbodyG.innerHTML = gerentes.length
            ? gerentes.map(pt => rowHtml(pt, 'manager')).join('')
            : '<tr><td colspan="5" style="text-align:center;color:#888;padding:24px;">Nenhum pagamento para a gerência.</td></tr>';
    } catch (err) {
        console.error(err);
        tbodyM.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#e74c3c;">Erro ao carregar.</td></tr>';
        tbodyG.innerHTML = '';
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

// Lista de ícones disponíveis para materiais/metas (inclui Capofol, agulha, seringa)
const MATERIAL_ICON_OPTIONS = [
    { icon: '💊', name: 'Capofol (pílula dourada)' },
    { icon: '💉', name: 'Seringa' },
    { icon: '🪡', name: 'Agulha' },
    { icon: '🟡', name: 'Pílula dourada' },
    { icon: '🩸', name: 'Sangue' },
    { icon: '🧬', name: 'Composto' },
    { icon: '📦', name: 'Caixa' },
    { icon: '📄', name: 'Folha' },
    { icon: '🧪', name: 'Tubo de ensaio' },
    { icon: '🌿', name: 'Erva' },
    { icon: '🌾', name: 'Trigo' },
    { icon: '💎', name: 'Diamante' },
    { icon: '🔥', name: 'Fogo' },
    { icon: '💧', name: 'Água' },
    { icon: '⚡', name: 'Raio' }
];

function materialIconOptionsHtml(selected) {
    const list = MATERIAL_ICON_OPTIONS.slice();
    if (selected && !list.some(o => o.icon === selected)) {
        list.unshift({ icon: selected, name: 'Atual' });
    }
    return list.map(o => `<option value="${o.icon}" ${o.icon === selected ? 'selected' : ''}>${o.icon} ${o.name}</option>`).join('');
}

function targetSelectHtml(selectId, selected) {
    const opts = [
        { v: 'member', t: '👤 Membros' },
        { v: 'manager', t: '🛡️ Gerência (01, 02, Gerentes)' }
    ];
    // Produtos legados marcados como 'both' caem no lado dos Membros por padrão
    const sel = selected === 'manager' ? 'manager' : 'member';
    return `<select id="${selectId}" class="icon-select">${opts.map(o => `<option value="${o.v}" ${o.v === sel ? 'selected' : ''}>${o.t}</option>`).join('')}</select>`;
}

function openEditMaterialGoalsModal(id, name, icon, goalMembros, goalGerentes, target, farmType) {
    const cachedMaterial = window.goalsMaterialsById ? window.goalsMaterialsById[String(id)] : null;
    const normalizedFarmType = farmType || cachedMaterial?.farm_type || 'drugs';
    const normalizedTarget = target === 'manager' ? 'manager' : 'member';
    const isManagerTarget = normalizedTarget === 'manager';
    const currentGoal = isManagerTarget ? goalGerentes : goalMembros;
    const goalLabel = isManagerTarget ? 'Meta da gerencia' : 'Meta dos membros';
    const modalHtml = `
        <div class="edit-modal-overlay" id="editMaterialGoalsModal">
            <div class="edit-modal-content">
                <h3>✏️ Editar metas do material</h3>
                <div class="edit-form">
                    <div class="form-group" style="margin-bottom:12px;">
                        <label>Material</label>
                        <div style="display:flex;align-items:center;gap:10px;padding:10px;background:rgba(0,0,0,0.2);border-radius:8px;">
                            <span id="editMatGoalsIconPreview" style="font-size:28px;">${icon}</span>
                            <span style="font-weight:600;">${name}</span>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Ícone</label>
                        <select id="editMatGoalsIcon" class="icon-select" onchange="document.getElementById('editMatGoalsIconPreview').textContent = this.value;">${materialIconOptionsHtml(icon)}</select>
                    </div>
                    <div class="form-group">
                        <label>Destino (quem farma)</label>
                        <input type="hidden" id="editMatGoalsTarget" value="${normalizedTarget}">
                        <div style="font-weight:600;">${isManagerTarget ? 'Gerencia' : 'Membros'}</div>
                    </div>
                    ${!isManagerTarget ? `
                    <div class="form-group">
                        <label>Tipo de farm do membro</label>
                        <select id="editMatFarmType" class="icon-select">
                            <option value="drugs" ${normalizedFarmType !== 'weapons' ? 'selected' : ''}>Drogas</option>
                            <option value="weapons" ${normalizedFarmType === 'weapons' ? 'selected' : ''}>Armas</option>
                        </select>
                    </div>
                    ` : ''}
                    <div class="form-group">
                        <label>${goalLabel}</label>
                        <input type="number" id="editMatGoal" value="${currentGoal}" min="1" class="edit-input" style="width:120px;">
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
    const goal = parseInt(document.getElementById('editMatGoal')?.value);
    const newIcon = document.getElementById('editMatGoalsIcon')?.value;
    const newTarget = document.getElementById('editMatGoalsTarget')?.value === 'manager' ? 'manager' : 'member';
    const newFarmType = newTarget === 'manager' ? 'general' : (document.getElementById('editMatFarmType')?.value === 'weapons' ? 'weapons' : 'drugs');
    if (isNaN(goal) || goal < 1) {
        showNotification('Metas inválidas.', 'error');
        return;
    }
    try {
        const res = await fetch(`/api/admin/materials/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ weekly_goal: goal, manager_weekly_goal: goal, icon: newIcon, target_role: newTarget, farm_type: newFarmType })
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

function openEditPaymentTypeGoalsModal(id, name, icon, goalMembros, goalGerentes, unitType, target) {
    const isUnidade = unitType === 'unidade';
    const normalizedTarget = target === 'manager' ? 'manager' : 'member';
    const isManagerTarget = normalizedTarget === 'manager';
    const currentGoal = isManagerTarget ? goalGerentes : goalMembros;
    const goalLabel = isUnidade
        ? (isManagerTarget ? 'Meta da gerencia un.' : 'Meta dos membros un.')
        : (isManagerTarget ? 'Meta R$ da gerencia' : 'Meta R$ dos membros');
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
                        <label>Destino (quem farma)</label>
                        <input type="hidden" id="editPayGoalsTarget" value="${normalizedTarget}">
                        <div style="font-weight:600;">${isManagerTarget ? 'Gerencia' : 'Membros'}</div>
                    </div>
                    <div class="form-group">
                        <label>${goalLabel}</label>
                        <input type="number" id="editPayGoal" value="${currentGoal}" min="1" class="edit-input" style="width:140px;">
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
    const goal = parseInt(document.getElementById('editPayGoal')?.value);
    const newTarget = document.getElementById('editPayGoalsTarget')?.value === 'manager' ? 'manager' : 'member';
    if (isNaN(goal) || goal < 1) {
        showNotification('Metas inválidas.', 'error');
        return;
    }
    try {
        const res = await fetch(`/api/admin/payment-types/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ weekly_goal: goal, manager_weekly_goal: goal, target_role: newTarget })
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
function formatCommandmentDate(value) {
    if (!value) return 'Nunca';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('pt-BR');
}

function commandmentStatusLabel(status) {
    if (status === 'accepted') return '<span class="status-badge completed">Aceitou</span>';
    if (status === 'refused') return '<span class="status-badge rejected">Recusou</span>';
    return '<span class="status-badge pending">Pendente</span>';
}

function renderCommandmentGroupBadges(member) {
    const groups = member.groups && member.groups.length ? member.groups : [member.role || 'member'];
    return groups.map(group => (
        `<span class="role-badge badge-${roleBadgeClass(group)}">${escapeHtml(roleNames[group] || group)}</span>`
    )).join(' ');
}

function getCommandmentSortValue(member, column) {
    if (column === 'groups') {
        return (member.groups && member.groups.length ? member.groups : [member.role || 'member'])
            .map(group => roleNames[group] || group)
            .join(' ');
    }
    if (column === 'status') return member.commandment_status || 'pending';
    if (column === 'responded_at') return member.commandment_responded_at || '';
    if (column === 'last_login_at') return member.last_login_at || '';
    return member[column] || '';
}

function sortFamilyCommandmentsReport(column) {
    if (familyCommandmentsSortColumn === column) {
        familyCommandmentsSortDirection = familyCommandmentsSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        familyCommandmentsSortColumn = column;
        familyCommandmentsSortDirection = 'asc';
    }
    renderFamilyCommandmentsReport();
}

function updateFamilyCommandmentsSortIndicators() {
    document.querySelectorAll('[data-cmd-sort]').forEach(el => {
        el.textContent = el.dataset.cmdSort === familyCommandmentsSortColumn
            ? (familyCommandmentsSortDirection === 'asc' ? '▲' : '▼')
            : '';
    });
}

async function loadFamilyCommandments() {
    const body = document.getElementById('familyCommandmentsReportBody');
    if (body) body.innerHTML = '<tr><td colspan="6" class="loading">Carregando...</td></tr>';

    try {
        const response = await fetch('/api/admin/family-commandments');
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Erro ao carregar mandamentos');

        const commandments = data.commandments || {};
        document.getElementById('familyCommandmentsTitle').value = commandments.title || 'Mandamentos da Familia';
        document.getElementById('familyCommandmentsContent').value = commandments.content || '';
        document.getElementById('familyCommandmentsActive').checked = !!commandments.active;
        document.getElementById('familyCommandmentsVersion').textContent = `Versao atual: ${commandments.version || 1}`;

        familyCommandmentsMembers = data.members || [];
        renderFamilyCommandmentsReport();
    } catch (error) {
        if (body) body.innerHTML = `<tr><td colspan="6" class="loading">Erro: ${escapeHtml(error.message)}</td></tr>`;
        showNotification(error.message, 'error');
    }
}

async function saveFamilyCommandments() {
    const messageEl = document.getElementById('familyCommandmentsMessage');
    try {
        const payload = {
            title: document.getElementById('familyCommandmentsTitle').value,
            content: document.getElementById('familyCommandmentsContent').value,
            active: document.getElementById('familyCommandmentsActive').checked
        };

        const response = await fetch('/api/admin/family-commandments', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Erro ao salvar mandamentos');

        messageEl.textContent = data.commandments?.changed
            ? 'Mandamentos salvos. Uma nova versao foi criada e exigira novo aceite.'
            : 'Mandamentos salvos sem alterar a versao.';
        messageEl.className = 'message show success';

        const report = data.report || {};
        familyCommandmentsMembers = report.members || [];
        const commandments = report.commandments || data.commandments || {};
        document.getElementById('familyCommandmentsVersion').textContent = `Versao atual: ${commandments.version || 1}`;
        renderFamilyCommandmentsReport();
        showNotification('Mandamentos salvos', 'success');
    } catch (error) {
        messageEl.textContent = error.message;
        messageEl.className = 'message show error';
        showNotification(error.message, 'error');
    }
}

function renderFamilyCommandmentsReport() {
    const body = document.getElementById('familyCommandmentsReportBody');
    if (!body) return;

    const search = String(document.getElementById('familyCommandmentsSearch')?.value || '').toLowerCase().trim();
    const members = familyCommandmentsMembers.filter(member => {
        const groups = (member.groups || []).join(' ');
        const haystack = `${member.name || ''} ${member.passport || ''} ${groups}`.toLowerCase();
        return !search || haystack.includes(search);
    }).sort((a, b) => {
        const aValue = getCommandmentSortValue(a, familyCommandmentsSortColumn);
        const bValue = getCommandmentSortValue(b, familyCommandmentsSortColumn);
        const comparison = String(aValue).localeCompare(String(bValue), 'pt-BR', {
            numeric: true,
            sensitivity: 'base'
        });
        return familyCommandmentsSortDirection === 'asc' ? comparison : -comparison;
    });

    const accepted = familyCommandmentsMembers.filter(m => m.commandment_status === 'accepted').length;
    const refused = familyCommandmentsMembers.filter(m => m.commandment_status === 'refused').length;
    const pending = familyCommandmentsMembers.length - accepted - refused;
    document.getElementById('cmdAcceptedCount').textContent = accepted;
    document.getElementById('cmdRefusedCount').textContent = refused;
    document.getElementById('cmdPendingCount').textContent = pending;
    updateFamilyCommandmentsSortIndicators();

    if (members.length === 0) {
        body.innerHTML = '<tr><td colspan="6" class="loading">Nenhum membro encontrado</td></tr>';
        return;
    }

    body.innerHTML = members.map(member => `
        <tr>
            <td>${escapeHtml(member.passport || '-')}</td>
            <td>${escapeHtml(member.name || '-')}</td>
            <td>${renderCommandmentGroupBadges(member)}</td>
            <td>${commandmentStatusLabel(member.commandment_status)}</td>
            <td>${formatCommandmentDate(member.commandment_responded_at)}</td>
            <td>${formatCommandmentDate(member.last_login_at)}</td>
        </tr>
    `).join('');
}

async function loadFarmSettings() {
    try {
        const response = await fetch('/api/admin/farm-settings');
        const data = await response.json();
        
        const settings = data.settings || {};
        
        // Atualizar checkboxes
        const materialsEnabled = document.getElementById('farmMaterialsEnabled');
        const memberDrugFarmEnabled = document.getElementById('memberDrugFarmEnabled');
        const memberWeaponFarmEnabled = document.getElementById('memberWeaponFarmEnabled');
        const paymentEnabled = document.getElementById('farmPaymentEnabled');
        const competitionEnabledEl = document.getElementById('competitionEnabled');
        
        if (materialsEnabled) {
            materialsEnabled.checked = settings.farm_materials_enabled === 'true';
        }
        if (memberDrugFarmEnabled) {
            memberDrugFarmEnabled.checked = settings.member_drug_farm_enabled !== 'false';
        }
        if (memberWeaponFarmEnabled) {
            memberWeaponFarmEnabled.checked = settings.member_weapon_farm_enabled !== 'false';
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
function updateNewMemberSlotVisibility() {
    const role = document.getElementById('newRole')?.value || 'member';
    const memberSlotGroup = document.getElementById('newMemberSlot')?.closest('.form-group');
    const managerSlotGroup = document.getElementById('newManagerSlot')?.closest('.form-group');
    if (!memberSlotGroup || !managerSlotGroup) return;

    const isManagerSlot = memberUsesManagerSlot({}, role);
    memberSlotGroup.style.display = isManagerSlot ? 'none' : 'block';
    managerSlotGroup.style.display = isManagerSlot ? 'block' : 'none';
}

document.getElementById('newMemberForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('newName').value.trim();
    const passport = document.getElementById('newPassport').value.trim().toUpperCase();
    const email = document.getElementById('newEmail').value.trim();
    const password = document.getElementById('newPassword').value;
    const role = document.getElementById('newRole').value;
    const member_slot = document.getElementById('newMemberSlot').value.trim();
    const manager_slot = document.getElementById('newManagerSlot').value.trim();
    const isManagerSlot = memberUsesManagerSlot({}, role);
    
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
            body: JSON.stringify({
                name,
                passport,
                email,
                password,
                role,
                member_slot: isManagerSlot ? undefined : member_slot,
                manager_slot: isManagerSlot ? manager_slot : undefined
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            messageEl.textContent = 'Membro cadastrado com sucesso!';
            messageEl.className = 'message show success';
            document.getElementById('newMemberForm').reset();
            updateNewMemberSlotVisibility();
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

updateNewMemberSlotVisibility();

// Modal de imagem
function openModal(eventOrSrc, maybeSrc) {
    if (eventOrSrc && typeof eventOrSrc !== 'string' && typeof eventOrSrc.stopPropagation === 'function') {
        eventOrSrc.preventDefault?.();
        eventOrSrc.stopPropagation();
    }

    const src = typeof eventOrSrc === 'string' ? eventOrSrc : maybeSrc;
    const modal = document.getElementById('imageModal');
    const image = document.getElementById('modalImage');
    if (!modal || !image || !src) return;

    image.src = src;
    modal.style.display = 'flex';
    modal.classList.add('show');
    document.body.classList.add('image-modal-open');
}

function closeModal() {
    const modal = document.getElementById('imageModal');
    const image = document.getElementById('modalImage');
    if (!modal) return;

    modal.classList.remove('show');
    modal.style.display = 'none';
    if (image) image.src = '';
    document.body.classList.remove('image-modal-open');
}

document.getElementById('imageModal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget || e.target.classList.contains('modal-close')) {
        closeModal();
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('imageModal')?.classList.contains('show')) {
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
        const canRemoveAdv = canRemoveAdvWarnings();
        
        if (data.warnings && data.warnings.length > 0) {
            warningsList.innerHTML = data.warnings.map(w => `
                <div class="warning-item">
                    <div class="warning-info">
                        <strong>⚠️ ${escapeHtml(w.member_name)}</strong> <small>(${escapeHtml(w.member_passport)})</small>
                        <p class="warning-reason">${escapeHtml(w.reason)}</p>
                        <small>Por: ${escapeHtml(w.given_by_name)} em ${formatDate(w.created_at)}</small>
                    </div>
                    ${canRemoveAdv ? `
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

// Remover advertência (qualquer gerente)
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
    
    var icons = {'gerente_geral':'👑','01':'🥇','02':'🥈','gerente_farm':'🌾','gerente_acao':'⚡','gerente_recrutamento':'📋','gerente_encomendas':'📦','gerente_vendas':'💼','gerente_de_vendas':'💼'};
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
        'gerente_vendas': 'Gerente de Vendas',
        'gerente_de_vendas': 'Gerente de Vendas',
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
        
        const canRemoveAdv = canRemoveAdvWarnings();
        
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
        const weekParams = selectedWeek ? `?week_start=${encodeURIComponent(selectedWeek.start)}&week_end=${encodeURIComponent(selectedWeek.end)}&summary=1` : '?summary=1';
        const pendingRes = await fetch(`/api/admin/deliveries/pending${weekParams}`);
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

const editFarmTypeConfig = [
    { type: 'drugs', title: 'Meta de Drogas' },
    { type: 'weapons', title: 'Meta de Armas' },
    { type: 'general', title: 'Meta Geral' }
];

function normalizeEditFarmType(farmType) {
    const normalized = String(farmType || 'drugs')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return ['drugs', 'weapons', 'general'].includes(normalized) ? normalized : 'drugs';
}

function getEditDeliveryDisplayStatus(delivery) {
    if (!delivery) return 'not_delivered';
    const status = String(delivery.status || 'pending').toLowerCase();
    if (status === 'approved' && delivery.is_partial) return 'in_progress';
    return status;
}

function getEditStatusLabel(status) {
    const labels = {
        approved: 'Aprovado',
        in_progress: 'Em progresso',
        pending: 'Aguardando',
        rejected: 'Recusado',
        not_delivered: 'Nao entregou'
    };
    return labels[status] || status || '-';
}

function getEditDeliveryFarmGroups(data) {
    const allMaterials = data?.allMaterials || [];
    const deliveriesWithItems = data?.deliveriesWithItems || [];

    return editFarmTypeConfig.map(config => {
        const materials = allMaterials.filter(mat => normalizeEditFarmType(mat.farm_type) === config.type);
        if (materials.length === 0) return null;

        const submissions = deliveriesWithItems.filter(sub => {
            const items = sub.items || [];
            return items.some(item => normalizeEditFarmType(item.farm_type) === config.type);
        });
        const primary = submissions[0] || null;

        return {
            ...config,
            materials,
            delivery: primary?.delivery || null,
            deliveryId: primary?.delivery?.id || null,
            items: primary?.items || [],
            screenshots: primary?.screenshots || [],
            submissions,
            status: getEditDeliveryDisplayStatus(primary?.delivery || null)
        };
    }).filter(Boolean);
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
        
        const displayStatus = getEditDeliveryDisplayStatus(data.delivery);

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
        
        if (envioSelEl) {
            envioSelEl.style.display = 'none';
            envioSelEl.innerHTML = '';
        }
        document.getElementById('editDeliveryStatus').innerHTML = '<span class="edit-delivery-status-note">Status separado por drogas e armas</span>';
        renderEditDeliveryFarmGroups();
        
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

// Renderizacao separada por tipo de farm. Esta declaracao substitui a anterior.
function renderEditDeliveryFormForEnvio(envioIndex) {
    const data = window.__currentEditDeliveryDetailsData;
    if (!data || !data.deliveriesWithItems || !data.deliveriesWithItems[envioIndex]) return;

    const { delivery, items: deliveryItems, screenshots } = data.deliveriesWithItems[envioIndex];
    const allMaterials = data.allMaterials || [];

    currentEditDeliveryId = delivery.id;
    renderExistingScreenshots(screenshots || [], currentEditDeliveryId);

    const isApproved = (delivery.status || '').toLowerCase() === 'approved';
    const itemsToShow = isApproved ? deliveryItems : [];
    const groups = [
        { type: 'drugs', title: 'Meta de Drogas', items: allMaterials.filter(m => (m.farm_type || 'drugs') !== 'weapons' && (m.farm_type || 'drugs') !== 'general') },
        { type: 'weapons', title: 'Meta de Armas', items: allMaterials.filter(m => (m.farm_type || 'drugs') === 'weapons') },
        { type: 'general', title: 'Meta Geral', items: allMaterials.filter(m => (m.farm_type || 'drugs') === 'general') }
    ].filter(group => group.items.length > 0);

    const envioTypes = new Set((deliveryItems || []).map(item => (item.farm_type || 'drugs')));
    let itemsHtml = groups.map(group => `
        <div class="edit-delivery-farm-group">
            <div class="edit-delivery-farm-title">${group.title}${envioTypes.has(group.type) ? ' - este envio' : ''}</div>
            ${group.items.map(mat => {
                const existingItem = itemsToShow.find(i => i.material_id === mat.id || i.material_id == mat.id);
                const currentAmount = existingItem ? (existingItem.amount || 0) : 0;
                return `
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
            }).join('')}
        </div>
    `).join('');

    itemsHtml += `
        <button onclick="saveAllDeliveryItems()"
                style="width: 100%; margin-top: 15px; background: #27ae60; color: white; border: none; padding: 12px 20px; border-radius: 8px; cursor: pointer; font-size: 16px; font-weight: 600;">
            Salvar Alteracoes
        </button>
    `;

    document.getElementById('editDeliveryItems').innerHTML = itemsHtml;
}

function renderEditDeliveryFarmGroups() {
    const data = window.__currentEditDeliveryDetailsData;
    const container = document.getElementById('editDeliveryItems');
    if (!data || !container) return;

    const groups = getEditDeliveryFarmGroups(data);
    if (groups.length === 0) {
        container.innerHTML = '<p style="color: #888;">Nenhuma meta de material ativa para este membro.</p>';
        return;
    }

    const statusOptions = [
        { value: 'approved', label: 'Aprovado' },
        { value: 'in_progress', label: 'Em progresso' },
        { value: 'pending', label: 'Aguardando' },
        { value: 'rejected', label: 'Recusado' },
        { value: 'not_delivered', label: 'Nao entregou' }
    ];

    container.innerHTML = `
        <div class="edit-delivery-farm-grid">
            ${groups.map(group => {
                const deliveryId = group.deliveryId;
                const disabledAttr = deliveryId ? '' : 'disabled';
                const screenshotsHtml = group.screenshots.length > 0
                    ? group.screenshots.map(s => `
                        <div class="edit-farm-screenshot">
                            <img src="${escapeHtml(s.screenshot_url)}" onclick="window.open('${escapeHtml(s.screenshot_url)}', '_blank')" alt="Print ${escapeHtml(group.title)}">
                            <button type="button" onclick="removeScreenshot(${deliveryId}, ${s.id})">&times;</button>
                        </div>
                    `).join('')
                    : '<p class="edit-farm-empty">Sem prints enviados</p>';

                return `
                    <section class="edit-delivery-farm-card" data-farm-type="${group.type}" data-delivery-id="${deliveryId || ''}">
                        <div class="edit-delivery-farm-head">
                            <div>
                                <h4>${escapeHtml(group.title)}</h4>
                                <span>${deliveryId ? `Envio #${deliveryId}` : 'Sem envio deste farm'}</span>
                            </div>
                            <select class="edit-farm-status-select" data-farm-type="${group.type}" data-delivery-id="${deliveryId || ''}" data-original="${group.status}" ${disabledAttr}>
                                ${statusOptions.map(opt => `<option value="${opt.value}" ${group.status === opt.value ? 'selected' : ''}>${opt.label}</option>`).join('')}
                            </select>
                        </div>

                        <div class="edit-delivery-material-list">
                            ${group.materials.map(mat => {
                                const existingItem = group.items.find(i => Number(i.material_id) === Number(mat.id));
                                const currentAmount = existingItem ? (parseInt(existingItem.amount, 10) || 0) : 0;
                                return `
                                    <div class="edit-delivery-material-row">
                                        <span class="edit-delivery-material-icon">${escapeHtml(mat.icon || 'C')}</span>
                                        <div class="edit-delivery-material-info">
                                            <strong>${escapeHtml(mat.name)}</strong>
                                            <small>Meta: ${escapeHtml(mat.weekly_goal)}</small>
                                        </div>
                                        <input type="number"
                                               class="edit-delivery-item-input"
                                               value="${currentAmount}"
                                               min="0"
                                               data-delivery-id="${deliveryId || ''}"
                                               data-material-id="${mat.id}"
                                               data-original="${currentAmount}"
                                               data-name="${escapeHtml(mat.name)}"
                                               ${disabledAttr}>
                                    </div>
                                `;
                            }).join('')}
                        </div>

                        <div class="edit-farm-print-section">
                            <div class="edit-farm-print-title">Prints de ${escapeHtml(group.title)}</div>
                            <div class="edit-farm-existing-prints">${screenshotsHtml}</div>
                            <label class="edit-farm-upload ${deliveryId ? '' : 'disabled'}">
                                <input type="file"
                                       class="edit-farm-screenshot-input"
                                       accept="image/*"
                                       multiple
                                       data-farm-type="${group.type}"
                                       data-delivery-id="${deliveryId || ''}"
                                       onchange="previewEditFarmScreenshots(this)"
                                       ${disabledAttr}>
                                <span>Adicionar prints</span>
                                <div class="edit-farm-new-preview" data-preview-for="${group.type}"></div>
                            </label>
                        </div>
                    </section>
                `;
            }).join('')}
        </div>
        <button type="button" class="edit-delivery-save-btn" onclick="saveAllDeliveryItems()">Salvar Alteracoes</button>
    `;
}

function previewEditFarmScreenshots(input) {
    const farmType = input.dataset.farmType;
    const preview = document.querySelector(`.edit-farm-new-preview[data-preview-for="${farmType}"]`);
    if (!preview) return;
    preview.innerHTML = '';

    if (!input.files || input.files.length === 0) return;

    for (const file of input.files) {
        const reader = new FileReader();
        reader.onload = (event) => {
            const div = document.createElement('div');
            div.className = 'edit-farm-new-thumb';
            div.innerHTML = `<img src="${event.target.result}" alt="Novo print">`;
            preview.appendChild(div);
        };
        reader.readAsDataURL(file);
    }
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

// Versao separada por tipo de farm; sobrescreve a funcao antiga acima.
async function saveAllDeliveryItems() {
    const weekSel = document.getElementById('editWeekSelect');
    let newWeekStart = currentEditWeekStart;
    let newWeekEnd = currentEditWeekEnd;
    if (weekSel && weekSel.value) {
        const parts = weekSel.value.split('|');
        newWeekStart = parts[0];
        newWeekEnd = parts[1];
    }
    const weekChanged = newWeekStart !== currentEditWeekStart || newWeekEnd !== currentEditWeekEnd;

    const changes = [];
    document.querySelectorAll('.edit-delivery-item-input').forEach(input => {
        if (!input.dataset.deliveryId) return;
        const amount = parseInt(input.value, 10) || 0;
        const originalAmount = parseInt(input.dataset.original, 10) || 0;
        if (amount !== originalAmount) {
            changes.push({
                deliveryId: input.dataset.deliveryId,
                materialId: parseInt(input.dataset.materialId, 10),
                amount,
                originalAmount,
                materialName: input.dataset.name || 'Material',
                input
            });
        }
    });

    const statusChanges = [];
    document.querySelectorAll('.edit-farm-status-select').forEach(select => {
        if (!select.dataset.deliveryId) return;
        if (select.value !== select.dataset.original) {
            statusChanges.push({
                deliveryId: select.dataset.deliveryId,
                farmType: select.dataset.farmType,
                status: select.value,
                originalStatus: select.dataset.original,
                select
            });
        }
    });

    const screenshotUploads = [];
    document.querySelectorAll('.edit-farm-screenshot-input').forEach(input => {
        if (!input.dataset.deliveryId || !input.files || input.files.length === 0) return;
        screenshotUploads.push({
            deliveryId: input.dataset.deliveryId,
            farmType: input.dataset.farmType,
            input
        });
    });

    if (changes.length === 0 && statusChanges.length === 0 && screenshotUploads.length === 0 && !weekChanged) {
        showNotification('Nenhuma alteracao detectada', 'warning');
        return;
    }

    let confirmMsg = 'CONFIRMAR ALTERACOES:\n\n';
    if (weekChanged) {
        confirmMsg += `SEMANA: ${currentEditWeekStart} ~ ${currentEditWeekEnd}\n -> ${newWeekStart} ~ ${newWeekEnd}\n\n`;
    }
    if (statusChanges.length > 0) {
        confirmMsg += 'STATUS POR FARM:\n';
        statusChanges.forEach(change => {
            confirmMsg += `${change.farmType}: ${getEditStatusLabel(change.originalStatus)} -> ${getEditStatusLabel(change.status)}\n`;
        });
        confirmMsg += '\n';
    }
    if (changes.length > 0) {
        confirmMsg += 'MATERIAIS:\n';
        changes.forEach(change => {
            confirmMsg += `${change.materialName}: ${change.originalAmount} -> ${change.amount}\n`;
        });
        confirmMsg += '\n';
    }
    if (screenshotUploads.length > 0) {
        const totalFiles = screenshotUploads.reduce((sum, upload) => sum + upload.input.files.length, 0);
        confirmMsg += `${totalFiles} novo(s) print(s) serao adicionados.\n\n`;
    }
    confirmMsg += 'Deseja salvar estas alteracoes?';

    if (!confirm(confirmMsg)) return;

    let successCount = 0;
    let errorCount = 0;

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
                successCount++;
            } else {
                errorCount++;
                showNotification(`Erro ao alterar semana: ${escapeHtml(data.error)}`, 'error');
            }
        } catch (error) {
            console.error('Erro ao alterar semana:', error);
            errorCount++;
        }
    }

    for (const change of statusChanges) {
        try {
            const response = await fetch(`/api/admin/delivery/${change.deliveryId}/status`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ status: change.status })
            });
            const data = await response.json();
            if (data.success) {
                change.select.dataset.original = change.status;
                successCount++;
            } else {
                errorCount++;
                showNotification(`Erro ao salvar status ${change.farmType}: ${escapeHtml(data.error)}`, 'error');
            }
        } catch (error) {
            console.error('Erro ao salvar status separado:', error);
            errorCount++;
        }
    }

    for (const change of changes) {
        try {
            const response = await fetch(`/api/admin/delivery/${change.deliveryId}/item`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ materialId: change.materialId, amount: change.amount })
            });
            const data = await response.json();
            if (data.success) {
                change.input.dataset.original = String(change.amount);
                successCount++;
            } else {
                errorCount++;
                showNotification(`Erro ao salvar ${escapeHtml(change.materialName)}: ${escapeHtml(data.error)}`, 'error');
            }
        } catch (error) {
            console.error('Erro ao salvar item:', error);
            errorCount++;
        }
    }

    for (const upload of screenshotUploads) {
        const formData = new FormData();
        for (const file of upload.input.files) {
            formData.append('screenshots', file);
        }

        try {
            const response = await fetch(`/api/admin/delivery/${upload.deliveryId}/screenshots`, {
                method: 'POST',
                credentials: 'same-origin',
                body: formData
            });
            const data = await response.json();
            if (data.success) {
                successCount++;
            } else {
                errorCount++;
                showNotification(`Erro ao enviar prints ${upload.farmType}: ${escapeHtml(data.error)}`, 'error');
            }
        } catch (error) {
            console.error('Erro ao enviar prints:', error);
            errorCount++;
        }
    }

    if (errorCount === 0) {
        showNotification('Alteracoes salvas com sucesso!', 'success');
        closeEditDeliveryModal();
        setTimeout(() => window.location.reload(), 250);
    } else {
        showNotification(`${successCount} alteracao(oes) salva(s), ${errorCount} com erro`, 'warning');
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
// Versao para o modal separado por Drogas/Armas.
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
        if (!data.success) {
            throw new Error(data.error || 'Erro ao remover print');
        }

        const button = document.querySelector(`button[onclick="removeScreenshot(${deliveryId}, ${screenshotId})"]`);
        const thumb = button ? button.closest('.edit-farm-screenshot, .edit-screenshot-item') : null;
        if (thumb) thumb.remove();

        if (currentEditUserId && currentEditWeekStart && currentEditWeekEnd) {
            const detailsRes = await fetch(`/api/admin/week-delivery-details?userId=${currentEditUserId}&week_start=${currentEditWeekStart}&week_end=${currentEditWeekEnd}&_=${Date.now()}`, {
                credentials: 'same-origin'
            });
            const detailsData = await detailsRes.json();
            if (detailsData.success) {
                const deliveriesWithItems = detailsData.deliveriesWithItems || [{
                    delivery: detailsData.delivery,
                    items: detailsData.items || [],
                    screenshots: (detailsData.screenshots || []).filter(s => !s.delivery_id || s.delivery_id === detailsData.delivery.id)
                }];
                window.__currentEditDeliveryDetailsData = {
                    deliveriesWithItems,
                    allMaterials: detailsData.allMaterials || [],
                    delivery_count: detailsData.delivery?.delivery_count || deliveriesWithItems.length
                };
                renderEditDeliveryFarmGroups();
            }
        }

        showNotification('Print removido!', 'success');
        if (typeof loadWeeklyStatus === 'function') loadWeeklyStatus();
    } catch (error) {
        console.error('Erro ao remover screenshot:', error);
        showNotification(`${error.message}`, 'error');
    }
}

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

function formatWeaponSaleMoney(value) {
    return Number(value || 0).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    });
}

// Máscara de moeda BRL: digita números e o campo formata como R$ 1.234,56
function applyWeaponMoneyMask(input) {
    if (!input) return;
    const digits = String(input.value).replace(/\D/g, '');
    const amount = Number(digits) / 100;
    input.value = amount > 0 ? formatWeaponSaleMoney(amount) : '';
    input.dataset.rawValue = amount > 0 ? amount.toFixed(2) : '';
}

// Valor numérico de um campo com máscara de moeda
function getWeaponMoneyRaw(input) {
    if (!input) return '';
    if (input.dataset.rawValue !== undefined && input.dataset.rawValue !== '') {
        return input.dataset.rawValue;
    }
    const digits = String(input.value).replace(/\D/g, '');
    return digits ? (Number(digits) / 100).toFixed(2) : '';
}

function formatWeaponSaleDate(value) {
    if (!value) return '-';
    return new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('pt-BR');
}

function getWeaponSaleProofSrc(sale) {
    return sale.proof_data || sale.proof_url || '';
}

function getCurrentMonthValue() {
    return new Date().toISOString().slice(0, 7);
}

function getWeaponSalesQueryParams() {
    const monthInput = document.getElementById('weaponSalesMonth');
    const month = monthInput?.value || '';
    if (!/^\d{4}-\d{2}$/.test(month)) return '';

    const [year, monthNumber] = month.split('-').map(Number);
    const start = `${month}-01`;
    const end = new Date(year, monthNumber, 0).toISOString().slice(0, 10);
    return `?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
}

function clearWeaponSalesMonthFilter() {
    const monthInput = document.getElementById('weaponSalesMonth');
    if (monthInput) monthInput.value = '';
    loadWeaponSales();
}

function populateWeaponSalesMonthOptions() {
    const monthInput = document.getElementById('weaponSalesMonth');
    if (!monthInput || monthInput.options.length > 0) return;

    const options = ['<option value="">Todos os meses</option>'];
    const date = new Date();
    date.setDate(1);

    for (let i = 0; i < 18; i++) {
        const value = date.toISOString().slice(0, 7);
        const label = date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        options.push(`<option value="${value}">${label.charAt(0).toUpperCase() + label.slice(1)}</option>`);
        date.setMonth(date.getMonth() - 1);
    }

    monthInput.innerHTML = options.join('');
}

function setDefaultWeaponSalesMonth() {
    populateWeaponSalesMonthOptions();
    const monthInput = document.getElementById('weaponSalesMonth');
    if (monthInput && !monthInput.value) {
        monthInput.value = getCurrentMonthValue();
    }
}

let weaponStockCache = [];

function setWeaponMessage(elementId, message, type = 'success') {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = message;
    el.className = `message show ${type}`;
}

function renderWeaponSaleItems() {
    const container = document.getElementById('weaponSaleItems');
    if (!container) return;

    const rows = [...container.querySelectorAll('.weapon-sale-item-row')];
    if (rows.length === 0) {
        addWeaponSaleItemRow();
        return;
    }

    rows.forEach(row => {
        const select = row.querySelector('.weapon-sale-stock-select');
        const selectedValue = select?.value || '';
        if (select) {
            select.innerHTML = '<option value="">Selecione uma arma do estoque</option>' + weaponStockCache
                .filter(item => item.active !== 0 && item.active !== false)
                .map(item => {
                    const price = Number(item.sale_price || 0);
                    const priceLabel = price > 0 ? ` — ${formatWeaponSaleMoney(price)}` : ' — sem valor definido';
                    return `<option value="${item.id}" ${String(item.id) === selectedValue ? 'selected' : ''}>${escapeHtml(item.weapon_name)} (${Number(item.current_stock || 0).toLocaleString('pt-BR')} em estoque)${priceLabel}</option>`;
                })
                .join('');
        }
    });

    recalcWeaponSaleTotal();
}

// Recalcula o valor total da venda com base nos preços pré-definidos do catálogo
function recalcWeaponSaleTotal() {
    const valueInput = document.getElementById('weaponSaleValue');
    if (!valueInput) return;

    let total = 0;
    document.querySelectorAll('#weaponSaleItems .weapon-sale-item-row').forEach(row => {
        const select = row.querySelector('.weapon-sale-stock-select');
        const quantity = parseInt(row.querySelector('.weapon-sale-item-quantity')?.value, 10) || 0;
        const stock = weaponStockCache.find(item => String(item.id) === String(select?.value));
        total += Number(stock?.sale_price || 0) * quantity;
    });

    total = Math.round(total * 100) / 100;
    valueInput.value = total > 0 ? formatWeaponSaleMoney(total) : '';
    valueInput.dataset.rawValue = total > 0 ? total.toFixed(2) : '';
}

function addWeaponSaleItemRow() {
    const container = document.getElementById('weaponSaleItems');
    if (!container) return;

    const row = document.createElement('div');
    row.className = 'weapon-sale-item-row';
    row.innerHTML = `
        <select class="weapon-sale-stock-select" required onchange="recalcWeaponSaleTotal()"></select>
        <input type="number" class="weapon-sale-item-quantity" min="1" step="1" value="1" required oninput="recalcWeaponSaleTotal()">
        <button type="button" class="btn btn-danger btn-small weapon-remove-item" onclick="removeWeaponSaleItemRow(this)">×</button>
    `;
    container.appendChild(row);
    renderWeaponSaleItems();
}

function removeWeaponSaleItemRow(button) {
    const container = document.getElementById('weaponSaleItems');
    const row = button.closest('.weapon-sale-item-row');
    if (row) row.remove();
    if (container && container.querySelectorAll('.weapon-sale-item-row').length === 0) {
        addWeaponSaleItemRow();
    }
    recalcWeaponSaleTotal();
}

function collectWeaponSaleItems() {
    const rows = [...document.querySelectorAll('#weaponSaleItems .weapon-sale-item-row')];
    const items = rows.map(row => {
        const select = row.querySelector('.weapon-sale-stock-select');
        const quantityInput = row.querySelector('.weapon-sale-item-quantity');
        const stock = weaponStockCache.find(item => String(item.id) === String(select?.value));
        return {
            stock_id: select?.value || '',
            weapon_name: stock?.weapon_name || '',
            quantity: parseInt(quantityInput?.value, 10) || 0
        };
    }).filter(item => item.stock_id);

    if (items.length === 0) {
        throw new Error('Selecione pelo menos uma arma vendida');
    }

    for (const item of items) {
        const stock = weaponStockCache.find(s => String(s.id) === String(item.stock_id));
        if (!item.quantity || item.quantity <= 0) {
            throw new Error('Informe uma quantidade válida para cada arma');
        }
        if (stock && item.quantity > Number(stock.current_stock || 0)) {
            throw new Error(`Estoque insuficiente para ${stock.weapon_name}`);
        }
    }

    return items;
}

async function loadWeaponStock() {
    const stockContainer = document.getElementById('weaponStockBody');
    if (stockContainer) stockContainer.innerHTML = '<div class="loading">Carregando...</div>';

    try {
        const response = await fetch('/api/admin/weapon-stock');
        const data = await response.json();
        if (!response.ok || data.error) {
            throw new Error(data.error || 'Erro ao carregar estoque');
        }

        weaponStockCache = data.stock || [];
        renderWeaponSaleItems();
        renderWeaponProductionOptions();
        renderWeaponCatalog();

        const activeStock = weaponStockCache.filter(item => item.active !== 0 && item.active !== false);
        const stockModelsEl = document.getElementById('weaponStockModels');
        const stockTotalEl = document.getElementById('weaponStockTotal');
        const stockLowEl = document.getElementById('weaponStockLow');
        if (stockModelsEl) stockModelsEl.textContent = activeStock.length.toLocaleString('pt-BR');
        if (stockTotalEl) stockTotalEl.textContent = activeStock.reduce((sum, item) => sum + Number(item.current_stock || 0), 0).toLocaleString('pt-BR');
        if (stockLowEl) stockLowEl.textContent = activeStock.filter(item => Number(item.current_stock || 0) <= 2).length.toLocaleString('pt-BR');

        if (!stockContainer) return;
        if (weaponStockCache.length === 0) {
            stockContainer.innerHTML = '<div class="loading">Nenhuma arma cadastrada</div>';
            return;
        }

        stockContainer.innerHTML = weaponStockCache.map(item => {
            const currentStock = Number(item.current_stock || 0);
            const inactive = item.active === 0 || item.active === false;
            const low = !inactive && currentStock <= 2;
            return `
                <div class="weapon-stock-card ${inactive ? 'is-inactive' : ''} ${low ? 'is-low' : ''}">
                    <div class="weapon-stock-card-main">
                        <div>
                            <strong>${escapeHtml(item.weapon_name)}</strong>
                            <span>${inactive ? 'Inativo' : (low ? 'Estoque baixo' : 'Ativo')}</span>
                        </div>
                        <div class="weapon-stock-count">${currentStock.toLocaleString('pt-BR')}</div>
                    </div>
                    <div class="weapon-stock-actions">
                        <input type="number" id="weaponStockAdjust${item.id}" min="1" step="1" value="1" aria-label="Quantidade para ajustar">
                        <button class="btn btn-primary btn-small" onclick="adjustWeaponStock(${item.id}, 'add')">+</button>
                        <button class="btn btn-secondary btn-small" onclick="adjustWeaponStock(${item.id}, 'remove')">-</button>
                        <button class="btn btn-danger btn-small" onclick="toggleWeaponStock(${item.id})">${inactive ? 'Ativar' : 'Desativar'}</button>
                    </div>
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Erro ao carregar estoque de armas:', error);
        if (stockContainer) stockContainer.innerHTML = `<div class="loading">Erro: ${escapeHtml(error.message)}</div>`;
    }
}

async function loadWeaponProductionHistory() {
    const container = document.getElementById('weaponProductionHistory');
    if (container) container.innerHTML = '<div class="loading">Carregando...</div>';

    try {
        const response = await fetch('/api/admin/weapon-production');
        const data = await response.json();

        if (!response.ok || data.error) {
            throw new Error(data.error || 'Erro ao carregar fabricacoes');
        }

        const entries = data.entries || [];
        if (!container) return;

        if (entries.length === 0) {
            container.innerHTML = '<div class="loading">Nenhuma fabricação registrada</div>';
            return;
        }

        container.innerHTML = entries.slice(0, 8).map(entry => `
            <div class="weapon-production-entry">
                <div>
                    <strong>${escapeHtml(entry.weapon_name || '-')}</strong>
                    <span>${formatWeaponSaleDate(entry.production_date)}${entry.responsible_name ? ` · ${escapeHtml(entry.responsible_name)}` : ''}</span>
                    ${entry.notes ? `<small>${escapeHtml(entry.notes)}</small>` : ''}
                </div>
                <div class="weapon-production-qty">+${Number(entry.quantity || 0).toLocaleString('pt-BR')}</div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Erro ao carregar fabricacoes:', error);
        if (container) container.innerHTML = `<div class="loading">Erro: ${escapeHtml(error.message)}</div>`;
    }
}

// ===== Catálogo de Armas e Valores (Configurações) =====

async function loadWeaponCatalog() {
    const tbody = document.getElementById('weaponCatalogBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="loading">Carregando...</td></tr>';
    await loadWeaponStock();
}

function renderWeaponCatalog() {
    const tbody = document.getElementById('weaponCatalogBody');
    if (!tbody) return;

    if (weaponStockCache.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="loading">Nenhuma arma cadastrada. Use o formulário acima para cadastrar.</td></tr>';
        return;
    }

    tbody.innerHTML = weaponStockCache.map(item => {
        const inactive = item.active === 0 || item.active === false;
        const price = Number(item.sale_price || 0);
        const statusLabel = inactive
            ? '<span class="status-badge missing">Inativa</span>'
            : (price > 0
                ? '<span class="status-badge completed">Ativa</span>'
                : '<span class="status-badge pending">⚠️ Sem valor</span>');
        return `
            <tr>
                <td><strong>${escapeHtml(item.weapon_name)}</strong></td>
                <td>
                    <div class="weapon-stock-edit">
                        <input type="number" id="weaponCatalogStock${item.id}" min="0" step="1" value="${Number(item.current_stock || 0)}">
                    </div>
                </td>
                <td>
                    <div class="weapon-price-edit">
                        <input type="text" id="weaponPriceInput${item.id}" inputmode="numeric" value="${price > 0 ? formatWeaponSaleMoney(price).replace(/&/g, '&amp;').replace(/"/g, '&quot;') : ''}" placeholder="R$ 0,00" data-raw-value="${price > 0 ? price.toFixed(2) : ''}" oninput="applyWeaponMoneyMask(this)">
                    </div>
                </td>
                <td>${statusLabel}</td>
                <td>
                    <button class="btn btn-primary btn-small" onclick="saveWeaponCatalogRow(${item.id})">💾 Salvar</button>
                    <button class="btn btn-danger btn-small" onclick="toggleWeaponStock(${item.id})">${inactive ? 'Ativar' : 'Desativar'}</button>
                </td>
            </tr>
        `;
    }).join('');
}

// Salva estoque e valor de venda da linha do catálogo
async function saveWeaponCatalogRow(stockId) {
    const stockInput = document.getElementById(`weaponCatalogStock${stockId}`);
    const priceInput = document.getElementById(`weaponPriceInput${stockId}`);

    try {
        const newStock = parseInt(stockInput?.value, 10);
        if (!Number.isInteger(newStock) || newStock < 0) {
            throw new Error('Informe um estoque válido (0 ou mais)');
        }

        const stockResponse = await fetch(`/api/admin/weapon-stock/${stockId}/adjust`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'set', quantity: newStock })
        });
        const stockData = await stockResponse.json();
        if (!stockResponse.ok || stockData.error) {
            throw new Error(stockData.error || 'Erro ao salvar estoque');
        }

        const priceResponse = await fetch(`/api/admin/weapon-stock/${stockId}/price`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sale_price: getWeaponMoneyRaw(priceInput) })
        });
        const priceData = await priceResponse.json();
        if (!priceResponse.ok || priceData.error) {
            throw new Error(priceData.error || 'Erro ao salvar valor');
        }

        showNotification('Arma atualizada: estoque e valor salvos', 'success');
        await loadWeaponStock();
    } catch (error) {
        alert(error.message);
    }
}

async function submitWeaponStock(event) {
    event.preventDefault();

    try {
        const response = await fetch('/api/admin/weapon-stock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                weapon_name: document.getElementById('weaponStockName').value.trim(),
                quantity: document.getElementById('weaponStockQuantity').value,
                sale_price: getWeaponMoneyRaw(document.getElementById('weaponStockPrice')) || 0
            })
        });
        const data = await response.json();
        if (!response.ok || data.error) {
            throw new Error(data.error || 'Erro ao cadastrar arma');
        }

        setWeaponMessage('weaponStockMessage', data.message || 'Arma cadastrada com sucesso', 'success');
        document.getElementById('weaponStockForm').reset();
        document.getElementById('weaponStockQuantity').value = 0;
        await loadWeaponStock();
        await loadWeaponProductionHistory();
    } catch (error) {
        setWeaponMessage('weaponStockMessage', error.message, 'error');
    }
}

async function submitWeaponProduction(event) {
    event.preventDefault();

    try {
        const response = await fetch('/api/admin/weapon-production', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                stock_id: document.getElementById('weaponProductionStock').value,
                quantity: document.getElementById('weaponProductionQuantity').value,
                production_date: document.getElementById('weaponProductionDate').value,
                responsible_name: document.getElementById('weaponProductionResponsible').value.trim(),
                notes: document.getElementById('weaponProductionNotes').value.trim()
            })
        });
        const data = await response.json();
        if (!response.ok || data.error) {
            throw new Error(data.error || 'Erro ao registrar fabricacao');
        }

        setWeaponMessage('weaponProductionMessage', data.message || 'Entrada registrada', 'success');
        document.getElementById('weaponProductionForm').reset();
        setDefaultWeaponProductionDate();
        document.getElementById('weaponProductionQuantity').value = 1;
        await loadWeaponStock();
        await loadWeaponProductionHistory();
    } catch (error) {
        setWeaponMessage('weaponProductionMessage', error.message, 'error');
    }
}

async function adjustWeaponStock(stockId, type) {
    const quantityInput = document.getElementById(`weaponStockAdjust${stockId}`);
    const quantity = parseInt(quantityInput?.value, 10);
    if (!Number.isInteger(quantity) || quantity <= 0) {
        alert('Informe uma quantidade válida');
        return;
    }

    try {
        const response = await fetch(`/api/admin/weapon-stock/${stockId}/adjust`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, quantity })
        });
        const data = await response.json();
        if (!response.ok || data.error) {
            throw new Error(data.error || 'Erro ao ajustar estoque');
        }
        await loadWeaponStock();
    } catch (error) {
        alert(error.message);
    }
}

async function toggleWeaponStock(stockId) {
    try {
        const response = await fetch(`/api/admin/weapon-stock/${stockId}/toggle`, { method: 'POST' });
        const data = await response.json();
        if (!response.ok || data.error) {
            throw new Error(data.error || 'Erro ao alterar status');
        }
        await loadWeaponStock();
    } catch (error) {
        alert(error.message);
    }
}

// ===== Vendedores (gerentes) =====

async function loadWeaponSellers() {
    const container = document.getElementById('weaponSaleSellers');
    if (!container) return;

    try {
        const response = await fetch('/api/admin/weapon-sellers');
        const data = await response.json();
        if (!response.ok || data.error) {
            throw new Error(data.error || 'Erro ao carregar vendedores');
        }

        const sellers = data.sellers || [];
        if (sellers.length === 0) {
            container.innerHTML = '<div class="loading">Nenhum gerente ativo encontrado</div>';
            return;
        }

        container.innerHTML = sellers.map(seller => `
            <label class="weapon-seller-option">
                <input type="checkbox" class="weapon-sale-seller-check" value="${escapeHtml(seller.name)}">
                <span>${escapeHtml(seller.name)}${seller.passport ? ` <small>(${escapeHtml(seller.passport)})</small>` : ''}</span>
            </label>
        `).join('');
    } catch (error) {
        console.error('Erro ao carregar vendedores:', error);
        container.innerHTML = `<div class="loading">Erro: ${escapeHtml(error.message)}</div>`;
    }
}

function collectWeaponSaleSellers() {
    return [...document.querySelectorAll('#weaponSaleSellers .weapon-sale-seller-check:checked')]
        .map(checkbox => checkbox.value);
}

async function loadWeaponSales() {
    const tbody = document.getElementById('weaponSalesBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="8" class="loading">Carregando...</td></tr>';

    try {
        await loadWeaponStock();
        await loadWeaponProductionHistory();
        await loadWeaponSellers();
        const response = await fetch(`/api/admin/weapon-sales${getWeaponSalesQueryParams()}`);
        const data = await response.json();

        if (!response.ok || data.error) {
            throw new Error(data.error || 'Erro ao carregar vendas');
        }

        const stats = data.stats || {};
        const countEl = document.getElementById('weaponSalesCount');
        const quantityEl = document.getElementById('weaponSalesQuantity');
        const totalEl = document.getElementById('weaponSalesTotal');
        if (countEl) countEl.textContent = Number(stats.total_sales || 0).toLocaleString('pt-BR');
        if (quantityEl) quantityEl.textContent = Number(stats.total_quantity || 0).toLocaleString('pt-BR');
        if (totalEl) totalEl.textContent = formatWeaponSaleMoney(stats.total_value || 0);

        const sales = data.sales || [];
        if (sales.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="loading">Nenhuma venda registrada</td></tr>';
            return;
        }

        tbody.innerHTML = sales.map(sale => `
            <tr>
                <td>${formatWeaponSaleDate(sale.sale_date)}</td>
                <td><strong>${(sale.items || []).map(item => `${escapeHtml(item.weapon_name)} x${Number(item.quantity || 0).toLocaleString('pt-BR')}`).join('<br>')}</strong>${sale.notes ? `<br><small>${escapeHtml(sale.notes)}</small>` : ''}</td>
                <td>${(sale.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0).toLocaleString('pt-BR')}</td>
                <td>${formatWeaponSaleMoney(sale.sale_value)}</td>
                <td>${escapeHtml(sale.buyer_name || '-')}</td>
                <td>${escapeHtml(sale.seller_name || sale.created_by_name || '-')}</td>
                <td>${getWeaponSaleProofSrc(sale) ? `<img src="${getWeaponSaleProofSrc(sale)}" class="delivery-screenshot" style="width:72px;height:54px;object-fit:cover;cursor:pointer;border-radius:6px;" onclick="openModal(event, '${getWeaponSaleProofSrc(sale)}')" onerror="this.outerHTML='<span class=&quot;no-prints&quot;>Print indisponível</span>'">` : '<span class="no-prints">Sem print</span>'}</td>
                <td>
                    <button class="btn btn-danger btn-small" onclick="deleteWeaponSale(${sale.id})">Remover</button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Erro ao carregar vendas de armas:', error);
        tbody.innerHTML = `<tr><td colspan="8" class="loading">Erro: ${escapeHtml(error.message)}</td></tr>`;
    }
}

async function submitWeaponSale(event) {
    event.preventDefault();

    const messageEl = document.getElementById('weaponSaleMessage');
    const form = document.getElementById('weaponSaleForm');
    const proofInput = document.getElementById('weaponSaleProof');

    try {
        const items = collectWeaponSaleItems();

        const sellers = collectWeaponSaleSellers();
        if (sellers.length === 0) {
            throw new Error('Selecione pelo menos um vendedor (gerente)');
        }

        const formData = new FormData();
        formData.append('weapon_items', JSON.stringify(items));
        formData.append('sale_value', getWeaponMoneyRaw(document.getElementById('weaponSaleValue')));
        formData.append('sale_date', document.getElementById('weaponSaleDate').value);
        formData.append('buyer_name', document.getElementById('weaponSaleBuyer').value.trim());
        formData.append('seller_name', sellers.join(', '));
        formData.append('notes', document.getElementById('weaponSaleNotes').value.trim());

        if (proofInput.files && proofInput.files[0]) {
            formData.append('screenshots', proofInput.files[0]);
        }

        const response = await fetch('/api/admin/weapon-sales', {
            method: 'POST',
            body: formData
        });
        const data = await response.json();

        if (!response.ok || data.error) {
            throw new Error(data.error || 'Erro ao registrar venda');
        }

        if (messageEl) {
            messageEl.textContent = data.message || 'Venda registrada com sucesso';
            messageEl.className = 'message show success';
        }
        form.reset();
        setDefaultWeaponSaleDate();
        document.getElementById('weaponSaleItems').innerHTML = '';
        addWeaponSaleItemRow();
        await loadWeaponSales();
    } catch (error) {
        if (messageEl) {
            messageEl.textContent = error.message;
            messageEl.className = 'message show error';
        } else {
            alert(error.message);
        }
    }
}

async function deleteWeaponSale(saleId) {
    if (!confirm('Remover esta venda do extrato?')) return;

    try {
        const response = await fetch(`/api/admin/weapon-sales/${saleId}`, { method: 'DELETE' });
        const data = await response.json();
        if (!response.ok || data.error) {
            throw new Error(data.error || 'Erro ao remover venda');
        }
        await loadWeaponStock();
        await loadWeaponSales();
    } catch (error) {
        alert(error.message);
    }
}

let weaponFreebieCache = null;

function getWeaponFreebieType(item) {
    const name = String(item?.weapon_name || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    const compact = name.replace(/[^a-z0-9]/g, '');
    const tokens = name.split(/[^a-z0-9]+/).filter(Boolean);
    if (compact.includes('mtar')) return 'MTAR';
    if (compact.includes('ia2')) return 'IA2';
    if (tokens.includes('ia') || name === 'ia') return 'IA';
    return 'Arma';
}

function isWeaponFreebieStockItem(item) {
    return item && item.active !== 0 && item.active !== false;
}

function updateWeaponFreebieSelectedCount() {
    const countEl = document.getElementById('weaponFreebieSelectedCount');
    if (!countEl) return;
    const selected = document.querySelectorAll('.weapon-freebie-member-check:checked').length;
    countEl.textContent = `${selected} membro${selected === 1 ? '' : 's'} selecionado${selected === 1 ? '' : 's'}`;
}

function setWeaponFreebieCardStock(userId, stockId) {
    const card = document.querySelector(`.weapon-freebie-member-option[data-user-id="${userId}"]`);
    if (!card) return;

    const hiddenInput = card.querySelector('.weapon-freebie-card-stock');
    if (hiddenInput) hiddenInput.value = stockId || '';

    const checkbox = card.querySelector('.weapon-freebie-member-check');
    if (checkbox && !checkbox.disabled) checkbox.checked = true;

    card.querySelectorAll('.weapon-freebie-weapon-card').forEach(button => {
        button.classList.toggle('is-selected', String(button.dataset.stockId) === String(stockId));
    });

    updateWeaponFreebieSelectedCount();
}

function filterWeaponFreebieMembers() {
    const searchInput = document.getElementById('weaponFreebieMemberSearch');
    const term = String(searchInput?.value || '').trim().toLowerCase();
    document.querySelectorAll('.weapon-freebie-member-option').forEach(option => {
        const haystack = String(option.dataset.search || '').toLowerCase();
        option.style.display = !term || haystack.includes(term) ? '' : 'none';
    });
}

function renderWeaponProductionOptions() {
    const select = document.getElementById('weaponProductionStock');
    if (!select) return;

    const selectedValue = select.value || '';
    const activeStock = weaponStockCache.filter(item => item.active !== 0 && item.active !== false);
    select.innerHTML = '<option value="">Selecione uma arma</option>' + activeStock
        .map(item => `
            <option value="${item.id}" ${String(item.id) === selectedValue ? 'selected' : ''}>
                ${escapeHtml(item.weapon_name)} (${Number(item.current_stock || 0).toLocaleString('pt-BR')} em estoque)
            </option>
        `)
        .join('');
}

function selectAllVisibleWeaponFreebieMembers() {
    document.querySelectorAll('.weapon-freebie-member-option').forEach(option => {
        if (option.style.display === 'none') return;
        const checkbox = option.querySelector('.weapon-freebie-member-check');
        if (checkbox && !checkbox.disabled) {
            checkbox.checked = true;
            const hiddenStock = option.querySelector('.weapon-freebie-card-stock');
            if (hiddenStock && !hiddenStock.value) {
                const firstWeapon = option.querySelector('.weapon-freebie-weapon-card:not(:disabled)');
                if (firstWeapon) setWeaponFreebieCardStock(option.dataset.userId, firstWeapon.dataset.stockId);
            }
        }
    });
    updateWeaponFreebieSelectedCount();
}

function clearWeaponFreebieMembers() {
    document.querySelectorAll('.weapon-freebie-member-check').forEach(checkbox => {
        checkbox.checked = false;
    });
    updateWeaponFreebieSelectedCount();
}

function collectWeaponFreebieAssignments() {
    const assignments = [];
    const errors = [];

    document.querySelectorAll('.weapon-freebie-member-option').forEach(card => {
        const checkbox = card.querySelector('.weapon-freebie-member-check');
        if (!checkbox || !checkbox.checked) return;

        const userId = checkbox.value;
        const memberName = card.querySelector('.weapon-freebie-member-identity strong')?.textContent || `Membro ${userId}`;
        const stockId = card.querySelector('.weapon-freebie-card-stock')?.value || '';
        const quantityInput = card.querySelector('.weapon-freebie-card-quantity');
        const quantity = parseInt(quantityInput?.value, 10);

        if (!stockId) {
            errors.push(`${memberName}: selecione uma arma`);
            return;
        }

        if (!Number.isInteger(quantity) || quantity <= 0) {
            errors.push(`${memberName}: quantidade invalida`);
            return;
        }

        assignments.push({
            user_id: userId,
            stock_id: stockId,
            quantity
        });
    });

    if (errors.length > 0) {
        throw new Error(errors.join(' | '));
    }

    if (assignments.length === 0) {
        throw new Error('Selecione pelo menos um membro');
    }

    return assignments;
}

function getWeaponFreebieStockButtons(memberId, stockItems, selectedStock) {
    if (stockItems.length === 0) {
        return '<div class="loading">Cadastre armas ativas em Armas e Valores</div>';
    }

    return stockItems.map(item => {
        const stock = Number(item.current_stock || 0);
        const disabled = stock <= 0;
        const type = getWeaponFreebieType(item);
        return `
            <button
                type="button"
                class="weapon-freebie-weapon-card ${String(item.id) === String(selectedStock) ? 'is-selected' : ''} ${disabled ? 'is-disabled' : ''}"
                data-stock-id="${item.id}"
                onclick="${disabled ? '' : `setWeaponFreebieCardStock(${memberId}, ${item.id})`}"
                ${disabled ? 'disabled' : ''}
            >
                <span>${escapeHtml(type)}</span>
                <strong>${escapeHtml(item.weapon_name)}</strong>
                <small>${stock.toLocaleString('pt-BR')}</small>
            </button>
        `;
    }).join('');
}

function renderWeaponFreebieOptions(data) {
    const memberChecklist = document.getElementById('weaponFreebieMemberChecklist');
    const weaponOptions = document.getElementById('weaponFreebieWeaponOptions');
    if (!memberChecklist || !weaponOptions) return;

    const selectedMembers = new Set([...document.querySelectorAll('.weapon-freebie-member-check:checked')].map(input => String(input.value)));
    const selectedStockByMember = new Map([...document.querySelectorAll('.weapon-freebie-member-option')].map(card => {
        const input = card.querySelector('.weapon-freebie-card-stock');
        return [String(card.dataset.userId), input?.value || ''];
    }));
    const quantityByMember = new Map([...document.querySelectorAll('.weapon-freebie-member-option')].map(card => {
        const input = card.querySelector('.weapon-freebie-card-quantity');
        return [String(card.dataset.userId), input?.value || '1'];
    }));

    const freebieStock = (data.stock || []).filter(isWeaponFreebieStockItem);
    weaponOptions.innerHTML = freebieStock
        .map(item => {
            const stock = Number(item.current_stock || 0);
            const type = getWeaponFreebieType(item);
            return `
                <div class="weapon-freebie-stock-summary">
                    <span>${escapeHtml(type)}</span>
                    <strong>${escapeHtml(item.weapon_name)}</strong>
                    <small>${stock.toLocaleString('pt-BR')} em estoque</small>
                </div>
            `;
        })
        .join('') || '<div class="loading">Cadastre armas ativas em Armas e Valores</div>';

    memberChecklist.innerHTML = (data.members || [])
        .map(member => {
            const disabled = Number(member.remaining || 0) <= 0;
            const selectedStock = selectedStockByMember.get(String(member.id)) || '';
            const selectedQuantity = quantityByMember.get(String(member.id)) || '1';
            const maxQuantity = Math.max(1, Number(member.remaining || 1));
            return `
                <div class="weapon-freebie-member-option ${disabled ? 'is-disabled' : ''}" data-user-id="${member.id}" data-search="${escapeHtml(`${member.name} ${member.passport || ''}`)}">
                    <div class="weapon-freebie-member-row">
                        <label class="weapon-freebie-member-identity">
                            <input
                                type="checkbox"
                                class="weapon-freebie-member-check"
                                value="${member.id}"
                                ${disabled ? 'disabled' : ''}
                                ${selectedMembers.has(String(member.id)) && !disabled ? 'checked' : ''}
                                onchange="updateWeaponFreebieSelectedCount()"
                            >
                            <span>
                                <strong>${escapeHtml(member.name)}</strong>
                                <small>#${escapeHtml(member.passport || '-')} - ${member.status}</small>
                            </span>
                        </label>
                        <div class="weapon-freebie-card-count">${member.status}</div>
                    </div>
                    <input type="hidden" class="weapon-freebie-card-stock" value="${escapeHtml(selectedStock)}">
                    <div class="weapon-freebie-card-weapons">
                        ${getWeaponFreebieStockButtons(member.id, freebieStock, selectedStock)}
                    </div>
                    <div class="weapon-freebie-card-controls">
                        <label>Qtd.</label>
                        <input
                            type="number"
                            class="weapon-freebie-card-quantity"
                            min="1"
                            max="${maxQuantity}"
                            step="1"
                            value="${escapeHtml(selectedQuantity)}"
                        >
                    </div>
                </div>
            `;
        })
        .join('') || '<div class="loading">Nenhum membro ativo encontrado</div>';
    filterWeaponFreebieMembers();
    updateWeaponFreebieSelectedCount();
}

function getWeaponFreebieStatusClass(member) {
    const used = Number(member.used || 0);
    const limit = Number(member.limit || 3);
    if (used >= limit) return 'is-complete';
    if (used > 0) return 'is-progress';
    return 'is-empty';
}

function renderWeaponFreebies(data) {
    const weekLabel = document.getElementById('weaponFreebieWeekLabel');
    const membersContainer = document.getElementById('weaponFreebieMembers');
    const historyBody = document.getElementById('weaponFreebieHistoryBody');
    const stats = data.stats || {};

    if (weekLabel && data.week) {
        weekLabel.textContent = data.week.label || `${formatWeaponSaleDate(data.week.start)} ate ${formatWeaponSaleDate(data.week.end)}`;
    }

    const usedEl = document.getElementById('weaponFreebieUsed');
    const completedEl = document.getElementById('weaponFreebieCompleted');
    const remainingEl = document.getElementById('weaponFreebieRemaining');
    if (usedEl) usedEl.textContent = Number(stats.used || 0).toLocaleString('pt-BR');
    if (completedEl) completedEl.textContent = Number(stats.completed || 0).toLocaleString('pt-BR');
    if (remainingEl) remainingEl.textContent = Number(stats.remaining || 0).toLocaleString('pt-BR');

    renderWeaponFreebieOptions(data);

    if (membersContainer) {
        const members = data.members || [];
        if (members.length === 0) {
            membersContainer.innerHTML = '<div class="loading">Nenhum membro ativo encontrado</div>';
        } else {
            membersContainer.innerHTML = members.map(member => {
                const used = Number(member.used || 0);
                const limit = Number(member.limit || 3);
                const percentage = Math.min(100, Math.round((used / limit) * 100));
                return `
                    <div class="weapon-freebie-member-card ${getWeaponFreebieStatusClass(member)}">
                        <div class="weapon-freebie-member-top">
                            <div>
                                <strong>${escapeHtml(member.name)}</strong>
                                <span>#${escapeHtml(member.passport || '-')}</span>
                            </div>
                            <div class="weapon-freebie-counter">${used}/${limit}</div>
                        </div>
                        <div class="weapon-freebie-progress">
                            <span style="width:${percentage}%"></span>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }

    if (historyBody) {
        const entries = data.entries || [];
        if (entries.length === 0) {
            historyBody.innerHTML = '<tr><td colspan="7" class="loading">Nenhuma retirada registrada nesta semana</td></tr>';
        } else {
            historyBody.innerHTML = entries.map(entry => `
                <tr>
                    <td>${formatWeaponSaleDate(entry.created_at)}</td>
                    <td><strong>${escapeHtml(entry.user_name || '-')}</strong></td>
                    <td>${escapeHtml(entry.user_passport || '-')}</td>
                    <td>${escapeHtml(entry.weapon_name || '-')}</td>
                    <td>${Number(entry.quantity || 0).toLocaleString('pt-BR')}</td>
                    <td>${escapeHtml(entry.created_by_name || '-')}</td>
                    <td><button class="btn btn-danger btn-small" onclick="deleteWeaponFreebie(${entry.id})">Remover</button></td>
                </tr>
            `).join('');
        }
    }
}

async function loadWeaponFreebies() {
    const membersContainer = document.getElementById('weaponFreebieMembers');
    const historyBody = document.getElementById('weaponFreebieHistoryBody');
    if (membersContainer) membersContainer.innerHTML = '<div class="loading">Carregando...</div>';
    if (historyBody) historyBody.innerHTML = '<tr><td colspan="7" class="loading">Carregando...</td></tr>';

    try {
        const response = await fetch('/api/admin/weapon-freebies');
        const data = await response.json();
        if (!response.ok || data.error) {
            throw new Error(data.error || 'Erro ao carregar retiradas gratuitas');
        }

        weaponFreebieCache = data;
        renderWeaponFreebies(data);
    } catch (error) {
        console.error('Erro ao carregar retiradas gratuitas:', error);
        if (membersContainer) membersContainer.innerHTML = `<div class="loading">Erro: ${escapeHtml(error.message)}</div>`;
        if (historyBody) historyBody.innerHTML = `<tr><td colspan="7" class="loading">Erro: ${escapeHtml(error.message)}</td></tr>`;
    }
}

async function submitWeaponFreebie(event) {
    event.preventDefault();

    const messageEl = document.getElementById('weaponFreebieMessage');
    try {
        const response = await fetch('/api/admin/weapon-freebies', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                assignments: collectWeaponFreebieAssignments()
            })
        });
        const data = await response.json();
        if (!response.ok || data.error) {
            throw new Error(data.error || 'Erro ao registrar retirada');
        }

        if (messageEl) {
            messageEl.textContent = data.message || 'Retirada registrada';
            messageEl.className = 'message show success';
        }
        clearWeaponFreebieMembers();
        await loadWeaponFreebies();
        await loadWeaponStock();
    } catch (error) {
        if (messageEl) {
            messageEl.textContent = error.message;
            messageEl.className = 'message show error';
        } else {
            alert(error.message);
        }
    }
}

async function deleteWeaponFreebie(freebieId) {
    if (!confirm('Remover esta retirada e devolver a arma ao estoque?')) return;

    try {
        const response = await fetch(`/api/admin/weapon-freebies/${freebieId}`, { method: 'DELETE' });
        const data = await response.json();
        if (!response.ok || data.error) {
            throw new Error(data.error || 'Erro ao remover retirada');
        }
        await loadWeaponFreebies();
        await loadWeaponStock();
    } catch (error) {
        alert(error.message);
    }
}

function setDefaultWeaponSaleDate() {
    const dateInput = document.getElementById('weaponSaleDate');
    if (dateInput && !dateInput.value) {
        dateInput.value = new Date().toISOString().slice(0, 10);
    }
}

function setDefaultWeaponProductionDate() {
    const dateInput = document.getElementById('weaponProductionDate');
    if (dateInput && !dateInput.value) {
        dateInput.value = new Date().toISOString().slice(0, 10);
    }
}

const weaponSaleForm = document.getElementById('weaponSaleForm');
if (weaponSaleForm) {
    weaponSaleForm.addEventListener('submit', submitWeaponSale);
    setDefaultWeaponSaleDate();
    setDefaultWeaponSalesMonth();
    addWeaponSaleItemRow();
}

const weaponStockForm = document.getElementById('weaponStockForm');
if (weaponStockForm) {
    weaponStockForm.addEventListener('submit', submitWeaponStock);
}

const weaponProductionForm = document.getElementById('weaponProductionForm');
if (weaponProductionForm) {
    weaponProductionForm.addEventListener('submit', submitWeaponProduction);
    setDefaultWeaponProductionDate();
}

const weaponSalesMonthInput = document.getElementById('weaponSalesMonth');
if (weaponSalesMonthInput) {
    weaponSalesMonthInput.addEventListener('change', loadWeaponSales);
}

const weaponFreebieForm = document.getElementById('weaponFreebieForm');
if (weaponFreebieForm) {
    weaponFreebieForm.addEventListener('submit', submitWeaponFreebie);
}

// Inicializa
(async function() {
    await loadRoleNames(); // Carregar nomes dos grupos do banco primeiro
    checkAuth();
})();
