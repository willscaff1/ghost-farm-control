(function () {
    let modalOpen = false;

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function ensureStyles() {
        if (document.getElementById('capitalNicknameGateStyles')) return;

        const style = document.createElement('style');
        style.id = 'capitalNicknameGateStyles';
        style.textContent = `
            .capital-nickname-gate {
                position: fixed;
                inset: 0;
                z-index: 100000;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
                background: rgba(4, 8, 16, 0.88);
                backdrop-filter: blur(10px);
            }
            .capital-nickname-dialog {
                width: min(520px, 100%);
                background: linear-gradient(180deg, #171d2a 0%, #0f1420 100%);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 12px;
                box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
                color: #fff;
                overflow: hidden;
            }
            .capital-nickname-header {
                padding: 24px 24px 12px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            }
            .capital-nickname-header h2 {
                margin: 0 0 8px;
                font-size: 1.35rem;
                letter-spacing: 0;
            }
            .capital-nickname-header p {
                margin: 0;
                color: rgba(255, 255, 255, 0.72);
                line-height: 1.45;
            }
            .capital-nickname-body {
                padding: 22px 24px;
            }
            .capital-nickname-label {
                display: block;
                margin-bottom: 8px;
                color: rgba(255, 255, 255, 0.82);
                font-weight: 600;
            }
            .capital-nickname-input {
                width: 100%;
                min-height: 46px;
                padding: 12px 14px;
                border-radius: 8px;
                border: 1px solid rgba(255, 255, 255, 0.16);
                background: rgba(255, 255, 255, 0.07);
                color: #fff;
                font-size: 1rem;
                outline: none;
            }
            .capital-nickname-input:focus {
                border-color: #667eea;
                box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.22);
            }
            .capital-nickname-confirm {
                display: none;
                padding: 14px;
                border-radius: 8px;
                background: rgba(102, 126, 234, 0.12);
                border: 1px solid rgba(102, 126, 234, 0.28);
                color: rgba(255, 255, 255, 0.86);
                line-height: 1.45;
            }
            .capital-nickname-confirm strong {
                color: #fff;
                font-size: 1.12rem;
            }
            .capital-nickname-message {
                min-height: 20px;
                margin-top: 12px;
                color: #ffb4b4;
                font-size: 0.92rem;
            }
            .capital-nickname-actions {
                display: flex;
                justify-content: flex-end;
                gap: 10px;
                padding: 0 24px 24px;
            }
            body.capital-nickname-locked {
                overflow: hidden;
            }
            @media (max-width: 520px) {
                .capital-nickname-gate {
                    align-items: stretch;
                    padding: 12px;
                }
                .capital-nickname-dialog {
                    margin: auto 0;
                }
                .capital-nickname-actions {
                    flex-direction: column-reverse;
                }
                .capital-nickname-actions .btn {
                    width: 100%;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function needsNickname(user) {
        return !!user?.requires_capital_nickname && !String(user.capital_nickname || '').trim();
    }

    async function fetchCurrentUser() {
        const response = await fetch('/api/auth/me');
        if (response.status === 401 || response.status === 403) return null;
        const data = await response.json().catch(() => ({}));
        if (!response.ok) return null;
        return data.user || null;
    }

    function setBusy(overlay, busy) {
        overlay.querySelectorAll('button, input').forEach(el => {
            el.disabled = busy;
        });
    }

    function showModal(user) {
        if (modalOpen || !needsNickname(user)) return false;
        modalOpen = true;
        ensureStyles();

        document.getElementById('capitalNicknameGate')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'capitalNicknameGate';
        overlay.className = 'capital-nickname-gate';
        overlay.innerHTML = `
            <section class="capital-nickname-dialog" role="dialog" aria-modal="true" aria-labelledby="capitalNicknameTitle">
                <header class="capital-nickname-header">
                    <h2 id="capitalNicknameTitle">Vulgo na Capital</h2>
                    <p>Informe o vulgo que voce usa dentro da Capital para continuar.</p>
                </header>
                <div class="capital-nickname-body">
                    <div id="capitalNicknameFormStep">
                        <label class="capital-nickname-label" for="capitalNicknameInput">Seu vulgo</label>
                        <input id="capitalNicknameInput" class="capital-nickname-input" type="text" maxlength="40" autocomplete="off" placeholder="Digite seu vulgo" required>
                    </div>
                    <div id="capitalNicknameConfirmStep" class="capital-nickname-confirm"></div>
                    <div id="capitalNicknameMessage" class="capital-nickname-message"></div>
                </div>
                <footer class="capital-nickname-actions">
                    <button id="capitalNicknameBackBtn" class="btn btn-secondary" type="button" style="display:none;">Voltar</button>
                    <button id="capitalNicknameNextBtn" class="btn btn-primary" type="button">Continuar</button>
                    <button id="capitalNicknameSaveBtn" class="btn btn-primary" type="button" style="display:none;">Confirmar e salvar</button>
                </footer>
            </section>
        `;

        document.body.appendChild(overlay);
        document.body.classList.add('capital-nickname-locked');

        const input = overlay.querySelector('#capitalNicknameInput');
        const formStep = overlay.querySelector('#capitalNicknameFormStep');
        const confirmStep = overlay.querySelector('#capitalNicknameConfirmStep');
        const messageEl = overlay.querySelector('#capitalNicknameMessage');
        const nextBtn = overlay.querySelector('#capitalNicknameNextBtn');
        const backBtn = overlay.querySelector('#capitalNicknameBackBtn');
        const saveBtn = overlay.querySelector('#capitalNicknameSaveBtn');
        let pendingNickname = '';

        function setMessage(message) {
            messageEl.textContent = message || '';
        }

        function showConfirm() {
            pendingNickname = input.value.trim().replace(/\s+/g, ' ');
            if (pendingNickname.length < 2) {
                setMessage('Informe um vulgo com pelo menos 2 caracteres.');
                input.focus();
                return;
            }
            setMessage('');
            confirmStep.innerHTML = `Confirma que seu vulgo na Capital e:<br><strong>${escapeHtml(pendingNickname)}</strong>`;
            formStep.style.display = 'none';
            confirmStep.style.display = 'block';
            nextBtn.style.display = 'none';
            backBtn.style.display = '';
            saveBtn.style.display = '';
            saveBtn.focus();
        }

        function showForm() {
            confirmStep.style.display = 'none';
            formStep.style.display = '';
            nextBtn.style.display = '';
            backBtn.style.display = 'none';
            saveBtn.style.display = 'none';
            input.focus();
        }

        async function save() {
            setMessage('');
            setBusy(overlay, true);

            try {
                const response = await fetch('/api/auth/capital-nickname', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ capital_nickname: pendingNickname })
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok || !data.success) {
                    throw new Error(data.error || 'Erro ao salvar vulgo');
                }

                document.body.classList.remove('capital-nickname-locked');
                overlay.remove();
                modalOpen = false;
                window.dispatchEvent(new CustomEvent('capitalNickname:saved', { detail: data.user }));
            } catch (error) {
                setBusy(overlay, false);
                setMessage(error.message || 'Erro ao salvar vulgo');
            }
        }

        nextBtn.addEventListener('click', showConfirm);
        backBtn.addEventListener('click', showForm);
        saveBtn.addEventListener('click', save);
        input.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                showConfirm();
            }
        });

        setTimeout(() => input.focus(), 50);
        return true;
    }

    async function ensureCapitalNicknameModal(user) {
        if (modalOpen) return true;
        const currentUser = user || await fetchCurrentUser();
        if (!currentUser || currentUser.commandments_required) return false;
        return showModal(currentUser);
    }

    window.ensureCapitalNicknameModal = ensureCapitalNicknameModal;

    async function runAfterLoad() {
        try {
            await ensureCapitalNicknameModal();
        } catch {
            // Sessao expirada ou pagina publica: nao bloquear o carregamento.
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', runAfterLoad);
    } else {
        runAfterLoad();
    }
})();
