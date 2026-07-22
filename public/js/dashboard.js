let currentUser = null;
let currentWeekData = null;
let currentWeekOffset = 0;
let weeklyGoal = 700;
let materialsGoals = {};
let materialsData = []; // Lista de materiais com nome, icon, etc
let availableWeeksData = [];
let notifications = [];
let currentPaymentType = 'material'; // 'material' ou tipo de pagamento ID
let currentPaymentTypeId = null; // ID do tipo de pagamento selecionado
let paymentTypes = []; // Lista de tipos de pagamento carregados do banco
let screenshotFilesDirty = []; // Screenshots para pagamento alternativo
let farmScreenshotFiles = { drugs: [], weapons: [], general: [] };

function normalizeFarmTypeClient(type) {
    return ['weapons', 'general'].includes(type) ? type : 'drugs';
}

function getFarmTypeLabelClient(type) {
    const normalized = normalizeFarmTypeClient(type);
    if (normalized === 'weapons') return 'Armas';
    if (normalized === 'general') return 'Geral';
    return 'Drogas';
}

function getFarmTypeTitleClient(type) {
    const normalized = normalizeFarmTypeClient(type);
    if (normalized === 'weapons') return 'Farm de Material de Armas';
    if (normalized === 'general') return 'Farm de Materiais';
    return 'Farm de Material de Drogas';
}

function formatPaymentGoal(pt, value) {
    if (!pt) return String(value || 0);
    const v = Number(value ?? 0);
    return pt.unit_type === 'unidade' ? `${v.toLocaleString('pt-BR')} un.` : `R$ ${v.toLocaleString('pt-BR')}`;
}
let pastScreenshotFiles = []; // Screenshots para pagamento de semana passada
let selectedPastWeek = null; // Semana passada selecionada para pagar
let extraScreenshotFiles = []; // Screenshots para farm extra ranking
let myDeliveriesCache = [];

// Helper para escapar HTML ao usar innerHTML
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeRoleName(role) {
    return String(role || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

const adminRoles = ['super_admin', '01', '02', 'gerente_farm', 'gerente_acao', 'gerente_recrutamento', 'gerente_encomendas', 'gerente_vendas', 'gerente_de_vendas', 'gerente_geral'];

// Nomes de exibição dos grupos (carregados dinamicamente do banco)
let roleNames = {};

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

// Saudação por horário + slot do membro no resumo
function renderWelcomeAndSlot(user) {
    if (!user) return;

    // Saudação amigável pelo horário
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
    const vulgo = user.capital_nickname || user.name || 'membro';
    const greetEl = document.getElementById('welcomeGreeting');
    const nameEl = document.getElementById('welcomeName');
    if (greetEl) greetEl.textContent = greeting;
    if (nameEl) nameEl.textContent = vulgo;

    // Determina o slot correto conforme o cargo
    const managerRoles = ['super_admin', 'gerente_geral', 'gerente_farm', 'gerente_acao', 'gerente_recrutamento', 'gerente_encomendas', 'gerente_vendas', 'gerente_de_vendas', 'gerente_de_fabricacao', '01', '02'];
    const groups = (user.groups && user.groups.length) ? user.groups : (user.role ? [user.role] : []);
    const isManager = groups.some(g => managerRoles.includes(g) || String(g || '').startsWith('gerente_'));
    const slot = isManager ? user.manager_slot : user.member_slot;
    const slotLabel = isManager ? '📦 Baú da Gerência' : '📦 Baú dos Membros';
    const slotText = (slot !== null && slot !== undefined && String(slot).trim() !== '') ? `#${String(slot).trim()}` : null;

    // Tile no "Meu Resumo"
    const tileValue = document.getElementById('slotSummaryValue');
    const tileLabel = document.getElementById('slotSummaryLabel');
    if (tileValue) tileValue.textContent = slotText || '—';
    if (tileLabel) tileLabel.textContent = slotLabel;

    // Chip no banner de boas-vindas (só aparece se tiver slot)
    const welcomeSlot = document.getElementById('welcomeSlot');
    const welcomeSlotLabel = document.getElementById('welcomeSlotLabel');
    const welcomeSlotValue = document.getElementById('welcomeSlotValue');
    if (welcomeSlot && welcomeSlotValue) {
        if (slotText) {
            if (welcomeSlotLabel) welcomeSlotLabel.textContent = isManager ? 'Baú da Gerência' : 'Baú dos Membros';
            welcomeSlotValue.textContent = slotText;
            welcomeSlot.style.display = '';
        } else {
            welcomeSlot.style.display = 'none';
        }
    }
}

// Verifica autenticação
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
        
        if (data.user) {
            if (data.user.commandments_required) {
                if (typeof showFamilyCommandmentsGate === 'function') {
                    await showFamilyCommandmentsGate({ onAccepted: () => window.location.reload() });
                } else {
                    window.location.href = '/family-commandments';
                }
                return;
            }

            currentUser = data.user;
            document.getElementById('userName').textContent = currentUser.name;
            renderWelcomeAndSlot(currentUser);
            if (typeof ensureCapitalNicknameModal === 'function') {
                ensureCapitalNicknameModal(currentUser);
            }
            
            // Usar grupos se disponível, senão usar role
            const userGroups = data.user.groups || [data.user.role];
            const primaryRole = userGroups[0] || data.user.role;
            
            console.log('👤 Usuário logado:', currentUser.name);
            console.log('📋 Grupos do usuário:', userGroups);
            console.log('🎯 Role primário:', primaryRole);
            
            // Dropdown info
            document.getElementById('dropdownUserName').textContent = currentUser.name;
            document.getElementById('dropdownUserRole').textContent = roleNames[primaryRole] || primaryRole;
            
            // Mostrar link de admin se tiver qualquer grupo que não seja apenas "member"
            // Ou se tiver role antigo de gerente/admin
            const nonMemberGroups = userGroups.filter(g => g !== 'member');
            const hasAdminGroups = nonMemberGroups.length > 0;
            const hasAdminRole = userGroups.some(group => 
                normalizeRoleName(group).includes('gerente') ||
                normalizeRoleName(group).includes('admin') ||
                normalizeRoleName(group) === '01' ||
                normalizeRoleName(group) === '02' ||
                normalizeRoleName(group) === 'super_admin'
            );
            
            const hasAdminAccess = hasAdminGroups || hasAdminRole;
            
            console.log('🔐 Verificação de acesso admin:');
            console.log('  - Grupos do usuário:', userGroups);
            console.log('  - Grupos não-member:', nonMemberGroups);
            console.log('  - Tem grupos admin?', hasAdminGroups);
            console.log('  - Tem role admin?', hasAdminRole);
            console.log('  - Acesso final:', hasAdminAccess);
            
            if (hasAdminAccess) {
                document.getElementById('dropdownAdminBtn').style.display = 'flex';
                console.log('✅ Botão admin EXIBIDO');
            } else {
                console.log('❌ Botão admin NÃO exibido');
            }
            
            loadAvailableWeeks();
            loadMaterials();
            loadFarmSettings(); // Carregar configurações do farm primeiro
            loadStats();
            loadMyDeliveries();
            // checkNotifications será chamado após loadWeekData carregar os dados
        } else {
            window.location.href = '/';
        }
    } catch (error) {
        window.location.href = '/';
    }
}

// Configurações do farm
let farmSettings = {
    farm_materials_enabled: 'true',
    member_drug_farm_enabled: 'true',
    member_weapon_farm_enabled: 'true',
    farm_payment_enabled: 'true',
    farm_payment_mode: 'either',
    competition_enabled: 'false'
};

// Carregar configurações do farm
async function loadFarmSettings() {
    try {
        const response = await fetch('/api/delivery/farm-settings');
        const data = await response.json();
        farmSettings = { ...farmSettings, ...(data.settings || {}) };
        
        // Agora carregar tipos de pagamento com base nas configurações
        await loadPaymentTypes();
    } catch (error) {
        console.error('Erro ao carregar configurações do farm:', error);
        await loadPaymentTypes();
    }
}

// Carregar tipos de pagamento do banco
async function loadPaymentTypes() {
    try {
        const response = await fetch('/api/delivery/payment-types');
        const data = await response.json();
        paymentTypes = data.paymentTypes || [];
        
        // Atualizar o seletor de tipos de pagamento
        updatePaymentTypeSelector();
    } catch (error) {
        console.error('Erro ao carregar tipos de pagamento:', error);
        // Fallback com valores padrão
        paymentTypes = [
            { id: 1, name: 'Dinheiro Sujo', icon: '💰', weekly_goal: 50000 }
        ];
        updatePaymentTypeSelector();
    }
}

// Atualizar o seletor de tipos de pagamento
function updatePaymentTypeSelector() {
    const container = document.querySelector('.payment-type-selector');
    if (!container) return;
    
    const memberDrugFarmEnabled = farmSettings.member_drug_farm_enabled !== 'false';
    const memberWeaponFarmEnabled = farmSettings.member_weapon_farm_enabled !== 'false';
    const materialsEnabled = farmSettings.farm_materials_enabled === 'true' && (memberDrugFarmEnabled || memberWeaponFarmEnabled);
    const paymentEnabled = farmSettings.farm_payment_enabled === 'true';
    const paymentMode = farmSettings.farm_payment_mode || 'either'; // 'either' ou 'both'
    
    // Verificar se já tem entrega parcial (bloqueia troca de tipo APENAS se modo = 'either')
    const hasPartialDelivery = currentWeekData && currentWeekData.hasDelivery && currentWeekData.isPartial;
    const currentPaymentType = currentWeekData ? currentWeekData.paymentType : null;
    const isCurrentMaterial = !currentPaymentType || currentPaymentType === 'material';
    const isCurrentDirtyMoney = currentPaymentType === 'dirty_money';
    
    // Só bloqueia troca se o modo for 'either' (um ou outro)
    // Se for 'both' (ambos obrigatórios), nunca bloqueia
    const shouldLockSwitch = paymentMode === 'either' && hasPartialDelivery;
    
    let html = '';
    
    // Botão de materiais (se habilitado)
    if (materialsEnabled) {
        // Bloquear se tem entrega parcial de dinheiro sujo E modo = 'either'
        const isDisabled = shouldLockSwitch && isCurrentDirtyMoney;
        const disabledClass = isDisabled ? 'disabled' : '';
        const disabledAttr = isDisabled ? 'disabled' : '';
        const tooltip = isDisabled ? 'title="Você já iniciou pagamento com dinheiro sujo esta semana"' : '';
        
        html += `
            <button type="button" class="payment-type-btn active ${disabledClass}" data-type="material" 
                onclick="selectPaymentType('material')" ${disabledAttr} ${tooltip}>
                📦 Materiais
            </button>
        `;
    }
    
    // Botões de tipos de pagamento (se habilitado)
    if (paymentEnabled && paymentTypes.length > 0) {
        paymentTypes.forEach(pt => {
            const isActive = !materialsEnabled && paymentTypes.indexOf(pt) === 0;
            // Bloquear se tem entrega parcial de materiais E modo = 'either'
            const isDisabled = shouldLockSwitch && isCurrentMaterial;
            const disabledClass = isDisabled ? 'disabled' : '';
            const disabledAttr = isDisabled ? 'disabled' : '';
            const tooltip = isDisabled ? 'title="Você já iniciou pagamento com materiais esta semana"' : '';
            
            html += `
                <button type="button" class="payment-type-btn ${isActive ? 'active' : ''} ${disabledClass}" 
                    data-type="payment_${pt.id}" onclick="selectPaymentType('payment_${pt.id}', ${pt.id})" 
                    ${disabledAttr} ${tooltip}>
                    ${pt.icon} ${pt.name}
                </button>
            `;
        });
    }
    
    // Se não tem nenhum habilitado, mostrar mensagem
    if (!html) {
        html = '<p style="color: #888;">Nenhum tipo de pagamento disponível</p>';
    }
    
    // Adicionar aviso se bloqueado (apenas no modo 'either')
    if (shouldLockSwitch) {
        const typeUsed = isCurrentMaterial ? 'materiais' : 'dinheiro sujo';
        html += `<p class="payment-locked-notice">🔒 Você já iniciou com ${typeUsed} - não pode trocar esta semana</p>`;
    }
    
    container.innerHTML = html;
    
    // Se só materiais habilitado, selecionar automaticamente
    if (materialsEnabled && !paymentEnabled) {
        selectPaymentType('material');
    } else if (!materialsEnabled && paymentEnabled && paymentTypes.length > 0) {
        // Se só pagamento habilitado, selecionar o primeiro tipo
        selectPaymentType(`payment_${paymentTypes[0].id}`, paymentTypes[0].id);
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

// ==================== SISTEMA DE NOTIFICAÇÕES ====================

// Verificar e gerar notificações (usa dados já carregados de currentWeekData)
function checkNotifications() {
    notifications = [];
    
    // Usar dados já carregados em vez de fazer nova chamada
    if (!currentWeekData) return;
    
    const data = currentWeekData;
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0=Dom, 1=Seg, ..., 6=Sab
    
    // Verificar se é uma nova semana (Segunda-feira)
    const lastWeekCheck = localStorage.getItem('lastWeekCheck');
    const currentWeekStart = data.week?.start;
    
    if (currentWeekStart && lastWeekCheck !== currentWeekStart) {
        // Nova semana começou!
        notifications.push({
            id: 'new_week',
            type: 'info',
            icon: '📅',
            title: 'Nova Semana!',
            message: `A semana ${data.week.label} começou. Não esqueça de fazer seu farm!`,
            time: 'Agora'
        });
        localStorage.setItem('lastWeekCheck', currentWeekStart);
    }
    
    // Se não tem entrega e não tem justificativa
    if (!data.hasDelivery && !data.hasJustification) {
        // Verificar se está nos últimos 2 dias da semana (Sábado ou Domingo)
        if (dayOfWeek === 6 || dayOfWeek === 0) {
            notifications.push({
                id: 'urgent_farm',
                type: 'warning',
                icon: '⚠️',
                title: 'URGENTE: Farm Pendente!',
                message: dayOfWeek === 0 
                    ? 'ÚLTIMO DIA! Entregue seu farm HOJE ou receberá ADV!' 
                    : 'Faltam 2 dias! Entregue seu farm até amanhã para evitar ADV.',
                time: 'Agora'
            });
        } 
        // Sexta-feira - lembrete
        else if (dayOfWeek === 5) {
            notifications.push({
                    id: 'reminder_farm',
                    type: 'info',
                    icon: '📦',
                    title: 'Lembrete de Farm',
                    message: 'Você ainda não entregou o farm desta semana. Restam 2 dias!',
                    time: 'Agora'
                });
            }
        }
        
        // Se tem entrega parcial (em progresso)
        if (data.hasDelivery && data.isPartial && data.canDeliver) {
            // Verificar se está nos últimos dias
            if (dayOfWeek === 6 || dayOfWeek === 0) {
                notifications.push({
                    id: 'complete_farm',
                    type: 'warning',
                    icon: '⚡',
                    title: 'Complete seu Farm!',
                    message: 'Seu farm está incompleto. Complete até 700 de cada material!',
                    time: 'Agora'
                });
            }
        }
        
        const notifiedEvents = JSON.parse(localStorage.getItem('notifiedDeliveryEvents') || '[]');
        const notifiedSet = new Set(notifiedEvents);

        if (Array.isArray(myDeliveriesCache) && myDeliveriesCache.length > 0) {
            myDeliveriesCache.slice(0, 10).forEach(delivery => {
                const normalizedStatus = (delivery.status === 'rejected' || delivery.status === 'not_delivered') ? 'rejected' : delivery.status;
                if (normalizedStatus !== 'approved' && normalizedStatus !== 'rejected') return;

                const eventTimeRaw = delivery.approved_at || delivery.updated_at || delivery.created_at || '';
                const eventTime = eventTimeRaw ? new Date(eventTimeRaw).toISOString() : '';
                const eventId = `delivery_${delivery.id}_${normalizedStatus}_${delivery.is_partial ? 'partial' : 'full'}_${eventTime}`;

                if (notifiedSet.has(eventId)) return;

                if (normalizedStatus === 'approved' && delivery.is_partial) {
                    notifications.push({
                        id: eventId,
                        type: 'info',
                        icon: '⏳',
                        title: 'Farm Parcial Aprovado',
                        message: 'Seu envio parcial foi aprovado. Continue para bater a meta da semana!',
                        time: eventTimeRaw ? formatDate(eventTimeRaw) : 'Recente'
                    });
                    notifiedSet.add(eventId);
                    return;
                }

                if (normalizedStatus === 'approved' && !delivery.is_partial) {
                    notifications.push({
                        id: eventId,
                        type: 'success',
                        icon: '✅',
                        title: 'Farm Completo Aprovado',
                        message: 'Seu farm completo foi aprovado. Parabéns!',
                        time: eventTimeRaw ? formatDate(eventTimeRaw) : 'Recente'
                    });
                    notifiedSet.add(eventId);
                    return;
                }

                if (normalizedStatus === 'rejected') {
                    const reasonText = delivery.approval_note ? ` Motivo: ${delivery.approval_note}` : '';
                    notifications.push({
                        id: eventId,
                        type: 'warning',
                        icon: '❌',
                        title: 'Farm Reprovado',
                        message: `Seu envio foi reprovado.${reasonText}`,
                        time: eventTimeRaw ? formatDate(eventTimeRaw) : 'Recente'
                    });
                    notifiedSet.add(eventId);
                }
            });

            localStorage.setItem('notifiedDeliveryEvents', JSON.stringify(Array.from(notifiedSet).slice(-200)));
        }
        
        updateNotificationBadge();
}

// Atualizar badge do sino
function updateNotificationBadge() {
    const badge = document.getElementById('notificationBadge');
    const bell = document.getElementById('notificationBell');
    
    // Contar apenas não lidas
    const readIds = JSON.parse(localStorage.getItem('readNotifications') || '[]');
    const unreadCount = notifications.filter(n => !readIds.includes(n.id)).length;
    
    if (unreadCount > 0) {
        badge.textContent = unreadCount;
        badge.style.display = 'flex';
        bell.classList.add('has-notifications');
    } else {
        badge.style.display = 'none';
        bell.classList.remove('has-notifications');
    }
}

// Toggle dropdown de notificações
function toggleNotifications() {
    const dropdown = document.getElementById('notificationsDropdown');
    dropdown.classList.toggle('show');
    
    if (dropdown.classList.contains('show')) {
        renderNotifications();
    }
}

// Fechar dropdown ao clicar fora
document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('notificationsDropdown');
    const bell = document.getElementById('notificationBell');
    const userDropdown = document.getElementById('userDropdown');
    const userTrigger = document.querySelector('.user-dropdown-trigger');
    
    // Fechar notificações
    if (dropdown && bell && !dropdown.contains(e.target) && !bell.contains(e.target)) {
        dropdown.classList.remove('show');
    }
    
    // Fechar dropdown de usuário
    if (userDropdown && userTrigger && !userDropdown.contains(e.target) && !userTrigger.contains(e.target)) {
        closeUserDropdown();
    }
});

