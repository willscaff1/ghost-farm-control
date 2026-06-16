const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { runQuery, getOne, getAll, getCurrentWeek } = require('../database/db');
const {
    getCommandmentsReport,
    saveCommandments
} = require('../services/familyCommandments');

const isProduction = process.env.NODE_ENV === 'production' || !!process.env.DATABASE_URL;

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
const adminRoles = ['super_admin', '01', '02', 'gerente_farm', 'gerente_acao', 'gerente_recrutamento', 'gerente_encomendas', 'gerente_vendas', 'gerente_de_vendas', 'gerente_geral'];

// Cargos considerados gerência (para metas específicas)
const managerGroups = new Set([
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

const weaponSalesGroups = new Set([
    'super_admin',
    '01',
    '02',
    'gerente_geral',
    'gerente_vendas',
    'gerente_de_vendas'
]);

const normalizeGroupName = (groupName = '') => String(groupName)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const isManagerByGroups = (groups = []) => groups.some(g => managerGroups.has(normalizeGroupName(g)));

// Separação total por cargo:
// - Gerente (gerência/01/02) conta SOMENTE produtos marcados como 'manager'
// - Membro conta o resto ('member' e os legados 'both')
const productAppliesToRole = (product, isManager) => {
    const t = (product && product.target_role) || 'both';
    if (isManager) return t === 'manager';
    return t !== 'manager';
};

const weeklyStatusCache = new Map();
const WEEKLY_STATUS_CACHE_TTL_MS = parseInt(process.env.WEEKLY_STATUS_CACHE_TTL_MS, 10) || 60000;

const getWeeklyStatusCacheKey = (weekStart, weekEnd) => `${weekStart}:${weekEnd}`;

const getCachedWeeklyStatus = (weekStart, weekEnd) => {
    const cached = weeklyStatusCache.get(getWeeklyStatusCacheKey(weekStart, weekEnd));
    if (!cached || Date.now() - cached.timestamp > WEEKLY_STATUS_CACHE_TTL_MS) {
        weeklyStatusCache.delete(getWeeklyStatusCacheKey(weekStart, weekEnd));
        return null;
    }
    return cached.data;
};

const setCachedWeeklyStatus = (weekStart, weekEnd, data) => {
    weeklyStatusCache.set(getWeeklyStatusCacheKey(weekStart, weekEnd), {
        data,
        timestamp: Date.now()
    });
};

global.__clearWeeklyStatusCache = () => weeklyStatusCache.clear();

// Helper centralizado de super admin (RBAC baseado em role/grupos)
const isSuperAdminUser = (user) => {
    if (!user) return false;
    const groups = user.groups || [];

    // Novo modelo: baseado em role/grupos
    if (user.role === 'super_admin' || groups.includes('super_admin')) {
        return true;
    }

    // Fallback de compatibilidade: passaporte 6999 ainda tratado como super admin
    if (user.passport === '6999') {
        return true;
    }

    return false;
};

// Middleware de proteção CSRF por mesma origem para rotas sensíveis (produção)
// Permite requests sem Origin (same-origin do browser não envia); bloqueia só quando Origin existe e não bate
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

// Aplicar proteção de mesma origem em todo o /api/admin para métodos que alteram estado
router.use(requireSameOrigin);
router.use((req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase())) {
        weeklyStatusCache.clear();
    }
    next();
});

const getUserGroups = async (userId) => {
    const userGroupsData = await getAll('SELECT group_name FROM user_groups WHERE user_id = ?', [userId]);
    let groups = userGroupsData.map(g => g.group_name);
    if (groups.length === 0) {
        const user = await getOne('SELECT role FROM users WHERE id = ?', [userId]);
        if (user?.role) groups = [user.role];
    }
    return groups;
};

const requireWeaponSalesAccess = async (req, res, next) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Não autenticado' });
    }

    try {
        const sessionGroups = Array.isArray(req.session.user.groups) ? req.session.user.groups : [];
        const dbGroups = await getUserGroups(req.session.user.id).catch(() => []);
        const groups = [...new Set([...sessionGroups, ...dbGroups, req.session.user.role]
            .map(normalizeGroupName)
            .filter(Boolean)
        )];
        let allowed = isSuperAdminUser(req.session.user) || groups.some(g => weaponSalesGroups.has(g));

        if (!allowed && groups.length > 0) {
            const placeholders = groups.map(() => '?').join(',');
            const roleRows = await getAll(
                `SELECT role_name, permissions FROM role_permissions WHERE role_name IN (${placeholders}) AND active = 1`,
                groups
            );

            allowed = (roleRows || []).some(role => {
                const permissions = JSON.parse(role.permissions || '[]');
                return permissions.includes('all') ||
                    permissions.includes('weapon-sales') ||
                    permissions.includes('weapon-freebies') ||
                    permissions.includes('weapon-catalog');
            });
        }

        if (!allowed) {
            return res.status(403).json({ error: 'Sem permissão para acessar o extrato de vendas' });
        }

        next();
    } catch (error) {
        console.error('Erro ao verificar permissão de vendas:', error);
        res.status(500).json({ error: 'Erro ao verificar permissão' });
    }
};

