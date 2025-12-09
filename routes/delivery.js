const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { runQuery, getOne, getAll, getCurrentWeek } = require('../database/db');

const router = express.Router();

// Meta semanal por material
const WEEKLY_GOAL = 700;

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

// Obter semana atual
router.get('/current-week', requireAuth, async (req, res) => {
    try {
        const week = getCurrentWeek();
        const userId = req.session.user.id;
        
        // Verificar se já tem entrega na semana atual
        const existingDelivery = await getOne(`
            SELECT * FROM deliveries 
            WHERE user_id = ? AND week_start = ? AND week_end = ?
        `, [userId, week.start, week.end]);
        
        // Verificar se já tem justificativa na semana atual
        const existingJustification = await getOne(`
            SELECT * FROM justifications 
            WHERE user_id = ? AND week_start = ? AND week_end = ?
        `, [userId, week.start, week.end]);
        
        res.json({ 
            week,
            hasDelivery: !!existingDelivery,
            deliveryStatus: existingDelivery?.status || null,
            hasJustification: !!existingJustification,
            justificationStatus: existingJustification?.status || null
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Obter meta semanal
router.get('/weekly-goal', requireAuth, (req, res) => {
    res.json({ weeklyGoal: WEEKLY_GOAL });
});

// Obter lista de materiais
router.get('/materials', requireAuth, async (req, res) => {
    try {
        const materials = await getAll('SELECT * FROM materials WHERE active = 1 ORDER BY name');
        res.json({ materials, weeklyGoal: WEEKLY_GOAL });
    } catch (error) {
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
            
            // Verificar se já tem entrega nessa semana
            const existingDelivery = await getOne(`
                SELECT * FROM deliveries 
                WHERE user_id = ? AND week_start = ? AND week_end = ?
            `, [userId, week.start, week.end]);
            
            // Verificar se já tem justificativa nessa semana
            const existingJustification = await getOne(`
                SELECT * FROM justifications 
                WHERE user_id = ? AND week_start = ? AND week_end = ?
            `, [userId, week.start, week.end]);
            
            weeks.push({
                offset: i,
                ...week,
                available: !existingDelivery && !existingJustification,
                hasDelivery: !!existingDelivery,
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
            
            // Verificar se já tem entrega na semana
            const existingDelivery = await getOne(`
                SELECT * FROM deliveries 
                WHERE user_id = ? AND week_start = ? AND week_end = ?
            `, [userId, week.start, week.end]);
            
            if (existingDelivery) {
                return res.status(400).json({ 
                    error: 'Você já registrou farm para esta semana. Aguarde a próxima semana.' 
                });
            }
            
            // Verificar se enviou pelo menos 1 imagem
            if (!req.files || req.files.length === 0) {
                return res.status(400).json({ error: 'Envie pelo menos 1 print do farm' });
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
            
            // Verificar se é entrega parcial (algum material abaixo de 700)
            let isPartial = false;
            for (const item of materialsArray) {
                const amount = parseInt(item.amount) || 0;
                if (amount > 0 && amount < WEEKLY_GOAL) {
                    isPartial = true;
                    break;
                }
            }
            
            // Converter primeira imagem para screenshot_url (compatibilidade)
            const firstFile = req.files[0];
            const firstBase64 = firstFile.buffer.toString('base64');
            const firstMimeType = firstFile.mimetype;
            const screenshot_url = `data:${firstMimeType};base64,${firstBase64}`;
            
            console.log('📦 Criando delivery:', { userId, week, description, isPartial, totalScreenshots: req.files.length });
            
            // Criar a entrega principal com a semana
            const result = await runQuery(
                'INSERT INTO deliveries (user_id, week_start, week_end, description, screenshot_url, is_partial) VALUES (?, ?, ?, ?, ?, ?)',
                [userId, week.start, week.end, description || '', screenshot_url, isPartial ? 1 : 0]
            );
            
            console.log('📦 Delivery criado, result:', result);
            
            const deliveryId = result.lastID;
            
            if (!deliveryId) {
                console.error('❌ Erro: deliveryId não retornado');
                return res.status(500).json({ error: 'Erro ao criar entrega - ID não retornado' });
            }
            
            // Salvar todos os screenshots na tabela delivery_screenshots
            for (const file of req.files) {
                const base64 = file.buffer.toString('base64');
                const mimeType = file.mimetype;
                const dataUrl = `data:${mimeType};base64,${base64}`;
                
                await runQuery(
                    'INSERT INTO delivery_screenshots (delivery_id, screenshot_url) VALUES (?, ?)',
                    [deliveryId, dataUrl]
                );
            }
            
            // Inserir os itens de cada material
            for (const item of materialsArray) {
                if (item.amount > 0) {
                    console.log('📦 Inserindo item:', { deliveryId, material_id: item.material_id, amount: item.amount });
                    await runQuery(
                        'INSERT INTO delivery_items (delivery_id, material_id, amount) VALUES (?, ?, ?)',
                        [deliveryId, parseInt(item.material_id), parseInt(item.amount)]
                    );
                }
            }
            
            const statusMsg = isPartial ? 
                `Farm da semana ${week.label} registrado como PARCIALMENTE PAGO! Aguardando aprovação.` :
                `Farm da semana ${week.label} registrado! Aguardando aprovação.`;
            
            res.json({ 
                success: true, 
                message: statusMsg,
                deliveryId: deliveryId,
                isPartial: isPartial
            });
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
            
            // Buscar screenshots adicionais
            delivery.screenshots = await getAll(`
                SELECT * FROM delivery_screenshots WHERE delivery_id = ?
            `, [delivery.id]);
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
