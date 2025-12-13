const express = require('express');
const bcrypt = require('bcryptjs');
const { runQuery, getOne } = require('../database/db');

const router = express.Router();

// Login (usando passaporte)
router.post('/login', async (req, res) => {
    try {
        const { passport, password } = req.body;
        
        const user = await getOne('SELECT * FROM users WHERE passport = ? AND active = 1', [passport]);
        
        if (!user) {
            return res.status(401).json({ error: 'Passaporte não encontrado' });
        }
        
        const validPassword = bcrypt.compareSync(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Senha incorreta' });
        }
        
        req.session.user = {
            id: user.id,
            name: user.name,
            passport: user.passport,
            email: user.email,
            role: user.role
        };
        
        res.json({ 
            success: true, 
            user: req.session.user 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Logout
router.post('/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Get current user
router.get('/me', (req, res) => {
    if (req.session.user) {
        res.json({ user: req.session.user });
    } else {
        res.status(401).json({ error: 'Não autenticado' });
    }
});

// Cargos que podem gerenciar membros
const adminRoles = ['01', '02', 'gerente_farm', 'gerente_acao', 'gerente_recrutamento', 'gerente_encomendas', 'gerente_geral'];

// Cadastro público (membros se cadastram)
router.post('/register-public', async (req, res) => {
    try {
        const { name, passport, email, password } = req.body;
        
        if (!name || !passport || !password) {
            return res.status(400).json({ error: 'Nome, passaporte e senha são obrigatórios' });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres' });
        }
        
        const existingUser = await getOne('SELECT id FROM users WHERE passport = ?', [passport.toUpperCase()]);
        if (existingUser) {
            return res.status(400).json({ error: 'Passaporte já cadastrado' });
        }
        
        const hashedPassword = bcrypt.hashSync(password, 10);
        
        await runQuery(
            'INSERT INTO users (name, passport, email, password, role) VALUES (?, ?, ?, ?, ?)',
            [name.trim(), passport.toUpperCase(), email || null, hashedPassword, 'member']
        );
        
        res.json({ success: true, message: 'Cadastro realizado com sucesso!' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Register (apenas cargos administrativos podem registrar novos membros com cargos especiais)
router.post('/register', async (req, res) => {
    try {
        // Verifica se tem cargo administrativo
        if (!req.session.user || !adminRoles.includes(req.session.user.role)) {
            return res.status(403).json({ error: 'Sem permissão para registrar membros' });
        }
        
        const { name, passport, email, password, role } = req.body;
        
        if (!name || !passport || !password) {
            return res.status(400).json({ error: 'Nome, passaporte e senha são obrigatórios' });
        }
        
        const passportUpper = passport.toUpperCase().trim();
        
        const existingUser = await getOne('SELECT id FROM users WHERE passport = ?', [passportUpper]);
        if (existingUser) {
            return res.status(400).json({ error: 'Passaporte já cadastrado' });
        }
        
        const hashedPassword = bcrypt.hashSync(password, 10);
        const validRoles = ['member', '01', '02', 'gerente_farm', 'gerente_acao', 'gerente_recrutamento', 'gerente_encomendas', 'gerente_geral'];
        const userRole = validRoles.includes(role) ? role : 'member';
        
        const result = await runQuery(
            'INSERT INTO users (name, passport, email, password, role) VALUES (?, ?, ?, ?, ?)',
            [name.trim(), passportUpper, email || null, hashedPassword, userRole]
        );
        
        console.log('Usuário criado:', { name: name.trim(), passport: passportUpper, role: userRole, id: result.lastID });
        
        res.json({ success: true, message: 'Membro cadastrado com sucesso' });
    } catch (error) {
        console.error('Erro ao criar usuário:', error);
        res.status(500).json({ error: error.message });
    }
});

// Trocar a própria senha (usuário logado)
router.post('/change-password', async (req, res) => {
    try {
        if (!req.session.user) {
            return res.status(401).json({ error: 'Não autenticado' });
        }
        
        const { currentPassword, newPassword } = req.body;
        
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Senha atual e nova senha são obrigatórias' });
        }
        
        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres' });
        }
        
        // Buscar usuário atual com a senha
        const user = await getOne('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }
        
        // Verificar senha atual
        const validPassword = bcrypt.compareSync(currentPassword, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Senha atual incorreta' });
        }
        
        // Hash da nova senha
        const hashedPassword = bcrypt.hashSync(newPassword, 10);
        
        // Atualizar senha
        await runQuery('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, user.id]);
        
        console.log(`🔐 Senha alterada: ${user.name} (${user.passport})`);
        
        res.json({ success: true, message: 'Senha alterada com sucesso!' });
    } catch (error) {
        console.error('Erro ao trocar senha:', error);
        res.status(500).json({ error: error.message });
    }
});

// Solicitar recuperação de senha (qualquer pessoa pode solicitar)
router.post('/request-password-reset', async (req, res) => {
    try {
        const { passport } = req.body;
        
        if (!passport) {
            return res.status(400).json({ error: 'Passaporte é obrigatório' });
        }
        
        const passportUpper = passport.toUpperCase().trim();
        
        // Verificar se o usuário existe
        const user = await getOne('SELECT id, name FROM users WHERE passport = ? AND active = 1', [passportUpper]);
        if (!user) {
            return res.status(404).json({ error: 'Passaporte não encontrado' });
        }
        
        // Garantir que a tabela existe (PostgreSQL em produção pode não ter ainda)
        const isPostgres = process.env.DATABASE_URL ? true : false;
        try {
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
        } catch (tableError) {
            console.log('Tabela password_resets já existe ou erro:', tableError.message);
        }
        
        // Verificar se já tem uma solicitação pendente
        const existingRequest = await getOne(
            'SELECT id FROM password_resets WHERE user_id = ? AND status = ?',
            [user.id, 'pending']
        );
        
        if (existingRequest) {
            return res.status(400).json({ error: 'Você já tem uma solicitação de recuperação pendente. Aguarde a aprovação de um administrador.' });
        }
        
        // Criar solicitação
        await runQuery(
            'INSERT INTO password_resets (user_id, status) VALUES (?, ?)',
            [user.id, 'pending']
        );
        
        console.log(`🔐 Solicitação de recuperação de senha: ${user.name} (${passportUpper})`);
        
        res.json({ 
            success: true, 
            message: 'Solicitação enviada! Um administrador irá processar sua solicitação em breve.' 
        });
    } catch (error) {
        console.error('Erro ao solicitar recuperação:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
