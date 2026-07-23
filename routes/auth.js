const express = require('express');
const bcrypt = require('bcryptjs');
const { runQuery, getOne, getAll } = require('../database/db');
const {
    getCurrentCommandments,
    getUserCommandmentStatus,
    recordCommandmentResponse
} = require('../services/familyCommandments');
const router = express.Router();

// Senha temporária aplicada quando o membro clica em "Esqueci minha senha".
// Ao logar com ela, o sistema obriga a definir uma nova.
const TEMP_PASSWORD = 'senha123';
const MIN_PASSWORD_LENGTH = 6;

const systemPassports = new Set(['0', 'admin']);

function clientIp(req) {
    return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
        || req.socket?.remoteAddress
        || '';
}

// Registra toda tentativa de reset — é o extrato que o super admin consulta
async function logPasswordReset({ userId, passport, userName, success, reason, ip }) {
    try {
        await runQuery(
            'INSERT INTO password_reset_log (user_id, passport_tried, user_name, success, reason, ip) VALUES (?, ?, ?, ?, ?, ?)',
            [userId || null, String(passport || ''), userName || null, success ? 1 : 0, reason || null, ip || null]
        );
    } catch (e) {
        console.error('⚠️ Falha ao gravar log de reset de senha:', e.message);
    }
}

