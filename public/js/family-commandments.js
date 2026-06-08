(function () {
    function normalizeRoleName(role) {
        return String(role || '')
            .trim()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
    }

    function isAdminUser(user) {
        const groups = Array.isArray(user?.groups) && user.groups.length > 0
            ? user.groups
            : [user?.role];
        return groups.some(group => {
            const normalized = normalizeRoleName(group);
            return normalized !== 'member' && (
                normalized.includes('gerente') ||
                normalized.includes('admin') ||
                normalized === '01' ||
                normalized === '02' ||
                normalized === 'super_admin'
            );
        });
    }

    function ensureGateStyles() {
        if (document.getElementById('familyCommandmentsGateStyles')) return;
        const style = document.createElement('style');
        style.id = 'familyCommandmentsGateStyles';
        style.textContent = `
            .family-commandments-gate {
                position: fixed;
                inset: 0;
                z-index: 99999;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 24px;
                background: rgba(8, 10, 24, 0.88);
                backdrop-filter: blur(6px);
            }
            .family-commandments-dialog {
                width: min(940px, 100%);
                max-height: min(760px, calc(100vh - 48px));
                display: flex;
                flex-direction: column;
                overflow: hidden;
                background: #17182b;
                color: #f8fafc;
                border: 1px solid rgba(255, 255, 255, 0.14);
                border-radius: 8px;
                box-shadow: 0 24px 80px rgba(0, 0, 0, 0.48);
            }
            .family-commandments-header {
                padding: 24px 28px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            }
            .family-commandments-header h2 {
                margin: 0 0 8px;
                font-size: 24px;
                letter-spacing: 0;
            }
            .family-commandments-header p {
                margin: 0;
                color: #aeb4c8;
            }
            .family-commandments-body {
                padding: 24px 28px;
                overflow: hidden;
            }
            .family-commandments-text {
                max-height: 48vh;
                min-height: 280px;
                overflow: auto;
                white-space: pre-wrap;
                line-height: 1.65;
                background: #10111f;
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px;
                padding: 22px;
                color: #eef2ff;
            }
            .family-commandments-message {
                min-height: 24px;
                margin-top: 14px;
                color: #fca5a5;
            }
            .family-commandments-actions {
                display: flex;
                justify-content: flex-end;
                gap: 12px;
                padding: 20px 28px;
                border-top: 1px solid rgba(255, 255, 255, 0.1);
                background: rgba(255, 255, 255, 0.03);
            }
            body.family-commandments-locked {
                overflow: hidden;
            }
            @media (max-width: 640px) {
                .family-commandments-gate {
                    padding: 10px;
                }
                .family-commandments-header,
                .family-commandments-body,
                .family-commandments-actions {
                    padding: 18px;
                }
                .family-commandments-actions {
                    flex-direction: column-reverse;
                }
                .family-commandments-actions .btn {
                    width: 100%;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function setStandaloneMessage(message) {
        const el = document.getElementById('termsMessage');
        if (el) el.textContent = message || '';
    }

    function createGate(data, options = {}) {
        ensureGateStyles();
        document.getElementById('familyCommandmentsGate')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'familyCommandmentsGate';
        overlay.className = 'family-commandments-gate';
        overlay.innerHTML = `
            <section class="family-commandments-dialog" role="dialog" aria-modal="true" aria-labelledby="familyCommandmentsGateTitle">
                <header class="family-commandments-header">
                    <h2 id="familyCommandmentsGateTitle"></h2>
                    <p>Leia os mandamentos para continuar usando o sistema.</p>
                </header>
                <div class="family-commandments-body">
                    <div class="family-commandments-text" id="familyCommandmentsGateText"></div>
                    <div class="family-commandments-message" id="familyCommandmentsGateMessage"></div>
                </div>
                <footer class="family-commandments-actions">
                    <button id="familyCommandmentsRejectBtn" class="btn btn-secondary" type="button">Recusar e sair</button>
                    <button id="familyCommandmentsAcceptBtn" class="btn btn-primary" type="button">Li e concordo</button>
                </footer>
            </section>
        `;

        overlay.querySelector('#familyCommandmentsGateTitle').textContent = data.title || 'Mandamentos da Familia';
        overlay.querySelector('#familyCommandmentsGateText').textContent = data.content || 'Nenhum mandamento cadastrado.';

        document.body.appendChild(overlay);
        document.body.classList.add('family-commandments-locked');

        const messageEl = overlay.querySelector('#familyCommandmentsGateMessage');
        const acceptBtn = overlay.querySelector('#familyCommandmentsAcceptBtn');
        const rejectBtn = overlay.querySelector('#familyCommandmentsRejectBtn');

        async function submit(accepted) {
            messageEl.textContent = '';
            acceptBtn.disabled = true;
            rejectBtn.disabled = true;

            try {
                const response = await fetch('/api/auth/commandments-response', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ accepted })
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Erro ao enviar resposta');

                if (!accepted) {
                    window.location.href = result.redirect || '/';
                    return;
                }

                overlay.remove();
                document.body.classList.remove('family-commandments-locked');
                if (typeof options.onAccepted === 'function') {
                    options.onAccepted();
                } else {
                    window.location.reload();
                }
            } catch (error) {
                messageEl.textContent = error.message || 'Erro ao enviar resposta';
                acceptBtn.disabled = false;
                rejectBtn.disabled = false;
            }
        }

        acceptBtn.addEventListener('click', () => submit(true));
        rejectBtn.addEventListener('click', () => submit(false));
        acceptBtn.focus();
    }

    async function redirectAfterAcceptance() {
        try {
            const response = await fetch('/api/auth/me');
            const data = await response.json();
            if (!response.ok || !data.user) {
                window.location.href = '/';
                return;
            }
            window.location.href = isAdminUser(data.user) ? '/admin' : '/dashboard';
        } catch {
            window.location.href = '/';
        }
    }

    async function showFamilyCommandmentsGate(options = {}) {
        const response = await fetch('/api/auth/commandments-status');
        if (response.status === 401) {
            window.location.href = '/';
            return true;
        }

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Erro ao carregar mandamentos');

        if (!data.requiresAcceptance) {
            return false;
        }

        createGate(data, options);
        return true;
    }

    async function loadStandalonePage() {
        const contentEl = document.getElementById('termsContent');
        if (!contentEl) return;

        try {
            const response = await fetch('/api/auth/commandments-status');
            if (response.status === 401) {
                window.location.href = '/';
                return;
            }

            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Erro ao carregar mandamentos');

            if (!data.requiresAcceptance) {
                await redirectAfterAcceptance();
                return;
            }

            document.getElementById('termsTitle').textContent = data.title || 'Mandamentos da Familia';
            contentEl.textContent = data.content || 'Nenhum mandamento cadastrado.';

            document.getElementById('acceptTermsBtn').addEventListener('click', async () => {
                await fetch('/api/auth/commandments-response', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ accepted: true })
                });
                await redirectAfterAcceptance();
            });

            document.getElementById('rejectTermsBtn').addEventListener('click', async () => {
                const res = await fetch('/api/auth/commandments-response', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ accepted: false })
                });
                const result = await res.json().catch(() => ({}));
                window.location.href = result.redirect || '/';
            });
        } catch (error) {
            setStandaloneMessage(error.message || 'Erro ao carregar mandamentos');
        }
    }

    window.showFamilyCommandmentsGate = showFamilyCommandmentsGate;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadStandalonePage);
    } else {
        loadStandalonePage();
    }
})();
