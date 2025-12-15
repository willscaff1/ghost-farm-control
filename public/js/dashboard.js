let currentUser = null;
let currentWeekData = null;
let currentWeekOffset = 0;
let weeklyGoal = 700;
let materialsGoals = {};
let availableWeeksData = [];
let notifications = [];
let currentPaymentType = 'material'; // 'material' ou tipo de pagamento ID
let currentPaymentTypeId = null; // ID do tipo de pagamento selecionado
let paymentTypes = []; // Lista de tipos de pagamento carregados do banco
let screenshotFilesDirty = []; // Screenshots para pagamento alternativo
let pastScreenshotFiles = []; // Screenshots para pagamento de semana passada
let selectedPastWeek = null; // Semana passada selecionada para pagar
const adminRoles = ['01', '02', 'gerente_farm', 'gerente_acao', 'gerente_recrutamento', 'gerente_encomendas', 'gerente_geral'];

const roleNames = {
    'member': 'Membro',
    '01': '01',
    '02': '02',
    'gerente_farm': 'Gerente de Farm',
    'gerente_geral': 'Gerente Geral'
};

// Verifica autenticação
async function checkAuth() {
    try {
        const response = await fetch('/api/auth/me');
        const data = await response.json();
        
        if (data.user) {
            currentUser = data.user;
            document.getElementById('userName').textContent = currentUser.name;
            
            // Dropdown info
            document.getElementById('dropdownUserName').textContent = currentUser.name;
            document.getElementById('dropdownUserRole').textContent = roleNames[currentUser.role] || currentUser.role;
            
            // Mostrar link de admin se for admin
            if (adminRoles.includes(currentUser.role)) {
                document.getElementById('dropdownAdminBtn').style.display = 'flex';
            }
            
            loadAvailableWeeks();
            loadMaterials();
            loadFarmSettings(); // Carregar configurações do farm primeiro
            loadStats();
            loadMyDeliveries();
            checkNotifications(); // Verificar notificações
            loadUnpaidWeeks(); // Carregar semanas não pagas
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
    farm_payment_enabled: 'true',
    farm_payment_mode: 'either'
};

// Carregar configurações do farm
async function loadFarmSettings() {
    try {
        const response = await fetch('/api/delivery/farm-settings');
        const data = await response.json();
        farmSettings = data.settings || farmSettings;
        
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
    
    const materialsEnabled = farmSettings.farm_materials_enabled === 'true';
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

// Verificar e gerar notificações
async function checkNotifications() {
    notifications = [];
    
    try {
        // Buscar status da semana atual
        const response = await fetch('/api/delivery/current-week?offset=0');
        const data = await response.json();
        
        const today = new Date();
        const dayOfWeek = today.getDay(); // 0=Dom, 1=Seg, ..., 6=Sab
        
        // Verificar se é uma nova semana (Segunda-feira)
        const lastWeekCheck = localStorage.getItem('lastWeekCheck');
        const currentWeekStart = data.week.start;
        
        if (lastWeekCheck !== currentWeekStart) {
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
        
        // Se farm foi aprovado recentemente (verificar localStorage)
        const lastApprovedCheck = localStorage.getItem('lastApprovedDelivery');
        if (data.hasDelivery && data.deliveryStatus === 'approved' && !data.isPartial) {
            if (lastApprovedCheck !== currentWeekStart + '_approved') {
                notifications.push({
                    id: 'farm_approved',
                    type: 'success',
                    icon: '✅',
                    title: 'Farm Aprovado!',
                    message: 'Seu farm desta semana foi aprovado. Parabéns!',
                    time: 'Recente'
                });
                localStorage.setItem('lastApprovedDelivery', currentWeekStart + '_approved');
            }
        }
        
        updateNotificationBadge();
        
    } catch (error) {
        console.error('Erro ao verificar notificações:', error);
    }
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
        
    } catch (error) {
        console.error('Erro ao carregar semanas:', error);
    }
}

// Mudar semana (botões de navegação)
function changeWeek(direction) {
    const newOffset = currentWeekOffset + direction;
    
    // Verificar se existe a semana
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
    
    // Verificar se existem semanas anteriores/próximas
    const minOffset = Math.min(...availableWeeksData.map(w => w.offset));
    const maxOffset = Math.max(...availableWeeksData.map(w => w.offset));
    
    prevBtn.disabled = currentWeekOffset <= minOffset;
    nextBtn.disabled = currentWeekOffset >= maxOffset;
}

// Carregar dados de uma semana específica
async function loadWeekData(offset = 0) {
    try {
        currentWeekOffset = offset;
        
        // Atualizar hidden input do form
        const weekSelect = document.getElementById('weekSelect');
        if (weekSelect) weekSelect.value = offset;
        
        const response = await fetch(`/api/delivery/current-week?offset=${offset}`);
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
        
        // Atualizar barras de progresso
        updateProgressBars(data.progress);
        
        // Mostrar screenshots existentes
        updateExistingScreenshots(data.existingScreenshots);
        
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
        // Mostrar quando: pode entregar E não justificou ainda E não está aprovado
        const absenceCard = document.getElementById('absenceCard');
        if (absenceCard) {
            const showJustify = data.canDeliver && !data.hasJustification && data.deliveryStatus !== 'approved';
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
        
        if (deliveryPanel) {
            if (data.canDeliver) {
                // Pode entregar - mostrar formulário
                deliveryPanel.style.display = 'block';
                deliveryPanel.style.opacity = '1';
                deliveryPanel.style.pointerEvents = 'auto';
                if (lockedMessage) lockedMessage.style.display = 'none';
                
                // Atualizar título do form
                const formTitle = document.getElementById('formTitle');
                if (formTitle) {
                    if (data.deliveryStatus === 'pending' && !data.isPartial) {
                        formTitle.textContent = '✏️ Editar Farm (Aguardando Aprovação)';
                    } else if (data.isPartial) {
                        formTitle.textContent = '📦 Adicionar ao Farm';
                    } else {
                        formTitle.textContent = '📦 Registrar Farm';
                    }
                }
            } else {
                // Não pode entregar - esconder formulário e mostrar mensagem
                deliveryPanel.style.display = 'none';
                
                // Mostrar mensagem de bloqueio
                if (lockedMessage) {
                    lockedMessage.style.display = 'block';
                    
                    let lockIcon = '🔒';
                    let lockTitle = 'Entregas Bloqueadas';
                    let lockText = data.statusMessage || 'Não é possível fazer entregas nesta semana.';
                    
                    if (data.deliveryStatus === 'approved') {
                        lockIcon = '✅';
                        lockTitle = 'Farm Aprovado!';
                        lockText = 'Parabéns! Seu farm desta semana já foi aprovado. Aguarde a próxima semana.';
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
        
    } catch (error) {
        console.error('Erro ao carregar semana:', error);
    }
}

// Atualizar screenshots existentes
function updateExistingScreenshots(screenshots) {
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
                <div class="screenshot-preview existing">
                    <img src="${s.screenshot_url}" alt="Print ${idx + 1}" onclick="openModal('${s.screenshot_url}')">
                    <div class="screenshot-badge">${idx + 1}</div>
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
                <div class="screenshot-preview existing">
                    <img src="${s.screenshot_url}" alt="Print ${idx + 1}" onclick="openModal('${s.screenshot_url}')">
                    <div class="screenshot-badge">${idx + 1}</div>
                </div>
            `).join('');
        }
    }
}

// Resetar inputs do formulário para modo adição
function fillFormWithExistingValues(progress) {
    // Sempre zerar inputs - formulário é para ADICIONAR valores
    document.querySelectorAll('.material-amount-input').forEach(input => {
        input.value = 0;
    });
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
        
        if (currentWeekData.paymentTypeId && paymentTypes.length > 0) {
            const pt = paymentTypes.find(p => p.id === currentWeekData.paymentTypeId);
            if (pt) {
                goal = pt.weekly_goal;
                paymentTypeName = pt.name;
                paymentTypeIcon = pt.icon;
            }
        }
        
        const percentage = Math.min(100, Math.round((amount / goal) * 100));
        const complete = amount >= goal;
        
        container.innerHTML = `
            <div class="progress-item ${complete ? 'complete' : ''}">
                <div class="progress-header">
                    <span class="progress-label">${paymentTypeIcon} ${paymentTypeName}</span>
                    <span class="progress-value ${complete ? 'complete' : 'incomplete'}">
                        ${canEdit ? `
                            <span class="value-display editable" onclick="openEditDirtyMoneyModal(${amount}, ${goal}, '${paymentTypeName}', '${paymentTypeIcon}')">
                                R$ ${amount.toLocaleString('pt-BR')} / R$ ${goal.toLocaleString('pt-BR')}
                                <span class="edit-hint">✏️</span>
                            </span>
                        ` : `
                            <span class="value-display">R$ ${amount.toLocaleString('pt-BR')} / R$ ${goal.toLocaleString('pt-BR')}</span>
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

// Modal para editar dinheiro sujo
function openEditDirtyMoneyModal(currentValue, goal, name, icon) {
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
                    Valor atual: <strong>R$ ${currentValue.toLocaleString('pt-BR')}</strong> / R$ ${goal.toLocaleString('pt-BR')}
                </div>
                <div class="edit-value-input-group">
                    <label>Novo valor total (R$):</label>
                    <input type="number" id="editValueInput" value="${currentValue}" min="0" max="${goal}" autofocus>
                    <small style="color: var(--text-secondary)">Máximo: R$ ${goal.toLocaleString('pt-BR')}</small>
                </div>
                <p class="edit-value-hint">⚠️ Use apenas para corrigir erros de digitação</p>
            </div>
            <div class="edit-value-footer">
                <button class="btn-cancel" onclick="closeEditValueModal()">Cancelar</button>
                <button class="btn-save" onclick="saveEditedDirtyMoney(${goal})">💾 Salvar</button>
            </div>
        </div>
    `;
    
    modal.style.display = 'flex';
    document.getElementById('editValueInput').focus();
    document.getElementById('editValueInput').select();
}

async function saveEditedDirtyMoney(goal) {
    const input = document.getElementById('editValueInput');
    const newValue = parseInt(input.value) || 0;
    
    // Validar que não ultrapasse a meta
    if (goal && newValue > goal) {
        alert(`⚠️ Valor excede a meta!\\n\\nMáximo permitido: R$ ${goal.toLocaleString('pt-BR')}\\nVocê informou: R$ ${newValue.toLocaleString('pt-BR')}`);
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

// Carregar materiais disponíveis
async function loadMaterials() {
    try {
        const response = await fetch('/api/delivery/materials');
        const data = await response.json();
        
        // Atualizar meta semanal padrão
        if (data.weeklyGoal) {
            weeklyGoal = data.weeklyGoal;
        }
        
        const container = document.getElementById('materialsInputs');
        container.innerHTML = '';
        
        if (data.materials && data.materials.length > 0) {
            data.materials.forEach(mat => {
                const matGoal = mat.weekly_goal || 700;
                materialsGoals[mat.id] = matGoal;
                
                container.innerHTML += `
                    <div class="material-card">
                        <div class="material-icon">${mat.icon}</div>
                        <div class="material-info">
                            <div class="material-name">${mat.name}</div>
                            <div class="material-goal">Meta: ${matGoal}</div>
                        </div>
                        <input type="number" 
                               name="material_${mat.id}" 
                               data-material-id="${mat.id}"
                               data-goal="${matGoal}"
                               class="material-input material-amount-input" 
                               min="0" 
                               max="${matGoal}"
                               value="0"
                               placeholder="0"
                               onkeypress="return event.charCode >= 48 && event.charCode <= 57"
                               oninput="validateMaterialInput(this, ${matGoal}); updateSubmitButton()">
                    </div>
                `;
            });
            
            // Atualizar botão após carregar materiais
            setTimeout(updateSubmitButton, 100);
        } else {
            container.innerHTML = '<p class="loading-placeholder">Nenhum material disponível no momento.</p>';
        }
    } catch (error) {
        console.error('Erro ao carregar materiais:', error);
    }
}

// Função para validar input de material (não pode passar da meta)
function validateMaterialInput(input, maxGoal) {
    // Remover caracteres não numéricos
    input.value = input.value.replace(/[^0-9]/g, '');
    
    let value = parseInt(input.value) || 0;
    
    // Buscar progresso atual do material
    const materialId = input.dataset.materialId;
    let alreadyDelivered = 0;
    if (currentWeekData && currentWeekData.progress) {
        const progressItem = currentWeekData.progress.find(p => String(p.materialId) === String(materialId));
        if (progressItem) {
            alreadyDelivered = progressItem.current || 0;
        }
    }
    
    // Calcular máximo permitido (meta - já entregue)
    const remaining = maxGoal - alreadyDelivered;
    
    if (value > remaining) {
        input.value = remaining;
    }
    
    if (value < 0) {
        input.value = 0;
    }
}

// Função para validar input de dinheiro sujo
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
    
    // Calcular máximo permitido
    const remaining = goal - alreadyDelivered;
    
    if (value > remaining) {
        input.value = remaining;
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
            // Atualizar label e meta
            const label = document.querySelector('#dirtyMoneyForm .form-label');
            if (label) label.textContent = `${selectedPaymentType.icon} Valor de ${selectedPaymentType.name} (R$)`;
            
            document.getElementById('dirtyMoneyGoal').textContent = selectedPaymentType.weekly_goal.toLocaleString('pt-BR');
        }
    }
    
    // Atualizar seção de progresso
    updateProgressDisplay(type, paymentTypeId);
}

// Atualizar exibição do progresso baseado no tipo de pagamento
function updateProgressDisplay(type, paymentTypeId = null) {
    const progressContainer = document.getElementById('progressBars');
    const panelHeader = document.querySelector('.column-left .panel-header h2');
    
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
            
            // Verificar se pode editar
            const canEdit = currentWeekData && currentWeekData.canEditValues;
            
            // Criar HTML do valor - editável ou não
            let valueHtml;
            if (canEdit && deliveredAmount > 0) {
                valueHtml = `<span class="value-display editable" onclick="openEditDirtyMoneyModal(${deliveredAmount}, ${goal})" title="Clique para editar">
                    R$ ${deliveredAmount.toLocaleString('pt-BR')} / R$ ${goal.toLocaleString('pt-BR')} ✏️
                </span>`;
            } else {
                valueHtml = `<span class="value-display">R$ ${deliveredAmount.toLocaleString('pt-BR')} / R$ ${goal.toLocaleString('pt-BR')}</span>`;
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
        const response = await fetch('/api/delivery/my');
        const data = await response.json();
        
        // Contar farms entregues (aprovados)
        const farmsDelivered = data.deliveries ? data.deliveries.filter(d => d.status === 'approved').length : 0;
        document.getElementById('farmsDelivered').textContent = farmsDelivered;
        
        // Buscar advertências
        const warningsRes = await fetch('/api/delivery/my-warnings');
        const warningsData = await warningsRes.json();
        document.getElementById('warningsCount').textContent = warningsData.count || 0;
    } catch (error) {
        console.error('Erro ao carregar estatísticas:', error);
    }
}

// Carregar minhas entregas
async function loadMyDeliveries() {
    try {
        const response = await fetch('/api/delivery/my');
        const data = await response.json();
        
        const deliveriesList = document.getElementById('deliveriesList');
        
        if (data.deliveries && data.deliveries.length > 0) {
            deliveriesList.innerHTML = data.deliveries.map(delivery => {
                // Montar galeria de screenshots
                let screenshotsHtml = '';
                if (delivery.screenshots && delivery.screenshots.length > 0) {
                    screenshotsHtml = delivery.screenshots.map((s, idx) => `
                        <img src="${s.screenshot_url}" class="delivery-screenshot" onclick="openModal('${s.screenshot_url}')" title="Print ${idx + 1}">
                    `).join('');
                } else if (delivery.screenshot_url) {
                    screenshotsHtml = `<img src="${delivery.screenshot_url}" class="delivery-screenshot" onclick="openModal('${delivery.screenshot_url}')">`;
                }
                
                return `
                <div class="delivery-item ${delivery.is_partial ? 'partial' : ''}">
                    <div class="delivery-info">
                        <h3>📦 Semana ${formatWeek(delivery.week_start, delivery.week_end)}</h3>
                        ${delivery.is_partial ? '<span class="partial-badge">⚠️ Parcialmente Pago</span>' : ''}
                        <div class="materials-list">
                            ${delivery.items.map(item => `
                                <span class="material-tag ${item.amount < weeklyGoal ? 'below-goal' : ''}">${item.material_icon} ${item.material_name}: ${formatNumber(item.amount)}${item.amount < weeklyGoal ? `<small>/${weeklyGoal}</small>` : ''}</span>
                            `).join('')}
                        </div>
                        ${delivery.description ? `<p>📝 ${delivery.description}</p>` : ''}
                        <p>📅 ${formatDate(delivery.created_at)}</p>
                        <span class="status ${delivery.status}">${getStatusText(delivery.status, delivery.is_partial)}</span>
                        ${delivery.approved_by_name ? `<p style="margin-top: 10px;">Por: <strong>${delivery.approved_by_name}</strong></p>` : ''}
                    </div>
                    <div class="delivery-actions screenshots-grid">
                        ${screenshotsHtml}
                    </div>
                </div>
            `}).join('');
        } else {
            deliveriesList.innerHTML = `
                <div class="empty-state">
                    <span>📭</span>
                    <p>Você ainda não registrou nenhuma entrega de farm.</p>
                </div>
            `;
        }
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
                        <p><strong>Motivo:</strong> ${j.reason}</p>
                        <p>📅 Enviado: ${formatDate(j.created_at)}</p>
                        <span class="status ${j.status}">${getAbsenceStatusText(j.status)}</span>
                        ${j.approved_by_name ? `<p style="margin-top: 10px;">Por: <strong>${j.approved_by_name}</strong></p>` : ''}
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
    
    // Se for semana futura, pedir confirmação
    if (weekOffset > 0) {
        const confirmMsg = `⚠️ ATENÇÃO!\n\nVocê está prestes a registrar farm de uma SEMANA FUTURA:\n\n📅 ${currentWeekData.week.label}\n\nTem certeza?`;
        
        if (!confirm(confirmMsg)) {
            return;
        }
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
    
    // VALIDAÇÃO: Verificar se materiais não ultrapassam a meta
    if (currentWeekData && currentWeekData.progress) {
        for (const mat of materials) {
            const progressItem = currentWeekData.progress.find(p => String(p.materialId) === String(mat.material_id));
            if (progressItem) {
                const alreadyDelivered = progressItem.current || 0;
                const goal = progressItem.goal || 700;
                const remaining = goal - alreadyDelivered;
                
                if (mat.amount > remaining) {
                    const excess = mat.amount - remaining;
                    messageEl.textContent = `❌ ${progressItem.name}: Excede a meta em ${excess}! (Falta apenas ${remaining})`;
                    messageEl.className = 'form-message show error';
                    setTimeout(() => { messageEl.className = 'form-message'; }, 5000);
                    return;
                }
            }
        }
    }
    
    // VALIDAÇÃO: Precisa ter screenshot (novo OU já existente de entrega anterior)
    const hasExistingScreenshots = currentWeekData && 
        currentWeekData.existingScreenshots && 
        currentWeekData.existingScreenshots.length > 0;
    const hasNewScreenshots = uploadedScreenshots && uploadedScreenshots.length > 0;
    
    if (!hasExistingScreenshots && !hasNewScreenshots) {
        messageEl.textContent = '❌ Anexe pelo menos 1 print do farm!';
        messageEl.className = 'form-message show error';
        setTimeout(() => { messageEl.className = 'form-message'; }, 5000);
        return;
    }
    
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
});

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
    
    // Validar que não ultrapasse a meta
    const selectedPaymentType = paymentTypes.find(pt => pt.id === currentPaymentTypeId);
    const goal = selectedPaymentType?.weekly_goal || 50000;
    const alreadyDelivered = (currentWeekData && currentWeekData.paymentType === 'dirty_money') 
        ? (currentWeekData.dirtyMoneyAmount || 0) 
        : 0;
    const remaining = goal - alreadyDelivered;
    
    if (amount > remaining) {
        const excess = amount - remaining;
        alert(`⚠️ Valor excede a meta!\n\nMeta: R$ ${goal.toLocaleString('pt-BR')}\nJá entregue: R$ ${alreadyDelivered.toLocaleString('pt-BR')}\nFalta: R$ ${remaining.toLocaleString('pt-BR')}\nVocê informou: R$ ${amount.toLocaleString('pt-BR')}\n\nExcesso de R$ ${excess.toLocaleString('pt-BR')}!`);
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
            in_progress: '⚡ Em Progresso'
        };
        return texts[status] || status;
    }
    const texts = {
        pending: '⏳ Aguardando Aprovação',
        approved: '✅ Farm Completo - Aprovado',
        rejected: '❌ Rejeitado',
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
                        📝 ${warning.reason}
                    </div>
                    <div class="warning-meta">
                        <span>👤 Aplicada por: <strong>${warning.given_by_name}</strong></span>
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

// Carregar semanas não pagas
async function loadUnpaidWeeks() {
    try {
        const response = await fetch('/api/delivery/unpaid-weeks');
        const data = await response.json();
        
        const panel = document.getElementById('unpaidWeeksPanel');
        const list = document.getElementById('unpaidWeeksList');
        
        if (data.unpaidWeeks && data.unpaidWeeks.length > 0) {
            // Filtrar apenas as não pagas (excluir aguardando aprovação)
            const unpaid = data.unpaidWeeks.filter(w => w.status === 'not_paid' || w.status === 'rejected' || w.status === 'partial');
            
            if (unpaid.length > 0) {
                panel.style.display = 'block';
                list.innerHTML = unpaid.map(week => `
                    <div class="unpaid-week-item">
                        <div class="unpaid-week-info">
                            <span class="unpaid-week-date">📅 ${week.label}</span>
                            <span class="unpaid-week-status ${week.status}">${week.statusText}</span>
                        </div>
                        <button class="btn-pay-past" onclick="openPayPastWeekModal('${week.start}', '${week.end}', '${week.label}')">
                            💰 Pagar
                        </button>
                    </div>
                `).join('');
            } else {
                panel.style.display = 'none';
            }
        } else {
            panel.style.display = 'none';
        }
    } catch (error) {
        console.error('Erro ao carregar semanas não pagas:', error);
    }
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
            paymentSelect.innerHTML += `<option value="payment_${pt.id}">${pt.icon} ${pt.name}</option>`;
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
            document.getElementById('pastMoneyAmount').placeholder = `Máx: ${paymentType.weekly_goal.toLocaleString('pt-BR')}`;
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
                loadUnpaidWeeks();
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
    
    const payPastWeekModal = document.getElementById('payPastWeekModal');
    if (e.target === payPastWeekModal) {
        closePayPastWeekModal();
    }
});

// Inicializa
checkAuth();