function mustChangePassword(user, typedPassword) {
    if (user.must_change_password === 1 || user.must_change_password === true) return true;
    // Rede de segurança: se a senha atual é a temporária, força a troca de qualquer jeito
    return typedPassword === TEMP_PASSWORD;
}

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

        // Entrou com a senha temporária (ou está marcado): troca obrigatória antes de
        // criar a sessão. Nada de logar de fato enquanto a senha for a padrão.
        if (mustChangePassword(user, password)) {
            return res.json({
                success: false,
                mustChangePassword: true,
                passport: user.passport,
                message: 'Sua senha foi redefinida. Escolha uma nova senha para continuar.'
            });
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
                getOne('SELECT id, name, passport, email, active, role, capital_nickname, member_slot, manager_slot, created_at FROM users WHERE id = ?', [req.session.user.id]),
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
            // role = primeiro grupo QUE NÃO SEJA 'member' (senão gerentes promovidos,
            // que têm 'member' antes na lista, ficariam com role 'member' e sem permissão)
            const primaryRole = groups.find(g => g && g !== 'member') || groups[0] || userCheck.role;
            req.session.user.groups = groups;
            req.session.user.role = primaryRole; // Atualizar role também
            req.session.user.name = userCheck.capital_nickname || userCheck.name;
            req.session.user.original_name = userCheck.name;
            req.session.user.passport = userCheck.passport;
            req.session.user.email = userCheck.email;
            req.session.user.capital_nickname = userCheck.capital_nickname || null;
            req.session.user.member_slot = userCheck.member_slot || null;
            req.session.user.manager_slot = userCheck.manager_slot || null;
            req.session.user.created_at = userCheck.created_at || null;
            
            const commandments = await getUserCommandmentStatus(req.session.user.id);

            res.json({
                user: {
                    ...req.session.user,
                    groups: groups,
                    role: primaryRole,
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

// Atualizar perfil do usuário (nome, vulgo, email e, opcionalmente, nova senha).
// Cargo, slot e passaporte NÃO são alteráveis aqui — só um admin muda.
router.put('/update-profile', async (req, res) => {
    try {
        if (!req.session.user) {
            return res.status(401).json({ error: 'Não autenticado' });
        }

        const { name, email, capital_nickname, newPassword } = req.body;

        if (!name || name.trim().length === 0) {
            return res.status(400).json({ error: 'Nome é obrigatório' });
        }

        const nickname = String(capital_nickname || '').trim().replace(/\s+/g, ' ');
        if (nickname && (nickname.length < 2 || nickname.length > 40)) {
            return res.status(400).json({ error: 'O vulgo deve ter entre 2 e 40 caracteres' });
        }

        const nickToSave = nickname || null;

        // Atualizar nome, vulgo e email
        await runQuery(
            'UPDATE users SET name = ?, capital_nickname = ?, email = ? WHERE id = ?',
            [name.trim(), nickToSave, email?.trim() || null, req.session.user.id]
        );

        // Nova senha (opcional): só troca se veio preenchida
        if (newPassword !== undefined && newPassword !== null && String(newPassword).length > 0) {
            if (String(newPassword).length < 6) {
                return res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres' });
            }
            const hashed = bcrypt.hashSync(String(newPassword), 10);
            await runQuery(
                'UPDATE users SET password = ?, must_change_password = 0 WHERE id = ?',
                [hashed, req.session.user.id]
            );
        }

        // Atualizar sessão
        req.session.user.original_name = name.trim();
        req.session.user.capital_nickname = nickToSave;
        req.session.user.name = nickToSave || name.trim();
        req.session.user.email = email?.trim() || null;

        // O vulgo entrou/mudou → limpa o cache do status semanal (mostra o vulgo novo)
        if (typeof global.__clearWeeklyStatusCache === 'function') {
            global.__clearWeeklyStatusCache();
        }

        console.log(`👤 Perfil atualizado: ${name} (ID: ${req.session.user.id})`);

        res.json({ success: true, message: 'Dados atualizados com sucesso!' });
    } catch (error) {
        console.error('Erro ao atualizar perfil:', error);
        res.status(500).json({ error: error.message });
    }
});

// "Esqueci minha senha": redefine a senha para a temporária.
// Qualquer pessoa pode solicitar informando o passaporte; toda tentativa fica no extrato.
router.post('/request-password-reset', async (req, res) => {
    const ip = clientIp(req);
    const passportRaw = req.body?.passport;

    try {
        if (!passportRaw) {
            return res.status(400).json({ error: 'Passaporte é obrigatório' });
        }

        const passportUpper = String(passportRaw).toUpperCase().trim();

        const user = await getOne(
            'SELECT id, name, capital_nickname, active FROM users WHERE passport = ?',
            [passportUpper]
        );

        if (!user) {
            await logPasswordReset({
                passport: passportUpper, success: false, reason: 'Passaporte não encontrado', ip
            });
            return res.status(404).json({ error: 'Passaporte não encontrado' });
        }

        if (user.active === 0 || user.active === false) {
            await logPasswordReset({
                userId: user.id, passport: passportUpper, userName: user.name,
                success: false, reason: 'Usuário desativado', ip
            });
            return res.status(403).json({ error: 'Usuário desativado. Entre em contato com um administrador.' });
        }

        const hashed = bcrypt.hashSync(TEMP_PASSWORD, 10);
        await runQuery(
            'UPDATE users SET password = ?, must_change_password = 1 WHERE id = ?',
            [hashed, user.id]
        );

        await logPasswordReset({
            userId: user.id, passport: passportUpper, userName: user.name,
            success: true, reason: 'Senha redefinida para a temporária', ip
        });

        console.log(`🔐 Reset de senha: ${user.name} (${passportUpper}) — senha temporária aplicada`);

        res.json({
            success: true,
            tempPassword: TEMP_PASSWORD,
            message: `Pronto! Sua senha agora é "${TEMP_PASSWORD}". Entre com ela que o sistema vai pedir para você criar uma nova.`
        });
    } catch (error) {
        console.error('Erro ao redefinir senha:', error);
        await logPasswordReset({
            passport: String(passportRaw || ''), success: false, reason: `Erro: ${error.message}`, ip
        });
        res.status(500).json({ error: 'Não foi possível redefinir a senha agora. Tente novamente.' });
    }
});

// Troca obrigatória depois de entrar com a senha temporária
router.post('/complete-password-change', async (req, res) => {
    try {
        const { passport, currentPassword, newPassword, confirmPassword } = req.body || {};

        if (!passport || !currentPassword || !newPassword || !confirmPassword) {
            return res.status(400).json({ error: 'Preencha todos os campos' });
        }

        if (newPassword !== confirmPassword) {
            return res.status(400).json({ error: 'As senhas não coincidem' });
        }

        if (String(newPassword).length < MIN_PASSWORD_LENGTH) {
            return res.status(400).json({ error: `A nova senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres` });
        }

        if (newPassword === TEMP_PASSWORD) {
            return res.status(400).json({ error: 'Escolha uma senha diferente da temporária' });
        }

        const passportUpper = String(passport).toUpperCase().trim();
        const user = await getOne('SELECT id, name, active, password FROM users WHERE passport = ?', [passportUpper]);

        if (!user) {
            return res.status(404).json({ error: 'Passaporte não encontrado' });
        }
        if (user.active === 0 || user.active === false) {
            return res.status(403).json({ error: 'Usuário desativado' });
        }

        // Confere a senha atual de novo: sem isso qualquer um trocaria a senha de qualquer um
        if (!bcrypt.compareSync(currentPassword, user.password)) {
            return res.status(401).json({ error: 'Senha atual incorreta' });
        }

        const hashed = bcrypt.hashSync(newPassword, 10);
        await runQuery(
            'UPDATE users SET password = ?, must_change_password = 0 WHERE id = ?',
            [hashed, user.id]
        );

        console.log(`🔐 Senha trocada após reset: ${user.name} (${passportUpper})`);

        res.json({ success: true, message: 'Senha alterada! Faça login com a nova senha.' });
    } catch (error) {
        console.error('Erro ao trocar senha:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
