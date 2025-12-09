let currentUser = null;
let currentWeekData = null;
let weeklyGoal = 700; // fallback
let materialsGoals = {}; // metas por material
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
            document.getElementById('userName').textContent = `👤 ${currentUser.name} (${roleNames[currentUser.role] || currentUser.role})`;
            
            if (adminRoles.includes(currentUser.role)) {
                document.getElementById('adminBtn').style.display = 'inline-block';
            }
            
            loadCurrentWeek();
            loadMaterials();
            loadAvailableWeeks();
            loadStats();
            loadMyDeliveries();
        } else {
            window.location.href = '/';
        }
    } catch (error) {
        window.location.href = '/';
    }
}

// Carregar semanas disponíveis para entrega
async function loadAvailableWeeks() {
    try {
        const response = await fetch('/api/delivery/available-weeks');
        const data = await response.json();
        
        const weekSelect = document.getElementById('weekSelect');
        weekSelect.innerHTML = '';
        
        if (data.weeks && data.weeks.length > 0) {
            data.weeks.forEach(week => {
                const option = document.createElement('option');
                option.value = week.offset;
                
                if (!week.available && week.reason) {
                    option.textContent = `${week.label} - ${week.reason}`;
                    option.disabled = true;
                } else if (week.isPartial) {
                    // Semana em progresso - pode adicionar mais
                    option.textContent = `${week.label} - ⚡ Em Progresso (adicionar mais)`;
                    option.disabled = false;
                } else if (week.hasJustification) {
                    option.textContent = `${week.label} - 📋 Justificativa enviada`;
                    option.disabled = true;
                } else {
                    option.textContent = week.offset === 0 ? `${week.label} (Semana Atual)` : week.label;
                }
                
                weekSelect.appendChild(option);
            });
            
            // Selecionar a primeira semana disponível
            const firstAvailable = data.weeks.find(w => w.available);
            if (firstAvailable) {
                weekSelect.value = firstAvailable.offset;
            }
        }
    } catch (error) {
        console.error('Erro ao carregar semanas disponíveis:', error);
    }
}

