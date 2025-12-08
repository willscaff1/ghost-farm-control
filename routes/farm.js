const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { runQuery, getOne, getAll } = require('../database/db');

const router = express.Router();

// Configuração do multer para upload de imagens
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, '..', 'uploads'));
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${uuidv4()}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (extname && mimetype) {
            return cb(null, true);
        }
        cb(new Error('Apenas imagens são permitidas'));
    }
});

// Middleware de autenticação
const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Não autenticado' });
    }
    next();
};

// Criar novo farm
router.post('/', requireAuth, upload.single('screenshot'), async (req, res) => {
    try {
        const { amount, description } = req.body;
        const userId = req.session.user.id;
        
        if (!amount || isNaN(amount)) {
            return res.status(400).json({ error: 'Valor de farm inválido' });
        }
        
        const screenshot = req.file ? req.file.filename : null;
        
        await runQuery(
            'INSERT INTO farms (user_id, amount, description, screenshot) VALUES (?, ?, ?, ?)',
            [userId, parseInt(amount), description || '', screenshot]
        );
        
        res.json({ success: true, message: 'Farm registrado com sucesso! Aguardando aprovação.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Listar meus farms
router.get('/my', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;
        
        const farms = await getAll(`
            SELECT f.*, u.username as approved_by_name
            FROM farms f
            LEFT JOIN users u ON f.approved_by = u.id
            WHERE f.user_id = ?
            ORDER BY f.created_at DESC
        `, [userId]);
        
        res.json({ farms });
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
                COUNT(*) as total_farms,
                SUM(CASE WHEN status = 'approved' THEN amount ELSE 0 END) as total_approved,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
                SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved_count,
                SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_count
            FROM farms WHERE user_id = ?
        `, [userId]);
        
        res.json({ stats });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