// Renderizar lista de notificações
function renderNotifications() {
    const list = document.getElementById('notificationsList');
    
    if (notifications.length === 0) {
        list.innerHTML = '<div class="notification-empty">🔕 Nenhuma notificação</div>';
        return;
    }
    
    const readIds = JSON.parse(localStorage.getItem('readNotifications') || '[]');
    
    list.innerHTML = notifications.map(n => {
        const isRead = readIds.includes(n.id);
        return `
            <div class="notification-item ${n.type} ${isRead ? 'read' : 'unread'}" onclick="handleNotificationClick('${n.id}')">
                <span class="notification-icon">${n.icon}</span>
                <div class="notification-content">
                    <div class="notification-title">${n.title}</div>
                    <div class="notification-message">${n.message}</div>
                    <div class="notification-time">${n.time}</div>
                </div>
                ${!isRead ? '<span class="unread-dot"></span>' : ''}
            </div>
        `;
    }).join('');
}

// Lidar com clique na notificação
function handleNotificationClick(id) {
    // Fechar dropdown
    document.getElementById('notificationsDropdown').classList.remove('show');
    
    // Ação baseada no tipo
    if (id === 'urgent_farm' || id === 'reminder_farm' || id === 'complete_farm') {
        // Scroll para o formulário
        document.getElementById('deliveryPanel').scrollIntoView({ behavior: 'smooth' });
    }
}

// Marcar todas como lidas
function markAllAsRead() {
    const readIds = JSON.parse(localStorage.getItem('readNotifications') || '[]');
    notifications.forEach(n => {
        if (!readIds.includes(n.id)) {
            readIds.push(n.id);
        }
    });
    localStorage.setItem('readNotifications', JSON.stringify(readIds));
    updateNotificationBadge();
    renderNotifications();
}

// ==================== FIM SISTEMA DE NOTIFICAÇÕES ====================

// Carregar semanas disponíveis
async function loadAvailableWeeks() {
    try {
        const response = await fetch('/api/delivery/available-weeks');
        const data = await response.json();
        availableWeeksData = data.weeks || [];
        
        // Carregar dados da semana atual (offset 0)
        if (availableWeeksData.length > 0) {
            loadWeekData(0);
        }
        
        updateWeekNavButtons();
        
        // Sem alerta de semanas atrasadas
        
    } catch (error) {
        console.error('Erro ao carregar semanas:', error);
    }
}

// Mudar semana (botões de navegação)
function changeWeek(direction) {
    const newOffset = currentWeekOffset + direction;
    
    // Verificar se existe a semana (incluindo semanas passadas não pagas)
    const weekExists = availableWeeksData.find(w => w.offset === newOffset);
    if (weekExists) {
        currentWeekOffset = newOffset;
        loadWeekData(currentWeekOffset);
        updateWeekNavButtons();
    }
}

// Atualizar botões de navegação
function updateWeekNavButtons() {
    const prevBtn = document.getElementById('prevWeekBtn');
    const nextBtn = document.getElementById('nextWeekBtn');
    
    if (!prevBtn || !nextBtn || availableWeeksData.length === 0) return;
    
    // Verificar se existem semanas anteriores/próximas na lista
    const minOffset = Math.min(...availableWeeksData.map(w => w.offset));
    const maxOffset = Math.max(...availableWeeksData.map(w => w.offset));
    
    // Permitir navegar para qualquer semana disponível (incluindo passadas não pagas)
    prevBtn.disabled = currentWeekOffset <= minOffset;
    nextBtn.disabled = currentWeekOffset >= maxOffset;
    
    prevBtn.classList.remove('has-past-weeks');
}

// Carregar dados de uma semana específica
async function loadWeekData(offset = 0) {
    try {
        currentWeekOffset = offset;
        
        // Atualizar hidden input do form
        const weekSelect = document.getElementById('weekSelect');
        if (weekSelect) weekSelect.value = offset;
        
        // Adicionar timestamp para evitar cache
        const timestamp = new Date().getTime();
        const response = await fetch(`/api/delivery/current-week?offset=${offset}&_t=${timestamp}`, {
            cache: 'no-cache',
            headers: {
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        });
        const data = await response.json();
        currentWeekData = data;
        
        // Atualizar label da semana com indicador
        const weekLabel = document.getElementById('weekLabel');
        let labelText = data.week.label;
        if (offset === 0) {
            labelText += ' (Atual)';
        } else if (offset > 0) {
            labelText += ` (+${offset} sem)`;
        }
        weekLabel.textContent = labelText;
        
        // Atualizar status
        const weekStatus = document.getElementById('weekStatus');
        let statusHtml = '';
        let statusClass = '';
        
        // Verificar se é semana passada
        const isPastWeek = offset < 0;
        
        if (data.hasDelivery) {
            if (data.isPartial && data.canDeliver) {
                statusClass = 'in-progress';
                statusHtml = '⚡ Em Progresso';
            } else if (data.deliveryStatus === 'approved') {
                statusClass = 'approved';
                statusHtml = '✅ Aprovado';
            } else if (data.deliveryStatus === 'pending') {
                statusClass = 'pending';
                statusHtml = '⏳ Aguardando';
            } else {
                statusClass = 'pending';
                statusHtml = '⏳ Processando';
            }
        } else if (data.hasJustification) {
            statusClass = data.justificationStatus === 'approved' ? 'justified' : 'pending';
            statusHtml = data.justificationStatus === 'approved' ? '📋 Justificado' : '⏳ Aguardando';
        } else {
            statusClass = 'missing';
            statusHtml = '⚠️ Pendente';
        }
        
        weekStatus.innerHTML = `<span class="status-pill ${statusClass}">${statusHtml}</span>`;

        // Atualizar cartão de resumo (meta desta semana) — só reflete a semana atual
        if (offset === 0) {
            updateMetaSummary(data);
        }

        // Atualizar barras de progresso
        updateProgressBars(data.progress);
        
        // Mostrar screenshots existentes
        updateExistingScreenshots(data.existingScreenshots);
        
        // Atualizar UI dos materiais com o progresso atual (sem chamada de API)
        updateMaterialsUI();
        
        // Preencher formulário com valores existentes (para edição)
        fillFormWithExistingValues(data.progress);
        
        // Se já tem entrega, selecionar o tipo de pagamento correto
        // Primeiro atualizar o seletor com as restrições baseadas no currentWeekData
        updatePaymentTypeSelector();
        
        if (data.hasDelivery && data.paymentType) {
            if (data.paymentType === 'dirty_money' && data.paymentTypeId) {
                // Selecionar o tipo de pagamento específico
                selectPaymentType(`payment_${data.paymentTypeId}`, data.paymentTypeId);
            } else if (data.paymentType === 'dirty_money') {
                // Fallback para o primeiro tipo de pagamento
                if (paymentTypes.length > 0) {
                    selectPaymentType(`payment_${paymentTypes[0].id}`, paymentTypes[0].id);
                }
            } else {
                selectPaymentType('material');
            }
            
            // NÃO preencher o input com valor existente - modo adição sempre começa zerado
            // O valor já entregue é mostrado na barra de progresso
            const dirtyMoneyInput = document.getElementById('dirtyMoneyAmount');
            if (dirtyMoneyInput) {
                dirtyMoneyInput.value = 0;
                updateDirtyMoneyButton();
            }
        } else {
            // Sem entrega - selecionar materiais por padrão
            selectPaymentType('material');
        }
        
        // Atualizar visibilidade do card de justificativa
        // Mostrar quando: pode entregar E não justificou ainda E farm não está em progresso/completo
        const absenceCard = document.getElementById('absenceCard');
        if (absenceCard) {
            // Não mostrar justificativa se farm já está em progresso (approved + partial) ou completo (approved + !partial)
            const farmJaAprovado = data.deliveryStatus === 'approved';
            const showJustify = data.canDeliver && !data.hasJustification && !farmJaAprovado;
            absenceCard.style.display = showJustify ? 'block' : 'none';
            
            // Atualizar texto baseado se já tem farm parcial
            const absenceTitle = absenceCard.querySelector('h3');
            if (absenceTitle) {
                if (data.isPartial) {
                    absenceTitle.textContent = '📝 Não vai conseguir completar o farm?';
                } else {
                    absenceTitle.textContent = '📝 Não vai conseguir fazer o farm?';
                }
            }
        }
        
        // Atualizar painel de entrega baseado no status
        const deliveryPanel = document.getElementById('deliveryPanel');
        const lockedMessage = document.getElementById('lockedMessage');
        const extraFarmPanel = document.getElementById('extraFarmPanel');
        
        // Farm está COMPLETO = aprovado E não é parcial (bateu a meta)
        const farmCompleto = data.deliveryStatus === 'approved' && !data.isPartial;
        // Farm está EM PROGRESSO = aprovado mas parcial (não bateu meta ainda)
        const farmEmProgresso = data.deliveryStatus === 'approved' && data.isPartial;
        
        if (deliveryPanel) {
            // Farm COMPLETO - meta batida, só mostra painel de farm extra se competição estiver ATIVA
            if (farmCompleto && farmSettings.competition_enabled === 'true') {
                deliveryPanel.style.display = 'none';
                if (lockedMessage) lockedMessage.style.display = 'none';
                
                if (extraFarmPanel) {
                    extraFarmPanel.style.display = 'block';
                    loadExtraMaterialsInputs();
                }
            } else if (farmCompleto) {
                // Meta batida, competição desligada: bloquear TUDO (Materiais, Dinheiro Limpo, Dinheiro Sujo, prints) - semana finalizada
                deliveryPanel.style.display = 'none';
                if (extraFarmPanel) extraFarmPanel.style.display = 'none';
                if (lockedMessage) {
                    lockedMessage.style.display = 'block';
                    lockedMessage.innerHTML = `
                        <div class="locked-icon">✅</div>
                        <h3>Meta batida</h3>
                        <p>Semana finalizada. Não é possível alterar ou adicionar entregas (materiais, dinheiro limpo, dinheiro sujo ou prints).</p>
                    `;
                }
            // Farm EM PROGRESSO - aprovado mas não bateu meta, pode continuar adicionando
            } else if (farmEmProgresso) {
                deliveryPanel.style.display = 'block';
                deliveryPanel.style.opacity = '1';
                deliveryPanel.style.pointerEvents = 'auto';
                if (lockedMessage) lockedMessage.style.display = 'none';
                if (extraFarmPanel) extraFarmPanel.style.display = 'none';
                
                const formTitle = document.getElementById('formTitle');
                if (formTitle) {
                    formTitle.textContent = '⏳ Adicionar ao Farm (Em Progresso)';
                }
            } else if (data.canDeliver) {
                // Pode entregar - mostrar formulário normal
                deliveryPanel.style.display = 'block';
                deliveryPanel.style.opacity = '1';
                deliveryPanel.style.pointerEvents = 'auto';
                if (lockedMessage) lockedMessage.style.display = 'none';
                if (extraFarmPanel) extraFarmPanel.style.display = 'none';
                
                // Atualizar título do form
                const formTitle = document.getElementById('formTitle');
                if (formTitle) {
                    if (data.deliveryStatus === 'pending' && !data.isPartial) {
                        formTitle.textContent = '✏️ Editar Farm (Aguardando Aprovação)';
                    } else if (data.isPartial || data.deliveryStatus === 'pending') {
                        formTitle.textContent = '📦 Adicionar ao Farm';
                    } else {
                        formTitle.textContent = '📦 Registrar Farm';
                    }
                }
            } else {
                // Não pode entregar - esconder formulário e mostrar mensagem
                deliveryPanel.style.display = 'none';
                if (extraFarmPanel) extraFarmPanel.style.display = 'none';
                
                // Mostrar mensagem de bloqueio
                if (lockedMessage) {
                    lockedMessage.style.display = 'block';
                    
                    let lockIcon = '🔒';
                    let lockTitle = 'Entregas Bloqueadas';
                    let lockText = data.statusMessage || 'Não é possível fazer entregas nesta semana.';
                    
                    if (data.hasPendingExtraFarm) {
                        // Farm extra aguardando aprovação (farm original continua aprovado)
                        lockIcon = '🏆';
                        lockTitle = 'Farm Extra Aguardando Aprovação';
                        lockText = 'Seu farm extra foi enviado para aprovação. O farm original continua valendo no ranking!';
                    } else if (data.deliveryStatus === 'pending' && !data.isPartial) {
                        lockIcon = '⏳';
                        lockTitle = 'Aguardando Aprovação';
                        lockText = 'Seu farm completo está aguardando aprovação de um administrador.';
                    } else if (data.hasJustification) {
                        lockIcon = '📋';
                        lockTitle = 'Semana Justificada';
                        lockText = data.justificationStatus === 'approved' 
                            ? 'Sua justificativa foi aceita. Você não precisa entregar farm esta semana.'
                            : 'Sua justificativa está aguardando aprovação.';
                    }
                    
                    lockedMessage.innerHTML = `
                        <div class="locked-icon">${lockIcon}</div>
                        <h3>${lockTitle}</h3>
                        <p>${lockText}</p>
                    `;
                }
            }
        }
        
        // Bloquear adição de print quando a meta estiver completa (apenas nesse caso)
        const screenshotsAddArea = document.getElementById('screenshotsAddArea');
        const screenshotsAddAreaDirty = document.getElementById('screenshotsAddAreaDirty');
        if (screenshotsAddArea) screenshotsAddArea.style.display = farmCompleto ? 'none' : '';
        if (screenshotsAddAreaDirty) screenshotsAddAreaDirty.style.display = farmCompleto ? 'none' : '';
        
        // Verificar notificações após carregar dados da semana
        checkNotifications();
        
    } catch (error) {
        console.error('Erro ao carregar semana:', error);
    }
}

// Atualizar screenshots existentes
function updateExistingScreenshots(screenshots) {
    // Verificar se o farm está pendente (pode editar)
    const isPending = currentWeekData && currentWeekData.deliveryStatus === 'pending' && !currentWeekData.isPartial;
    
    // Atualizar seção de materiais
    const section = document.getElementById('existingScreenshotsSection');
    const container = document.getElementById('existingScreenshots');
    
    if (section && container) {
        if (!screenshots || screenshots.length === 0) {
            section.style.display = 'none';
            container.innerHTML = '';
        } else {
            // Mostrar seção e preencher com screenshots
            section.style.display = 'block';
            container.innerHTML = screenshots.map((s, idx) => `
                <div class="screenshot-preview existing" id="screenshot-${s.id}">
                    <img src="${s.screenshot_url}" alt="Print ${idx + 1}" onclick="openModal('${s.screenshot_url}')">
                    <div class="screenshot-badge">${idx + 1}</div>
                    ${isPending ? `<button type="button" class="screenshot-remove-btn" onclick="removeExistingScreenshot(${s.id})" title="Remover print">×</button>` : ''}
                </div>
            `).join('');
        }
    }
    
    // Atualizar seção de dinheiro sujo (mesma lógica)
    const sectionDirty = document.getElementById('existingScreenshotsSectionDirty');
    const containerDirty = document.getElementById('existingScreenshotsDirty');
    
    if (sectionDirty && containerDirty) {
        if (!screenshots || screenshots.length === 0) {
            sectionDirty.style.display = 'none';
            containerDirty.innerHTML = '';
        } else {
            // Mostrar seção e preencher com screenshots
            sectionDirty.style.display = 'block';
            containerDirty.innerHTML = screenshots.map((s, idx) => `
                <div class="screenshot-preview existing" id="screenshot-dirty-${s.id}">
                    <img src="${s.screenshot_url}" alt="Print ${idx + 1}" onclick="openModal('${s.screenshot_url}')">
                    <div class="screenshot-badge">${idx + 1}</div>
                    ${isPending ? `<button type="button" class="screenshot-remove-btn" onclick="removeExistingScreenshot(${s.id})" title="Remover print">×</button>` : ''}
                </div>
            `).join('');
        }
    }
}

// Resetar inputs do formulário para modo adição ou preencher para edição
function fillFormWithExistingValues(progress) {
    // Verificar se o farm está pendente (modo edição)
    const isPending = currentWeekData && currentWeekData.deliveryStatus === 'pending' && !currentWeekData.isPartial;
    
    if (isPending && progress && progress.length > 0) {
        // Modo edição - preencher com valores atuais
        document.querySelectorAll('.material-amount-input').forEach(input => {
            const materialId = input.dataset.materialId;
            const material = progress.find(p => String(p.material_id) === String(materialId));
            if (material) {
                // O backend retorna 'current' com a quantidade já entregue
                input.value = material.current || material.delivered || 0;
            } else {
                input.value = 0;
            }
        });
    } else {
        // Modo adição - zerar inputs
        document.querySelectorAll('.material-amount-input').forEach(input => {
            input.value = 0;
        });
    }
    updateSubmitButton();
}

// Atualizar barras de progresso
function updateProgressBars(progress) {
    const container = document.getElementById('progressBars');
    
    if (!progress || progress.length === 0) {
        container.innerHTML = `
            <div class="progress-empty">
                <span>Nenhum progresso ainda</span>
            </div>
        `;
        return;
    }
    
    // Verificar se tem permissão para editar valores
    const canEdit = currentWeekData && currentWeekData.canEditValues;
    
    // Se for pagamento com dinheiro (sujo, limpo, etc), mostrar barra no mesmo padrão
    if (currentWeekData && currentWeekData.paymentType === 'dirty_money') {
        const amount = currentWeekData.dirtyMoneyAmount || 0;
        
        // Buscar a meta do tipo de pagamento
        let goal = 50000; // Fallback
        let paymentTypeName = 'Dinheiro Sujo';
        let paymentTypeIcon = '💰';
        let paymentTypeUnit = 'R$';
        if (currentWeekData.paymentTypeId && paymentTypes.length > 0) {
            const pt = paymentTypes.find(p => p.id === currentWeekData.paymentTypeId);
            if (pt) {
                goal = pt.weekly_goal;
                paymentTypeName = pt.name;
                paymentTypeIcon = pt.icon;
                paymentTypeUnit = pt.unit_type || 'R$';
            }
        }
        const fmt = (v) => paymentTypeUnit === 'unidade' ? `${Number(v).toLocaleString('pt-BR')} un.` : `R$ ${Number(v).toLocaleString('pt-BR')}`;
        
        const percentage = Math.min(100, Math.round((amount / goal) * 100));
        const complete = amount >= goal;
        
        container.innerHTML = `
            <div class="progress-item ${complete ? 'complete' : ''}">
                <div class="progress-header">
                    <span class="progress-label">${paymentTypeIcon} ${paymentTypeName}</span>
                    <span class="progress-value ${complete ? 'complete' : 'incomplete'}">
                        ${canEdit ? `
                            <span class="value-display editable" onclick="openEditDirtyMoneyModal(${amount}, ${goal}, '${(paymentTypeName || '').replace(/'/g, "\\'")}', '${paymentTypeIcon}', '${paymentTypeUnit}')">
                                ${fmt(amount)} / ${fmt(goal)}
                                <span class="edit-hint">✏️</span>
                            </span>
                        ` : `
                            <span class="value-display">${fmt(amount)} / ${fmt(goal)}</span>
                        `}
                    </span>
                </div>
                <div class="progress-bar-bg">
                    <div class="progress-bar-fill" style="width: ${percentage}%; background: linear-gradient(90deg, #27ae60, #2ecc71);"></div>
                </div>
                <div class="progress-percentage-text">${percentage}%</div>
            </div>
        `;
        return;
    }
    
    container.innerHTML = progress.map(p => `
        <div class="progress-item">
            <div class="progress-header">
                <span class="progress-label">${p.icon} ${p.name}</span>
                <span class="progress-value ${p.complete ? 'complete' : 'incomplete'}">
                    ${canEdit ? `
                        <span class="value-display editable" onclick="openEditValueModal(${p.material_id}, '${p.name}', '${p.icon}', ${p.current}, ${p.goal})">
                            ${p.current}/${p.goal}
                            <span class="edit-hint">✏️</span>
                        </span>
                    ` : `
                        <span class="value-display">${p.current}/${p.goal}</span>
                    `}
                </span>
            </div>
            <div class="progress-bar-bg">
                <div class="progress-bar-fill ${p.complete ? 'complete' : ''}" style="width: ${p.percentage}%"></div>
            </div>
        </div>
    `).join('');
}

