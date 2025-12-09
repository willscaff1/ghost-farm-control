const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { runQuery, getOne, getAll, getCurrentWeek } = require('../database/db');

const router = express.Router();

// Meta semanal padrão (fallback)
const DEFAULT_WEEKLY_GOAL = 700;

// Helper para calcular semana com offset (semanas futuras)
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
        
        // Verificar se já tem entrega na semana (ignorar rejeitadas - podem refazer)
        const existingDelivery = await getOne(`
            SELECT * FROM deliveries 
            WHERE user_id = ? AND week_start = ? AND week_end = ? AND status != 'rejected'
        `, [userId, week.start, week.end]);
        
        // Verificar se já tem justificativa na semana atual
        const existingJustification = await getOne(`
            SELECT * FROM justifications 
            WHERE user_id = ? AND week_start = ? AND week_end = ?
        `, [userId, week.start, week.end]);
        
        // Se tem entrega, buscar progresso dos materiais E screenshots
        let progress = null;
        let existingScreenshots = [];
        
        if (existingDelivery) {
            const allMaterials = await getAll('SELECT id, name, icon, weekly_goal FROM materials WHERE active = 1');
            const deliveryItems = await getAll('SELECT material_id, amount FROM delivery_items WHERE delivery_id = ?', [existingDelivery.id]);
            
            progress = allMaterials.map(material => {
                const item = deliveryItems.find(i => i.material_id === material.id);
                const currentAmount = item ? item.amount : 0;
                const goal = material.weekly_goal || DEFAULT_WEEKLY_GOAL;
                return {
                    material_id: material.id,
                    name: material.name,
                    icon: material.icon,
                    current: currentAmount,
                    goal: goal,
                    percentage: Math.min(100, Math.round((currentAmount / goal) * 100)),
                    complete: currentAmount >= goal
                };
            });
            
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
        
        if (existingDelivery) {
            if (existingDelivery.status === 'approved' && !existingDelivery.is_partial) {
                canDeliver = false;
                statusMessage = 'Farm completo aprovado!';
            } else if (existingDelivery.status === 'pending' && !existingDelivery.is_partial) {
                canDeliver = false;
                statusMessage = 'Farm completo aguardando aprovação';
            } else if (existingDelivery.is_partial) {
                canDeliver = true; // Pode continuar adicionando
                statusMessage = 'Farm em progresso - continue adicionando!';
            }
        }
        
        if (existingJustification) {
            canDeliver = false;
            statusMessage = 'Ausência justificada esta semana';
        }
        
        res.json({ 
            week,
            hasDelivery: !!existingDelivery,
            deliveryStatus: existingDelivery?.status || null,
            isPartial: existingDelivery?.is_partial || false,
            progress: progress,
            existingScreenshots: existingScreenshots,
            canDeliver: canDeliver,
            statusMessage: statusMessage,
            hasJustification: !!existingJustification,
            justificationStatus: existingJustification?.status || null
        });
    } catch (error) {
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
        
        // Tenta buscar com weekly_goal, se falhar busca sem
        let materials;
        try {
            materials = await getAll('SELECT id, name, icon, weekly_goal, active FROM materials WHERE active = 1 ORDER BY name');
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
        
        res.json({ materials, weeklyGoal: DEFAULT_WEEKLY_GOAL });
    } catch (error) {
        console.error('❌ Erro ao buscar materiais:', error);
        res.status(500).json({ error: error.message });
    }
});

