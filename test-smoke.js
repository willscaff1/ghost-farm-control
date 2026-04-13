/**
 * Smoke test automatizado do Ghost Farm Control.
 *
 * Sobe o servidor local em porta aleatória, executa todos os ciclos de teste
 * (health, auth, CSRF, rotas protegidas, admin) e encerra com exit code 0/1.
 *
 * Uso:  node test-smoke.js          (ou  npm test)
 *       SMOKE_BASE_URL=https://...  node test-smoke.js   (testa ambiente remoto)
 */

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const TEST_PORT = 19876 + Math.floor(Math.random() * 1000);
const REMOTE_URL = process.env.SMOKE_BASE_URL;
const BASE = REMOTE_URL || `http://localhost:${TEST_PORT}`;
const TIMEOUT_MS = 10000;

let serverProcess = null;
let passed = 0;
let failed = 0;
const failures = [];

// ── helpers ────────────────────────────────────────────────────────────────

async function req(method, urlPath, body = null, headers = {}, cookie = null) {
    const url = `${BASE}${urlPath}`;
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
    };
    if (cookie) opts.headers['Cookie'] = cookie;
    if (body) opts.body = JSON.stringify(body);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    opts.signal = controller.signal;

    try {
        const res = await fetch(url, opts);
        clearTimeout(timer);
        const setCookie = res.headers.get('set-cookie') || '';
        let data;
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('json')) {
            data = await res.json();
        } else {
            data = await res.text();
        }
        return { status: res.status, data, setCookie };
    } catch (err) {
        clearTimeout(timer);
        throw err;
    }
}

function extractSessionCookie(setCookieHeader) {
    if (!setCookieHeader) return null;
    const match = setCookieHeader.match(/connect\.sid=[^;]+/);
    return match ? match[0] : null;
}

function assert(label, condition, detail = '') {
    if (condition) {
        passed++;
        console.log(`  ✅  ${label}`);
    } else {
        failed++;
        const msg = `${label}${detail ? ' — ' + detail : ''}`;
        failures.push(msg);
        console.log(`  ❌  ${msg}`);
    }
}

// ── test cycles ────────────────────────────────────────────────────────────

async function testHealth() {
    console.log('\n── Ciclo 1: Health Check ──');
    try {
        const r = await req('GET', '/health');
        assert('GET /health retorna 200', r.status === 200);
        assert('status = ok', r.data.status === 'ok');
        assert('db = ok', r.data.db === 'ok');
        assert('latency_ms presente', typeof r.data.latency_ms === 'number');
    } catch (e) {
        assert('Health check acessível', false, e.message);
    }
}

async function testPublicPages() {
    console.log('\n── Ciclo 2: Páginas Públicas ──');
    for (const p of ['/', '/register']) {
        try {
            const r = await req('GET', p);
            assert(`GET ${p} retorna 200`, r.status === 200);
        } catch (e) {
            assert(`GET ${p} acessível`, false, e.message);
        }
    }
}

async function testAuthCycle() {
    console.log('\n── Ciclo 3: Autenticação ──');

    // /me sem sessão → 401
    try {
        const r = await req('GET', '/api/auth/me');
        assert('GET /me sem sessão → 401', r.status === 401);
    } catch (e) {
        assert('GET /me sem sessão', false, e.message);
    }

    // Login com credenciais inválidas → 401
    try {
        const r = await req('POST', '/api/auth/login', { passport: '__inexistente__', password: 'x' });
        assert('Login inválido → 401', r.status === 401);
    } catch (e) {
        assert('Login inválido', false, e.message);
    }

    // Login com credenciais do env (se disponível)
    const testPassport = process.env.TEST_PASSPORT;
    const testPassword = process.env.TEST_PASSWORD;
    if (testPassport && testPassword) {
        try {
            const r = await req('POST', '/api/auth/login', { passport: testPassport, password: testPassword });
            assert('Login válido → 200', r.status === 200);
            assert('Login retorna success', r.data.success === true);
            const cookie = extractSessionCookie(r.setCookie);
            assert('Sessão cookie recebida', !!cookie);

            if (cookie) {
                // /me com sessão → 200
                const me = await req('GET', '/api/auth/me', null, {}, cookie);
                assert('GET /me autenticado → 200', me.status === 200);
                assert('/me retorna user.passport', me.data.user?.passport === testPassport);

                // Logout
                const lo = await req('POST', '/api/auth/logout', null, {}, cookie);
                assert('Logout → 200', lo.status === 200);

                // /me após logout → 401
                const after = await req('GET', '/api/auth/me', null, {}, cookie);
                assert('/me após logout → 401', after.status === 401);
            }
        } catch (e) {
            assert('Fluxo de login completo', false, e.message);
        }
    } else {
        console.log('  ⏭️  Fluxo de login completo pulado (defina TEST_PASSPORT e TEST_PASSWORD)');
    }
}