// Progresso separado por tipo de farm. Esta declaracao substitui a anterior.
function updateProgressBars(progress) {
    const container = document.getElementById('progressBars');
    if (!container) return;

    if (!progress || progress.length === 0) {
        container.innerHTML = `
            <div class="progress-empty">
                <span>Nenhum progresso ainda</span>
            </div>
        `;
        return;
    }

    const canEdit = currentWeekData && currentWeekData.canEditValues;

    if (currentWeekData && currentWeekData.paymentType === 'dirty_money') {
        const amount = currentWeekData.dirtyMoneyAmount || 0;
        let goal = 50000;
        let paymentTypeName = 'Pagamento';
        let paymentTypeIcon = '💰';
        let paymentTypeUnit = 'R$';
        if (currentWeekData.paymentTypeId && paymentTypes.length > 0) {
            const pt = paymentTypes.find(p => p.id === currentWeekData.paymentTypeId);
            if (pt) {
                goal = pt.weekly_goal;
                paymentTypeName = pt.name;
                paymentTypeIcon = pt.icon;
                paymentTypeUnit = pt.unit_type || 'R$';
            }
        }
        const fmt = (v) => paymentTypeUnit === 'unidade' ? `${Number(v).toLocaleString('pt-BR')} un.` : `R$ ${Number(v).toLocaleString('pt-BR')}`;
        const percentage = Math.min(100, Math.round((amount / goal) * 100));
        const complete = amount >= goal;
        container.innerHTML = `
            <div class="progress-item ${complete ? 'complete' : ''}">
                <div class="progress-header">
                    <span class="progress-label">${paymentTypeIcon} ${paymentTypeName}</span>
                    <span class="progress-value ${complete ? 'complete' : 'incomplete'}">
                        ${canEdit ? `<span class="value-display editable" onclick="openEditDirtyMoneyModal(${amount}, ${goal}, '${(paymentTypeName || '').replace(/'/g, "\\'")}', '${paymentTypeIcon}', '${paymentTypeUnit}')">${fmt(amount)} / ${fmt(goal)} <span class="edit-hint">✏</span></span>` : `<span class="value-display">${fmt(amount)} / ${fmt(goal)}</span>`}
                    </span>
                </div>
                <div class="progress-bar-bg">
                    <div class="progress-bar-fill" style="width: ${percentage}%"></div>
                </div>
                <div class="progress-percentage-text">${percentage}%</div>
            </div>
        `;
        return;
    }

    const groups = [
        { type: 'drugs', title: 'Meta de Drogas', items: progress.filter(p => normalizeFarmTypeClient(p.farm_type) === 'drugs') },
        { type: 'weapons', title: 'Meta de Armas', items: progress.filter(p => normalizeFarmTypeClient(p.farm_type) === 'weapons') },
        { type: 'general', title: 'Meta Geral', items: progress.filter(p => normalizeFarmTypeClient(p.farm_type) === 'general') }
    ].filter(group => group.items.length > 0);

    container.innerHTML = groups.map(group => `
        <div class="progress-farm-group">
            <div class="progress-farm-title">${group.title}</div>
            ${group.items.map(p => `
                <div class="progress-item">
                    <div class="progress-header">
                        <span class="progress-label">${p.icon} ${p.name}</span>
                        <span class="progress-value ${p.complete ? 'complete' : 'incomplete'}">
                            ${canEdit ? `<span class="value-display editable" onclick="openEditValueModal(${p.material_id}, '${p.name}', '${p.icon}', ${p.current}, ${p.goal})">${p.current}/${p.goal} <span class="edit-hint">✏</span></span>` : `<span class="value-display">${p.current}/${p.goal}</span>`}
                        </span>
                    </div>
                    <div class="progress-bar-bg">
                        <div class="progress-bar-fill ${p.complete ? 'complete' : ''}" style="width: ${p.percentage}%"></div>
                    </div>
                </div>
            `).join('')}
        </div>
    `).join('');
}

// Logout
async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/';
}

// ========== MODAL DE EDIÇÃO DE VALOR ==========
function openEditValueModal(materialId, name, icon, currentValue, goal) {
    // Criar modal se não existir
    let modal = document.getElementById('editValueModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'editValueModal';
        modal.className = 'edit-value-modal';
        document.body.appendChild(modal);
    }
    
    modal.innerHTML = `
        <div class="edit-value-content">
            <div class="edit-value-header">
                <span>${icon} Editar ${name}</span>
                <button class="edit-value-close" onclick="closeEditValueModal()">&times;</button>
            </div>
            <div class="edit-value-body">
                <div class="edit-value-current">
                    Valor atual: <strong>${currentValue}</strong> / ${goal}
                </div>
                <div class="edit-value-input-group">
                    <label>Novo valor total:</label>
                    <input type="number" id="editValueInput" value="${currentValue}" min="0" max="${goal}" autofocus>
                    <small style="color: var(--text-secondary)">Máximo: ${goal}</small>
                </div>
                <p class="edit-value-hint">⚠️ Use apenas para corrigir erros de digitação</p>
            </div>
            <div class="edit-value-footer">
                <button class="btn-cancel" onclick="closeEditValueModal()">Cancelar</button>
                <button class="btn-save" onclick="saveEditedValue(${materialId}, ${goal})">💾 Salvar</button>
            </div>
        </div>
    `;
    
    modal.style.display = 'flex';
    document.getElementById('editValueInput').focus();
    document.getElementById('editValueInput').select();
}

// Modal para editar dinheiro sujo / unidades
function openEditDirtyMoneyModal(currentValue, goal, name, icon, unitType) {
    const isUnidade = unitType === 'unidade';
    const fmt = (v) => isUnidade ? `${Number(v).toLocaleString('pt-BR')} un.` : `R$ ${Number(v).toLocaleString('pt-BR')}`;
    const label = isUnidade ? 'Novo valor total (unidades):' : 'Novo valor total (R$):';
    let modal = document.getElementById('editValueModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'editValueModal';
        modal.className = 'edit-value-modal';
        document.body.appendChild(modal);
    }
    
    modal.innerHTML = `
        <div class="edit-value-content">
            <div class="edit-value-header">
                <span>${icon} Editar ${name}</span>
                <button class="edit-value-close" onclick="closeEditValueModal()">&times;</button>
            </div>
            <div class="edit-value-body">
                <div class="edit-value-current">
                    Valor atual: <strong>${fmt(currentValue)}</strong> / ${fmt(goal)}
                </div>
                <div class="edit-value-input-group">
                    <label>${label}</label>
                    <input type="number" id="editValueInput" value="${currentValue}" min="0" max="${goal}" autofocus>
                    <small style="color: var(--text-secondary)">Máximo: ${fmt(goal)}</small>
                </div>
                <p class="edit-value-hint">⚠️ Use apenas para corrigir erros de digitação</p>
            </div>
            <div class="edit-value-footer">
                <button class="btn-cancel" onclick="closeEditValueModal()">Cancelar</button>
                <button class="btn-save" onclick="saveEditedDirtyMoney(${goal}, '${unitType || 'R$'}')">💾 Salvar</button>
            </div>
        </div>
    `;
    
    modal.style.display = 'flex';
    document.getElementById('editValueInput').focus();
    document.getElementById('editValueInput').select();
}

async function saveEditedDirtyMoney(goal, unitType) {
    const input = document.getElementById('editValueInput');
    const newValue = parseInt(input.value) || 0;
    const fmt = (v) => unitType === 'unidade' ? `${Number(v).toLocaleString('pt-BR')} un.` : `R$ ${Number(v).toLocaleString('pt-BR')}`;
    
    // Validar que não ultrapasse a meta
    if (goal && newValue > goal) {
        alert(`⚠️ Valor excede a meta!\\n\\nMáximo permitido: ${fmt(goal)}\\nVocê informou: ${fmt(newValue)}`);
        return;
    }
    
    if (!currentWeekData || !currentWeekData.hasDelivery) {
        alert('Nenhuma entrega para editar!');
        return;
    }
    
    try {
        const response = await fetch('/api/delivery/edit-dirty-money', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                new_value: newValue,
                week_offset: currentWeekOffset
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            closeEditValueModal();
            loadWeekData(currentWeekOffset);
        } else {
            alert(result.error || 'Erro ao salvar');
        }
    } catch (error) {
        console.error('Erro:', error);
        alert('Erro ao salvar valor');
    }
}

function closeEditValueModal() {
    const modal = document.getElementById('editValueModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

async function saveEditedValue(materialId, goal) {
    const input = document.getElementById('editValueInput');
    const newValue = parseInt(input.value) || 0;
    
    // Validar que não ultrapasse a meta
    if (goal && newValue > goal) {
        alert(`⚠️ Valor excede a meta!\\n\\nMáximo permitido: ${goal}\\nVocê informou: ${newValue}`);
        return;
    }
    
    if (!currentWeekData || !currentWeekData.hasDelivery) {
        alert('Nenhuma entrega para editar!');
        return;
    }
    
    try {
        const response = await fetch('/api/delivery/edit-value', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                material_id: materialId,
                new_value: newValue,
                week_offset: currentWeekOffset
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            closeEditValueModal();
            // Recarregar dados da semana
            loadWeekData(currentWeekOffset);
        } else {
            alert(result.error || 'Erro ao salvar');
        }
    } catch (error) {
        console.error('Erro:', error);
        alert('Erro ao salvar valor');
    }
}

// Fechar modal ao clicar fora
document.addEventListener('click', (e) => {
    const modal = document.getElementById('editValueModal');
    if (modal && e.target === modal) {
        closeEditValueModal();
    }
});

// ========== FIM MODAL DE EDIÇÃO ==========

// Carregar materiais disponíveis (chamada de API - só no início)
async function loadMaterials() {
    try {
        const response = await fetch('/api/delivery/materials');
        const data = await response.json();
        
        // Atualizar meta semanal padrão
        if (data.weeklyGoal) {
            weeklyGoal = data.weeklyGoal;
        }
        
        // Salvar materiais globalmente
        if (data.materials) {
            materialsData = data.materials;
        }
        
        // Renderizar materiais na UI
        renderMaterialsUI();
    } catch (error) {
        console.error('Erro ao carregar materiais:', error);
    }
}

// Atualizar apenas a UI dos materiais (sem chamada de API)
function updateMaterialsUI() {
    renderMaterialsUI();
}

// Renderizar materiais na UI
function renderMaterialsUI() {
    const container = document.getElementById('materialsInputs');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (materialsData && materialsData.length > 0) {
        const groupedMaterials = [
            { type: 'drugs', title: 'Farm de Material de Drogas', items: materialsData.filter(m => (m.farm_type || 'drugs') !== 'weapons' && (m.farm_type || 'drugs') !== 'general') },
            { type: 'weapons', title: 'Farm de Material de Armas', items: materialsData.filter(m => (m.farm_type || 'drugs') === 'weapons') },
            { type: 'general', title: 'Farm de Materiais', items: materialsData.filter(m => (m.farm_type || 'drugs') === 'general') }
        ].filter(group => group.items.length > 0);

        groupedMaterials.forEach(group => {
            container.innerHTML += `<div class="material-group-title">${group.title}</div>`;
            group.items.forEach(mat => {
            const matGoal = mat.weekly_goal || 700;
            materialsGoals[mat.id] = matGoal;
            
            // Calcular quanto já foi entregue E APROVADO e quanto falta
            // Usa approvedProgress para calcular "faltam" - só conta entregas aprovadas
            let delivered = 0;
            if (currentWeekData && currentWeekData.approvedProgress) {
                const progress = currentWeekData.approvedProgress.find(p => String(p.material_id) === String(mat.id));
                if (progress) {
                    delivered = progress.current || 0;
                }
            }
            const remaining = Math.max(0, matGoal - delivered);
            const isComplete = remaining === 0;
            
            container.innerHTML += `
                <div class="material-card ${isComplete ? 'complete' : ''}">
                    <div class="material-icon">${mat.icon}</div>
                    <div class="material-info">
                        <div class="material-name">${mat.name}</div>
                        <div class="material-goal">Meta: ${matGoal}</div>
                        ${isComplete 
                            ? `<div class="material-complete-badge">✅ Meta completa!</div>`
                            : `<div class="material-remaining">
                                <span class="remaining-text">Faltam: <strong>${remaining}</strong></span>
                                <button type="button" class="btn-fill-remaining" onclick="fillRemainingAmount(${mat.id}, ${remaining})" title="Preencher ${remaining}">
                                    Completar meta
                                </button>
                               </div>`
                        }
                    </div>
                    <input type="number" 
                           id="material-input-${mat.id}"
                           name="material_${mat.id}" 
                           data-material-id="${mat.id}"
                           data-goal="${matGoal}"
                           data-remaining="${remaining}"
                           class="material-input material-amount-input ${isComplete ? 'disabled' : ''}" 
                           min="0" 
                           max="${remaining}"
                           value="0"
                           placeholder="${isComplete ? '✓' : remaining}"
                           ${isComplete ? 'disabled' : ''}
                           onkeypress="return event.charCode >= 48 && event.charCode <= 57"
                           oninput="validateMaterialInput(this, ${matGoal}); updateSubmitButton()">
                </div>
                `;
            });
        });
            
            // Atualizar botão após carregar materiais
            setTimeout(updateSubmitButton, 100);
        } else {
            container.innerHTML = '<p class="loading-placeholder">Nenhum material disponível no momento.</p>';
        }
}

// Versao separada por tipo de farm. Esta declaracao substitui a anterior.
function renderMaterialsUI() {
    const container = document.getElementById('materialsInputs');
    if (!container) return;

    container.innerHTML = '';

    if (!materialsData || materialsData.length === 0) {
        container.innerHTML = '<p class="loading-placeholder">Nenhum material disponivel no momento.</p>';
        return;
    }

    const groupedMaterials = [
        { type: 'drugs', title: getFarmTypeTitleClient('drugs'), items: materialsData.filter(m => normalizeFarmTypeClient(m.farm_type) === 'drugs') },
        { type: 'weapons', title: getFarmTypeTitleClient('weapons'), items: materialsData.filter(m => normalizeFarmTypeClient(m.farm_type) === 'weapons') },
        { type: 'general', title: getFarmTypeTitleClient('general'), items: materialsData.filter(m => normalizeFarmTypeClient(m.farm_type) === 'general') }
    ].filter(group => group.items.length > 0);

    const farmGroupsHtml = groupedMaterials.map(group => {
        const groupStatus = currentWeekData?.farmTypeStatus?.[group.type] || {};
        const groupLocked = groupStatus.status === 'pending' || groupStatus.status === 'complete';
        const groupStatusText = groupStatus.status === 'complete'
            ? 'Completo'
            : groupStatus.status === 'pending'
                ? 'Aguardando aprovacao'
                : groupStatus.status === 'in_progress'
                    ? 'Em progresso'
                    : 'Aberto';

        const materialsHtml = group.items.map(mat => {
            const matGoal = mat.weekly_goal || 700;
            materialsGoals[mat.id] = matGoal;

            let delivered = 0;
            if (currentWeekData && currentWeekData.approvedProgress) {
                const progress = currentWeekData.approvedProgress.find(p => String(p.material_id) === String(mat.id));
                if (progress) delivered = progress.current || 0;
            }

            const remaining = Math.max(0, matGoal - delivered);
            const isComplete = remaining === 0;
            const inputDisabled = isComplete || groupLocked;

            return `
                <div class="material-card ${isComplete ? 'complete' : ''} ${groupLocked ? 'locked' : ''}">
                    <div class="material-icon">${mat.icon}</div>
                    <div class="material-info">
                        <div class="material-name">${mat.name}</div>
                        <div class="material-goal">Meta: ${matGoal}</div>
                        ${isComplete
                            ? `<div class="material-complete-badge">Meta completa</div>`
                            : groupLocked
                                ? `<div class="material-complete-badge pending">${groupStatusText}</div>`
                                : `<div class="material-remaining">
                                    <span class="remaining-text">Faltam: <strong>${remaining}</strong></span>
                                    <button type="button" class="btn-fill-remaining" onclick="fillRemainingAmount(${mat.id}, ${remaining})" title="Preencher ${remaining}">
                                        Completar meta
                                    </button>
                                   </div>`
                        }
                    </div>
                    <input type="number"
                           id="material-input-${mat.id}"
                           name="material_${mat.id}"
                           data-material-id="${mat.id}"
                           data-farm-type="${group.type}"
                           data-goal="${matGoal}"
                           data-remaining="${remaining}"
                           class="material-input material-amount-input ${inputDisabled ? 'disabled' : ''}"
                           min="0"
                           max="${remaining}"
                           value="0"
                           placeholder="${isComplete ? 'ok' : remaining}"
                           ${inputDisabled ? 'disabled' : ''}
                           onkeypress="return event.charCode >= 48 && event.charCode <= 57"
                           oninput="validateMaterialInput(this, ${matGoal}); updateSubmitButton()">
                </div>
            `;
        }).join('');

        const screenshotsHtml = groupLocked ? '' : `
                <div class="farm-screenshot-block" data-farm-type="${group.type}">
                    <label>Print do ${getFarmTypeLabelClient(group.type)} <span class="required">*</span></label>
                    <div class="screenshots-area">
                        <div id="screenshotsPreview_${group.type}" class="screenshots-grid"></div>
                        <button type="button" class="btn-add-screenshot" onclick="addFarmScreenshot('${group.type}')">+ Adicionar Print</button>
                        <input type="file" id="screenshotInput_${group.type}" accept="image/*" style="display: none;" onchange="handleFarmScreenshotSelect(event, '${group.type}')">
                    </div>
                </div>
        `;

        return `
            <div class="material-farm-group" data-farm-type="${group.type}">
                <div class="material-group-header">
                    <div>
                        <div class="material-group-title">${group.title}</div>
                        <div class="material-group-subtitle">Materiais para o membro lançar</div>
                    </div>
                    <span class="material-group-status ${groupStatus.status || 'missing'}">${groupStatusText}</span>
                </div>
                <div class="farm-materials-list">
                    ${materialsHtml}
                </div>
                ${screenshotsHtml}
            </div>
        `;
    }).join('');

    container.innerHTML = farmGroupsHtml;

    const globalScreenshotArea = document.getElementById('screenshotsAddArea');
    if (globalScreenshotArea) {
        const legacyPrintGroup = globalScreenshotArea.closest('.form-group');
        if (legacyPrintGroup) legacyPrintGroup.style.display = 'none';
        globalScreenshotArea.style.display = 'none';
    }
    setTimeout(updateSubmitButton, 100);
}

// Função para preencher automaticamente com o valor restante
function fillRemainingAmount(materialId, remaining) {
    const input = document.getElementById(`material-input-${materialId}`);
    if (input && !input.disabled) {
        input.value = remaining;
        updateSubmitButton();
        // Efeito visual
        input.style.transition = 'all 0.3s';
        input.style.background = 'rgba(46, 204, 113, 0.2)';
        setTimeout(() => {
            input.style.background = '';
        }, 500);
    }
}

// Função para validar input de material (não pode passar da meta no painel principal)
function validateMaterialInput(input, maxGoal) {
    // Remover caracteres não numéricos
    input.value = input.value.replace(/[^0-9]/g, '');
    
    let value = parseInt(input.value) || 0;
    
    // Buscar progresso APROVADO do material (só conta o que foi aprovado)
    const materialId = input.dataset.materialId;
    let alreadyDelivered = 0;
    if (currentWeekData && currentWeekData.approvedProgress) {
        const progressItem = currentWeekData.approvedProgress.find(p => String(p.material_id) === String(materialId));
        if (progressItem) {
            alreadyDelivered = progressItem.current || 0;
        }
    }
    
    // Calcular máximo permitido (meta - já entregue e aprovado)
    const remaining = maxGoal - alreadyDelivered;
    
    if (value > remaining) {
        input.value = Math.max(0, remaining);
    }
    
    if (value < 0) {
        input.value = 0;
    }
}

// Função para validar input de dinheiro sujo (não pode passar da meta no painel principal)
function validateDirtyMoneyInput(input) {
    // Remover caracteres não numéricos
    input.value = input.value.replace(/[^0-9]/g, '');
    
    let value = parseInt(input.value) || 0;
    
    // Buscar meta e valor já entregue
    const selectedPaymentType = paymentTypes.find(pt => pt.id === currentPaymentTypeId);
    const goal = selectedPaymentType?.weekly_goal || 50000;
    
    let alreadyDelivered = 0;
    if (currentWeekData && currentWeekData.paymentType === 'dirty_money') {
        alreadyDelivered = currentWeekData.dirtyMoneyAmount || 0;
    }
    
    // Calcular máximo permitido (meta - já entregue)
    const remaining = goal - alreadyDelivered;
    
    if (value > remaining) {
        input.value = Math.max(0, remaining);
    }
    
    if (value < 0) {
        input.value = 0;
    }
}

// Função para atualizar texto do botão de submit baseado nos valores
function updateSubmitButton() {
    const btn = document.getElementById('submitDeliveryBtn');
    if (!btn) return;
    
    const materialInputs = document.querySelectorAll('.material-amount-input');
    let allComplete = true;
    let hasAnyValue = false;
    
    materialInputs.forEach(input => {
        const amount = parseInt(input.value) || 0;
        const goal = parseInt(input.dataset.goal) || 700;
        
        if (amount > 0) hasAnyValue = true;
        if (amount < goal) allComplete = false;
    });
    
    if (allComplete && hasAnyValue) {
        btn.textContent = '📤 Submeter para Aprovação';
        btn.classList.remove('secondary');
        btn.classList.add('primary');
    } else {
        btn.textContent = '💾 Salvar Progresso';
        btn.classList.remove('primary');
        btn.classList.add('secondary');
    }
}

// Versao separada por tipo de farm; sobrescreve o texto antigo do botao.
function updateSubmitButton() {
    const btn = document.getElementById('submitDeliveryBtn');
    if (!btn) return;

    const selectedFarmTypes = new Set();
    document.querySelectorAll('.material-amount-input').forEach(input => {
        if (input.disabled) return;
        const amount = parseInt(input.value, 10) || 0;
        if (amount > 0) {
            selectedFarmTypes.add(normalizeFarmTypeClient(input.dataset.farmType));
        }
    });

    btn.disabled = selectedFarmTypes.size === 0;

    if (selectedFarmTypes.size === 0) {
        btn.textContent = 'Informe uma meta para lancar';
        btn.classList.remove('primary');
        btn.classList.add('secondary');
        return;
    }

    if (selectedFarmTypes.size === 1) {
        const farmType = Array.from(selectedFarmTypes)[0];
        btn.textContent = `Lancar apenas meta de ${getFarmTypeLabelClient(farmType)}`;
    } else {
        const orderedTypes = ['drugs', 'weapons', 'general'].filter(type => selectedFarmTypes.has(type));
        btn.textContent = `Lancar metas de ${orderedTypes.map(getFarmTypeLabelClient).join(' e ')}`;
    }
    btn.classList.remove('secondary');
    btn.classList.add('primary');
}

// ========== SELETOR DE TIPO DE PAGAMENTO ==========

function selectPaymentType(type, paymentTypeId = null) {
    currentPaymentType = type;
    currentPaymentTypeId = paymentTypeId;
    
    // Atualizar botões
    document.querySelectorAll('.payment-type-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.type === type);
    });
    
    // Mostrar/ocultar formulários
    const materialForm = document.getElementById('deliveryForm');
    const dirtyMoneyForm = document.getElementById('dirtyMoneyForm');
    
    if (type === 'material') {
        materialForm.style.display = 'block';
        dirtyMoneyForm.style.display = 'none';
    } else {
        materialForm.style.display = 'none';
        dirtyMoneyForm.style.display = 'block';
        
        // Encontrar o tipo de pagamento selecionado
        const selectedPaymentType = paymentTypes.find(pt => pt.id === paymentTypeId);
        if (selectedPaymentType) {
            const isUnidade = selectedPaymentType.unit_type === 'unidade';
            const label = document.querySelector('#dirtyMoneyForm .form-label');
            if (label) label.textContent = `${selectedPaymentType.icon} Valor de ${selectedPaymentType.name}${isUnidade ? ' (unidades)' : ' (R$)'}`;
            
            document.getElementById('dirtyMoneyGoal').textContent = formatPaymentGoal(selectedPaymentType, selectedPaymentType.weekly_goal);
        }
    }
    
    // Atualizar seção de progresso
    updateProgressDisplay(type, paymentTypeId);
}

// Atualizar exibição do progresso baseado no tipo de pagamento
function updateProgressDisplay(type, paymentTypeId = null) {
    const progressContainer = document.getElementById('progressBars');
    const panelHeader = document.getElementById('progressPanelTitle');
    
    if (type !== 'material') {
        // Encontrar o tipo de pagamento
        const selectedPaymentType = paymentTypes.find(pt => pt.id === paymentTypeId) || paymentTypes[0];
        
        if (selectedPaymentType) {
            // Mostrar progresso do tipo de pagamento selecionado
            if (panelHeader) panelHeader.textContent = `${selectedPaymentType.icon} Meu Progresso`;
            
            // Usar o valor já entregue (do backend) se existir
            const deliveredAmount = (currentWeekData && currentWeekData.paymentType === 'dirty_money') 
                ? (currentWeekData.dirtyMoneyAmount || 0) 
                : 0;
            const goal = selectedPaymentType.weekly_goal;
            const percentage = Math.min(100, Math.round((deliveredAmount / goal) * 100));
            const isComplete = deliveredAmount >= goal;
            
            const fmt = (v) => formatPaymentGoal(selectedPaymentType, v);
            // Verificar se pode editar
            const canEdit = currentWeekData && currentWeekData.canEditValues;
            
            // Criar HTML do valor - editável ou não
            let valueHtml;
            if (canEdit && deliveredAmount > 0) {
                valueHtml = `<span class="value-display editable" onclick="openEditDirtyMoneyModal(${deliveredAmount}, ${goal}, '${(selectedPaymentType.name || '').replace(/'/g, "\\'")}', '${selectedPaymentType.icon || '💰'}', '${selectedPaymentType.unit_type || 'R$'}')" title="Clique para editar">
                    ${fmt(deliveredAmount)} / ${fmt(goal)} ✏️
                </span>`;
            } else {
                valueHtml = `<span class="value-display">${fmt(deliveredAmount)} / ${fmt(goal)}</span>`;
            }
            
            progressContainer.innerHTML = `
                <div class="progress-item ${isComplete ? 'complete' : ''}">
                    <div class="progress-header">
                        <span class="progress-label">
                            ${selectedPaymentType.icon} ${selectedPaymentType.name}
                        </span>
                        <span class="progress-value ${isComplete ? 'complete' : 'incomplete'}">
                            ${valueHtml}
                        </span>
                    </div>
                    <div class="progress-bar-bg">
                        <div class="progress-bar-fill" style="width: ${percentage}%; background: linear-gradient(90deg, #27ae60, #2ecc71);"></div>
                    </div>
                    <div class="progress-percentage-text">${percentage}%</div>
                </div>
            `;
        }
    } else {
        // Mostrar progresso de materiais (recarregar dados da semana)
        if (panelHeader) panelHeader.textContent = '📊 Meu Progresso';
        
        // Recarregar barras de progresso de materiais
        if (currentWeekData && currentWeekData.progress) {
            updateProgressBars(currentWeekData.progress);
        } else {
            progressContainer.innerHTML = '<div class="progress-empty">Selecione materiais para ver o progresso</div>';
        }
    }
}

// Atualizar botão de pagamento alternativo
function updateDirtyMoneyButton() {
    const btn = document.getElementById('submitDirtyMoneyBtn');
    if (!btn) return;
    
    const amount = parseInt(document.getElementById('dirtyMoneyAmount').value) || 0;
    
    // Encontrar a meta do tipo de pagamento atual
    const selectedPaymentType = paymentTypes.find(pt => pt.id === currentPaymentTypeId) || paymentTypes[0];
    const goal = selectedPaymentType?.weekly_goal || 50000;
    
    if (amount >= goal) {
        btn.textContent = '📤 Submeter para Aprovação';
        btn.classList.remove('secondary');
        btn.classList.add('primary');
    } else {
        btn.textContent = '💾 Salvar Progresso';
        btn.classList.remove('primary');
        btn.classList.add('secondary');
    }
    
    // Atualizar também a barra de progresso
    if (currentPaymentType !== 'material') {
        updateProgressDisplay(currentPaymentType, currentPaymentTypeId);
    }
}

// Screenshots para pagamento alternativo
function addScreenshotDirty() {
    document.getElementById('screenshotInputDirty').click();
}

function handleScreenshotSelectDirty(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    // Verificar tamanho (5MB max)
    if (file.size > 5 * 1024 * 1024) {
        alert('Imagem muito grande! Máximo 5MB');
        return;
    }
    
    screenshotFilesDirty.push(file);
    
    // Preview
    const reader = new FileReader();
    reader.onload = (e) => {
        const preview = document.getElementById('screenshotsPreviewDirty');
        const idx = screenshotFilesDirty.length - 1;
        preview.innerHTML += `
            <div class="screenshot-preview" data-index="${idx}">
                <img src="${e.target.result}" alt="Screenshot ${idx + 1}" onclick="openModal('${e.target.result}')">
                <button type="button" class="screenshot-remove" onclick="removeScreenshotDirty(${idx})">×</button>
            </div>
        `;
    };
    reader.readAsDataURL(file);
    
    // Limpar input
    event.target.value = '';
}

function removeScreenshotDirty(index) {
    screenshotFilesDirty.splice(index, 1);
    updateScreenshotPreviewDirty();
}

function updateScreenshotPreviewDirty() {
    const preview = document.getElementById('screenshotsPreviewDirty');
    preview.innerHTML = '';
    
    screenshotFilesDirty.forEach((file, idx) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            preview.innerHTML += `
                <div class="screenshot-preview" data-index="${idx}">
                    <img src="${e.target.result}" alt="Screenshot ${idx + 1}" onclick="openModal('${e.target.result}')">
                    <button type="button" class="screenshot-remove" onclick="removeScreenshotDirty(${idx})">×</button>
                </div>
            `;
        };
        reader.readAsDataURL(file);
    });
}

// ========== FIM SELETOR DE TIPO DE PAGAMENTO ==========

// Carregar estatísticas simples
async function loadStats() {
    try {
        // Buscar advertências para o cartão de resumo
        const warningsRes = await fetch('/api/delivery/my-warnings');
        const warningsData = await warningsRes.json();
        const advCount = warningsData.count || 0;

        const advEl = document.getElementById('advSummaryValue');
        if (advEl) {
            advEl.textContent = advCount;
            advEl.classList.toggle('unpaid', advCount > 0);
            advEl.classList.toggle('paid', advCount === 0);
        }

        // Compatibilidade: se ainda existir o contador antigo, atualiza também
        const legacyWarnings = document.getElementById('warningsCount');
        if (legacyWarnings) legacyWarnings.textContent = advCount;
    } catch (error) {
        console.error('Erro ao carregar estatísticas:', error);
    }
}

// Atualiza o bloco "Meta desta semana" no cartão de resumo do membro
function updateMetaSummary(data) {
    const valueEl = document.getElementById('metaSummaryValue');
    const tileEl = document.getElementById('metaSummaryTile');
    if (!valueEl || !tileEl) return;

    let text = '⚠️ Não paga';
    let state = 'unpaid';

    if (data && data.hasDelivery) {
        if (data.deliveryStatus === 'approved' && !data.isPartial) {
            text = '✅ Paga';
            state = 'paid';
        } else if (data.isPartial) {
            text = '⚡ Parcial';
            state = 'partial';
        } else if (data.deliveryStatus === 'pending') {
            text = '⏳ Aguardando';
            state = 'pending';
        } else if (data.deliveryStatus === 'rejected' || data.deliveryStatus === 'not_delivered') {
            text = '❌ Recusada';
            state = 'unpaid';
        } else {
            text = '⏳ Processando';
            state = 'pending';
        }
    } else if (data && data.hasJustification) {
        if (data.justificationStatus === 'approved') {
            text = '📋 Justificada';
            state = 'justified';
        } else {
            text = '⏳ Justif. aguardando';
            state = 'pending';
        }
    }

    valueEl.textContent = text;
    valueEl.className = 'member-summary-value meta ' + state;

    updateMemberGreeting(data, state);
}

// Saudação personalizada: vulgo + situação da meta (paga ou dias restantes)
function updateMemberGreeting(data, state) {
    const el = document.getElementById('memberGreeting');
    if (!el) return;
    const nome = (currentUser && (currentUser.capital_nickname || currentUser.name)) || 'membro';
    const paid = state === 'paid' || state === 'justified';

    if (paid) {
        el.classList.add('paid');
        el.innerHTML = `Olá <b>${escapeHtml(nome)}</b>, parabéns! 🎉 Você já pagou a sua meta desta semana.`;
        return;
    }

    el.classList.remove('paid');
    let msg = 'não esqueça de pagar a sua meta desta semana.';
    if (data && data.week && data.week.end) {
        const end = new Date(data.week.end + 'T23:59:59');
        const now = new Date();
        const days = Math.ceil((end - now) / (24 * 60 * 60 * 1000));
        if (days <= 0) msg = 'hoje é o <b>último dia</b> para pagar a sua meta! ⏰';
        else if (days === 1) msg = 'falta <b>1 dia</b> para você pagar a sua meta. ⏳';
        else msg = `faltam <b>${days} dias</b> para você pagar a sua meta. ⏳`;
    }
    el.innerHTML = `Olá <b>${escapeHtml(nome)}</b>, ${msg}`;
}

// Carregar minhas entregas
async function loadMyDeliveries() {
    try {
        const response = await fetch('/api/delivery/my');
        const data = await response.json();
        myDeliveriesCache = data.deliveries || [];
        
        const deliveriesList = document.getElementById('deliveriesList');
        
        let html = '';
        
        if (data.deliveries && data.deliveries.length > 0) {
            // Título da seção de farms da meta
            html = `<h3 style="color: #00b894; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 2px solid #00b894;">📦 Meus Farms da Meta</h3>`;
            
            html += data.deliveries.map(delivery => {
                const normalizedStatus = (delivery.status === 'rejected' || delivery.status === 'not_delivered') ? 'rejected' : delivery.status;
                // Montar galeria de screenshots
                let screenshotsHtml = '';
                if (delivery.screenshots && delivery.screenshots.length > 0) {
                    screenshotsHtml = delivery.screenshots.map((s, idx) => `
                        <img src="${s.screenshot_url}" class="delivery-screenshot" onclick="openModal('${s.screenshot_url}')" title="Print ${idx + 1}" style="border: 2px solid #00b894;">
                    `).join('');
                } else if (delivery.screenshot_url) {
                    screenshotsHtml = `<img src="${delivery.screenshot_url}" class="delivery-screenshot" onclick="openModal('${delivery.screenshot_url}')" style="border: 2px solid #00b894;">`;
                }
                
                const statusText = delivery.is_partial ? '✅ Aprovado' : getStatusText(normalizedStatus, delivery.is_partial);
                const statusClass = delivery.is_partial && normalizedStatus === 'approved' ? 'partial' : normalizedStatus;
                const rejectionReasonHtml = normalizedStatus === 'rejected' && delivery.approval_note
                    ? `<p style="margin-top: 10px; color: #ff7675;"><strong>Motivo da reprovação:</strong> ${delivery.approval_note}</p>`
                    : '';
                // Só mostrar "Aprovado" e "Por:" quando estiver tudo completo (aprovado e não parcial)
                const showAprovado = normalizedStatus === 'approved' && !delivery.is_partial && delivery.approved_by_name;
                
                return `
                <div class="delivery-item ${delivery.is_partial ? 'partial' : ''}" style="border-left: 3px solid #00b894;">
                    <div class="delivery-info">
                        <h3>📦 Semana ${formatWeek(delivery.week_start, delivery.week_end)}</h3>
                        <div class="materials-list">
                            ${delivery.items.map(item => {
                                const itemGoal = materialsGoals[item.material_id] || weeklyGoal;
                                return `
                                    <span class="material-tag ${item.amount < itemGoal ? 'below-goal' : ''}">${item.material_icon} ${item.material_name}: ${formatNumber(item.amount)}${item.amount < itemGoal ? `<small>/${itemGoal}</small>` : ''}</span>
                                `;
                            }).join('')}
                        </div>
                        ${delivery.description ? `<p>📝 ${delivery.description}</p>` : ''}
                        <p>📅 ${formatDate(delivery.created_at)}</p>
                        ${showAprovado ? `<span class="status ${statusClass}">${statusText}</span><p style="margin-top: 10px;">Por: <strong>${delivery.approved_by_name}</strong></p>` : ''}
                        ${rejectionReasonHtml}
                    </div>
                    <div class="delivery-actions screenshots-grid">
                        ${screenshotsHtml}
                    </div>
                </div>
            `}).join('');
        }
        
        // Carregar farms extras: só mostrar quando competição estiver ATIVA
        if (farmSettings.competition_enabled === 'true') {
            try {
                const extrasResponse = await fetch('/api/delivery/my-extra-farms');
                const extrasData = await extrasResponse.json();
                
                if (extrasData.extras && extrasData.extras.length > 0) {
                    html += `
                        <div class="extra-farms-section" style="margin-top: 30px; padding-top: 20px;">
                            <h3 style="color: #ffd700; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 2px solid #ffd700;">🏆 Meus Farms Extras (Ranking)</h3>
                            <p style="color: #888; font-size: 0.85em; margin-bottom: 15px;">Farms além da meta - contam apenas para o ranking semanal</p>
                    `;
                    
                    html += extrasData.extras.map(extra => {
                        const statusClass = extra.status === 'approved' ? 'approved' : extra.status === 'rejected' ? 'rejected' : 'pending';
                        const statusText = extra.status === 'approved' ? '✅ Aprovado' : extra.status === 'rejected' ? '❌ Rejeitado' : '⏳ Pendente';
                        
                        let screenshotsHtml = '';
                        if (extra.screenshots && extra.screenshots.length > 0) {
                            screenshotsHtml = extra.screenshots.map((s, idx) => `
                                <img src="${s.screenshot_url}" class="delivery-screenshot" onclick="openModal('${s.screenshot_url}')" title="Print Extra ${idx + 1}" style="border: 2px solid #ffd700;">
                            `).join('');
                        }
                        
                        return `
                        <div class="delivery-item extra-farm-item" style="border-left: 3px solid #ffd700; background: rgba(255, 215, 0, 0.05);">
                            <div class="delivery-info">
                                <h3 style="color: #ffd700;">🏆 Farm Extra - Semana ${formatWeek(extra.week_start, extra.week_end)}</h3>
                                <div class="materials-list">
                                    ${extra.materialDetails.map(mat => `
                                        <span class="material-tag" style="background: linear-gradient(135deg, #ffd700 0%, #ff8c00 100%); color: #000;">
                                            ${mat.icon || '📦'} ${mat.name}: ${formatNumber(mat.amount)}
                                        </span>
                                    `).join('')}
                                </div>
                                <p>📅 ${formatDate(extra.created_at)}</p>
                                <span class="status ${statusClass}">${statusText}</span>
                                ${extra.reviewed_by_name ? `<p style="margin-top: 10px;">Por: <strong>${extra.reviewed_by_name}</strong></p>` : ''}
                            </div>
                            <div class="delivery-actions screenshots-grid">
                                ${screenshotsHtml}
                            </div>
                        </div>
                        `;
                    }).join('');
                    
                    html += '</div>';
                }
            } catch (e) {
                console.log('Farms extras não disponíveis');
            }
        }
        
        if (!html) {
            html = `
                <div class="empty-state">
                    <span>📭</span>
                    <p>Você ainda não registrou nenhuma entrega de farm.</p>
                </div>
            `;
        }
        
        deliveriesList.innerHTML = html;
        checkNotifications();
    } catch (error) {
        console.error('Erro ao carregar entregas:', error);
    }
}

// Carregar minhas justificativas
async function loadMyAbsences() {
    try {
        const response = await fetch('/api/delivery/my-justifications');
        const data = await response.json();
        
        const absencesCard = document.getElementById('absencesCard');
        const absencesList = document.getElementById('absencesList');
        
        if (data.justifications && data.justifications.length > 0) {
            absencesCard.style.display = 'block';
            absencesList.innerHTML = data.justifications.map(j => `
                <div class="delivery-item absence-item">
                    <div class="delivery-info">
                        <h3>📝 Semana ${formatWeek(j.week_start, j.week_end)}</h3>
                        <p><strong>Motivo:</strong> ${escapeHtml(j.reason)}</p>
                        <p>📅 Enviado: ${formatDate(j.created_at)}</p>
                        <span class="status ${j.status}">${getAbsenceStatusText(j.status)}</span>
                        ${j.approved_by_name ? `<p style="margin-top: 10px;">Por: <strong>${escapeHtml(j.approved_by_name)}</strong></p>` : ''}
                    </div>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Erro ao carregar justificativas:', error);
    }
}

