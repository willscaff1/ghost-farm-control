# Migração v2.0.0 - Sistema de Grupos

## ⚠️ IMPORTANTE: Execute este script em PRODUÇÃO

Este script migra o sistema para a v2.0.0 com suporte a múltiplos grupos.

## O que o script faz:

1. ✅ Cria tabela `user_groups` (se não existir)
2. ✅ Migra todos os usuários ativos para o sistema de grupos
3. ✅ Cria grupo `super_admin` (se não existir)
4. ✅ Cria usuário root `admin` (se não existir)
5. ✅ É idempotente (pode rodar múltiplas vezes sem problemas)

## Como executar no Railway:

### Opção 1: Via Railway Dashboard

1. Acesse o painel do Railway
2. Vá em **Settings** → **Deploy**
3. Adicione uma variável temporária:
   ```
   RUN_MIGRATION=true
   ```
4. Faça um novo deploy
5. Depois de confirmar que funcionou, remova a variável

### Opção 2: Via Railway CLI

```bash
# Instalar Railway CLI
npm i -g @railway/cli

# Fazer login
railway login

# Linkar ao projeto
railway link

# Executar migração
railway run node migrate-production.js
```

### Opção 3: SSH no container (se disponível)

```bash
# Conectar ao container
railway shell

# Executar migração
node migrate-production.js

# Reiniciar
exit
```

## Credenciais do usuário root criado:

- **Usuário:** admin
- **Senha:** P@ssw0rd123
- **Passaporte:** 0

## Verificação pós-migração:

1. Acesse o sistema com qualquer usuário admin
2. Vá em **Permissões de Grupos**
3. Verifique se os grupos aparecem corretamente
4. Verifique se os membros estão nos grupos certos
5. Faça login com `admin` / `P@ssw0rd123` para testar o root

## Em caso de problemas:

Se a migração falhar, o sistema ainda funcionará com o modelo antigo (campo `role` na tabela `users`).

Para reverter para a v1.x:
```bash
git checkout v1.x.x
```

## Suporte:

- Verifique os logs do Railway para ver mensagens detalhadas
- O script mostra um resumo ao final com contadores
- Todos os usuários existentes serão preservados
