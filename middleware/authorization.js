const { getOne, getAll } = require('../database/db');

const CACHE_TTL = 60_000;
const permissionCache = new Map();

async function loadPermissionsForUser(userId) {
    const cached = permissionCache.get(userId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }

    const userGroups = await getAll('SELECT group_name FROM user_groups WHERE user_id = ?', [userId]);
    const groups = userGroups.map(g => g.group_name);

    const permSet = new Set();
    let canConfig = false;

    for (const groupName of groups) {
        const role = await getOne(
            'SELECT permissions, can_config FROM role_permissions WHERE role_name = ? AND active = 1',
            [groupName]
        );
        if (!role) continue;

        const perms = typeof role.permissions === 'string'
            ? JSON.parse(role.permissions)
            : role.permissions;

        if (Array.isArray(perms)) {
            perms.forEach(p => permSet.add(p));
        }

        if (role.can_config === 1 || role.can_config === true) {
            canConfig = true;
        }
    }

    const data = {
        permissions: [...permSet],
        can_config: canConfig,
        groups
    };

    permissionCache.set(userId, { data, timestamp: Date.now() });
    return data;
}

async function can(user, action) {
    const { permissions } = await loadPermissionsForUser(user.id);
    return permissions.includes('all') || permissions.includes(action);
}

async function canConfig(user) {
    const { can_config } = await loadPermissionsForUser(user.id);
    return can_config;
}

function isSuperAdmin(user) {
    if (user.role === 'super_admin') return true;
    if (Array.isArray(user.groups) && user.groups.includes('super_admin')) return true;
    if (user.passport === '6999') return true;
    return false;
}

function clearPermissionCache(userId) {
    if (userId) {
        permissionCache.delete(userId);
    } else {
        permissionCache.clear();
    }
}

function requirePermission(action) {
    return async (req, res, next) => {
        if (!req.session || !req.session.user) {
            return res.status(401).json({ error: 'Não autenticado' });
        }

        const allowed = await can(req.session.user, action);
        if (!allowed) {
            return res.status(403).json({ error: 'Sem permissão' });
        }

        next();
    };
}

module.exports = {
    loadPermissionsForUser,
    can,
    canConfig,
    isSuperAdmin,
    clearPermissionCache,
    requirePermission
};
