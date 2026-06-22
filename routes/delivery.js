const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { runQuery, getOne, getAll, getCurrentWeek } = require('../database/db');

const isProduction = process.env.NODE_ENV === 'production' || !!process.env.DATABASE_URL;

const router = express.Router();

// Middleware de proteção CSRF por mesma origem para rotas de entrega (produção)
const requireSameOrigin = (req, res, next) => {
    if (!isProduction) return next();

    const method = req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
        return next();
    }

    const origin = req.headers.origin;
    if (!origin) return next();

    const host = req.headers.host || '';
    try {
        const originUrl = new URL(origin);
        if (originUrl.host !== host) {
            console.warn(`⚠️ CSRF bloqueado: origin=${origin} host=${host} path=${req.path}`);
            return res.status(403).json({ error: 'Requisição bloqueada por política de mesma origem' });
        }
    } catch {
        return next();
    }

    next();
};

router.use(requireSameOrigin);

// Meta semanal padrão (fallback)
const DEFAULT_WEEKLY_GOAL = 700;

// Cargos considerados gerência
const MANAGER_GROUPS = new Set([
    'super_admin',
    '01',
    '02',
    'gerente_farm',
    'gerente_acao',
    'gerente_recrutamento',
    'gerente_encomendas',
    'gerente_vendas',
    'gerente_de_vendas',
    'gerente_geral',
    'gerente_de_fabricacao'
]);

const normalizeGroupName = (groupName = '') => String(groupName)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const isManagerGroupName = (groupName = '') => {
    const normalized = normalizeGroupName(groupName);
    return MANAGER_GROUPS.has(normalized) || normalized.startsWith('gerente_');
};

const getUserGroups = async (userId) => {
    try {
        const groups = await getAll('SELECT group_name FROM user_groups WHERE user_id = ?', [userId]);
        if (groups && groups.length > 0) {
            return groups.map(g => g.group_name);
        }
        const user = await getOne('SELECT role FROM users WHERE id = ?', [userId]);
        return user?.role ? [user.role] : [];
    } catch (e) {
        return [];
    }
};

const isManagerUser = async (userId, sessionUser) => {
    if (sessionUser && sessionUser.id === userId && Array.isArray(sessionUser.groups)) {
        return sessionUser.groups.some(isManagerGroupName);
    }
    const groups = await getUserGroups(userId);
    return groups.some(isManagerGroupName);
};

const resolveMaterialGoal = (material, isManager) => {
    if (isManager) {
        return material.manager_weekly_goal ?? material.weekly_goal ?? DEFAULT_WEEKLY_GOAL;
    }
    return material.weekly_goal ?? DEFAULT_WEEKLY_GOAL;
};

const resolvePaymentGoal = (paymentType, isManager) => {
    if (isManager) {
        return paymentType.manager_weekly_goal ?? paymentType.weekly_goal ?? 50000;
    }
    return paymentType.weekly_goal ?? 50000;
};

// Separação total por cargo:
// - Gerente (gerência/01/02) farma SOMENTE produtos marcados como 'manager'
// - Membro farma o resto ('member' e os legados 'both')
const productAppliesToRole = (product, isManager) => {
    const t = (product && product.target_role) || 'both';
    if (isManager) return t === 'manager';
    return t !== 'manager';
};

const normalizeFarmType = (farmType = '') => {
    const normalized = normalizeGroupName(farmType);
    return ['drugs', 'weapons', 'general'].includes(normalized) ? normalized : 'drugs';
};

const materialAppliesToFarmSettings = (material, isManager, settings = {}) => {
    if (isManager) return true;
    if ((settings.farm_materials_enabled || 'true') !== 'true') return false;
    const farmType = normalizeFarmType(material.farm_type);
    if (farmType === 'weapons') return (settings.member_weapon_farm_enabled || 'true') === 'true';
    if (farmType === 'drugs') return (settings.member_drug_farm_enabled || 'true') === 'true';
    return true;
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

// Configuração do multer para upload de imagens (memória para produção)
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

// Middleware de autenticação
const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Não autenticado' });
    }
    next();
};

