document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('name').value.trim();
    const passport = document.getElementById('passport').value.trim().toUpperCase();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const messageEl = document.getElementById('message');
    
    // Validações
    if (!name || !passport || !password) {
        messageEl.textContent = 'Preencha todos os campos obrigatórios';
        messageEl.className = 'message show error';
        return;
    }
    
    if (password.length < 6) {
        messageEl.textContent = 'A senha deve ter pelo menos 6 caracteres';
        messageEl.className = 'message show error';
        return;
    }
    
    if (password !== confirmPassword) {
        messageEl.textContent = 'As senhas não conferem';
        messageEl.className = 'message show error';
        return;
    }
    
    try {
        const response = await fetch('/api/auth/register-public', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, passport, email, password })
        });
        
        const data = await response.json();
        
        if (data.success) {
            messageEl.textContent = 'Cadastro realizado! Redirecionando para login...';
            messageEl.className = 'message show success';
            
            setTimeout(() => {
                window.location.href = '/';
            }, 2000);
        } else {
            messageEl.textContent = data.error || 'Erro ao cadastrar';
            messageEl.className = 'message show error';
        }
    } catch (error) {
        messageEl.textContent = 'Erro de conexão';
        messageEl.className = 'message show error';
    }
});

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
