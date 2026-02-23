const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { runQuery, getOne, getAll, getCurrentWeek } = require('../database/db');

const router = express.Router();

// Configuração do multer para upload de imagens (admin)
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB por arquivo
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (extname && mimetype) {
            return cb(null, true);
        }
        cb(new Error('Apenas imagens são permitidas'));
    }
}).array('screenshots', 10); // Até 10 imagens

// Cargos administrativos (qualquer um pode aprovar)
const adminRoles = ['super_admin', '01', '02', 'gerente_farm', 'gerente_acao', 'gerente_recrutamento', 'gerente_encomendas', 'gerente_geral'];

// Cargos considerados gerência (para metas específicas)
const managerGroups = new Set([
    'super_admin',
    '01',
    '02',
    'gerente_farm',
    'gerente_acao',
    'gerente_recrutamento',
    'gerente_encomendas',
    'gerente_geral',
    'gerente_de_fabricacao'
]);

const isManagerByGroups = (groups = []) => groups.some(g => managerGroups.has(g));

const getUserGroups = async (userId) => {
    const userGroupsData = await getAll('SELECT group_name FROM user_groups WHERE user_id = ?', [userId]);
    let groups = userGroupsData.map(g => g.group_name);
    if (groups.length === 0) {
        const user = await getOne('SELECT role FROM users WHERE id = ?', [userId]);
        if (user?.role) groups = [user.role];
    }
    return groups;
};

// ===== HELPER: Buscar grupos de todos usuários de uma vez (otimização) =====
async function getUserGroupsMap(userIds = null) {
    let allGroups;
    if (userIds && userIds.length > 0) {
        const placeholders = userIds.map(() => '?').join(',');
        allGroups = await getAll(`SELECT user_id, group_name FROM user_groups WHERE user_id IN (${placeholders})`, userIds);
    } else {
        allGroups = await getAll('SELECT user_id, group_name FROM user_groups');
    }
    
    const map = new Map();
    for (const g of allGroups) {
        if (!map.has(g.user_id)) map.set(g.user_id, []);
        map.get(g.user_id).push(g.group_name);
    }
    return map;
}

// Função auxiliar para buscar todos os grupos do banco
async function getAllRoles() {
    try {
        const roles = await getAll('SELECT role_name, display_name FROM role_permissions WHERE active = 1');
        return roles || [];
    } catch (error) {
        console.error('Erro ao buscar roles:', error);
        // Retornar grupos padrão como fallback
        return [
            { role_name: 'member', display_name: 'Membro' },
            { role_name: '01', display_name: '01' },
            { role_name: '02', display_name: '02' },
            { role_name: 'gerente_farm', display_name: 'Gerente de Farm' },
            { role_name: 'gerente_geral', display_name: 'Gerente Geral' }
        ];
    }
}

// Função auxiliar para buscar mapeamento de nomes de grupos
async function getRoleNames() {
    try {
        const roles = await getAllRoles();
        const mapping = {};
        roles.forEach(role => {
            mapping[role.role_name] = role.display_name;
        });
        return mapping;
    } catch (error) {
        // Fallback com nomes padrão
        return {
            'member': 'Membro',
            '01': '01',
            '02': '02',
            'gerente_farm': 'Gerente de Farm',
            'gerente_acao': 'Gerente de Ação',
            'gerente_recrutamento': 'Gerente de Recrutamento',
            'gerente_encomendas': 'Gerente de Encomendas',
            'gerente_geral': 'Gerente Geral'
        };
    }
}

// Nomes amigáveis dos cargos (fallback estático - será substituído por função dinâmica)
const roleNames = {
    'member': 'Membro',
    '01': '01',
    '02': '02',
    'gerente_farm': 'Gerente de Farm',
    'gerente_acao': 'Gerente de Ação',
    'gerente_recrutamento': 'Gerente de Recrutamento',
    'gerente_encomendas': 'Gerente de Encomendas',
    'gerente_geral': 'Gerente Geral'
};

const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Não autenticado' });
    }
    next();
};

// Helper para calcular semana com offset (PADRONIZADO)
const getWeekWithOffset = (offset = 0) => {
    // Usar data local sem conversão UTC
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    
    // Adicionar offset de semanas
    const targetDate = new Date(now);
    targetDate.setDate(now.getDate() + (offset * 7));
    
    // Calcular segunda-feira
    const dayOfWeek = targetDate.getDay();
    const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    
    const monday = new Date(targetDate);
    monday.setDate(targetDate.getDate() - daysFromMonday);
    monday.setHours(0, 0, 0, 0);
    
    // Domingo é exatamente 6 dias depois da segunda
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    
    // Formatar SEMPRE como YYYY-MM-DD (ISO 8601)
    const formatDate = (date) => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };
    
    return {
        start: formatDate(monday),
        end: formatDate(sunday),
        label: `${monday.toLocaleDateString('pt-BR')} até ${sunday.toLocaleDateString('pt-BR')}`
    };
};

// Middleware para verificar se é cargo administrativo
const requireAdmin = async (req, res, next) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Não autenticado' });
    }
    
    try {
        // Buscar grupos do usuário
        const userGroups = await getAll(
            'SELECT group_name FROM user_groups WHERE user_id = ?',
            [req.session.user.id]
        );
        
        // Considerar admin qualquer usuário com grupos que não sejam apenas "member"
        const groups = userGroups.map(g => g.group_name);
        const nonMemberGroups = groups.filter(g => g !== 'member');
        const hasAdminGroups = nonMemberGroups.length > 0;
        
        // Verificar se tem role de gerente/admin no nome do grupo
        const hasAdminRole = groups.some(g => 
            g.includes('gerente') || 
            g.includes('admin') || 
            g === '01' || 
            g === '02' || 
            g === 'super_admin'
        );
        
        // Fallback para role antigo se não tiver grupos
        const legacyAccess = groups.length === 0 && adminRoles.includes(req.session.user.role);
        
        const hasAccess = hasAdminGroups || hasAdminRole || legacyAccess;
        
        if (!hasAccess) {
            console.log(`❌ Acesso negado para ${req.session.user.name} - Grupos:`, groups);
            return res.status(403).json({ error: 'Acesso negado' });
        }
        
        next();
    } catch (error) {
        console.error('Erro ao verificar permissões:', error);
        return res.status(500).json({ error: 'Erro ao verificar permissões' });
    }
};

// Middleware para verificar se é super admin (6999)
const requireSuperAdmin = (req, res, next) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Não autenticado' });
    }
    if (req.session.user.passport !== '6999') {
        return res.status(403).json({ error: 'Apenas o super admin pode fazer isso' });
    }
    next();
};

// ENDPOINT TEMPORÁRIO - Limpar todos os dados exceto usuários
router.post('/reset-all-data', requireSuperAdmin, async (req, res) => {
    try {
        console.log('🗑️ Iniciando limpeza de dados...');
        
        // Deletar na ordem correta por causa das foreign keys
        try { await runQuery('DELETE FROM extra_farm_screenshots'); } catch(e) {}
        try { await runQuery('DELETE FROM extra_farm_requests'); } catch(e) {}
        await runQuery('DELETE FROM delivery_screenshots');
        await runQuery('DELETE FROM delivery_items');
        await runQuery('DELETE FROM deliveries');
        await runQuery('DELETE FROM justifications');
        await runQuery('DELETE FROM warnings');
        await runQuery('DELETE FROM farm_whitelist');
        await runQuery('DELETE FROM farm_weeks');
        
        console.log('✅ Todos os dados foram limpos (usuários mantidos)');
        
        res.json({ 
            success: true, 
            message: 'Todos os dados foram limpos. Usuários mantidos.' 
        });
    } catch (error) {
        console.error('❌ Erro ao limpar dados:', error);
        res.status(500).json({ error: error.message });
    }
});