// Obter semana atual ou com offset
router.get('/current-week', requireAuth, async (req, res) => {
    try {
        const offset = parseInt(req.query.offset) || 0;
        const week = getWeekWithOffset(offset);
        const userId = req.session.user.id;
        const isManager = await isManagerUser(userId, req.session.user);
        const settingsRows = await getAll('SELECT setting_key, setting_value FROM farm_settings');
        const settingsObj = {};
        (settingsRows || []).forEach(s => {
            settingsObj[s.setting_key] = s.setting_value;
        });
        let materials = [];
        try {
            materials = await getAll('SELECT id, weekly_goal, manager_weekly_goal, target_role, farm_type FROM materials WHERE active = 1');
        } catch (e) {
            materials = await getAll('SELECT id, weekly_goal FROM materials WHERE active = 1');
        }
        materials = (materials || [])
            .filter(m => productAppliesToRole(m, isManager))
            .filter(m => materialAppliesToFarmSettings(m, isManager, settingsObj));

        let paymentTypes = [];
        try {
            paymentTypes = await getAll('SELECT id, weekly_goal, manager_weekly_goal FROM payment_types WHERE active = 1');
        } catch (e) {
            paymentTypes = await getAll('SELECT id, weekly_goal FROM payment_types WHERE active = 1');
        }
        const paymentTypesById = new Map((paymentTypes || []).map(pt => [pt.id, pt]));
        
        // Buscar TODAS as entregas ativas da semana (ignorar rejeitadas - podem refazer)
        const weekDeliveries = await getAll(`
            SELECT * FROM deliveries
            WHERE user_id = ? AND week_start = ? AND week_end = ? AND status NOT IN ('rejected', 'not_delivered')
            ORDER BY created_at DESC, id DESC
        `, [userId, week.start, week.end]);
        const existingDelivery = weekDeliveries[0] || null;
        
        // Verificar se já tem justificativa na semana atual
        const existingJustification = await getOne(`
            SELECT * FROM justifications 
            WHERE user_id = ? AND week_start = ? AND week_end = ?
        `, [userId, week.start, week.end]);
        
        // Se tem entrega, buscar progresso dos materiais E screenshots
        let progress = null;
        let approvedProgress = null; // Progresso APENAS de entregas aprovadas (para calcular "faltam")
        let existingScreenshots = [];
        
        if (existingDelivery) {
            let allMaterials = [];
            try {
                allMaterials = await getAll('SELECT id, name, icon, weekly_goal, manager_weekly_goal, target_role, farm_type FROM materials WHERE active = 1');
            } catch (e) {
                allMaterials = await getAll('SELECT id, name, icon, weekly_goal FROM materials WHERE active = 1');
            }
            // Apenas materiais do cargo do usuário
            allMaterials = allMaterials
                .filter(m => productAppliesToRole(m, isManager))
                .filter(m => materialAppliesToFarmSettings(m, isManager, settingsObj));
            const activeDeliveryIds = weekDeliveries.map(d => d.id);
            const approvedDeliveryIds = weekDeliveries.filter(d => d.status === 'approved').map(d => d.id);

            let totalDeliveryItems = [];
            let approvedDeliveryItems = [];

            if (activeDeliveryIds.length > 0) {
                const activePlaceholders = activeDeliveryIds.map(() => '?').join(',');
                totalDeliveryItems = await getAll(
                    `SELECT material_id, amount FROM delivery_items WHERE delivery_id IN (${activePlaceholders})`,
                    activeDeliveryIds
                );
            }

            if (approvedDeliveryIds.length > 0) {
                const approvedPlaceholders = approvedDeliveryIds.map(() => '?').join(',');
                approvedDeliveryItems = await getAll(
                    `SELECT material_id, amount FROM delivery_items WHERE delivery_id IN (${approvedPlaceholders})`,
                    approvedDeliveryIds
                );
            }

            const totalByMaterial = new Map();
            for (const item of totalDeliveryItems) {
                const amount = parseInt(item.amount) || 0;
                totalByMaterial.set(item.material_id, (totalByMaterial.get(item.material_id) || 0) + amount);
            }

            const approvedByMaterial = new Map();
            for (const item of approvedDeliveryItems) {
                const amount = parseInt(item.amount) || 0;
                approvedByMaterial.set(item.material_id, (approvedByMaterial.get(item.material_id) || 0) + amount);
            }

            const totalDirtyMoney = weekDeliveries
                .filter(d => d.payment_type === 'dirty_money')
                .reduce((sum, d) => sum + (parseInt(d.dirty_money_amount) || 0), 0);

            const approvedDirtyMoney = weekDeliveries
                .filter(d => d.payment_type === 'dirty_money' && d.status === 'approved')
                .reduce((sum, d) => sum + (parseInt(d.dirty_money_amount) || 0), 0);
            
            // Progresso total (incluindo pendentes) - para mostrar na barra de progresso
            progress = allMaterials.map(material => {
                const currentAmount = totalByMaterial.get(material.id) || 0;
                const goal = resolveMaterialGoal(material, isManager);
                return {
                    material_id: material.id,
                    name: material.name,
                    icon: material.icon,
                    farm_type: normalizeFarmType(material.farm_type),
                    current: currentAmount,
                    goal: goal,
                    percentage: Math.min(100, Math.round((currentAmount / goal) * 100)),
                    complete: currentAmount >= goal
                };
            });
            
            // Progresso APROVADO - usado para calcular "faltam" no frontend
            approvedProgress = allMaterials.map(material => {
                const approvedAmount = approvedByMaterial.get(material.id) || 0;
                const goal = resolveMaterialGoal(material, isManager);
                return {
                    material_id: material.id,
                    name: material.name,
                    icon: material.icon,
                    farm_type: normalizeFarmType(material.farm_type),
                    current: approvedAmount,
                    goal: goal,
                    percentage: Math.min(100, Math.round((approvedAmount / goal) * 100)),
                    complete: approvedAmount >= goal
                };
            });

            if (existingDelivery.payment_type === 'dirty_money') {
                let paymentGoal = 50000;
                if (existingDelivery.payment_type_id) {
                    const paymentType = paymentTypesById.get(existingDelivery.payment_type_id);
                    if (paymentType) {
                        paymentGoal = resolvePaymentGoal(paymentType, isManager);
                    }
                }

                progress = [{
                    material_id: 'dirty_money',
                    name: 'Pagamento',
                    icon: '💰',
                    current: totalDirtyMoney,
                    goal: paymentGoal,
                    percentage: Math.min(100, Math.round((totalDirtyMoney / paymentGoal) * 100)),
                    complete: totalDirtyMoney >= paymentGoal
                }];

                approvedProgress = [{
                    material_id: 'dirty_money',
                    name: 'Pagamento',
                    icon: '💰',
                    current: approvedDirtyMoney,
                    goal: paymentGoal,
                    percentage: Math.min(100, Math.round((approvedDirtyMoney / paymentGoal) * 100)),
                    complete: approvedDirtyMoney >= paymentGoal
                }];
            }
            
            // Buscar screenshots existentes
            try {
                const screenshots = await getAll(
                    'SELECT id, screenshot_url, created_at FROM delivery_screenshots WHERE delivery_id = ? ORDER BY created_at ASC',
                    [existingDelivery.id]
                );
                existingScreenshots = screenshots || [];
            } catch (e) {
                console.log('⚠️ Erro ao buscar screenshots:', e.message);
                existingScreenshots = [];
            }
        }
        
        // Determinar status para o frontend
        let canDeliver = true;
        let statusMessage = null;
        let isLocked = false; // Indica se está travado aguardando aprovação
        let hasPendingExtraFarm = false; // Indica se tem farm extra pendente de aprovação
        
        // Verificar se tem farm extra pendente de aprovação
        if (existingDelivery) {
            try {
                const pendingExtra = await getOne(
                    `SELECT ef.id
                     FROM extra_farm_requests ef
                     JOIN deliveries d ON d.id = ef.delivery_id
                     WHERE d.user_id = ? AND d.week_start = ? AND d.week_end = ? AND ef.status = ?
                     ORDER BY ef.created_at DESC
                     LIMIT 1`,
                    [userId, week.start, week.end, 'pending']
                );
                hasPendingExtraFarm = !!pendingExtra;
            } catch (e) {
                // Tabela pode não existir ainda
                hasPendingExtraFarm = false;
            }
        }
        
        // Pegar informações de tipo de pagamento
        let paymentType = 'material';
        let paymentTypeId = null;
        let dirtyMoneyAmount = 0;
        try {
            if (existingDelivery) {
                paymentType = existingDelivery.payment_type || 'material';
                paymentTypeId = existingDelivery.payment_type_id || null;
                if (paymentType === 'dirty_money') {
                    dirtyMoneyAmount = weekDeliveries
                        .filter(d => d.payment_type === 'dirty_money')
                        .reduce((sum, d) => sum + (parseInt(d.dirty_money_amount) || 0), 0);
                } else {
                    dirtyMoneyAmount = existingDelivery.dirty_money_amount || 0;
                }
            }
        } catch (e) {
            // Colunas podem não existir ainda
        }

        let effectiveIsPartial = existingDelivery?.is_partial || false;
        let effectivePaymentType = paymentType;

        if (existingDelivery && paymentType === 'material' && dirtyMoneyAmount > 0) {
            try {
                const deliveryItems = await getAll('SELECT material_id, amount FROM delivery_items WHERE delivery_id = ?', [existingDelivery.id]);
                if (!deliveryItems || deliveryItems.length === 0) {
                    effectivePaymentType = 'dirty_money';
                }
            } catch (e) {
                // mantém paymentType original em caso de erro
            }
        }

        // Recalcular parcialidade para aprovados SEMPRE com base no progresso (ignorar flag antiga do banco)
        // Regra: se todos os materiais aprovados bateram a meta -> completo; senão -> em progresso
        if (existingDelivery && existingDelivery.status === 'approved') {
            if (effectivePaymentType === 'dirty_money') {
                let paymentGoal = 50000;
                if (paymentTypeId) {
                    try {
                        const paymentTypeData = await getOne('SELECT weekly_goal, manager_weekly_goal FROM payment_types WHERE id = ?', [paymentTypeId]);
                        if (paymentTypeData) {
                            paymentGoal = resolvePaymentGoal(paymentTypeData, isManager);
                        }
                    } catch (e) {
                        // fallback mantém paymentGoal padrão
                    }
                }
                const totalDirtyMoney = dirtyMoneyAmount || 0;
                const isComplete = totalDirtyMoney >= paymentGoal;
                effectiveIsPartial = !isComplete;
            } else if (approvedProgress) {
                // Usar approvedProgress para verificar se foi aprovado como completo
                const isComplete = approvedProgress.every(p => p.complete);
                effectiveIsPartial = !isComplete;
            }
        }

        if (existingDelivery) {
            if (existingDelivery.status === 'approved' && !effectiveIsPartial) {
                // Farm COMPLETO - meta batida, pode adicionar ao ranking
                if (hasPendingExtraFarm) {
                    // Farm aprovado mas tem extra pendente
                    canDeliver = false;
                    isLocked = true;
                    statusMessage = '🏆 Farm extra aguardando aprovação - aguarde a análise do admin!';
                } else {
                    // Farm completo - PODE adicionar para o ranking
                    canDeliver = true;
                    statusMessage = '✅ Farm completo! Você pode adicionar mais para o ranking.';
                }
            } else if (existingDelivery.status === 'approved' && effectiveIsPartial) {
                // Farm EM PROGRESSO - meta não batida, pode continuar adicionando ao farm principal
                canDeliver = true;
                statusMessage = '⏳ Farm em progresso - continue adicionando para bater a meta!';
            } else if (existingDelivery.status === 'pending') {
                // PENDENTE: TRAVAR o formulário até o gerente aprovar
                canDeliver = false;
                isLocked = true;
                statusMessage = '⏳ Farm enviado para aprovação. Aguarde um gerente aprovar para continuar adicionando.';
            }
        }
        
        if (existingJustification) {
            canDeliver = false;
            statusMessage = 'Ausência justificada esta semana';
        }
        
        // Verificar se tem permissão de edição liberada por um admin (válido para qualquer semana)
        let canEditValues = false;
        try {
            const editPermission = await getOne(`
                SELECT id FROM edit_permissions WHERE user_id = ?
            `, [userId]);
            canEditValues = !!editPermission;
        } catch (e) {
            // Tabela pode não existir ainda
            canEditValues = false;
        }

        // Gerentes e superadmin sempre podem editar
        if (!canEditValues) {
            canEditValues = await isManagerUser(userId, req.session.user);
        }
        
        res.json({ 
            week,
            hasDelivery: !!existingDelivery,
            deliveryStatus: existingDelivery?.status || null,
            isPartial: effectiveIsPartial,
            progress: progress,
            approvedProgress: approvedProgress, // Progresso APENAS aprovado (para calcular "faltam")
            existingScreenshots: existingScreenshots,
            canDeliver: canDeliver,
            isLocked: isLocked,
            hasPendingExtraFarm: hasPendingExtraFarm,
            statusMessage: statusMessage,
            hasJustification: !!existingJustification,
            justificationStatus: existingJustification?.status || null,
            canEditValues: canEditValues,
            paymentType: paymentType,
            paymentTypeId: paymentTypeId,
            dirtyMoneyAmount: dirtyMoneyAmount
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Deletar screenshot de farm pendente
router.delete('/screenshot/:screenshotId', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { screenshotId } = req.params;
        
        // Verificar se o screenshot pertence ao usuário e se o farm está pendente
        const screenshot = await getOne(`
            SELECT ds.id, ds.delivery_id, d.user_id, d.status
            FROM delivery_screenshots ds
            JOIN deliveries d ON ds.delivery_id = d.id
            WHERE ds.id = ? AND d.user_id = ?
        `, [screenshotId, userId]);
        
        if (!screenshot) {
            return res.status(404).json({ error: 'Screenshot não encontrado' });
        }
        
        if (screenshot.status !== 'pending') {
            return res.status(403).json({ error: 'Só é possível remover prints de farms pendentes' });
        }
        
        // Deletar o screenshot
        await runQuery('DELETE FROM delivery_screenshots WHERE id = ?', [screenshotId]);
        
        console.log(`🗑️ Screenshot ${screenshotId} removido pelo usuário ${userId}`);
        
        res.json({ success: true, message: 'Screenshot removido com sucesso' });
    } catch (error) {
        console.error('Erro ao deletar screenshot:', error);
        res.status(500).json({ error: error.message });
    }
});

// Atualizar quantidades de material em farm pendente
router.put('/update-pending', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { materials } = req.body; // { materialId: newAmount, ... }
        
        // Buscar o delivery pendente do usuário
        const weekInfo = getCurrentWeek();
        const delivery = await getOne(`
            SELECT id, status FROM deliveries 
            WHERE user_id = ? AND week_start = ? AND week_end = ? AND status = 'pending'
            ORDER BY created_at DESC
            LIMIT 1
        `, [userId, weekInfo.start, weekInfo.end]);
        
        if (!delivery) {
            return res.status(404).json({ error: 'Nenhum farm pendente encontrado' });
        }
        
        // Atualizar cada material
        const isManager = await isManagerUser(userId, req.session.user);
        const settingsRows = await getAll('SELECT setting_key, setting_value FROM farm_settings');
        const settingsObj = {};
        (settingsRows || []).forEach(s => {
            settingsObj[s.setting_key] = s.setting_value;
        });
        const allowedMaterials = (await getAll('SELECT id, target_role, farm_type FROM materials WHERE active = 1'))
            .filter(m => productAppliesToRole(m, isManager))
            .filter(m => materialAppliesToFarmSettings(m, isManager, settingsObj));
        const allowedMaterialIds = new Set(allowedMaterials.map(m => Number(m.id)));

        for (const [materialId, amount] of Object.entries(materials)) {
            const numAmount = parseInt(amount);
            if (numAmount > 0 && !allowedMaterialIds.has(Number(materialId))) {
                return res.status(400).json({ error: 'Produto de farm inválido para seu cargo' });
            }
            
            // Verificar se já existe o item
            const existingItem = await getOne(
                'SELECT id FROM delivery_items WHERE delivery_id = ? AND material_id = ?',
                [delivery.id, materialId]
            );
            
            if (numAmount > 0) {
                if (existingItem) {
                    // Atualizar quantidade existente
                    await runQuery(
                        'UPDATE delivery_items SET amount = ? WHERE id = ?',
                        [numAmount, existingItem.id]
                    );
                } else {
                    // Inserir novo item
                    await runQuery(
                        'INSERT INTO delivery_items (delivery_id, material_id, amount) VALUES (?, ?, ?)',
                        [delivery.id, materialId, numAmount]
                    );
                }
            } else if (existingItem) {
                // Remover item se quantidade for 0
                await runQuery('DELETE FROM delivery_items WHERE id = ?', [existingItem.id]);
            }
        }
        
        console.log(`✏️ Farm pendente ${delivery.id} atualizado pelo usuário ${userId}`);
        
        res.json({ success: true, message: 'Farm atualizado com sucesso' });
    } catch (error) {
        console.error('Erro ao atualizar farm pendente:', error);
        res.status(500).json({ error: error.message });
    }
});

// Obter meta semanal
router.get('/weekly-goal', requireAuth, (req, res) => {
    res.json({ weeklyGoal: DEFAULT_WEEKLY_GOAL });
});

// Obter lista de materiais
router.get('/materials', requireAuth, async (req, res) => {
    try {
        console.log('📦 Buscando materiais...');
        const isManager = await isManagerUser(req.session.user.id, req.session.user);
        const settingsRows = await getAll('SELECT setting_key, setting_value FROM farm_settings');
        const settingsObj = {};
        (settingsRows || []).forEach(s => {
            settingsObj[s.setting_key] = s.setting_value;
        });
        
        // Tenta buscar com weekly_goal, se falhar busca sem
        let materials;
        try {
            materials = await getAll('SELECT id, name, icon, weekly_goal, manager_weekly_goal, target_role, farm_type, active FROM materials WHERE active = 1 ORDER BY name');
            console.log('📦 Materiais encontrados (com weekly_goal):', materials?.length);
        } catch (e) {
            console.log('⚠️ Fallback sem weekly_goal:', e.message);
            // Fallback se weekly_goal não existir
            materials = await getAll('SELECT id, name, icon, active FROM materials WHERE active = 1 ORDER BY name');
            // Adicionar weekly_goal padrão
            materials = materials.map(m => ({ ...m, weekly_goal: 700 }));
            console.log('📦 Materiais encontrados (fallback):', materials?.length);
        }
        
        // Se não houver materiais, retornar lista vazia
        if (!materials) {
            materials = [];
        }
        
        // Mostrar apenas os materiais do cargo do usuário (gerente vê gerente; membro vê membro)
        materials = materials
            .filter(m => productAppliesToRole(m, isManager))
            .filter(m => materialAppliesToFarmSettings(m, isManager, settingsObj))
            .map(m => ({
                ...m,
                farm_type: normalizeFarmType(m.farm_type),
                weekly_goal: resolveMaterialGoal(m, isManager)
            }));

        res.json({ materials, weeklyGoal: DEFAULT_WEEKLY_GOAL });
    } catch (error) {
        console.error('❌ Erro ao buscar materiais:', error);
        res.status(500).json({ error: error.message });
    }
});

// Buscar tipos de pagamento ativos
router.get('/payment-types', requireAuth, async (req, res) => {
    try {
        const isManager = await isManagerUser(req.session.user.id, req.session.user);
        let paymentTypes = [];
        try {
            paymentTypes = await getAll('SELECT id, name, icon, weekly_goal, manager_weekly_goal, unit_type, target_role FROM payment_types WHERE active = 1 ORDER BY name');
        } catch (e) {
            paymentTypes = await getAll('SELECT id, name, icon, weekly_goal, unit_type FROM payment_types WHERE active = 1 ORDER BY name');
        }
        paymentTypes = (paymentTypes || [])
            .filter(pt => productAppliesToRole(pt, isManager))
            .map(pt => ({
                ...pt,
                weekly_goal: resolvePaymentGoal(pt, isManager)
            }));
        res.json({ paymentTypes: paymentTypes || [] });
    } catch (error) {
        console.error('❌ Erro ao buscar tipos de pagamento:', error);
        // Retornar lista padrão se a tabela não existir
        res.json({ paymentTypes: [
            { id: 1, name: 'Dinheiro Sujo', icon: '💰', weekly_goal: 50000 },
            { id: 2, name: 'Dinheiro Limpo', icon: '💵', weekly_goal: 50000 }
        ]});
    }
});

// Buscar configurações do farm (para membros)
router.get('/farm-settings', requireAuth, async (req, res) => {
    try {
        const settings = await getAll('SELECT setting_key, setting_value FROM farm_settings');
        const settingsObj = {};
        settings.forEach(s => {
            settingsObj[s.setting_key] = s.setting_value;
        });
        
        // Valores padrão caso não existam
        if (!settingsObj.farm_materials_enabled) settingsObj.farm_materials_enabled = 'true';
        if (!settingsObj.member_drug_farm_enabled) settingsObj.member_drug_farm_enabled = 'true';
        if (!settingsObj.member_weapon_farm_enabled) settingsObj.member_weapon_farm_enabled = 'true';
        if (!settingsObj.farm_payment_enabled) settingsObj.farm_payment_enabled = 'true';
        if (!settingsObj.farm_payment_mode) settingsObj.farm_payment_mode = 'either';
        if (!settingsObj.competition_enabled) settingsObj.competition_enabled = 'false';
        
        res.json({ settings: settingsObj });
    } catch (error) {
        console.error('❌ Erro ao buscar configurações:', error);
        // Retornar configurações padrão
        res.json({ 
            settings: {
                farm_materials_enabled: 'true',
                member_drug_farm_enabled: 'true',
                member_weapon_farm_enabled: 'true',
                farm_payment_enabled: 'true',
                farm_payment_mode: 'either',
                competition_enabled: 'false'
            }
        });
    }
});

// Criar nova entrega de farm (múltiplos materiais) para a semana atual
// Obter semanas disponíveis para entrega - OTIMIZADO
router.get('/available-weeks', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;
        
        // Calcular todas as semanas (-1, 0, 1, 2, 3)
        const weekOffsets = [-1, 0, 1, 2, 3];
        const allWeeks = weekOffsets.map(i => ({ offset: i, ...getWeekWithOffset(i) }));
        const weekStarts = allWeeks.map(w => w.start);
        
        // Buscar whitelist uma vez
        const inWhitelist = await getOne(`SELECT id FROM farm_whitelist WHERE user_id = ?`, [userId]);
        const isWhitelisted = !!inWhitelist;
        
        // Buscar TODAS as entregas do usuário de uma vez
        const placeholders = weekStarts.map(() => '?').join(',');
        const allDeliveries = await getAll(`
            SELECT week_start, status, is_partial FROM deliveries 
            WHERE user_id = ? AND week_start IN (${placeholders})
        `, [userId, ...weekStarts]);
        
        const deliveryMap = new Map();
        for (const d of allDeliveries) {
            // Pegar a entrega não rejeitada/não entregue ou a mais recente
            if (!deliveryMap.has(d.week_start) || (d.status !== 'rejected' && d.status !== 'not_delivered')) {
                deliveryMap.set(d.week_start, d);
            }
        }
        
        // Buscar TODAS as justificativas de uma vez
        const allJustifications = await getAll(`
            SELECT week_start, status FROM justifications 
            WHERE user_id = ? AND week_start IN (${placeholders})
        `, [userId, ...weekStarts]);
        
        const justificationMap = new Map();
        for (const j of allJustifications) {
            justificationMap.set(j.week_start, j);
        }
        
        // Processar semanas
        const weeks = allWeeks.map(week => {
            const delivery = deliveryMap.get(week.start);
            const justification = justificationMap.get(week.start);
            const isPastWeek = week.offset < 0;
            
            let available = true;
            let reason = isPastWeek ? 'Meta atrasada - não paga' : null;
            
            if (isPastWeek) {
                // Semana passada
                if ((delivery && delivery.status === 'approved' && !delivery.is_partial) || (justification && justification.status === 'approved')) {
                    available = false;
                    reason = delivery?.status === 'approved' ? 'Já pago ✓' : 'Ausência justificada';
                } else if (delivery) {
                    if (delivery.status === 'pending' && !delivery.is_partial) {
                        available = false;
                        reason = 'Aguardando aprovação';
                    } else if (delivery.is_partial) {
                        reason = 'Pagamento parcial';
                    } else if (delivery.status === 'rejected' || delivery.status === 'not_delivered') {
                        reason = 'Não entregue';
                    }
                } else if (isWhitelisted) {
                    reason = 'Isento (whitelist) - pode pagar se quiser';
                }
            } else {
                // Semana atual ou futura
                if (delivery && delivery.status !== 'rejected' && delivery.status !== 'not_delivered') {
                    if (delivery.status === 'approved' && !delivery.is_partial) {
                        available = false;
                        reason = 'Farm completo aprovado';
                    } else if (delivery.status === 'pending' && !delivery.is_partial) {
                        available = false;
                        reason = 'Aguardando aprovação';
                    } else if (delivery.is_partial) {
                        reason = 'Em progresso';
                    }
                }
                if (justification) {
                    available = false;
                    reason = 'Ausência justificada';
                }
            }
            
            return {
                offset: week.offset,
                start: week.start,
                end: week.end,
                label: week.label,
                available,
                reason,
                hasDelivery: !!delivery && delivery.status !== 'rejected' && delivery.status !== 'not_delivered',
                isPartial: delivery?.is_partial || false,
                hasJustification: !!justification,
                isPastWeek
            };
        });
        
        res.json({ weeks });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Obter semanas passadas não pagas - OTIMIZADO
router.get('/unpaid-weeks', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;
        
        // Verificar whitelist uma vez só
        const inWhitelist = await getOne(`SELECT id FROM farm_whitelist WHERE user_id = ?`, [userId]);
        if (inWhitelist) {
            return res.json({ unpaidWeeks: [] }); // Whitelist = não tem semanas não pagas
        }
        
        // Calcular datas das últimas 8 semanas
        const weeks = [];
        for (let i = 1; i <= 8; i++) {
            weeks.push(getWeekWithOffset(-i));
        }
        
        // Buscar TODAS as entregas do usuário das últimas 8 semanas de uma vez
        const weekStarts = weeks.map(w => w.start);
        const placeholders = weekStarts.map(() => '?').join(',');
        
        const allDeliveries = await getAll(`
            SELECT week_start, week_end, status, is_partial, id
            FROM deliveries
            WHERE user_id = ? AND week_start IN (${placeholders})
        `, [userId, ...weekStarts]);
        
        const deliveryMap = new Map();
        for (const d of allDeliveries) {
            deliveryMap.set(d.week_start, d);
        }
        
        // Buscar TODAS as justificativas aprovadas de uma vez
        const allJustifications = await getAll(`
            SELECT week_start
            FROM justifications 
            WHERE user_id = ? AND status = 'approved' AND week_start IN (${placeholders})
        `, [userId, ...weekStarts]);
        
        const justifiedWeeks = new Set(allJustifications.map(j => j.week_start));
        
        // Processar semanas
        const unpaidWeeks = [];
        for (let i = 0; i < weeks.length; i++) {
            const week = weeks[i];
            const delivery = deliveryMap.get(week.start);
            
            // Se já pagou completo ou tem justificativa aprovada, pula
            if ((delivery && delivery.status === 'approved' && !delivery.is_partial) || justifiedWeeks.has(week.start)) {
                continue;
            }
            
            let status = 'not_paid';
            let statusText = 'Não pago';
            
            if (delivery) {
                if (delivery.status === 'pending') {
                    status = 'pending_approval';
                    statusText = 'Aguardando aprovação';
                } else if (delivery.is_partial) {
                    status = 'partial';
                    statusText = 'Pagamento parcial';
                } else if (delivery.status === 'rejected' || delivery.status === 'not_delivered') {
                    status = 'not_delivered';
                    statusText = 'Não entregue';
                }
            }
            
            unpaidWeeks.push({
                ...week,
                offset: -(i + 1),
                status,
                statusText,
                hasDelivery: !!delivery,
                deliveryId: delivery?.id || null
            });
        }
        
        res.json({ unpaidWeeks });
    } catch (error) {
        console.error('Erro ao buscar semanas não pagas:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/', requireAuth, (req, res) => {
    upload(req, res, async (err) => {
        if (err) {
            return res.status(400).json({ error: err.message });
        }

        try {
            const { materials, description, week_offset, payment_type, payment_type_id, dirty_money_amount } = req.body;
            const userId = req.session.user.id;
            const isManager = await isManagerUser(userId, req.session.user);
            const paymentType = payment_type || 'material';
            const paymentTypeId = payment_type_id ? parseInt(payment_type_id) : null;
            const dirtyMoneyAmount = parseInt(dirty_money_amount) || 0;

            const offset = parseInt(week_offset) || 0;
            if (offset < -8 || offset > 3) {
                return res.status(400).json({ error: 'Semana inválida' });
            }
            const week = getWeekWithOffset(offset);
            const isPastWeek = offset < 0;

            const hasNewScreenshots = req.files && req.files.length > 0;
            if (!hasNewScreenshots) {
                return res.status(400).json({ error: 'Envie pelo menos 1 print do farm' });
            }

            let materialsArray;
            try {
                materialsArray = JSON.parse(materials || '[]');
            } catch (e) {
                return res.status(400).json({ error: 'Dados de materiais inválidos' });
            }

            if (paymentType === 'dirty_money') {
                if (dirtyMoneyAmount <= 0) {
                    return res.status(400).json({ error: 'Informe o valor do pagamento' });
                }
                materialsArray = [];
            } else {
                if (!materialsArray || materialsArray.length === 0) {
                    return res.status(400).json({ error: 'Informe pelo menos um material' });
                }
                const totalSubmitted = materialsArray.reduce((sum, item) => sum + (parseInt(item.amount) || 0), 0);
                if (totalSubmitted <= 0) {
                    return res.status(400).json({ error: 'Informe pelo menos um material com quantidade maior que 0' });
                }
            }

            const settingsRows = await getAll('SELECT setting_key, setting_value FROM farm_settings');
            const settingsObj = {};
            (settingsRows || []).forEach(s => {
                settingsObj[s.setting_key] = s.setting_value;
            });

            const allMaterials = (await getAll('SELECT id, name, weekly_goal, manager_weekly_goal, target_role, farm_type FROM materials WHERE active = 1'))
                .filter(m => productAppliesToRole(m, isManager))
                .filter(m => materialAppliesToFarmSettings(m, isManager, settingsObj));
            const allowedMaterialIds = new Set(allMaterials.map(m => Number(m.id)));

            if (paymentType === 'material') {
                if (allMaterials.length === 0) {
                    return res.status(400).json({ error: 'Nenhum produto de farm configurado para seu cargo' });
                }

                const invalidMaterial = materialsArray.find(item => {
                    const amount = parseInt(item.amount) || 0;
                    return amount > 0 && !allowedMaterialIds.has(Number(item.material_id));
                });
                if (invalidMaterial) {
                    return res.status(400).json({ error: 'Produto de farm inválido para seu cargo' });
                }
            }

            if (paymentType === 'dirty_money' && paymentTypeId) {
                const selectedPaymentType = await getOne(
                    'SELECT id, active, target_role FROM payment_types WHERE id = ?',
                    [paymentTypeId]
                );
                if (!selectedPaymentType || selectedPaymentType.active === 0 || !productAppliesToRole(selectedPaymentType, isManager)) {
                    return res.status(400).json({ error: 'Tipo de pagamento inválido para seu cargo' });
                }
            }

            // Carregar configurações para saber se competição está ativa (controla Farm Extra)
            const competitionEnabled = (settingsObj.competition_enabled || 'false') === 'true';

            // Antes de tudo: regra 1 farm pendente por vez na semana
            const existingPending = await getOne(`
                SELECT id FROM deliveries
                WHERE user_id = ? AND week_start = ? AND week_end = ? AND status = 'pending'
            `, [userId, week.start, week.end]);
            if (existingPending) {
                return res.status(400).json({ error: 'Já existe um farm aguardando aprovação para esta semana. Aguarde o gerente aprovar ou rejeitar antes de enviar outro.' });
            }

            // Se a semana já está concluída E competição está ativa, o novo envio vira farm extra para ranking
            const latestCompleteApproved = await getOne(`
                SELECT * FROM deliveries
                WHERE user_id = ? AND week_start = ? AND week_end = ?
                  AND status = 'approved' AND is_partial = 0
                ORDER BY created_at DESC
                LIMIT 1
            `, [userId, week.start, week.end]);

            if (competitionEnabled && latestCompleteApproved) {
                const deliveryId = latestCompleteApproved.id;
                const extraMaterials = {};

                for (const item of materialsArray) {
                    const amount = parseInt(item.amount) || 0;
                    if (amount > 0) {
                        extraMaterials[item.material_id] = amount;
                    }
                }

                if (paymentType === 'dirty_money' && dirtyMoneyAmount > 0) {
                    extraMaterials['dirty_money'] = dirtyMoneyAmount;
                }

                const extraResult = await runQuery(
                    'INSERT INTO extra_farm_requests (delivery_id, user_id, materials, status) VALUES (?, ?, ?, ?)',
                    [deliveryId, userId, JSON.stringify(extraMaterials), 'pending']
                );
                const extraFarmId = extraResult.lastID;

                for (const file of req.files) {
                    const base64 = file.buffer.toString('base64');
                    const mimeType = file.mimetype;
                    const dataUrl = `data:${mimeType};base64,${base64}`;

                    await runQuery(
                        'INSERT INTO extra_farm_screenshots (extra_farm_id, screenshot_url) VALUES (?, ?)',
                        [extraFarmId, dataUrl]
                    );
                }

                return res.json({
                    success: true,
                    message: '🏆 Farm extra enviado para aprovação!',
                    deliveryId,
                    extraFarmId,
                    isComplete: true,
                    isExtraFarm: true
                });
            }

            let isComplete = false;
            let progressDetails = [];

            if (paymentType === 'dirty_money') {
                let paymentTypeGoal = 50000;
                if (paymentTypeId) {
                    const paymentTypeData = await getOne('SELECT weekly_goal, manager_weekly_goal FROM payment_types WHERE id = ?', [paymentTypeId]);
                    if (paymentTypeData) {
                        paymentTypeGoal = resolvePaymentGoal(paymentTypeData, isManager);
                    }
                }

                isComplete = dirtyMoneyAmount >= paymentTypeGoal;
                progressDetails.push({
                    name: 'Pagamento',
                    current: dirtyMoneyAmount,
                    goal: paymentTypeGoal,
                    percentage: Math.min(100, Math.round((dirtyMoneyAmount / paymentTypeGoal) * 100)),
                    complete: isComplete
                });
            } else {
                isComplete = true;
                for (const material of allMaterials) {
                    const submittedItem = materialsArray.find(i => parseInt(i.material_id) === material.id);
                    const currentAmount = submittedItem ? (parseInt(submittedItem.amount) || 0) : 0;
                    const goal = resolveMaterialGoal(material, isManager);
                    const percentage = Math.min(100, Math.round((currentAmount / goal) * 100));

                    progressDetails.push({
                        name: material.name,
                        current: currentAmount,
                        goal,
                        percentage,
                        complete: currentAmount >= goal
                    });

                    if (currentAmount < goal) {
                        isComplete = false;
                    }
                }
            }

            const firstFile = req.files[0];
            const firstBase64 = firstFile.buffer.toString('base64');
            const firstMimeType = firstFile.mimetype;
            const screenshot_url = `data:${firstMimeType};base64,${firstBase64}`;
            const finalDescription = isPastWeek ? '[META ATRASADA] ' + (description || '') : (description || '');

            const result = await runQuery(
                'INSERT INTO deliveries (user_id, week_start, week_end, description, screenshot_url, is_partial, status, payment_type, payment_type_id, dirty_money_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [userId, week.start, week.end, finalDescription, screenshot_url, isComplete ? 0 : 1, 'pending', paymentType, paymentTypeId, dirtyMoneyAmount]
            );

            const deliveryId = result.lastID;

            if (paymentType === 'material') {
                for (const item of materialsArray) {
                    const amount = parseInt(item.amount) || 0;
                    if (amount > 0) {
                        await runQuery(
                            'INSERT INTO delivery_items (delivery_id, material_id, amount) VALUES (?, ?, ?)',
                            [deliveryId, parseInt(item.material_id), amount]
                        );
                    }
                }
            }

            for (const file of req.files) {
                const base64 = file.buffer.toString('base64');
                const mimeType = file.mimetype;
                const dataUrl = `data:${mimeType};base64,${base64}`;

                try {
                    await runQuery(
                        'INSERT INTO delivery_screenshots (delivery_id, screenshot_url) VALUES (?, ?)',
                        [deliveryId, dataUrl]
                    );
                } catch (screenshotError) {
                    console.error('⚠️ Erro ao salvar screenshot:', screenshotError.message);
                }
            }

            if (isComplete) {
                return res.json({
                    success: true,
                    message: `🎉 Farm COMPLETO! Semana ${week.label} - Enviado para aprovação!`,
                    deliveryId,
                    isComplete: true,
                    progress: progressDetails
                });
            }

            const remaining = progressDetails
                .filter(p => !p.complete)
                .map(p => `${p.name}: ${p.current}/${p.goal}`)
                .join(', ');

            res.json({
                success: true,
                message: `📝 Entrega em progresso enviada para aprovação! Falta completar: ${remaining}`,
                deliveryId,
                isComplete: false,
                isInProgress: true,
                progress: progressDetails
            });
        } catch (error) {
            console.error('❌ Erro em POST /delivery:', error);
            res.status(500).json({ error: error.message });
        }
    });
});

// Pagar farm de semana passada (retroativo)
router.post('/pay-past-week', requireAuth, (req, res) => {
    upload(req, res, async (err) => {
        if (err) {
            return res.status(400).json({ error: err.message });
        }
        
        try {
            const { materials, week_start, week_end, payment_type, payment_type_id, dirty_money_amount } = req.body;
            const userId = req.session.user.id;
            const isManager = await isManagerUser(userId, req.session.user);
            const paymentType = payment_type || 'material';
            const paymentTypeId = payment_type_id ? parseInt(payment_type_id) : null;
            const dirtyMoneyAmount = parseInt(dirty_money_amount) || 0;
            
            if (!week_start || !week_end) {
                return res.status(400).json({ error: 'Semana não informada' });
            }
            
            // Verificar se a semana é realmente passada
            const currentWeek = getCurrentWeek();
            if (week_start >= currentWeek.start) {
                return res.status(400).json({ error: 'Use a entrega normal para a semana atual ou futuras' });
            }
            
            // Verificar se já tem entrega APROVADA e COMPLETA nessa semana
            const approvedDelivery = await getOne(`
                SELECT * FROM deliveries 
                WHERE user_id = ? AND week_start = ? AND week_end = ? AND status = 'approved' AND is_partial = 0
            `, [userId, week_start, week_end]);
            
            if (approvedDelivery) {
                return res.status(400).json({ error: 'Esta semana já foi paga!' });
            }
            
            // Verificar se tem justificativa aprovada
            const justification = await getOne(`
                SELECT * FROM justifications 
                WHERE user_id = ? AND week_start = ? AND week_end = ? AND status = 'approved'
            `, [userId, week_start, week_end]);
            
            if (justification) {
                return res.status(400).json({ error: 'Esta semana já tem justificativa aprovada' });
            }
            let materialsArray = [];
            const settingsRows = await getAll('SELECT setting_key, setting_value FROM farm_settings');
            const settingsObj = {};
            (settingsRows || []).forEach(s => {
                settingsObj[s.setting_key] = s.setting_value;
            });
            const allMaterials = (await getAll('SELECT id, name, weekly_goal, manager_weekly_goal, target_role, farm_type FROM materials WHERE active = 1'))
                .filter(m => productAppliesToRole(m, isManager))
                .filter(m => materialAppliesToFarmSettings(m, isManager, settingsObj));
            const allowedMaterialIds = new Set(allMaterials.map(m => Number(m.id)));

            if (paymentType === 'material') {
                materialsArray = typeof materials === 'string' ? JSON.parse(materials || '[]') : (materials || []);
                const invalidMaterial = materialsArray.find(mat => {
                    const amount = parseInt(mat.amount) || 0;
                    return amount > 0 && !allowedMaterialIds.has(Number(mat.material_id));
                });
                if (invalidMaterial) {
                    return res.status(400).json({ error: 'Produto de farm inválido para seu cargo' });
                }
            }

            if (paymentType === 'dirty_money') {
                if (dirtyMoneyAmount <= 0) {
                    return res.status(400).json({ error: 'Informe o valor do pagamento' });
                }
                if (paymentTypeId) {
                    const selectedPaymentType = await getOne(
                        'SELECT id, active, target_role FROM payment_types WHERE id = ?',
                        [paymentTypeId]
                    );
                    if (!selectedPaymentType || selectedPaymentType.active === 0 || !productAppliesToRole(selectedPaymentType, isManager)) {
                        return res.status(400).json({ error: 'Tipo de pagamento inválido para seu cargo' });
                    }
                }
            }

            // Deletar entregas rejeitadas ou parciais antigas para substituir
            const existingDelivery = await getOne(`
                SELECT id FROM deliveries 
                WHERE user_id = ? AND week_start = ? AND week_end = ?
            `, [userId, week_start, week_end]);
            
            if (existingDelivery) {
                // Deletar extra_farm relacionados primeiro
                const extraFarms = await getAll('SELECT id FROM extra_farm_requests WHERE delivery_id = ?', [existingDelivery.id]);
                for (const ef of extraFarms) {
                    await runQuery('DELETE FROM extra_farm_screenshots WHERE extra_farm_id = ?', [ef.id]);
                }
                await runQuery('DELETE FROM extra_farm_requests WHERE delivery_id = ?', [existingDelivery.id]);
                await runQuery('DELETE FROM delivery_screenshots WHERE delivery_id = ?', [existingDelivery.id]);
                await runQuery('DELETE FROM delivery_items WHERE delivery_id = ?', [existingDelivery.id]);
                await runQuery('DELETE FROM deliveries WHERE id = ?', [existingDelivery.id]);
            }
            
            // Criar nova entrega para semana passada (marcada como pagamento retroativo)
            const result = await runQuery(`
                INSERT INTO deliveries (user_id, week_start, week_end, status, is_partial, payment_type, payment_type_id, dirty_money_amount, description)
                VALUES (?, ?, ?, 'pending', 0, ?, ?, ?, '[META ATRASADA]')
            `, [userId, week_start, week_end, paymentType, paymentTypeId, dirtyMoneyAmount]);
            
            const deliveryId = result.lastID;
            
            // Salvar materiais se for pagamento com materiais
            if (paymentType === 'material' && materials) {
                for (const mat of materialsArray) {
                    if (mat.amount > 0) {
                        await runQuery(
                            'INSERT INTO delivery_items (delivery_id, material_id, amount) VALUES (?, ?, ?)',
                            [deliveryId, mat.material_id, mat.amount]
                        );
                    }
                }
            }
            
            // Salvar screenshots
            if (req.files && req.files.length > 0) {
                for (const file of req.files) {
                    const base64 = file.buffer.toString('base64');
                    const mimeType = file.mimetype || 'image/jpeg';
                    const screenshotUrl = `data:${mimeType};base64,${base64}`;
                    await runQuery(
                        'INSERT INTO delivery_screenshots (delivery_id, screenshot_url) VALUES (?, ?)',
                        [deliveryId, screenshotUrl]
                    );
                }
            }
            
            // Formatar label da semana
            const weekLabel = `${new Date(week_start).toLocaleDateString('pt-BR')} - ${new Date(week_end).toLocaleDateString('pt-BR')}`;
            
            console.log(`💰 Pagamento retroativo: Usuário ${userId} pagou semana ${weekLabel}`);
            
            res.json({ 
                success: true, 
                message: `✅ Pagamento da semana ${weekLabel} enviado para aprovação!`,
                deliveryId: deliveryId
            });
            
        } catch (error) {
            console.error('❌ Erro em POST /pay-past-week:', error);
            res.status(500).json({ error: error.message });
        }
    });
});

// Submeter justificativa de ausência
router.post('/absence', requireAuth, async (req, res) => {
    try {
        const { reason } = req.body;
        const userId = req.session.user.id;
        const week = getCurrentWeek();
        // Verificar se competição está ativa para permitir farm extra
        const settingsRows = await getAll('SELECT setting_key, setting_value FROM farm_settings');
        const settingsObj = {};
        (settingsRows || []).forEach(s => {
            settingsObj[s.setting_key] = s.setting_value;
        });
        const competitionEnabled = (settingsObj.competition_enabled || 'false') === 'true';
        if (!competitionEnabled) {
            return res.status(400).json({ error: 'Competição desativada. Farm extra não está disponível.' });
        }
        
        if (!reason || reason.trim().length < 10) {
            return res.status(400).json({ 
                error: 'A justificativa deve ter pelo menos 10 caracteres.' 
            });
        }
        
        // Verificar se já tem entrega na semana
        const existingDelivery = await getOne(`
            SELECT * FROM deliveries 
            WHERE user_id = ? AND week_start = ? AND week_end = ?
        `, [userId, week.start, week.end]);
        
        if (existingDelivery) {
            return res.status(400).json({ 
                error: 'Você já registrou farm para esta semana. Não pode justificar ausência.' 
            });
        }
        
        // Verificar se já tem justificativa na semana
        const existingJustification = await getOne(`
            SELECT * FROM justifications 
            WHERE user_id = ? AND week_start = ? AND week_end = ?
        `, [userId, week.start, week.end]);
        
        if (existingJustification) {
            return res.status(400).json({ 
                error: 'Você já enviou uma justificativa para esta semana.' 
            });
        }
        
        await runQuery(
            'INSERT INTO justifications (user_id, week_start, week_end, reason) VALUES (?, ?, ?, ?)',
            [userId, week.start, week.end, reason.trim()]
        );
        
        res.json({ 
            success: true, 
            message: 'Justificativa enviada para aprovação.' 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Listar minhas entregas
router.get('/my', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const isManager = await isManagerUser(userId, req.session.user);
        const settingsRows = await getAll('SELECT setting_key, setting_value FROM farm_settings');
        const settingsObj = {};
        (settingsRows || []).forEach(s => {
            settingsObj[s.setting_key] = s.setting_value;
        });

        let materials = [];
        try {
            materials = await getAll('SELECT id, weekly_goal, manager_weekly_goal, target_role, farm_type FROM materials WHERE active = 1');
        } catch (e) {
            materials = await getAll('SELECT id, weekly_goal FROM materials WHERE active = 1');
        }
        materials = (materials || [])
            .filter(m => productAppliesToRole(m, isManager))
            .filter(m => materialAppliesToFarmSettings(m, isManager, settingsObj));

        let paymentTypes = [];
        try {
            paymentTypes = await getAll('SELECT id, weekly_goal, manager_weekly_goal FROM payment_types WHERE active = 1');
        } catch (e) {
            paymentTypes = await getAll('SELECT id, weekly_goal FROM payment_types WHERE active = 1');
        }
        const paymentTypesById = new Map((paymentTypes || []).map(pt => [pt.id, pt]));
        
        const deliveries = await getAll(`
            SELECT d.*, a.name as approved_by_name
            FROM deliveries d
            LEFT JOIN users a ON d.approved_by = a.id
            WHERE d.user_id = ?
            ORDER BY d.week_start DESC, d.created_at DESC
            LIMIT 10
        `, [userId]);
        
        // Para cada entrega, buscar os itens e screenshots
        for (let delivery of deliveries) {
            delivery.items = await getAll(`
                SELECT di.*, m.name as material_name, m.icon as material_icon
                FROM delivery_items di
                JOIN materials m ON di.material_id = m.id
                WHERE di.delivery_id = ?
            `, [delivery.id]);
            
            // Buscar screenshots adicionais (com fallback)
            try {
                delivery.screenshots = await getAll(`
                    SELECT * FROM delivery_screenshots WHERE delivery_id = ?
                `, [delivery.id]);
            } catch (e) {
                // Se tabela não existir, usar array vazio
                delivery.screenshots = [];
            }

            // Recalcular parcialidade para aprovados com base na meta do gerente
            if (delivery.status === 'approved') {
                let isComplete = true;

                if (delivery.payment_type === 'dirty_money') {
                    const paymentType = paymentTypesById.get(delivery.payment_type_id) || {};
                    const goal = resolvePaymentGoal(paymentType, isManager);
                    const amount = delivery.dirty_money_amount || 0;
                    isComplete = amount >= goal;
                } else {
                    for (const mat of materials) {
                        const item = delivery.items.find(i => i.material_id === mat.id);
                        const amount = item ? item.amount : 0;
                        const goal = resolveMaterialGoal(mat, isManager);
                        if (amount < goal) {
                            isComplete = false;
                            break;
                        }
                    }
                }

                delivery.is_partial = !isComplete;
            }
        }
        
        res.json({ deliveries });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Listar minhas justificativas
router.get('/my-justifications', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;
        
        const justifications = await getAll(`
            SELECT j.*, u.name as approved_by_name
            FROM justifications j
            LEFT JOIN users u ON j.approved_by = u.id
            WHERE j.user_id = ?
            ORDER BY j.week_start DESC
            LIMIT 10
        `, [userId]);
        
        res.json({ justifications });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Estatísticas do usuário
router.get('/stats', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;
        
        const stats = await getOne(`
            SELECT 
                COUNT(DISTINCT d.id) as total_deliveries,
                COALESCE(SUM(CASE WHEN d.status = 'approved' THEN di.amount ELSE 0 END), 0) as total_approved,
                (SELECT COUNT(*) FROM deliveries WHERE user_id = ? AND status = 'pending') as pending_count,
                (SELECT COUNT(*) FROM deliveries WHERE user_id = ? AND status = 'approved') as approved_count,
                (SELECT COUNT(*) FROM deliveries WHERE user_id = ? AND status IN ('rejected','not_delivered')) as rejected_count
            FROM deliveries d
            LEFT JOIN delivery_items di ON d.id = di.delivery_id
            WHERE d.user_id = ?
        `, [userId, userId, userId, userId]);
        
        // Estatísticas por material
        const byMaterial = await getAll(`
            SELECT m.name, m.icon, 
                   COALESCE(SUM(CASE WHEN d.status = 'approved' THEN di.amount ELSE 0 END), 0) as total
            FROM materials m
            LEFT JOIN delivery_items di ON m.id = di.material_id
            LEFT JOIN deliveries d ON di.delivery_id = d.id AND d.user_id = ?
            WHERE m.active = 1
            GROUP BY m.id
            HAVING total > 0
            ORDER BY total DESC
        `, [userId]);
        
        res.json({ stats, byMaterial });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Obter minhas advertências
router.get('/my-warnings', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;
        
        const warnings = await getAll(`
            SELECT w.*, u.name as given_by_name
            FROM warnings w
            JOIN users u ON w.given_by = u.id
            WHERE w.user_id = ?
            ORDER BY w.created_at DESC
        `, [userId]);
        
        res.json({ warnings, count: warnings.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========== EDIÇÃO DE VALOR INDIVIDUAL ==========
// Rota para editar valor de um material específico (correção de erros)
router.post('/edit-value', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { material_id, new_value, week_offset } = req.body;
        
        if (material_id === undefined || new_value === undefined) {
            return res.status(400).json({ error: 'material_id e new_value são obrigatórios' });
        }
        
        const offset = parseInt(week_offset) || 0;
        const week = getWeekWithOffset(offset);
        
        // Verificar se tem permissão de edição (válido para qualquer semana)
        let hasPermission = false;
        try {
            const permission = await getOne(`
                SELECT id FROM edit_permissions WHERE user_id = ?
            `, [userId]);
            hasPermission = !!permission;
        } catch (e) {
            hasPermission = false;
        }

        if (!hasPermission) {
            hasPermission = await isManagerUser(userId, req.session.user);
        }

        if (!hasPermission) {
            hasPermission = await isManagerUser(userId, req.session.user);
        }
        
        if (!hasPermission) {
            return res.status(403).json({ error: 'Você não tem permissão para editar valores. Solicite a um gerente.' });
        }
        
        // Buscar entrega existente (qualquer status exceto rejected/não entregue)
        const existingDelivery = await getOne(`
            SELECT * FROM deliveries 
            WHERE user_id = ? AND week_start = ? AND week_end = ? AND status NOT IN ('rejected','not_delivered')
            ORDER BY created_at DESC
            LIMIT 1
        `, [userId, week.start, week.end]);
        
        if (!existingDelivery) {
            return res.status(400).json({ error: 'Nenhuma entrega encontrada para editar' });
        }
        
        const newAmount = parseInt(new_value) || 0;
        
        const isManager = await isManagerUser(userId, req.session.user);
        const settingsRows = await getAll('SELECT setting_key, setting_value FROM farm_settings');
        const settingsObj = {};
        (settingsRows || []).forEach(s => {
            settingsObj[s.setting_key] = s.setting_value;
        });

        // Buscar meta do material (para verificar se completou, mas não bloqueia)
        const materialData = await getOne('SELECT name, weekly_goal, manager_weekly_goal, target_role, farm_type, active FROM materials WHERE id = ?', [material_id]);
        if (!materialData || materialData.active === 0 || !productAppliesToRole(materialData, isManager) || !materialAppliesToFarmSettings(materialData, isManager, settingsObj)) {
            return res.status(400).json({ error: 'Produto de farm inválido para seu cargo' });
        }
        const materialGoal = resolveMaterialGoal(materialData || {}, isManager);
        
        // Verificar se já existe esse material na entrega
        const existingItem = await getOne(`
            SELECT * FROM delivery_items 
            WHERE delivery_id = ? AND material_id = ?
        `, [existingDelivery.id, material_id]);
        
        if (existingItem) {
            // Atualizar valor existente
            await runQuery(
                'UPDATE delivery_items SET amount = ? WHERE id = ?',
                [newAmount, existingItem.id]
            );
            console.log('✏️ Valor editado:', { material_id, oldValue: existingItem.amount, newValue: newAmount });
        } else if (newAmount > 0) {
            // Inserir novo item
            await runQuery(
                'INSERT INTO delivery_items (delivery_id, material_id, amount) VALUES (?, ?, ?)',
                [existingDelivery.id, parseInt(material_id), newAmount]
            );
            console.log('✏️ Valor criado:', { material_id, value: newAmount });
        }
        
        // Verificar se completou o farm (recalcular is_partial e status)
        const allMaterials = (await getAll('SELECT id, weekly_goal, manager_weekly_goal, target_role, farm_type FROM materials WHERE active = 1'))
            .filter(m => productAppliesToRole(m, isManager))
            .filter(m => materialAppliesToFarmSettings(m, isManager, settingsObj));
        const deliveryItems = await getAll('SELECT material_id, amount FROM delivery_items WHERE delivery_id = ?', [existingDelivery.id]);
        
        let allComplete = true;
        for (const mat of allMaterials) {
            const item = deliveryItems.find(i => i.material_id === mat.id);
            const currentAmount = item ? item.amount : 0;
            const goal = resolveMaterialGoal(mat, isManager);
            if (currentAmount < goal) {
                allComplete = false;
                break;
            }
        }
        
        // Atualizar status da entrega
        if (allComplete && existingDelivery.is_partial) {
            // Completou o farm - mudar para pending
            await runQuery(
                'UPDATE deliveries SET is_partial = 0, status = ? WHERE id = ?',
                ['pending', existingDelivery.id]
            );
            console.log('✅ Farm completado via edição!');
        } else if (!allComplete && !existingDelivery.is_partial) {
            // Não está mais completo - voltar para parcial mas ainda precisa aprovação
            await runQuery(
                'UPDATE deliveries SET is_partial = 1, status = ? WHERE id = ?',
                ['pending', existingDelivery.id]
            );
            console.log('⚠️ Farm voltou a parcial via edição');
        }
        
        res.json({ success: true, message: 'Valor atualizado com sucesso!' });
        
    } catch (error) {
        console.error('Erro ao editar valor:', error);
        res.status(500).json({ error: error.message });
    }
});

// Listar meus farms extras
router.get('/my-extra-farms', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;
        
        const extras = await getAll(`
            SELECT 
                ef.id,
                ef.delivery_id,
                ef.materials,
                ef.status,
                ef.created_at,
                ef.reviewed_at,
                d.week_start,
                d.week_end,
                u.name as reviewed_by_name
            FROM extra_farm_requests ef
            JOIN deliveries d ON ef.delivery_id = d.id
            LEFT JOIN users u ON ef.reviewed_by = u.id
            WHERE ef.user_id = ?
            ORDER BY ef.created_at DESC
            LIMIT 20
        `, [userId]);
        
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
        console.error('❌ Erro ao listar meus farms extras:', error);
        res.status(500).json({ error: error.message });
    }
});

// Editar valor de dinheiro sujo (para correção de erro de digitação)
router.post('/edit-dirty-money', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { new_value, week_offset } = req.body;
        
        if (new_value === undefined) {
            return res.status(400).json({ error: 'new_value é obrigatório' });
        }
        
        const offset = parseInt(week_offset) || 0;
        const week = getWeekWithOffset(offset);
        
        // Verificar se tem permissão de edição
        let hasPermission = false;
        try {
            const permission = await getOne(`
                SELECT id FROM edit_permissions WHERE user_id = ?
            `, [userId]);
            hasPermission = !!permission;
        } catch (e) {
            hasPermission = false;
        }
        
        if (!hasPermission) {
            return res.status(403).json({ error: 'Você não tem permissão para editar valores. Solicite a um gerente.' });
        }
        
        // Buscar entrega existente
        const existingDelivery = await getOne(`
            SELECT * FROM deliveries 
            WHERE user_id = ? AND week_start = ? AND week_end = ? AND status NOT IN ('rejected','not_delivered')
            ORDER BY created_at DESC
            LIMIT 1
        `, [userId, week.start, week.end]);
        
        if (!existingDelivery) {
            return res.status(400).json({ error: 'Nenhuma entrega encontrada para editar' });
        }
        
        if (existingDelivery.payment_type !== 'dirty_money') {
            return res.status(400).json({ error: 'Esta entrega não é de dinheiro sujo' });
        }
        
        const newAmount = parseInt(new_value) || 0;
        const oldAmount = existingDelivery.dirty_money_amount || 0;
        
        // Buscar meta do tipo de pagamento (para verificar se completou, mas não bloqueia)
        let paymentTypeGoal = 50000;
        if (existingDelivery.payment_type_id) {
            const paymentType = await getOne('SELECT weekly_goal, manager_weekly_goal FROM payment_types WHERE id = ?', [existingDelivery.payment_type_id]);
            if (paymentType) {
                const isManager = await isManagerUser(userId, req.session.user);
                paymentTypeGoal = resolvePaymentGoal(paymentType, isManager);
            }
        }
        
        // Atualizar valor
        await runQuery(
            'UPDATE deliveries SET dirty_money_amount = ? WHERE id = ?',
            [newAmount, existingDelivery.id]
        );
        
        console.log('✏️ Dinheiro sujo editado:', { oldValue: oldAmount, newValue: newAmount, deliveryId: existingDelivery.id });
        
        const isComplete = newAmount >= paymentTypeGoal;
        
        if (isComplete && existingDelivery.is_partial) {
            // Completou - mudar para pending
            await runQuery(
                'UPDATE deliveries SET is_partial = 0, status = ? WHERE id = ?',
                ['pending', existingDelivery.id]
            );
            console.log('✅ Farm de dinheiro sujo completado via edição!');
        } else if (!isComplete && !existingDelivery.is_partial) {
            // Não está mais completo - voltar para parcial mas ainda precisa aprovação
            await runQuery(
                'UPDATE deliveries SET is_partial = 1, status = ? WHERE id = ?',
                ['pending', existingDelivery.id]
            );
            console.log('⚠️ Farm de dinheiro sujo voltou a parcial via edição');
        }
        
        res.json({ success: true, message: 'Valor atualizado com sucesso!' });
        
    } catch (error) {
        console.error('Erro ao editar dinheiro sujo:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
