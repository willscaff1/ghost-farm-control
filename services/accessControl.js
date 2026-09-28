const { getAll } = require('../database/db');

const BASE_MANAGER_GROUPS = new Set([
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

const ADMIN_MARKER_GROUPS = new Set(['member', 'elite']);
const MANAGER_PERMISSION = 'manager-goals';
const ROLE_CACHE_TTL_MS = 5000;

let roleAccessCache = new Map();
let roleAccessCacheAt = 0;

function normalizeGroupName(groupName = '') {
    return String(groupName)
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function parsePermissions(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
        return [];
    }
}

function invalidateRoleAccessCache() {
    roleAccessCacheAt = 0;
}

async function refreshRoleAccessCache(force = false) {
    if (!force && roleAccessCacheAt && Date.now() - roleAccessCacheAt < ROLE_CACHE_TTL_MS) {
        return roleAccessCache;
    }

    const rows = await getAll(`
        SELECT role_name, display_name, permissions, can_config, active
        FROM role_permissions
        WHERE active = 1
    `);
    const nextCache = new Map();

    for (const row of rows || []) {
        const roleName = normalizeGroupName(row.role_name);
        if (!roleName) continue;
        nextCache.set(roleName, {
            ...row,
            role_name: roleName,
            permissions: parsePermissions(row.permissions),
            can_config: row.can_config === 1 || row.can_config === true
        });
    }

    roleAccessCache = nextCache;
    roleAccessCacheAt = Date.now();
    return roleAccessCache;
}

function isManagerGroupName(groupName = '') {
    const normalized = normalizeGroupName(groupName);
    if (!normalized || ADMIN_MARKER_GROUPS.has(normalized)) return false;
    if (BASE_MANAGER_GROUPS.has(normalized) || normalized.startsWith('gerente_')) return true;

    const role = roleAccessCache.get(normalized);
    if (!role) return false;
    const displayName = normalizeGroupName(role.display_name);
    return displayName.includes('gerente') || displayName.includes('lider') ||
        role.permissions.includes(MANAGER_PERMISSION);
}

function isManagerByGroups(groups = []) {
    return groups.some(isManagerGroupName);
}

function uniqueGroups(...sources) {
    return [...new Set(sources.flat()
        .map(normalizeGroupName)
        .filter(Boolean))];
}

function buildAccessProfile(user, groups, rolesByName = roleAccessCache) {
    const normalizedGroups = uniqueGroups(groups, user?.role);
    const permissions = new Set();
    let canConfig = false;

    for (const group of normalizedGroups) {
        const role = rolesByName.get(group);
        if (!role) continue;
        role.permissions.forEach(permission => permissions.add(permission));
        canConfig = canConfig || role.can_config;
    }

    const isSuperAdmin = normalizedGroups.includes('super_admin') ||
        normalizeGroupName(user?.role) === 'super_admin' ||
        String(user?.passport || '') === '6999';
    const allPermissions = [...permissions];

    return {
        groups: normalizedGroups,
        permissions: allPermissions,
        canConfig: canConfig || isSuperAdmin,
        isSuperAdmin,
        isManager: isSuperAdmin || isManagerByGroups(normalizedGroups),
        isAdmin: isSuperAdmin || canConfig || allPermissions.length > 0
    };
}

async function getUserAccessProfile(user) {
    if (!user) return buildAccessProfile(null, []);
    const roles = await refreshRoleAccessCache();
    let persistedGroups = [];

    if (user.id) {
        const rows = await getAll('SELECT group_name FROM user_groups WHERE user_id = ?', [user.id]);
        persistedGroups = (rows || []).map(row => row.group_name);
    }

    const sessionGroups = Array.isArray(user.groups) ? user.groups : [];
    return buildAccessProfile(user, uniqueGroups(persistedGroups, sessionGroups, user.role), roles);
}

async function getUsersAccessProfiles(users = []) {
    const roles = await refreshRoleAccessCache();
    const ids = users.map(user => user.id).filter(Boolean);
    const groupsByUser = new Map();

    if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        const rows = await getAll(
            `SELECT user_id, group_name FROM user_groups WHERE user_id IN (${placeholders})`,
            ids
        );
        for (const row of rows || []) {
            if (!groupsByUser.has(row.user_id)) groupsByUser.set(row.user_id, []);
            groupsByUser.get(row.user_id).push(row.group_name);
        }
    }

    const profiles = new Map();
    for (const user of users) {
        profiles.set(user.id, buildAccessProfile(user, groupsByUser.get(user.id) || [], roles));
    }
    return profiles;
}

function hasPermission(profile, permission) {
    return !!profile && (profile.isSuperAdmin || profile.permissions.includes('all') ||
        profile.permissions.includes(permission));
}

module.exports = {
    MANAGER_PERMISSION,
    normalizeGroupName,
    parsePermissions,
    invalidateRoleAccessCache,
    refreshRoleAccessCache,
    isManagerGroupName,
    isManagerByGroups,
    getUserAccessProfile,
    getUsersAccessProfiles,
    hasPermission
};
