# 👻 Ghosts Farm Control

Sistema de controle de farm semanal para membros da guilda Ghosts.

---

## 📁 Estrutura do Projeto

```
c:\farm-control\
├── database/
│   └── ghosts.db          ⬅️ BANCO DE DADOS AQUI!
├── public/
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   ├── admin.js
│   │   └── dashboard.js
│   ├── admin.html
│   ├── dashboard.html
│   ├── index.html         (login)
│   └── register.html
├── routes/
│   ├── admin.js
│   ├── auth.js
│   └── delivery.js
├── uploads/               (screenshots dos farms)
├── server.js
└── package.json
```

---

## 🗄️ Banco de Dados

**Localização:** `c:\farm-control\database\ghosts.db`

### Tabelas:

| Tabela | Descrição |
|--------|-----------|
| `users` | Usuários (membros e admins) |
| `materials` | Tipos de materiais do farm |
| `deliveries` | Entregas de farm |
| `delivery_items` | Itens de cada entrega |
| `justifications` | Justificativas de ausência |
| `warnings` | Advertências (ADVs) |

---

## 👤 Usuário Master

| Campo | Valor |
|-------|-------|
| **Nome** | Willian Scaff |
| **Passaporte** | 6999 |
| **Senha** | 6999 |
| **Permissões** | FULL (todas) |

> ⚠️ O passaporte `6999` tem permissões especiais vinculadas diretamente ao código, independente do cargo.

---

## 🎭 Sistema de Cargos

| Cargo | Código | Permissões |
|-------|--------|------------|
| Gerente Geral | `gerente_geral` | Admin completo |
| Gerente de Farm | `gerente_farm` | Aprovar farms, ver status |
| 01 | `01` | Aprovar farms, ver status |
| 02 | `02` | Aprovar farms, ver status |
| Membro | `member` | Entregar farm, ver histórico |

---

## 🔐 Permissões Especiais (Passaporte 6999)

| Ação | 6999 | Outros Admins |
|------|------|---------------|
| Alterar cargos | ✅ | ❌ |
| Editar membros | ✅ | ❌ |
| Deletar membros | ✅ | ❌ |
| Ativar/Desativar membros | ✅ | ❌ |
| Remover advertências | ✅ | ❌ |
| Aplicar advertências | ✅ | ✅ |
| Aprovar/Rejeitar farms | ✅ | ✅ |
| Ver status semanal | ✅ | ✅ |
| Gerenciar materiais | ✅ | ✅ |

---

## 📦 Materiais Padrão

- 🍃 Folha
- 💊 Ópio
- 📦 Embalagem Plástica
- 🌾 Farinha de Trigo

> Os materiais podem ser gerenciados na aba "⚙️ Gerenciar Materiais" do painel admin.

---

## 📅 Sistema de Semanas

- Cada semana vai de **Segunda a Domingo**
- Membros devem entregar o farm dentro da semana
- Podem justificar ausência se não puderem entregar
- Status possíveis: ✅ Completo | ⏳ Pendente | 📋 Justificado

---

## ⚠️ Sistema de Advertências (ADV)

- Qualquer admin pode aplicar ADV
- Apenas o passaporte 6999 pode remover ADV
- Membros veem o contador de ADVs no dashboard
- Histórico completo na aba "⚠️ Advertências"

---

## 🚀 Como Rodar

```bash
cd c:\farm-control
node server.js
```

Acesse: **http://localhost:3000**

---

## 🧹 Limpar Banco de Dados

Para resetar o banco mantendo apenas o usuário master:

```bash
node clean-db.js
```

Ou manualmente:
```bash
node -e "const sqlite3 = require('sqlite3').verbose(); const bcrypt = require('bcryptjs'); const path = require('path'); const db = new sqlite3.Database(path.join(__dirname, 'database', 'ghosts.db')); db.serialize(() => { db.run('DELETE FROM warnings'); db.run('DELETE FROM delivery_items'); db.run('DELETE FROM deliveries'); db.run('DELETE FROM justifications'); db.run('DELETE FROM users'); const hash = bcrypt.hashSync('6999', 10); db.run('INSERT INTO users (name, passport, email, password, role) VALUES (?, ?, ?, ?, ?)', ['Willian Scaff', '6999', '', hash, 'gerente_geral'], function(err) { console.log('Banco limpo!'); db.close(); }); });"
```

---

## 📱 Telas do Sistema

### Login (`/`)
- Campo: Passaporte
- Campo: Senha
- Link para registro

### Registro (`/register`)
- Nome completo
- Passaporte (será o login)
- Email
- Senha
- Novos usuários entram como "Membro"

### Dashboard do Membro (`/dashboard`)
- Stats: Farms Entregues | Advertências
- Formulário de entrega de farm
- Formulário de justificativa
- Histórico de entregas

### Painel Admin (`/admin`)
- 📅 Semana Atual - visão geral
- 🕐 Farms Pendentes - aprovar/rejeitar
- 📝 Justificativas - aprovar/rejeitar
- 👥 Membros - gerenciar (6999 only)
- ⚠️ Advertências - aplicar ADV
- 🏆 Ranking
- 📊 Materiais (stats)
- ⚙️ Gerenciar Materiais
- 📋 Todas Entregas
- ➕ Novo Membro

---

## 🛠️ Tecnologias

- **Backend:** Node.js + Express
- **Banco:** SQLite3
- **Auth:** express-session + bcryptjs
- **Upload:** Multer
- **Frontend:** HTML/CSS/JS puro

---

*Desenvolvido para a guilda Ghosts* 👻