async function ensureWeaponSalesTable() {
    const isPostgres = process.env.DATABASE_URL ? true : false;

    if (isPostgres) {
        await runQuery(`
            CREATE TABLE IF NOT EXISTS weapon_sales (
                id SERIAL PRIMARY KEY,
                weapon_name TEXT NOT NULL,
                quantity INTEGER NOT NULL DEFAULT 1,
                sale_value NUMERIC(12,2) NOT NULL DEFAULT 0,
                buyer_name TEXT,
                seller_name TEXT,
                proof_url TEXT,
                proof_data TEXT,
                notes TEXT,
                sale_date DATE NOT NULL,
                created_by INTEGER REFERENCES users(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await runQuery(`
            CREATE TABLE IF NOT EXISTS weapon_stock (
                id SERIAL PRIMARY KEY,
                weapon_name TEXT UNIQUE NOT NULL,
                current_stock INTEGER NOT NULL DEFAULT 0,
                active INTEGER DEFAULT 1,
                created_by INTEGER REFERENCES users(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await runQuery(`
            CREATE TABLE IF NOT EXISTS weapon_sale_items (
                id SERIAL PRIMARY KEY,
                sale_id INTEGER NOT NULL REFERENCES weapon_sales(id) ON DELETE CASCADE,
                stock_id INTEGER REFERENCES weapon_stock(id),
                weapon_name TEXT NOT NULL,
                quantity INTEGER NOT NULL
            )
        `);

        await runQuery(`
            CREATE TABLE IF NOT EXISTS weapon_freebies (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                stock_id INTEGER REFERENCES weapon_stock(id),
                weapon_name TEXT NOT NULL,
                quantity INTEGER NOT NULL,
                week_start DATE NOT NULL,
                week_end DATE NOT NULL,
                created_by INTEGER REFERENCES users(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await runQuery(`
            CREATE TABLE IF NOT EXISTS weapon_production_entries (
                id SERIAL PRIMARY KEY,
                stock_id INTEGER NOT NULL REFERENCES weapon_stock(id),
                weapon_name TEXT NOT NULL,
                quantity INTEGER NOT NULL,
                production_date DATE NOT NULL,
                responsible_name TEXT,
                notes TEXT,
                created_by INTEGER REFERENCES users(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
    } else {
        await runQuery(`
            CREATE TABLE IF NOT EXISTS weapon_sales (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                weapon_name TEXT NOT NULL,
                quantity INTEGER NOT NULL DEFAULT 1,
                sale_value REAL NOT NULL DEFAULT 0,
                buyer_name TEXT,
                seller_name TEXT,
                proof_url TEXT,
                proof_data TEXT,
                notes TEXT,
                sale_date DATE NOT NULL,
                created_by INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (created_by) REFERENCES users(id)
            )
        `);

        await runQuery(`
            CREATE TABLE IF NOT EXISTS weapon_stock (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                weapon_name TEXT UNIQUE NOT NULL,
                current_stock INTEGER NOT NULL DEFAULT 0,
                active INTEGER DEFAULT 1,
                created_by INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (created_by) REFERENCES users(id)
            )
        `);

        await runQuery(`
            CREATE TABLE IF NOT EXISTS weapon_sale_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sale_id INTEGER NOT NULL,
                stock_id INTEGER,
                weapon_name TEXT NOT NULL,
                quantity INTEGER NOT NULL,
                FOREIGN KEY (sale_id) REFERENCES weapon_sales(id),
                FOREIGN KEY (stock_id) REFERENCES weapon_stock(id)
            )
        `);

        await runQuery(`
            CREATE TABLE IF NOT EXISTS weapon_freebies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                stock_id INTEGER,
                weapon_name TEXT NOT NULL,
                quantity INTEGER NOT NULL,
                week_start DATE NOT NULL,
                week_end DATE NOT NULL,
                created_by INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (stock_id) REFERENCES weapon_stock(id),
                FOREIGN KEY (created_by) REFERENCES users(id)
            )
        `);

        await runQuery(`
            CREATE TABLE IF NOT EXISTS weapon_production_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                stock_id INTEGER NOT NULL,
                weapon_name TEXT NOT NULL,
                quantity INTEGER NOT NULL,
                production_date DATE NOT NULL,
                responsible_name TEXT,
                notes TEXT,
                created_by INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (stock_id) REFERENCES weapon_stock(id),
                FOREIGN KEY (created_by) REFERENCES users(id)
            )
        `);
    }

    await runQuery('CREATE INDEX IF NOT EXISTS idx_weapon_sales_date ON weapon_sales (sale_date)');
    await runQuery('CREATE INDEX IF NOT EXISTS idx_weapon_sales_created_by ON weapon_sales (created_by)');
    await runQuery('CREATE INDEX IF NOT EXISTS idx_weapon_stock_name ON weapon_stock (weapon_name)');
    await runQuery('CREATE INDEX IF NOT EXISTS idx_weapon_sale_items_sale ON weapon_sale_items (sale_id)');
    await runQuery('CREATE INDEX IF NOT EXISTS idx_weapon_freebies_week_user ON weapon_freebies (week_start, week_end, user_id)');
    await runQuery('CREATE INDEX IF NOT EXISTS idx_weapon_freebies_stock ON weapon_freebies (stock_id)');
    await runQuery('CREATE INDEX IF NOT EXISTS idx_weapon_production_date ON weapon_production_entries (production_date)');
    await runQuery('CREATE INDEX IF NOT EXISTS idx_weapon_production_stock ON weapon_production_entries (stock_id)');

    try {
        await runQuery('ALTER TABLE weapon_sales ADD COLUMN proof_data TEXT');
    } catch (e) {
        // Coluna já existe.
    }

    try {
        await runQuery('ALTER TABLE weapon_stock ADD COLUMN sale_price REAL DEFAULT 0');
    } catch (e) {
        // Coluna já existe.
    }

    const legacySales = await getAll(`
        SELECT ws.id, ws.weapon_name, ws.quantity
        FROM weapon_sales ws
        LEFT JOIN weapon_sale_items wsi ON wsi.sale_id = ws.id
        WHERE wsi.id IS NULL AND ws.weapon_name IS NOT NULL AND ws.weapon_name != ''
    `);

    for (const sale of legacySales || []) {
        await runQuery(
            'INSERT INTO weapon_sale_items (sale_id, weapon_name, quantity) VALUES (?, ?, ?)',
            [sale.id, sale.weapon_name, Number(sale.quantity || 1)]
        );
    }
}

function parseWeaponSaleItems(rawItems, fallbackName, fallbackQuantity) {
    let parsedItems = [];

    if (rawItems) {
        try {
            parsedItems = JSON.parse(rawItems);
        } catch (error) {
            throw new Error('Lista de armas inválida');
        }
    } else if (fallbackName) {
        parsedItems = [{ weapon_name: fallbackName, quantity: fallbackQuantity }];
    }

    const normalized = parsedItems.map(item => ({
        stock_id: item.stock_id ? parseInt(item.stock_id, 10) : null,
        weapon_name: String(item.weapon_name || '').trim(),
        quantity: parseInt(item.quantity, 10)
    })).filter(item => item.weapon_name || item.stock_id);

    if (normalized.length === 0) {
        throw new Error('Informe pelo menos uma arma vendida');
    }

    const merged = new Map();
    for (const item of normalized) {
        if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
            throw new Error('Informe quantidades válidas para as armas vendidas');
        }
        const key = item.stock_id ? `id:${item.stock_id}` : `name:${item.weapon_name.toLowerCase()}`;
        const existing = merged.get(key) || { ...item, quantity: 0 };
        existing.quantity += item.quantity;
        if (item.weapon_name) existing.weapon_name = item.weapon_name;
        merged.set(key, existing);
    }

    return [...merged.values()];
}

async function resolveWeaponSaleItems(items) {
    const resolved = [];

    for (const item of items) {
        let stock = null;
        if (item.stock_id) {
            stock = await getOne('SELECT * FROM weapon_stock WHERE id = ?', [item.stock_id]);
        } else if (item.weapon_name) {
            stock = await getOne('SELECT * FROM weapon_stock WHERE LOWER(weapon_name) = LOWER(?)', [item.weapon_name]);
        }

        if (!stock) {
            throw new Error(`Arma não cadastrada no estoque: ${item.weapon_name || item.stock_id}`);
        }

        if (stock.active === 0 || stock.active === false) {
            throw new Error(`Arma inativa no estoque: ${stock.weapon_name}`);
        }

        if (Number(stock.current_stock || 0) < item.quantity) {
            throw new Error(`Estoque insuficiente para ${stock.weapon_name}. Disponível: ${stock.current_stock}`);
        }

        resolved.push({
            stock_id: stock.id,
            weapon_name: stock.weapon_name,
            quantity: item.quantity
        });
    }

    return resolved;
}

async function restoreWeaponStock(item) {
    if (item.stock_id) {
        const stock = await getOne('SELECT id FROM weapon_stock WHERE id = ?', [item.stock_id]);
        if (stock) {
            await runQuery(
                'UPDATE weapon_stock SET current_stock = current_stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [Number(item.quantity || 0), item.stock_id]
            );
            return;
        }
    }

    const existing = await getOne('SELECT id FROM weapon_stock WHERE LOWER(weapon_name) = LOWER(?)', [item.weapon_name]);
    if (existing) {
        await runQuery(
            'UPDATE weapon_stock SET current_stock = current_stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [Number(item.quantity || 0), existing.id]
        );
    } else {
        await runQuery(
            'INSERT INTO weapon_stock (weapon_name, current_stock, active) VALUES (?, ?, ?)',
            [item.weapon_name, Number(item.quantity || 0), 1]
        );
    }
}

const WEEKLY_FREE_WEAPON_LIMIT = 3;

function normalizeWeaponFreebieName(name = '') {
    return String(name)
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function isFamilyFreeWeapon(name = '') {
    const normalized = normalizeWeaponFreebieName(name);
    const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
    const compact = normalized.replace(/[^a-z0-9]/g, '');
    return compact.includes('mtar') || compact.includes('ia2') || tokens.includes('ia') || normalized === 'ia';
}

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
            { role_name: 'gerente_vendas', display_name: 'Gerente de Vendas' },
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
            'gerente_vendas': 'Gerente de Vendas',
            'gerente_de_vendas': 'Gerente de Vendas',
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
    'gerente_vendas': 'Gerente de Vendas',
    'gerente_de_vendas': 'Gerente de Vendas',
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

// Middleware para verificar se é super admin (RBAC)
const requireSuperAdmin = (req, res, next) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Não autenticado' });
    }
    if (!isSuperAdminUser(req.session.user)) {
        return res.status(403).json({ error: 'Apenas o super admin pode fazer isso' });
    }
    next();
};

// ENDPOINT TEMPORÁRIO - Limpar todos os dados exceto usuários
// Em produção, exige variável de ambiente explícita e confirmação forte no corpo
router.post('/reset-all-data', requireSuperAdmin, async (req, res) => {
    try {
        if (isProduction && process.env.ENABLE_RESET_ALL_DATA !== 'true') {
            return res.status(403).json({ error: 'Endpoint desabilitado em produção. Defina ENABLE_RESET_ALL_DATA=true para habilitar temporariamente.' });
        }

        const { confirmation } = req.body || {};
        if (confirmation !== 'RESET_ALL_DATA') {
            return res.status(400).json({ error: 'Confirmação inválida. Use confirmation = "RESET_ALL_DATA".' });
        }

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

router.get('/family-commandments', requireAdmin, async (req, res) => {
    try {
        const report = await getCommandmentsReport();
        res.json(report);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.put('/family-commandments', requireAdmin, async (req, res) => {
    try {
        const { title, content, active } = req.body || {};
        const saved = await saveCommandments({ title, content, active }, req.session.user.id);
        const report = await getCommandmentsReport();
        res.json({ success: true, commandments: saved, report });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Listar todas as entregas pendentes (da semana selecionada)
router.get('/deliveries/pending', requireAdmin, async (req, res) => {
    try {
        const { week_start, week_end, summary } = req.query;
        const isSummary = summary === '1' || summary === 'true';
        
        let query = `
            SELECT ${isSummary
                ? 'd.id, d.user_id, d.week_start, d.week_end, d.status, d.created_at, d.payment_type, d.payment_type_id, d.dirty_money_amount'
                : 'd.*, d.payment_type, d.payment_type_id, d.dirty_money_amount'}, 
                   COALESCE(NULLIF(TRIM(u.capital_nickname), ''), u.name) as user_name,
                   u.name as user_original_name, u.capital_nickname,
                   u.passport as user_passport, u.role as user_role,
                   u.member_slot, u.manager_slot
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

        if (deliveries.length > 0) {
            const userIds = [...new Set(deliveries.map(d => d.user_id).filter(Boolean))];
            const groupRows = userIds.length > 0
                ? await getAll(`
                    SELECT user_id, group_name
                    FROM user_groups
                    WHERE user_id IN (${userIds.map(() => '?').join(',')})
                `, userIds)
                : [];
            const groupsByUser = new Map();
            for (const row of groupRows) {
                if (!groupsByUser.has(row.user_id)) groupsByUser.set(row.user_id, []);
                groupsByUser.get(row.user_id).push(row.group_name);
            }

            for (const delivery of deliveries) {
                const groups = groupsByUser.get(delivery.user_id) || [];
                const isManager = isManagerByGroups([...groups, delivery.user_role]);
                delivery.groups = groups;
                delivery.is_manager_farm = isManager;
                delivery.storage_slot = isManager ? delivery.manager_slot : delivery.member_slot;
                delivery.storage_slot_type = isManager ? 'manager' : 'member';
                delivery.storage_slot_label = isManager ? 'Bau da Gerencia' : 'Bau dos Membros';
            }
        }

        if (isSummary) {
            return res.json({ deliveries });
        }
        
        if (deliveries.length > 0) {
            const deliveryIds = deliveries.map(d => d.id);
            const placeholders = deliveryIds.map(() => '?').join(',');
            
            const [allItems, allScreenshots] = await Promise.all([
                getAll(`
                    SELECT di.*, m.name as material_name, m.icon as material_icon, m.target_role
                    FROM delivery_items di
                    JOIN materials m ON di.material_id = m.id
                    WHERE di.delivery_id IN (${placeholders})
                `, deliveryIds),
                getAll(`
                    SELECT delivery_id, screenshot_url
                    FROM delivery_screenshots
                    WHERE delivery_id IN (${placeholders})
                `, deliveryIds)
            ]);
            
            const paymentTypeIds = [...new Set(deliveries.map(d => d.payment_type_id).filter(Boolean))];
            let paymentTypesMap = {};
            if (paymentTypeIds.length > 0) {
                const ptPlaceholders = paymentTypeIds.map(() => '?').join(',');
                const paymentTypes = await getAll(`SELECT id, name, icon FROM payment_types WHERE id IN (${ptPlaceholders})`, paymentTypeIds);
                for (const pt of paymentTypes) {
                    paymentTypesMap[pt.id] = pt;
                }
            }
            
            const itemsByDelivery = {};
            const deliveryById = new Map(deliveries.map(d => [Number(d.id), d]));
            for (const item of allItems) {
                const delivery = deliveryById.get(Number(item.delivery_id));
                if (delivery && !productAppliesToRole(item, !!delivery.is_manager_farm)) continue;
                if (!itemsByDelivery[item.delivery_id]) itemsByDelivery[item.delivery_id] = [];
                itemsByDelivery[item.delivery_id].push(item);
            }
            
            const screenshotsByDelivery = {};
            for (const ss of allScreenshots) {
                if (!screenshotsByDelivery[ss.delivery_id]) screenshotsByDelivery[ss.delivery_id] = [];
                screenshotsByDelivery[ss.delivery_id].push({ screenshot_url: ss.screenshot_url });
            }
            
            for (let delivery of deliveries) {
                delivery.items = itemsByDelivery[delivery.id] || [];
                delivery.screenshots = screenshotsByDelivery[delivery.id] || [];
                if (delivery.payment_type_id && paymentTypesMap[delivery.payment_type_id]) {
                    delivery.payment_type_name = paymentTypesMap[delivery.payment_type_id].name;
                    delivery.payment_type_icon = paymentTypesMap[delivery.payment_type_id].icon;
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
                SELECT d.*, u.name as user_name, u.passport as user_passport, u.role as user_role, a.name as approved_by_name
                FROM deliveries d
                JOIN users u ON d.user_id = u.id
                LEFT JOIN users a ON d.approved_by = a.id
                WHERE d.week_start = ? AND d.week_end = ?
                ORDER BY d.created_at DESC
            `, [week_start, week_end]);
        } else {
            deliveries = await getAll(`
                SELECT d.*, u.name as user_name, u.passport as user_passport, u.role as user_role, a.name as approved_by_name
                FROM deliveries d
                JOIN users u ON d.user_id = u.id
                LEFT JOIN users a ON d.approved_by = a.id
                ORDER BY d.created_at DESC
            `);
        }
        
        if (deliveries.length > 0) {
            const userIds = [...new Set(deliveries.map(d => d.user_id).filter(Boolean))];
            const groupRows = userIds.length > 0
                ? await getAll(`SELECT user_id, group_name FROM user_groups WHERE user_id IN (${userIds.map(() => '?').join(',')})`, userIds)
                : [];
            const groupsByUser = new Map();
            for (const row of groupRows) {
                if (!groupsByUser.has(row.user_id)) groupsByUser.set(row.user_id, []);
                groupsByUser.get(row.user_id).push(row.group_name);
            }
            for (const delivery of deliveries) {
                const groups = groupsByUser.get(delivery.user_id) || [];
                delivery.is_manager_farm = isManagerByGroups([...groups, delivery.user_role]);
            }

            const deliveryIds = deliveries.map(d => d.id);
            const placeholders = deliveryIds.map(() => '?').join(',');
            
            const allItems = await getAll(`
                SELECT di.*, m.name as material_name, m.icon as material_icon, m.target_role
                FROM delivery_items di
                JOIN materials m ON di.material_id = m.id
                WHERE di.delivery_id IN (${placeholders})
            `, deliveryIds);
            
            const itemsByDelivery = {};
            const deliveryById = new Map(deliveries.map(d => [Number(d.id), d]));
            for (const item of allItems) {
                const delivery = deliveryById.get(Number(item.delivery_id));
                if (delivery && !productAppliesToRole(item, !!delivery.is_manager_farm)) continue;
                if (!itemsByDelivery[item.delivery_id]) itemsByDelivery[item.delivery_id] = [];
                itemsByDelivery[item.delivery_id].push(item);
            }
            
            for (let delivery of deliveries) {
                delivery.items = itemsByDelivery[delivery.id] || [];
            }
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
            SELECT d.*, u.name as user_name, u.passport, u.role as user_role, a.name as approved_by_name
            FROM deliveries d
            JOIN users u ON d.user_id = u.id AND u.active = 1
            LEFT JOIN users a ON d.approved_by = a.id
            ORDER BY d.created_at DESC
            LIMIT 500
        `);
        
        // Batch: buscar itens e screenshots de todas as entregas de uma vez
        const dIds = deliveries.map(d => d.id);
        if (dIds.length > 0) {
            const userIds = [...new Set(deliveries.map(d => d.user_id).filter(Boolean))];
            const groupRows = userIds.length > 0
                ? await getAll(`SELECT user_id, group_name FROM user_groups WHERE user_id IN (${userIds.map(() => '?').join(',')})`, userIds)
                : [];
            const groupsByUser = new Map();
            for (const row of groupRows) {
                if (!groupsByUser.has(row.user_id)) groupsByUser.set(row.user_id, []);
                groupsByUser.get(row.user_id).push(row.group_name);
            }
            for (const delivery of deliveries) {
                const groups = groupsByUser.get(delivery.user_id) || [];
                delivery.is_manager_farm = isManagerByGroups([...groups, delivery.user_role]);
            }

            const ph = dIds.map(() => '?').join(',');
            const [allItems, allScreenshots] = await Promise.all([
                getAll(`SELECT di.*, m.name as material_name, m.icon as material_icon, m.target_role FROM delivery_items di JOIN materials m ON di.material_id = m.id WHERE di.delivery_id IN (${ph})`, dIds),
                getAll(`SELECT delivery_id, screenshot_url FROM delivery_screenshots WHERE delivery_id IN (${ph})`, dIds)
            ]);
            const itemsByD = new Map();
            const deliveryById = new Map(deliveries.map(d => [Number(d.id), d]));
            for (const item of allItems) {
                const delivery = deliveryById.get(Number(item.delivery_id));
                if (delivery && !productAppliesToRole(item, !!delivery.is_manager_farm)) continue;
                if (!itemsByD.has(item.delivery_id)) itemsByD.set(item.delivery_id, []);
                itemsByD.get(item.delivery_id).push(item);
            }
            const ssByD = new Map();
            for (const s of allScreenshots) {
                if (!ssByD.has(s.delivery_id)) ssByD.set(s.delivery_id, []);
                ssByD.get(s.delivery_id).push(s);
            }
            for (const delivery of deliveries) {
                delivery.items = itemsByD.get(delivery.id) || [];
                delivery.screenshots = ssByD.get(delivery.id) || [];
            }
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
            items = await getAll('SELECT di.*, m.weekly_goal, m.manager_weekly_goal, m.target_role FROM delivery_items di JOIN materials m ON di.material_id = m.id WHERE di.delivery_id = ?', [deliveryId]);
            items = items.filter(item => productAppliesToRole(item, isManager));
            const materials = (await getAll('SELECT id, weekly_goal, manager_weekly_goal, target_role FROM materials WHERE active = 1'))
                .filter(m => productAppliesToRole(m, isManager));

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
            const totalMaterials = items.reduce((sum, item) => sum + (parseInt(item.amount, 10) || 0), 0);
            
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
        
        // Marcar como rejeitado (status = 'rejected' para aparecer "Rejeitado por" no extrato)
        await runQuery(
            'UPDATE deliveries SET status = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP, approval_note = ? WHERE id = ?',
            ['rejected', userId, rejectionReason, deliveryId]
        );
        console.log(`   - Entrega marcada como rejeitada (status=rejected)`);
        
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
            SELECT u.id,
                   COALESCE(NULLIF(TRIM(u.capital_nickname), ''), u.name) as name,
                   u.name as original_name,
                   u.capital_nickname,
                   u.passport, u.email, u.role, u.member_slot, u.manager_slot, u.created_at, u.active,
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
            ORDER BY COALESCE(NULLIF(TRIM(u.capital_nickname), ''), u.name) ASC
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

// Alterar cargo do membro (super admin, gerente_geral e 01 podem alterar)
router.post('/members/:id/role', requireAdmin, async (req, res) => {
    try {
        // Permitir super admin, gerente_geral e 01 (mesmo conjunto que gerencia grupos)
        const sessionUser = req.session.user || {};
        const sessionGroups = sessionUser.groups || [];
        const canChangeRole = isSuperAdminUser(sessionUser)
            || sessionUser.role === 'gerente_geral'
            || sessionUser.role === '01'
            || sessionGroups.includes('gerente_geral')
            || sessionGroups.includes('01');
        if (!canChangeRole) {
            return res.status(403).json({ error: 'Sem permissão para alterar cargos' });
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
        
        // Não pode alterar usuários de super admin
        if (member.role === 'super_admin' || member.passport === '6999') {
            return res.status(400).json({ error: 'Não é possível alterar este usuário' });
        }
        
        await runQuery('UPDATE users SET role = ? WHERE id = ?', [role, memberId]);
        
        const roleNamesMap = await getRoleNames();
        res.json({ success: true, message: `Cargo alterado para ${roleNamesMap[role] || role}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Editar informações do membro (gerentes podem alterar somente slots)
router.put('/members/:id', requireAdmin, async (req, res) => {
    try {
        const isSuperAdmin = isSuperAdminUser(req.session.user);
        const memberId = req.params.id;
        const { name, passport, email, role, newPassword, member_slot, manager_slot } = req.body;
        
        const member = await getOne('SELECT * FROM users WHERE id = ?', [memberId]);
        if (!member) {
            return res.status(404).json({ error: 'Membro não encontrado' });
        }
        
        // Não pode editar usuários de super admin
        if (member.role === 'super_admin' || member.passport === '6999') {
            return res.status(400).json({ error: 'Não é possível editar este usuário' });
        }
        
        // Verificar se novo passaporte já existe
        const requestedName = name !== undefined ? String(name).trim() : member.name;
        const requestedPassport = passport !== undefined ? String(passport).trim().toUpperCase() : member.passport;
        const requestedEmail = email !== undefined ? String(email).trim() : (member.email || '');
        const profileChanged =
            requestedName !== (member.name || '').trim() ||
            requestedPassport !== (member.passport || '').trim().toUpperCase() ||
            requestedEmail !== (member.email || '').trim() ||
            !!role ||
            !!newPassword;

        if (!isSuperAdmin && profileChanged) {
            return res.status(403).json({ error: 'Apenas o super admin pode editar dados do membro. Gerentes podem alterar somente os slots.' });
        }

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
        
        const cleanMemberSlot = member_slot !== undefined ? String(member_slot || '').trim() || null : member.member_slot;
        const cleanManagerSlot = manager_slot !== undefined ? String(manager_slot || '').trim() || null : member.manager_slot;

        // Se tem nova senha, fazer hash
        let hashedPassword = null;
        if (newPassword && newPassword.length >= 6) {
            hashedPassword = bcrypt.hashSync(newPassword, 10);
        }
        
        // Atualizar membro
        if (hashedPassword) {
            await runQuery(
                'UPDATE users SET name = ?, passport = ?, email = ?, role = ?, member_slot = ?, manager_slot = ?, password = ? WHERE id = ?',
                [name || member.name, (passport || member.passport).toUpperCase(), email || member.email, role || member.role, cleanMemberSlot, cleanManagerSlot, hashedPassword, memberId]
            );
        } else {
            await runQuery(
                'UPDATE users SET name = ?, passport = ?, email = ?, role = ?, member_slot = ?, manager_slot = ? WHERE id = ?',
                [name || member.name, (passport || member.passport).toUpperCase(), email || member.email, role || member.role, cleanMemberSlot, cleanManagerSlot, memberId]
            );
        }
        
        res.json({ success: true, message: 'Membro atualizado com sucesso' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Deletar membro (somente super admin)
router.delete('/members/:id', requireAdmin, async (req, res) => {
    try {
        if (!isSuperAdminUser(req.session.user)) {
            return res.status(403).json({ error: 'Apenas o super admin pode deletar membros' });
        }
        
        const memberId = req.params.id;
        
        const member = await getOne('SELECT * FROM users WHERE id = ?', [memberId]);
        if (!member) {
            return res.status(404).json({ error: 'Membro não encontrado' });
        }
        
        // Não pode deletar o usuário Admin (passaporte 0) nem super admins
        if (member.passport === '0' || member.role === 'super_admin' || member.passport === '6999') {
            return res.status(400).json({ error: 'Não é possível deletar este usuário protegido' });
        }
        
        // Deletar entregas e itens relacionados usando subqueries
        try {
            await runQuery(`DELETE FROM extra_farm_screenshots WHERE extra_farm_id IN (
                SELECT ef.id FROM extra_farm_requests ef
                WHERE ef.delivery_id IN (SELECT id FROM deliveries WHERE user_id = ?)
            )`, [memberId]);
            await runQuery(`DELETE FROM extra_farm_requests WHERE delivery_id IN (
                SELECT id FROM deliveries WHERE user_id = ?
            )`, [memberId]);
        } catch(e) {}
        await runQuery(`DELETE FROM delivery_screenshots WHERE delivery_id IN (
            SELECT id FROM deliveries WHERE user_id = ?
        )`, [memberId]);
        await runQuery(`DELETE FROM delivery_items WHERE delivery_id IN (
            SELECT id FROM deliveries WHERE user_id = ?
        )`, [memberId]);
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
        const [totalMembers, pendingDeliveries, approvedDeliveries] = await Promise.all([
            getOne('SELECT COUNT(*) as count FROM users WHERE active = 1'),
            getOne(pendingQuery, week_start ? [week_start, week_end] : []),
            getOne(approvedQuery, week_start ? [week_start, week_end] : [])
        ]);
        
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
        
        const [items, extras] = await Promise.all([
            getAll(`
                SELECT di.delivery_id, di.amount, m.name as material_name, m.icon as material_icon
                FROM delivery_items di
                JOIN materials m ON di.material_id = m.id
                WHERE di.delivery_id IN (${placeholders})
            `, deliveryIds),
            getAll(`
                SELECT delivery_id, materials
                FROM extra_farm_requests
                WHERE delivery_id IN (${placeholders}) AND status = 'approved'
            `, deliveryIds)
        ]);
        
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
                materials = materials
                    .filter(m => productAppliesToRole(m, isManager))
                    .map(m => ({
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
        const pendingMembers = await getAll(`
            SELECT DISTINCT u.id, u.name, u.passport, u.role,
                   (SELECT COUNT(*) FROM deliveries WHERE user_id = u.id AND status = 'pending') as pending_count,
                   (SELECT MAX(created_at) FROM deliveries WHERE user_id = u.id AND status = 'pending') as last_pending
            FROM users u
            JOIN deliveries d ON u.id = d.user_id
            WHERE d.status = 'pending' AND u.active = 1
            ORDER BY last_pending ASC
        `);

        const pendingIds = pendingMembers.map(m => m.id);

        if (pendingIds.length > 0) {
            const placeholders = pendingIds.map(() => '?').join(',');

            const [allPendingGroups, allPendingDeliveries] = await Promise.all([
                getAll(`SELECT user_id, group_name FROM user_groups WHERE user_id IN (${placeholders})`, pendingIds),
                getAll(`SELECT d.id, d.user_id, d.created_at, d.screenshot_url
                        FROM deliveries d
                        WHERE d.user_id IN (${placeholders}) AND d.status = 'pending'
                        ORDER BY d.created_at ASC`, pendingIds)
            ]);

            const pendingGroupsMap = new Map();
            for (const g of allPendingGroups) {
                if (!pendingGroupsMap.has(g.user_id)) pendingGroupsMap.set(g.user_id, []);
                pendingGroupsMap.get(g.user_id).push(g.group_name);
            }

            const deliveryIds = allPendingDeliveries.map(d => d.id);
            let itemsMap = new Map();

            if (deliveryIds.length > 0) {
                const itemPlaceholders = deliveryIds.map(() => '?').join(',');
                const allItems = await getAll(`
                    SELECT di.delivery_id, di.amount, m.name, m.icon, m.target_role
                    FROM delivery_items di
                    JOIN materials m ON di.material_id = m.id
                    WHERE di.delivery_id IN (${itemPlaceholders})
                `, deliveryIds);
                const pendingDeliveryById = new Map(allPendingDeliveries.map(d => [Number(d.id), d]));

                for (const item of allItems) {
                    const delivery = pendingDeliveryById.get(Number(item.delivery_id));
                    const member = pendingMembers.find(m => Number(m.id) === Number(delivery?.user_id));
                    const groups = pendingGroupsMap.get(delivery?.user_id) || (member?.role ? [member.role] : []);
                    const isManager = isManagerByGroups(groups);
                    if (!productAppliesToRole(item, isManager)) continue;
                    if (!itemsMap.has(item.delivery_id)) itemsMap.set(item.delivery_id, []);
                    itemsMap.get(item.delivery_id).push({ amount: item.amount, name: item.name, icon: item.icon });
                }
            }

            const deliveriesMap = new Map();
            for (const d of allPendingDeliveries) {
                if (!deliveriesMap.has(d.user_id)) deliveriesMap.set(d.user_id, []);
                deliveriesMap.get(d.user_id).push({
                    id: d.id,
                    created_at: d.created_at,
                    screenshot_url: d.screenshot_url,
                    items: itemsMap.get(d.id) || []
                });
            }

            for (const member of pendingMembers) {
                member.groups = pendingGroupsMap.get(member.id) || [];
                if (member.groups.length === 0 && member.role) {
                    member.groups = [member.role];
                }
                member.pending_deliveries = deliveriesMap.get(member.id) || [];
            }
        }

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

        const completedIds = completedMembers.map(m => m.id);

        if (completedIds.length > 0) {
            const placeholders = completedIds.map(() => '?').join(',');
            const allCompletedGroups = await getAll(
                `SELECT user_id, group_name FROM user_groups WHERE user_id IN (${placeholders})`, completedIds
            );

            const completedGroupsMap = new Map();
            for (const g of allCompletedGroups) {
                if (!completedGroupsMap.has(g.user_id)) completedGroupsMap.set(g.user_id, []);
                completedGroupsMap.get(g.user_id).push(g.group_name);
            }

            for (const member of completedMembers) {
                member.groups = completedGroupsMap.get(member.id) || [];
                if (member.groups.length === 0 && member.role) {
                    member.groups = [member.role];
                }
            }
        }

        res.json({ pendingMembers, completedMembers, roleNames });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/materials', requireAdmin, async (req, res) => {
    try {
        const { name, icon, weekly_goal, manager_weekly_goal, target_role } = req.body;
        
        if (!name) {
            return res.status(400).json({ error: 'Nome do material é obrigatório' });
        }
        
        const trimmedName = name.trim();
        const goal = parseInt(weekly_goal) || 700;
        const managerGoal = !isNaN(parseInt(manager_weekly_goal)) ? parseInt(manager_weekly_goal) : goal;
        const targetRole = ['member', 'manager', 'both'].includes(target_role) ? target_role : 'both';
        
        const existing = await getOne('SELECT id, active FROM materials WHERE name = ?', [trimmedName]);
        if (existing) {
            const isInactive = existing.active === 0 || existing.active === '0' || existing.active === false || existing.active == null;
            if (isInactive) {
                await runQuery(
                    'UPDATE materials SET active = 1, icon = ?, weekly_goal = ?, manager_weekly_goal = ?, target_role = ? WHERE id = ?',
                    [icon || '📦', goal, managerGoal, targetRole, existing.id]
                );
                return res.json({ success: true, message: 'Material reativado e meta atualizada' });
            }
            return res.status(400).json({ error: 'Este material já está na tabela abaixo. Use "Editar metas" ou "Excluir da meta" na linha dele.' });
        }
        
        await runQuery(
            'INSERT INTO materials (name, icon, weekly_goal, manager_weekly_goal, target_role) VALUES (?, ?, ?, ?, ?)',
            [trimmedName, icon || '📦', goal, managerGoal, targetRole]
        );
        
        res.json({ success: true, message: 'Material adicionado' });
    } catch (error) {
        const msg = (error && error.message) ? String(error.message) : '';
        if (msg.includes('UNIQUE constraint failed') || (msg.includes('SQLITE_CONSTRAINT') && msg.includes('materials'))) {
            return res.status(400).json({ error: 'Este material já está na lista. Use a tabela para editar ou remover.' });
        }
        res.status(500).json({ error: error.message });
    }
});

// Atualizar material (nome, ícone, meta)
router.put('/materials/:id', requireAdmin, async (req, res) => {
    try {
        const materialId = req.params.id;
        const { name, icon, weekly_goal, manager_weekly_goal, target_role } = req.body;
        
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
        const newTargetRole = ['member', 'manager', 'both'].includes(target_role)
            ? target_role
            : (material.target_role || 'both');
        
        if (newName.trim() !== (material.name || '').trim()) {
            const existing = await getOne('SELECT id FROM materials WHERE name = ? AND id != ?', [newName.trim(), materialId]);
            if (existing) {
                return res.status(400).json({ error: 'Já existe outro material com esse nome. Escolha outro nome.' });
            }
        }
        
        await runQuery(
            'UPDATE materials SET name = ?, icon = ?, weekly_goal = ?, manager_weekly_goal = ?, target_role = ? WHERE id = ?',
            [newName.trim(), newIcon, newGoal, newManagerGoal, newTargetRole, materialId]
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
        const { name, icon, weekly_goal, manager_weekly_goal, unit_type, target_role } = req.body;
        
        if (!name) {
            return res.status(400).json({ error: 'Nome do tipo de pagamento é obrigatório' });
        }
        
        const trimmedName = name.trim();
        const unitType = (unit_type === 'unidade') ? 'unidade' : 'R$';
        const defaultGoal = unitType === 'unidade' ? 700 : 50000;
        const goal = parseInt(weekly_goal) || defaultGoal;
        const managerGoal = !isNaN(parseInt(manager_weekly_goal)) ? parseInt(manager_weekly_goal) : goal;
        const targetRole = ['member', 'manager', 'both'].includes(target_role) ? target_role : 'both';
        
        const existing = await getOne('SELECT id, active FROM payment_types WHERE name = ?', [trimmedName]);
        if (existing) {
            const isInactive = existing.active === 0 || existing.active === '0' || existing.active === false || existing.active == null;
            if (isInactive) {
                await runQuery(
                    'UPDATE payment_types SET active = 1, icon = ?, weekly_goal = ?, manager_weekly_goal = ?, unit_type = ?, target_role = ? WHERE id = ?',
                    [icon || '💰', goal, managerGoal, unitType, targetRole, existing.id]
                );
                return res.json({ success: true, message: 'Tipo de pagamento reativado e meta atualizada' });
            }
            return res.status(400).json({ error: 'Este tipo já está na tabela abaixo. Use "Editar metas" ou "Excluir da meta" na linha dele.' });
        }
        
        await runQuery(
            'INSERT INTO payment_types (name, icon, weekly_goal, manager_weekly_goal, unit_type, target_role) VALUES (?, ?, ?, ?, ?, ?)',
            [trimmedName, icon || '💰', goal, managerGoal, unitType, targetRole]
        );
        
        res.json({ success: true, message: 'Tipo de pagamento adicionado' });
    } catch (error) {
        const msg = (error && error.message) ? String(error.message) : '';
        if (msg.includes('UNIQUE constraint failed') || (msg.includes('SQLITE_CONSTRAINT') && msg.includes('payment_types'))) {
            return res.status(400).json({ error: 'Este tipo já está na tabela. Use a tabela para editar ou excluir da meta.' });
        }
        res.status(500).json({ error: error.message });
    }
});

// Atualizar tipo de pagamento
router.put('/payment-types/:id', requireAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const { name, icon, weekly_goal, manager_weekly_goal, unit_type, target_role } = req.body;
        
        const paymentType = await getOne('SELECT * FROM payment_types WHERE id = ?', [id]);
        if (!paymentType) {
            return res.status(404).json({ error: 'Tipo de pagamento não encontrado' });
        }
        
        const newName = name || paymentType.name;
        const newIcon = icon || paymentType.icon;
        const newUnitType = (unit_type === 'unidade') ? 'unidade' : (paymentType.unit_type || 'R$');
        const newGoal = weekly_goal !== undefined ? parseInt(weekly_goal) : paymentType.weekly_goal;
        const parsedManagerGoal = parseInt(manager_weekly_goal);
        const newManagerGoal = manager_weekly_goal !== undefined && !isNaN(parsedManagerGoal)
            ? parsedManagerGoal
            : (paymentType.manager_weekly_goal ?? paymentType.weekly_goal);
        const newTargetRole = ['member', 'manager', 'both'].includes(target_role)
            ? target_role
            : (paymentType.target_role || 'both');
        
        await runQuery(
            'UPDATE payment_types SET name = ?, icon = ?, weekly_goal = ?, manager_weekly_goal = ?, unit_type = ?, target_role = ? WHERE id = ?',
            [newName, newIcon, newGoal, newManagerGoal, newUnitType, newTargetRole, id]
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

        const cachedStatus = getCachedWeeklyStatus(weekStart, weekEnd);
        if (cachedStatus) {
            return res.json(cachedStatus);
        }
        
        // Verificar se a semana já passou
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const weekEndDate = new Date(weekEnd);
        const weekPassed = today > weekEndDate;
        
        // ===== BUSCAR TODOS OS DADOS DE UMA VEZ (OTIMIZADO - PARALELO) =====
        
        // FASE 1: queries independentes em paralelo
        const [
            whitelist,
            allMembers,
            allUserGroups,
            allDeliveries,
            allJustifications,
            allWarnings,
            allMaterials,
            paymentTypes
        ] = await Promise.all([
            getAll(`SELECT user_id FROM farm_whitelist`),
            getAll(`
                SELECT id,
                       COALESCE(NULLIF(TRIM(capital_nickname), ''), name) as name,
                       name as original_name,
                       capital_nickname,
                       passport, role, member_slot, manager_slot, created_at FROM users
                WHERE active = 1 AND passport != '0'
                ORDER BY COALESCE(NULLIF(TRIM(capital_nickname), ''), name)
            `),
            getAll(`
                SELECT ug.user_id, ug.group_name 
                FROM user_groups ug
                INNER JOIN users u ON u.id = ug.user_id
                WHERE u.active = 1 AND u.passport != '0'
            `),
            getAll(`
                SELECT d.*, d.created_at as delivered_at, u.name as approved_by_name
                FROM deliveries d
                LEFT JOIN users u ON d.approved_by = u.id
                WHERE d.week_start = ? AND d.week_end = ?
            `, [weekStart, weekEnd]),
            getAll(`
                SELECT * FROM justifications 
                WHERE week_start = ? AND week_end = ?
            `, [weekStart, weekEnd]),
            getAll(`
                SELECT user_id FROM warnings 
                WHERE week_start = ? AND week_end = ?
            `, [weekStart, weekEnd]),
            getAll(`SELECT id, name, icon, weekly_goal, manager_weekly_goal, target_role FROM materials WHERE active = 1`)
                .catch(() => getAll(`SELECT id, name, icon, weekly_goal FROM materials WHERE active = 1`)),
            getAll('SELECT id, weekly_goal, manager_weekly_goal FROM payment_types')
                .catch(() => getAll('SELECT id, weekly_goal FROM payment_types'))
        ]);

        const whitelistIds = new Set(whitelist.map(w => w.user_id));

        const userGroupsMap = new Map();
        for (const ug of allUserGroups) {
            if (!userGroupsMap.has(ug.user_id)) {
                userGroupsMap.set(ug.user_id, []);
            }
            userGroupsMap.get(ug.user_id).push(ug.group_name);
        }

        const deliveriesByUserMap = new Map();
        for (const d of allDeliveries) {
            if (!deliveriesByUserMap.has(d.user_id)) {
                deliveriesByUserMap.set(d.user_id, []);
            }
            deliveriesByUserMap.get(d.user_id).push(d);
        }

        const justificationsMap = new Map();
        for (const j of allJustifications) {
            justificationsMap.set(j.user_id, j);
        }

        const warningsSet = new Set(allWarnings.map(w => w.user_id));

        const materialsMap = new Map();
        for (const m of allMaterials) {
            materialsMap.set(m.id.toString(), m);
        }

        const paymentTypesMap = new Map((paymentTypes || []).map(pt => [pt.id, pt]));

        // FASE 2: queries dependentes de deliveryIds em paralelo
        const deliveryIds = allDeliveries.map(d => d.id);
        let allDeliveryItems = [];
        let allExtraFarms = [];

        if (deliveryIds.length > 0) {
            const placeholders = deliveryIds.map(() => '?').join(',');
            [allDeliveryItems, allExtraFarms] = await Promise.all([
                getAll(`
                    SELECT di.delivery_id, di.material_id, di.amount, m.name as material_name, m.icon as material_icon, m.weekly_goal, m.manager_weekly_goal, m.target_role
                    FROM delivery_items di
                    JOIN materials m ON di.material_id = m.id
                    WHERE di.delivery_id IN (${placeholders})
                `, deliveryIds),
                getAll(`
                    SELECT efr.id, efr.delivery_id, efr.status, efr.materials, efr.created_at
                    FROM extra_farm_requests efr
                    WHERE efr.delivery_id IN (${placeholders})
                    ORDER BY efr.created_at
                `, deliveryIds)
            ]);
        }

        const deliveryItemsMap = new Map();
        for (const item of allDeliveryItems) {
            if (!deliveryItemsMap.has(item.delivery_id)) {
                deliveryItemsMap.set(item.delivery_id, []);
            }
            deliveryItemsMap.get(item.delivery_id).push(item);
        }

        const extraFarmsMap = new Map();
        for (const ef of allExtraFarms) {
            if (!extraFarmsMap.has(ef.delivery_id)) {
                extraFarmsMap.set(ef.delivery_id, []);
            }
            extraFarmsMap.get(ef.delivery_id).push(ef);
        }

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
            member.storage_slot = isManager ? member.manager_slot : member.member_slot;
            member.storage_slot_type = isManager ? 'manager' : 'member';
            member.storage_slot_label = isManager ? 'Bau da Gerencia' : 'Bau dos Membros';
            
            const memberDeliveries = deliveriesByUserMap.get(member.id) || [];
            memberDeliveries.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            // Prioridade de status para a semana:
            // 1) Se houver entrega pendente -> AGUARDANDO (sempre mostrar isso primeiro)
            // 2) Senão, approved-complete -> COMPLETO
            // 3) Senão, approved-partial  -> EM PROGRESSO
            // 4) Senão, fallback (rejected/not_delivered/sem entrega)
            let delivery = null;
            if (memberDeliveries.length > 0) {
                const pendingDel       = memberDeliveries.find(d => d.status === 'pending');
                const approvedComplete = memberDeliveries.find(d => d.status === 'approved' && !d.is_partial);
                const approvedPartial  = memberDeliveries.find(d => d.status === 'approved' &&  d.is_partial);
                
                if (pendingDel) {
                    delivery = pendingDel;
                } else if (approvedComplete) {
                    delivery = approvedComplete;
                } else if (approvedPartial) {
                    delivery = approvedPartial;
                } else {
                    delivery = memberDeliveries[0]; // not_delivered / rejected / fallback
                }
            }
            const lastRejectedDelivery = memberDeliveries.find(d => d.status === 'rejected' && d.approval_note);
            const lastRejectionInfo = lastRejectedDelivery ? {
                last_rejection_note: lastRejectedDelivery.approval_note,
                last_rejected_by_name: lastRejectedDelivery.approved_by_name,
                last_rejected_at: lastRejectedDelivery.approved_at,
                last_rejected_delivery_id: lastRejectedDelivery.id
            } : {};
            const justification = justificationsMap.get(member.id);

            // Dados da entrega
            let deliveryItems = [];
            let extraFarmItems = [];
            let totalExtraMaterials = 0;
            let pendingExtraInfo = null;
            
            let effectiveIsPartial = delivery?.is_partial || false;
            let effectivePaymentType = delivery?.payment_type || 'material';

            if (delivery) {
                deliveryItems = (deliveryItemsMap.get(delivery.id) || [])
                    .filter(item => productAppliesToRole(item, isManager))
                    .map(item => ({
                        ...item,
                        weekly_goal: isManager ? (item.manager_weekly_goal ?? item.weekly_goal) : item.weekly_goal
                    }));

                // Se não há itens de materiais e tem dinheiro, tratar como pagamento em dinheiro
                if (delivery.dirty_money_amount > 0 && deliveryItems.length === 0) {
                    effectivePaymentType = 'dirty_money';
                }

                // Regra: 100% nos materiais entregues = Completo; senão = Em progresso (espelho do modal)
                if (delivery.status === 'approved') {
                    if (effectivePaymentType === 'dirty_money') {
                        let totalDirty = 0;
                        for (const d of memberDeliveries) {
                            if (d.status === 'approved' || d.status === 'pending') totalDirty += parseInt(d.dirty_money_amount, 10) || 0;
                        }
                        const paymentType = paymentTypesMap.get(delivery.payment_type_id) || {};
                        const goal = isManager
                            ? (paymentType.manager_weekly_goal ?? paymentType.weekly_goal ?? 50000)
                            : (paymentType.weekly_goal ?? 50000);
                        const numGoal = parseInt(goal, 10) || 50000;
                        effectiveIsPartial = totalDirty < numGoal;
                    } else {
                        // Soma da semana: todos os envios (aprovados + pendentes) por material
                        const sumByMaterial = new Map();
                        for (const d of memberDeliveries) {
                            if (d.status !== 'approved' && d.status !== 'pending') continue;
                            const did = d.id != null ? Number(d.id) : d.id;
                            const items = deliveryItemsMap.get(did) || deliveryItemsMap.get(d.id) || [];
                            for (const it of items) {
                                const mid = it.material_id != null ? Number(it.material_id) : it.material_id;
                                if (mid == null || Number.isNaN(mid)) continue;
                                const prev = sumByMaterial.get(mid) || 0;
                                sumByMaterial.set(mid, prev + (parseInt(it.amount, 10) || 0));
                            }
                        }
                        // Completo = TODOS os materiais do CARGO com total >= meta; senão = Em progresso
                        const applicableMaterials = allMaterials.filter(mat => productAppliesToRole(mat, isManager));
                        if (applicableMaterials.length === 0) {
                            effectiveIsPartial = sumByMaterial.size === 0;
                        } else {
                            let all100 = true;
                            for (const mat of applicableMaterials) {
                                const matId = mat.id != null ? Number(mat.id) : mat.id;
                                const total = sumByMaterial.get(matId) || 0;
                                const goal = isManager ? (mat.manager_weekly_goal ?? mat.weekly_goal ?? 700) : (mat.weekly_goal ?? 700);
                                const numGoal = parseInt(goal, 10) || 700;
                                if (total < numGoal) {
                                    all100 = false;
                                    break;
                                }
                            }
                            effectiveIsPartial = !all100;
                        }
                    }
                }
                
                // Processar farm extras
                const extras = extraFarmsMap.get(delivery.id) || [];
                const approvedExtras = [];
                const pendingExtras = extras.filter(e => e.status === 'pending');
                
                // Consolidar materiais extras aprovados
                const extraMaterialsMap2 = new Map();
                for (const extra of approvedExtras) {
                    // Screenshots do extra
                    
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
                    screenshots: [],
                    description: delivery.description,
                    items: [],
                    is_partial: effectiveIsPartial,
                    payment_type: effectivePaymentType,
                    dirty_money_amount: delivery.dirty_money_amount || 0,
                    is_late_payment: isLatePayment,
                    extra_items: [],
                    extra_screenshots: [],
                    total_extra_materials: 0,
                    pending_extra: pendingExtraInfo,
                    approved_by_name: delivery.approved_by_name,
                    approved_at: delivery.approved_at,
                    approval_note: delivery.approval_note,
                    weekly_submissions: []
                });
            } else if (delivery && delivery.status === 'pending') {
                const isLatePayment = delivery.description && delivery.description.includes('[META ATRASADA]');
                pendingApproval.push({
                    ...member,
                    ...lastRejectionInfo,
                    delivery_id: delivery.id,
                    delivered_at: delivery.delivered_at,
                    screenshot_url: delivery.screenshot_url,
                    screenshots: [],
                    description: delivery.description,
                    items: [],
                    payment_type: delivery.payment_type || 'material',
                    dirty_money_amount: delivery.dirty_money_amount || 0,
                    is_late_payment: isLatePayment,
                    is_partial: delivery.is_partial,
                    weekly_submissions: []
                });
            } else if (delivery && (delivery.status === 'rejected' || delivery.status === 'not_delivered')) {
                // Farm foi rejeitado - mas se está na whitelist, ignorar
                if (!whitelistIds.has(member.id)) {
                    notDelivered.push({
                        ...member,
                        ...lastRejectionInfo,
                        has_adv_applied: warningsSet.has(member.id),
                        was_rejected: true,
                        rejected_by_name: delivery.approved_by_name,
                        rejected_at: delivery.approved_at,
                        rejection_note: delivery.approval_note,
                        rejected_items: [],
                        rejected_screenshots: [],
                        weekly_submissions: []
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
        
        const responseData = { 
            completed, 
            partial,
            pendingApproval, 
            notDelivered, 
            justified, 
            week: { start: weekStart, end: weekEnd },
            weekPassed
        };
        setCachedWeeklyStatus(weekStart, weekEnd, responseData);
        res.json(responseData);
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
        const memberGroups = await getUserGroups(memberId);
        const isManager = isManagerByGroups(memberGroups);
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
                SELECT di.*, m.name as material_name, m.icon as material_icon, m.target_role
                FROM delivery_items di
                JOIN materials m ON di.material_id = m.id
                WHERE di.delivery_id = ?
            `, [delivery.id]);
            items = items.filter(item => productAppliesToRole(item, isManager));
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
                SELECT di.amount, m.name as material_name, m.icon as material_icon, m.weekly_goal, m.manager_weekly_goal, m.target_role
                FROM delivery_items di
                JOIN materials m ON di.material_id = m.id
                WHERE di.delivery_id = ?
            `, [delivery.id]);

            delivery.items = delivery.items
                .filter(item => productAppliesToRole(item, isManager))
                .map(item => ({
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
                            const mat = await getOne('SELECT name, icon, target_role FROM materials WHERE id = ?', [matId]);
                            if (mat && productAppliesToRole(mat, isManager)) {
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
        
        // Batch: buscar grupos de todos os usuários de uma vez
        const justUserIds = [...new Set(justifications.map(j => j.user_id))];
        let justGroupsMap = new Map();
        if (justUserIds.length > 0) {
            const ph = justUserIds.map(() => '?').join(',');
            const allGroups = await getAll(`SELECT user_id, group_name FROM user_groups WHERE user_id IN (${ph})`, justUserIds);
            for (const g of allGroups) {
                if (!justGroupsMap.has(g.user_id)) justGroupsMap.set(g.user_id, []);
                justGroupsMap.get(g.user_id).push(g.group_name);
            }
        }
        for (const justification of justifications) {
            justification.user_groups = justGroupsMap.get(justification.user_id) || [];
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
        
        // Batch: buscar grupos de todos os usuários de uma vez
        const allJustUserIds = [...new Set(justifications.map(j => j.user_id))];
        let allJustGroupsMap = new Map();
        if (allJustUserIds.length > 0) {
            const ph = allJustUserIds.map(() => '?').join(',');
            const allGroups = await getAll(`SELECT user_id, group_name FROM user_groups WHERE user_id IN (${ph})`, allJustUserIds);
            for (const g of allGroups) {
                if (!allJustGroupsMap.has(g.user_id)) allJustGroupsMap.set(g.user_id, []);
                allJustGroupsMap.get(g.user_id).push(g.group_name);
            }
        }
        for (const justification of justifications) {
            justification.user_groups = allJustGroupsMap.get(justification.user_id) || [];
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
        
        // Roles/grupos permitidos para editar status
        const allowedRoles = ['gerente_geral', 'gerente_farm', '01', '02', 'super_admin'];
        const isSuperAdmin = isSuperAdminUser(adminUser);
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
        
        // Não pode dar ADV em usuários de super admin
        if (member.role === 'super_admin' || member.passport === '6999') {
            return res.status(400).json({ error: 'Não é possível advertir este usuário protegido' });
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

// Remover advertência (qualquer gerente)
router.delete('/warnings/:id', requireAdmin, async (req, res) => {
    try {
        const warningId = req.params.id;
        const { removal_reason } = req.body;
        const adminId = req.session.user.id;
        const sessionGroups = Array.isArray(req.session.user.groups) ? req.session.user.groups : [];
        const userGroups = await getUserGroups(adminId).catch(() => []);
        const canRemoveWarning = isSuperAdminUser(req.session.user)
            || isManagerByGroups([...sessionGroups, ...userGroups, req.session.user.role]);

        if (!canRemoveWarning) {
            return res.status(403).json({ error: 'Apenas gerentes podem remover ADV' });
        }
        
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
    { id: 'weapon-sales', name: 'Extrato de Vendas', section: 'Estatísticas', icon: '🔫' },
    { id: 'weapon-freebies', name: 'Armas Gratuitas', section: 'Estatísticas', icon: '🎁' },
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
    { id: 'weapon-catalog', name: 'Armas e Valores', section: 'Configurações', icon: '🔫' },
    { id: 'family-commandments', name: 'Mandamentos da Familia', section: 'Configurações', icon: '📜' },
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
// - family-commandments: Mandamentos da Familia
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
            'ranking', 'materials-stats', 'all-deliveries', 'weekly-report', 'weapon-sales', 'weapon-freebies', 'weapon-catalog',
            'farm-settings', 'family-commandments', 'edit-permissions', 'goals', 'manage-materials', 'manage-payment-types', 'manager-goals', 'whitelist'
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
            'ranking', 'materials-stats', 'all-deliveries', 'weekly-report', 'weapon-sales', 'weapon-freebies', 'weapon-catalog',
            'family-commandments', 'edit-permissions', 'goals', 'manager-goals'
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
    },
    {
        role_name: 'gerente_vendas',
        display_name: 'Gerente de Vendas',
        permissions: JSON.stringify([
            'weekly-status', 'members-panel', 'members-overview',
            'members', 'members-adv',
            'ranking', 'materials-stats', 'all-deliveries', 'goals', 'manager-goals', 'weapon-sales', 'weapon-freebies', 'weapon-catalog'
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
        // Garantir que a coluna reset_code existe
        if (isPostgres) {
            try {
                await runQuery(`ALTER TABLE password_resets ADD COLUMN IF NOT EXISTS reset_code TEXT`);
            } catch (e) { /* coluna já existe */ }
        } else {
            try {
                await runQuery(`ALTER TABLE password_resets ADD COLUMN reset_code TEXT`);
            } catch (e) { /* coluna já existe */ }
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
    try {
        await ensurePasswordResetsTable();
        
        const requests = await getAll(`
            SELECT pr.*, u.name as user_name, u.passport as user_passport
            FROM password_resets pr
            JOIN users u ON pr.user_id = u.id
            WHERE pr.status = 'pending'
            ORDER BY pr.requested_at ASC
        `);
        
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
        
        // Batch: carregar todos os materiais e screenshots de uma vez
        const allMaterials = await getAll('SELECT id, name, icon FROM materials');
        const materialsMap = new Map(allMaterials.map(m => [String(m.id), m]));
        
        const extraIds = extras.map(e => e.id);
        let allScreenshots = [];
        if (extraIds.length > 0) {
            const ph = extraIds.map(() => '?').join(',');
            try {
                allScreenshots = await getAll(`SELECT id, extra_farm_id, screenshot_url FROM extra_farm_screenshots WHERE extra_farm_id IN (${ph})`, extraIds);
            } catch (e) {}
        }
        const screenshotsByExtra = new Map();
        for (const s of allScreenshots) {
            if (!screenshotsByExtra.has(s.extra_farm_id)) screenshotsByExtra.set(s.extra_farm_id, []);
            screenshotsByExtra.get(s.extra_farm_id).push(s);
        }
        
        for (const extra of extras) {
            extra.screenshots = screenshotsByExtra.get(extra.id) || [];
            const materials = JSON.parse(extra.materials || '{}');
            const materialDetails = [];
            for (const [matId, amount] of Object.entries(materials)) {
                if (matId === 'dirty_money') {
                    materialDetails.push({ name: 'Dinheiro Sujo', icon: '💰', amount: `$${parseInt(amount).toLocaleString()}` });
                } else {
                    const mat = materialsMap.get(matId);
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
                u.role as user_role,
                u.member_slot,
                u.manager_slot,
                d.week_start,
                d.week_end
            FROM extra_farm_requests ef
            JOIN users u ON ef.user_id = u.id
            JOIN deliveries d ON ef.delivery_id = d.id
            WHERE ef.status = 'pending'
            ORDER BY ef.created_at DESC
        `);
        
        console.log('🏆 Farms extras encontrados:', extras.length);
        
        // Batch: carregar todos os materiais e screenshots de uma vez
        if (extras.length > 0) {
            const userIds = [...new Set(extras.map(e => e.user_id).filter(Boolean))];
            const groupRows = userIds.length > 0
                ? await getAll(`
                    SELECT user_id, group_name
                    FROM user_groups
                    WHERE user_id IN (${userIds.map(() => '?').join(',')})
                `, userIds)
                : [];
            const groupsByUser = new Map();
            for (const row of groupRows) {
                if (!groupsByUser.has(row.user_id)) groupsByUser.set(row.user_id, []);
                groupsByUser.get(row.user_id).push(row.group_name);
            }

            for (const extra of extras) {
                const groups = groupsByUser.get(extra.user_id) || [];
                const isManager = isManagerByGroups([...groups, extra.user_role]);
                extra.groups = groups;
                extra.storage_slot = isManager ? extra.manager_slot : extra.member_slot;
                extra.storage_slot_type = isManager ? 'manager' : 'member';
                extra.storage_slot_label = isManager ? 'Bau da Gerencia' : 'Bau dos Membros';
            }
        }

        const allMaterials = await getAll('SELECT id, name, icon FROM materials');
        const materialsMap = new Map(allMaterials.map(m => [String(m.id), m]));
        
        const extraIds = extras.map(e => e.id);
        let allScreenshots = [];
        if (extraIds.length > 0) {
            const ph = extraIds.map(() => '?').join(',');
            try {
                allScreenshots = await getAll(`SELECT id, extra_farm_id, screenshot_url FROM extra_farm_screenshots WHERE extra_farm_id IN (${ph})`, extraIds);
            } catch (e) {}
        }
        const screenshotsByExtra = new Map();
        for (const s of allScreenshots) {
            if (!screenshotsByExtra.has(s.extra_farm_id)) screenshotsByExtra.set(s.extra_farm_id, []);
            screenshotsByExtra.get(s.extra_farm_id).push(s);
        }
        
        for (const extra of extras) {
            extra.screenshots = screenshotsByExtra.get(extra.id) || [];
            const materials = JSON.parse(extra.materials || '{}');
            const materialDetails = [];
            for (const [matId, amount] of Object.entries(materials)) {
                if (matId === 'dirty_money') {
                    materialDetails.push({ name: 'Dinheiro Sujo', icon: '💰', amount: `$${parseInt(amount).toLocaleString()}` });
                } else {
                    const mat = materialsMap.get(matId);
                    if (mat) {
                        materialDetails.push({ name: mat.name, icon: mat.icon || '📦', amount: amount });
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
        
        // Batch: carregar todos os materiais e screenshots de uma vez
        const allMaterials = await getAll('SELECT id, name, icon FROM materials');
        const materialsMap = new Map(allMaterials.map(m => [String(m.id), m]));
        
        const extraIds = extras.map(e => e.id);
        let allScreenshots = [];
        if (extraIds.length > 0) {
            const ph = extraIds.map(() => '?').join(',');
            try {
                allScreenshots = await getAll(`SELECT id, extra_farm_id, screenshot_url FROM extra_farm_screenshots WHERE extra_farm_id IN (${ph})`, extraIds);
            } catch (e) {}
        }
        const screenshotsByExtra = new Map();
        for (const s of allScreenshots) {
            if (!screenshotsByExtra.has(s.extra_farm_id)) screenshotsByExtra.set(s.extra_farm_id, []);
            screenshotsByExtra.get(s.extra_farm_id).push(s);
        }
        
        for (const extra of extras) {
            extra.screenshots = screenshotsByExtra.get(extra.id) || [];
            const materials = JSON.parse(extra.materials || '{}');
            const materialDetails = [];
            let totalMaterials = 0;
            for (const [matId, amount] of Object.entries(materials)) {
                if (matId === 'dirty_money') {
                    materialDetails.push({ name: 'Dinheiro Sujo', amount: `$${parseInt(amount).toLocaleString()}`, rawAmount: parseInt(amount) });
                } else {
                    const mat = materialsMap.get(matId);
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

// Todas as submissões da semana do membro (aprovadas + rejeitadas + pendentes) para o extrato do olho
router.get('/week-submissions', requireAdmin, async (req, res) => {
    try {
        const { userId, week_start, week_end } = req.query;
        if (!userId || !week_start || !week_end) {
            return res.status(400).json({ error: 'userId, week_start e week_end são obrigatórios' });
        }
        const deliveries = await getAll(`
            SELECT d.*, d.created_at as delivered_at, u.name as approved_by_name
            FROM deliveries d
            LEFT JOIN users u ON d.approved_by = u.id
            WHERE d.user_id = ? AND d.week_start = ? AND d.week_end = ?
            ORDER BY d.created_at DESC
        `, [userId, week_start, week_end]);
        if (!deliveries || deliveries.length === 0) {
            return res.json({ success: true, submissions: [] });
        }
        const deliveryIds = deliveries.map(d => d.id);
        const placeholders = deliveryIds.map(() => '?').join(',');
        const allItems = await getAll(`
            SELECT di.delivery_id, di.material_id, di.amount, m.name as material_name, m.icon as material_icon, m.weekly_goal, m.manager_weekly_goal, m.target_role
            FROM delivery_items di
            JOIN materials m ON di.material_id = m.id
            WHERE di.delivery_id IN (${placeholders})
        `, deliveryIds);
        const allScreenshots = await getAll(`
            SELECT delivery_id, screenshot_url FROM delivery_screenshots WHERE delivery_id IN (${placeholders})
        `, deliveryIds);
        const deliveryGroups = await getUserGroups(userId);
        const isManager = isManagerByGroups(deliveryGroups);
        const itemsByDid = new Map();
        for (const it of allItems) {
            if (!productAppliesToRole(it, isManager)) continue;
            if (!itemsByDid.has(it.delivery_id)) itemsByDid.set(it.delivery_id, []);
            itemsByDid.get(it.delivery_id).push({
                ...it,
                weekly_goal: isManager ? (it.manager_weekly_goal ?? it.weekly_goal) : it.weekly_goal
            });
        }
        const screenshotsByDid = new Map();
        for (const s of allScreenshots) {
            if (!screenshotsByDid.has(s.delivery_id)) screenshotsByDid.set(s.delivery_id, []);
            screenshotsByDid.get(s.delivery_id).push(s);
        }
        const submissions = deliveries.map(d => {
            const submissionItems = (itemsByDid.get(d.id) || []).map(item => ({ ...item }));
            const submissionScreenshots = screenshotsByDid.get(d.id) || [];
            let paymentType = d.payment_type || 'material';
            if (d.dirty_money_amount > 0 && submissionItems.length === 0) paymentType = 'dirty_money';
            return {
                id: d.id,
                status: d.status,
                is_partial: d.is_partial,
                delivered_at: d.delivered_at,
                created_at: d.created_at,
                screenshot_url: d.screenshot_url,
                screenshots: submissionScreenshots,
                description: d.description,
                items: submissionItems,
                payment_type: paymentType,
                dirty_money_amount: d.dirty_money_amount || 0,
                approved_by_name: d.approved_by_name,
                approved_at: d.approved_at,
                approval_note: d.approval_note
            };
        });
        return res.json({ success: true, submissions });
    } catch (err) {
        console.error('Erro em week-submissions:', err);
        res.status(500).json({ success: false, error: err.message });
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
                SELECT di.*, d.id as delivery_id, m.name as material_name, m.icon as material_icon, m.weekly_goal, m.manager_weekly_goal, m.target_role
                FROM delivery_items di
                JOIN deliveries d ON di.delivery_id = d.id
                JOIN materials m ON di.material_id = m.id
                WHERE di.delivery_id IN (${placeholders})
                ORDER BY m.name ASC
            `, deliveryIds);
        }
        allItems = allItems.filter(item => productAppliesToRole(item, isManager));
        
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
        
        // Por entrega: itens e screenshots (para o modal mostrar farm correto, não soma)
        const itemsByDeliveryId = new Map();
        for (const item of allItems) {
            const did = item.delivery_id != null ? Number(item.delivery_id) : item.delivery_id;
            if (!itemsByDeliveryId.has(did)) itemsByDeliveryId.set(did, []);
            itemsByDeliveryId.get(did).push({
                ...item,
                weekly_goal: isManager ? (item.manager_weekly_goal ?? item.weekly_goal) : item.weekly_goal
            });
        }
        const screenshotsByDeliveryId = new Map();
        for (const ss of allScreenshots) {
            const did = ss.delivery_id != null ? Number(ss.delivery_id) : ss.delivery_id;
            if (!screenshotsByDeliveryId.has(did)) screenshotsByDeliveryId.set(did, []);
            screenshotsByDeliveryId.get(did).push(ss);
        }
        const deliveriesWithItems = deliveries.map(d => ({
            delivery: d,
            items: itemsByDeliveryId.get(d.id) || [],
            screenshots: screenshotsByDeliveryId.get(d.id) || []
        }));
        
        // Buscar todos os materiais para permitir adicionar novos
        let allMaterials = await getAll('SELECT * FROM materials WHERE active = 1 ORDER BY name');
        allMaterials = allMaterials
            .filter(mat => productAppliesToRole(mat, isManager))
            .map(mat => ({
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

        // Recalcular is_partial pela soma da semana (espelho do Status da Semana): todos os materiais ativos
        if (aggregatedStatus === 'approved') {
            const mainDelivery = deliveries.find(d => d.status === 'approved') || deliveries[0];
            const hasDirtyMoneyOnly = mainDelivery.dirty_money_amount > 0 && aggregatedItems.length === 0;
            if (hasDirtyMoneyOnly) {
                let totalDirty = 0;
                deliveries.forEach(d => { totalDirty += parseInt(d.dirty_money_amount, 10) || 0; });
                const paymentTypes = await getAll('SELECT id, weekly_goal, manager_weekly_goal FROM payment_types');
                const ptMap = new Map((paymentTypes || []).map(pt => [pt.id, pt]));
                const pt = ptMap.get(mainDelivery.payment_type_id) || {};
                const goal = isManager ? (pt.manager_weekly_goal ?? pt.weekly_goal ?? 50000) : (pt.weekly_goal ?? 50000);
                const numGoal = parseInt(goal, 10) || 50000;
                aggregatedIsPartial = totalDirty < numGoal;
            } else {
                const sumByMat = new Map();
                for (const item of aggregatedItems) {
                    const mid = item.material_id != null ? Number(item.material_id) : item.material_id;
                    const prev = sumByMat.get(mid) || 0;
                    sumByMat.set(mid, prev + (parseInt(item.amount, 10) || 0));
                }
                let all100 = true;
                for (const mat of allMaterials) {
                    const matId = mat.id != null ? Number(mat.id) : mat.id;
                    const total = sumByMat.get(matId) || 0;
                    const goal = mat.weekly_goal != null ? parseInt(mat.weekly_goal, 10) : 700;
                    const numGoal = goal || 700;
                    if (total < numGoal) {
                        all100 = false;
                        break;
                    }
                }
                aggregatedIsPartial = !all100;
            }
        }

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
            deliveriesWithItems,   // Cada entrega com seus itens e screenshots (farm correto)
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
            SELECT di.*, m.name as material_name, m.icon as material_icon, m.weekly_goal, m.manager_weekly_goal, m.target_role
            FROM delivery_items di
            JOIN materials m ON di.material_id = m.id
            WHERE di.delivery_id = ?
        `, [deliveryId]);

        const adjustedItems = items
            .filter(item => productAppliesToRole(item, isManager))
            .map(item => ({
                ...item,
                weekly_goal: isManager ? (item.manager_weekly_goal ?? item.weekly_goal) : item.weekly_goal
            }));
        
        // Buscar screenshots da entrega
        const screenshots = await getAll(`
            SELECT id, screenshot_url FROM delivery_screenshots WHERE delivery_id = ?
        `, [deliveryId]);
        
        // Buscar todos os materiais ativos para permitir adicionar novos
        let allMaterials = await getAll('SELECT * FROM materials WHERE active = 1 ORDER BY name');
        allMaterials = allMaterials
            .filter(mat => productAppliesToRole(mat, isManager))
            .map(mat => ({
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
        const material = await getOne('SELECT * FROM materials WHERE id = ? AND active = 1', [materialId]);
        if (!material || !productAppliesToRole(material, isManager)) {
            return res.status(400).json({ error: 'Produto de farm inválido para o cargo deste usuário' });
        }

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
        const materials = (await getAll('SELECT * FROM materials WHERE active = 1'))
            .filter(mat => productAppliesToRole(mat, isManager));
        
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
        
        const isNotDelivered = status === 'not_delivered';
        if (!userId || !weekStart || !weekEnd) {
            return res.status(400).json({ error: 'Dados incompletos' });
        }
        if (!isNotDelivered && (!items || items.length === 0)) {
            return res.status(400).json({ error: 'Informe pelo menos um material' });
        }
        
        // Verificar se já existe entrega para essa semana
        const existing = await getOne(
            'SELECT id FROM deliveries WHERE user_id = ? AND week_start = ? AND week_end = ?',
            [userId, weekStart, weekEnd]
        );

        const isSuperAdmin = isSuperAdminUser(req.session.user);
        const targetGroups = await getUserGroups(userId);
        const targetIsManager = isManagerByGroups(targetGroups);
        const allowedMaterials = (await getAll('SELECT id, target_role FROM materials WHERE active = 1'))
            .filter(m => productAppliesToRole(m, targetIsManager));
        const allowedMaterialIds = new Set(allowedMaterials.map(m => Number(m.id)));
        const invalidItem = (items || []).find(item => {
            const amount = parseInt(item.amount, 10) || 0;
            return amount > 0 && !allowedMaterialIds.has(Number(item.materialId));
        });
        if (!isNotDelivered && invalidItem) {
            return res.status(400).json({ error: 'Produto de farm inválido para o cargo deste usuário' });
        }

        if (existing && !isSuperAdmin) {
            return res.status(400).json({ error: 'Já existe uma entrega para essa semana. Use a edição.' });
        }

        if (existing && isSuperAdmin) {
            const deliveryId = existing.id;
            const realStatus = status === 'in_progress' ? 'approved' : status;
            const isPartial = status === 'in_progress' ? 1 : 0;
            const approvedBy = (realStatus === 'approved') ? adminId : null;
            const approvedAt = (realStatus === 'approved') ? 'CURRENT_TIMESTAMP' : null;

            if (realStatus === 'approved') {
                await runQuery(
                    'UPDATE deliveries SET description = ?, status = ?, is_partial = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?',
                    ['Atualizado manualmente pelo super admin', realStatus, isPartial, adminId, deliveryId]
                );
            } else {
                await runQuery(
                    'UPDATE deliveries SET description = ?, status = ?, is_partial = ?, approved_by = NULL, approved_at = NULL WHERE id = ?',
                    ['Atualizado manualmente pelo super admin', realStatus, isPartial, deliveryId]
                );
            }

            await runQuery('DELETE FROM delivery_items WHERE delivery_id = ?', [deliveryId]);

            for (const item of (items || [])) {
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
        const realStatus = status === 'in_progress' ? 'approved' : (status || 'approved');
        const isPartial = status === 'in_progress' ? 1 : 0;
        const isNotDeliveredNow = realStatus === 'not_delivered';
        
        if (isNotDeliveredNow) {
            const result = await runQuery(`
                INSERT INTO deliveries (user_id, week_start, week_end, description, status, is_partial)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [userId, weekStart, weekEnd, 'Não entregou (registrado pelo admin)', 'not_delivered', 0]);
            const deliveryId = result.lastID;
            console.log(`📝 Admin #${adminId} criou entrega "Não entregou" #${deliveryId} para usuário #${userId}`);
            return res.json({ success: true, message: 'Registro de não entrega criado', deliveryId });
        }
        
        const result = await runQuery(`
            INSERT INTO deliveries (user_id, week_start, week_end, description, status, is_partial, approved_by, approved_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [userId, weekStart, weekEnd, 'Criado manualmente pelo admin', realStatus, isPartial, adminId]);
        
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
        const member = await getOne('SELECT id, name, passport, role FROM users WHERE id = ?', [memberId]);
        if (!member) {
            return res.status(404).json({ error: 'Membro não encontrado' });
        }
        const memberGroups = await getUserGroups(memberId);
        const isManager = isManagerByGroups(memberGroups.length > 0 ? memberGroups : [member.role]);

        // Buscar entregas
        const deliveries = await getAll(`
            SELECT d.*
            FROM deliveries d
            WHERE d.user_id = ?
            ORDER BY d.week_start DESC, d.created_at DESC
        `, [memberId]);

        const deliveryIds = deliveries.map(d => d.id);
        if (deliveryIds.length > 0) {
            const placeholders = deliveryIds.map(() => '?').join(',');
            const allItems = await getAll(`
                SELECT di.delivery_id, di.amount, m.name, m.target_role
                FROM delivery_items di
                JOIN materials m ON di.material_id = m.id
                WHERE di.delivery_id IN (${placeholders})
            `, deliveryIds);
            const summaryByDelivery = new Map();
            for (const item of allItems) {
                if (!productAppliesToRole(item, isManager)) continue;
                if (!summaryByDelivery.has(item.delivery_id)) summaryByDelivery.set(item.delivery_id, []);
                summaryByDelivery.get(item.delivery_id).push(`${item.name}: ${item.amount}`);
            }
            for (const delivery of deliveries) {
                delivery.items_summary = (summaryByDelivery.get(delivery.id) || []).join(', ');
            }
        }
        
        // Buscar materiais ativos
        const materials = (await getAll('SELECT * FROM materials WHERE active = 1 ORDER BY name'))
            .filter(material => productAppliesToRole(material, isManager));
        
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

// ===== STORAGE: diagnóstico de espaço e limpeza manual =====

router.get('/storage/stats', requireSuperAdmin, async (req, res) => {
    try {
        const isPostgres = process.env.DATABASE_URL ? true : false;
        const stats = {};

        if (isPostgres) {
            const dbSize = await getOne("SELECT pg_size_pretty(pg_database_size(current_database())) AS size");
            stats.database_size = dbSize?.size || 'N/A';

            const tables = await getAll(`
                SELECT relname AS table_name,
                       pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
                       pg_total_relation_size(c.oid) AS size_bytes
                FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relkind = 'r'
                ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 15
            `);
            stats.tables = tables || [];
        } else {
            stats.database_size = 'SQLite (local)';
            stats.tables = [];
        }

        const counts = await Promise.all([
            getOne('SELECT COUNT(*) AS n FROM delivery_screenshots'),
            getOne('SELECT COUNT(*) AS n FROM deliveries WHERE screenshot_url IS NOT NULL'),
            getOne('SELECT COUNT(*) AS n FROM extra_farm_screenshots').catch(() => ({ n: 0 })),
        ]);
        stats.delivery_screenshots_rows = counts[0]?.n || 0;
        stats.deliveries_with_inline_screenshot = counts[1]?.n || 0;
        stats.extra_farm_screenshots_rows = counts[2]?.n || 0;

        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/storage/cleanup', requireSuperAdmin, async (req, res) => {
    try {
        const db = require('../database/db');
        const result = await db.cleanupOldImages();
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/weapon-stock', requireAdmin, requireWeaponSalesAccess, async (req, res) => {
    try {
        await ensureWeaponSalesTable();

        const stock = await getAll(`
            SELECT *
            FROM weapon_stock
            ORDER BY active DESC, weapon_name ASC
        `);

        const stats = (stock || []).reduce((acc, item) => {
            if (item.active === 0 || item.active === false) return acc;
            acc.total_models += 1;
            acc.total_stock += Number(item.current_stock || 0);
            return acc;
        }, { total_models: 0, total_stock: 0 });

        res.json({ success: true, stock: stock || [], stats });
    } catch (error) {
        console.error('Erro ao buscar estoque de armas:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/weapon-stock', requireAdmin, requireWeaponSalesAccess, async (req, res) => {
    try {
        await ensureWeaponSalesTable();

        const weaponName = String(req.body.weapon_name || '').trim();
        const quantity = parseInt(req.body.quantity, 10) || 0;
        const rawPrice = String(req.body.sale_price ?? '0').trim();
        const salePrice = Number(rawPrice.includes(',')
            ? rawPrice.replace(/\./g, '').replace(',', '.')
            : rawPrice
        );

        if (!weaponName) {
            return res.status(400).json({ error: 'Informe o nome da arma' });
        }

        if (quantity < 0) {
            return res.status(400).json({ error: 'A quantidade inicial não pode ser negativa' });
        }

        if (!Number.isFinite(salePrice) || salePrice < 0) {
            return res.status(400).json({ error: 'Informe um valor de venda válido' });
        }

        const existing = await getOne('SELECT id FROM weapon_stock WHERE LOWER(weapon_name) = LOWER(?)', [weaponName]);
        if (existing) {
            return res.status(400).json({ error: 'Esta arma já está cadastrada no estoque' });
        }

        const result = await runQuery(
            'INSERT INTO weapon_stock (weapon_name, current_stock, sale_price, active, created_by) VALUES (?, ?, ?, ?, ?)',
            [weaponName, quantity, salePrice, 1, req.session.user.id]
        );

        res.json({ success: true, message: 'Arma cadastrada com sucesso', stockId: result.lastID });
    } catch (error) {
        console.error('Erro ao cadastrar arma no estoque:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/weapon-stock/:id/adjust', requireAdmin, requireWeaponSalesAccess, async (req, res) => {
    try {
        await ensureWeaponSalesTable();

        const stockId = req.params.id;
        const type = String(req.body.type || '').trim();
        const quantity = parseInt(req.body.quantity, 10);

        if (!['add', 'remove', 'set'].includes(type)) {
            return res.status(400).json({ error: 'Tipo de ajuste inválido' });
        }

        if (!Number.isInteger(quantity) || (type === 'set' ? quantity < 0 : quantity <= 0)) {
            return res.status(400).json({ error: 'Informe uma quantidade válida' });
        }

        const stock = await getOne('SELECT * FROM weapon_stock WHERE id = ?', [stockId]);
        if (!stock) {
            return res.status(404).json({ error: 'Arma não encontrada no estoque' });
        }

        const currentStock = Number(stock.current_stock || 0);
        const nextStock = type === 'set'
            ? quantity
            : (type === 'add' ? currentStock + quantity : currentStock - quantity);
        if (nextStock < 0) {
            return res.status(400).json({ error: `Estoque insuficiente. Disponível: ${currentStock}` });
        }

        await runQuery(
            'UPDATE weapon_stock SET current_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [nextStock, stockId]
        );

        res.json({ success: true, message: 'Estoque atualizado', current_stock: nextStock });
    } catch (error) {
        console.error('Erro ao ajustar estoque de armas:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/weapon-stock/:id/toggle', requireAdmin, requireWeaponSalesAccess, async (req, res) => {
    try {
        await ensureWeaponSalesTable();

        const stock = await getOne('SELECT id, active FROM weapon_stock WHERE id = ?', [req.params.id]);
        if (!stock) {
            return res.status(404).json({ error: 'Arma não encontrada no estoque' });
        }

        const nextActive = (stock.active === 0 || stock.active === false) ? 1 : 0;
        await runQuery(
            'UPDATE weapon_stock SET active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [nextActive, req.params.id]
        );

        res.json({ success: true, active: nextActive });
    } catch (error) {
        console.error('Erro ao alterar status do estoque:', error);
        res.status(500).json({ error: error.message });
    }
});

// Atualizar valor de venda de uma arma do catálogo
router.post('/weapon-stock/:id/price', requireAdmin, requireWeaponSalesAccess, async (req, res) => {
    try {
        await ensureWeaponSalesTable();

        const rawPrice = String(req.body.sale_price ?? '').trim();
        const salePrice = Number(rawPrice.includes(',')
            ? rawPrice.replace(/\./g, '').replace(',', '.')
            : rawPrice
        );

        if (!Number.isFinite(salePrice) || salePrice < 0) {
            return res.status(400).json({ error: 'Informe um valor de venda válido' });
        }

        const stock = await getOne('SELECT id, weapon_name FROM weapon_stock WHERE id = ?', [req.params.id]);
        if (!stock) {
            return res.status(404).json({ error: 'Arma não encontrada no estoque' });
        }

        await runQuery(
            'UPDATE weapon_stock SET sale_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [salePrice, req.params.id]
        );

        res.json({ success: true, message: `Valor de ${stock.weapon_name} atualizado`, sale_price: salePrice });
    } catch (error) {
        console.error('Erro ao atualizar valor da arma:', error);
        res.status(500).json({ error: error.message });
    }
});

// Lista de vendedores possíveis (gerentes ativos)
router.get('/weapon-sellers', requireAdmin, requireWeaponSalesAccess, async (req, res) => {
    try {
        const users = await getAll(`
            SELECT id, name, passport, role
            FROM users
            WHERE active = 1
              AND passport NOT IN ('admin', '0')
            ORDER BY name ASC
        `);

        const groupsMap = await getUserGroupsMap((users || []).map(u => u.id));
        const sellers = (users || []).filter(user => {
            const groups = groupsMap.get(user.id) || (user.role ? [user.role] : []);
            return groups.some(g => managerGroups.has(normalizeGroupName(g)));
        }).map(user => ({
            id: user.id,
            name: user.name,
            passport: user.passport,
            groups: groupsMap.get(user.id) || (user.role ? [user.role] : [])
        }));

        res.json({ success: true, sellers });
    } catch (error) {
        console.error('Erro ao buscar vendedores:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/weapon-production', requireAdmin, requireWeaponSalesAccess, async (req, res) => {
    try {
        await ensureWeaponSalesTable();

        const entries = await getAll(`
            SELECT wpe.*, u.name AS created_by_name
            FROM weapon_production_entries wpe
            LEFT JOIN users u ON u.id = wpe.created_by
            ORDER BY wpe.production_date DESC, wpe.created_at DESC, wpe.id DESC
            LIMIT 30
        `);

        const stats = (entries || []).reduce((acc, entry) => {
            acc.total_quantity += Number(entry.quantity || 0);
            acc.total_entries += 1;
            return acc;
        }, { total_entries: 0, total_quantity: 0 });

        res.json({ success: true, entries: entries || [], stats });
    } catch (error) {
        console.error('Erro ao buscar entradas de fabricacao:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/weapon-production', requireAdmin, requireWeaponSalesAccess, async (req, res) => {
    try {
        await ensureWeaponSalesTable();

        const stockId = parseInt(req.body.stock_id, 10);
        const quantity = parseInt(req.body.quantity, 10);
        const productionDate = String(req.body.production_date || '').trim();
        const responsibleName = String(req.body.responsible_name || '').trim();
        const notes = String(req.body.notes || '').trim();

        if (!Number.isInteger(stockId) || stockId <= 0) {
            return res.status(400).json({ error: 'Selecione uma arma do estoque' });
        }

        if (!Number.isInteger(quantity) || quantity <= 0) {
            return res.status(400).json({ error: 'Informe uma quantidade fabricada valida' });
        }

        if (!/^\d{4}-\d{2}-\d{2}$/.test(productionDate)) {
            return res.status(400).json({ error: 'Informe uma data de fabricacao valida' });
        }

        const stock = await getOne('SELECT * FROM weapon_stock WHERE id = ?', [stockId]);
        if (!stock) {
            return res.status(404).json({ error: 'Arma nao encontrada no estoque' });
        }

        if (stock.active === 0 || stock.active === false) {
            return res.status(400).json({ error: 'Nao e possivel fabricar entrada para uma arma inativa' });
        }

        const result = await runQuery(`
            INSERT INTO weapon_production_entries (
                stock_id, weapon_name, quantity, production_date, responsible_name, notes, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            stock.id,
            stock.weapon_name,
            quantity,
            productionDate,
            responsibleName || null,
            notes || null,
            req.session.user.id
        ]);

        await runQuery(
            'UPDATE weapon_stock SET current_stock = current_stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [quantity, stock.id]
        );

        res.json({
            success: true,
            message: `Entrada de fabricacao registrada: ${stock.weapon_name} +${quantity}`,
            productionId: result.lastID
        });
    } catch (error) {
        console.error('Erro ao registrar entrada de fabricacao:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/weapon-sales', requireAdmin, requireWeaponSalesAccess, async (req, res) => {
    try {
        await ensureWeaponSalesTable();

        const { start, end } = req.query;
        const where = [];
        const params = [];

        if (start) {
            where.push('ws.sale_date >= ?');
            params.push(start);
        }

        if (end) {
            where.push('ws.sale_date <= ?');
            params.push(end);
        }

        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const sales = await getAll(`
            SELECT ws.*, u.name as created_by_name
            FROM weapon_sales ws
            LEFT JOIN users u ON ws.created_by = u.id
            ${whereSql}
            ORDER BY ws.sale_date DESC, ws.created_at DESC, ws.id DESC
        `, params);

        const saleIds = (sales || []).map(s => s.id);
        let itemsBySale = new Map();
        if (saleIds.length > 0) {
            const placeholders = saleIds.map(() => '?').join(',');
            const items = await getAll(`
                SELECT *
                FROM weapon_sale_items
                WHERE sale_id IN (${placeholders})
                ORDER BY id ASC
            `, saleIds);
            for (const item of items || []) {
                if (!itemsBySale.has(item.sale_id)) itemsBySale.set(item.sale_id, []);
                itemsBySale.get(item.sale_id).push(item);
            }
        }

        for (const sale of sales || []) {
            sale.items = itemsBySale.get(sale.id) || [{
                weapon_name: sale.weapon_name,
                quantity: Number(sale.quantity || 0)
            }];
        }

        const stats = (sales || []).reduce((acc, sale) => {
            const itemQuantity = (sale.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
            acc.total_quantity += itemQuantity || Number(sale.quantity || 0);
            acc.total_value += Number(sale.sale_value || 0);
            acc.total_sales += 1;
            return acc;
        }, { total_sales: 0, total_quantity: 0, total_value: 0 });

        res.json({ success: true, sales: sales || [], stats });
    } catch (error) {
        console.error('Erro ao buscar vendas de armas:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/weapon-sales', requireAdmin, requireWeaponSalesAccess, (req, res) => {
    upload(req, res, async (err) => {
        if (err) {
            return res.status(400).json({ error: err.message });
        }

        try {
            await ensureWeaponSalesTable();

            const {
                weapon_name,
                weapon_items,
                quantity,
                sale_value,
                buyer_name,
                seller_name,
                notes,
                sale_date
            } = req.body;

            const weaponName = String(weapon_name || '').trim();
            const qty = parseInt(quantity, 10);
            const saleItems = await resolveWeaponSaleItems(parseWeaponSaleItems(weapon_items, weaponName, qty));
            const totalQuantity = saleItems.reduce((sum, item) => sum + item.quantity, 0);
            const saleWeaponSummary = saleItems.map(item => `${item.weapon_name} x${item.quantity}`).join(', ');
            const saleDate = String(sale_date || '').trim();

            // Valor calculado automaticamente pelos preços do catálogo (Armas e Valores)
            let saleValue = 0;
            const missingPrice = [];
            for (const item of saleItems) {
                const stockRow = await getOne('SELECT sale_price FROM weapon_stock WHERE id = ?', [item.stock_id]);
                const price = Number(stockRow?.sale_price || 0);
                if (!Number.isFinite(price) || price <= 0) {
                    missingPrice.push(item.weapon_name);
                } else {
                    saleValue += price * item.quantity;
                }
            }

            if (missingPrice.length > 0) {
                return res.status(400).json({
                    error: `Defina o valor de venda em Configurações > Armas e Valores para: ${missingPrice.join(', ')}`
                });
            }

            saleValue = Math.round(saleValue * 100) / 100;

            if (!/^\d{4}-\d{2}-\d{2}$/.test(saleDate)) {
                return res.status(400).json({ error: 'Informe uma data de venda válida' });
            }

            if (!req.files || req.files.length === 0) {
                return res.status(400).json({ error: 'Envie um print de comprovação' });
            }

            const fs = require('fs');
            const uploadDir = path.join(__dirname, '..', 'uploads');
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }

            const file = req.files[0];
            const filename = `${uuidv4()}${path.extname(file.originalname)}`;
            const filepath = path.join(uploadDir, filename);
            fs.writeFileSync(filepath, file.buffer);
            const proofUrl = '/uploads/' + filename;
            const proofData = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;

            const result = await runQuery(`
                INSERT INTO weapon_sales (
                    weapon_name, quantity, sale_value, buyer_name, seller_name,
                    proof_url, proof_data, notes, sale_date, created_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                saleWeaponSummary,
                totalQuantity,
                saleValue,
                buyer_name?.trim() || null,
                seller_name?.trim() || null,
                proofUrl,
                proofData,
                notes?.trim() || null,
                saleDate,
                req.session.user.id
            ]);

            for (const item of saleItems) {
                await runQuery(
                    'INSERT INTO weapon_sale_items (sale_id, stock_id, weapon_name, quantity) VALUES (?, ?, ?, ?)',
                    [result.lastID, item.stock_id, item.weapon_name, item.quantity]
                );
                await runQuery(
                    'UPDATE weapon_stock SET current_stock = current_stock - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                    [item.quantity, item.stock_id]
                );
            }

            res.json({
                success: true,
                message: 'Venda registrada com sucesso',
                saleId: result.lastID,
                proof_url: proofUrl,
                proof_data: proofData
            });
        } catch (error) {
            console.error('Erro ao registrar venda de arma:', error);
            res.status(500).json({ error: error.message });
        }
    });
});

router.delete('/weapon-sales/:id', requireAdmin, requireWeaponSalesAccess, async (req, res) => {
    try {
        await ensureWeaponSalesTable();

        const saleId = req.params.id;
        const sale = await getOne('SELECT * FROM weapon_sales WHERE id = ?', [saleId]);
        if (!sale) {
            return res.status(404).json({ error: 'Venda não encontrada' });
        }

        let saleItems = [];
        try {
            saleItems = await getAll('SELECT * FROM weapon_sale_items WHERE sale_id = ?', [saleId]);
        } catch (e) {
            saleItems = [];
        }

        if (!saleItems || saleItems.length === 0) {
            saleItems = [{ weapon_name: sale.weapon_name, quantity: Number(sale.quantity || 0) }];
        }

        for (const item of saleItems) {
            await restoreWeaponStock(item);
        }

        await runQuery('DELETE FROM weapon_sale_items WHERE sale_id = ?', [saleId]);
        await runQuery('DELETE FROM weapon_sales WHERE id = ?', [saleId]);

        if (sale.proof_url && sale.proof_url.startsWith('/uploads/')) {
            try {
                const fs = require('fs');
                const filepath = path.join(__dirname, '..', sale.proof_url);
                if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
            } catch (fileError) {
                console.log('⚠️ Não foi possível remover print da venda:', fileError.message);
            }
        }

        res.json({ success: true, message: 'Venda removida com sucesso' });
    } catch (error) {
        console.error('Erro ao remover venda de arma:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/weapon-freebies', requireAdmin, requireWeaponSalesAccess, async (req, res) => {
    try {
        await ensureWeaponSalesTable();

        const week = getCurrentWeek();
        const users = await getAll(`
            SELECT id, name, passport, role, active
            FROM users
            WHERE active = 1
              AND passport NOT IN ('admin', '0')
            ORDER BY name ASC
        `);

        const userIds = (users || []).map(user => user.id);
        const groupsMap = await getUserGroupsMap(userIds);
        const freebieStock = (await getAll(`
            SELECT *
            FROM weapon_stock
            WHERE active = 1
            ORDER BY weapon_name ASC
        `)).filter(item => isFamilyFreeWeapon(item.weapon_name));

        const entries = await getAll(`
            SELECT wf.*, u.name AS user_name, u.passport AS user_passport, c.name AS created_by_name
            FROM weapon_freebies wf
            JOIN users u ON u.id = wf.user_id
            LEFT JOIN users c ON c.id = wf.created_by
            WHERE wf.week_start = ? AND wf.week_end = ?
            ORDER BY wf.created_at DESC, wf.id DESC
        `, [week.start, week.end]);

        const usedByUser = new Map();
        for (const entry of entries || []) {
            const used = Number(entry.quantity || 0);
            usedByUser.set(entry.user_id, (usedByUser.get(entry.user_id) || 0) + used);
        }

        const members = (users || []).map(user => {
            const used = usedByUser.get(user.id) || 0;
            return {
                id: user.id,
                name: user.name,
                passport: user.passport,
                role: user.role,
                groups: groupsMap.get(user.id) || (user.role ? [user.role] : []),
                used,
                limit: WEEKLY_FREE_WEAPON_LIMIT,
                remaining: Math.max(0, WEEKLY_FREE_WEAPON_LIMIT - used),
                status: `${used}/${WEEKLY_FREE_WEAPON_LIMIT}`
            };
        });

        const stats = members.reduce((acc, member) => {
            acc.used += member.used;
            acc.remaining += member.remaining;
            if (member.used >= WEEKLY_FREE_WEAPON_LIMIT) acc.completed += 1;
            if (member.used > 0) acc.with_usage += 1;
            return acc;
        }, { used: 0, remaining: 0, completed: 0, with_usage: 0, members: members.length });

        res.json({
            success: true,
            week,
            limit: WEEKLY_FREE_WEAPON_LIMIT,
            members,
            entries: entries || [],
            stock: freebieStock,
            stats
        });
    } catch (error) {
        console.error('Erro ao buscar retiradas gratuitas:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/weapon-freebies', requireAdmin, requireWeaponSalesAccess, async (req, res) => {
    try {
        await ensureWeaponSalesTable();

        const rawAssignments = Array.isArray(req.body.assignments) ? req.body.assignments : null;
        let assignments = [];

        if (rawAssignments) {
            assignments = rawAssignments.map(item => ({
                user_id: parseInt(item.user_id, 10),
                stock_id: parseInt(item.stock_id, 10),
                quantity: parseInt(item.quantity, 10)
            }));
        } else {
            const rawUserIds = Array.isArray(req.body.user_ids)
                ? req.body.user_ids
                : (req.body.user_id ? [req.body.user_id] : []);
            const stockId = parseInt(req.body.stock_id, 10);
            const quantity = parseInt(req.body.quantity, 10);
            assignments = rawUserIds.map(userId => ({
                user_id: parseInt(userId, 10),
                stock_id: stockId,
                quantity
            }));
        }

        assignments = assignments.filter(item =>
            Number.isInteger(item.user_id) && item.user_id > 0 &&
            Number.isInteger(item.stock_id) && item.stock_id > 0 &&
            Number.isInteger(item.quantity) && item.quantity > 0
        );

        const week = getCurrentWeek();

        if (assignments.length === 0) {
            return res.status(400).json({ error: 'Selecione pelo menos uma retirada valida' });
        }

        const userIds = [...new Set(assignments.map(item => item.user_id))];
        const stockIds = [...new Set(assignments.map(item => item.stock_id))];

        const userPlaceholders = userIds.map(() => '?').join(',');
        const members = await getAll(
            `SELECT id, name, active FROM users WHERE id IN (${userPlaceholders}) AND active = 1 AND passport NOT IN ('admin', '0')`,
            userIds
        );
        const membersById = new Map((members || []).map(member => [Number(member.id), member]));
        const invalidIds = userIds.filter(id => !membersById.has(id));
        if (invalidIds.length > 0) {
            return res.status(404).json({ error: 'Um ou mais membros selecionados nao foram encontrados ou estao inativos' });
        }

        const stockPlaceholders = stockIds.map(() => '?').join(',');
        const stocks = await getAll(
            `SELECT * FROM weapon_stock WHERE id IN (${stockPlaceholders})`,
            stockIds
        );
        const stocksById = new Map((stocks || []).map(stock => [Number(stock.id), stock]));
        const invalidStocks = [];
        for (const stockId of stockIds) {
            const stock = stocksById.get(stockId);
            if (!stock || stock.active === 0 || stock.active === false || !isFamilyFreeWeapon(stock.weapon_name)) {
                invalidStocks.push(stockId);
            }
        }

        if (invalidStocks.length > 0) {
            return res.status(400).json({ error: 'Uma ou mais armas selecionadas nao sao IA2/MTAR ativas do estoque' });
        }

        const quantityByStock = new Map();
        const quantityByUser = new Map();
        for (const item of assignments) {
            quantityByStock.set(item.stock_id, (quantityByStock.get(item.stock_id) || 0) + item.quantity);
            quantityByUser.set(item.user_id, (quantityByUser.get(item.user_id) || 0) + item.quantity);
        }

        const insufficient = [];
        for (const [stockId, totalQuantity] of quantityByStock.entries()) {
            const stock = stocksById.get(stockId);
            if (Number(stock.current_stock || 0) < totalQuantity) {
                insufficient.push(`${stock.weapon_name}: precisa ${totalQuantity}, disponivel ${stock.current_stock}`);
            }
        }

        if (insufficient.length > 0) {
            return res.status(400).json({ error: `Estoque insuficiente: ${insufficient.join('; ')}` });
        }

        const usageRows = await getAll(
            `SELECT user_id, COALESCE(SUM(quantity), 0) AS used
             FROM weapon_freebies
             WHERE user_id IN (${userPlaceholders}) AND week_start = ? AND week_end = ?
             GROUP BY user_id`,
            [...userIds, week.start, week.end]
        );
        const usageById = new Map((usageRows || []).map(row => [Number(row.user_id), Number(row.used || 0)]));
        const exceeded = [];
        for (const userId of userIds) {
            const used = usageById.get(userId) || 0;
            const adding = quantityByUser.get(userId) || 0;
            if (used + adding > WEEKLY_FREE_WEAPON_LIMIT) {
                const member = membersById.get(userId);
                exceeded.push(`${member.name} (${used}/${WEEKLY_FREE_WEAPON_LIMIT})`);
            }
        }

        if (exceeded.length > 0) {
            return res.status(400).json({
                error: `Limite semanal excedido para: ${exceeded.join(', ')}`
            });
        }

        const createdIds = [];
        for (const item of assignments) {
            const stock = stocksById.get(item.stock_id);
            const result = await runQuery(`
                INSERT INTO weapon_freebies (user_id, stock_id, weapon_name, quantity, week_start, week_end, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [item.user_id, item.stock_id, stock.weapon_name, item.quantity, week.start, week.end, req.session.user.id]);
            createdIds.push(result.lastID);
        }

        for (const [stockId, totalQuantity] of quantityByStock.entries()) {
            await runQuery(
                'UPDATE weapon_stock SET current_stock = current_stock - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [totalQuantity, stockId]
            );
        }

        res.json({
            success: true,
            message: `Retirada registrada para ${userIds.length} membro(s). Total baixado: ${assignments.reduce((sum, item) => sum + item.quantity, 0)}`,
            freebieIds: createdIds
        });
    } catch (error) {
        console.error('Erro ao registrar retirada gratuita:', error);
        res.status(500).json({ error: error.message });
    }
});

router.delete('/weapon-freebies/:id', requireAdmin, requireWeaponSalesAccess, async (req, res) => {
    try {
        await ensureWeaponSalesTable();

        const freebie = await getOne('SELECT * FROM weapon_freebies WHERE id = ?', [req.params.id]);
        if (!freebie) {
            return res.status(404).json({ error: 'Retirada nao encontrada' });
        }

        await restoreWeaponStock({
            stock_id: freebie.stock_id,
            weapon_name: freebie.weapon_name,
            quantity: Number(freebie.quantity || 0)
        });
        await runQuery('DELETE FROM weapon_freebies WHERE id = ?', [req.params.id]);

        res.json({ success: true, message: 'Retirada removida e estoque restaurado' });
    } catch (error) {
        console.error('Erro ao remover retirada gratuita:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