// Obter semana com offset
router.get('/week/:offset', requireAdmin, async (req, res) => {
    try {
        const offset = parseInt(req.params.offset) || 0;
        const week = getWeekWithOffset(offset);
        res.json({ week });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Obter semana atual
router.get('/current-week', requireAdmin, async (req, res) => {
    try {
        const week = getCurrentWeek();
        res.json({ week });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Listar todas as entregas pendentes (da semana selecionada)
router.get('/deliveries/pending', requireAdmin, async (req, res) => {
    try {
        const { week_start, week_end } = req.query;
        
        let query = `
            SELECT d.*, d.payment_type, d.payment_type_id, d.dirty_money_amount, 
                   u.name as user_name, u.passport as user_passport
            FROM deliveries d
            JOIN users u ON d.user_id = u.id
            WHERE d.status = 'pending'
        `;
        const params = [];
        
        if (week_start && week_end) {
            query += ` AND d.week_start = ? AND d.week_end = ?`;
            params.push(week_start, week_end);
        }
        
        query += ` ORDER BY d.week_start DESC, d.created_at ASC`;
        
        const deliveries = await getAll(query, params);
        
        // Para cada entrega, buscar os itens, screenshots e nome do tipo de pagamento
        for (let delivery of deliveries) {
            delivery.items = await getAll(`
                SELECT di.*, m.name as material_name, m.icon as material_icon
                FROM delivery_items di
                JOIN materials m ON di.material_id = m.id
                WHERE di.delivery_id = ?
            `, [delivery.id]);
            
            // Buscar screenshots da tabela delivery_screenshots
            delivery.screenshots = await getAll(`
                SELECT screenshot_url FROM delivery_screenshots WHERE delivery_id = ?
            `, [delivery.id]);
            
            // Buscar nome do tipo de pagamento se existir
            if (delivery.payment_type_id) {
                const paymentType = await getOne(`SELECT name, icon FROM payment_types WHERE id = ?`, [delivery.payment_type_id]);
                if (paymentType) {
                    delivery.payment_type_name = paymentType.name;
                    delivery.payment_type_icon = paymentType.icon;
                }
            }
        }
        
        res.json({ deliveries });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Listar todas as entregas
router.get('/deliveries/all', requireAdmin, async (req, res) => {
    try {
        const { week_start, week_end } = req.query;
        let deliveries;
        
        if (week_start && week_end) {
            deliveries = await getAll(`
                SELECT d.*, u.name as user_name, u.passport as user_passport, a.name as approved_by_name
                FROM deliveries d
                JOIN users u ON d.user_id = u.id
                LEFT JOIN users a ON d.approved_by = a.id
                WHERE d.week_start = ? AND d.week_end = ?
                ORDER BY d.created_at DESC
            `, [week_start, week_end]);
        } else {
            deliveries = await getAll(`
                SELECT d.*, u.name as user_name, u.passport as user_passport, a.name as approved_by_name
                FROM deliveries d
                JOIN users u ON d.user_id = u.id
                LEFT JOIN users a ON d.approved_by = a.id
                ORDER BY d.created_at DESC
            `);
        }
        
        // Para cada entrega, buscar os itens
        for (let delivery of deliveries) {
            delivery.items = await getAll(`
                SELECT di.*, m.name as material_name, m.icon as material_icon
                FROM delivery_items di
                JOIN materials m ON di.material_id = m.id
                WHERE di.delivery_id = ?
            `, [delivery.id]);
        }
        
        res.json({ deliveries });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Buscar todos os farms (extrato completo)
router.get('/deliveries/all-farms', requireAdmin, async (req, res) => {
    try {
        const deliveries = await getAll(`
            SELECT d.*, u.name as user_name, u.passport, a.name as approved_by_name
            FROM deliveries d
            JOIN users u ON d.user_id = u.id AND u.active = 1
            LEFT JOIN users a ON d.approved_by = a.id
            ORDER BY d.created_at DESC
            LIMIT 500
        `);
        
        // Para cada entrega, buscar os itens e screenshots
        for (let delivery of deliveries) {
            delivery.items = await getAll(`
                SELECT di.*, m.name as material_name, m.icon as material_icon
                FROM delivery_items di
                JOIN materials m ON di.material_id = m.id
                WHERE di.delivery_id = ?
            `, [delivery.id]);
            
            delivery.screenshots = await getAll(`
                SELECT screenshot_url FROM delivery_screenshots WHERE delivery_id = ?
            `, [delivery.id]);
        }
        
        res.json({ deliveries });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Aprovar entrega
router.post('/deliveries/:id/approve', requireAdmin, async (req, res) => {
    try {
        const deliveryId = req.params.id;
        const userId = req.session.user.id;
        const { approval_note } = req.body || {};
        
        // Verificar se a entrega existe e está pendente
        const delivery = await getOne('SELECT * FROM deliveries WHERE id = ? AND status = ?', [deliveryId, 'pending']);
        if (!delivery) {
            return res.status(404).json({ error: 'Entrega não encontrada ou já processada' });
        }

        const deliveryUserGroups = await getUserGroups(delivery.user_id);
        const isManager = isManagerByGroups(deliveryUserGroups);
        
        // Verificar se o farm atingiu a meta
        let metaAtingida = true;
        let items = [];

        if (delivery.payment_type === 'dirty_money') {
            let goal = 50000;
            if (delivery.payment_type_id) {
                const paymentType = await getOne('SELECT weekly_goal, manager_weekly_goal FROM payment_types WHERE id = ?', [delivery.payment_type_id]);
                if (paymentType) {
                    goal = isManager ? (paymentType.manager_weekly_goal ?? paymentType.weekly_goal ?? 50000) : (paymentType.weekly_goal ?? 50000);
                }
            }
            const amount = delivery.dirty_money_amount || 0;
            metaAtingida = amount >= goal;
        } else {
            items = await getAll('SELECT di.*, m.weekly_goal, m.manager_weekly_goal FROM delivery_items di JOIN materials m ON di.material_id = m.id WHERE di.delivery_id = ?', [deliveryId]);
            const materials = await getAll('SELECT id, weekly_goal, manager_weekly_goal FROM materials WHERE active = 1');

            for (const mat of materials) {
                const item = items.find(i => i.material_id === mat.id);
                const amount = item ? item.amount : 0;
                const goal = isManager ? (mat.manager_weekly_goal ?? mat.weekly_goal ?? 700) : (mat.weekly_goal ?? 700);
                if (amount < goal) {
                    metaAtingida = false;
                    break;
                }
            }
        }
        
        // Se não atingiu meta: aprovar mas manter is_partial = true (Em Progresso)
        // Se atingiu meta: aprovar e marcar is_partial = false (Completo)
        const newIsPartial = !metaAtingida;
        
        // Criar snapshot dos amounts aprovados (para quando voltar para pending)
        const approvedAmounts = {};
        for (const item of items) {
            approvedAmounts[item.material_id] = item.amount;
        }
        const approvedAmountsJson = JSON.stringify(approvedAmounts);
        
        await runQuery(
            'UPDATE deliveries SET status = ?, is_partial = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP, approved_amounts_json = ?, approval_note = ? WHERE id = ?',
            ['approved', newIsPartial ? 1 : 0, userId, approvedAmountsJson, approval_note || null, deliveryId]
        );
        
        // Verificar se há competição ativa e contabilizar
        const now = new Date().toISOString();
        const activeCompetition = await getOne(`
            SELECT * FROM competitions 
            WHERE active = 1 
            AND start_date <= ? 
            AND end_date >= ?
        `, [now, now]);
        
        if (activeCompetition) {
            // Contar total de materiais da entrega
            const materialsSum = await getOne(`
                SELECT SUM(amount) as total 
                FROM delivery_items 
                WHERE delivery_id = ?
            `, [deliveryId]);
            
            const totalMaterials = materialsSum?.total || 0;
            
            if (totalMaterials > 0) {
                // Adicionar entrada na competição
                await runQuery(`
                    INSERT INTO competition_entries (competition_id, user_id, delivery_id, material_count)
                    VALUES (?, ?, ?, ?)
                `, [activeCompetition.id, delivery.user_id, deliveryId, totalMaterials]);
            }
        }
        
        const statusMsg = metaAtingida ? 'Farm completo aprovado! ✅' : 'Farm aprovado como Em Progresso ⏳';
        res.json({ success: true, message: statusMsg, isPartial: newIsPartial });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Atualizar dinheiro sujo de uma entrega
router.put('/deliveries/:id/dirty-money', requireAdmin, async (req, res) => {
    try {
        const deliveryId = req.params.id;
        const { dirty_money_amount } = req.body;
        
        // Verificar se a entrega existe
        const delivery = await getOne('SELECT * FROM deliveries WHERE id = ?', [deliveryId]);
        if (!delivery) {
            return res.status(404).json({ error: 'Entrega não encontrada' });
        }

        const deliveryGroups = await getUserGroups(delivery.user_id);
        const isManager = isManagerByGroups(deliveryGroups);
        
        // Verificar se é do tipo dinheiro sujo
        if (delivery.payment_type !== 'dirty_money') {
            return res.status(400).json({ error: 'Esta entrega não é do tipo dinheiro sujo' });
        }
        
        const amount = parseInt(dirty_money_amount) || 0;

        // Definir meta conforme cargo (quando houver tipo de pagamento associado)
        let goal = 50000;
        if (delivery.payment_type_id) {
            const paymentType = await getOne('SELECT weekly_goal, manager_weekly_goal FROM payment_types WHERE id = ?', [delivery.payment_type_id]);
            if (paymentType) {
                goal = isManager ? (paymentType.manager_weekly_goal ?? paymentType.weekly_goal ?? 50000) : (paymentType.weekly_goal ?? 50000);
            }
        }

        const isComplete = amount >= goal;
        
        // Atualizar valor do dinheiro sujo
        await runQuery(
            'UPDATE deliveries SET dirty_money_amount = ?, is_partial = ? WHERE id = ?',
            [amount, isComplete ? 0 : 1, deliveryId]
        );
        
        res.json({ success: true, message: `Dinheiro sujo atualizado para R$ ${amount.toLocaleString('pt-BR')}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rejeitar entrega - DELETA a entrega para permitir o membro refazer
router.post('/deliveries/:id/reject', requireAdmin, async (req, res) => {
    try {
        const deliveryId = req.params.id;
        const userId = req.session.user.id;
        const { rejection_note } = req.body || {};
        const rejectionReason = String(rejection_note || '').trim();

        if (!rejectionReason) {
            return res.status(400).json({ error: 'O motivo da reprovação é obrigatório.' });
        }
        
        // Verificar se a entrega existe e está pendente
        const delivery = await getOne('SELECT * FROM deliveries WHERE id = ? AND status = ?', [deliveryId, 'pending']);
        if (!delivery) {
            return res.status(404).json({ error: 'Entrega não encontrada ou já processada' });
        }
        
        console.log(`🗑️ Rejeitando entrega ID ${deliveryId} do usuário ${delivery.user_id}`);
        
        // Marcar como rejeitado (guardar quem rejeitou e a observação)
        await runQuery(
            'UPDATE deliveries SET status = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP, approval_note = ? WHERE id = ?',
            ['not_delivered', userId, rejectionReason, deliveryId]
        );
        console.log(`   - Entrega marcada como rejeitada`);
        
        // Remover permissão de edição (se houver) para permitir que o membro edite novamente
        try {
            const result = await runQuery('DELETE FROM edit_permissions WHERE user_id = ?', [delivery.user_id]);
            console.log(`   - Permissão de edição removida (linhas: ${result.changes || 0})`);
        } catch (e) {
            console.log(`   ⚠️ Erro ao remover permissão:`, e.message);
        }
        
        console.log(`✅ Entrega ${deliveryId} rejeitada com sucesso`);
        res.json({ success: true, message: 'Entrega rejeitada - membro pode refazer o farm' });
    } catch (error) {
        console.error('❌ Erro ao rejeitar entrega:', error);
        res.status(500).json({ error: error.message });
    }
});

// Listar todos os membros
router.get('/members', requireAdmin, async (req, res) => {
    try {
        // Buscar nomes dos grupos dinamicamente
        const roleNamesMap = await getRoleNames();
        
        const members = await getAll(`
            SELECT u.id, u.name, u.passport, u.email, u.role, u.created_at, u.active,
                   COALESCE((
                       SELECT SUM(di.amount) 
                       FROM delivery_items di 
                       JOIN deliveries d ON di.delivery_id = d.id 
                       WHERE d.user_id = u.id AND d.status = 'approved'
                   ), 0) as total_materials,
                   (SELECT COUNT(*) FROM deliveries WHERE user_id = u.id AND status = 'pending') as pending_count,
                   (SELECT COUNT(*) FROM deliveries WHERE user_id = u.id AND status = 'approved') as approved_count,
                   (SELECT COUNT(*) FROM warnings WHERE user_id = u.id) as warnings_count
            FROM users u
            WHERE u.passport != '0'
            ORDER BY CAST(u.passport AS INTEGER) ASC
        `);
        
        // Buscar grupos de TODOS os usuários de uma vez (otimizado)
        const userIds = members.map(m => m.id);
        const groupsMap = await getUserGroupsMap(userIds);
        
        for (const member of members) {
            member.groups = groupsMap.get(member.id) || [];
            if (member.groups.length === 0 && member.role) {
                member.groups = [member.role];
            }
        }
        
        res.json({ members, roleNames: roleNamesMap });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Ativar/Desativar membro
router.post('/members/:id/toggle', requireAdmin, async (req, res) => {
    try {
        const memberId = req.params.id;
        
        const member = await getOne('SELECT * FROM users WHERE id = ?', [memberId]);
        if (!member) {
            return res.status(404).json({ error: 'Membro não encontrado' });
        }
        
        // Não pode desativar o usuário Admin (passaporte 0)
        if (member.passport === '0') {
            return res.status(400).json({ error: 'Não é possível desativar o usuário Admin do sistema' });
        }
        
        const newStatus = member.active ? 0 : 1;
        await runQuery('UPDATE users SET active = ? WHERE id = ?', [newStatus, memberId]);
        
        res.json({ success: true, message: newStatus ? 'Membro ativado' : 'Membro desativado' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Alterar cargo do membro (somente passaporte 6999)
router.post('/members/:id/role', requireAdmin, async (req, res) => {
    try {
        // Só passaporte 6999 pode alterar cargos
        if (req.session.user.passport !== '6999') {
            return res.status(403).json({ error: 'Apenas o administrador principal pode alterar cargos' });
        }
        
        const memberId = req.params.id;
        const { role } = req.body;
        
        // Buscar grupos válidos do banco
        const validRolesList = await getAllRoles();
        const validRoles = validRolesList.map(r => r.role_name);
        
        // Validar cargo
        if (!validRoles.includes(role)) {
            return res.status(400).json({ error: 'Cargo inválido' });
        }
        
        const member = await getOne('SELECT * FROM users WHERE id = ?', [memberId]);
        if (!member) {
            return res.status(404).json({ error: 'Membro não encontrado' });
        }
        
        // Não pode alterar o passaporte 6999
        if (member.passport === '6999') {
            return res.status(400).json({ error: 'Não é possível alterar este usuário' });
        }
        
        await runQuery('UPDATE users SET role = ? WHERE id = ?', [role, memberId]);
        
        const roleNamesMap = await getRoleNames();
        res.json({ success: true, message: `Cargo alterado para ${roleNamesMap[role] || role}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Editar informações do membro (somente passaporte 6999)
router.put('/members/:id', requireAdmin, async (req, res) => {
    try {
        if (req.session.user.passport !== '6999') {
            return res.status(403).json({ error: 'Apenas o administrador principal pode editar membros' });
        }
        
        const memberId = req.params.id;
        const { name, passport, email, role, newPassword } = req.body;
        
        const member = await getOne('SELECT * FROM users WHERE id = ?', [memberId]);
        if (!member) {
            return res.status(404).json({ error: 'Membro não encontrado' });
        }
        
        // Não pode editar o passaporte 6999
        if (member.passport === '6999') {
            return res.status(400).json({ error: 'Não é possível editar este usuário' });
        }
        
        // Verificar se novo passaporte já existe
        if (passport && passport !== member.passport) {
            const existing = await getOne('SELECT * FROM users WHERE passport = ? AND id != ?', [passport.toUpperCase(), memberId]);
            if (existing) {
                return res.status(400).json({ error: 'Este passaporte já está em uso' });
            }
        }
        
        // Validar cargo se fornecido - buscar grupos válidos do banco
        if (role) {
            const validRolesList = await getAllRoles();
            const validRoles = validRolesList.map(r => r.role_name);
            if (!validRoles.includes(role)) {
                return res.status(400).json({ error: 'Cargo inválido' });
            }
        }
        
        // Se tem nova senha, fazer hash
        let hashedPassword = null;
        if (newPassword && newPassword.length >= 6) {
            const bcrypt = require('bcrypt');
            hashedPassword = await bcrypt.hash(newPassword, 10);
        }
        
        // Atualizar membro
        if (hashedPassword) {
            await runQuery(
                'UPDATE users SET name = ?, passport = ?, email = ?, role = ?, password = ? WHERE id = ?',
                [name || member.name, (passport || member.passport).toUpperCase(), email || member.email, role || member.role, hashedPassword, memberId]
            );
        } else {
            await runQuery(
                'UPDATE users SET name = ?, passport = ?, email = ?, role = ? WHERE id = ?',
                [name || member.name, (passport || member.passport).toUpperCase(), email || member.email, role || member.role, memberId]
            );
        }
        
        res.json({ success: true, message: 'Membro atualizado com sucesso' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Deletar membro (somente passaporte 6999)
router.delete('/members/:id', requireAdmin, async (req, res) => {
    try {
        if (req.session.user.passport !== '6999') {
            return res.status(403).json({ error: 'Apenas o administrador principal pode deletar membros' });
        }
        
        const memberId = req.params.id;
        
        const member = await getOne('SELECT * FROM users WHERE id = ?', [memberId]);
        if (!member) {
            return res.status(404).json({ error: 'Membro não encontrado' });
        }
        
        // Não pode deletar o usuário Admin (passaporte 0)
        if (member.passport === '0') {
            return res.status(400).json({ error: 'Não é possível deletar o usuário Admin do sistema' });
        }
        
        // Deletar entregas e itens relacionados
        const deliveries = await getAll('SELECT id FROM deliveries WHERE user_id = ?', [memberId]);
        for (const delivery of deliveries) {
            // Deletar farms extras
            try {
                const extraFarms = await getAll('SELECT id FROM extra_farm_requests WHERE delivery_id = ?', [delivery.id]);
                for (const ef of extraFarms) {
                    await runQuery('DELETE FROM extra_farm_screenshots WHERE extra_farm_id = ?', [ef.id]);
                }
                await runQuery('DELETE FROM extra_farm_requests WHERE delivery_id = ?', [delivery.id]);
            } catch(e) {}
            await runQuery('DELETE FROM delivery_screenshots WHERE delivery_id = ?', [delivery.id]);
            await runQuery('DELETE FROM delivery_items WHERE delivery_id = ?', [delivery.id]);
        }
        await runQuery('DELETE FROM deliveries WHERE user_id = ?', [memberId]);
        await runQuery('DELETE FROM justifications WHERE user_id = ?', [memberId]);
        await runQuery('DELETE FROM warnings WHERE user_id = ?', [memberId]);
        
        // Deletar registros relacionados em outras tabelas
        await runQuery('DELETE FROM user_groups WHERE user_id = ?', [memberId]);
        await runQuery('DELETE FROM farm_whitelist WHERE user_id = ?', [memberId]);
        await runQuery('DELETE FROM edit_permissions WHERE user_id = ?', [memberId]);
        await runQuery('DELETE FROM member_observations WHERE user_id = ?', [memberId]);
        await runQuery('DELETE FROM member_observations WHERE created_by = ?', [memberId]);
        await runQuery('DELETE FROM password_resets WHERE user_id = ?', [memberId]);
        
        await runQuery('DELETE FROM users WHERE id = ?', [memberId]);
        
        res.json({ success: true, message: 'Membro deletado com sucesso' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Estatísticas gerais (por semana)
router.get('/stats', requireAdmin, async (req, res) => {
    try {
        const { week_start, week_end } = req.query;
        
        let pendingQuery = 'SELECT COUNT(*) as count FROM deliveries WHERE status = \'pending\'';
        let approvedQuery = 'SELECT COUNT(*) as count FROM deliveries WHERE status = \'approved\'';
        const params = [];
        
        if (week_start && week_end) {
            pendingQuery += ' AND week_start = ? AND week_end = ?';
            approvedQuery += ' AND week_start = ? AND week_end = ?';
        }
        
        // Contar TODOS os membros ativos (incluindo admin)
        const totalMembers = await getOne('SELECT COUNT(*) as count FROM users WHERE active = 1');
        const pendingDeliveries = await getOne(pendingQuery, week_start ? [week_start, week_end] : []);
        const approvedDeliveries = await getOne(approvedQuery, week_start ? [week_start, week_end] : []);
        
        res.json({ 
            stats: {
                total_members: totalMembers.count,
                pending_deliveries: pendingDeliveries.count,
                approved_count: approvedDeliveries.count
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===== RANKING SEMANAL OTIMIZADO (nova rota super rápida) =====
router.get('/weekly-ranking-fast', requireAdmin, async (req, res) => {
    try {
        const { week_start, week_end } = req.query;
        
        if (!week_start || !week_end) {
            return res.status(400).json({ error: 'week_start e week_end são obrigatórios' });
        }
        
        // Query única otimizada - buscar entregas aprovadas com totais de materiais
        const deliveries = await getAll(`
            SELECT 
                d.id as delivery_id,
                d.user_id,
                d.created_at as delivered_at,
                u.name,
                u.passport
            FROM deliveries d
            JOIN users u ON d.user_id = u.id
            WHERE d.week_start = ? AND d.week_end = ? AND d.status = 'approved'
        `, [week_start, week_end]);
        
        if (deliveries.length === 0) {
            return res.json({ ranking: [], week: { start: week_start, end: week_end } });
        }
        
        // Buscar todos os itens de todas as entregas de uma vez
        const deliveryIds = deliveries.map(d => d.delivery_id);
        const placeholders = deliveryIds.map(() => '?').join(',');
        
        const items = await getAll(`
            SELECT di.delivery_id, di.amount, m.name as material_name, m.icon as material_icon
            FROM delivery_items di
            JOIN materials m ON di.material_id = m.id
            WHERE di.delivery_id IN (${placeholders})
        `, deliveryIds);
        
        // Buscar farm extras aprovados
        const extras = await getAll(`
            SELECT delivery_id, materials
            FROM extra_farm_requests
            WHERE delivery_id IN (${placeholders}) AND status = 'approved'
        `, deliveryIds);
        
        // Agrupar itens por delivery
        const itemsByDelivery = new Map();
        for (const item of items) {
            if (!itemsByDelivery.has(item.delivery_id)) {
                itemsByDelivery.set(item.delivery_id, []);
            }
            itemsByDelivery.get(item.delivery_id).push(item);
        }
        
        // Calcular extras por delivery
        const extrasByDelivery = new Map();
        for (const extra of extras) {
            try {
                const mats = JSON.parse(extra.materials || '{}');
                let total = 0;
                for (const amount of Object.values(mats)) {
                    total += parseInt(amount) || 0;
                }
                const current = extrasByDelivery.get(extra.delivery_id) || 0;
                extrasByDelivery.set(extra.delivery_id, current + total);
            } catch (e) {}
        }
        
        // Montar ranking
        const ranking = deliveries.map(d => {
            const deliveryItems = itemsByDelivery.get(d.delivery_id) || [];
            const metaTotal = deliveryItems.reduce((sum, item) => sum + (item.amount || 0), 0);
            const extraTotal = extrasByDelivery.get(d.delivery_id) || 0;
            
            return {
                id: d.user_id,
                name: d.name,
                passport: d.passport,
                totalMaterials: metaTotal + extraTotal,
                metaMaterials: metaTotal,
                extraMaterials: extraTotal,
                items: deliveryItems,
                delivered_at: d.delivered_at
            };
        }).sort((a, b) => b.totalMaterials - a.totalMaterials);
        
        res.json({ ranking, week: { start: week_start, end: week_end } });
    } catch (error) {
        console.error('Erro em weekly-ranking-fast:', error);
        res.status(500).json({ error: error.message });
    }
});

// Ranking por número de farms entregues
router.get('/ranking', requireAdmin, async (req, res) => {
    try {
        const { week_start, week_end } = req.query;
        let ranking;
        
        if (week_start && week_end) {
            // Ranking filtrado por semana
            // Farms: apenas da semana selecionada
            // ADVs: da semana selecionada OU sem semana definida (ADVs antigas)
            ranking = await getAll(`
                SELECT u.id, u.name, u.passport,
                       (SELECT COUNT(*) FROM deliveries WHERE user_id = u.id AND status = 'approved' AND week_start = ? AND week_end = ?) as farms_count,
                       (SELECT COUNT(*) FROM warnings WHERE user_id = u.id AND (week_start = ? AND week_end = ? OR week_start IS NULL)) as warnings_count
                FROM users u
                WHERE u.active = 1
                ORDER BY farms_count DESC, warnings_count ASC
            `, [week_start, week_end, week_start, week_end]);
        } else {
            // Ranking geral (todos os farms e ADVs)
            ranking = await getAll(`
                SELECT u.id, u.name, u.passport,
                       (SELECT COUNT(*) FROM deliveries WHERE user_id = u.id AND status = 'approved') as farms_count,
                       (SELECT COUNT(*) FROM warnings WHERE user_id = u.id) as warnings_count
                FROM users u
                WHERE u.active = 1
                ORDER BY farms_count DESC, warnings_count ASC
            `);
        }
        
        res.json({ ranking });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Estatísticas por material
router.get('/materials-stats', requireAdmin, async (req, res) => {
    try {
        const { week_start, week_end } = req.query;
        let stats;
        
        if (week_start && week_end) {
            stats = await getAll(`
                SELECT m.name, m.icon,
                       COALESCE(SUM(CASE WHEN d.status = 'approved' AND d.week_start = ? AND d.week_end = ? THEN di.amount ELSE 0 END), 0) as total,
                       COUNT(CASE WHEN d.status = 'approved' AND d.week_start = ? AND d.week_end = ? THEN 1 END) as deliveries_count
                FROM materials m
                LEFT JOIN delivery_items di ON m.id = di.material_id
                LEFT JOIN deliveries d ON di.delivery_id = d.id
                WHERE m.active = 1
                GROUP BY m.id
                ORDER BY total DESC
            `, [week_start, week_end, week_start, week_end]);
        } else {
            stats = await getAll(`
                SELECT m.name, m.icon,
                       COALESCE(SUM(CASE WHEN d.status = 'approved' THEN di.amount ELSE 0 END), 0) as total,
                       COUNT(CASE WHEN d.status = 'approved' THEN 1 END) as deliveries_count
                FROM materials m
                LEFT JOIN delivery_items di ON m.id = di.material_id
                LEFT JOIN deliveries d ON di.delivery_id = d.id
                WHERE m.active = 1
                GROUP BY m.id
                ORDER BY total DESC
            `);
        }
        
        res.json({ stats });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Gerenciar materiais
router.get('/materials', requireAdmin, async (req, res) => {
    try {
        let materials = await getAll('SELECT * FROM materials ORDER BY name');

        // Se informar memberId, ajustar meta conforme cargo do membro
        if (req.query.memberId) {
            const memberId = parseInt(req.query.memberId);
            if (!isNaN(memberId)) {
                const groups = await getUserGroups(memberId);
                const isManager = isManagerByGroups(groups);
                materials = materials.map(m => ({
                    ...m,
                    weekly_goal: isManager ? (m.manager_weekly_goal ?? m.weekly_goal) : m.weekly_goal
                }));
            }
        }

        res.json({ materials });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Lista de membros com status de farm
router.get('/members-farm-status', requireAdmin, async (req, res) => {
    try {
        // Membros com farm pendente
        const pendingMembers = await getAll(`
            SELECT DISTINCT u.id, u.name, u.passport, u.role,
                   (SELECT COUNT(*) FROM deliveries WHERE user_id = u.id AND status = 'pending') as pending_count,
                   (SELECT MAX(created_at) FROM deliveries WHERE user_id = u.id AND status = 'pending') as last_pending
            FROM users u
            JOIN deliveries d ON u.id = d.user_id
            WHERE d.status = 'pending' AND u.active = 1
            ORDER BY last_pending ASC
        `);
        
        // Para cada membro pendente, buscar detalhes dos farms e grupos
        for (let member of pendingMembers) {
            // Buscar grupos do usuário
            const userGroupsData = await getAll('SELECT group_name FROM user_groups WHERE user_id = ?', [member.id]);
            member.groups = userGroupsData.map(g => g.group_name);
            // Se não tiver grupos, usar role legado como fallback
            if (member.groups.length === 0 && member.role) {
                member.groups = [member.role];
            }
            
            member.pending_deliveries = await getAll(`
                SELECT d.id, d.created_at, d.screenshot_url
                FROM deliveries d
                WHERE d.user_id = ? AND d.status = 'pending'
                ORDER BY d.created_at ASC
            `, [member.id]);
            
            // Buscar itens de cada entrega pendente
            for (let delivery of member.pending_deliveries) {
                delivery.items = await getAll(`
                    SELECT di.amount, m.name, m.icon
                    FROM delivery_items di
                    JOIN materials m ON di.material_id = m.id
                    WHERE di.delivery_id = ?
                `, [delivery.id]);
            }
        }
        
        // Membros com farm completo (aprovado)
        const completedMembers = await getAll(`
            SELECT u.id, u.name, u.passport, u.role,
                   (SELECT COUNT(*) FROM deliveries WHERE user_id = u.id AND status = 'approved') as approved_count,
                   COALESCE((
                       SELECT SUM(di.amount) 
                       FROM delivery_items di 
                       JOIN deliveries d ON di.delivery_id = d.id 
                       WHERE d.user_id = u.id AND d.status = 'approved'
                   ), 0) as total_materials
            FROM users u
            WHERE u.active = 1
            AND EXISTS (SELECT 1 FROM deliveries WHERE user_id = u.id AND status = 'approved')
            ORDER BY total_materials DESC
        `);
        
        // Buscar grupos para membros completos também
        for (let member of completedMembers) {
            const userGroupsData = await getAll('SELECT group_name FROM user_groups WHERE user_id = ?', [member.id]);
            member.groups = userGroupsData.map(g => g.group_name);
            if (member.groups.length === 0 && member.role) {
                member.groups = [member.role];
            }
        }
        
        res.json({ pendingMembers, completedMembers, roleNames });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/materials', requireAdmin, async (req, res) => {
    try {
        const { name, icon, weekly_goal, manager_weekly_goal } = req.body;
        
        if (!name) {
            return res.status(400).json({ error: 'Nome do material é obrigatório' });
        }
        
        const goal = parseInt(weekly_goal) || 700;
        const managerGoal = !isNaN(parseInt(manager_weekly_goal)) ? parseInt(manager_weekly_goal) : goal;
        
        await runQuery(
            'INSERT INTO materials (name, icon, weekly_goal, manager_weekly_goal) VALUES (?, ?, ?, ?)',
            [name, icon || '📦', goal, managerGoal]
        );
        
        res.json({ success: true, message: 'Material adicionado' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Atualizar material (nome, ícone, meta)
router.put('/materials/:id', requireAdmin, async (req, res) => {
    try {
        const materialId = req.params.id;
        const { name, icon, weekly_goal, manager_weekly_goal } = req.body;
        
        const material = await getOne('SELECT * FROM materials WHERE id = ?', [materialId]);
        if (!material) {
            return res.status(404).json({ error: 'Material não encontrado' });
        }
        
        const newName = name || material.name;
        const newIcon = icon || material.icon;
        const newGoal = weekly_goal !== undefined ? parseInt(weekly_goal) : material.weekly_goal;
        const parsedManagerGoal = parseInt(manager_weekly_goal);
        const newManagerGoal = manager_weekly_goal !== undefined && !isNaN(parsedManagerGoal)
            ? parsedManagerGoal
            : (material.manager_weekly_goal ?? material.weekly_goal);
        
        await runQuery(
            'UPDATE materials SET name = ?, icon = ?, weekly_goal = ?, manager_weekly_goal = ? WHERE id = ?',
            [newName, newIcon, newGoal, newManagerGoal, materialId]
        );
        
        res.json({ success: true, message: 'Material atualizado' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/materials/:id/toggle', requireAdmin, async (req, res) => {
    try {
        const materialId = req.params.id;
        
        const material = await getOne('SELECT * FROM materials WHERE id = ?', [materialId]);
        if (!material) {
            return res.status(404).json({ error: 'Material não encontrado' });
        }
        
        const newStatus = material.active ? 0 : 1;
        await runQuery('UPDATE materials SET active = ? WHERE id = ?', [newStatus, materialId]);
        
        res.json({ success: true, message: newStatus ? 'Material visível para usuários' : 'Material ocultado' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===== ROTAS DE TIPOS DE PAGAMENTO (Dinheiro Sujo, Dinheiro Limpo, etc.) =====

// Listar todos os tipos de pagamento
router.get('/payment-types', requireAdmin, async (req, res) => {
    try {
        const paymentTypes = await getAll('SELECT * FROM payment_types ORDER BY name');
        res.json({ paymentTypes });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Adicionar novo tipo de pagamento
router.post('/payment-types', requireAdmin, async (req, res) => {
    try {
        const { name, icon, weekly_goal, manager_weekly_goal } = req.body;
        
        if (!name) {
            return res.status(400).json({ error: 'Nome do tipo de pagamento é obrigatório' });
        }
        
        const goal = parseInt(weekly_goal) || 50000;
        const managerGoal = !isNaN(parseInt(manager_weekly_goal)) ? parseInt(manager_weekly_goal) : goal;
        
        await runQuery(
            'INSERT INTO payment_types (name, icon, weekly_goal, manager_weekly_goal) VALUES (?, ?, ?, ?)',
            [name, icon || '💰', goal, managerGoal]
        );
        
        res.json({ success: true, message: 'Tipo de pagamento adicionado' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Atualizar tipo de pagamento
router.put('/payment-types/:id', requireAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const { name, icon, weekly_goal, manager_weekly_goal } = req.body;
        
        const paymentType = await getOne('SELECT * FROM payment_types WHERE id = ?', [id]);
        if (!paymentType) {
            return res.status(404).json({ error: 'Tipo de pagamento não encontrado' });
        }
        
        const newName = name || paymentType.name;
        const newIcon = icon || paymentType.icon;
        const newGoal = weekly_goal !== undefined ? parseInt(weekly_goal) : paymentType.weekly_goal;
        const parsedManagerGoal = parseInt(manager_weekly_goal);
        const newManagerGoal = manager_weekly_goal !== undefined && !isNaN(parsedManagerGoal)
            ? parsedManagerGoal
            : (paymentType.manager_weekly_goal ?? paymentType.weekly_goal);
        
        await runQuery(
            'UPDATE payment_types SET name = ?, icon = ?, weekly_goal = ?, manager_weekly_goal = ? WHERE id = ?',
            [newName, newIcon, newGoal, newManagerGoal, id]
        );
        
        res.json({ success: true, message: 'Tipo de pagamento atualizado' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Ativar/Desativar tipo de pagamento
router.post('/payment-types/:id/toggle', requireAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        
        const paymentType = await getOne('SELECT * FROM payment_types WHERE id = ?', [id]);
        if (!paymentType) {
            return res.status(404).json({ error: 'Tipo de pagamento não encontrado' });
        }
        
        const newStatus = paymentType.active ? 0 : 1;
        await runQuery('UPDATE payment_types SET active = ? WHERE id = ?', [newStatus, id]);
        
        res.json({ success: true, message: newStatus ? 'Tipo de pagamento ativado' : 'Tipo de pagamento desativado' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===== CONFIGURAÇÕES DO FARM =====

// Buscar configurações do farm
router.get('/farm-settings', requireAdmin, async (req, res) => {
    try {
        const settings = await getAll('SELECT setting_key, setting_value FROM farm_settings');
        const settingsObj = {};
        settings.forEach(s => {
            settingsObj[s.setting_key] = s.setting_value;
        });
        res.json({ settings: settingsObj });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Atualizar configuração do farm
router.put('/farm-settings/:key', requireAdmin, async (req, res) => {
    try {
        const { key } = req.params;
        const { value } = req.body;
        
        const validKeys = ['farm_materials_enabled', 'farm_payment_enabled', 'farm_payment_mode', 'competition_enabled'];
        if (!validKeys.includes(key)) {
            return res.status(400).json({ error: 'Configuração inválida' });
        }
        
        // Verificar se existe, se não, criar
        const existing = await getOne('SELECT * FROM farm_settings WHERE setting_key = ?', [key]);
        if (existing) {
            await runQuery('UPDATE farm_settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP WHERE setting_key = ?', [value, key]);
        } else {
            await runQuery('INSERT INTO farm_settings (setting_key, setting_value) VALUES (?, ?)', [key, value]);
        }
        
        res.json({ success: true, message: 'Configuração atualizada' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Status semanal dos membros - OTIMIZADO
router.get('/weekly-status', requireAdmin, async (req, res) => {
    try {
        const { week_start, week_end } = req.query;
        
        // Usar semana passada ou semana atual
        let weekStart, weekEnd;
        if (week_start && week_end) {
            weekStart = week_start;
            weekEnd = week_end;
        } else {
            const week = getCurrentWeek();
            weekStart = week.start;
            weekEnd = week.end;
        }
        
        // Verificar se a semana já passou
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const weekEndDate = new Date(weekEnd);
        const weekPassed = today > weekEndDate;
        
        // ===== BUSCAR TODOS OS DADOS DE UMA VEZ (OTIMIZADO) =====
        
        // 1. Buscar whitelist
        const whitelist = await getAll(`SELECT user_id FROM farm_whitelist`);
        const whitelistIds = new Set(whitelist.map(w => w.user_id));
        
        // 2. Todos os membros ativos
        const allMembers = await getAll(`
            SELECT id, name, passport, role, created_at FROM users 
            WHERE active = 1 AND passport != '0'
            ORDER BY name
        `);
        
        // 3. Buscar TODOS os grupos de TODOS os membros de uma vez
        const allUserGroups = await getAll(`SELECT user_id, group_name FROM user_groups`);
        const userGroupsMap = new Map();
        for (const ug of allUserGroups) {
            if (!userGroupsMap.has(ug.user_id)) {
                userGroupsMap.set(ug.user_id, []);
            }
            userGroupsMap.get(ug.user_id).push(ug.group_name);
        }
        
        // 4. Buscar TODAS as entregas da semana de uma vez
        const allDeliveries = await getAll(`
            SELECT d.*, d.created_at as delivered_at, u.name as approved_by_name
            FROM deliveries d
            LEFT JOIN users u ON d.approved_by = u.id
            WHERE d.week_start = ? AND d.week_end = ?
        `, [weekStart, weekEnd]);
        const deliveriesByUserMap = new Map();
        for (const d of allDeliveries) {
            if (!deliveriesByUserMap.has(d.user_id)) {
                deliveriesByUserMap.set(d.user_id, []);
            }
            deliveriesByUserMap.get(d.user_id).push(d);
        }
        
        // 5. Buscar TODOS os itens de entrega da semana de uma vez
        const deliveryIds = allDeliveries.map(d => d.id);
        let allDeliveryItems = [];
        let allDeliveryScreenshots = [];
        if (deliveryIds.length > 0) {
            const placeholders = deliveryIds.map(() => '?').join(',');
            allDeliveryItems = await getAll(`
                SELECT di.delivery_id, di.amount, m.name as material_name, m.icon as material_icon, m.weekly_goal, m.manager_weekly_goal
                FROM delivery_items di
                JOIN materials m ON di.material_id = m.id
                WHERE di.delivery_id IN (${placeholders})
            `, deliveryIds);
            
            allDeliveryScreenshots = await getAll(`
                SELECT delivery_id, screenshot_url FROM delivery_screenshots WHERE delivery_id IN (${placeholders})
            `, deliveryIds);
        }
        
        // Agrupar itens e screenshots por delivery
        const deliveryItemsMap = new Map();
        for (const item of allDeliveryItems) {
            if (!deliveryItemsMap.has(item.delivery_id)) {
                deliveryItemsMap.set(item.delivery_id, []);
            }
            deliveryItemsMap.get(item.delivery_id).push(item);
        }
        
        const deliveryScreenshotsMap = new Map();
        for (const ss of allDeliveryScreenshots) {
            if (!deliveryScreenshotsMap.has(ss.delivery_id)) {
                deliveryScreenshotsMap.set(ss.delivery_id, []);
            }
            deliveryScreenshotsMap.get(ss.delivery_id).push(ss);
        }
        
        // 6. Buscar TODOS os farm extras da semana de uma vez
        let allExtraFarms = [];
        let allExtraScreenshots = [];
        if (deliveryIds.length > 0) {
            const placeholders = deliveryIds.map(() => '?').join(',');
            allExtraFarms = await getAll(`
                SELECT efr.*, efr.reviewed_at as approved_at 
                FROM extra_farm_requests efr
                WHERE efr.delivery_id IN (${placeholders})
                ORDER BY efr.created_at
            `, deliveryIds);
            
            // Buscar screenshots de extras
            const extraIds = allExtraFarms.map(e => e.id);
            if (extraIds.length > 0) {
                const extraPlaceholders = extraIds.map(() => '?').join(',');
                allExtraScreenshots = await getAll(`
                    SELECT extra_farm_id, screenshot_url FROM extra_farm_screenshots WHERE extra_farm_id IN (${extraPlaceholders})
                `, extraIds);
            }
        }
        
        // Agrupar extras por delivery
        const extraFarmsMap = new Map();
        for (const ef of allExtraFarms) {
            if (!extraFarmsMap.has(ef.delivery_id)) {
                extraFarmsMap.set(ef.delivery_id, []);
            }
            extraFarmsMap.get(ef.delivery_id).push(ef);
        }
        
        const extraScreenshotsMap = new Map();
        for (const ss of allExtraScreenshots) {
            if (!extraScreenshotsMap.has(ss.extra_farm_id)) {
                extraScreenshotsMap.set(ss.extra_farm_id, []);
            }
            extraScreenshotsMap.get(ss.extra_farm_id).push(ss);
        }
        
        // 7. Buscar TODAS as justificativas da semana de uma vez
        const allJustifications = await getAll(`
            SELECT * FROM justifications 
            WHERE week_start = ? AND week_end = ?
        `, [weekStart, weekEnd]);
        const justificationsMap = new Map();
        for (const j of allJustifications) {
            justificationsMap.set(j.user_id, j);
        }
        
        // 8. Buscar TODAS as warnings da semana de uma vez
        const allWarnings = await getAll(`
            SELECT user_id FROM warnings 
            WHERE week_start = ? AND week_end = ?
        `, [weekStart, weekEnd]);
        const warningsSet = new Set(allWarnings.map(w => w.user_id));
        
        // 9. Buscar TODOS os materiais ATIVOS de uma vez (para processar extras e meta)
        let allMaterials = [];
        try {
            allMaterials = await getAll(`SELECT id, name, icon, weekly_goal, manager_weekly_goal FROM materials WHERE active = 1`);
        } catch (e) {
            allMaterials = await getAll(`SELECT id, name, icon, weekly_goal FROM materials WHERE active = 1`);
        }
        const materialsMap = new Map();
        for (const m of allMaterials) {
            materialsMap.set(m.id.toString(), m);
        }

        // 10. Buscar TODOS os tipos de pagamento para meta
        let paymentTypes = [];
        try {
            paymentTypes = await getAll('SELECT id, weekly_goal, manager_weekly_goal FROM payment_types');
        } catch (e) {
            paymentTypes = await getAll('SELECT id, weekly_goal FROM payment_types');
        }
        const paymentTypesMap = new Map((paymentTypes || []).map(pt => [pt.id, pt]));
        
        // ===== PROCESSAR MEMBROS =====
        const completed = [];
        const partial = [];
        const pendingApproval = [];
        const notDelivered = [];
        const justified = [];
        
        for (const member of allMembers) {
            // Grupos do membro (já carregados)
            member.groups = userGroupsMap.get(member.id) || [];
            if (member.groups.length === 0 && member.role) {
                member.groups = [member.role];
            }
            const isManager = isManagerByGroups(member.groups);
            
            const memberDeliveries = deliveriesByUserMap.get(member.id) || [];
            memberDeliveries.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            const delivery = memberDeliveries[0] || null;
            const justification = justificationsMap.get(member.id);

            const weeklySubmissions = memberDeliveries.map(submission => {
                const submissionItems = (deliveryItemsMap.get(submission.id) || []).map(item => ({
                    ...item,
                    weekly_goal: isManager ? (item.manager_weekly_goal ?? item.weekly_goal) : item.weekly_goal
                }));
                const submissionScreenshots = deliveryScreenshotsMap.get(submission.id) || [];

                let submissionPaymentType = submission.payment_type || 'material';
                if (submission.dirty_money_amount > 0 && submissionItems.length === 0) {
                    submissionPaymentType = 'dirty_money';
                }

                return {
                    id: submission.id,
                    status: submission.status,
                    is_partial: submission.is_partial,
                    delivered_at: submission.delivered_at,
                    created_at: submission.created_at,
                    screenshot_url: submission.screenshot_url,
                    screenshots: submissionScreenshots,
                    description: submission.description,
                    items: submissionItems,
                    payment_type: submissionPaymentType,
                    dirty_money_amount: submission.dirty_money_amount || 0,
                    approved_by_name: submission.approved_by_name,
                    approved_at: submission.approved_at,
                    approval_note: submission.approval_note
                };
            });
            
            // Dados da entrega
            let deliveryItems = [];
            let deliveryScreenshots = [];
            let extraFarmItems = [];
            let extraFarmScreenshots = [];
            let totalExtraMaterials = 0;
            let pendingExtraInfo = null;
            
            let effectiveIsPartial = delivery?.is_partial || false;
            let effectivePaymentType = delivery?.payment_type || 'material';

            if (delivery) {
                deliveryItems = (deliveryItemsMap.get(delivery.id) || []).map(item => ({
                    ...item,
                    weekly_goal: isManager ? (item.manager_weekly_goal ?? item.weekly_goal) : item.weekly_goal
                }));
                deliveryScreenshots = deliveryScreenshotsMap.get(delivery.id) || [];

                // Se não há itens de materiais e tem dinheiro, tratar como pagamento em dinheiro
                if (delivery.dirty_money_amount > 0 && deliveryItems.length === 0) {
                    effectivePaymentType = 'dirty_money';
                }

                // Recalcular parcialidade para aprovados com base na meta do gerente
                if (delivery.status === 'approved' && delivery.is_partial) {
                    if (effectivePaymentType === 'dirty_money') {
                        const paymentType = paymentTypesMap.get(delivery.payment_type_id) || {};
                        const goal = isManager
                            ? (paymentType.manager_weekly_goal ?? paymentType.weekly_goal ?? 50000)
                            : (paymentType.weekly_goal ?? 50000);
                        const amount = delivery.dirty_money_amount || 0;
                        effectiveIsPartial = amount < goal;
                    } else {
                        let isComplete = true;
                        for (const mat of allMaterials) {
                            const item = deliveryItems.find(i => i.material_id === mat.id);
                            const amount = item ? item.amount : 0;
                            const goal = isManager
                                ? (mat.manager_weekly_goal ?? mat.weekly_goal ?? 700)
                                : (mat.weekly_goal ?? 700);
                            if (amount < goal) {
                                isComplete = false;
                                break;
                            }
                        }
                        effectiveIsPartial = !isComplete;
                    }
                }
                
                // Processar farm extras
                const extras = extraFarmsMap.get(delivery.id) || [];
                const approvedExtras = extras.filter(e => e.status === 'approved');
                const pendingExtras = extras.filter(e => e.status === 'pending');
                
                // Consolidar materiais extras aprovados
                const extraMaterialsMap2 = new Map();
                for (const extra of approvedExtras) {
                    // Screenshots do extra
                    const extraSS = extraScreenshotsMap.get(extra.id) || [];
                    extraFarmScreenshots.push(...extraSS);
                    
                    // Materiais do extra
                    try {
                        const extraMaterials = JSON.parse(extra.materials || '{}');
                        for (const [matId, amount] of Object.entries(extraMaterials)) {
                            const numAmount = parseInt(amount) || 0;
                            if (matId === 'dirty_money') {
                                if (extraMaterialsMap2.has('dirty_money')) {
                                    extraMaterialsMap2.get('dirty_money').amount += numAmount;
                                } else {
                                    extraMaterialsMap2.set('dirty_money', {
                                        material_name: 'Dinheiro Sujo',
                                        material_icon: '💰',
                                        amount: numAmount
                                    });
                                }
                                totalExtraMaterials += numAmount;
                            } else {
                                const mat = materialsMap.get(matId);
                                if (mat) {
                                    if (extraMaterialsMap2.has(matId)) {
                                        extraMaterialsMap2.get(matId).amount += numAmount;
                                    } else {
                                        extraMaterialsMap2.set(matId, {
                                            material_name: mat.name,
                                            material_icon: mat.icon,
                                            amount: numAmount
                                        });
                                    }
                                    totalExtraMaterials += numAmount;
                                }
                            }
                        }
                    } catch (e) { /* ignorar */ }
                }
                extraFarmItems = Array.from(extraMaterialsMap2.values());
                
                // Farm extra pendente
                if (pendingExtras.length > 0) {
                    const pendingExtra = pendingExtras[0];
                    let pendingExtraMaterials = [];
                    try {
                        const extraMats = JSON.parse(pendingExtra.materials || '{}');
                        for (const [matId, amount] of Object.entries(extraMats)) {
                            if (matId === 'dirty_money') {
                                pendingExtraMaterials.push({
                                    name: 'Dinheiro Sujo',
                                    icon: '💰',
                                    amount: `$${parseInt(amount).toLocaleString()}`
                                });
                            } else {
                                const mat = materialsMap.get(matId);
                                if (mat) {
                                    pendingExtraMaterials.push({
                                        name: mat.name,
                                        icon: mat.icon,
                                        amount: amount
                                    });
                                }
                            }
                        }
                    } catch (e) { /* ignorar */ }
                    
                    pendingExtraInfo = {
                        id: pendingExtra.id,
                        materials: pendingExtraMaterials,
                        created_at: pendingExtra.created_at,
                        count: pendingExtras.length
                    };
                }
            }
            
            // Classificar membro
            if (delivery && delivery.status === 'approved') {
                const isLatePayment = delivery.description && delivery.description.includes('[META ATRASADA]');
                completed.push({
                    ...member,
                    delivery_id: delivery.id,
                    delivered_at: delivery.delivered_at,
                    screenshot_url: delivery.screenshot_url,
                    screenshots: deliveryScreenshots,
                    description: delivery.description,
                    items: deliveryItems,
                    is_partial: effectiveIsPartial,
                    payment_type: effectivePaymentType,
                    dirty_money_amount: delivery.dirty_money_amount || 0,
                    is_late_payment: isLatePayment,
                    extra_items: extraFarmItems,
                    extra_screenshots: extraFarmScreenshots,
                    total_extra_materials: totalExtraMaterials,
                    pending_extra: pendingExtraInfo,
                    approved_by_name: delivery.approved_by_name,
                    approved_at: delivery.approved_at,
                    approval_note: delivery.approval_note,
                    weekly_submissions: weeklySubmissions
                });
            } else if (delivery && delivery.status === 'pending') {
                const isLatePayment = delivery.description && delivery.description.includes('[META ATRASADA]');
                pendingApproval.push({
                    ...member,
                    delivery_id: delivery.id,
                    delivered_at: delivery.delivered_at,
                    screenshot_url: delivery.screenshot_url,
                    screenshots: deliveryScreenshots,
                    description: delivery.description,
                    items: deliveryItems,
                    payment_type: delivery.payment_type || 'material',
                    dirty_money_amount: delivery.dirty_money_amount || 0,
                    is_late_payment: isLatePayment,
                    is_partial: delivery.is_partial,
                    weekly_submissions: weeklySubmissions
                });
            } else if (delivery && (delivery.status === 'rejected' || delivery.status === 'not_delivered')) {
                // Farm foi rejeitado - mas se está na whitelist, ignorar
                if (!whitelistIds.has(member.id)) {
                    notDelivered.push({
                        ...member,
                        has_adv_applied: warningsSet.has(member.id),
                        was_rejected: true,
                        rejected_by_name: delivery.approved_by_name,
                        rejected_at: delivery.approved_at,
                        rejection_note: delivery.approval_note,
                        rejected_items: deliveryItems,
                        rejected_screenshots: deliveryScreenshots,
                        weekly_submissions: weeklySubmissions
                    });
                }
                // Se está na whitelist, simplesmente não aparece
            } else if (justification && justification.status === 'approved') {
                justified.push({
                    ...member,
                    justification_id: justification.id,
                    justification_reason: justification.reason,
                    justification_approved_at: justification.updated_at
                });
            } else if (justification && justification.status === 'pending') {
                pendingApproval.push({
                    ...member,
                    has_justification_pending: true,
                    justification_id: justification.id,
                    justification_reason: justification.reason,
                    justification_created_at: justification.created_at
                });
            } else if (whitelistIds.has(member.id)) {
                // Whitelist - isento
            } else {
                notDelivered.push({
                    ...member,
                    has_adv_applied: warningsSet.has(member.id),
                    weekly_submissions: []
                });
            }
        }
        
        res.json({ 
            completed, 
            partial,
            pendingApproval, 
            notDelivered, 
            justified, 
            week: { start: weekStart, end: weekEnd },
            weekPassed
        });
    } catch (error) {
        console.error('Erro em weekly-status:', error);
        res.status(500).json({ error: error.message });
    }
});

// Visão geral de todos os membros (farm + ADVs)
// Visão geral de todos os membros (farm + ADVs) - OTIMIZADO
router.get('/members-overview', requireAdmin, async (req, res) => {
    try {
        const { week_start, week_end } = req.query;
        
        // Usar semana passada ou semana atual
        let weekStart, weekEnd;
        if (week_start && week_end) {
            weekStart = week_start;
            weekEnd = week_end;
        } else {
            const week = getCurrentWeek();
            weekStart = week.start;
            weekEnd = week.end;
        }
        
        // ===== BUSCAR TODOS OS DADOS DE UMA VEZ =====
        
        // 1. Whitelist
        const whitelist = await getAll(`SELECT user_id FROM farm_whitelist`);
        const whitelistIds = new Set(whitelist.map(w => w.user_id));
        
        // 2. Todos os membros ativos
        const allMembers = await getAll(`
            SELECT id, name, passport, role FROM users 
            WHERE active = 1 AND passport != '0'
            ORDER BY name
        `);
        
        // 3. Todos os grupos de todos os membros
        const allUserGroups = await getAll(`SELECT user_id, group_name FROM user_groups`);
        const userGroupsMap = new Map();
        for (const ug of allUserGroups) {
            if (!userGroupsMap.has(ug.user_id)) userGroupsMap.set(ug.user_id, []);
            userGroupsMap.get(ug.user_id).push(ug.group_name);
        }
        
        // 4. Todas as entregas da semana
        const allDeliveries = await getAll(`
            SELECT id, user_id, status, created_at, payment_type, payment_type_id, dirty_money_amount, description 
            FROM deliveries WHERE week_start = ? AND week_end = ?
        `, [weekStart, weekEnd]);
        const deliveriesMap = new Map();
        for (const d of allDeliveries) deliveriesMap.set(d.user_id, d);
        
        // 5. Todas as justificativas da semana
        const allJustifications = await getAll(`
            SELECT user_id, id, status, reason FROM justifications 
            WHERE week_start = ? AND week_end = ?
        `, [weekStart, weekEnd]);
        const justificationsMap = new Map();
        for (const j of allJustifications) justificationsMap.set(j.user_id, j);
        
        // 6. Contagem de warnings por usuário
        const allWarnings = await getAll(`
            SELECT user_id, COUNT(*) as total FROM warnings GROUP BY user_id
        `);
        const warningsMap = new Map();
        for (const w of allWarnings) warningsMap.set(w.user_id, w.total);
        
        // 7. Payment types (se necessário)
        const allPaymentTypes = await getAll(`SELECT id, name, icon FROM payment_types`);
        const paymentTypesMap = new Map();
        for (const pt of allPaymentTypes) paymentTypesMap.set(pt.id, pt);
        
        // ===== PROCESSAR MEMBROS =====
        const members = [];
        
        for (const member of allMembers) {
            // Grupos
            member.groups = userGroupsMap.get(member.id) || [];
            if (member.groups.length === 0 && member.role) {
                member.groups = [member.role];
            }
            
            const delivery = deliveriesMap.get(member.id);
            const justification = justificationsMap.get(member.id);
            
            // Se whitelist sem entrega, pular
            if (whitelistIds.has(member.id) && !delivery) continue;
            
            // Status do farm
            let farmStatus = 'not_delivered';
            let deliveryId = null;
            let deliveredAt = null;
            let isLatePayment = false;
            
            if (delivery) {
                farmStatus = delivery.status;
                deliveryId = delivery.id;
                deliveredAt = delivery.created_at;
                isLatePayment = delivery.description && delivery.description.includes('[META ATRASADA]');
            } else if (justification) {
                if (justification.status === 'approved') {
                    farmStatus = 'justified';
                } else if (justification.status === 'pending') {
                    farmStatus = 'justification_pending';
                }
            }
            
            // Payment type
            let paymentTypeName = null;
            let paymentTypeIcon = null;
            if (delivery && delivery.payment_type_id) {
                const pt = paymentTypesMap.get(delivery.payment_type_id);
                if (pt) {
                    paymentTypeName = pt.name;
                    paymentTypeIcon = pt.icon;
                }
            }
            
            members.push({
                ...member,
                farmStatus,
                deliveryId,
                deliveredAt,
                warningsCount: warningsMap.get(member.id) || 0,
                paymentType: delivery ? (delivery.payment_type || 'material') : null,
                paymentTypeName,
                paymentTypeIcon,
                dirtyMoneyAmount: delivery ? (delivery.dirty_money_amount || 0) : 0,
                isLatePayment
            });
        }
        
        res.json({ members, week: { start: weekStart, end: weekEnd } });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Buscar detalhes do farm de um membro (para modal de extrato)
router.get('/member-farm-details/:memberId', requireAdmin, async (req, res) => {
    try {
        const { memberId } = req.params;
        const { week_start, week_end } = req.query;
        
        // Buscar dados do membro
        const member = await getOne('SELECT id, name, passport, role FROM users WHERE id = ?', [memberId]);
        if (!member) {
            return res.status(404).json({ error: 'Membro não encontrado' });
        }
        
        // Buscar delivery da semana
        const delivery = await getOne(`
            SELECT d.*, u.name as approved_by_name
            FROM deliveries d
            LEFT JOIN users u ON d.approved_by = u.id
            WHERE d.user_id = ? AND d.week_start = ? AND d.week_end = ?
        `, [memberId, week_start, week_end]);
        
        let items = [];
        if (delivery) {
            // Buscar itens do delivery
            items = await getAll(`
                SELECT di.*, m.name as material_name, m.icon as material_icon
                FROM delivery_items di
                JOIN materials m ON di.material_id = m.id
                WHERE di.delivery_id = ?
            `, [delivery.id]);
        }
        
        // Buscar justificativa da semana (se houver)
        const justification = await getOne(`
            SELECT j.*, u.name as approved_by_name
            FROM justifications j
            LEFT JOIN users u ON j.approved_by = u.id
            WHERE j.user_id = ? AND j.week_start = ? AND j.week_end = ?
        `, [memberId, week_start, week_end]);
        
        res.json({ 
            success: true,
            member, 
            delivery, 
            items, 
            justification,
            week: { start: week_start, end: week_end }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Extrato completo de um membro (histórico de farms + ADVs)
router.get('/member-extract/:memberId', requireAdmin, async (req, res) => {
    try {
        const { memberId } = req.params;
        
        // Buscar dados do membro
        const member = await getOne('SELECT id, name, passport, role, created_at FROM users WHERE id = ?', [memberId]);
        if (!member) {
            return res.status(404).json({ error: 'Membro não encontrado' });
        }
        
        // Buscar grupos do membro
        const userGroupsData = await getAll('SELECT group_name FROM user_groups WHERE user_id = ?', [memberId]);
        member.groups = userGroupsData.map(g => g.group_name);
        if (member.groups.length === 0 && member.role) {
            member.groups = [member.role];
        }
        const isManager = isManagerByGroups(member.groups);
        
        // Buscar últimas 10 semanas de farm (deliveries)
        const deliveries = await getAll(`
            SELECT d.*, u.name as approved_by_name
            FROM deliveries d
            LEFT JOIN users u ON d.approved_by = u.id
            WHERE d.user_id = ?
            ORDER BY d.week_start DESC, d.created_at DESC
            LIMIT 10
        `, [memberId]);
        
        // Para cada delivery, buscar os itens e farms extras
        for (let delivery of deliveries) {
            // Itens da meta principal
            delivery.items = await getAll(`
                SELECT di.amount, m.name as material_name, m.icon as material_icon, m.weekly_goal, m.manager_weekly_goal
                FROM delivery_items di
                JOIN materials m ON di.material_id = m.id
                WHERE di.delivery_id = ?
            `, [delivery.id]);

            delivery.items = delivery.items.map(item => ({
                ...item,
                weekly_goal: isManager ? (item.manager_weekly_goal ?? item.weekly_goal) : item.weekly_goal
            }));
            
            // Farms extras relacionados
            try {
                const extraFarms = await getAll(`
                    SELECT ef.*, reviewer.name as reviewer_name
                    FROM extra_farm_requests ef
                    LEFT JOIN users reviewer ON ef.reviewed_by = reviewer.id
                    WHERE ef.delivery_id = ?
                    ORDER BY ef.created_at DESC
                `, [delivery.id]);
                
                // Para cada extra, parsear materiais e buscar nomes
                for (const extra of extraFarms) {
                    const materials = JSON.parse(extra.materials || '{}');
                    const materialDetails = [];
                    let totalExtra = 0;
                    
                    for (const [matId, amount] of Object.entries(materials)) {
                        if (matId === 'dirty_money') {
                            materialDetails.push({ 
                                material_name: 'Dinheiro Sujo', 
                                material_icon: '💰', 
                                amount: parseInt(amount),
                                formatted: `$${parseInt(amount).toLocaleString()}`
                            });
                        } else {
                            const mat = await getOne('SELECT name, icon FROM materials WHERE id = ?', [matId]);
                            if (mat) {
                                materialDetails.push({ 
                                    material_name: mat.name, 
                                    material_icon: mat.icon, 
                                    amount: parseInt(amount)
                                });
                                totalExtra += parseInt(amount);
                            }
                        }
                    }
                    extra.materialDetails = materialDetails;
                    extra.totalMaterials = totalExtra;
                }
                
                delivery.extraFarms = extraFarms;
            } catch (e) {
                delivery.extraFarms = [];
            }
        }
        
        // Buscar justificativas (últimas 10)
        const justifications = await getAll(`
            SELECT j.*, u.name as approved_by_name
            FROM justifications j
            LEFT JOIN users u ON j.approved_by = u.id
            WHERE j.user_id = ?
            ORDER BY j.week_start DESC
            LIMIT 10
        `, [memberId]);
        
        // Buscar todas as advertências
        const warnings = await getAll(`
            SELECT w.*, u.name as given_by_name
            FROM warnings w
            JOIN users u ON w.given_by = u.id
            WHERE w.user_id = ?
            ORDER BY w.created_at DESC
        `, [memberId]);
        
        // Estatísticas
        const totalApproved = await getOne(`
            SELECT COUNT(*) as count FROM deliveries WHERE user_id = ? AND status = 'approved'
        `, [memberId]);
        
        const totalPending = await getOne(`
            SELECT COUNT(*) as count FROM deliveries WHERE user_id = ? AND status = 'pending'
        `, [memberId]);
        
        const totalRejected = await getOne(`
            SELECT COUNT(*) as count FROM deliveries WHERE user_id = ? AND status IN ('rejected','not_delivered')
        `, [memberId]);
        
        const totalJustified = await getOne(`
            SELECT COUNT(*) as count FROM justifications WHERE user_id = ? AND status = 'approved'
        `, [memberId]);
        
        res.json({ 
            success: true,
            member,
            deliveries,
            justifications,
            warnings,
            stats: {
                totalApproved: totalApproved.count,
                totalPending: totalPending.count,
                totalRejected: totalRejected.count,
                totalJustified: totalJustified.count,
                totalWarnings: warnings.length
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Buscar advertências de um membro (para modal)
router.get('/member-warnings/:memberId', requireAdmin, async (req, res) => {
    try {
        const { memberId } = req.params;
        
        // Buscar dados do membro
        const member = await getOne('SELECT id, name, passport, role FROM users WHERE id = ?', [memberId]);
        if (!member) {
            return res.status(404).json({ error: 'Membro não encontrado' });
        }
        
        // Buscar todas as advertências
        const warnings = await getAll(`
            SELECT w.*, u.name as given_by_name
            FROM warnings w
            JOIN users u ON w.given_by = u.id
            WHERE w.user_id = ?
            ORDER BY w.created_at DESC
        `, [memberId]);
        
        res.json({ 
            success: true,
            member, 
            warnings,
            count: warnings.length
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Listar justificativas pendentes (da semana)
router.get('/justifications/pending', requireAdmin, async (req, res) => {
    try {
        const { week_start, week_end } = req.query;
        
        let query = `
            SELECT j.*, u.name as user_name, u.passport as user_passport, u.role as user_role
            FROM justifications j
            JOIN users u ON j.user_id = u.id
            WHERE j.status = 'pending'
        `;
        const params = [];
        
        if (week_start && week_end) {
            query += ` AND j.week_start = ? AND j.week_end = ?`;
            params.push(week_start, week_end);
        }
        
        query += ` ORDER BY j.week_start DESC, j.created_at ASC`;
        
        const justifications = await getAll(query, params);
        
        // Buscar grupos de cada usuário
        for (const justification of justifications) {
            const userGroupsData = await getAll('SELECT group_name FROM user_groups WHERE user_id = ?', [justification.user_id]);
            justification.user_groups = userGroupsData.map(g => g.group_name);
        }
        
        res.json({ justifications });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Buscar todas as justificativas (extrato)
router.get('/justifications/all', requireAdmin, async (req, res) => {
    try {
        const query = `
            SELECT j.*, u.name as user_name, u.passport, u.role as user_role
            FROM justifications j
            JOIN users u ON j.user_id = u.id
            ORDER BY j.created_at DESC
            LIMIT 500
        `;
        
        const justifications = await getAll(query);
        
        // Buscar grupos de cada usuário
        for (const justification of justifications) {
            const userGroupsData = await getAll('SELECT group_name FROM user_groups WHERE user_id = ?', [justification.user_id]);
            justification.user_groups = userGroupsData.map(g => g.group_name);
            if (justification.user_groups.length === 0 && justification.user_role) {
                justification.user_groups = [justification.user_role];
            }
        }
        
        res.json({ justifications });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Aprovar justificativa
router.put('/justifications/:id/approve', requireAdmin, async (req, res) => {
    try {
        const justificationId = req.params.id;
        const userId = req.session.user.id;
        
        const justification = await getOne('SELECT * FROM justifications WHERE id = ? AND status = ?', [justificationId, 'pending']);
        if (!justification) {
            return res.status(404).json({ error: 'Justificativa não encontrada ou já processada' });
        }
        
        await runQuery(
            'UPDATE justifications SET status = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?',
            ['approved', userId, justificationId]
        );
        
        res.json({ success: true, message: 'Justificativa aprovada! ✅' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rejeitar justificativa
router.put('/justifications/:id/reject', requireAdmin, async (req, res) => {
    try {
        const justificationId = req.params.id;
        const userId = req.session.user.id;
        const { rejection_reason } = req.body;
        
        const justification = await getOne('SELECT * FROM justifications WHERE id = ? AND status = ?', [justificationId, 'pending']);
        if (!justification) {
            return res.status(404).json({ error: 'Justificativa não encontrada ou já processada' });
        }
        
        await runQuery(
            'UPDATE justifications SET status = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?',
            ['rejected', userId, justificationId]
        );
        
        res.json({ success: true, message: 'Justificativa rejeitada' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===================== EDITAR STATUS DE PAGAMENTO (GERENTE GERAL) =====================

// Editar status de pagamento de um membro em uma semana específica
router.post('/edit-member-status', requireAdmin, async (req, res) => {
    try {
        const { user_id, week_start, week_end, new_status, note } = req.body;
        const adminId = req.session.user.id;
        const adminUser = req.session.user;
        
        // Roles permitidos para editar status
        const allowedRoles = ['gerente_geral', 'gerente_farm', '01', '02', 'super_admin'];
        const isSuperAdmin = adminUser.passport === '6999' || adminUser.role === 'super_admin';
        if (!allowedRoles.includes(adminUser.role) && !isSuperAdmin) {
            return res.status(403).json({ error: 'Você não tem permissão para editar status de pagamento' });
        }
        
        if (!user_id || !week_start || !week_end || !new_status) {
            return res.status(400).json({ error: 'Dados incompletos' });
        }
        
        const member = await getOne('SELECT * FROM users WHERE id = ?', [user_id]);
        if (!member) {
            return res.status(404).json({ error: 'Membro não encontrado' });
        }
        
        // Verificar entrega existente
        const existingDelivery = await getOne(
            'SELECT * FROM deliveries WHERE user_id = ? AND week_start = ? AND week_end = ?',
            [user_id, week_start, week_end]
        );
        
        // Verificar justificativa existente
        const existingJustification = await getOne(
            'SELECT * FROM justifications WHERE user_id = ? AND week_start = ? AND week_end = ?',
            [user_id, week_start, week_end]
        );
        
        const noteText = note ? ` [Editado por ${adminUser.name}: ${note}]` : ` [Editado por ${adminUser.name}]`;
        
        switch (new_status) {
            case 'approved':
                // Marcar como pago/aprovado
                if (existingDelivery) {
                    await runQuery(
                        'UPDATE deliveries SET status = ?, is_partial = 0, description = COALESCE(description, \'\') || ? WHERE id = ?',
                        ['approved', noteText, existingDelivery.id]
                    );
                } else {
                    // Criar delivery virtual (editado pelo admin)
                    const result = await runQuery(
                        `INSERT INTO deliveries (user_id, week_start, week_end, status, description, is_partial, payment_type)
                         VALUES (?, ?, ?, 'approved', ?, 0, 'material')`,
                        [user_id, week_start, week_end, `Marcado como pago${noteText}`]
                    );
                }
                // Remover justificativa se existir
                if (existingJustification) {
                    await runQuery('DELETE FROM justifications WHERE id = ?', [existingJustification.id]);
                }
                break;
                
            case 'partial':
                // Marcar como parcial/em progresso
                if (existingDelivery) {
                    await runQuery(
                        'UPDATE deliveries SET status = ?, is_partial = 1, description = COALESCE(description, \'\') || ? WHERE id = ?',
                        ['pending', noteText, existingDelivery.id]
                    );
                } else {
                    await runQuery(
                        `INSERT INTO deliveries (user_id, week_start, week_end, status, description, is_partial, payment_type)
                         VALUES (?, ?, ?, 'pending', ?, 1, 'material')`,
                        [user_id, week_start, week_end, `Marcado como parcial${noteText}`]
                    );
                }
                if (existingJustification) {
                    await runQuery('DELETE FROM justifications WHERE id = ?', [existingJustification.id]);
                }
                break;
                
            case 'pending':
                // Marcar como aguardando aprovação
                if (existingDelivery) {
                    await runQuery(
                        'UPDATE deliveries SET status = ?, is_partial = 0, description = COALESCE(description, \'\') || ? WHERE id = ?',
                        ['pending', noteText, existingDelivery.id]
                    );
                } else {
                    await runQuery(
                        `INSERT INTO deliveries (user_id, week_start, week_end, status, description, is_partial, payment_type)
                         VALUES (?, ?, ?, 'pending', ?, 0, 'material')`,
                        [user_id, week_start, week_end, `Aguardando aprovação${noteText}`]
                    );
                }
                if (existingJustification) {
                    await runQuery('DELETE FROM justifications WHERE id = ?', [existingJustification.id]);
                }
                break;
                
            case 'not_delivered':
                // Marcar como não entregou (remover delivery e justificativa)
                console.log(`🗑️ Deletando entrega do usuário ${user_id} para semana ${week_start} - ${week_end}`);
                
                // Buscar TODAS as entregas dessa semana (pela data de início) para garantir que pegamos todas
                const allDeliveries = await getAll(
                    'SELECT * FROM deliveries WHERE user_id = ? AND week_start = ?',
                    [user_id, week_start]
                );
                
                if (allDeliveries && allDeliveries.length > 0) {
                    console.log(`   - Encontradas ${allDeliveries.length} entrega(s), deletando...`);
                    for (const delivery of allDeliveries) {
                        // Deletar farms extras
                        try {
                            const extraFarms = await getAll('SELECT id FROM extra_farm_requests WHERE delivery_id = ?', [delivery.id]);
                            for (const ef of extraFarms) {
                                await runQuery('DELETE FROM extra_farm_screenshots WHERE extra_farm_id = ?', [ef.id]);
                            }
                            await runQuery('DELETE FROM extra_farm_requests WHERE delivery_id = ?', [delivery.id]);
                        } catch(e) {}
                        // Deletar screenshots e items
                        await runQuery('DELETE FROM delivery_screenshots WHERE delivery_id = ?', [delivery.id]);
                        await runQuery('DELETE FROM delivery_items WHERE delivery_id = ?', [delivery.id]);
                        await runQuery('DELETE FROM deliveries WHERE id = ?', [delivery.id]);
                        console.log(`   ✅ Entrega ID ${delivery.id} deletada`);
                    }
                } else {
                    console.log(`   ℹ️ Nenhuma entrega encontrada para deletar`);
                }
                
                if (existingJustification) {
                    await runQuery('DELETE FROM justifications WHERE id = ?', [existingJustification.id]);
                    console.log(`   ✅ Justificativa deletada`);
                }
                
                // Remover permissão de edição (se houver) para permitir que o membro edite novamente
                try {
                    const result = await runQuery('DELETE FROM edit_permissions WHERE user_id = ?', [user_id]);
                    console.log(`   ✅ Permissão de edição removida (linhas afetadas: ${result.changes || 0})`);
                } catch (e) {
                    console.log(`   ⚠️ Erro ao remover permissão de edição:`, e.message);
                }
                break;
                
            case 'justified':
                // Marcar como justificado
                if (existingJustification) {
                    await runQuery(
                        'UPDATE justifications SET status = ?, reason = COALESCE(reason, \'\') || ? WHERE id = ?',
                        ['approved', noteText, existingJustification.id]
                    );
                } else {
                    await runQuery(
                        `INSERT INTO justifications (user_id, week_start, week_end, reason, status, approved_by)
                         VALUES (?, ?, ?, ?, 'approved', ?)`,
                        [user_id, week_start, week_end, `Justificado pelo admin${noteText}`, adminId]
                    );
                }
                // Remover delivery se existir
                if (existingDelivery) {
                    // Deletar farms extras
                    try {
                        const extraFarms = await getAll('SELECT id FROM extra_farm_requests WHERE delivery_id = ?', [existingDelivery.id]);
                        for (const ef of extraFarms) {
                            await runQuery('DELETE FROM extra_farm_screenshots WHERE extra_farm_id = ?', [ef.id]);
                        }
                        await runQuery('DELETE FROM extra_farm_requests WHERE delivery_id = ?', [existingDelivery.id]);
                    } catch(e) {}
                    await runQuery('DELETE FROM delivery_screenshots WHERE delivery_id = ?', [existingDelivery.id]);
                    await runQuery('DELETE FROM delivery_items WHERE delivery_id = ?', [existingDelivery.id]);
                    await runQuery('DELETE FROM deliveries WHERE id = ?', [existingDelivery.id]);
                }
                break;
                
            default:
                return res.status(400).json({ error: 'Status inválido' });
        }
        
        res.json({ success: true, message: 'Status atualizado com sucesso' });
    } catch (error) {
        console.error('Erro ao editar status:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===================== ADVERTÊNCIAS =====================

// Listar advertências de um membro
router.get('/members/:id/warnings', requireAdmin, async (req, res) => {
    try {
        const memberId = req.params.id;
        
        const warnings = await getAll(`
            SELECT w.*, u.name as given_by_name
            FROM warnings w
            JOIN users u ON w.given_by = u.id
            WHERE w.user_id = ?
            ORDER BY w.created_at DESC
        `, [memberId]);
        
        res.json({ warnings });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Aplicar advertência (qualquer admin)
router.post('/members/:id/warnings', requireAdmin, async (req, res) => {
    try {
        const memberId = req.params.id;
        const { reason, week_start, week_end } = req.body;
        const adminId = req.session.user.id;
        
        if (!reason || reason.trim() === '') {
            return res.status(400).json({ error: 'Informe o motivo da advertência' });
        }
        
        const member = await getOne('SELECT * FROM users WHERE id = ?', [memberId]);
        if (!member) {
            return res.status(404).json({ error: 'Membro não encontrado' });
        }
        
        // Não pode dar ADV no passaporte 6999
        if (member.passport === '6999') {
            return res.status(400).json({ error: 'Não é possível advertir este usuário' });
        }
        
        // Verificar se já existe ADV para essa semana (impedir duplicada)
        if (week_start && week_end) {
            const existingAdv = await getOne(
                'SELECT id FROM warnings WHERE user_id = ? AND week_start = ? AND week_end = ?',
                [memberId, week_start, week_end]
            );
            if (existingAdv) {
                return res.status(400).json({ error: 'Este membro já possui ADV para esta semana' });
            }
        }
        
        // Inserir com ou sem referência de semana
        if (week_start && week_end) {
            await runQuery(
                'INSERT INTO warnings (user_id, reason, given_by, week_start, week_end) VALUES (?, ?, ?, ?, ?)',
                [memberId, reason.trim(), adminId, week_start, week_end]
            );
        } else {
            await runQuery(
                'INSERT INTO warnings (user_id, reason, given_by) VALUES (?, ?, ?)',
                [memberId, reason.trim(), adminId]
            );
        }
        
        // Contar total de advertências
        const count = await getOne('SELECT COUNT(*) as total FROM warnings WHERE user_id = ?', [memberId]);
        
        res.json({ 
            success: true, 
            message: `Advertência aplicada. ${member.name} agora tem ${count.total} ADV(s).` 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Remover advertência (qualquer admin)
router.delete('/warnings/:id', requireAdmin, async (req, res) => {
    try {
        const warningId = req.params.id;
        const { removal_reason } = req.body;
        const adminId = req.session.user.id;
        
        if (!removal_reason || removal_reason.trim() === '') {
            return res.status(400).json({ error: 'Informe o motivo da remoção' });
        }
        
        // Buscar a ADV
        const warning = await getOne(`
            SELECT w.*, u.name as member_name 
            FROM warnings w 
            JOIN users u ON w.user_id = u.id 
            WHERE w.id = ?
        `, [warningId]);
        
        if (!warning) {
            return res.status(404).json({ error: 'Advertência não encontrada' });
        }
        
        // Deletar a ADV
        await runQuery('DELETE FROM warnings WHERE id = ?', [warningId]);
        
        // Contar ADVs restantes
        const count = await getOne('SELECT COUNT(*) as total FROM warnings WHERE user_id = ?', [warning.user_id]);
        
        console.log(`🗑️ ADV #${warningId} removida de ${warning.member_name} por admin #${adminId}. Motivo: ${removal_reason}`);
        
        res.json({ 
            success: true, 
            message: `Advertência removida. ${warning.member_name} agora tem ${count.total} ADV(s).`,
            remainingCount: count.total
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Listar todas as advertências com detalhes completos (para relatório)
router.get('/warnings/all', requireAdmin, async (req, res) => {
    try {
        const warnings = await getAll(`
            SELECT 
                w.id,
                w.user_id,
                w.reason,
                w.created_at,
                u.name as user_name,
                u.passport as user_passport,
                a.name as applied_by_name,
                a.passport as applied_by_passport
            FROM warnings w
            INNER JOIN users u ON w.user_id = u.id
            INNER JOIN users a ON w.given_by = a.id
            ORDER BY w.created_at DESC
        `);
        
        res.json({ success: true, warnings });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Listar todas as advertências
router.get('/warnings', requireAdmin, async (req, res) => {
    try {
        const warnings = await getAll(`
            SELECT w.*, u.name as member_name, u.passport as member_passport, a.name as given_by_name
            FROM warnings w
            JOIN users u ON w.user_id = u.id
            JOIN users a ON w.given_by = a.id
            ORDER BY w.created_at DESC
        `);
        
        res.json({ warnings });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Contar advertências de um membro
router.get('/members/:id/warnings/count', requireAdmin, async (req, res) => {
    try {
        const memberId = req.params.id;
        const count = await getOne('SELECT COUNT(*) as total FROM warnings WHERE user_id = ?', [memberId]);
        res.json({ count: count.total });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===== WHITELIST (Isenção de Farm) =====

// Listar whitelist
router.get('/whitelist', requireAdmin, async (req, res) => {
    try {
        const whitelist = await getAll(`
            SELECT w.*, u.name as member_name, u.passport as member_passport, a.name as added_by_name
            FROM farm_whitelist w
            JOIN users u ON w.user_id = u.id
            JOIN users a ON w.added_by = a.id
            ORDER BY w.created_at DESC
        `);
        
        res.json({ whitelist });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Adicionar à whitelist
router.post('/whitelist', requireAdmin, async (req, res) => {
    try {
        const { user_id, reason } = req.body;
        const addedBy = req.session.user.id;
        
        // Verificar se o usuário existe
        const user = await getOne('SELECT * FROM users WHERE id = ?', [user_id]);
        if (!user) {
            return res.status(404).json({ error: 'Membro não encontrado' });
        }
        
        // Verificar se já está na whitelist
        const existing = await getOne('SELECT * FROM farm_whitelist WHERE user_id = ?', [user_id]);
        if (existing) {
            return res.status(400).json({ error: 'Membro já está na whitelist' });
        }
        
        await runQuery(
            'INSERT INTO farm_whitelist (user_id, reason, added_by) VALUES (?, ?, ?)',
            [user_id, reason || 'Sem motivo especificado', addedBy]
        );
        
        res.json({ success: true, message: `${user.name} adicionado à whitelist!` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Remover da whitelist
router.delete('/whitelist/:userId', requireAdmin, async (req, res) => {
    try {
        const userId = req.params.userId;
        
        const existing = await getOne('SELECT * FROM farm_whitelist WHERE user_id = ?', [userId]);
        if (!existing) {
            return res.status(404).json({ error: 'Membro não está na whitelist' });
        }
        
        await runQuery('DELETE FROM farm_whitelist WHERE user_id = ?', [userId]);
        
        res.json({ success: true, message: 'Membro removido da whitelist' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===== MEMBERS WITH ADV COUNT =====

// Buscar todos os membros com contagem de ADVs - OTIMIZADO
router.get('/members-with-advs', requireAdmin, async (req, res) => {
    try {
        const members = await getAll(`
            SELECT 
                u.id,
                u.name,
                u.passport,
                u.role,
                u.active,
                (SELECT COUNT(*) FROM warnings WHERE user_id = u.id) as adv_count
            FROM users u
            WHERE u.active = 1 AND u.passport != '0'
            ORDER BY adv_count DESC, u.name ASC
        `);
        
        // Buscar grupos de TODOS de uma vez (otimizado)
        const userIds = members.map(m => m.id);
        const groupsMap = await getUserGroupsMap(userIds);
        
        for (const member of members) {
            member.groups = groupsMap.get(member.id) || [];
            if (member.groups.length === 0 && member.role) {
                member.groups = [member.role];
            }
        }
        
        res.json({ success: true, members });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========== PERMISSÕES DE EDIÇÃO ==========

// Listar membros com status de permissão de edição - OTIMIZADO
router.get('/edit-permissions', requireAdmin, async (req, res) => {
    try {
        // Buscar membros
        const members = await getAll(`
            SELECT id, name, passport, role
            FROM users
            WHERE active = 1 AND role != 'gerente_geral'
            ORDER BY name ASC
        `);
        
        // Buscar grupos de TODOS de uma vez (otimizado)
        const userIds = members.map(m => m.id);
        const groupsMap = await getUserGroupsMap(userIds);
        
        for (const member of members) {
            member.groups = groupsMap.get(member.id) || [];
            if (member.groups.length === 0 && member.role) {
                member.groups = [member.role];
            }
        }
        
        // Buscar permissões
        let permissions = [];
        try {
            permissions = await getAll(`SELECT user_id FROM edit_permissions`);
        } catch (e) {}
        
        const permissionUserIds = new Set(permissions.map(p => p.user_id));
        
        res.json({ 
            success: true, 
            members: members.map(m => ({
                ...m,
                hasPermission: permissionUserIds.has(m.id)
            }))
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Conceder permissão de edição
router.post('/edit-permissions/grant', requireAdmin, async (req, res) => {
    try {
        const { user_id, reason } = req.body;
        const grantedBy = req.session.user.id;
        
        // Verificar se já existe
        const existing = await getOne(`
            SELECT id FROM edit_permissions WHERE user_id = ?
        `, [user_id]);
        
        if (existing) {
            return res.status(400).json({ error: 'Membro já tem permissão de edição' });
        }
        
        const currentWeek = getCurrentWeek();
        try {
            await runQuery(`
                INSERT INTO edit_permissions (user_id, reason, granted_by, week_start, week_end)
                VALUES (?, ?, ?, ?, ?)
            `, [user_id, reason || 'Correção de valores', grantedBy, currentWeek.start, currentWeek.end]);
        } catch (insertError) {
            const message = String(insertError?.message || insertError || '');
            const missingColumn = message.includes('no such column') || message.includes('does not exist');
            if (!missingColumn) {
                throw insertError;
            }

            await runQuery(`
                INSERT INTO edit_permissions (user_id, reason, granted_by)
                VALUES (?, ?, ?)
            `, [user_id, reason || 'Correção de valores', grantedBy]);
        }
        
        // Buscar nome do membro para log
        const member = await getOne('SELECT name FROM users WHERE id = ?', [user_id]);
        console.log(`✏️ Permissão de edição concedida para ${member?.name} por ${req.session.user.name}`);
        
        res.json({ success: true, message: 'Permissão concedida!' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Revogar permissão de edição
router.post('/edit-permissions/revoke', requireAdmin, async (req, res) => {
    try {
        const { user_id } = req.body;
        
        await runQuery(`DELETE FROM edit_permissions WHERE user_id = ?`, [user_id]);
        
        // Buscar nome do membro para log
        const member = await getOne('SELECT name FROM users WHERE id = ?', [user_id]);
        console.log(`🚫 Permissão de edição revogada de ${member?.name} por ${req.session.user.name}`);
        
        res.json({ success: true, message: 'Permissão revogada!' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== PERMISSÕES POR GRUPO ====================

// Lista de todas as tabs disponíveis
const availableTabs = [
    { id: 'weekly-status', name: 'Status da Semana', section: 'Dashboard', icon: '📅' },
    { id: 'weekly-ranking', name: 'Ranking Semanal', section: 'Dashboard', icon: '🏆' },
    { id: 'members-panel', name: 'Painel de Membros', section: 'Dashboard', icon: '👥' },
    { id: 'members-overview', name: 'Visão Geral', section: 'Dashboard', icon: '👁️' },
    { id: 'weekly-ranking', name: 'Ranking Semanal', section: 'Dashboard', icon: '🏆' },
    { id: 'pending', name: 'Farms Pendentes', section: 'Aprovações', icon: '🕐' },
    { id: 'absences', name: 'Justificativas', section: 'Aprovações', icon: '📝' },
    { id: 'password-resets', name: 'Recuperar Senhas', section: 'Aprovações', icon: '🔑' },
    { id: 'members', name: 'Lista de Membros', section: 'Membros', icon: '📋' },
    { id: 'members-adv', name: 'Gerenciar ADVs', section: 'Membros', icon: '⚠️' },
    { id: 'new-member', name: 'Novo Membro', section: 'Membros', icon: '➕' },
    { id: 'ranking', name: 'Ranking', section: 'Estatísticas', icon: '🏆' },
    { id: 'materials-stats', name: 'Materiais', section: 'Estatísticas', icon: '📊' },
    { id: 'all-deliveries', name: 'Histórico', section: 'Estatísticas', icon: '📋' },
    { id: 'weekly-report', name: 'Relatório Semanal', section: 'Estatísticas', icon: '📄' },
    { id: 'farm-settings', name: 'Config. do Farm', section: 'Configurações', icon: '🎛️' },
    { id: 'competitions', name: 'Competições', section: 'Configurações', icon: '🏆' },
    { id: 'edit-permissions', name: 'Liberar Edição', section: 'Configurações', icon: '✏️' },
    { id: 'goals', name: 'Metas (Membros e Gerentes)', section: 'Configurações', icon: '🎯' },
    { id: 'manage-materials', name: 'Gerenciar Materiais', section: 'Configurações', icon: '📦' },
    { id: 'manage-payment-types', name: 'Tipos de Pagamento', section: 'Configurações', icon: '💰' },
    { id: 'manager-goals', name: 'Metas de Gerentes', section: 'Metas', icon: '🎯' },
    { id: 'whitelist', name: 'Whitelist (Isentos)', section: 'Configurações', icon: '🛡️' },
    { id: 'role-permissions', name: 'Permissões de Grupos', section: 'Configurações', icon: '🔐' }
];

// Grupos padrão (serão criados se não existirem)
// Tabs disponíveis:
// - weekly-status: Status da Semana
// - members-panel: Painel de Membros
// - members-overview: Visão Geral
// - pending: Farms Pendentes
// - absences: Justificativas
// - password-resets: Recuperar Senhas
// - members: Lista de Membros
// - members-adv: Gerenciar ADVs
// - new-member: Novo Membro
// - ranking: Ranking
// - materials-stats: Materiais (estatísticas)
// - all-deliveries: Histórico
// - weekly-report: Relatório Semanal
// - farm-settings: Config. do Farm (requer can_config)
// - edit-permissions: Liberar Edição (requer can_config)
// - goals: Metas (Membros e Gerentes)
// - manage-materials: Gerenciar Materiais (requer can_config)
// - manage-payment-types: Tipos de Pagamento (requer can_config)
// - manager-goals: Metas de Gerentes
// - whitelist: Whitelist (requer can_config)
// - role-permissions: Permissões de Grupos (requer can_config)

const defaultRolePermissions = [
    {
        role_name: 'member',
        display_name: 'Membro',
        permissions: JSON.stringify([]),
        can_config: 0
    },
    {
        role_name: 'super_admin',
        display_name: '⚡ Super Admin',
        permissions: JSON.stringify(['all']),
        can_config: 1
    },
    {
        role_name: 'gerente_geral',
        display_name: 'Gerente Geral',
        permissions: JSON.stringify(['all']),
        can_config: 1
    },
    {
        role_name: '01',
        display_name: '01 (Primeiro Líder)',
        permissions: JSON.stringify([
            'weekly-status', 'weekly-ranking', 'members-panel', 'members-overview', 
            'pending', 'absences', 
            'members', 'members-adv', 'new-member', 
            'ranking', 'materials-stats', 'all-deliveries', 'weekly-report',
            'farm-settings', 'edit-permissions', 'goals', 'manage-materials', 'manage-payment-types', 'manager-goals', 'whitelist'
        ]),
        can_config: 1
    },
    {
        role_name: '02',
        display_name: '02 (Segundo Líder)',
        permissions: JSON.stringify([
            'weekly-status', 'weekly-ranking', 'members-panel', 'members-overview', 
            'pending', 'absences', 
            'members', 'members-adv', 'new-member', 
            'ranking', 'materials-stats', 'all-deliveries', 'weekly-report',
            'edit-permissions', 'goals', 'manager-goals'
        ]),
        can_config: 1
    },
    {
        role_name: 'gerente_farm',
        display_name: 'Gerente de Farm',
        permissions: JSON.stringify([
            'weekly-status', 'members-panel', 'members-overview', 
            'pending', 'absences', 
            'members', 'members-adv', 
            'ranking', 'materials-stats', 'all-deliveries', 'weekly-report', 'goals', 'manager-goals'
        ]),
        can_config: 0
    },
    {
        role_name: 'gerente_acao',
        display_name: 'Gerente de Ação',
        permissions: JSON.stringify([
            'weekly-status', 'members-panel', 'members-overview', 
            'members', 'members-adv', 
            'ranking', 'materials-stats', 'all-deliveries', 'weekly-report', 'goals', 'manager-goals'
        ]),
        can_config: 0
    },
    {
        role_name: 'gerente_recrutamento',
        display_name: 'Gerente de Recrutamento',
        permissions: JSON.stringify([
            'weekly-status', 'members-panel', 'members-overview', 
            'members', 'members-adv', 'new-member',
            'ranking', 'all-deliveries', 'goals', 'manager-goals'
        ]),
        can_config: 0
    },
    {
        role_name: 'gerente_encomendas',
        display_name: 'Gerente de Encomendas',
        permissions: JSON.stringify([
            'weekly-status', 'members-panel', 'members-overview', 
            'members', 'members-adv', 
            'ranking', 'materials-stats', 'all-deliveries', 'goals', 'manager-goals'
        ]),
        can_config: 0
    }
];

// Buscar lista de tabs disponíveis
router.get('/role-permissions/tabs', requireAdmin, async (req, res) => {
    res.json({ tabs: availableTabs });
});

// Buscar todos os grupos/cargos disponíveis (para usar em dropdowns)
router.get('/available-roles', requireAdmin, async (req, res) => {
    try {
        const roles = await getAllRoles();
        res.json({ roles });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Buscar todas as permissões de grupos
router.get('/role-permissions', requireAdmin, async (req, res) => {
    console.log('🔐 Rota /role-permissions acessada');
    try {
        console.log('🔐 Buscando permissões no banco...');
        let roles = await getAll('SELECT * FROM role_permissions ORDER BY id');
        console.log('🔐 Roles encontrados:', roles ? roles.length : 0);
        
        // Verificar se todos os grupos padrão existem e criar os que faltam
        const existingRoleNames = (roles || []).map(r => r.role_name);
        const missingRoles = defaultRolePermissions.filter(r => !existingRoleNames.includes(r.role_name));
        
        if (missingRoles.length > 0) {
            console.log('🔐 Criando grupos faltantes:', missingRoles.map(r => r.role_name).join(', '));
            for (const role of missingRoles) {
                try {
                    await runQuery(`
                        INSERT INTO role_permissions (role_name, display_name, permissions, can_config) 
                        VALUES (?, ?, ?, ?)
                    `, [role.role_name, role.display_name, role.permissions, role.can_config]);
                } catch (insertErr) {
                    console.log('⚠️ Grupo já existe ou erro ao criar:', role.role_name, insertErr.message);
                }
            }
            roles = await getAll('SELECT * FROM role_permissions ORDER BY id');
            console.log('✅ Total de grupos agora:', roles.length);
        }
        
        // Converter permissions de JSON string para array
        const formattedRoles = roles.map(r => ({
            ...r,
            permissions: JSON.parse(r.permissions || '[]')
        }));
        
        console.log('🔐 Enviando resposta com', formattedRoles.length, 'roles e', availableTabs.length, 'tabs');
        res.json({ roles: formattedRoles, availableTabs });
    } catch (error) {
        console.error('Erro ao buscar permissões:', error);
        res.status(500).json({ error: error.message });
    }
});

// Buscar permissões de um grupo específico (para o frontend usar no login)
router.get('/role-permissions/:roleName', requireAuth, async (req, res) => {
    try {
        const { roleName } = req.params;
        const sessionGroups = await getUserGroups(req.session.user.id);
        const isAdminUser = sessionGroups.some(g => adminRoles.includes(g));

        if (!isAdminUser && !sessionGroups.includes(roleName)) {
            return res.status(403).json({ error: 'Sem permissão para consultar este grupo' });
        }
        
        let role = await getOne('SELECT * FROM role_permissions WHERE role_name = ?', [roleName]);
        
        // Se não encontrar, criar padrão
        if (!role) {
            const defaultRole = defaultRolePermissions.find(r => r.role_name === roleName);
            if (defaultRole) {
                await runQuery(`
                    INSERT INTO role_permissions (role_name, display_name, permissions, can_config) 
                    VALUES (?, ?, ?, ?)
                `, [defaultRole.role_name, defaultRole.display_name, defaultRole.permissions, defaultRole.can_config]);
                role = await getOne('SELECT * FROM role_permissions WHERE role_name = ?', [roleName]);
            }
        }
        
        if (role) {
            res.json({
                role_name: role.role_name,
                display_name: role.display_name,
                permissions: JSON.parse(role.permissions || '[]'),
                can_config: role.can_config === 1
            });
        } else {
            // Retornar permissão padrão (acesso total) se não encontrar
            res.json({
                role_name: roleName,
                display_name: roleName,
                permissions: ['all'],
                can_config: true
            });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Atualizar permissões de um grupo
router.put('/role-permissions/:roleName', requireAdmin, async (req, res) => {
    try {
        // Verificar se o usuário atual tem permissão de config
        if (req.session.user.role !== 'super_admin' && req.session.user.role !== 'gerente_geral' && req.session.user.role !== '01') {
            return res.status(403).json({ error: 'Apenas Super Admin, Gerente Geral e 01 podem alterar permissões' });
        }
        
        const { roleName } = req.params;
        const { display_name, permissions, can_config } = req.body;
        
        // Não permitir editar permissões do super_admin (só ele mesmo pode)
        if (roleName === 'super_admin' && req.session.user.role !== 'super_admin') {
            return res.status(403).json({ error: 'Apenas o Super Admin pode alterar suas próprias permissões' });
        }
        
        const permissionsJson = JSON.stringify(permissions || []);
        
        await runQuery(`
            UPDATE role_permissions 
            SET display_name = ?, permissions = ?, can_config = ?, updated_at = CURRENT_TIMESTAMP
            WHERE role_name = ?
        `, [display_name, permissionsJson, can_config ? 1 : 0, roleName]);
        
        console.log(`🔐 Permissões do grupo ${roleName} atualizadas por ${req.session.user.name}`);
        
        res.json({ success: true, message: 'Permissões atualizadas!' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Renomear grupo (nome técnico e nome de exibição)
router.put('/role-permissions/:roleName/rename', requireAdmin, async (req, res) => {
    try {
        // Verificar se o usuário atual tem permissão de config
        if (req.session.user.role !== 'super_admin' && req.session.user.role !== 'gerente_geral' && req.session.user.role !== '01') {
            return res.status(403).json({ error: 'Apenas Super Admin, Gerente Geral e 01 podem renomear grupos' });
        }
        
        const { roleName } = req.params;
        const { new_role_name, display_name } = req.body;
        
        // Não permitir editar super_admin
        if (roleName === 'super_admin') {
            return res.status(403).json({ error: 'Não é permitido renomear o grupo Super Admin' });
        }
        
        if (!new_role_name || !display_name) {
            return res.status(400).json({ error: 'Nome técnico e nome de exibição são obrigatórios' });
        }
        
        // Verificar se o novo nome técnico já existe (se for diferente do atual)
        if (new_role_name !== roleName) {
            const existing = await getOne('SELECT role_name FROM role_permissions WHERE role_name = ?', [new_role_name]);
            if (existing) {
                return res.status(400).json({ error: 'Já existe um grupo com este nome técnico' });
            }
        }
        
        // Atualizar role_permissions
        await runQuery(`
            UPDATE role_permissions 
            SET role_name = ?, display_name = ?, updated_at = CURRENT_TIMESTAMP
            WHERE role_name = ?
        `, [new_role_name, display_name, roleName]);
        
        // Atualizar user_groups (onde os usuários estão associados aos grupos)
        await runQuery(`
            UPDATE user_groups 
            SET group_name = ?
            WHERE group_name = ?
        `, [new_role_name, roleName]);
        
        // Atualizar tabela users (role antigo - legacy, mas ainda usado em alguns lugares)
        await runQuery(`
            UPDATE users 
            SET role = ?
            WHERE role = ?
        `, [new_role_name, roleName]);
        
        console.log(`🔐 Grupo "${roleName}" renomeado para "${new_role_name}" (exibição: "${display_name}") por ${req.session.user.name}`);
        
        res.json({ success: true, message: 'Grupo renomeado com sucesso!' });
    } catch (error) {
        console.error('Erro ao renomear grupo:', error);
        res.status(500).json({ error: error.message });
    }
});

// Criar novo grupo
router.post('/role-permissions', requireAdmin, async (req, res) => {
    try {
        // Verificar se o usuário atual tem permissão de config
        if (req.session.user.role !== 'super_admin' && req.session.user.role !== 'gerente_geral' && req.session.user.role !== '01') {
            return res.status(403).json({ error: 'Apenas Super Admin, Gerente Geral e 01 podem criar grupos' });
        }
        
        const { role_name, display_name, permissions, can_config } = req.body;
        
        if (!role_name || !display_name) {
            return res.status(400).json({ error: 'Nome do grupo e nome de exibição são obrigatórios' });
        }
        
        const permissionsJson = JSON.stringify(permissions || []);
        
        await runQuery(`
            INSERT INTO role_permissions (role_name, display_name, permissions, can_config)
            VALUES (?, ?, ?, ?)
        `, [role_name, display_name, permissionsJson, can_config ? 1 : 0]);
        
        console.log(`🔐 Novo grupo ${role_name} criado por ${req.session.user.name}`);
        
        res.json({ success: true, message: 'Grupo criado!' });
    } catch (error) {
        if (error.message.includes('UNIQUE')) {
            res.status(400).json({ error: 'Já existe um grupo com esse nome' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// Deletar grupo customizado
router.delete('/role-permissions/:roleName', requireAdmin, async (req, res) => {
    try {
        // Verificar se o usuário atual tem permissão de config
        if (req.session.user.role !== 'super_admin' && req.session.user.role !== 'gerente_geral' && req.session.user.role !== '01') {
            return res.status(403).json({ error: 'Apenas Super Admin, Gerente Geral e 01 podem deletar grupos' });
        }
        
        const { roleName } = req.params;
        
        // Não pode deletar super_admin
        if (roleName === 'super_admin') {
            return res.status(403).json({ error: 'O grupo Super Admin não pode ser deletado' });
        }
        
        // Verificar se há usuários usando este grupo
        const usersWithRole = await getOne('SELECT COUNT(*) as count FROM users WHERE role = ?', [roleName]);
        if (usersWithRole && usersWithRole.count > 0) {
            return res.status(400).json({ error: `Não é possível deletar. Há ${usersWithRole.count} usuário(s) com este cargo.` });
        }
        
        // Deletar grupo
        await runQuery('DELETE FROM role_permissions WHERE role_name = ?', [roleName]);
        
        console.log(`🔐 Grupo ${roleName} deletado por ${req.session.user.name}`);
        
        res.json({ success: true, message: 'Grupo deletado com sucesso!' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Resetar permissões para os valores padrão
router.post('/role-permissions/reset', requireAdmin, async (req, res) => {
    try {
        // Verificar se o usuário atual tem permissão de config
        if (req.session.user.role !== 'super_admin' && req.session.user.role !== 'gerente_geral' && req.session.user.role !== '01') {
            return res.status(403).json({ error: 'Apenas Super Admin, Gerente Geral e 01 podem resetar permissões' });
        }
        
        // Atualizar cada grupo padrão
        for (const role of defaultRolePermissions) {
            await runQuery(`
                UPDATE role_permissions 
                SET display_name = ?, permissions = ?, can_config = ?, updated_at = CURRENT_TIMESTAMP
                WHERE role_name = ?
            `, [role.display_name, role.permissions, role.can_config, role.role_name]);
        }
        
        console.log(`🔐 Permissões resetadas para padrão por ${req.session.user.name}`);
        
        res.json({ success: true, message: 'Permissões resetadas para os valores padrão!' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== GERENCIAR MEMBROS DOS GRUPOS ====================

// Buscar membros de um grupo específico
router.get('/role-permissions/:roleName/members', requireAdmin, async (req, res) => {
    try {
        const { roleName } = req.params;
        
        // Buscar todos os usuários que pertencem a este grupo (exceto usuário root - passaporte 0)
        const members = await getAll(`
            SELECT u.id, u.name, u.passport, u.active
            FROM users u
            INNER JOIN user_groups ug ON u.id = ug.user_id
            WHERE ug.group_name = ? AND u.passport != '0'
            ORDER BY u.name
        `, [roleName]);
        
        res.json({ members });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Adicionar usuário a um grupo
router.post('/role-permissions/:roleName/members', requireAdmin, async (req, res) => {
    try {
        if (req.session.user.role !== 'super_admin' && req.session.user.role !== 'gerente_geral' && req.session.user.role !== '01') {
            return res.status(403).json({ error: 'Apenas Super Admin, Gerente Geral e 01 podem adicionar membros a grupos' });
        }
        
        const { roleName } = req.params;
        const { user_id } = req.body;
        
        if (!user_id) {
            return res.status(400).json({ error: 'ID do usuário é obrigatório' });
        }
        
        // Verificar se o usuário existe
        const user = await getOne('SELECT id, name FROM users WHERE id = ?', [user_id]);
        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }
        
        // Verificar se o grupo existe
        const group = await getOne('SELECT role_name FROM role_permissions WHERE role_name = ?', [roleName]);
        if (!group) {
            return res.status(404).json({ error: 'Grupo não encontrado' });
        }
        
        // Verificar se já está no grupo
        const existing = await getOne('SELECT id FROM user_groups WHERE user_id = ? AND group_name = ?', [user_id, roleName]);
        if (existing) {
            return res.status(400).json({ error: 'Usuário já está neste grupo' });
        }
        
        // Adicionar ao grupo
        await runQuery('INSERT INTO user_groups (user_id, group_name) VALUES (?, ?)', [user_id, roleName]);
        
        console.log(`👥 Usuário ${user.name} adicionado ao grupo ${roleName} por ${req.session.user.name}`);
        
        res.json({ success: true, message: `${user.name} adicionado ao grupo com sucesso!` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Remover usuário de um grupo
router.delete('/role-permissions/:roleName/members/:userId', requireAdmin, async (req, res) => {
    try {
        if (req.session.user.role !== 'super_admin' && req.session.user.role !== 'gerente_geral' && req.session.user.role !== '01') {
            return res.status(403).json({ error: 'Apenas Super Admin, Gerente Geral e 01 podem remover membros de grupos' });
        }
        
        const { roleName, userId } = req.params;
        
        // Verificar se o usuário está no grupo
        const membership = await getOne('SELECT id FROM user_groups WHERE user_id = ? AND group_name = ?', [userId, roleName]);
        if (!membership) {
            return res.status(404).json({ error: 'Usuário não está neste grupo' });
        }
        
        const user = await getOne('SELECT name FROM users WHERE id = ?', [userId]);
        
        // Remover do grupo
        await runQuery('DELETE FROM user_groups WHERE user_id = ? AND group_name = ?', [userId, roleName]);
        
        console.log(`👥 Usuário ${user?.name || userId} removido do grupo ${roleName} por ${req.session.user.name}`);
        
        res.json({ success: true, message: 'Usuário removido do grupo com sucesso!' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Buscar todos os usuários disponíveis para adicionar a um grupo
router.get('/users/available', requireAdmin, async (req, res) => {
    try {
        const users = await getAll('SELECT id, name, passport FROM users WHERE active = 1 ORDER BY name');
        res.json({ users });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== RECUPERAÇÃO DE SENHA ====================

// Função para garantir que a tabela password_resets existe (PostgreSQL e SQLite)
async function ensurePasswordResetsTable() {
    try {
        // Tenta criar a tabela se não existir
        // O SQL funciona tanto em PostgreSQL quanto SQLite
        const isPostgres = process.env.DATABASE_URL ? true : false;
        
        if (isPostgres) {
            await runQuery(`
                CREATE TABLE IF NOT EXISTS password_resets (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    status TEXT DEFAULT 'pending',
                    new_password TEXT,
                    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    processed_by INTEGER REFERENCES users(id),
                    processed_at TIMESTAMP
                )
            `);
        } else {
            await runQuery(`
                CREATE TABLE IF NOT EXISTS password_resets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    status TEXT DEFAULT 'pending',
                    new_password TEXT,
                    requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    processed_by INTEGER,
                    processed_at DATETIME,
                    FOREIGN KEY (user_id) REFERENCES users(id),
                    FOREIGN KEY (processed_by) REFERENCES users(id)
                )
            `);
        }
        console.log('✅ Tabela password_resets verificada/criada');
        return true;
    } catch (error) {
        console.error('Erro ao criar tabela password_resets:', error.message);
        return false;
    }
}

// Listar solicitações de recuperação de senha pendentes
router.get('/password-resets/pending', requireAdmin, async (req, res) => {
    console.log('📥 Rota /password-resets/pending acessada');
    try {
        // Garantir que a tabela existe
        await ensurePasswordResetsTable();
        
        console.log('📥 Buscando solicitações pendentes...');
        const requests = await getAll(`
            SELECT pr.*, u.name as user_name, u.passport as user_passport
            FROM password_resets pr
            JOIN users u ON pr.user_id = u.id
            WHERE pr.status = 'pending'
            ORDER BY pr.requested_at ASC
        `);
        
        console.log('📥 Encontradas', (requests || []).length, 'solicitações');
        res.json({ requests: requests || [] });
    } catch (error) {
        console.error('❌ Erro ao buscar password_resets:', error.message);
        res.json({ requests: [] });
    }
});

// Listar todas as solicitações de recuperação (histórico)
router.get('/password-resets/all', requireAdmin, async (req, res) => {
    try {
        const requests = await getAll(`
            SELECT pr.*, u.name as user_name, u.passport as user_passport, 
                   a.name as processed_by_name
            FROM password_resets pr
            JOIN users u ON pr.user_id = u.id
            LEFT JOIN users a ON pr.processed_by = a.id
            ORDER BY pr.requested_at DESC
            LIMIT 50
        `);
        
        res.json({ requests });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Aprovar recuperação - gera nova senha
router.post('/password-resets/:id/approve', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const adminId = req.session.user.id;
        
        // Buscar solicitação
        const request = await getOne(`
            SELECT pr.*, u.name as user_name, u.passport as user_passport
            FROM password_resets pr
            JOIN users u ON pr.user_id = u.id
            WHERE pr.id = ? AND pr.status = 'pending'
        `, [id]);
        
        if (!request) {
            return res.status(404).json({ error: 'Solicitação não encontrada ou já processada' });
        }
        
        // Gerar nova senha aleatória (6 caracteres)
        const newPassword = Math.random().toString(36).substring(2, 8).toUpperCase();
        const hashedPassword = bcrypt.hashSync(newPassword, 10);
        
        // Atualizar senha do usuário
        await runQuery('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, request.user_id]);
        
        // Marcar solicitação como aprovada
        await runQuery(`
            UPDATE password_resets 
            SET status = 'approved', new_password = ?, processed_by = ?, processed_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [newPassword, adminId, id]);
        
        console.log(`🔐 Senha resetada para ${request.user_name} por ${req.session.user.name}`);
        
        res.json({ 
            success: true, 
            message: `Senha resetada com sucesso!`,
            user_name: request.user_name,
            user_passport: request.user_passport,
            new_password: newPassword
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rejeitar solicitação de recuperação
router.post('/password-resets/:id/reject', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const adminId = req.session.user.id;
        
        // Verificar se existe
        const request = await getOne('SELECT * FROM password_resets WHERE id = ? AND status = ?', [id, 'pending']);
        if (!request) {
            return res.status(404).json({ error: 'Solicitação não encontrada ou já processada' });
        }
        
        // Marcar como rejeitada
        await runQuery(`
            UPDATE password_resets 
            SET status = 'rejected', processed_by = ?, processed_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [adminId, id]);
        
        console.log(`🔐 Solicitação de recuperação rejeitada por ${req.session.user.name}`);
        
        res.json({ success: true, message: 'Solicitação rejeitada' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Alterar senha de um usuário diretamente (só gerente_geral e 01)
router.post('/users/:id/reset-password', requireAdmin, async (req, res) => {
    try {
        // Verificar permissão
        if (req.session.user.role !== 'super_admin' && req.session.user.role !== 'gerente_geral' && req.session.user.role !== '01') {
            return res.status(403).json({ error: 'Apenas Super Admin, Gerente Geral e 01 podem resetar senhas diretamente' });
        }
        
        const { id } = req.params;
        const { new_password } = req.body;
        
        // Verificar se o usuário existe
        const user = await getOne('SELECT id, name, passport FROM users WHERE id = ?', [id]);
        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }
        
        // Se não forneceu senha, gera uma aleatória
        const password = new_password || Math.random().toString(36).substring(2, 8).toUpperCase();
        const hashedPassword = bcrypt.hashSync(password, 10);
        
        // Atualizar senha
        await runQuery('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, id]);
        
        console.log(`🔐 Senha de ${user.name} alterada por ${req.session.user.name}`);
        
        res.json({ 
            success: true, 
            message: 'Senha alterada com sucesso!',
            user_name: user.name,
            user_passport: user.passport,
            new_password: password
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== COMPETIÇÕES ====================

// Listar todas as competições
router.get('/competitions', requireAdmin, async (req, res) => {
    try {
        console.log('🏆 Rota /competitions acessada');
        const competitions = await getAll('SELECT * FROM competitions ORDER BY created_at DESC');
        console.log(`🏆 Competições encontradas: ${competitions.length}`);
        res.json({ competitions });
    } catch (error) {
        console.error('❌ Erro ao buscar competições:', error);
        res.status(500).json({ error: error.message });
    }
});

// Buscar competição ativa
router.get('/competitions/active', requireAdmin, async (req, res) => {
    try {
        const now = new Date().toISOString();
        const activeCompetition = await getOne(`
            SELECT * FROM competitions 
            WHERE active = 1 
            AND start_date <= ? 
            AND end_date >= ?
        `, [now, now]);
        
        res.json({ competition: activeCompetition });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Ranking da competição ativa
router.get('/competitions/ranking', requireAdmin, async (req, res) => {
    try {
        const now = new Date().toISOString();
        const activeCompetition = await getOne(`
            SELECT * FROM competitions 
            WHERE active = 1 
            AND start_date <= ? 
            AND end_date >= ?
        `, [now, now]);
        
        if (!activeCompetition) {
            return res.json({ competition: null, ranking: [] });
        }
        
        // Buscar ranking baseado em TODOS os farms (pending e approved) durante a competição
        // Query otimizada com menos JOINs
        const ranking = await getAll(`
            SELECT 
                u.id,
                u.name,
                u.passport,
                COUNT(DISTINCT d.id) as total_farms,
                COALESCE(SUM(di_sum.total_amount), 0) as total_materials
            FROM users u
            INNER JOIN deliveries d ON u.id = d.user_id
            LEFT JOIN (
                SELECT delivery_id, SUM(amount) as total_amount
                FROM delivery_items
                GROUP BY delivery_id
            ) di_sum ON di_sum.delivery_id = d.id
            WHERE (d.status = 'approved' OR d.status = 'pending')
              AND d.week_start >= ?
              AND d.week_end <= ?
            GROUP BY u.id, u.name, u.passport
            HAVING total_farms > 0
            ORDER BY total_farms DESC, total_materials DESC
            LIMIT 50
        `, [activeCompetition.start_date, activeCompetition.end_date]);
        
        res.json({ competition: activeCompetition, ranking });
    } catch (error) {
        console.error('❌ Erro ao buscar ranking:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint para obter detalhes dos farms de um usuário em uma competição
router.get('/competitions/ranking/:userId/:competitionId', requireAdmin, async (req, res) => {
    try {
        const { userId, competitionId } = req.params;
        console.log('🔍 Buscando farms do usuário', userId, 'na competição', competitionId);
        
        const competition = await getOne('SELECT * FROM competitions WHERE id = ?', [competitionId]);
        if (!competition) {
            return res.status(404).json({ error: 'Competição não encontrada' });
        }
        
        // Buscar todos os farms do usuário no período (pending e approved)
        // Limitar a 20 farms mais recentes para performance
        const farms = await getAll(`
            SELECT 
                d.id,
                d.status,
                d.approved_at,
                d.week_start,
                d.week_end,
                d.created_at
            FROM deliveries d
            WHERE d.user_id = ?
                AND (d.status = 'approved' OR d.status = 'pending')
                AND d.week_start >= ?
                AND d.week_end <= ?
            ORDER BY d.created_at DESC
            LIMIT 20
        `, [userId, competition.start_date, competition.end_date]);
        
        // Buscar materiais para nome
        const materials = await getAll('SELECT id, name FROM materials');
        const materialMap = {};
        materials.forEach(m => materialMap[m.id] = m.name);
        
        // Processar farms com detalhes
        const farmsWithDetails = await Promise.all(farms.map(async (farm) => {
            // Buscar itens do farm
            const items = await getAll(
                'SELECT material_id, amount FROM delivery_items WHERE delivery_id = ?',
                [farm.id]
            );
            
            // Buscar imagens do farm
            const screenshots = await getAll(
                'SELECT screenshot_url FROM delivery_screenshots WHERE delivery_id = ? ORDER BY id',
                [farm.id]
            );
            
            return {
                id: farm.id,
                status: farm.status,
                approved_at: farm.approved_at || farm.created_at,
                items: items.map(item => ({
                    material: materialMap[item.material_id] || 'Desconhecido',
                    amount: item.amount
                })),
                images: screenshots.map(s => s.screenshot_url),
                total_materials: items.reduce((sum, item) => sum + item.amount, 0)
            };
        }));
        
        console.log('✅ Encontrados', farmsWithDetails.length, 'farms');
        
        res.json({ farms: farmsWithDetails });
    } catch (error) {
        console.error('❌ Erro ao buscar farms:', error);
        res.status(500).json({ error: error.message });
    }
});

// Detalhes do membro no ranking
router.get('/competitions/member-details/:competitionId/:userId', requireAdmin, async (req, res) => {
    try {
        const { competitionId, userId } = req.params;
        
        // Buscar informações do usuário
        const user = await getOne('SELECT id, name, passport FROM users WHERE id = ?', [userId]);
        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }
        
        // Buscar todas as entregas aprovadas do usuário nesta competição
        const deliveries = await getAll(`
            SELECT 
                d.id,
                d.week,
                d.proof_url,
                d.approved_at,
                ce.material_count,
                GROUP_CONCAT(m.name || ' x' || di.amount, ', ') as materials_detail
            FROM competition_entries ce
            INNER JOIN deliveries d ON ce.delivery_id = d.id
            LEFT JOIN delivery_items di ON di.delivery_id = d.id
            LEFT JOIN materials m ON m.id = di.material_id
            WHERE ce.competition_id = ? AND ce.user_id = ?
            GROUP BY d.id, d.week, d.proof_url, d.approved_at, ce.material_count
            ORDER BY d.approved_at DESC
        `, [competitionId, userId]);
        
        // Calcular totais
        const totalMaterials = deliveries.reduce((sum, d) => sum + (d.material_count || 0), 0);
        const totalDeliveries = deliveries.length;
        
        res.json({ 
            user,
            deliveries,
            totalMaterials,
            totalDeliveries
        });
    } catch (error) {
        console.error('Erro ao buscar detalhes do membro:', error);
        res.status(500).json({ error: error.message });
    }
});

// Criar nova competição
router.post('/competitions', requireAdmin, async (req, res) => {
    try {
        const { name, description, start_date, end_date, prizes } = req.body;
        
        console.log('🏆 Criando competição:', { name, start_date, end_date, user: req.session.user.group });
        
        if (!name || !start_date || !end_date) {
            return res.status(400).json({ error: 'Nome, data de início e fim são obrigatórios' });
        }
        
        // Verificar se já existe uma competição ativa
        const activeCompetition = await getOne('SELECT id, name FROM competitions WHERE active = 1');
        if (activeCompetition) {
            console.log('❌ Já existe uma competição ativa:', activeCompetition.name);
            return res.status(400).json({ error: 'Já existe uma competição ativa. Desative ou delete a atual antes de criar outra.' });
        }
        
        await runQuery(`
            INSERT INTO competitions (name, description, start_date, end_date, prizes, active)
            VALUES (?, ?, ?, ?, ?, 1)
        `, [name, description || '', start_date, end_date, prizes || '']);
        
        console.log('✅ Competição criada com sucesso');
        res.json({ success: true, message: 'Competição criada com sucesso' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Editar competição
router.put('/competitions/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, start_date, end_date, prizes } = req.body;
        
        console.log('✏️ Editando competição:', { id, name, user: req.session.user.group });
        
        await runQuery(`
            UPDATE competitions 
            SET name = ?, description = ?, start_date = ?, end_date = ?, prizes = ?
            WHERE id = ?
        `, [name, description || '', start_date, end_date, prizes || '', id]);
        
        res.json({ success: true, message: 'Competição atualizada' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Ativar/Desativar competição
router.post('/competitions/:id/toggle', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        const competition = await getOne('SELECT * FROM competitions WHERE id = ?', [id]);
        if (!competition) {
            return res.status(404).json({ error: 'Competição não encontrada' });
        }
        
        const newStatus = competition.active ? 0 : 1;
        
        // Se ativando, desativar todas as outras
        if (newStatus === 1) {
            await runQuery('UPDATE competitions SET active = 0');
        }
        
        await runQuery('UPDATE competitions SET active = ? WHERE id = ?', [newStatus, id]);
        
        res.json({ success: true, message: newStatus ? 'Competição ativada' : 'Competição desativada' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Deletar competição
router.delete('/competitions/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        console.log('🗑️ Deletando competição:', { id, user: req.session.user.group });
        
        // Deletar entradas relacionadas
        await runQuery('DELETE FROM competition_entries WHERE competition_id = ?', [id]);
        
        // Deletar competição
        await runQuery('DELETE FROM competitions WHERE id = ?', [id]);
        
        res.json({ success: true, message: 'Competição deletada' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// FARM EXTRA - Pedidos de farm além da meta
// ============================================

// Buscar farms extras por delivery_id
router.get('/extra-farms/by-delivery/:deliveryId', requireAdmin, async (req, res) => {
    try {
        const { deliveryId } = req.params;
        
        const extras = await getAll(`
            SELECT 
                ef.id,
                ef.delivery_id,
                ef.user_id,
                ef.materials,
                ef.status,
                ef.created_at,
                ef.reviewed_at,
                reviewer.name as reviewed_by_name
            FROM extra_farm_requests ef
            LEFT JOIN users reviewer ON ef.reviewed_by = reviewer.id
            WHERE ef.delivery_id = ?
            ORDER BY ef.created_at DESC
        `, [deliveryId]);
        
        // Buscar screenshots e nomes dos materiais para cada extra
        for (const extra of extras) {
            // Screenshots
            try {
                const screenshots = await getAll(
                    'SELECT id, screenshot_url FROM extra_farm_screenshots WHERE extra_farm_id = ?',
                    [extra.id]
                );
                extra.screenshots = screenshots || [];
            } catch (e) {
                extra.screenshots = [];
            }
            
            // Parsear materiais e buscar nomes
            const materials = JSON.parse(extra.materials || '{}');
            const materialDetails = [];
            
            for (const [matId, amount] of Object.entries(materials)) {
                if (matId === 'dirty_money') {
                    materialDetails.push({ name: 'Dinheiro Sujo', icon: '💰', amount: `$${parseInt(amount).toLocaleString()}` });
                } else {
                    const mat = await getOne('SELECT name, icon FROM materials WHERE id = ?', [matId]);
                    if (mat) {
                        materialDetails.push({ name: mat.name, icon: mat.icon || '📦', amount: amount });
                    }
                }
            }
            extra.materialDetails = materialDetails;
        }
        
        res.json({ success: true, extras });
    } catch (error) {
        console.error('❌ Erro ao buscar farms extras por delivery:', error);
        res.status(500).json({ error: error.message });
    }
});

// Listar farms extras pendentes (IMPORTANTE: deve vir ANTES de /extra-farms/:id)
router.get('/extra-farms/pending', requireAdmin, async (req, res) => {
    try {
        console.log('🏆 Buscando farms extras pendentes...');
        const extras = await getAll(`
            SELECT 
                ef.id,
                ef.delivery_id,
                ef.user_id,
                ef.materials,
                ef.status,
                ef.created_at,
                u.name as user_name,
                u.passport as user_passport,
                d.week_start,
                d.week_end
            FROM extra_farm_requests ef
            JOIN users u ON ef.user_id = u.id
            JOIN deliveries d ON ef.delivery_id = d.id
            WHERE ef.status = 'pending'
            ORDER BY ef.created_at DESC
        `);
        
        console.log('🏆 Farms extras encontrados:', extras.length);
        
        // Buscar screenshots e nomes dos materiais para cada extra
        for (const extra of extras) {
            // Screenshots
            try {
                const screenshots = await getAll(
                    'SELECT id, screenshot_url FROM extra_farm_screenshots WHERE extra_farm_id = ?',
                    [extra.id]
                );
                extra.screenshots = screenshots || [];
            } catch (e) {
                extra.screenshots = [];
            }
            
            // Parsear materiais e buscar nomes
            const materials = JSON.parse(extra.materials || '{}');
            const materialDetails = [];
            
            for (const [matId, amount] of Object.entries(materials)) {
                if (matId === 'dirty_money') {
                    materialDetails.push({ name: 'Dinheiro Sujo', icon: '💰', amount: `$${parseInt(amount).toLocaleString()}` });
                } else {
                    const mat = await getOne('SELECT name, icon FROM materials WHERE id = ?', [matId]);
                    if (mat) {
                        materialDetails.push({ name: mat.name, icon: mat.icon, amount: amount });
                    }
                }
            }
            extra.materialDetails = materialDetails;
        }
        
        res.json({ success: true, extras });
    } catch (error) {
        console.error('❌ Erro ao listar farms extras:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Extrato de todos os farms extras (histórico completo) - DEVE VIR ANTES DE /:id
router.get('/extra-farms/extract', requireAdmin, async (req, res) => {
    try {
        const extras = await getAll(`
            SELECT 
                ef.id,
                ef.delivery_id,
                ef.user_id,
                ef.materials,
                ef.status,
                ef.created_at,
                ef.reviewed_at,
                ef.reviewed_by,
                u.name as user_name,
                u.passport as user_passport,
                d.week_start,
                d.week_end,
                reviewer.name as reviewer_name
            FROM extra_farm_requests ef
            JOIN users u ON ef.user_id = u.id
            JOIN deliveries d ON ef.delivery_id = d.id
            LEFT JOIN users reviewer ON ef.reviewed_by = reviewer.id
            ORDER BY ef.created_at DESC
        `);
        
        // Buscar screenshots e nomes dos materiais para cada extra
        for (const extra of extras) {
            // Screenshots
            try {
                const screenshots = await getAll(
                    'SELECT id, screenshot_url FROM extra_farm_screenshots WHERE extra_farm_id = ?',
                    [extra.id]
                );
                extra.screenshots = screenshots || [];
            } catch (e) {
                extra.screenshots = [];
            }
            
            // Parsear materiais e buscar nomes
            const materials = JSON.parse(extra.materials || '{}');
            const materialDetails = [];
            let totalMaterials = 0;
            
            for (const [matId, amount] of Object.entries(materials)) {
                if (matId === 'dirty_money') {
                    materialDetails.push({ name: 'Dinheiro Sujo', amount: `$${parseInt(amount).toLocaleString()}`, rawAmount: parseInt(amount) });
                } else {
                    const mat = await getOne('SELECT name, icon FROM materials WHERE id = ?', [matId]);
                    if (mat) {
                        materialDetails.push({ name: mat.name, icon: mat.icon, amount: amount, rawAmount: parseInt(amount) });
                        totalMaterials += parseInt(amount);
                    }
                }
            }
            extra.materialDetails = materialDetails;
            extra.totalMaterials = totalMaterials;
        }
        
        res.json({ success: true, extras });
    } catch (error) {
        console.error('❌ Erro ao listar extrato de farms extras:', error);
        res.status(500).json({ error: error.message });
    }
});

// Buscar um farm extra específico pelo ID
router.get('/extra-farms/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        const extra = await getOne(`
            SELECT 
                ef.id,
                ef.delivery_id,
                ef.user_id,
                ef.materials,
                ef.status,
                ef.created_at,
                ef.reviewed_at,
                u.name as user_name,
                u.passport as user_passport
            FROM extra_farm_requests ef
            JOIN users u ON ef.user_id = u.id
            WHERE ef.id = ?
        `, [id]);
        
        if (!extra) {
            return res.status(404).json({ success: false, error: 'Farm extra não encontrado' });
        }
        
        // Buscar screenshots
        const screenshots = await getAll(`
            SELECT screenshot_url FROM extra_farm_screenshots WHERE extra_farm_id = ?
        `, [id]);
        
        // Processar materiais (farm extras são salvos como objeto {material_id: amount})
        let materialDetails = [];
        try {
            const materials = JSON.parse(extra.materials || '{}');
            if (typeof materials === 'object' && !Array.isArray(materials)) {
                for (const [matId, amount] of Object.entries(materials)) {
                    if (matId === 'dirty_money') {
                        materialDetails.push({
                            id: 'dirty_money',
                            name: 'Dinheiro Sujo',
                            icon: '💰',
                            amount: `$${parseInt(amount).toLocaleString()}`
                        });
                    } else {
                        const matInfo = await getOne('SELECT name, icon FROM materials WHERE id = ?', [matId]);
                        if (matInfo) {
                            materialDetails.push({
                                id: parseInt(matId),
                                name: matInfo.name,
                                icon: matInfo.icon,
                                amount: amount
                            });
                        }
                    }
                }
            }
        } catch (e) {
            console.error('Erro ao processar materiais:', e);
        }
        
        res.json({
            success: true,
            extra: {
                ...extra,
                screenshots,
                materialDetails
            }
        });
    } catch (error) {
        console.error('Erro ao buscar farm extra:', error);
        res.status(500).json({ success: false, error: 'Erro interno' });
    }
});

// Aprovar farm extra (soma aos delivery_items e marca como aprovado)
router.post('/extra-farms/:id/approve', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const adminId = req.session.user.id;
        
        const extra = await getOne('SELECT * FROM extra_farm_requests WHERE id = ?', [id]);
        if (!extra) {
            return res.status(404).json({ error: 'Farm extra não encontrado' });
        }
        
        if (extra.status !== 'pending') {
            return res.status(400).json({ error: 'Este farm extra já foi processado' });
        }
        
        // NÃO somar materiais à delivery original
        // Os materiais do extra ficam APENAS na tabela extra_farm_requests
        // O ranking calcula separadamente: meta (delivery_items) + extra (extra_farm_requests)
        
        // Marcar extra como aprovado
        const isPostgres = process.env.DATABASE_URL ? true : false;
        if (isPostgres) {
            await runQuery(
                'UPDATE extra_farm_requests SET status = ?, reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ? WHERE id = ?',
                ['approved', adminId, id]
            );
        } else {
            await runQuery(
                "UPDATE extra_farm_requests SET status = ?, reviewed_at = datetime('now'), reviewed_by = ? WHERE id = ?",
                ['approved', adminId, id]
            );
        }
        
        console.log('✅ Farm extra aprovado:', { extraId: id, deliveryId: extra.delivery_id, adminId });
        
        res.json({ success: true, message: 'Farm extra aprovado! Materiais contam separadamente no ranking.' });
    } catch (error) {
        console.error('❌ Erro ao aprovar farm extra:', error);
        res.status(500).json({ error: error.message });
    }
});

// Rejeitar farm extra
router.post('/extra-farms/:id/reject', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const adminId = req.session.user.id;
        
        const extra = await getOne('SELECT * FROM extra_farm_requests WHERE id = ?', [id]);
        if (!extra) {
            return res.status(404).json({ error: 'Farm extra não encontrado' });
        }
        
        if (extra.status !== 'pending') {
            return res.status(400).json({ error: 'Este farm extra já foi processado' });
        }
        
        // Marcar como rejeitado
        const isPostgres = process.env.DATABASE_URL ? true : false;
        if (isPostgres) {
            await runQuery(
                'UPDATE extra_farm_requests SET status = ?, reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ? WHERE id = ?',
                ['rejected', adminId, id]
            );
        } else {
            await runQuery(
                "UPDATE extra_farm_requests SET status = ?, reviewed_at = datetime('now'), reviewed_by = ? WHERE id = ?",
                ['rejected', adminId, id]
            );
        }
        
        console.log('❌ Farm extra rejeitado:', { extraId: id, adminId });
        
        res.json({ success: true, message: 'Farm extra rejeitado' });
    } catch (error) {
        console.error('❌ Erro ao rejeitar farm extra:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========== EDIÇÃO DE ENTREGAS (ADMIN) ==========

// Buscar detalhes de uma entrega específica para edição
// Buscar detalhes agregados de todos os deliveries de uma semana (para edição)
router.get('/week-delivery-details', requireAdmin, async (req, res) => {
    try {
        const { userId, week_start, week_end } = req.query;
        
        if (!userId || !week_start || !week_end) {
            return res.status(400).json({ error: 'userId, week_start e week_end são obrigatórios' });
        }
        
        // Buscar todas as entregas da semana do membro (exceto rejeitadas - podem ter nova submissão)
        const deliveries = await getAll(`
            SELECT d.*, u.name as member_name, u.passport
            FROM deliveries d
            JOIN users u ON d.user_id = u.id
            WHERE d.user_id = ? AND d.week_start = ? AND d.week_end = ? AND d.status != 'rejected'
            ORDER BY d.created_at DESC
        `, [userId, week_start, week_end]);
        
        if (!deliveries || deliveries.length === 0) {
            return res.status(404).json({ error: 'Nenhuma entrega encontrada para essa semana' });
        }
        
        const memberInfo = deliveries[0]; // Usar o primeiro para pegar nome/passport
        const deliveryIds = deliveries.map(d => d.id);
        const deliveryGroups = await getUserGroups(userId);
        const isManager = isManagerByGroups(deliveryGroups);
        
        // Buscar TODOS os itens de todos os deliveries da semana
        let allItems = [];
        if (deliveryIds.length > 0) {
            const placeholders = deliveryIds.map(() => '?').join(',');
            allItems = await getAll(`
                SELECT di.*, d.id as delivery_id, m.name as material_name, m.icon as material_icon, m.weekly_goal, m.manager_weekly_goal
                FROM delivery_items di
                JOIN deliveries d ON di.delivery_id = d.id
                JOIN materials m ON di.material_id = m.id
                WHERE di.delivery_id IN (${placeholders})
                ORDER BY m.name ASC
            `, deliveryIds);
        }
        
        // Agregar por material (somar todos os envios)
        const materialMap = new Map();
        for (const item of allItems) {
            const key = item.material_id;
            if (!materialMap.has(key)) {
                materialMap.set(key, {
                    material_id: item.material_id,
                    material_name: item.material_name,
                    icon: item.material_icon,
                    weekly_goal: isManager ? (item.manager_weekly_goal ?? item.weekly_goal) : item.weekly_goal,
                    amount: 0,
                    deliveries: [] // Lista de deliveries que contêm esse material
                });
            }
            const mat = materialMap.get(key);
            mat.amount += item.amount;
            if (!mat.deliveries.includes(item.delivery_id)) {
                mat.deliveries.push(item.delivery_id);
            }
        }
        
        const aggregatedItems = Array.from(materialMap.values());
        
        // Buscar TODOS os screenshots de todos os deliveries
        let allScreenshots = [];
        if (deliveryIds.length > 0) {
            const placeholders = deliveryIds.map(() => '?').join(',');
            allScreenshots = await getAll(`
                SELECT ds.id, ds.screenshot_url, ds.delivery_id FROM delivery_screenshots ds
                WHERE ds.delivery_id IN (${placeholders})
                ORDER BY ds.created_at ASC
            `, deliveryIds);
        }
        
        // Buscar todos os materiais para permitir adicionar novos
        let allMaterials = await getAll('SELECT * FROM materials WHERE active = 1 ORDER BY name');
        allMaterials = allMaterials.map(mat => ({
            ...mat,
            weekly_goal: isManager ? (mat.manager_weekly_goal ?? mat.weekly_goal) : mat.weekly_goal
        }));
        
        // Determinar status agregado com prioridade correta:
        // 1. approved + !partial = completo
        // 2. approved + partial  = em progresso
        // 3. pending             = aguardando
        // 4. not_delivered       = não entregou (quando todos os deliveries têm esse status)
        let aggregatedStatus = 'not_delivered';
        let aggregatedIsPartial = false;

        const hasApprovedComplete  = deliveries.some(d => d.status === 'approved' && !d.is_partial);
        const hasApprovedPartial   = deliveries.some(d => d.status === 'approved' && d.is_partial);
        const hasPending           = deliveries.some(d => d.status === 'pending');

        if (hasApprovedComplete) {
            aggregatedStatus = 'approved';
            aggregatedIsPartial = false;
        } else if (hasApprovedPartial) {
            aggregatedStatus = 'approved';
            aggregatedIsPartial = true;
        } else if (hasPending) {
            aggregatedStatus = 'pending';
            aggregatedIsPartial = false;
        }
        // else: todos são not_delivered → mantém not_delivered
        
        res.json({ 
            success: true, 
            delivery: {
                id: deliveries[0].id, // ID do primeiro delivery (mais recente)
                user_id: userId,
                member_name: memberInfo.member_name,
                passport: memberInfo.passport,
                week_start: week_start,
                week_end: week_end,
                status: aggregatedStatus,
                is_partial: aggregatedIsPartial,
                delivery_count: deliveries.length // Número de envios na semana
            },
            items: aggregatedItems,
            screenshots: allScreenshots,
            allMaterials: allMaterials,
            deliveries: deliveries, // Lista de todos os deliveries
            isManager
        });
    } catch (error) {
        console.error('❌ Erro ao buscar detalhes da semana:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/delivery/:deliveryId/details', requireAdmin, async (req, res) => {
    try {
        const { deliveryId } = req.params;
        
        // Buscar entrega
        const delivery = await getOne(`
            SELECT d.*, u.name as member_name, u.passport
            FROM deliveries d
            JOIN users u ON d.user_id = u.id
            WHERE d.id = ?
        `, [deliveryId]);
        
        if (!delivery) {
            return res.status(404).json({ error: 'Entrega não encontrada' });
        }
        
        const deliveryGroups = await getUserGroups(delivery.user_id);
        const isManager = isManagerByGroups(deliveryGroups);

        // Buscar itens da entrega
        const items = await getAll(`
            SELECT di.*, m.name as material_name, m.icon as material_icon, m.weekly_goal, m.manager_weekly_goal
            FROM delivery_items di
            JOIN materials m ON di.material_id = m.id
            WHERE di.delivery_id = ?
        `, [deliveryId]);

        const adjustedItems = items.map(item => ({
            ...item,
            weekly_goal: isManager ? (item.manager_weekly_goal ?? item.weekly_goal) : item.weekly_goal
        }));
        
        // Buscar screenshots da entrega
        const screenshots = await getAll(`
            SELECT id, screenshot_url FROM delivery_screenshots WHERE delivery_id = ?
        `, [deliveryId]);
        
        // Buscar todos os materiais ativos para permitir adicionar novos
        let allMaterials = await getAll('SELECT * FROM materials WHERE active = 1 ORDER BY name');
        allMaterials = allMaterials.map(mat => ({
            ...mat,
            weekly_goal: isManager ? (mat.manager_weekly_goal ?? mat.weekly_goal) : mat.weekly_goal
        }));
        
        res.json({ 
            success: true, 
            delivery,
            items: adjustedItems,
            screenshots,
            allMaterials,
            isManager
        });
    } catch (error) {
        console.error('❌ Erro ao buscar detalhes da entrega:', error);
        res.status(500).json({ error: error.message });
    }
});

// Atualizar quantidade de material em uma entrega
router.put('/delivery/:deliveryId/item', requireAdmin, async (req, res) => {
    try {
        const { deliveryId } = req.params;
        const { materialId, amount } = req.body;
        const adminId = req.session.user.id;
        
        if (!materialId || amount === undefined) {
            return res.status(400).json({ error: 'Material e quantidade são obrigatórios' });
        }
        
        // Verificar se a entrega existe
        const delivery = await getOne('SELECT * FROM deliveries WHERE id = ?', [deliveryId]);
        if (!delivery) {
            return res.status(404).json({ error: 'Entrega não encontrada' });
        }
        
        const deliveryGroups = await getUserGroups(delivery.user_id);
        const isManager = isManagerByGroups(deliveryGroups);

        // Verificar se o item existe
        const existingItem = await getOne(
            'SELECT * FROM delivery_items WHERE delivery_id = ? AND material_id = ?',
            [deliveryId, materialId]
        );
        
        if (amount <= 0) {
            // Se quantidade é 0 ou negativa, deletar o item
            if (existingItem) {
                await runQuery('DELETE FROM delivery_items WHERE id = ?', [existingItem.id]);
                console.log(`🗑️ Admin #${adminId} removeu material #${materialId} da entrega #${deliveryId}`);
            }
        } else if (existingItem) {
            // Atualizar quantidade existente
            await runQuery(
                'UPDATE delivery_items SET amount = ? WHERE id = ?',
                [amount, existingItem.id]
            );
            console.log(`✏️ Admin #${adminId} alterou material #${materialId} da entrega #${deliveryId}: ${existingItem.amount} -> ${amount}`);
        } else {
            // Criar novo item
            await runQuery(
                'INSERT INTO delivery_items (delivery_id, material_id, amount) VALUES (?, ?, ?)',
                [deliveryId, materialId, amount]
            );
            console.log(`➕ Admin #${adminId} adicionou material #${materialId} à entrega #${deliveryId}: ${amount}`);
        }
        
        // Recalcular status da entrega se necessário
        const allItems = await getAll('SELECT * FROM delivery_items WHERE delivery_id = ?', [deliveryId]);
        const materials = await getAll('SELECT * FROM materials WHERE active = 1');
        
        // Verificar se bateu a meta (todos os materiais atingiram a meta)
        let metGoal = true;
        for (const mat of materials) {
            const item = allItems.find(i => i.material_id === mat.id);
            const goal = isManager ? (mat.manager_weekly_goal ?? mat.weekly_goal) : mat.weekly_goal;
            if (!item || item.amount < goal) {
                metGoal = false;
                break;
            }
        }
        
        // Atualizar status se estava pending/in_progress
        if (delivery.status === 'pending' || delivery.status === 'in_progress') {
            const newStatus = metGoal ? 'pending' : 'in_progress';
            await runQuery('UPDATE deliveries SET status = ? WHERE id = ?', [newStatus, deliveryId]);
        }
        
        res.json({ 
            success: true, 
            message: 'Quantidade atualizada com sucesso'
        });
    } catch (error) {
        console.error('❌ Erro ao atualizar item da entrega:', error);
        res.status(500).json({ error: error.message });
    }
});

// Atualizar status de TODAS as entregas de um membro numa semana
router.put('/delivery/batch-status', requireAdmin, async (req, res) => {
    try {
        const { userId, week_start, week_end, status } = req.body;
        const adminId = req.session.user.id;

        const validStatuses = ['approved', 'pending', 'in_progress', 'not_delivered'];
        if (!status || !validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Status inválido' });
        }
        if (!userId || !week_start || !week_end) {
            return res.status(400).json({ error: 'userId, week_start e week_end são obrigatórios' });
        }

        // is_partial baseado no status
        let isPartial;
        if (status === 'approved')         isPartial = false;
        else if (status === 'in_progress') isPartial = true;  // em progresso = approved + partial
        else                               isPartial = false;

        // Status real a gravar: "em progresso" vira approved+partial
        const realStatus = status === 'in_progress' ? 'approved' : status;

        // Buscar TODAS as entregas da semana (sem filtrar por status atual)
        const deliveries = await getAll(
            `SELECT id FROM deliveries WHERE user_id = ? AND week_start = ? AND week_end = ?`,
            [userId, week_start, week_end]
        );

        if (!deliveries.length) {
            return res.status(404).json({ error: 'Nenhuma entrega encontrada para essa semana' });
        }

        for (const d of deliveries) {
            // Só gravar approved_by/approved_at quando de fato aprovando
            if (realStatus === 'approved') {
                await runQuery(
                    'UPDATE deliveries SET status = ?, is_partial = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?',
                    [realStatus, isPartial, adminId, d.id]
                );
            } else {
                await runQuery(
                    'UPDATE deliveries SET status = ?, is_partial = ? WHERE id = ?',
                    [realStatus, isPartial, d.id]
                );
            }
        }

        console.log(`✏️ Admin #${adminId} alterou status em lote (${deliveries.length} entregas) usuário #${userId} semana ${week_start}: -> ${realStatus} (partial=${isPartial})`);
        res.json({ success: true, message: `Status atualizado em ${deliveries.length} entrega(s)` });
    } catch (error) {
        console.error('❌ Erro ao atualizar status em lote:', error);
        res.status(500).json({ error: error.message });
    }
});

// Alterar range de semana de TODAS as entregas de um membro
router.put('/delivery/week-range', requireAdmin, async (req, res) => {
    try {
        const { userId, old_week_start, old_week_end, new_week_start, new_week_end } = req.body;
        const adminId = req.session.user.id;

        if (!userId || !old_week_start || !old_week_end || !new_week_start || !new_week_end) {
            return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
        }

        // Validar formato de data YYYY-MM-DD
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(new_week_start) || !dateRegex.test(new_week_end)) {
            return res.status(400).json({ error: 'Formato de data inválido (use YYYY-MM-DD)' });
        }

        if (new_week_start >= new_week_end) {
            return res.status(400).json({ error: 'Data inicial deve ser anterior à data final' });
        }

        const deliveries = await getAll(
            `SELECT id FROM deliveries WHERE user_id = ? AND week_start = ? AND week_end = ?`,
            [userId, old_week_start, old_week_end]
        );

        if (!deliveries.length) {
            return res.status(404).json({ error: 'Nenhuma entrega encontrada para essa semana' });
        }

        for (const d of deliveries) {
            await runQuery(
                'UPDATE deliveries SET week_start = ?, week_end = ? WHERE id = ?',
                [new_week_start, new_week_end, d.id]
            );
        }

        console.log(`📅 Admin #${adminId} moveu ${deliveries.length} entrega(s) do usuário #${userId}: ${old_week_start}~${old_week_end} -> ${new_week_start}~${new_week_end}`);
        res.json({ success: true, message: `${deliveries.length} entrega(s) movida(s) para a nova semana` });
    } catch (error) {
        console.error('❌ Erro ao alterar range de semana:', error);
        res.status(500).json({ error: error.message });
    }
});

// Atualizar status de uma entrega
router.put('/delivery/:deliveryId/status', requireAdmin, async (req, res) => {
    try {
        const { deliveryId } = req.params;
        const { status } = req.body;
        const adminId = req.session.user.id;
        
        const validStatuses = ['approved', 'pending', 'in_progress', 'not_delivered'];
        if (!status || !validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Status inválido' });
        }
        
        // Verificar se a entrega existe
        const delivery = await getOne('SELECT * FROM deliveries WHERE id = ?', [deliveryId]);
        if (!delivery) {
            return res.status(404).json({ error: 'Entrega não encontrada' });
        }
        
        let isPartial = delivery.is_partial ? 1 : 0;
        if (status === 'approved') {
            isPartial = 0;
        } else if (status === 'in_progress') {
            isPartial = 1;
        } else if (status === 'pending') {
            isPartial = 0;
        } else if (status === 'not_delivered') {
            isPartial = 0;
        }

        await runQuery(
            'UPDATE deliveries SET status = ?, is_partial = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?',
            [status, isPartial, adminId, deliveryId]
        );
        
        console.log(`✏️ Admin #${adminId} alterou status da entrega #${deliveryId}: ${delivery.status} -> ${status}`);
        
        res.json({ 
            success: true, 
            message: 'Status atualizado com sucesso'
        });
    } catch (error) {
        console.error('❌ Erro ao atualizar status da entrega:', error);
        res.status(500).json({ error: error.message });
    }
});

// Upload de screenshots para uma entrega (admin)
router.post('/delivery/:deliveryId/screenshots', requireAdmin, (req, res) => {
    upload(req, res, async (err) => {
        if (err) {
            console.error('❌ Erro no upload:', err);
            return res.status(400).json({ error: err.message });
        }
        
        try {
            const { deliveryId } = req.params;
            const adminId = req.session.user.id;
            
            // Verificar se a entrega existe
            const delivery = await getOne('SELECT * FROM deliveries WHERE id = ?', [deliveryId]);
            if (!delivery) {
                return res.status(404).json({ error: 'Entrega não encontrada' });
            }
            
            if (!req.files || req.files.length === 0) {
                return res.status(400).json({ error: 'Nenhuma imagem enviada' });
            }
            
            const fs = require('fs');
            const uploadDir = path.join(__dirname, '..', 'uploads');
            
            // Criar diretório se não existir
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }
            
            const savedScreenshots = [];
            
            for (const file of req.files) {
                const filename = `${uuidv4()}${path.extname(file.originalname)}`;
                const filepath = path.join(uploadDir, filename);
                
                // Salvar arquivo no disco
                fs.writeFileSync(filepath, file.buffer);
                
                const screenshotUrl = '/uploads/' + filename;
                
                // Salvar no banco
                await runQuery(
                    'INSERT INTO delivery_screenshots (delivery_id, screenshot_url) VALUES (?, ?)',
                    [deliveryId, screenshotUrl]
                );
                
                savedScreenshots.push(screenshotUrl);
            }
            
            console.log(`📷 Admin #${adminId} adicionou ${savedScreenshots.length} screenshot(s) à entrega #${deliveryId}`);
            
            res.json({ 
                success: true, 
                message: `${savedScreenshots.length} screenshot(s) adicionado(s)`,
                screenshots: savedScreenshots
            });
        } catch (error) {
            console.error('❌ Erro ao salvar screenshots:', error);
            res.status(500).json({ error: error.message });
        }
    });
});

// Remover screenshot de uma entrega (admin)
router.delete('/delivery/:deliveryId/screenshot/:screenshotId', requireAdmin, async (req, res) => {
    try {
        const { deliveryId, screenshotId } = req.params;
        const adminId = req.session.user.id;
        
        // Verificar se o screenshot existe e pertence à entrega
        const screenshot = await getOne(
            'SELECT * FROM delivery_screenshots WHERE id = ? AND delivery_id = ?',
            [screenshotId, deliveryId]
        );
        
        if (!screenshot) {
            return res.status(404).json({ error: 'Screenshot não encontrado' });
        }
        
        // Deletar arquivo físico (opcional, pode falhar se não existir)
        try {
            const fs = require('fs');
            const filepath = path.join(__dirname, '..', screenshot.screenshot_url);
            if (fs.existsSync(filepath)) {
                fs.unlinkSync(filepath);
            }
        } catch (e) {
            console.log('⚠️ Não foi possível deletar arquivo físico:', e.message);
        }
        
        // Deletar do banco
        await runQuery('DELETE FROM delivery_screenshots WHERE id = ?', [screenshotId]);
        
        console.log(`🗑️ Admin #${adminId} removeu screenshot #${screenshotId} da entrega #${deliveryId}`);
        
        res.json({ 
            success: true, 
            message: 'Screenshot removido com sucesso'
        });
    } catch (error) {
        console.error('❌ Erro ao remover screenshot:', error);
        res.status(500).json({ error: error.message });
    }
});

// Criar entrega manualmente para um membro
router.post('/delivery/create-manual', requireAdmin, async (req, res) => {
    try {
        const { userId, weekStart, weekEnd, items, status } = req.body;
        const adminId = req.session.user.id;
        
        if (!userId || !weekStart || !weekEnd || !items || items.length === 0) {
            return res.status(400).json({ error: 'Dados incompletos' });
        }
        
        // Verificar se já existe entrega para essa semana
        const existing = await getOne(
            'SELECT id FROM deliveries WHERE user_id = ? AND week_start = ? AND week_end = ?',
            [userId, weekStart, weekEnd]
        );

        const isSuperAdmin = req.session.user?.passport === '6999' ||
            req.session.user?.role === 'super_admin' ||
            (req.session.user?.groups || []).includes('super_admin');

        if (existing && !isSuperAdmin) {
            return res.status(400).json({ error: 'Já existe uma entrega para essa semana. Use a edição.' });
        }

        if (existing && isSuperAdmin) {
            const deliveryId = existing.id;

            await runQuery(
                'UPDATE deliveries SET description = ?, status = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?',
                ['Atualizado manualmente pelo super admin', status || 'approved', adminId, deliveryId]
            );

            await runQuery('DELETE FROM delivery_items WHERE delivery_id = ?', [deliveryId]);

            for (const item of items) {
                if (item.amount > 0) {
                    await runQuery(
                        'INSERT INTO delivery_items (delivery_id, material_id, amount) VALUES (?, ?, ?)',
                        [deliveryId, item.materialId, item.amount]
                    );
                }
            }

            console.log(`📝 Super Admin #${adminId} atualizou entrega manual #${deliveryId} para usuário #${userId}`);

            return res.json({
                success: true,
                message: 'Entrega atualizada com sucesso',
                deliveryId
            });
        }
        
        // Criar entrega
        const result = await runQuery(`
            INSERT INTO deliveries (user_id, week_start, week_end, description, status, approved_by, approved_at)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [userId, weekStart, weekEnd, 'Criado manualmente pelo admin', status || 'approved', adminId]);
        
        const deliveryId = result.lastID;
        
        // Inserir itens
        for (const item of items) {
            if (item.amount > 0) {
                await runQuery(
                    'INSERT INTO delivery_items (delivery_id, material_id, amount) VALUES (?, ?, ?)',
                    [deliveryId, item.materialId, item.amount]
                );
            }
        }
        
        console.log(`📝 Admin #${adminId} criou entrega manual #${deliveryId} para usuário #${userId}`);
        
        res.json({ 
            success: true, 
            message: 'Entrega criada com sucesso',
            deliveryId
        });
    } catch (error) {
        console.error('❌ Erro ao criar entrega manual:', error);
        res.status(500).json({ error: error.message });
    }
});

// Buscar entregas de um membro para edição
router.get('/member/:memberId/deliveries', requireAdmin, async (req, res) => {
    try {
        const { memberId } = req.params;
        
        // Buscar membro
        const member = await getOne('SELECT id, name, passport FROM users WHERE id = ?', [memberId]);
        if (!member) {
            return res.status(404).json({ error: 'Membro não encontrado' });
        }
        
        // Buscar entregas
        const deliveries = await getAll(`
            SELECT d.*, 
                   (SELECT GROUP_CONCAT(m.name || ': ' || di.amount) 
                    FROM delivery_items di 
                    JOIN materials m ON di.material_id = m.id 
                    WHERE di.delivery_id = d.id) as items_summary
            FROM deliveries d
            WHERE d.user_id = ?
            ORDER BY d.week_start DESC, d.created_at DESC
        `, [memberId]);
        
        // Buscar materiais ativos
        const materials = await getAll('SELECT * FROM materials WHERE active = 1 ORDER BY name');
        
        res.json({ 
            success: true, 
            member,
            deliveries,
            materials
        });
    } catch (error) {
        console.error('❌ Erro ao buscar entregas do membro:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== OBSERVAÇÕES DOS MEMBROS ====================

// Buscar observações de um membro em uma semana
router.get('/member/:userId/observations', requireAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { week_start, week_end } = req.query;
        
        const observations = await getAll(`
            SELECT mo.*, u.name as created_by_name
            FROM member_observations mo
            JOIN users u ON mo.created_by = u.id
            WHERE mo.user_id = ? AND mo.week_start = ? AND mo.week_end = ?
            ORDER BY mo.created_at DESC
        `, [userId, week_start, week_end]);
        
        res.json({ success: true, observations });
    } catch (error) {
        console.error('❌ Erro ao buscar observações:', error);
        res.status(500).json({ error: error.message });
    }
});

// Adicionar observação a um membro
router.post('/member/:userId/observations', requireAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { week_start, week_end, observation } = req.body;
        const createdBy = req.session.user.id;
        
        if (!observation || !observation.trim()) {
            return res.status(400).json({ error: 'Observação não pode estar vazia' });
        }
        
        await runQuery(`
            INSERT INTO member_observations (user_id, week_start, week_end, observation, created_by)
            VALUES (?, ?, ?, ?, ?)
        `, [userId, week_start, week_end, observation.trim(), createdBy]);
        
        res.json({ success: true, message: 'Observação adicionada com sucesso!' });
    } catch (error) {
        console.error('❌ Erro ao adicionar observação:', error);
        res.status(500).json({ error: error.message });
    }
});

// Deletar observação
router.delete('/observations/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        await runQuery('DELETE FROM member_observations WHERE id = ?', [id]);
        
        res.json({ success: true, message: 'Observação removida!' });
    } catch (error) {
        console.error('❌ Erro ao remover observação:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