// Submeter nova entrega
document.getElementById('deliveryForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Usar o offset da semana atual
    const weekOffset = currentWeekOffset;
    
    // Verificar se pode entregar
    if (!currentWeekData || !currentWeekData.canDeliver) {
        alert('Não é possível entregar farm para esta semana!');
        return;
    }
    
    // Coletar todos os materiais com quantidade > 0
    const materialInputs = document.querySelectorAll('.material-amount-input');
    const materials = [];

    materialInputs.forEach(input => {
        const amount = parseInt(input.value) || 0;
        if (amount > 0) {
            const matId = input.dataset.materialId;
            materials.push({
                material_id: matId,
                amount: amount
            });
        }
    });
    
    const messageEl = document.getElementById('formMessage');
    
    // VALIDAÇÃO: Precisa ter pelo menos um material
    if (materials.length === 0) {
        messageEl.textContent = '❌ Informe a quantidade de pelo menos um material!';
        messageEl.className = 'form-message show error';
        setTimeout(() => { messageEl.className = 'form-message'; }, 5000);
        return;
    }
    
    // VALIDAÇÃO: Precisa ter screenshot NOVO em CADA lançamento (obrigatório)
    const hasNewScreenshots = uploadedScreenshots && uploadedScreenshots.length > 0;
    
    if (!hasNewScreenshots) {
        messageEl.textContent = '❌ Anexe pelo menos 1 print do farm! (obrigatório em cada envio)';
        messageEl.className = 'form-message show error';
        setTimeout(() => { messageEl.className = 'form-message'; }, 5000);
        return;
    }
    
    // Montar sumário dos materiais para confirmação
    const materialsSummary = materials.map(mat => {
        const matInfo = materialsData.find(m => m.id == mat.material_id);
        const name = matInfo ? matInfo.name : `Material ${mat.material_id}`;
        const icon = matInfo ? matInfo.icon : '📦';
        return { name, icon, amount: mat.amount };
    });
    
    const totalMaterials = materials.reduce((sum, m) => sum + m.amount, 0);
    const screenshotsCount = uploadedScreenshots.length; // Sempre usa novos screenshots
    
    // Avisar se há semana anterior não paga (só na semana atual), depois confirmar
    withUnpaidWeekWarning(weekOffset, () => {
        showDeliveryConfirmationModal({
            type: 'meta',
            weekLabel: currentWeekData.week.label,
            materials: materialsSummary,
            totalMaterials: totalMaterials,
            screenshotsCount: screenshotsCount,
            isFutureWeek: weekOffset > 0,
            onConfirm: () => submitMetaFarm(materials, weekOffset, messageEl, materialInputs)
        });
    });
});

