const express = require('express');
const bcrypt = require('bcryptjs');
const { runQuery, getOne, getAll } = require('../database/db');
const {
    getCurrentCommandments,
    getUserCommandmentStatus,
    recordCommandmentResponse
} = require('../services/familyCommandments');
const emailService = require('../services/email');

const router = express.Router();

const systemPassports = new Set(['0', 'admin']);

function needsCapitalNickname(user = {}) {
    const passport = String(user.passport || '').trim().toLowerCase();
    if (!passport || systemPassports.has(passport)) return false;
    return !String(user.capital_nickname || '').trim();
}

// Login (usando passaporte)
router.post('/login', async (req, res) => {
    try {
        const { passport, password } = req.body;
        
        // Primeiro, buscar o usuário sem filtrar por active
        const user = await getOne('SELECT * FROM users WHERE passport = ?', [passport]);
        
        if (!user) {
            return res.status(401).json({ error: 'Passaporte não encontrado' });
        }
        
        // Verificar se o usuário está desativado
        if (user.active === 0 || user.active === false) {
            return res.status(403).json({ error: 'Usuário desativado. Entre em contato com um administrador.' });
        }
        
        const validPassword = bcrypt.compareSync(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Senha incorreta' });
        }
        
        req.session.user = {
            id: user.id,
            name: user.capital_nickname || user.name,
            original_name: user.name,
            passport: user.passport,
            email: user.email,
            role: user.role,
            capital_nickname: user.capital_nickname || null
        };

        await runQuery('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
        const commandments = await getUserCommandmentStatus(user.id);
        
        res.json({ 
            success: true, 
            user: {
                ...req.session.user,
                commandments_required: commandments.requiresAcceptance,
                requires_capital_nickname: !commandments.requiresAcceptance && needsCapitalNickname(user)
            }
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
router.get('/me', async (req, res) => {
    if (req.session.user) {
        try {
            const [userCheck, userGroups] = await Promise.all([
                getOne('SELECT id, name, passport, email, active, role, capital_nickname FROM users WHERE id = ?', [req.session.user.id]),
                getAll('SELECT group_name FROM user_groups WHERE user_id = ?', [req.session.user.id])
            ]);
            
            if (!userCheck || userCheck.active === 0 || userCheck.active === false) {
                req.session.destroy();
                return res.status(403).json({ error: 'Usuário desativado' });
            }
            
            let groups = userGroups.map(g => g.group_name);
            
            if (groups.length === 0 && userCheck.role) {
                groups = [userCheck.role];
            }
            
            // Atualizar a sessão com os grupos mais recentes
            req.session.user.groups = groups;
            req.session.user.role = groups[0] || userCheck.role; // Atualizar role também
            req.session.user.name = userCheck.capital_nickname || userCheck.name;
            req.session.user.original_name = userCheck.name;
            req.session.user.passport = userCheck.passport;
            req.session.user.email = userCheck.email;
            req.session.user.capital_nickname = userCheck.capital_nickname || null;
            
            const commandments = await getUserCommandmentStatus(req.session.user.id);

            res.json({ 
                user: {
                    ...req.session.user,
                    groups: groups,
                    role: groups[0] || userCheck.role,
                    commandments_required: commandments.requiresAcceptance,
                    requires_capital_nickname: !commandments.requiresAcceptance && needsCapitalNickname(userCheck, groups)
                }
            });
        } catch (error) {
            console.error('❌ Erro ao buscar grupos do usuário:', error);
            // Fallback para role antigo se der erro
            res.json({ user: req.session.user });
        }
    } else {
        res.status(401).json({ error: 'Não autenticado' });
    }
});

router.post('/capital-nickname', async (req, res) => {
    try {
        if (!req.session.user) {
            return res.status(401).json({ error: 'Nao autenticado' });
        }

        const nickname = String(req.body?.capital_nickname || '').trim().replace(/\s+/g, ' ');
        if (!nickname) {
            return res.status(400).json({ error: 'Informe seu vulgo na Capital' });
        }
        if (nickname.length < 2 || nickname.length > 40) {
            return res.status(400).json({ error: 'O vulgo deve ter entre 2 e 40 caracteres' });
        }

        const [user, userGroups] = await Promise.all([
            getOne('SELECT id, name, passport, email, active, role, capital_nickname FROM users WHERE id = ?', [req.session.user.id]),
            getAll('SELECT group_name FROM user_groups WHERE user_id = ?', [req.session.user.id])
        ]);

        if (!user || user.active === 0 || user.active === false) {
            req.session.destroy();
            return res.status(403).json({ error: 'Usuario desativado' });
        }

        const groups = userGroups.map(g => g.group_name);
        if (!needsCapitalNickname(user, groups)) {
            return res.json({
                success: true,
                user: {
                    ...req.session.user,
                    capital_nickname: user.capital_nickname || null,
                    requires_capital_nickname: false
                }
            });
        }

        await runQuery('UPDATE users SET capital_nickname = ? WHERE id = ?', [nickname, user.id]);
        if (typeof global.__clearWeeklyStatusCache === 'function') {
            global.__clearWeeklyStatusCache();
        }

        req.session.user = {
            ...req.session.user,
            name: nickname,
            original_name: user.name,
            passport: user.passport,
            email: user.email,
            role: groups[0] || user.role,
            groups,
            capital_nickname: nickname
        };

        res.json({
            success: true,
            user: {
                ...req.session.user,
                requires_capital_nickname: false
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/commandments-status', async (req, res) => {
    try {
        if (!req.session.user) {
            return res.status(401).json({ error: 'Nao autenticado' });
        }

        const status = await getUserCommandmentStatus(req.session.user.id);
        res.json({
            title: status.title,
            content: status.content,
            version: status.version,
            active: status.active,
            status: status.status,
            responded_at: status.responded_at,
            requiresAcceptance: status.requiresAcceptance
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/commandments-response', async (req, res) => {
    try {
        if (!req.session.user) {
            return res.status(401).json({ error: 'Nao autenticado' });
        }

        const { accepted } = req.body || {};
        const current = await getCurrentCommandments();

        if (!current.requiresAcceptance) {
            return res.json({ success: true, requiresAcceptance: false });
        }

        const status = accepted === true ? 'accepted' : 'refused';
        await recordCommandmentResponse(req.session.user.id, current.version, status);

        if (status === 'refused') {
            return req.session.destroy(() => {
                res.json({ success: true, accepted: false, redirect: '/' });
            });
        }

        res.json({ success: true, accepted: true, redirect: req.session.user.role === 'member' ? '/dashboard' : '/admin' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Cargos que podem gerenciar membros
const adminRoles = ['super_admin', '01', '02', 'gerente_farm', 'gerente_acao', 'gerente_recrutamento', 'gerente_encomendas', 'gerente_vendas', 'gerente_de_vendas', 'gerente_geral'];

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
        
        const { name, passport, email, password, role, member_slot, manager_slot } = req.body;
        
        if (!name || !passport || !password) {
            return res.status(400).json({ error: 'Nome, passaporte e senha são obrigatórios' });
        }
        
        const passportUpper = passport.toUpperCase().trim();
        
        const existingUser = await getOne('SELECT id FROM users WHERE passport = ?', [passportUpper]);
        if (existingUser) {
            return res.status(400).json({ error: 'Passaporte já cadastrado' });
        }
        
        const hashedPassword = bcrypt.hashSync(password, 10);
        
        // Buscar grupos válidos do banco de dados
        let validRoles = ['member']; // fallback
        try {
            const rolesFromDB = await getAll('SELECT role_name FROM role_permissions WHERE active = 1');
            if (rolesFromDB && rolesFromDB.length > 0) {
                validRoles = rolesFromDB.map(r => r.role_name);
            }
        } catch (err) {
            console.log('Usando validRoles padrão:', err.message);
            validRoles = ['member', '01', '02', 'gerente_farm', 'gerente_acao', 'gerente_recrutamento', 'gerente_encomendas', 'gerente_vendas', 'gerente_de_vendas', 'gerente_geral'];
        }
        
        const userRole = validRoles.includes(role) ? role : 'member';
        
        const result = await runQuery(
            'INSERT INTO users (name, passport, email, password, role, member_slot, manager_slot) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [
                name.trim(),
                passportUpper,
                email || null,
                hashedPassword,
                userRole,
                member_slot ? String(member_slot).trim() : null,
                manager_slot ? String(manager_slot).trim() : null
            ]
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

// Atualizar perfil do usuário (nome e email)
router.put('/update-profile', async (req, res) => {
    try {
        if (!req.session.user) {
            return res.status(401).json({ error: 'Não autenticado' });
        }
        
        const { name, email } = req.body;
        
        if (!name || name.trim().length === 0) {
            return res.status(400).json({ error: 'Nome é obrigatório' });
        }
        
        // Atualizar dados do usuário
        await runQuery(
            'UPDATE users SET name = ?, email = ? WHERE id = ?',
            [name.trim(), email?.trim() || null, req.session.user.id]
        );
        
        // Atualizar sessão
        req.session.user.original_name = name.trim();
        req.session.user.name = req.session.user.capital_nickname || name.trim();
        req.session.user.email = email?.trim() || null;
        
        console.log(`👤 Perfil atualizado: ${name} (ID: ${req.session.user.id})`);
        
        res.json({ success: true, message: 'Dados atualizados com sucesso!' });
    } catch (error) {
        console.error('Erro ao atualizar perfil:', error);
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
        
        // Verificar se o usuário existe (sem filtrar por active primeiro)
        const user = await getOne('SELECT id, name, active, email FROM users WHERE passport = ?', [passportUpper]);
        if (!user) {
            return res.status(404).json({ error: 'Passaporte não encontrado' });
        }
        
        // Verificar se o usuário está desativado
        if (user.active === 0 || user.active === false) {
            return res.status(403).json({ error: 'Usuário desativado. Entre em contato com um administrador.' });
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
        
        const emailConfigured = emailService.isEmailConfigured();
        const hasEmail = !!(user.email && String(user.email).trim());

        // Reaproveita a solicitação pendente (reenviando o mesmo código) em vez de bloquear
        const existingRequest = await getOne(
            'SELECT id, reset_code FROM password_resets WHERE user_id = ? AND status = ?',
            [user.id, 'pending']
        );

        let resetCode;
        if (existingRequest) {
            resetCode = existingRequest.reset_code;
            if (!resetCode) {
                resetCode = String(Math.floor(100000 + Math.random() * 900000));
                await runQuery('UPDATE password_resets SET reset_code = ? WHERE id = ?', [resetCode, existingRequest.id]);
            }
        } else {
            resetCode = String(Math.floor(100000 + Math.random() * 900000));
            await runQuery(
                'INSERT INTO password_resets (user_id, status, reset_code) VALUES (?, ?, ?)',
                [user.id, 'pending', resetCode]
            );
        }

        // Sem email cadastrado, mas o envio está disponível → pedir um email (modal no front)
        if (!hasEmail && emailConfigured) {
            console.log(`🔐 Recuperação: ${user.name} (${passportUpper}) sem email — solicitando cadastro de email`);
            return res.json({
                success: true,
                needsEmail: true,
                message: 'Você ainda não tem email cadastrado. Informe um email para receber o código de recuperação.'
            });
        }

        // Tentar enviar por email (se o membro tiver email e o envio estiver configurado)
        let emailSent = false;
        if (hasEmail && emailConfigured) {
            try {
                await emailService.sendPasswordResetEmail(user.email, user.name, resetCode);
                emailSent = true;
            } catch (mailErr) {
                console.error('Falha ao enviar email de recuperação:', mailErr.message);
            }
        }

        console.log(`🔐 Solicitação de recuperação de senha: ${user.name} (${passportUpper}) - Código: ${resetCode} - Email: ${emailSent ? user.email : 'não enviado'}`);

        if (!emailSent) {
            return res.status(503).json({
                error: !emailConfigured
                    ? 'A recuperação de senha por email está indisponível no momento. Tente novamente mais tarde.'
                    : 'Não conseguimos enviar o email agora. Tente novamente em instantes.'
            });
        }

        res.json({
            success: true,
            emailSent: true,
            message: `Enviamos um código de recuperação para o seu email (${emailService.maskEmail(user.email)}). Confira a caixa de entrada e o spam.`
        });
    } catch (error) {
        console.error('Erro ao solicitar recuperação:', error);
        res.status(500).json({ error: error.message });
    }
});

// Cadastrar email de recuperação (para quem não tem email) e enviar o código
router.post('/set-recovery-email', async (req, res) => {
    try {
        const { passport, email } = req.body;

        if (!passport || !email) {
            return res.status(400).json({ error: 'Passaporte e email são obrigatórios' });
        }

        const emailTrim = String(email).trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
            return res.status(400).json({ error: 'Informe um email válido' });
        }

        if (!emailService.isEmailConfigured()) {
            return res.status(400).json({ error: 'O envio de email não está disponível. Peça o código a um administrador.' });
        }

        const passportUpper = passport.toUpperCase().trim();
        const user = await getOne('SELECT id, name, active, email FROM users WHERE passport = ?', [passportUpper]);
        if (!user) {
            return res.status(404).json({ error: 'Passaporte não encontrado' });
        }
        if (user.active === 0 || user.active === false) {
            return res.status(403).json({ error: 'Usuário desativado. Entre em contato com um administrador.' });
        }

        // Segurança: só permite definir email se a conta ainda não tiver um (evita sequestro de conta)
        if (user.email && String(user.email).trim()) {
            return res.status(400).json({ error: 'Este passaporte já tem um email cadastrado. O código vai para esse email. Se você não tem acesso a ele, fale com um administrador.' });
        }

        // Salva o email informado na conta
        await runQuery('UPDATE users SET email = ? WHERE id = ?', [emailTrim, user.id]);

        // Pega/cria o código pendente
        const pending = await getOne(
            'SELECT id, reset_code FROM password_resets WHERE user_id = ? AND status = ?',
            [user.id, 'pending']
        );
        let resetCode;
        if (pending && pending.reset_code) {
            resetCode = pending.reset_code;
        } else if (pending) {
            resetCode = String(Math.floor(100000 + Math.random() * 900000));
            await runQuery('UPDATE password_resets SET reset_code = ? WHERE id = ?', [resetCode, pending.id]);
        } else {
            resetCode = String(Math.floor(100000 + Math.random() * 900000));
            await runQuery('INSERT INTO password_resets (user_id, status, reset_code) VALUES (?, ?, ?)', [user.id, 'pending', resetCode]);
        }

        // Envia o código para o email informado
        try {
            await emailService.sendPasswordResetEmail(emailTrim, user.name, resetCode);
        } catch (mailErr) {
            console.error('Falha ao enviar email (set-recovery-email):', mailErr.message);
            return res.status(500).json({ error: 'Não conseguimos enviar o email agora. Tente novamente em instantes ou peça o código a um administrador.' });
        }

        console.log(`🔐 Email de recuperação cadastrado: ${user.name} (${passportUpper}) -> ${emailTrim} - Código enviado`);

        res.json({
            success: true,
            emailSent: true,
            message: `Email cadastrado! Enviamos um código para ${emailService.maskEmail(emailTrim)}. Confira a caixa de entrada e o spam.`
        });
    } catch (error) {
        console.error('Erro ao cadastrar email de recuperação:', error);
        res.status(500).json({ error: error.message });
    }
});

// Usar código de recuperação para definir nova senha
router.post('/reset-password-with-code', async (req, res) => {
    try {
        const { passport, code, newPassword } = req.body;
        
        if (!passport || !code || !newPassword) {
            return res.status(400).json({ error: 'Passaporte, código e nova senha são obrigatórios' });
        }
        
        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres' });
        }
        
        const passportUpper = passport.toUpperCase().trim();
        const codeClean = code.trim();
        
        const user = await getOne('SELECT id, name, active FROM users WHERE passport = ?', [passportUpper]);
        if (!user) {
            return res.status(404).json({ error: 'Passaporte não encontrado' });
        }
        
        if (user.active === 0 || user.active === false) {
            return res.status(403).json({ error: 'Usuário desativado' });
        }
        
        const resetRequest = await getOne(
            'SELECT id FROM password_resets WHERE user_id = ? AND status = ? AND reset_code = ?',
            [user.id, 'pending', codeClean]
        );
        
        if (!resetRequest) {
            return res.status(400).json({ error: 'Código inválido ou expirado' });
        }
        
        const hashedPassword = bcrypt.hashSync(newPassword, 10);
        await runQuery('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, user.id]);
        
        await runQuery(
            'UPDATE password_resets SET status = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?',
            ['used', resetRequest.id]
        );
        
        console.log(`🔐 Senha redefinida via código para ${user.name} (${passportUpper})`);
        
        res.json({ success: true, message: 'Senha redefinida com sucesso! Faça login com sua nova senha.' });
    } catch (error) {
        console.error('Erro ao resetar senha com código:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