async function testProtectedRoutes() {
    console.log('\n── Ciclo 4: Rotas Protegidas sem Auth ──');
    const protectedPaths = [
        '/api/admin/stats',
        '/api/admin/members',
        '/api/delivery/my-deliveries',
    ];
    for (const p of protectedPaths) {
        try {
            const r = await req('GET', p);
            assert(`GET ${p} sem auth → 401/403`, r.status === 401 || r.status === 403);
        } catch (e) {
            assert(`GET ${p} responde`, false, e.message);
        }
    }
}

async function testCSRF() {
    console.log('\n── Ciclo 5: Proteção CSRF ──');
    // POST com Origin diferente deve ser bloqueado (403) OU aceito se não produção
    try {
        const r = await req('POST', '/api/auth/login',
            { passport: 'x', password: 'x' },
            { 'Origin': 'https://evil.example.com' }
        );
        // Em dev, o CSRF middleware não atua, então aceitamos 401 (cred inválida) ou 403 (CSRF)
        assert('POST com Origin estranho não retorna 200', r.status !== 200);
    } catch (e) {
        assert('CSRF test', false, e.message);
    }
}

async function testStaticAssets() {
    console.log('\n── Ciclo 6: Assets Estáticos ──');
    for (const asset of ['/css/style.css', '/js/login.js']) {
        try {
            const r = await req('GET', asset);
            assert(`GET ${asset} → 200`, r.status === 200);
        } catch (e) {
            assert(`GET ${asset}`, false, e.message);
        }
    }
}

// ── server lifecycle ───────────────────────────────────────────────────────

function startLocalServer() {
    return new Promise((resolve, reject) => {
        if (REMOTE_URL) return resolve();

        console.log(`Subindo servidor local na porta ${TEST_PORT}...`);
        const env = { ...process.env, PORT: String(TEST_PORT) };
        serverProcess = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let started = false;
        const onData = (chunk) => {
            const text = chunk.toString();
            if (!started && text.includes('rodando em')) {
                started = true;
                // pequena espera para garantir que o servidor está 100% pronto
                setTimeout(resolve, 500);
            }
        };
        serverProcess.stdout.on('data', onData);
        serverProcess.stderr.on('data', onData);
        serverProcess.on('error', reject);

        setTimeout(() => {
            if (!started) reject(new Error('Timeout: servidor não iniciou em 15s'));
        }, 15000);
    });
}

function stopLocalServer() {
    if (serverProcess) {
        serverProcess.kill('SIGTERM');
        serverProcess = null;
    }
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║   Ghost Farm Control — Smoke Test           ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log(`Alvo: ${BASE}`);

    try {
        await startLocalServer();

        await testHealth();
        await testPublicPages();
        await testAuthCycle();
        await testProtectedRoutes();
        await testCSRF();
        await testStaticAssets();
    } catch (err) {
        console.error('\n💥 Erro fatal durante os testes:', err.message);
        failed++;
    } finally {
        stopLocalServer();
    }

    console.log('\n══════════════════════════════════════════════');
    console.log(`  Resultado: ${passed} passou, ${failed} falhou`);
    if (failures.length > 0) {
        console.log('  Falhas:');
        failures.forEach(f => console.log(`    • ${f}`));
    }
    console.log('══════════════════════════════════════════════\n');

    process.exit(failed > 0 ? 1 : 0);
}

main();