// Função para submeter farm da meta após confirmação
async function submitMetaFarm(materials, weekOffset, messageEl, materialInputs) {
    closeDeliveryConfirmationModal();
    
    const formData = new FormData();
    formData.append('materials', JSON.stringify(materials));
    formData.append('description', document.getElementById('description').value);
    formData.append('week_offset', weekOffset);
    
    // Adicionar screenshots do array
    for (let i = 0; i < uploadedScreenshots.length; i++) {
        formData.append('screenshots', uploadedScreenshots[i].file);
    }
    
    try {
        const response = await fetch('/api/delivery', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
            messageEl.textContent = data.message;
            messageEl.className = 'form-message show success';
            
            // Limpa o formulário
            document.getElementById('deliveryForm').reset();
            clearAllScreenshots();
            
            // Reseta os valores dos inputs de materiais
            materialInputs.forEach(input => input.value = '0');
            
            // Recarrega os dados
            loadWeekData(currentWeekOffset);
            loadAvailableWeeks();
            loadStats();
            loadMyDeliveries();
        } else {
            messageEl.textContent = data.error || 'Erro ao enviar entrega';
            messageEl.className = 'form-message show error';
        }
    } catch (error) {
        messageEl.textContent = 'Erro de conexão';
        messageEl.className = 'form-message show error';
    }
    
    setTimeout(() => {
        messageEl.className = 'form-message';
    }, 5000);
}

