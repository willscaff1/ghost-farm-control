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

        // Entrou com a senha padrão: não cria sessão, abre a troca obrigatória
        if (data.mustChangePassword) {
            messageEl.textContent = '';
            messageEl.className = 'message';
            window.openMustChangeModal(data.passport || passport, password, data.message);
            return;
        }

        if (data.success) {
            messageEl.textContent = 'Login realizado! Redirecionando...';
            messageEl.className = 'message show success';
            
            // Redireciona baseado no tipo de usuário
            setTimeout(() => {
                if (data.user.is_admin === true) {
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
            if (data.user.is_admin === true) {
                window.location.href = '/admin';
            } else {
                window.location.href = '/dashboard';
            }
        }
    })
    .catch(() => {});