// Carregar informações da semana atual
async function loadCurrentWeek() {
    try {
        const response = await fetch('/api/delivery/current-week');
        const data = await response.json();
        currentWeekData = data;
        
        document.getElementById('weekLabel').textContent = data.week.label;
        
        const weekStatus = document.getElementById('weekStatus');
        
        if (data.hasDelivery) {
            if (data.isPartial && data.canDeliver) {
                // Farm EM PROGRESSO - pode continuar adicionando
                weekStatus.innerHTML = `
                    <span class="week-status-badge in-progress">⚡ FARM EM PROGRESSO</span>
                    <p class="progress-hint">Continue adicionando até completar 700 de cada!</p>
                `;
                
                // Mostrar barras de progresso
                if (data.progress) {
                    const progressHtml = data.progress.map(p => `
                        <div class="material-progress-item">
                            <div class="material-progress-header">
                                <span>${p.icon} ${p.name}</span>
                                <span class="${p.complete ? 'complete' : 'incomplete'}">${p.current}/${p.goal}</span>
                            </div>
                            <div class="progress-bar">
                                <div class="progress-fill ${p.complete ? 'complete' : ''}" style="width: ${p.percentage}%"></div>
                            </div>
                        </div>
                    `).join('');
                    
                    weekStatus.innerHTML += `<div class="week-progress-container">${progressHtml}</div>`;
                }
            } else if (data.deliveryStatus === 'approved' && !data.isPartial) {
                // Farm COMPLETO aprovado
                weekStatus.innerHTML = `<span class="week-status-badge approved">✅ FARM COMPLETO</span>`;
            } else if (data.deliveryStatus === 'pending' && !data.isPartial) {
                // Farm completo aguardando aprovação
                weekStatus.innerHTML = `<span class="week-status-badge pending">⏳ Farm Aguardando Aprovação</span>`;
            } else if (data.deliveryStatus === 'rejected') {
                weekStatus.innerHTML = `<span class="week-status-badge rejected">❌ Farm Rejeitado</span>`;
            } else {
                weekStatus.innerHTML = `<span class="week-status-badge pending">⏳ Processando...</span>`;
            }
        } else if (data.hasJustification) {
            // Já tem justificativa na semana atual
            const statusClass = data.justificationStatus === 'approved' ? 'justified-approved' : 
                               data.justificationStatus === 'rejected' ? 'rejected' : 'justification-pending';
            const statusText = data.justificationStatus === 'approved' ? '📋 AUSÊNCIA JUSTIFICADA' : 
                              data.justificationStatus === 'rejected' ? '❌ Justificativa Rejeitada - Entregue o Farm!' : '⏳ Justificativa Aguardando Aprovação';
            
            weekStatus.innerHTML = `<span class="week-status-badge ${statusClass}">${statusText}</span>`;
        } else {
            // Pode registrar farm ou justificar
            weekStatus.innerHTML = `<span class="week-status-badge missing">⚠️ Farm Pendente</span>`;
        }
        
        // Formulário de entrega visível se pode entregar
        // Formulário de justificativa só aparece se não tem nada ainda
        const deliveryCard = document.getElementById('deliveryCard');
        const absenceCard = document.getElementById('absenceCard');
        
        // Pode entregar se: não tem nada, ou tem parcial em progresso
        const canShowDeliveryForm = data.canDeliver !== false;
        deliveryCard.style.display = canShowDeliveryForm ? 'block' : 'none';
        absenceCard.style.display = (!data.hasDelivery && !data.hasJustification) ? 'block' : 'none';
        
        // Atualizar título do card de entrega se for adicional
        const deliveryCardTitle = deliveryCard.querySelector('h2');
        if (data.isPartial && data.canDeliver) {
            deliveryCardTitle.textContent = '📦 Adicionar Mais ao Farm';
        } else {
            deliveryCardTitle.textContent = '📦 Registrar Farm da Semana';
        }
        
    } catch (error) {
        console.error('Erro ao carregar semana:', error);
    }
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
        
        // Atualizar texto da meta no título (pegar maior meta ou usar 700)
        const goalEl = document.getElementById('weeklyGoal');
        if (goalEl && data.materials && data.materials.length > 0) {
            const maxGoal = Math.max(...data.materials.map(m => m.weekly_goal || 700));
            goalEl.textContent = maxGoal;
        }
        
        const container = document.getElementById('materialsInputs');
        container.innerHTML = '';
        
        if (data.materials && data.materials.length > 0) {
            data.materials.forEach(mat => {
                const matGoal = mat.weekly_goal || 700;
                materialsGoals[mat.id] = matGoal;
                
                container.innerHTML += `
                    <div class="material-input-row">
                        <span class="material-label">${mat.icon} ${mat.name}</span>
                        <input type="number" 
                               name="material_${mat.id}" 
                               data-material-id="${mat.id}"
                               data-goal="${matGoal}"
                               class="material-amount-input" 
                               min="0" 
                               max="99999"
                               value="0"
                               placeholder="0">
                        <span class="material-goal">/ ${matGoal}</span>
                    </div>
                `;
            });
        } else {
            container.innerHTML = '<p class="info-text">Nenhum material disponível no momento.</p>';
        }
    } catch (error) {
        console.error('Erro ao carregar materiais:', error);
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
                        <p>${delivery.description || 'Sem descrição'}</p>
                        <p>📅 Enviado: ${formatDate(delivery.created_at)}</p>
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
    
    // Verificar semana selecionada
    const weekSelect = document.getElementById('weekSelect');
    const weekOffset = parseInt(weekSelect.value);
    
    if (isNaN(weekOffset) || weekSelect.selectedOptions[0].disabled) {
        alert('Selecione uma semana válida!');
        return;
    }
    
    // Se for semana futura, pedir confirmação
    if (weekOffset > 0) {
        const selectedWeekText = weekSelect.selectedOptions[0].textContent;
        const confirmMsg = `⚠️ ATENÇÃO!\n\nVocê está prestes a pagar o farm de uma SEMANA FUTURA:\n\n📅 ${selectedWeekText}\n\nTem certeza que deseja antecipar este pagamento?\n\n(O farm ainda será enviado para aprovação dos gerentes)`;
        
        if (!confirm(confirmMsg)) {
            return;
        }
    }
    
    // Coletar todos os materiais com quantidade > 0
    const materialInputs = document.querySelectorAll('.material-amount-input');
    const materials = [];
    let isPartial = false;
    let partialDetails = [];

    materialInputs.forEach(input => {
        const amount = parseInt(input.value) || 0;
        if (amount > 0) {
            const matId = input.dataset.materialId;
            const matGoal = parseInt(input.dataset.goal) || 700;
            
            materials.push({
                material_id: matId,
                amount: amount
            });
            
            // Verificar se está abaixo da meta específica deste material
            if (amount < matGoal) {
                isPartial = true;
                const label = input.closest('.material-input-row').querySelector('.material-label').textContent;
                partialDetails.push(`${label}: ${amount}/${matGoal}`);
            }
        }
    });
    
    if (materials.length === 0) {
        alert('Informe a quantidade de pelo menos um material!');
        return;
    }
    
    // Avisar se é entrega parcial
    if (isPartial) {
        const detailsText = partialDetails.length > 0 ? `\n\nMateriais abaixo da meta:\n${partialDetails.join('\n')}` : '';
        const confirmPartial = confirm(`⚠️ ENTREGA PARCIAL${detailsText}\n\nSua entrega será marcada como "Parcialmente Pago".\n\nDeseja continuar?`);
        if (!confirmPartial) {
            return;
        }
    }
    
    // Verificar se tem screenshots
    if (uploadedScreenshots.length === 0) {
        alert('Anexe pelo menos 1 print do farm!');
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
    
    const messageEl = document.getElementById('formMessage');
    
    try {
        const response = await fetch('/api/delivery', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
            messageEl.textContent = data.message;
            messageEl.className = 'message show success' + (data.isPartial ? ' partial' : '');
            
            // Limpa o formulário
            document.getElementById('deliveryForm').reset();
            clearAllScreenshots();
            
            // Reseta os valores dos inputs de materiais
            materialInputs.forEach(input => input.value = '0');
            
            // Recarrega os dados
            loadCurrentWeek();
            loadAvailableWeeks();
            loadStats();
            loadMyDeliveries();
        } else {
            messageEl.textContent = data.error || 'Erro ao enviar entrega';
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

// Submeter justificativa de ausência
document.getElementById('absenceForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const reason = document.getElementById('absenceReason').value;
    const messageEl = document.getElementById('absenceMessage');
    
    try {
        const response = await fetch('/api/delivery/absence', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason })
        });
        
        const data = await response.json();
        
        if (data.success) {
            messageEl.textContent = data.message;
            messageEl.className = 'message show success';
            document.getElementById('absenceForm').reset();
            
            loadCurrentWeek();
            loadMyAbsences();
        } else {
            messageEl.textContent = data.error || 'Erro ao enviar justificativa';
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
    
    updateScreenshotsCount();
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
    
    updateScreenshotsCount();
}

// Limpar todos os screenshots
function clearAllScreenshots() {
    uploadedScreenshots = [];
    document.getElementById('screenshotsPreview').innerHTML = '';
    updateScreenshotsCount();
}

// Atualizar contador
function updateScreenshotsCount() {
    document.getElementById('screenshotsCount').value = uploadedScreenshots.length;
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
    const startDate = new Date(start + 'T00:00:00');
    const endDate = new Date(end + 'T00:00:00');
    return `${startDate.toLocaleDateString('pt-BR')} - ${endDate.toLocaleDateString('pt-BR')}`;
}

function getStatusText(status, isPartial = false) {
    if (isPartial) {
        const texts = {
            pending: '⏳ Parcialmente Pago - Aguardando Aprovação',
            approved: '⚠️ Parcialmente Pago - Aprovado',
            rejected: '❌ Parcialmente Pago - Rejeitado'
        };
        return texts[status] || status;
    }
    const texts = {
        pending: '⏳ Aguardando Aprovação',
        approved: '✅ Farm Completo - Aprovado',
        rejected: '❌ Rejeitado'
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
