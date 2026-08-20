const assert = require('assert');
const bcrypt = require('bcryptjs');
const { runQuery, getOne } = require('./database/db');
const {
    invalidateRoleAccessCache,
    getUserAccessProfile,
    getUsersAccessProfiles,
    hasPermission
} = require('./services/accessControl');

const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
const roleName = `coordenacao_teste_${suffix}`;
const passport = `ACL${suffix}`;

async function cleanup() {
    const user = await getOne('SELECT id FROM users WHERE passport = ?', [passport]).catch(() => null);
    if (user) {
        await runQuery('DELETE FROM user_groups WHERE user_id = ?', [user.id]);
        await runQuery('DELETE FROM users WHERE id = ?', [user.id]);
    }
    await runQuery('DELETE FROM role_permissions WHERE role_name = ?', [roleName]).catch(() => {});
    invalidateRoleAccessCache();
}

async function main() {
    try {
        await runQuery(
            'INSERT INTO role_permissions (role_name, display_name, permissions, can_config) VALUES (?, ?, ?, ?)',
            [roleName, 'Coordenação de Teste', JSON.stringify(['manager-goals', 'weapon-sales']), 0]
        );
        const inserted = await runQuery(
            'INSERT INTO users (name, passport, password, role, active) VALUES (?, ?, ?, ?, ?)',
            ['Teste de Permissões', passport, bcrypt.hashSync('teste123', 4), 'member', 1]
        );
        await runQuery(
            'INSERT INTO user_groups (user_id, group_name) VALUES (?, ?)',
            [inserted.lastID, 'member']
        );
        await runQuery(
            'INSERT INTO user_groups (user_id, group_name) VALUES (?, ?)',
            [inserted.lastID, roleName]
        );

        invalidateRoleAccessCache();
        const user = await getOne('SELECT id, passport, role FROM users WHERE id = ?', [inserted.lastID]);
        const profile = await getUserAccessProfile(user);

        assert.deepStrictEqual(new Set(profile.groups), new Set(['member', roleName]));
        assert.strictEqual(profile.isManager, true, 'manager-goals deve classificar o usuário como gerente');
        assert.strictEqual(profile.isAdmin, true, 'permissões administrativas devem liberar o painel');
        assert.strictEqual(hasPermission(profile, 'weapon-sales'), true, 'os cargos devem somar permissão de vendas');

        const profiles = await getUsersAccessProfiles([user]);
        assert.strictEqual(profiles.get(user.id).isManager, true, 'a listagem em lote deve usar a mesma classificação');

        console.log('✅ Perfil efetivo, múltiplos cargos e gerente de vendas alinhados');
    } finally {
        await cleanup();
    }
}

main().catch(error => {
    console.error('❌ Teste de controle de acesso falhou:', error);
    process.exitCode = 1;
});
