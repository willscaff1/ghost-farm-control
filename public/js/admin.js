let currentUser = null;
let currentWeek = null;
let selectedWeekOffset = 0; // 0 = semana atual, +1 = próxima, +2 = próxima+1, etc
let selectedWeek = null;
const adminRoles = ['01', '02', 'gerente_farm', 'gerente_geral'];

const roleNames = {
    'member': 'Membro',
    '01': '01 (Primeiro Líder)',
    '02': '02 (Segundo Líder)',
    'gerente_farm': 'Gerente de Farm',
    'gerente_geral': 'Gerente Geral'
};

// Verifica autenticação e permissão de admin
async function checkAuth() {
    try {
        const response = await fetch('/api/auth/me');
        const data = await response.json();
        
        if (data.user && adminRoles.includes(data.user.role)) {
            currentUser = data.user;
            document.getElementById('userName').textContent = `👤 ${currentUser.name}`;
            document.getElementById('userRole').textContent = roleNames[currentUser.role] || currentUser.role;
            document.getElementById('userRole').className = `role-badge role-${currentUser.role}`;
            
            await loadSelectedWeek();
            loadAll();
        } else {
            window.location.href = '/dashboard';
        }
    } catch (error) {
        window.location.href = '/';
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
            case 'manage-materials':
                loadMaterials();
                break;
            case 'all-deliveries':
                loadAllDeliveries();
                break;
            case 'whitelist':
                loadWhitelist();
                loadMembersForWhitelist();
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

// Carregar status semanal (da semana selecionada)
async function loadWeeklyStatus() {
    try {
        const params = selectedWeek ? `?week_start=${selectedWeek.start}&week_end=${selectedWeek.end}` : '';
        const response = await fetch(`/api/admin/weekly-status${params}`);
        const data = await response.json();
        
        const weekPassed = data.weekPassed;
        
        // Membros completos (farm aprovado) - clicável para ver extrato
        const completedList = document.getElementById('weeklyCompletedList');
        if (data.completed.length === 0) {
            completedList.innerHTML = '<div class="empty-state">😴 Nenhum membro completou o farm nesta semana</div>';
        } else {
            completedList.innerHTML = data.completed.map(member => `
                <div class="weekly-member-card completed clickable" onclick="showDeliveryExtract(${JSON.stringify(member).replace(/"/g, '&quot;')})">
                    <div class="member-info">
                        <span class="member-name">👤 ${member.name}</span>
                        <span class="member-role">${roleNames[member.role] || member.role}</span>
                    </div>
                    <div class="member-status">
                        <span class="status-badge approved">✅ Farm Completo</span>
                        <span class="delivery-date">Entregue em ${new Date(member.delivered_at).toLocaleDateString('pt-BR')}</span>
                    </div>
                    <div class="click-hint">🔍 Clique para ver detalhes</div>
                </div>
            `).join('');
        }
        
        // Membros aguardando aprovação - clicável para aprovar
        const pendingApprovalList = document.getElementById('weeklyPendingApprovalList');
        if (data.pendingApproval.length === 0) {
            pendingApprovalList.innerHTML = '<div class="empty-state">✨ Nenhum farm aguardando aprovação</div>';
        } else {
            pendingApprovalList.innerHTML = data.pendingApproval.map(member => `
                <div class="weekly-member-card pending clickable" onclick="${member.has_justification_pending ? 
                    `showJustificationModal(${JSON.stringify(member).replace(/"/g, '&quot;')})` : 
                    `showApprovalModal(${JSON.stringify(member).replace(/"/g, '&quot;')})`}">
                    <div class="member-info">
                        <span class="member-name">👤 ${member.name}</span>
                        <span class="member-role">${roleNames[member.role] || member.role}</span>
                    </div>
                    <div class="member-status">
                        ${member.has_justification_pending ? 
                            '<span class="status-badge justification-pending">📝 Justificativa Aguardando</span>' :
                            '<span class="status-badge pending">⏳ Farm Aguardando Aprovação</span>'
                        }
                    </div>
                    <div class="click-hint">👆 Clique para ${member.has_justification_pending ? 'avaliar justificativa' : 'aprovar/rejeitar'}</div>
                </div>
            `).join('');
        }
        
        // Membros que não entregaram - ADV só se semana passou
        const notDeliveredList = document.getElementById('weeklyNotDeliveredList');
        if (data.notDelivered.length === 0) {
            notDeliveredList.innerHTML = '<div class="empty-state">🎉 Todos os membros entregaram ou justificaram!</div>';
        } else {
            notDeliveredList.innerHTML = data.notDelivered.map(member => `
                <div class="weekly-member-card missing">
                    <div class="member-info">
                        <span class="member-name">👤 ${member.name}</span>
                        <span class="member-role">${roleNames[member.role] || member.role}</span>
                    </div>
                    <div class="member-status">
                        <span class="status-badge missing">❌ Não Entregou</span>
                    </div>
                    ${weekPassed ? `
                        <div class="member-actions">
                            <button class="btn btn-danger btn-small" onclick="applyWeeklyAdv(${member.id}, '${member.name}', '${selectedWeek ? selectedWeek.start : ''}', '${selectedWeek ? selectedWeek.end : ''}')">
                                ⚠️ Aplicar ADV
                            </button>
                        </div>
                    ` : `
                        <div class="week-not-ended">
                            <span class="hint">⏳ Semana ainda não terminou</span>
                        </div>
                    `}
                </div>
            `).join('');
        }
        
        // Membros justificados - clicável para ver detalhes
        const justifiedList = document.getElementById('weeklyJustifiedList');
        if (data.justified.length === 0) {
            justifiedList.innerHTML = '<div class="empty-state">📝 Nenhuma ausência justificada esta semana</div>';
        } else {
            justifiedList.innerHTML = data.justified.map(member => `
                <div class="weekly-member-card justified clickable" onclick="showJustifiedDetails(${JSON.stringify(member).replace(/"/g, '&quot;')})">
                    <div class="member-info">
                        <span class="member-name">👤 ${member.name}</span>
                        <span class="member-role">${roleNames[member.role] || member.role}</span>
                    </div>
                    <div class="member-status">
                        <span class="status-badge justified-approved">📋 AUSÊNCIA JUSTIFICADA</span>
                    </div>
                    <div class="click-hint">🔍 Clique para ver justificativa</div>
                </div>
            `).join('');
        }
        
        // Contadores
        document.getElementById('completedCount').textContent = data.completed.length;
        document.getElementById('pendingApprovalCount').textContent = data.pendingApproval.length;
        document.getElementById('notDeliveredCount').textContent = data.notDelivered.length;
        document.getElementById('justifiedCount').textContent = data.justified.length;
        
    } catch (error) {
        console.error('Erro ao carregar status semanal:', error);
    }
}

// Modal: Mostrar extrato de farm aprovado
function showDeliveryExtract(member) {
    const itemsHtml = member.items && member.items.length > 0 
        ? member.items.map(item => `
            <div class="extract-item">
                <span class="item-icon">${item.material_icon || '📦'}</span>
                <span class="item-name">${item.material_name}</span>
                <span class="item-amount">${formatNumber(item.amount)}</span>
            </div>
        `).join('')
        : '<p class="no-items">Sem itens registrados</p>';
    
    const screenshotHtml = member.screenshot 
        ? `<img src="/uploads/${member.screenshot}" class="extract-screenshot" onclick="openModal('/uploads/${member.screenshot}')">`
        : '<p class="no-screenshot">Sem screenshot</p>';
    
    showActionModal(`
        <div class="extract-modal">
            <div class="extract-header">
                <h2>📦 Extrato do Farm</h2>
                <span class="extract-member">👤 ${member.name}</span>
            </div>
            <div class="extract-info">
                <p>📅 Entregue em: ${new Date(member.delivered_at).toLocaleDateString('pt-BR')}</p>
                ${member.description ? `<p>📝 ${member.description}</p>` : ''}
            </div>
            <div class="extract-items">
                <h3>📋 Materiais Entregues</h3>
                ${itemsHtml}
            </div>
            <div class="extract-screenshot-container">
                <h3>🖼️ Screenshot</h3>
                ${screenshotHtml}
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="closeActionModal()">Fechar</button>
            </div>
        </div>
    `);
}

// Modal: Aprovar/Rejeitar farm pendente
function showApprovalModal(member) {
    const itemsHtml = member.items && member.items.length > 0 
        ? member.items.map(item => `
            <div class="extract-item">
                <span class="item-icon">${item.material_icon || '📦'}</span>
                <span class="item-name">${item.material_name}</span>
                <span class="item-amount">${formatNumber(item.amount)}</span>
            </div>
        `).join('')
        : '<p class="no-items">Sem itens registrados</p>';
    
    const screenshotHtml = member.screenshot 
        ? `<img src="/uploads/${member.screenshot}" class="extract-screenshot" onclick="openModal('/uploads/${member.screenshot}')">`
        : '<p class="no-screenshot">Sem screenshot</p>';
    
    showActionModal(`
        <div class="approval-modal">
            <div class="extract-header">
                <h2>⏳ Aprovar Farm</h2>
                <span class="extract-member">👤 ${member.name}</span>
            </div>
            <div class="extract-info">
                <p>📅 Enviado em: ${new Date(member.delivered_at).toLocaleDateString('pt-BR')}</p>
                ${member.description ? `<p>📝 ${member.description}</p>` : ''}
            </div>
            <div class="extract-items">
                <h3>📋 Materiais</h3>
                ${itemsHtml}
            </div>
            <div class="extract-screenshot-container">
                <h3>🖼️ Screenshot</h3>
                ${screenshotHtml}
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

// Funções para aprovar/rejeitar do modal
async function approveDeliveryFromModal(deliveryId) {
    try {
        const response = await fetch(`/api/admin/deliveries/${deliveryId}/approve`, { method: 'POST' });
        const data = await response.json();
        
        if (data.success) {
            closeActionModal();
            loadWeeklyStatus();
            loadAdminStats();
            loadPendingDeliveries();
        } else {
            alert(data.error || 'Erro ao aprovar');
        }
    } catch (error) {
        alert('Erro ao aprovar entrega');
    }
}

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
            pendingList.innerHTML = data.deliveries.map(delivery => `
                <div class="delivery-item" id="delivery-${delivery.id}">
                    <div class="delivery-info">
                        <h3>📦 Farm de ${delivery.name}</h3>
                        <p class="week-info">📅 Semana: ${formatWeekDate(delivery.week_start)} - ${formatWeekDate(delivery.week_end)}</p>
                        <div class="materials-list">
                            ${delivery.items.map(item => `
                                <span class="material-tag">${item.material_icon} ${item.material_name}: ${formatNumber(item.amount)}</span>
                            `).join('')}
                        </div>
                        <p>${delivery.description || 'Sem descrição'}</p>
                        <p>📤 Enviado: ${formatDate(delivery.created_at)}</p>
                    </div>
                    <div class="delivery-actions">
                        ${delivery.screenshot ? `<img src="/uploads/${delivery.screenshot}" class="delivery-screenshot" onclick="openModal('/uploads/${delivery.screenshot}')">` : '<span>Sem print</span>'}
                        <div class="action-buttons">
                            <button class="btn btn-success" onclick="approveDelivery(${delivery.id})">✅ Aprovar</button>
                            <button class="btn btn-danger" onclick="rejectDelivery(${delivery.id})">❌ Rejeitar</button>
                        </div>
                    </div>
                </div>
            `).join('');
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
                        <span><strong>${member.name}</strong> <small>(${member.passport})</small></span>
                        ${isSuperAdmin && member.passport !== '6999' ? `
                            <select class="role-select" onchange="changeRole(${member.id}, this.value)">
                                <option value="member" ${member.role === 'member' ? 'selected' : ''}>Membro</option>
                                <option value="01" ${member.role === '01' ? 'selected' : ''}>01</option>
                                <option value="02" ${member.role === '02' ? 'selected' : ''}>02</option>
                                <option value="gerente_farm" ${member.role === 'gerente_farm' ? 'selected' : ''}>Gerente de Farm</option>
                                <option value="gerente_geral" ${member.role === 'gerente_geral' ? 'selected' : ''}>Gerente Geral</option>
                            </select>
                        ` : `
                            <span class="role ${member.role}">${roleNames[member.role] || member.role}${member.passport === '6999' ? ' 👑' : ''}</span>
                        `}
                        <span>📦 Total: ${formatNumber(member.total_materials)}</span>
                    </div>
                    <div class="member-actions">
                        ${isSuperAdmin && member.passport !== '6999' ? `
                            <button class="btn btn-small btn-secondary" onclick="editMember(${member.id}, '${member.name}', '${member.passport}', '${member.email || ''}')">✏️ Editar</button>
                            <button class="btn ${member.active ? 'btn-warning' : 'btn-success'} btn-small" onclick="toggleMember(${member.id})">
                                ${member.active ? '🚫 Desativar' : '✅ Ativar'}
                            </button>
                            <button class="btn btn-danger btn-small" onclick="deleteMember(${member.id}, '${member.name}')">🗑️ Deletar</button>
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

// Editar membro
function editMember(id, name, passport, email) {
    const newName = prompt('Nome:', name);
    if (newName === null) return;
    
    const newPassport = prompt('Passaporte:', passport);
    if (newPassport === null) return;
    
    const newEmail = prompt('Email:', email);
    if (newEmail === null) return;
    
    fetch(`/api/admin/members/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, passport: newPassport, email: newEmail })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            alert(data.message);
            loadMembers();
        } else {
            alert(data.error || 'Erro ao editar membro');
        }
    })
    .catch(() => alert('Erro ao editar membro'));
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

// Carregar membros para ADV
async function loadMembersForAdv() {
    try {
        const response = await fetch('/api/admin/members');
        const data = await response.json();
        
        const container = document.getElementById('membersAdvList');
        
        if (data.members && data.members.length > 0) {
            // Buscar contagem de ADVs para cada membro
            const membersWithAdv = await Promise.all(data.members.map(async (member) => {
                const advResponse = await fetch(`/api/admin/members/${member.id}/warnings/count`);
                const advData = await advResponse.json();
                return { ...member, advCount: advData.count || 0 };
            }));
            
            container.innerHTML = membersWithAdv.map(member => `
                <div class="member-adv-card" onclick="openAdvModal(${member.id}, '${member.name}', ${member.advCount})">
                    <div class="member-adv-info">
                        <span class="member-adv-name">👤 ${member.name}</span>
                        <span class="member-adv-passport">${member.passport}</span>
                        <span class="member-adv-role">${roleNames[member.role] || member.role}</span>
                    </div>
                    <div class="member-adv-count ${member.advCount > 0 ? (member.advCount >= 3 ? 'high' : 'warning') : 'clean'}">
                        <span class="adv-number">${member.advCount}</span>
                        <span class="adv-label">ADV${member.advCount !== 1 ? 's' : ''}</span>
                    </div>
                    <button class="btn btn-danger btn-small member-adv-btn">
                        ⚠️ Aplicar ADV
                    </button>
                </div>
            `).join('');
        } else {
            container.innerHTML = '<div class="empty-state">📋 Nenhum membro cadastrado</div>';
        }
    } catch (error) {
        console.error('Erro ao carregar membros para ADV:', error);
    }
}

// Abrir modal de ADV
async function openAdvModal(memberId, memberName, currentAdvCount) {
    // Buscar histórico de ADVs deste membro
    let advHistory = [];
    try {
        const response = await fetch('/api/admin/warnings');
        const data = await response.json();
        advHistory = data.warnings.filter(w => w.user_id === memberId);
    } catch (e) {
        console.error('Erro ao buscar histórico:', e);
    }
    
    const historyHtml = advHistory.length > 0 
        ? advHistory.map(adv => `
            <div class="adv-history-item">
                <div class="adv-history-reason">📝 ${adv.reason}</div>
                <div class="adv-history-info">
                    <span>Por: ${adv.given_by_name}</span>
                    <span>Em: ${new Date(adv.created_at).toLocaleDateString('pt-BR')}</span>
                </div>
            </div>
        `).join('')
        : '<p class="no-history">Nenhuma ADV registrada</p>';
    
    showActionModal(`
        <div class="adv-modal">
            <div class="extract-header">
                <h2>⚠️ Advertências</h2>
                <span class="extract-member">👤 ${memberName}</span>
            </div>
            
            <div class="adv-current-count ${currentAdvCount > 0 ? (currentAdvCount >= 3 ? 'high' : 'warning') : 'clean'}">
                <span class="big-number">${currentAdvCount}</span>
                <span class="big-label">ADV${currentAdvCount !== 1 ? 's' : ''} no total</span>
            </div>
            
            <div class="adv-form-section">
                <h3>📝 Aplicar Nova ADV</h3>
                <div class="form-group">
                    <label for="advReasonModal">Motivo da Advertência *</label>
                    <input type="text" id="advReasonModal" class="form-control" placeholder="Ex: Não entregou farm da semana">
                </div>
                <button class="btn btn-danger btn-large" onclick="applyAdvFromModal(${memberId}, '${memberName}')">
                    ⚠️ Aplicar Advertência
                </button>
            </div>
            
            <div class="adv-history-section">
                <h3>📋 Histórico de ADVs</h3>
                <div class="adv-history-list">
                    ${historyHtml}
                </div>
            </div>
            
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="closeActionModal()">Fechar</button>
            </div>
        </div>
    `);
}

// Aplicar ADV do modal
async function applyAdvFromModal(memberId, memberName) {
    const reason = document.getElementById('advReasonModal').value.trim();
    
    if (!reason) {
        alert('Digite o motivo da advertência!');
        return;
    }
    
    try {
        const response = await fetch('/api/admin/warnings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: memberId,
                reason: reason
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert(`✅ ADV aplicada para ${memberName}!`);
            closeActionModal();
            loadMembersForAdv();
            loadWeeklyStatus();
        } else {
            alert(data.error || 'Erro ao aplicar advertência');
        }
    } catch (error) {
        alert('Erro ao aplicar advertência');
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
                        <p>${delivery.description || 'Sem descrição'}</p>
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
        rejected: '❌ Rejeitado'
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
        const advCountClass = member.adv_count === 0 ? 'zero' : (member.adv_count >= 3 ? 'high' : '');
        
        return `
            <div class="member-adv-card">
                <div class="member-adv-info">
                    <div class="member-adv-details">
                        <h4>${member.name}</h4>
                        <span class="passport">📋 Passaporte: ${member.passport}</span>
                        <span class="role">👤 ${formatRole(member.role)}</span>
                    </div>
                    <div class="adv-count-badge ${advCountClass}">
                        ${member.adv_count} ADV${member.adv_count !== 1 ? 's' : ''}
                    </div>
                </div>
                <button class="btn-apply-adv" onclick="showAdvModal(${member.id}, '${member.name.replace(/'/g, "\\'")}', ${member.adv_count})">
                    ⚠️ Aplicar ADV
                </button>
            </div>
        `;
    }).join('');
}

// Atualizar estatísticas
function updateMembersAdvStats(members) {
    const totalMembers = members.length;
    const membersWithAdv = members.filter(m => m.adv_count > 0).length;
    const totalAdvs = members.reduce((sum, m) => sum + m.adv_count, 0);
    
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
    
    if (e.target === advModal) {
        closeAdvModal();
    }
    if (e.target === farmDetailsModal) {
        closeFarmDetailsModal();
    }
    if (e.target === memberWarningsModal) {
        closeMemberWarningsModal();
    }
});

// Inicializa
checkAuth();