// Criar nova entrega de farm (múltiplos materiais) para a semana atual
// Obter semanas disponíveis para entrega (atual + 3 próximas)
router.get('/available-weeks', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const weeks = [];
        
        for (let i = 0; i <= 3; i++) {
            const week = getWeekWithOffset(i);
            
            // Verificar se já tem entrega nessa semana (ignorar rejeitadas - podem refazer)
            const existingDelivery = await getOne(`
                SELECT * FROM deliveries 
                WHERE user_id = ? AND week_start = ? AND week_end = ? AND status != 'rejected'
            `, [userId, week.start, week.end]);
            
            // Verificar se já tem justificativa nessa semana
            const existingJustification = await getOne(`
                SELECT * FROM justifications 
                WHERE user_id = ? AND week_start = ? AND week_end = ?
            `, [userId, week.start, week.end]);
            
            // Determinar se pode fazer entrega
            let available = true;
            let reason = null;
            
            if (existingDelivery) {
                if (existingDelivery.status === 'approved' && !existingDelivery.is_partial) {
                    available = false;
                    reason = 'Farm completo aprovado';
                } else if (existingDelivery.status === 'pending' && !existingDelivery.is_partial) {
                    available = false;
                    reason = 'Aguardando aprovação';
                } else if (existingDelivery.is_partial) {
                    available = true; // Pode continuar adicionando
                    reason = 'Em progresso';
                }
            }
            
            if (existingJustification) {
                available = false;
                reason = 'Ausência justificada';
            }
            
            weeks.push({
                offset: i,
                ...week,
                available: available,
                reason: reason,
                hasDelivery: !!existingDelivery,
                isPartial: existingDelivery?.is_partial || false,
                hasJustification: !!existingJustification
            });
        }
        
        res.json({ weeks });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/', requireAuth, (req, res) => {
    upload(req, res, async (err) => {
        if (err) {
            return res.status(400).json({ error: err.message });
        }
        
        try {
            const { materials, description, week_offset } = req.body;
            const userId = req.session.user.id;
            
            // Usar a semana selecionada ou a atual
            const offset = parseInt(week_offset) || 0;
            if (offset < 0 || offset > 3) {
                return res.status(400).json({ error: 'Semana inválida' });
            }
            const week = getWeekWithOffset(offset);
            
            // Deletar entrega rejeitada se existir (permite refazer)
            await runQuery(`
                DELETE FROM delivery_screenshots WHERE delivery_id IN (
                    SELECT id FROM deliveries WHERE user_id = ? AND week_start = ? AND week_end = ? AND status = 'rejected'
                )
            `, [userId, week.start, week.end]);
            await runQuery(`
                DELETE FROM delivery_items WHERE delivery_id IN (
                    SELECT id FROM deliveries WHERE user_id = ? AND week_start = ? AND week_end = ? AND status = 'rejected'
                )
            `, [userId, week.start, week.end]);
            await runQuery(`
                DELETE FROM deliveries WHERE user_id = ? AND week_start = ? AND week_end = ? AND status = 'rejected'
            `, [userId, week.start, week.end]);
            
            // Verificar se já tem entrega APROVADA na semana (farm completo já aprovado)
            const approvedDelivery = await getOne(`
                SELECT * FROM deliveries 
                WHERE user_id = ? AND week_start = ? AND week_end = ? AND status = 'approved' AND is_partial = 0
            `, [userId, week.start, week.end]);
            
            if (approvedDelivery) {
                return res.status(400).json({ 
                    error: 'Seu farm desta semana já foi aprovado! Aguarde a próxima semana.' 
                });
            }
            
            // Verificar se já tem entrega PENDENTE de aprovação (farm completo aguardando)
            const pendingCompleteDelivery = await getOne(`
                SELECT * FROM deliveries 
                WHERE user_id = ? AND week_start = ? AND week_end = ? AND status = 'pending' AND is_partial = 0
            `, [userId, week.start, week.end]);
            
            if (pendingCompleteDelivery) {
                return res.status(400).json({ 
                    error: 'Você já tem um farm completo aguardando aprovação nesta semana.' 
                });
            }
            
            // Buscar entrega parcial existente (em progresso)
            let existingPartialDelivery = await getOne(`
                SELECT * FROM deliveries 
                WHERE user_id = ? AND week_start = ? AND week_end = ? AND is_partial = 1
            `, [userId, week.start, week.end]);
            
            // Verificar se enviou pelo menos 1 imagem (obrigatório se não tem entrega anterior)
            const hasNewScreenshots = req.files && req.files.length > 0;
            
            if (!existingPartialDelivery && !hasNewScreenshots) {
                return res.status(400).json({ error: 'Envie pelo menos 1 print do farm' });
            }
            
            // Se tem entrega anterior, verificar se ela já tem screenshots
            if (existingPartialDelivery && !hasNewScreenshots) {
                const existingScreenshots = await getAll(
                    'SELECT id FROM delivery_screenshots WHERE delivery_id = ?',
                    [existingPartialDelivery.id]
                );
                if (!existingScreenshots || existingScreenshots.length === 0) {
                    return res.status(400).json({ error: 'Envie pelo menos 1 print do farm' });
                }
            }
            
            // Parse materials JSON
            let materialsArray;
            try {
                materialsArray = JSON.parse(materials);
            } catch (e) {
                return res.status(400).json({ error: 'Dados de materiais inválidos' });
            }
            
            if (!materialsArray || materialsArray.length === 0) {
                return res.status(400).json({ error: 'Informe pelo menos um material' });
            }
            
            let deliveryId;
            
            if (existingPartialDelivery) {
                // ADICIONAR à entrega existente
                deliveryId = existingPartialDelivery.id;
                console.log('📦 Adicionando à entrega existente:', deliveryId);
                
                // Somar os valores aos itens existentes
                for (const item of materialsArray) {
                    const amount = parseInt(item.amount) || 0;
                    if (amount > 0) {
                        // Verificar se já existe esse material na entrega
                        const existingItem = await getOne(`
                            SELECT * FROM delivery_items 
                            WHERE delivery_id = ? AND material_id = ?
                        `, [deliveryId, item.material_id]);
                        
                        if (existingItem) {
                            // Somar ao valor existente
                            const newAmount = existingItem.amount + amount;
                            await runQuery(
                                'UPDATE delivery_items SET amount = ? WHERE id = ?',
                                [newAmount, existingItem.id]
                            );
                            console.log('📦 Atualizado item:', { material_id: item.material_id, oldAmount: existingItem.amount, added: amount, newAmount });
                        } else {
                            // Inserir novo item
                            await runQuery(
                                'INSERT INTO delivery_items (delivery_id, material_id, amount) VALUES (?, ?, ?)',
                                [deliveryId, parseInt(item.material_id), amount]
                            );
                            console.log('📦 Inserido novo item:', { material_id: item.material_id, amount });
                        }
                    }
                }
            } else {
                // CRIAR nova entrega
                // Converter primeira imagem para screenshot_url (compatibilidade)
                const firstFile = req.files[0];
                const firstBase64 = firstFile.buffer.toString('base64');
                const firstMimeType = firstFile.mimetype;
                const screenshot_url = `data:${firstMimeType};base64,${firstBase64}`;
                
                console.log('📦 Criando nova entrega:', { userId, week, description });
                
                // Criar a entrega principal como parcial (será atualizada se completar)
                const result = await runQuery(
                    'INSERT INTO deliveries (user_id, week_start, week_end, description, screenshot_url, is_partial, status) VALUES (?, ?, ?, ?, ?, 1, ?)',
                    [userId, week.start, week.end, description || '', screenshot_url, 'in_progress']
                );
                
                deliveryId = result.lastID;
                console.log('📦 Delivery criado:', deliveryId);
                
                // Inserir os itens de cada material
                for (const item of materialsArray) {
                    const amount = parseInt(item.amount) || 0;
                    if (amount > 0) {
                        await runQuery(
                            'INSERT INTO delivery_items (delivery_id, material_id, amount) VALUES (?, ?, ?)',
                            [deliveryId, parseInt(item.material_id), amount]
                        );
                        console.log('📦 Inserindo item:', { material_id: item.material_id, amount });
                    }
                }
            }
            
            // Salvar os novos screenshots (se houver)
            if (hasNewScreenshots) {
                console.log('📸 Salvando', req.files.length, 'novos screenshots...');
                for (const file of req.files) {
                    const base64 = file.buffer.toString('base64');
                    const mimeType = file.mimetype;
                    const dataUrl = `data:${mimeType};base64,${base64}`;
                    
                    try {
                        await runQuery(
                            'INSERT INTO delivery_screenshots (delivery_id, screenshot_url) VALUES (?, ?)',
                            [deliveryId, dataUrl]
                        );
                        console.log('📸 Screenshot salvo para delivery', deliveryId);
                    } catch (screenshotError) {
                        console.error('⚠️ Erro ao salvar screenshot:', screenshotError.message);
                    }
                }
            } else {
                console.log('📸 Nenhum novo screenshot para salvar (usando existentes)');
            }
            
            // Verificar se agora completou 700 de cada material
            const allMaterials = await getAll('SELECT id, name, weekly_goal FROM materials WHERE active = 1');
            const deliveryItems = await getAll('SELECT material_id, amount FROM delivery_items WHERE delivery_id = ?', [deliveryId]);
            
            let isComplete = true;
            let progressDetails = [];
            
            for (const material of allMaterials) {
                const item = deliveryItems.find(i => i.material_id === material.id);
                const currentAmount = item ? item.amount : 0;
                const goal = material.weekly_goal || DEFAULT_WEEKLY_GOAL;
                const percentage = Math.min(100, Math.round((currentAmount / goal) * 100));
                
                progressDetails.push({
                    name: material.name,
                    current: currentAmount,
                    goal: goal,
                    percentage: percentage,
                    complete: currentAmount >= goal
                });
                
                if (currentAmount < goal) {
                    isComplete = false;
                }
            }
            
            if (isComplete) {
                // Farm completo! Atualizar status para pending (aguardando aprovação)
                await runQuery(
                    'UPDATE deliveries SET is_partial = 0, status = ? WHERE id = ?',
                    ['pending', deliveryId]
                );
                
                res.json({ 
                    success: true, 
                    message: `🎉 Farm COMPLETO! Semana ${week.label} - Enviado para aprovação!`,
                    deliveryId: deliveryId,
                    isComplete: true,
                    progress: progressDetails
                });
            } else {
                // Ainda parcial - manter em progresso
                const remaining = progressDetails.filter(p => !p.complete).map(p => `${p.name}: ${p.current}/${p.goal}`).join(', ');
                
                res.json({ 
                    success: true, 
                    message: `📝 Entrega registrada! Falta completar: ${remaining}`,
                    deliveryId: deliveryId,
                    isComplete: false,
                    progress: progressDetails
                });
            }
        } catch (error) {
            console.error('❌ Erro em POST /delivery:', error);
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
        
        const deliveries = await getAll(`
            SELECT d.*, a.name as approved_by_name
            FROM deliveries d
            LEFT JOIN users a ON d.approved_by = a.id
            WHERE d.user_id = ?
            ORDER BY d.week_start DESC, d.created_at DESC
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
                (SELECT COUNT(*) FROM deliveries WHERE user_id = ? AND status = 'rejected') as rejected_count
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

module.exports = router;
