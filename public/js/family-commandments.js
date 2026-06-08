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

function setMessage(message) {
    document.getElementById('termsMessage').textContent = message || '';
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

async function loadCommandments() {
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
        document.getElementById('termsContent').textContent = data.content || 'Nenhum mandamento cadastrado.';
    } catch (error) {
        setMessage(error.message || 'Erro ao carregar mandamentos');
    }
}

async function submitResponse(accepted) {
    setMessage('');
    document.getElementById('acceptTermsBtn').disabled = true;
    document.getElementById('rejectTermsBtn').disabled = true;

    try {
        const response = await fetch('/api/auth/commandments-response', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accepted })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Erro ao enviar resposta');

        if (!accepted) {
            window.location.href = data.redirect || '/';
            return;
        }

        await redirectAfterAcceptance();
    } catch (error) {
        setMessage(error.message || 'Erro ao enviar resposta');
        document.getElementById('acceptTermsBtn').disabled = false;
        document.getElementById('rejectTermsBtn').disabled = false;
    }
}

document.getElementById('acceptTermsBtn').addEventListener('click', () => submitResponse(true));
document.getElementById('rejectTermsBtn').addEventListener('click', () => submitResponse(false));

loadCommandments();