// Submeter entrega com tipo de pagamento alternativo (dinheiro sujo, limpo, etc)
document.getElementById('dirtyMoneyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const weekOffset = currentWeekOffset;
    const messageEl = document.getElementById('formMessage');
    
    // Verificar se pode entregar
    if (!currentWeekData || !currentWeekData.canDeliver) {
        alert('Não é possível entregar farm para esta semana!');
        return;
    }
    
    const amount = parseInt(document.getElementById('dirtyMoneyAmount').value) || 0;
    
    if (amount <= 0) {
        alert('Informe o valor!');
        return;
    }
    
    // Verificar screenshots
    const hasExistingScreenshots = currentWeekData?.existingScreenshots?.length > 0;
    if (screenshotFilesDirty.length === 0 && !hasExistingScreenshots) {
        alert('Envie pelo menos 1 print do pagamento!');
        return;
    }
    
    // Se for semana futura, pedir confirmação
    if (weekOffset > 0) {
        const confirmMsg = `⚠️ ATENÇÃO!\n\nVocê está prestes a registrar farm de uma SEMANA FUTURA:\n\n📅 ${currentWeekData.week.label}\n\nTem certeza?`;
        
        if (!confirm(confirmMsg)) {
            return;
        }
    }
    
    // Avisar se há semana anterior não paga (só na semana atual), depois enviar
    withUnpaidWeekWarning(weekOffset, async () => {
    // Criar FormData
    const formData = new FormData();
    formData.append('payment_type', 'dirty_money'); // Tipo genérico para pagamento em dinheiro
    formData.append('payment_type_id', currentPaymentTypeId || '');
    formData.append('dirty_money_amount', amount);
    formData.append('description', document.getElementById('descriptionDirty').value || '');
    formData.append('week_offset', weekOffset);
    formData.append('materials', JSON.stringify([])); // Array vazio de materiais
    
    // Adicionar screenshots
    for (let i = 0; i < screenshotFilesDirty.length; i++) {
        formData.append('screenshots', screenshotFilesDirty[i]);
    }
    
    try {
        const response = await fetch('/api/delivery', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
            messageEl.textContent = data.message;
            messageEl.className = 'form-message show success';
            
            // Limpa o formulário
            document.getElementById('dirtyMoneyForm').reset();
            screenshotFilesDirty = [];
            document.getElementById('screenshotsPreviewDirty').innerHTML = '';
            
            // Recarrega os dados
            loadWeekData(currentWeekOffset);
            loadAvailableWeeks();
            loadStats();
            loadMyDeliveries();
        } else {
            messageEl.textContent = data.error || 'Erro ao enviar entrega';
            messageEl.className = 'form-message show error';
        }
    } catch (error) {
        messageEl.textContent = 'Erro de conexão';
        messageEl.className = 'form-message show error';
    }

    setTimeout(() => {
        messageEl.className = 'form-message';
    }, 5000);
    });
});

// Submeter justificativa de ausência
document.getElementById('absenceForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const reason = document.getElementById('absenceReason').value;
    const messageEl = document.getElementById('absenceMessage');
    
    try {
        const response = await fetch('/api/delivery/absence', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason, weekOffset: currentWeekOffset })
        });
        
        const data = await response.json();
        
        if (data.success) {
            messageEl.textContent = data.message;
            messageEl.className = 'form-message show success';
            document.getElementById('absenceForm').reset();
            
            loadWeekData(currentWeekOffset);
            loadMyAbsences();
        } else {
            messageEl.textContent = data.error || 'Erro ao enviar justificativa';
            messageEl.className = 'form-message show error';
        }
    } catch (error) {
        messageEl.textContent = 'Erro de conexão';
        messageEl.className = 'form-message show error';
    }
    
    setTimeout(() => {
        messageEl.className = 'form-message';
    }, 5000);
});

// ===== SISTEMA DE SCREENSHOTS =====
let uploadedScreenshots = []; // Array para armazenar os arquivos

function addFarmScreenshot(type) {
    const normalized = normalizeFarmTypeClient(type);
    const input = document.getElementById(`screenshotInput_${normalized}`);
    if (input) input.click();
}

function handleFarmScreenshotSelect(event, type) {
    const normalized = normalizeFarmTypeClient(type);
    const file = event.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
        alert('Arquivo muito grande! Maximo 5MB.');
        return;
    }

    if (!file.type.startsWith('image/')) {
        alert('Selecione apenas imagens!');
        return;
    }

    if (!farmScreenshotFiles[normalized]) farmScreenshotFiles[normalized] = [];
    const id = Date.now() + Math.floor(Math.random() * 1000);
    farmScreenshotFiles[normalized].push({ id, file });

    const reader = new FileReader();
    reader.onload = (e) => renderFarmScreenshotPreview(normalized, id, e.target.result, file.name);
    reader.readAsDataURL(file);
    event.target.value = '';
}

function renderFarmScreenshotPreview(type, id, dataUrl, fileName) {
    const container = document.getElementById(`screenshotsPreview_${type}`);
    if (!container) return;

    const div = document.createElement('div');
    div.className = 'screenshot-preview-item';
    div.id = `screenshot-${type}-${id}`;
    div.innerHTML = `
        <img src="${dataUrl}" alt="${escapeHtml(fileName)}" onclick="openModal('${dataUrl}')">
        <div class="screenshot-info">
            <span class="screenshot-name">${fileName.length > 15 ? escapeHtml(fileName.substring(0, 12)) + '...' : escapeHtml(fileName)}</span>
            <button type="button" class="btn-remove-screenshot" onclick="removeFarmScreenshot('${type}', ${id})" title="Remover print">x</button>
        </div>
    `;
    container.appendChild(div);
}

function removeFarmScreenshot(type, id) {
    const normalized = normalizeFarmTypeClient(type);
    farmScreenshotFiles[normalized] = (farmScreenshotFiles[normalized] || []).filter(s => s.id !== id);
    const element = document.getElementById(`screenshot-${normalized}-${id}`);
    if (element) element.remove();
}

function clearFarmScreenshots(type = null) {
    const types = type ? [normalizeFarmTypeClient(type)] : Object.keys(farmScreenshotFiles);
    types.forEach(farmType => {
        farmScreenshotFiles[farmType] = [];
        const preview = document.getElementById(`screenshotsPreview_${farmType}`);
        if (preview) preview.innerHTML = '';
    });
}

// Abrir seletor de arquivo
function addScreenshot() {
    document.getElementById('screenshotInput').click();
}

// Quando selecionar um arquivo
function handleScreenshotSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    // Validar tamanho (5MB)
    if (file.size > 5 * 1024 * 1024) {
        alert('Arquivo muito grande! Máximo 5MB.');
        return;
    }
    
    // Validar tipo
    if (!file.type.startsWith('image/')) {
        alert('Selecione apenas imagens!');
        return;
    }
    
    // Adicionar ao array
    const id = Date.now();
    uploadedScreenshots.push({ id, file });
    
    // Mostrar preview
    const reader = new FileReader();
    reader.onload = (e) => {
        renderScreenshotPreview(id, e.target.result, file.name);
    };
    reader.readAsDataURL(file);
    
    // Limpar input para permitir selecionar o mesmo arquivo novamente
    event.target.value = '';
}

// Renderizar preview de um screenshot
function renderScreenshotPreview(id, dataUrl, fileName) {
    const container = document.getElementById('screenshotsPreview');
    
    const div = document.createElement('div');
    div.className = 'screenshot-preview-item';
    div.id = `screenshot-${id}`;
    div.innerHTML = `
        <img src="${dataUrl}" alt="${fileName}" onclick="openModal('${dataUrl}')">
        <div class="screenshot-info">
            <span class="screenshot-name">${fileName.length > 15 ? fileName.substring(0, 12) + '...' : fileName}</span>
            <button type="button" class="btn-remove-screenshot" onclick="removeScreenshot(${id})" title="Remover print">
                ✕
            </button>
        </div>
    `;
    
    container.appendChild(div);
}

// Remover um screenshot
function removeScreenshot(id) {
    // Remover do array
    uploadedScreenshots = uploadedScreenshots.filter(s => s.id !== id);
    
    // Remover do DOM
    const element = document.getElementById(`screenshot-${id}`);
    if (element) {
        element.classList.add('removing');
        setTimeout(() => element.remove(), 200);
    }
}

// Limpar todos os screenshots
function clearAllScreenshots() {
    uploadedScreenshots = [];
    const container = document.getElementById('screenshotsPreview');
    if (container) container.innerHTML = '';
}

