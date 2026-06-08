function normalizeRoleName(role) {
    return String(role || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function isAdminRole(role) {
    const normalizedRole = normalizeRoleName(role);
    const adminRoles = ['01', '02', 'gerente_farm', 'gerente_acao', 'gerente_recrutamento', 'gerente_encomendas', 'gerente_vendas', 'gerente_de_vendas', 'gerente_geral'];
    return adminRoles.includes(normalizedRole) || normalizedRole.includes('gerente') || normalizedRole.includes('admin');
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const passport = document.getElementById('passport').value;
    const password = document.getElementById('password').value;
    const messageEl = document.getElementById('message');
    
    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ passport, password })
        });
        
        const data = await response.json();
        
        if (data.success) {
            messageEl.textContent = 'Login realizado! Redirecionando...';
            messageEl.className = 'message show success';
            
            // Redireciona baseado no tipo de usuário
            setTimeout(() => {
                if (isAdminRole(data.user.role)) {
                    window.location.href = '/admin';
                } else {
                    window.location.href = '/dashboard';
                }
            }, 1000);
        } else {
            messageEl.textContent = data.error || 'Erro ao fazer login';
            messageEl.className = 'message show error';
        }
    } catch (error) {
        messageEl.textContent = 'Erro de conexão';
        messageEl.className = 'message show error';
    }
});

// Verifica se já está logado
fetch('/api/auth/me')
    .then(res => res.json())
    .then(data => {
        if (data.user) {
            if (isAdminRole(data.user.role)) {
                window.location.href = '/admin';
            } else {
                window.location.href = '/dashboard';
            }
        }
    })
    .catch(() => {});
