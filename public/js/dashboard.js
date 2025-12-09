let currentUser = null;
let currentWeekData = null;
let currentWeekOffset = 0;
let weeklyGoal = 700;
let materialsGoals = {};
let availableWeeksData = [];
let notifications = [];
const adminRoles = ['01', '02', 'gerente_farm', 'gerente_geral'];

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
            loadStats();
            loadMyDeliveries();
            checkNotifications(); // Verificar notificações
        } else {
            window.location.href = '/';
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
        
        // Atualizar visibilidade do card de justificativa
        const absenceCard = document.getElementById('absenceCard');
        if (absenceCard) {
            absenceCard.style.display = (!data.hasDelivery && !data.hasJustification && data.canDeliver) ? 'block' : 'none';
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
                    if (data.isPartial) {
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
    const section = document.getElementById('existingScreenshotsSection');
    const container = document.getElementById('existingScreenshots');
    
    if (!section || !container) return;
    
    if (!screenshots || screenshots.length === 0) {
        section.style.display = 'none';
        container.innerHTML = '';
        return;
    }
    
    // Mostrar seção e preencher com screenshots
    section.style.display = 'block';
    container.innerHTML = screenshots.map((s, idx) => `
        <div class="screenshot-preview existing">
            <img src="${s.screenshot_url}" alt="Print ${idx + 1}" onclick="openModal('${s.screenshot_url}')">
            <div class="screenshot-badge">${idx + 1}</div>
        </div>
    `).join('');
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
    
    container.innerHTML = progress.map(p => `
        <div class="progress-item">
            <div class="progress-header">
                <span class="progress-label">${p.icon} ${p.name}</span>
                <span class="progress-value ${p.complete ? 'complete' : 'incomplete'}">${p.current}/${p.goal}</span>
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
                               max="99999"
                               value="0"
                               placeholder="0"
                               oninput="updateSubmitButton()">
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

// Fechar modal ao clicar fora
document.addEventListener('click', function(e) {
    const modal = document.getElementById('warningsModal');
    if (e.target === modal) {
        closeWarningsModal();
    }
});

// Inicializa
checkAuth();