// Modal de confirmação de envio de farm
function showDeliveryConfirmationModal(options) {
    const { type, weekLabel, materials, totalMaterials, screenshotsCount, isFutureWeek, onConfirm } = options;
    
    // Remover modal existente
    const existingModal = document.getElementById('deliveryConfirmModal');
    if (existingModal) existingModal.remove();
    
    const isExtra = type === 'extra';
    const titleColor = isExtra ? '#ffd700' : '#00b894';
    const titleIcon = isExtra ? '🏆' : '📦';
    const titleText = isExtra ? 'Confirmar Farm Extra' : 'Confirmar Farm da Meta';
    
    const materialsHtml = materials.map(mat => `
        <div class="confirm-material-item">
            <span class="mat-icon">${mat.icon}</span>
            <span class="mat-name">${mat.name}</span>
            <span class="mat-amount">${formatNumber(mat.amount)}</span>
        </div>
    `).join('');
    
    const futureWarning = isFutureWeek ? `
        <div class="future-week-warning">
            ⚠️ <strong>ATENÇÃO:</strong> Esta é uma semana FUTURA!
        </div>
    ` : '';
    
    const modal = document.createElement('div');
    modal.id = 'deliveryConfirmModal';
    modal.className = 'delivery-confirm-overlay';
    modal.innerHTML = `
        <div class="delivery-confirm-content">
            <div class="confirm-header" style="border-bottom-color: ${titleColor}">
                <span class="confirm-icon">${titleIcon}</span>
                <h2 style="color: ${titleColor}">${titleText}</h2>
            </div>
            
            ${futureWarning}
            
            <div class="confirm-week">
                <span class="week-icon">📅</span>
                <span class="week-label">${weekLabel}</span>
            </div>
            
            <div class="confirm-materials">
                <h3>📋 Materiais a enviar:</h3>
                <div class="materials-list">
                    ${materialsHtml}
                </div>
                <div class="materials-total" style="border-color: ${titleColor}">
                    <span>Total:</span>
                    <strong style="color: ${titleColor}">${formatNumber(totalMaterials)} materiais</strong>
                </div>
            </div>
            
            <div class="confirm-screenshots">
                <span>🖼️ Prints anexados: <strong>${screenshotsCount}</strong></span>
            </div>
            
            <div class="confirm-actions">
                <button class="btn btn-success btn-confirm" id="confirmDeliveryBtn">
                    ✅ Confirmar Envio
                </button>
                <button class="btn btn-secondary" onclick="closeDeliveryConfirmationModal()">
                    ❌ Cancelar
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Adicionar evento de confirmação
    document.getElementById('confirmDeliveryBtn').addEventListener('click', onConfirm);
    
    // Fechar ao clicar fora
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeDeliveryConfirmationModal();
    });
}

function closeDeliveryConfirmationModal() {
    const modal = document.getElementById('deliveryConfirmModal');
    if (modal) modal.remove();
}

const farmDeliveryForm = document.getElementById('deliveryForm');
if (farmDeliveryForm) {
    farmDeliveryForm.addEventListener('submit', (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();

        const weekOffset = currentWeekOffset;
        const messageEl = document.getElementById('formMessage');

        if (!currentWeekData || !currentWeekData.canDeliver) {
            alert('Nao e possivel entregar farm para esta semana!');
            return;
        }

        const jobsByType = new Map();
        document.querySelectorAll('.material-amount-input').forEach(input => {
            if (input.disabled) return;
            const amount = parseInt(input.value) || 0;
            if (amount <= 0) return;

            const farmType = normalizeFarmTypeClient(input.dataset.farmType);
            if (!jobsByType.has(farmType)) jobsByType.set(farmType, []);
            jobsByType.get(farmType).push({
                material_id: input.dataset.materialId,
                amount
            });
        });

        if (jobsByType.size === 0) {
            messageEl.textContent = 'Informe a quantidade de pelo menos um material.';
            messageEl.className = 'form-message show error';
            setTimeout(() => { messageEl.className = 'form-message'; }, 5000);
            return;
        }

        const jobs = [];
        for (const [farmType, materials] of jobsByType.entries()) {
            const screenshots = farmScreenshotFiles[farmType] || [];
            if (screenshots.length === 0) {
                messageEl.textContent = `Anexe pelo menos 1 print do farm de ${getFarmTypeLabelClient(farmType)}.`;
                messageEl.className = 'form-message show error';
                setTimeout(() => { messageEl.className = 'form-message'; }, 5000);
                return;
            }
            jobs.push({ farmType, materials, screenshots });
        }

        const materialsSummary = [];
        jobs.forEach(job => {
            job.materials.forEach(mat => {
                const matInfo = materialsData.find(m => String(m.id) === String(mat.material_id));
                materialsSummary.push({
                    name: `${getFarmTypeLabelClient(job.farmType)} - ${matInfo ? matInfo.name : `Material ${mat.material_id}`}`,
                    icon: matInfo ? matInfo.icon : '📦',
                    amount: mat.amount
                });
            });
        });

        showDeliveryConfirmationModal({
            type: 'meta',
            weekLabel: currentWeekData.week.label,
            materials: materialsSummary,
            totalMaterials: jobs.reduce((sum, job) => sum + job.materials.reduce((s, mat) => s + mat.amount, 0), 0),
            screenshotsCount: jobs.reduce((sum, job) => sum + job.screenshots.length, 0),
            isFutureWeek: weekOffset > 0,
            onConfirm: () => submitMetaFarmSeparated(jobs, weekOffset, messageEl)
        });
    }, true);
}

async function submitMetaFarmSeparated(jobs, weekOffset, messageEl) {
    closeDeliveryConfirmationModal();

    try {
        for (const job of jobs) {
            const formData = new FormData();
            formData.append('materials', JSON.stringify(job.materials));
            formData.append('description', `[Farm de ${getFarmTypeLabelClient(job.farmType)}] ${document.getElementById('description').value || ''}`.trim());
            formData.append('week_offset', weekOffset);

            for (const screenshot of job.screenshots) {
                formData.append('screenshots', screenshot.file);
            }

            const response = await fetch('/api/delivery', {
                method: 'POST',
                body: formData
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || `Erro ao enviar farm de ${getFarmTypeLabelClient(job.farmType)}`);
            }
        }

        messageEl.textContent = jobs.length > 1 ? 'Farms enviados separadamente para aprovacao.' : 'Farm enviado para aprovacao.';
        messageEl.className = 'form-message show success';
        farmDeliveryForm.reset();
        clearFarmScreenshots();
        clearAllScreenshots();
        document.querySelectorAll('.material-amount-input').forEach(input => input.value = '0');
        loadWeekData(currentWeekOffset);
        loadAvailableWeeks();
        loadStats();
        loadMyDeliveries();
    } catch (error) {
        messageEl.textContent = error.message || 'Erro ao enviar entrega';
        messageEl.className = 'form-message show error';
    }

    setTimeout(() => {
        messageEl.className = 'form-message';
    }, 5000);
}

// Remover screenshot existente de farm pendente
async function removeExistingScreenshot(screenshotId) {
    if (!confirm('Tem certeza que deseja remover este print?')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/delivery/screenshot/${screenshotId}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            // Remover visualmente
            const element = document.getElementById(`screenshot-${screenshotId}`);
            const elementDirty = document.getElementById(`screenshot-dirty-${screenshotId}`);
            
            if (element) {
                element.style.transition = 'all 0.3s';
                element.style.opacity = '0';
                element.style.transform = 'scale(0.8)';
                setTimeout(() => element.remove(), 300);
            }
            if (elementDirty) {
                elementDirty.style.transition = 'all 0.3s';
                elementDirty.style.opacity = '0';
                elementDirty.style.transform = 'scale(0.8)';
                setTimeout(() => elementDirty.remove(), 300);
            }
            
            // Atualizar o cache local
            if (currentWeekData && currentWeekData.existingScreenshots) {
                currentWeekData.existingScreenshots = currentWeekData.existingScreenshots.filter(s => s.id !== screenshotId);
            }
            
            showToast('Print removido com sucesso!', 'success');
        } else {
            showToast(data.error || 'Erro ao remover print', 'error');
        }
    } catch (error) {
        console.error('Erro ao remover screenshot:', error);
        showToast('Erro ao remover print', 'error');
    }
}

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

function formatWeek(start, end) {
    // PostgreSQL pode retornar datas em diferentes formatos
    // Extrair apenas a parte da data (YYYY-MM-DD)
    const parseDate = (dateStr) => {
        if (!dateStr) return null;
        // Se for string ISO completa, pegar só a parte da data
        const datePart = String(dateStr).split('T')[0];
        const [year, month, day] = datePart.split('-');
        return new Date(year, month - 1, day);
    };
    
    const startDate = parseDate(start);
    const endDate = parseDate(end);
    
    if (!startDate || !endDate || isNaN(startDate) || isNaN(endDate)) {
        return 'Data inválida';
    }
    
    return `${startDate.toLocaleDateString('pt-BR')} - ${endDate.toLocaleDateString('pt-BR')}`;
}

function getStatusText(status, isPartial = false) {
    if (isPartial) {
        const texts = {
            pending: '⏳ Parcialmente Pago - Aguardando Aprovação',
            approved: '⚠️ Parcialmente Pago - Aprovado',
            rejected: '❌ Parcialmente Pago - Rejeitado',
            not_delivered: '❌ Parcialmente Pago - Rejeitado',
            in_progress: '⚡ Em Progresso'
        };
        return texts[status] || status;
    }
    const texts = {
        pending: '⏳ Aguardando Aprovação',
        approved: '✅ Farm Completo - Aprovado',
        rejected: '❌ Rejeitado',
        not_delivered: '❌ Rejeitado',
        in_progress: '⚡ Em Progresso'
    };
    return texts[status] || status;
}

function getAbsenceStatusText(status) {
    const texts = {
        pending: '⏳ Aguardando Aprovação',
        approved: '✅ Justificativa Aceita',
        rejected: '❌ Justificativa Rejeitada'
    };
    return texts[status] || status;
}

// ===== MODAL DE ADVERTÊNCIAS =====

// Mostrar modal de advertências
async function showMyWarnings() {
    try {
        const response = await fetch('/api/delivery/my-warnings');
        const data = await response.json();
        
        const modalBody = document.getElementById('warningsModalBody');
        
        if (data.warnings && data.warnings.length > 0) {
            modalBody.innerHTML = data.warnings.map(warning => `
                <div class="warning-item">
                    <div class="warning-reason">
                        📝 ${escapeHtml(warning.reason)}
                    </div>
                    <div class="warning-meta">
                        <span>👤 Aplicada por: <strong>${escapeHtml(warning.given_by_name)}</strong></span>
                        <span>📅 ${formatDate(warning.created_at)}</span>
                    </div>
                </div>
            `).join('');
        } else {
            modalBody.innerHTML = `
                <div class="no-warnings">
                    <div class="icon">✅</div>
                    <p>Você não possui nenhuma advertência!</p>
                </div>
            `;
        }
        
        document.getElementById('warningsModal').classList.add('show');
    } catch (error) {
        console.error('Erro ao carregar advertências:', error);
        alert('Erro ao carregar advertências');
    }
}

// Fechar modal de advertências
function closeWarningsModal() {
    document.getElementById('warningsModal').classList.remove('show');
}

// ===== SEMANAS NÃO PAGAS =====

// Carregar semanas não pagas (apenas semanas PASSADAS que NÃO foram pagas)
async function loadUnpaidWeeks() {
    try {
        // Usar os dados de availableWeeksData que já foram carregados
        // Contar semanas passadas que NÃO foram pagas (available = true significa que ainda pode pagar)
        // Ou seja, semanas com offset < 0 E available = true são semanas atrasadas não pagas
        const unpaidPastWeeks = availableWeeksData.filter(w => 
            w.offset < 0 && w.available === true
        );
        
        const panel = document.getElementById('unpaidWeeksPanel');
        const countEl = document.getElementById('unpaidWeeksCount');
        
        if (unpaidPastWeeks.length > 0) {
            panel.style.display = 'block';
            countEl.textContent = unpaidPastWeeks.length;
        } else {
            panel.style.display = 'none';
        }
    } catch (error) {
        console.error('Erro ao carregar semanas não pagas:', error);
    }
}

// ===== AVISO: FARM DA SEMANA ANTERIOR NÃO PAGO =====
// Semanas passadas ainda em aberto (offset < 0 e ainda disponíveis para pagar)
function getUnpaidPreviousWeeks() {
    if (!Array.isArray(availableWeeksData)) return [];
    return availableWeeksData
        .filter(w => w.offset < 0 && w.available === true)
        .sort((a, b) => b.offset - a.offset); // mais recente primeiro
}

// Antes de lançar farm na semana ATUAL, avisa se há semana anterior não paga.
function withUnpaidWeekWarning(weekOffset, proceedFn) {
    if (parseInt(weekOffset) !== 0) return proceedFn();
    const unpaid = getUnpaidPreviousWeeks();
    if (unpaid.length === 0) return proceedFn();
    showUnpaidPreviousWeekPrompt(unpaid, proceedFn);
}

function closeUnpaidWeekPrompt() {
    const el = document.getElementById('unpaidWeekPromptOverlay');
    if (el) el.remove();
}

function showUnpaidPreviousWeekPrompt(unpaidWeeks, onContinueCurrent) {
    closeUnpaidWeekPrompt();
    const week = unpaidWeeks[0];
    const extra = unpaidWeeks.length > 1
        ? `<p style="margin-top:8px;color:#e67e22;font-size:13px;">⚠️ Você tem ${unpaidWeeks.length} semanas anteriores em aberto. A mais recente está indicada acima.</p>`
        : '';
    const overlay = document.createElement('div');
    overlay.id = 'unpaidWeekPromptOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);display:flex;align-items:center;justify-content:center;z-index:10000;padding:16px;';
    overlay.innerHTML = `
        <div style="background:var(--card-bg,#1e1e2e);color:var(--text-primary,#fff);max-width:440px;width:100%;border-radius:14px;padding:24px;border:1px solid var(--border-color,rgba(255,255,255,0.12));box-shadow:0 10px 40px rgba(0,0,0,0.5);">
            <h3 style="margin:0 0 12px;font-size:19px;">⚠️ Farm da semana anterior não pago</h3>
            <p style="margin:0 0 6px;line-height:1.5;">Você ainda não pagou o farm da semana anterior:</p>
            <p style="margin:0;font-weight:700;font-size:15px;">📅 ${escapeHtml(week.label)}</p>
            ${extra}
            <p style="margin:14px 0 0;line-height:1.5;">Onde você quer registrar este farm?</p>
            <div style="display:flex;flex-direction:column;gap:10px;margin-top:18px;">
                <button id="unpaidBtnPrevious" style="background:#9b59b6;color:#fff;border:none;padding:12px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">📅 Registrar na semana anterior</button>
                <button id="unpaidBtnCurrent" style="background:#27ae60;color:#fff;border:none;padding:12px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">✅ Continuar na semana atual mesmo</button>
                <button id="unpaidBtnCancel" style="background:transparent;color:var(--text-secondary,#aaa);border:1px solid var(--border-color,rgba(255,255,255,0.15));padding:10px;border-radius:8px;font-size:14px;cursor:pointer;">Cancelar</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeUnpaidWeekPrompt(); });
    document.getElementById('unpaidBtnPrevious').onclick = () => {
        closeUnpaidWeekPrompt();
        openPayPastWeekModal(week.start, week.end, week.label);
    };
    document.getElementById('unpaidBtnCurrent').onclick = () => {
        closeUnpaidWeekPrompt();
        onContinueCurrent();
    };
    document.getElementById('unpaidBtnCancel').onclick = () => closeUnpaidWeekPrompt();
}

