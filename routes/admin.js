const express = require('express');
const bcrypt = require('bcryptjs');
const { runQuery, getOne, getAll, getCurrentWeek } = require('../database/db');

const router = express.Router();

// Cargos administrativos (qualquer um pode aprovar)
const adminRoles = ['01', '02', 'gerente_farm', 'gerente_acao', 'gerente_recrutamento', 'gerente_encomendas', 'gerente_geral'];

// Nomes amigáveis dos cargos
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

// Helper para calcular semana com offset
const getWeekWithOffset = (offset = 0) => {
    const now = new Date();
    now.setDate(now.getDate() + (offset * 7));
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    monday.setHours(0, 0, 0, 0);
    
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    
    return {
        start: monday.toISOString().split('T')[0],
        end: sunday.toISOString().split('T')[0],
        label: `${monday.toLocaleDateString('pt-BR')} até ${sunday.toLocaleDateString('pt-BR')}`
    };
};

// Middleware para verificar se é cargo administrativo
const requireAdmin = (req, res, next) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Não autenticado' });
    }
    if (!adminRoles.includes(req.session.user.role)) {
        return res.status(403).json({ error: 'Acesso negado' });
    }
    next();
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

// Aprovar entrega
router.post('/deliveries/:id/approve', requireAdmin, async (req, res) => {
    try {
        const deliveryId = req.params.id;
        const userId = req.session.user.id;
        
        // Verificar se a entrega existe e está pendente
        const delivery = await getOne('SELECT * FROM deliveries WHERE id = ? AND status = ?', [deliveryId, 'pending']);
        if (!delivery) {
            return res.status(404).json({ error: 'Entrega não encontrada ou já processada' });
        }
        
        // Aprovar diretamente
        await runQuery(
            'UPDATE deliveries SET status = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?',
            ['approved', userId, deliveryId]
        );
        
        res.json({ success: true, message: 'Entrega aprovada! ✅' });
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
        
        // Verificar se é do tipo dinheiro sujo
        if (delivery.payment_type !== 'dirty_money') {
            return res.status(400).json({ error: 'Esta entrega não é do tipo dinheiro sujo' });
        }
        
        const amount = parseInt(dirty_money_amount) || 0;
        const isComplete = amount >= 50000; // Meta de R$ 50.000
        
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
        
        // Verificar se a entrega existe e está pendente
        const delivery = await getOne('SELECT * FROM deliveries WHERE id = ? AND status = ?', [deliveryId, 'pending']);
        if (!delivery) {
            return res.status(404).json({ error: 'Entrega não encontrada ou já processada' });
        }
        
        // Deletar screenshots da entrega
        await runQuery('DELETE FROM delivery_screenshots WHERE delivery_id = ?', [deliveryId]);
        
        // Deletar itens da entrega
        await runQuery('DELETE FROM delivery_items WHERE delivery_id = ?', [deliveryId]);
        
        // Deletar a entrega - permite o membro refazer
        await runQuery('DELETE FROM deliveries WHERE id = ?', [deliveryId]);
        
        res.json({ success: true, message: 'Entrega rejeitada - membro pode refazer o farm' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Listar todos os membros
router.get('/members', requireAdmin, async (req, res) => {
    try {
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
            ORDER BY CAST(u.passport AS INTEGER) ASC
        `);
        
        res.json({ members, roleNames });
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
        
        // Validar cargo
        const validRoles = ['member', '01', '02', 'gerente_farm', 'gerente_acao', 'gerente_recrutamento', 'gerente_encomendas', 'gerente_geral'];
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
        
        res.json({ success: true, message: `Cargo alterado para ${roleNames[role] || role}` });
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
        
        // Validar cargo se fornecido
        const validRoles = ['member', '01', '02', 'gerente_farm', 'gerente_acao', 'gerente_recrutamento', 'gerente_encomendas', 'gerente_geral'];
        if (role && !validRoles.includes(role)) {
            return res.status(400).json({ error: 'Cargo inválido' });
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
        
        // Não pode deletar o passaporte 6999
        if (member.passport === '6999') {
            return res.status(400).json({ error: 'Não é possível deletar este usuário' });
        }
        
        // Deletar entregas e itens relacionados
        const deliveries = await getAll('SELECT id FROM deliveries WHERE user_id = ?', [memberId]);
        for (const delivery of deliveries) {
            await runQuery('DELETE FROM delivery_items WHERE delivery_id = ?', [delivery.id]);
        }
        await runQuery('DELETE FROM deliveries WHERE user_id = ?', [memberId]);
        await runQuery('DELETE FROM justifications WHERE user_id = ?', [memberId]);
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
        const materials = await getAll('SELECT * FROM materials ORDER BY name');
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
        
        // Para cada membro pendente, buscar detalhes dos farms
        for (let member of pendingMembers) {
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
            WHERE u.active = 1 AND u.role = 'member'
            AND EXISTS (SELECT 1 FROM deliveries WHERE user_id = u.id AND status = 'approved')
            ORDER BY total_materials DESC
        `);
        
        res.json({ pendingMembers, completedMembers, roleNames });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/materials', requireAdmin, async (req, res) => {
    try {
        const { name, icon, weekly_goal } = req.body;
        
        if (!name) {
            return res.status(400).json({ error: 'Nome do material é obrigatório' });
        }
        
        const goal = parseInt(weekly_goal) || 700;
        
        await runQuery(
            'INSERT INTO materials (name, icon, weekly_goal) VALUES (?, ?, ?)',
            [name, icon || '📦', goal]
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
        const { name, icon, weekly_goal } = req.body;
        
        const material = await getOne('SELECT * FROM materials WHERE id = ?', [materialId]);
        if (!material) {
            return res.status(404).json({ error: 'Material não encontrado' });
        }
        
        const newName = name || material.name;
        const newIcon = icon || material.icon;
        const newGoal = weekly_goal !== undefined ? parseInt(weekly_goal) : material.weekly_goal;
        
        await runQuery(
            'UPDATE materials SET name = ?, icon = ?, weekly_goal = ? WHERE id = ?',
            [newName, newIcon, newGoal, materialId]
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
        
        res.json({ success: true, message: newStatus ? 'Material ativado' : 'Material desativado' });
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
        const { name, icon, weekly_goal } = req.body;
        
        if (!name) {
            return res.status(400).json({ error: 'Nome do tipo de pagamento é obrigatório' });
        }
        
        const goal = parseInt(weekly_goal) || 50000;
        
        await runQuery(
            'INSERT INTO payment_types (name, icon, weekly_goal) VALUES (?, ?, ?)',
            [name, icon || '💰', goal]
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
        const { name, icon, weekly_goal } = req.body;
        
        const paymentType = await getOne('SELECT * FROM payment_types WHERE id = ?', [id]);
        if (!paymentType) {
            return res.status(404).json({ error: 'Tipo de pagamento não encontrado' });
        }
        
        const newName = name || paymentType.name;
        const newIcon = icon || paymentType.icon;
        const newGoal = weekly_goal !== undefined ? parseInt(weekly_goal) : paymentType.weekly_goal;
        
        await runQuery(
            'UPDATE payment_types SET name = ?, icon = ?, weekly_goal = ? WHERE id = ?',
            [newName, newIcon, newGoal, id]
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
        
        const validKeys = ['farm_materials_enabled', 'farm_payment_enabled', 'farm_payment_mode'];
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

// Status semanal dos membros
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
        
        // Buscar membros na whitelist
        const whitelist = await getAll(`SELECT user_id FROM farm_whitelist`);
        const whitelistIds = whitelist.map(w => w.user_id);
        
        // Todos os membros ativos (NÃO filtramos whitelist aqui - será tratado individualmente)
        const allMembers = await getAll(`
            SELECT id, name, passport, role FROM users 
            WHERE active = 1
            ORDER BY name
        `);
        
        // Não filtramos mais membros da whitelist aqui
        // Se estão na whitelist MAS entregaram, devem aparecer no relatório
        const membersToCheck = allMembers;
        
        const completed = [];      // Farm aprovado COMPLETO (700+ de cada)
        const partial = [];        // Farm EM PROGRESSO (ainda não completou 700 de cada)
        const pendingApproval = []; // Farm COMPLETO enviado, aguardando aprovação
        const notDelivered = [];   // Não enviou nada
        const justified = [];      // Justificativa aprovada
        
        for (const member of membersToCheck) {
            // Verificar se tem farm na semana
            const delivery = await getOne(`
                SELECT d.*, d.created_at as delivered_at, d.is_partial, d.payment_type, d.dirty_money_amount
                FROM deliveries d
                WHERE d.user_id = ? AND d.week_start = ? AND d.week_end = ?
            `, [member.id, weekStart, weekEnd]);
            
            // Buscar itens do delivery se existir
            let deliveryItems = [];
            let deliveryScreenshots = [];
            if (delivery) {
                deliveryItems = await getAll(`
                    SELECT di.amount, m.name as material_name, m.icon as material_icon, m.weekly_goal
                    FROM delivery_items di
                    JOIN materials m ON di.material_id = m.id
                    WHERE di.delivery_id = ?
                `, [delivery.id]);
                
                // Buscar screenshots
                deliveryScreenshots = await getAll(`
                    SELECT screenshot_url FROM delivery_screenshots WHERE delivery_id = ?
                `, [delivery.id]);
            }
            
            // Verificar se tem justificativa
            const justification = await getOne(`
                SELECT * FROM justifications 
                WHERE user_id = ? AND week_start = ? AND week_end = ?
            `, [member.id, weekStart, weekEnd]);
            
            if (delivery && delivery.status === 'approved' && !delivery.is_partial) {
                // Farm COMPLETO aprovado
                const isLatePayment = delivery.description && delivery.description.includes('[META ATRASADA]');
                completed.push({
                    ...member,
                    delivery_id: delivery.id,
                    delivered_at: delivery.delivered_at,
                    screenshot_url: delivery.screenshot_url,
                    screenshots: deliveryScreenshots,
                    description: delivery.description,
                    items: deliveryItems,
                    is_partial: false,
                    payment_type: delivery.payment_type || 'material',
                    dirty_money_amount: delivery.dirty_money_amount || 0,
                    is_late_payment: isLatePayment
                });
            } else if (delivery && delivery.status === 'pending' && !delivery.is_partial) {
                // Farm COMPLETO aguardando aprovação
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
                    is_late_payment: isLatePayment
                });
            } else if (delivery && (delivery.is_partial || delivery.status === 'in_progress')) {
                // Farm EM PROGRESSO (parcial, ainda completando)
                // Verificar se já tem ADV aplicada nessa semana
                const hasAdvThisWeek = await getOne(`
                    SELECT id FROM warnings 
                    WHERE user_id = ? AND week_start = ? AND week_end = ?
                `, [member.id, weekStart, weekEnd]);
                
                partial.push({
                    ...member,
                    delivery_id: delivery.id,
                    delivered_at: delivery.delivered_at,
                    screenshot_url: delivery.screenshot_url,
                    screenshots: deliveryScreenshots,
                    description: delivery.description,
                    items: deliveryItems,
                    is_partial: true,
                    status: delivery.status,
                    payment_type: delivery.payment_type || 'material',
                    dirty_money_amount: delivery.dirty_money_amount || 0,
                    has_adv_applied: !!hasAdvThisWeek
                });
            } else if (justification && justification.status === 'approved') {
                // Justificativa aprovada
                justified.push({
                    ...member,
                    justification_id: justification.id,
                    justification_reason: justification.reason,
                    justification_approved_at: justification.updated_at
                });
            } else if (justification && justification.status === 'pending') {
                // Tem justificativa pendente - conta como pendente
                pendingApproval.push({
                    ...member,
                    has_justification_pending: true,
                    justification_id: justification.id,
                    justification_reason: justification.reason,
                    justification_created_at: justification.created_at
                });
            } else if (whitelistIds.includes(member.id)) {
                // Está na whitelist e não entregou - não conta como "não entregou"
                // Simplesmente não adiciona em nenhuma lista (isento)
            } else {
                // Não enviou nada - verificar se já tem ADV aplicada nessa semana
                const hasAdvThisWeek = await getOne(`
                    SELECT id FROM warnings 
                    WHERE user_id = ? AND week_start = ? AND week_end = ?
                `, [member.id, weekStart, weekEnd]);
                
                notDelivered.push({
                    ...member,
                    has_adv_applied: !!hasAdvThisWeek
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
        
        // Buscar membros na whitelist
        const whitelist = await getAll(`SELECT user_id FROM farm_whitelist`);
        const whitelistIds = whitelist.map(w => w.user_id);
        
        // Todos os membros ativos
        const allMembers = await getAll(`
            SELECT id, name, passport, role FROM users 
            WHERE active = 1
            ORDER BY name
        `);
        
        const members = [];
        
        for (const member of allMembers) {
            // Verificar se tem farm na semana (ANTES de verificar whitelist)
            const delivery = await getOne(`
                SELECT id, status, created_at, payment_type, payment_type_id, dirty_money_amount, description FROM deliveries 
                WHERE user_id = ? AND week_start = ? AND week_end = ?
            `, [member.id, weekStart, weekEnd]);
            
            // Se está na whitelist E não tem entrega, pula
            // Se está na whitelist MAS tem entrega, deve aparecer no relatório
            if (whitelistIds.includes(member.id) && !delivery) continue;
            
            // Verificar se tem justificativa na semana
            const justification = await getOne(`
                SELECT id, status, reason FROM justifications 
                WHERE user_id = ? AND week_start = ? AND week_end = ?
            `, [member.id, weekStart, weekEnd]);
            
            // Contar total de ADVs
            const warningsCount = await getOne(`
                SELECT COUNT(*) as total FROM warnings WHERE user_id = ?
            `, [member.id]);
            
            // Determinar status do farm
            let farmStatus = 'not_delivered';
            let deliveryId = null;
            let deliveredAt = null;
            let isLatePayment = false;
            if (delivery) {
                farmStatus = delivery.status; // 'approved', 'pending', 'rejected'
                deliveryId = delivery.id;
                deliveredAt = delivery.created_at;
                isLatePayment = delivery.description && delivery.description.includes('[META ATRASADA]');
            } else if (justification) {
                // Se aprovada = justificada, se pendente = aguardando, se rejeitada = não entregue
                if (justification.status === 'approved') {
                    farmStatus = 'justified';
                } else if (justification.status === 'pending') {
                    farmStatus = 'justification_pending';
                }
                // Se rejeitada, mantém 'not_delivered'
            }
            
            // Buscar nome do tipo de pagamento se existir
            let paymentTypeName = null;
            let paymentTypeIcon = null;
            if (delivery && delivery.payment_type_id) {
                const paymentType = await getOne(`SELECT name, icon FROM payment_types WHERE id = ?`, [delivery.payment_type_id]);
                if (paymentType) {
                    paymentTypeName = paymentType.name;
                    paymentTypeIcon = paymentType.icon;
                }
            }
            
            members.push({
                ...member,
                farmStatus,
                deliveryId,
                deliveredAt,
                warningsCount: warningsCount.total,
                paymentType: delivery ? (delivery.payment_type || 'material') : null,
                paymentTypeName,
                paymentTypeIcon,
                dirtyMoneyAmount: delivery ? (delivery.dirty_money_amount || 0) : 0,
                isLatePayment: isLatePayment
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
        
        // Buscar últimas 10 semanas de farm (deliveries)
        const deliveries = await getAll(`
            SELECT d.*, u.name as approved_by_name
            FROM deliveries d
            LEFT JOIN users u ON d.approved_by = u.id
            WHERE d.user_id = ?
            ORDER BY d.week_start DESC
            LIMIT 10
        `, [memberId]);
        
        // Para cada delivery, buscar os itens
        for (let delivery of deliveries) {
            delivery.items = await getAll(`
                SELECT di.amount, m.name as material_name, m.icon as material_icon, m.weekly_goal
                FROM delivery_items di
                JOIN materials m ON di.material_id = m.id
                WHERE di.delivery_id = ?
            `, [delivery.id]);
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
            SELECT COUNT(*) as count FROM deliveries WHERE user_id = ? AND status = 'rejected'
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

// Remover advertência (somente passaporte 6999)
router.delete('/warnings/:id', requireAdmin, async (req, res) => {
    try {
        if (req.session.user.passport !== '6999') {
            return res.status(403).json({ error: 'Apenas o administrador principal pode remover advertências' });
        }
        
        const warningId = req.params.id;
        
        const warning = await getOne('SELECT * FROM warnings WHERE id = ?', [warningId]);
        if (!warning) {
            return res.status(404).json({ error: 'Advertência não encontrada' });
        }
        
        await runQuery('DELETE FROM warnings WHERE id = ?', [warningId]);
        
        res.json({ success: true, message: 'Advertência removida' });
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

// Buscar todos os membros com contagem de ADVs
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
            WHERE u.active = 1
            ORDER BY adv_count DESC, u.name ASC
        `);
        
        res.json({ success: true, members });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========== PERMISSÕES DE EDIÇÃO ==========

// Listar membros com status de permissão de edição
router.get('/edit-permissions', requireAdmin, async (req, res) => {
    try {
        console.log('🔄 Iniciando busca de permissões de edição...');
        
        // Primeiro buscar só os membros (sem JOIN para debug)
        const members = await getAll(`
            SELECT id, name, passport, role
            FROM users
            WHERE active = 1 AND role != 'gerente_geral'
            ORDER BY name ASC
        `);
        
        console.log('📋 Membros encontrados:', members.length);
        
        // Buscar permissões separadamente
        let permissions = [];
        try {
            permissions = await getAll(`SELECT user_id FROM edit_permissions`);
            console.log('✏️ Permissões encontradas:', permissions.length);
        } catch (e) {
            console.log('⚠️ Tabela edit_permissions pode não existir ainda:', e.message);
        }
        
        const permissionUserIds = new Set(permissions.map(p => p.user_id));
        
        res.json({ 
            success: true, 
            members: members.map(m => ({
                ...m,
                hasPermission: permissionUserIds.has(m.id)
            }))
        });
    } catch (error) {
        console.error('❌ Erro ao carregar permissões:', error);
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
        
        await runQuery(`
            INSERT INTO edit_permissions (user_id, reason, granted_by)
            VALUES (?, ?, ?)
        `, [user_id, reason || 'Correção de valores', grantedBy]);
        
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
    { id: 'members-panel', name: 'Painel de Membros', section: 'Dashboard', icon: '👥' },
    { id: 'members-overview', name: 'Visão Geral', section: 'Dashboard', icon: '👁️' },
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
    { id: 'edit-permissions', name: 'Liberar Edição', section: 'Configurações', icon: '✏️' },
    { id: 'manage-materials', name: 'Gerenciar Materiais', section: 'Configurações', icon: '📦' },
    { id: 'manage-payment-types', name: 'Tipos de Pagamento', section: 'Configurações', icon: '💰' },
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
// - manage-materials: Gerenciar Materiais (requer can_config)
// - manage-payment-types: Tipos de Pagamento (requer can_config)
// - whitelist: Whitelist (requer can_config)
// - role-permissions: Permissões de Grupos (requer can_config)

const defaultRolePermissions = [
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
            'weekly-status', 'members-panel', 'members-overview', 
            'pending', 'absences', 
            'members', 'members-adv', 'new-member', 
            'ranking', 'materials-stats', 'all-deliveries', 'weekly-report',
            'farm-settings', 'edit-permissions', 'manage-materials', 'manage-payment-types', 'whitelist'
        ]),
        can_config: 1
    },
    {
        role_name: '02',
        display_name: '02 (Segundo Líder)',
        permissions: JSON.stringify([
            'weekly-status', 'members-panel', 'members-overview', 
            'pending', 'absences', 
            'members', 'members-adv', 'new-member', 
            'ranking', 'materials-stats', 'all-deliveries', 'weekly-report',
            'edit-permissions'
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
            'ranking', 'materials-stats', 'all-deliveries', 'weekly-report'
        ]),
        can_config: 0
    },
    {
        role_name: 'gerente_acao',
        display_name: 'Gerente de Ação',
        permissions: JSON.stringify([
            'weekly-status', 'members-panel', 'members-overview', 
            'members', 'members-adv', 
            'ranking', 'materials-stats', 'all-deliveries', 'weekly-report'
        ]),
        can_config: 0
    },
    {
        role_name: 'gerente_recrutamento',
        display_name: 'Gerente de Recrutamento',
        permissions: JSON.stringify([
            'weekly-status', 'members-panel', 'members-overview', 
            'members', 'members-adv', 'new-member',
            'ranking', 'all-deliveries'
        ]),
        can_config: 0
    },
    {
        role_name: 'gerente_encomendas',
        display_name: 'Gerente de Encomendas',
        permissions: JSON.stringify([
            'weekly-status', 'members-panel', 'members-overview', 
            'members', 'members-adv', 
            'ranking', 'materials-stats', 'all-deliveries'
        ]),
        can_config: 0
    }
];

// Buscar lista de tabs disponíveis
router.get('/role-permissions/tabs', requireAdmin, async (req, res) => {
    res.json({ tabs: availableTabs });
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
router.get('/role-permissions/:roleName', async (req, res) => {
    try {
        const { roleName } = req.params;
        
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
        if (req.session.user.role !== 'gerente_geral' && req.session.user.role !== '01') {
            return res.status(403).json({ error: 'Apenas Gerente Geral e 01 podem alterar permissões' });
        }
        
        const { roleName } = req.params;
        const { display_name, permissions, can_config } = req.body;
        
        // Não permitir editar permissões do gerente_geral
        if (roleName === 'gerente_geral') {
            return res.status(403).json({ error: 'Não é possível alterar permissões do Gerente Geral' });
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

// Criar novo grupo
router.post('/role-permissions', requireAdmin, async (req, res) => {
    try {
        // Verificar se o usuário atual tem permissão de config
        if (req.session.user.role !== 'gerente_geral' && req.session.user.role !== '01') {
            return res.status(403).json({ error: 'Apenas Gerente Geral e 01 podem criar grupos' });
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

// Resetar permissões para os valores padrão
router.post('/role-permissions/reset', requireAdmin, async (req, res) => {
    try {
        // Verificar se o usuário atual tem permissão de config
        if (req.session.user.role !== 'gerente_geral' && req.session.user.role !== '01') {
            return res.status(403).json({ error: 'Apenas Gerente Geral e 01 podem resetar permissões' });
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
        if (req.session.user.role !== 'gerente_geral' && req.session.user.role !== '01') {
            return res.status(403).json({ error: 'Apenas Gerente Geral e 01 podem resetar senhas diretamente' });
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

module.exports = router;
