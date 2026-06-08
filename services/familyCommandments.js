const { runQuery, getOne, getAll } = require('../database/db');

const SETTING_KEYS = {
    title: 'family_commandments_title',
    content: 'family_commandments_content',
    version: 'family_commandments_version',
    active: 'family_commandments_active'
};

const DEFAULT_TITLE = 'Mandamentos da Familia';

async function getSetting(key, fallback = '') {
    const row = await getOne('SELECT setting_value FROM farm_settings WHERE setting_key = ?', [key]);
    return row ? row.setting_value : fallback;
}

async function setSetting(key, value) {
    const existing = await getOne('SELECT id FROM farm_settings WHERE setting_key = ?', [key]);
    if (existing) {
        await runQuery(
            'UPDATE farm_settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP WHERE setting_key = ?',
            [String(value), key]
        );
        return;
    }

    await runQuery(
        'INSERT INTO farm_settings (setting_key, setting_value) VALUES (?, ?)',
        [key, String(value)]
    );
}

async function getCurrentCommandments() {
    const [title, content, versionRaw, activeRaw] = await Promise.all([
        getSetting(SETTING_KEYS.title, DEFAULT_TITLE),
        getSetting(SETTING_KEYS.content, ''),
        getSetting(SETTING_KEYS.version, '1'),
        getSetting(SETTING_KEYS.active, 'false')
    ]);

    const version = parseInt(versionRaw, 10) || 1;
    const active = activeRaw === 'true' || activeRaw === '1';

    return {
        title: title || DEFAULT_TITLE,
        content: content || '',
        version,
        active,
        requiresAcceptance: active && String(content || '').trim().length > 0
    };
}

async function saveCommandments({ title, content, active }, adminUserId) {
    const current = await getCurrentCommandments();
    const nextTitle = String(title || DEFAULT_TITLE).trim() || DEFAULT_TITLE;
    const nextContent = String(content || '').trim();
    const nextActive = active === true || active === 'true' || active === 1 || active === '1';
    const changed = nextTitle !== current.title ||
        nextContent !== current.content ||
        nextActive !== current.active;
    const nextVersion = changed ? current.version + 1 : current.version;

    await setSetting(SETTING_KEYS.title, nextTitle);
    await setSetting(SETTING_KEYS.content, nextContent);
    await setSetting(SETTING_KEYS.active, nextActive ? 'true' : 'false');
    await setSetting(SETTING_KEYS.version, String(nextVersion));
    await setSetting('family_commandments_updated_by', adminUserId || '');

    return {
        title: nextTitle,
        content: nextContent,
        active: nextActive,
        version: nextVersion,
        changed
    };
}

async function getUserCommandmentStatus(userId) {
    const commandments = await getCurrentCommandments();

    if (!commandments.requiresAcceptance) {
        return {
            ...commandments,
            status: 'not_required',
            requiresAcceptance: false
        };
    }

    const response = await getOne(
        `SELECT status, responded_at
         FROM family_commandment_responses
         WHERE user_id = ? AND version = ?
         ORDER BY responded_at DESC, id DESC
         LIMIT 1`,
        [userId, commandments.version]
    );

    const accepted = response?.status === 'accepted';
    return {
        ...commandments,
        status: response?.status || 'pending',
        responded_at: response?.responded_at || null,
        requiresAcceptance: !accepted
    };
}

async function recordCommandmentResponse(userId, version, status) {
    if (!['accepted', 'refused'].includes(status)) {
        throw new Error('Status invalido');
    }

    await runQuery(
        `INSERT INTO family_commandment_responses (user_id, version, status, responded_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
        [userId, version, status]
    );
}

async function getCommandmentsReport() {
    const commandments = await getCurrentCommandments();
    const users = await getAll(`
        SELECT id, name, passport, email, role, active, last_login_at, created_at
        FROM users
        WHERE active = 1
        ORDER BY LOWER(name)
    `);
    const groups = await getAll('SELECT user_id, group_name FROM user_groups');
    const responses = await getAll(
        `SELECT user_id, version, status, responded_at
         FROM family_commandment_responses
         WHERE version = ?
         ORDER BY responded_at DESC, id DESC`,
        [commandments.version]
    );

    const groupMap = new Map();
    for (const group of groups || []) {
        if (!groupMap.has(group.user_id)) groupMap.set(group.user_id, []);
        groupMap.get(group.user_id).push(group.group_name);
    }

    const responseMap = new Map();
    for (const response of responses || []) {
        if (!responseMap.has(response.user_id)) responseMap.set(response.user_id, response);
    }

    const members = (users || []).map(user => {
        const response = responseMap.get(user.id);
        return {
            ...user,
            groups: groupMap.get(user.id) || (user.role ? [user.role] : []),
            commandment_status: response?.status || 'pending',
            commandment_responded_at: response?.responded_at || null,
            commandment_version: commandments.version
        };
    });

    return { commandments, members };
}

module.exports = {
    getCurrentCommandments,
    saveCommandments,
    getUserCommandmentStatus,
    recordCommandmentResponse,
    getCommandmentsReport
};