// Abrir modal para pagar semana passada
async function openPayPastWeekModal(weekStart, weekEnd, weekLabel) {
    selectedPastWeek = { start: weekStart, end: weekEnd, label: weekLabel };
    pastScreenshotFiles = [];
    
    document.getElementById('pastWeekLabel').textContent = `Semana: ${weekLabel}`;
    document.getElementById('pastWeekStart').value = weekStart;
    document.getElementById('pastWeekEnd').value = weekEnd;
    document.getElementById('pastWeekMessage').innerHTML = '';
    document.getElementById('pastScreenshotsPreview').innerHTML = '';
    
    // Carregar opções de pagamento
    const paymentSelect = document.getElementById('pastPaymentType');
    paymentSelect.innerHTML = '<option value="material">📦 Materiais</option>';
    
    // Adicionar tipos de pagamento alternativos
    if (paymentTypes && paymentTypes.length > 0) {
        paymentTypes.forEach(pt => {
            paymentSelect.innerHTML += `<option value="payment_${pt.id}">${pt.icon} ${escapeHtml(pt.name)}</option>`;
        });
    }
    
    // Carregar materiais
    const materialsList = document.getElementById('pastMaterialsList');
    try {
        const response = await fetch('/api/delivery/materials');
        const data = await response.json();
        
        if (data.materials && data.materials.length > 0) {
            materialsList.innerHTML = data.materials.map(mat => `
                <div class="material-input-row">
                    <span class="material-icon">${mat.icon}</span>
                    <span class="material-name">${mat.name}</span>
                    <input type="number" 
                           class="past-material-input" 
                           data-material-id="${mat.id}"
                           data-goal="${mat.weekly_goal || 700}"
                           min="0" 
                           max="${mat.weekly_goal || 700}"
                           value="${mat.weekly_goal || 700}"
                           placeholder="0">
                    <span class="material-goal">/ ${mat.weekly_goal || 700}</span>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Erro ao carregar materiais:', error);
    }
    
    togglePastPaymentType();
    document.getElementById('payPastWeekModal').classList.add('show');
}

// Fechar modal
function closePayPastWeekModal() {
    document.getElementById('payPastWeekModal').classList.remove('show');
    selectedPastWeek = null;
    pastScreenshotFiles = [];
}

// Alternar tipo de pagamento
function togglePastPaymentType() {
    const type = document.getElementById('pastPaymentType').value;
    const materialsSection = document.getElementById('pastMaterialsSection');
    const moneySection = document.getElementById('pastMoneySection');
    
    if (type === 'material') {
        materialsSection.style.display = 'block';
        moneySection.style.display = 'none';
    } else {
        materialsSection.style.display = 'none';
        moneySection.style.display = 'block';
        
        // Atualizar meta do tipo de pagamento
        const typeId = parseInt(type.replace('payment_', ''));
        const paymentType = paymentTypes.find(pt => pt.id === typeId);
        if (paymentType) {
            document.getElementById('pastMoneyAmount').max = paymentType.weekly_goal;
            document.getElementById('pastMoneyAmount').placeholder = `Máx: ${formatPaymentGoal(paymentType, paymentType.weekly_goal)}`;
        }
    }
}

// Adicionar screenshot
function addPastScreenshot() {
    document.getElementById('pastScreenshotInput').click();
}

// Processar screenshot selecionado
function handlePastScreenshot(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    pastScreenshotFiles.push(file);
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const preview = document.getElementById('pastScreenshotsPreview');
        const index = pastScreenshotFiles.length - 1;
        preview.innerHTML += `
            <div class="screenshot-preview" data-index="${index}">
                <img src="${e.target.result}" onclick="openModal('${e.target.result}')">
                <button type="button" class="btn-remove-screenshot" onclick="removePastScreenshot(${index})">×</button>
            </div>
        `;
    };
    reader.readAsDataURL(file);
    
    event.target.value = '';
}

// Remover screenshot
function removePastScreenshot(index) {
    pastScreenshotFiles.splice(index, 1);
    
    // Recriar preview
    const preview = document.getElementById('pastScreenshotsPreview');
    preview.innerHTML = '';
    pastScreenshotFiles.forEach((file, i) => {
        const reader = new FileReader();
        reader.onload = function(e) {
            preview.innerHTML += `
                <div class="screenshot-preview" data-index="${i}">
                    <img src="${e.target.result}" onclick="openModal('${e.target.result}')">
                    <button type="button" class="btn-remove-screenshot" onclick="removePastScreenshot(${i})">×</button>
                </div>
            `;
        };
        reader.readAsDataURL(file);
    });
}

// Submeter pagamento de semana passada
document.getElementById('payPastWeekForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const messageEl = document.getElementById('pastWeekMessage');
    const paymentType = document.getElementById('pastPaymentType').value;
    
    // Validar screenshots
    if (pastScreenshotFiles.length === 0) {
        messageEl.innerHTML = '<span class="error">❌ Adicione pelo menos um print de comprovação!</span>';
        return;
    }
    
    const formData = new FormData();
    formData.append('week_start', selectedPastWeek.start);
    formData.append('week_end', selectedPastWeek.end);
    
    if (paymentType === 'material') {
        // Coletar materiais
        const materials = [];
        document.querySelectorAll('.past-material-input').forEach(input => {
            const amount = parseInt(input.value) || 0;
            if (amount > 0) {
                materials.push({
                    material_id: input.dataset.materialId,
                    amount: amount
                });
            }
        });
        
        if (materials.length === 0) {
            messageEl.innerHTML = '<span class="error">❌ Informe pelo menos um material!</span>';
            return;
        }
        
        formData.append('payment_type', 'material');
        formData.append('materials', JSON.stringify(materials));
    } else {
        // Pagamento com dinheiro
        const typeId = parseInt(paymentType.replace('payment_', ''));
        const amount = parseInt(document.getElementById('pastMoneyAmount').value) || 0;
        
        if (amount <= 0) {
            messageEl.innerHTML = '<span class="error">❌ Informe o valor!</span>';
            return;
        }
        
        formData.append('payment_type', 'dirty_money');
        formData.append('payment_type_id', typeId);
        formData.append('dirty_money_amount', amount);
    }
    
    // Adicionar screenshots
    pastScreenshotFiles.forEach(file => {
        formData.append('screenshots', file);
    });
    
    try {
        messageEl.innerHTML = '<span class="loading">Enviando...</span>';
        
        const response = await fetch('/api/delivery/pay-past-week', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (response.ok) {
            messageEl.innerHTML = '<span class="success">✅ ' + data.message + '</span>';
            setTimeout(() => {
                closePayPastWeekModal();
                loadStats();
                loadMyDeliveries();
            }, 2000);
        } else {
            messageEl.innerHTML = '<span class="error">❌ ' + data.error + '</span>';
        }
    } catch (error) {
        messageEl.innerHTML = '<span class="error">❌ Erro ao enviar pagamento</span>';
    }
});

// ===== MODAL DE TROCA DE SENHA =====

// Mostrar modal de troca de senha
function showChangePassword() {
    document.getElementById('changePasswordForm').reset();
    document.getElementById('changePasswordMessage').innerHTML = '';
    document.getElementById('changePasswordModal').classList.add('show');
}

// Fechar modal de troca de senha
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
        messageEl.innerHTML = '<span class="error">A nova senha deve ter pelo menos 6 caracteres</span>';
        return;
    }
    
    if (newPassword !== confirmNewPassword) {
        messageEl.innerHTML = '<span class="error">As senhas não coincidem</span>';
        return;
    }
    
    try {
        messageEl.innerHTML = '<span class="loading">Alterando senha...</span>';
        
        const response = await fetch('/api/auth/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword, newPassword })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            messageEl.innerHTML = '<span class="success">✅ ' + data.message + '</span>';
            document.getElementById('changePasswordForm').reset();
            setTimeout(() => {
                closeChangePasswordModal();
            }, 2000);
        } else {
            messageEl.innerHTML = '<span class="error">❌ ' + data.error + '</span>';
        }
    } catch (error) {
        messageEl.innerHTML = '<span class="error">❌ Erro ao trocar senha</span>';
    }
});

// Fechar modal ao clicar fora
document.addEventListener('click', function(e) {
    const modal = document.getElementById('warningsModal');
    if (e.target === modal) {
        closeWarningsModal();
    }
    
    const changePasswordModal = document.getElementById('changePasswordModal');
    if (e.target === changePasswordModal) {
        closeChangePasswordModal();
    }
    
    const editProfileModal = document.getElementById('editProfileModal');
    if (e.target === editProfileModal) {
        closeEditProfileModal();
    }
    
    const payPastWeekModal = document.getElementById('payPastWeekModal');
    if (e.target === payPastWeekModal) {
        closePayPastWeekModal();
    }
});

// ========== EDITAR PERFIL ==========

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
        messageEl.innerHTML = '<span class="error">O nome é obrigatório</span>';
        return;
    }
    
    try {
        messageEl.innerHTML = '<span class="loading">Salvando alterações...</span>';
        
        const response = await fetch('/api/auth/update-profile', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            messageEl.innerHTML = '<span class="success">✅ ' + data.message + '</span>';
            
            // Atualizar dados locais
            currentUser.name = name;
            currentUser.email = email;
            document.getElementById('userName').textContent = name;
            document.getElementById('dropdownUserName').textContent = name;
            
            setTimeout(() => {
                closeEditProfileModal();
            }, 2000);
        } else {
            messageEl.innerHTML = '<span class="error">❌ ' + data.error + '</span>';
        }
    } catch (error) {
        messageEl.innerHTML = '<span class="error">❌ Erro ao salvar alterações</span>';
    }
});

// Inicializa
(async function() {
    await loadRoleNames(); // Carregar nomes dos grupos do banco primeiro
    checkAuth();
})();

// ==================== FARM EXTRA PARA RANKING ====================

// Carregar inputs de materiais para farm extra
async function loadExtraMaterialsInputs() {
    const container = document.getElementById('extraMaterialsInputs');
    if (!container) return;
    
    try {
        const response = await fetch('/api/delivery/materials');
        const data = await response.json();
        
        if (data.materials && data.materials.length > 0) {
            container.innerHTML = data.materials.map(material => `
                <div class="material-input-card">
                    <div class="material-header">
                        <span class="material-icon">${material.icon || '📦'}</span>
                        <span class="material-name">${material.name}</span>
                    </div>
                    <div class="material-input-wrapper">
                        <input type="number" 
                               class="material-amount-input extra-material-input" 
                               data-material-id="${material.id}"
                               min="0" 
                               value="0"
                               placeholder="0"
                               onkeypress="return event.charCode >= 48 && event.charCode <= 57">
                    </div>
                    <div class="extra-materials-label">Quantidade extra</div>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Erro ao carregar materiais:', error);
    }
}

// Adicionar screenshot para farm extra
function addExtraScreenshot() {
    document.getElementById('extraScreenshotInput').click();
}

// Processar screenshot selecionado para farm extra
function handleExtraScreenshotSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    // Adicionar à lista
    extraScreenshotFiles.push(file);
    
    // Mostrar preview
    const reader = new FileReader();
    reader.onload = function(e) {
        const preview = document.getElementById('extraScreenshotsPreview');
        const idx = extraScreenshotFiles.length - 1;
        const div = document.createElement('div');
        div.className = 'screenshot-preview';
        div.innerHTML = `
            <img src="${e.target.result}" alt="Screenshot">
            <button type="button" class="remove-screenshot" onclick="removeExtraScreenshot(${idx})">×</button>
        `;
        preview.appendChild(div);
    };
    reader.readAsDataURL(file);
    
    // Limpar input
    event.target.value = '';
}

// Remover screenshot do farm extra
function removeExtraScreenshot(index) {
    extraScreenshotFiles.splice(index, 1);
    
    // Re-render previews
    const preview = document.getElementById('extraScreenshotsPreview');
    preview.innerHTML = '';
    extraScreenshotFiles.forEach((file, idx) => {
        const reader = new FileReader();
        reader.onload = function(e) {
            const div = document.createElement('div');
            div.className = 'screenshot-preview';
            div.innerHTML = `
                <img src="${e.target.result}" alt="Screenshot">
                <button type="button" class="remove-screenshot" onclick="removeExtraScreenshot(${idx})">×</button>
            `;
            preview.appendChild(div);
        };
        reader.readAsDataURL(file);
    });
}

// Submeter farm extra para ranking
document.addEventListener('DOMContentLoaded', function() {
    const extraForm = document.getElementById('extraFarmForm');
    if (extraForm) {
        extraForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const messageEl = document.getElementById('extraFormMessage');
            const submitBtn = document.getElementById('submitExtraFarmBtn');
            
            // Coletar materiais
            const inputs = document.querySelectorAll('.extra-material-input');
            const materials = [];
            
            inputs.forEach(input => {
                const amount = parseInt(input.value) || 0;
                if (amount > 0) {
                    materials.push({
                        material_id: input.dataset.materialId,
                        amount: amount
                    });
                }
            });
            
            if (materials.length === 0) {
                messageEl.textContent = '❌ Informe a quantidade de pelo menos um material!';
                messageEl.className = 'form-message show error';
                setTimeout(() => { messageEl.className = 'form-message'; }, 5000);
                return;
            }
            
            // Verificar se tem screenshot
            if (extraScreenshotFiles.length === 0) {
                messageEl.textContent = '❌ Anexe pelo menos 1 print do farm extra!';
                messageEl.className = 'form-message show error';
                setTimeout(() => { messageEl.className = 'form-message'; }, 5000);
                return;
            }
            
            // Montar sumário dos materiais para confirmação
            const materialsSummary = materials.map(mat => {
                const matInfo = materialsData.find(m => m.id == mat.material_id);
                const name = matInfo ? matInfo.name : `Material ${mat.material_id}`;
                const icon = matInfo ? matInfo.icon : '📦';
                return { name, icon, amount: mat.amount };
            });
            
            const totalMaterials = materials.reduce((sum, m) => sum + m.amount, 0);
            
            // Mostrar modal de confirmação
            showDeliveryConfirmationModal({
                type: 'extra',
                weekLabel: currentWeekData?.week?.label || 'Semana Atual',
                materials: materialsSummary,
                totalMaterials: totalMaterials,
                screenshotsCount: extraScreenshotFiles.length,
                isFutureWeek: false,
                onConfirm: () => submitExtraFarm(materials, messageEl, submitBtn, inputs)
            });
        });
    }
});

// Função para submeter farm extra após confirmação
async function submitExtraFarm(materials, messageEl, submitBtn, inputs) {
    closeDeliveryConfirmationModal();
    
    // Preparar FormData
    const formData = new FormData();
    formData.append('materials', JSON.stringify(materials));
    formData.append('description', '[FARM EXTRA RANKING]');
    formData.append('payment_type', 'material');
    
    extraScreenshotFiles.forEach(file => {
        formData.append('screenshots', file);
    });
    
    // Desabilitar botão
    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ Enviando...';
    messageEl.textContent = '';
    
    try {
        const response = await fetch('/api/delivery', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (response.ok) {
            messageEl.textContent = '🏆 Farm extra registrado com sucesso!';
            messageEl.className = 'form-message show success';
            
            // Limpar formulário
            inputs.forEach(input => input.value = 0);
            extraScreenshotFiles = [];
            document.getElementById('extraScreenshotsPreview').innerHTML = '';
            
            // Recarregar dados
            setTimeout(() => {
                loadWeekData(currentWeekOffset);
            }, 1500);
        } else {
            messageEl.textContent = '❌ ' + (data.error || 'Erro ao registrar farm extra');
            messageEl.className = 'form-message show error';
        }
    } catch (error) {
        console.error('Erro ao enviar farm extra:', error);
        messageEl.textContent = '❌ Erro de conexão. Tente novamente.';
        messageEl.className = 'form-message show error';
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '🏆 Adicionar ao Ranking';
        setTimeout(() => { messageEl.className = 'form-message'; }, 5000);
    }
}
