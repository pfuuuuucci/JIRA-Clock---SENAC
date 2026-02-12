# Arquitetura do Projeto — JIRA Voice Assistant

## 1. Visao Geral

O **JIRA Voice Assistant** e uma aplicacao web que permite o registro de apontamentos de horas no JIRA/Tempo por meio de comandos de voz. O sistema segue a arquitetura **Cliente-Servidor (Client-Server)**, com um unico servidor Node.js que atende tanto as requisicoes de API (backend) quanto serve os arquivos estaticos do frontend.

```
┌─────────────────────────────────────────────────────────┐
│                      NAVEGADOR                          │
│  ┌───────────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │  index.html   │  │ app.js   │  │   styles.css     │  │
│  │  login.html   │  │ (Voice   │  │   (Layout e      │  │
│  │  config.html  │  │  Recog.) │  │    Tema)         │  │
│  │  consulta.html│  │          │  │                  │  │
│  └───────────────┘  └──────────┘  └──────────────────┘  │
│         │                │                              │
│         └────────────────┘                              │
│                  │  HTTP / REST API                     │
└──────────────────┼──────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────┐
│               SERVIDOR (Node.js + Express)              │
│                                                         │
│  ┌─────────────┐  ┌────────────────────────────────┐    │
│  │  index.js   │  │  Modulos de Negocios           │    │
│  │  (Rotas +   │  │  ┌─────────────────────────┐   │    │
│  │   Server)   │  │  │ auth.js                 │   │    │
│  │             │  │  │(Autenticacao por Email) │   │    │
│  │             │  │  ├─────────────────────────┤   │    │
│  │             │  │  │ user-jira-integration.js│   │    │
│  │             │  │  │ (Integracao JIRA/Tempo) │   │    │
│  │             │  │  ├─────────────────────────┤   │    │
│  │             │  │  │ database.js             │   │    │
│  │             │  │  │ (Acesso a Dados)        │   │    │
│  │             │  │  └─────────────────────────┘   │    │
│  └─────────────┘  └────────────────────────────────┘    │
│         │                       │                       │
└─────────┼───────────────────────┼───────────────────────┘
          │                       │
  ┌───────▼───────┐   ┌──────────▼──────────┐
  │ APIs Externas │   │   PostgreSQL (Neon) │
  │  ┌───────────┐│   │                     │
  │  │ JIRA REST ││   │  users              │
  │  │ API v3    ││   │  user_credentials   │
  │  ├───────────┤│   │  user_projects      │
  │  │ Tempo     ││   │  user_favorites     │
  │  │ API v4    ││   │  user_fav_descr.    │
  │  ├───────────┤│   │  daily_token_valid. │
  │  │ Gmail     ││   │                     │
  │  │ SMTP      ││   └─────────────────────┘
  │  └───────────┘│
  └───────────────┘
```

---

## 2. Camada Frontend

| Item              | Detalhe                                                    |
|-------------------|------------------------------------------------------------|
| **Tecnologia**    | HTML5, CSS3, JavaScript (Vanilla)                          |
| **Servido por**   | Express.js (`express.static('public')`)                    |
| **Diretorio**     | `/public`                                                  |
| **Paginas**       | `index.html` (principal), `login.html`, `config.html`, `consulta.html` |
| **PWA**           | Possui `manifest.json` e Service Worker (`sw.js`)          |

### Principais Responsabilidades

- **Reconhecimento de Voz**: Usa a Web Speech API do navegador para captar a fala do usuario e transformar em texto.
- **Interface de Apontamento**: Exibe campos de tempo, projeto, descricao e ticket extraidos da fala, permitindo revisao e confirmacao antes do envio.
- **Gerenciamento de Favoritos**: Permite salvar tickets e descricoes frequentes para acesso rapido.
- **Autenticacao**: Tela de login com envio de token por e-mail e validacao por device fingerprint.

---

## 3. Camada Backend

| Item              | Detalhe                                                    |
|-------------------|------------------------------------------------------------|
| **Runtime**       | Node.js 22                                                 |
| **Framework**     | Express.js 5                                               |
| **Porta**         | 5000 (configuravel via `PORT`)                             |
| **Ponto de entrada** | `index.js`                                              |

### Modulos Principais

| Modulo                        | Arquivo                         | Funcao                                                  |
|-------------------------------|---------------------------------|---------------------------------------------------------|
| **Servidor e Rotas**          | `index.js`                      | Configuracao Express, rotas REST, middleware             |
| **Autenticacao**              | `auth.js`                       | Login por token via e-mail, validacao diaria por device  |
| **Banco de Dados**            | `database.js`                   | Connection Pool (pg), CRUD de todas as tabelas           |
| **Integracao JIRA (usuario)** | `user-jira-integration.js`      | Busca de tickets, registro de worklogs, consulta Tempo   |
| **Integracao JIRA (legado)**  | `jira-integration.js`           | Modulo original (em descontinuacao)                      |
| **Backup**                    | `backup-database.js`            | Dump PostgreSQL e gerenciamento de arquivos              |
| **Backup por E-mail**         | `backup-email.js`               | Gera backup e envia por Gmail                            |
| **Rotas de Backup**           | `server/routes/backupRoutes.js` | Endpoints REST para backup via API                       |
| **Servico de E-mail**         | `server/config/email.js`        | Configuracao Nodemailer para envio de backups            |

### Endpoints da API REST

| Metodo   | Rota                                   | Descricao                              |
|----------|----------------------------------------|----------------------------------------|
| `POST`   | `/api/auth/check-user`                 | Verificar usuario e enviar token       |
| `POST`   | `/api/auth/validate-token`             | Validar token de acesso                |
| `GET`    | `/api/auth/current-user`               | Obter usuario autenticado              |
| `POST`   | `/api/parse-voice`                     | Analisar texto de voz                  |
| `POST`   | `/api/log-work`                        | Registrar apontamento no JIRA/Tempo    |
| `POST`   | `/api/consulta-apontamentos`           | Consultar apontamentos por data        |
| `GET`    | `/api/favorites`                       | Listar tickets favoritos               |
| `POST`   | `/api/favorites`                       | Adicionar ticket favorito              |
| `DELETE` | `/api/favorites/:ticketKey`            | Remover ticket favorito                |
| `GET`    | `/api/favorites/by-project/:projectKey`| Favoritos filtrados por projeto        |
| `GET`    | `/api/config`                          | Carregar configuracao do usuario       |
| `POST`   | `/api/config/credentials`              | Salvar credenciais JIRA                |
| `POST`   | `/api/config/projects`                 | Salvar/atualizar projeto               |
| `DELETE` | `/api/config/projects/:projectName`    | Remover projeto                        |
| `GET`    | `/api/favorite-descriptions`           | Listar descricoes favoritas            |
| `POST`   | `/api/favorite-descriptions`           | Adicionar descricao favorita           |
| `DELETE` | `/api/favorite-descriptions/:index`    | Remover descricao favorita             |
| `POST`   | `/api/backup/create`                   | Criar backup do banco                  |
| `GET`    | `/api/backup/list`                     | Listar backups existentes              |
| `GET`    | `/api/backup/status`                   | Status do sistema de backup            |
| `POST`   | `/api/backup/email`                    | Backup por e-mail                      |
| `GET`    | `/api/backup/health`                   | Health check do servico de backup      |

---

## 4. Camada de Dados

| Item              | Detalhe                                               |
|-------------------|-------------------------------------------------------|
| **SGBD**          | PostgreSQL 16                                         |
| **Hospedagem**    | Neon (integrado ao Replit)                             |
| **Driver**        | `pg` (node-postgres) com Connection Pooling            |
| **Pool Config**   | max: 10 conexoes, idle timeout: 30s, connect timeout: 2s |

O modelo fisico completo esta disponivel em `docs/DDL_modelo_fisico.sql`.

---

## 5. Integracoes Externas

| Servico           | Finalidade                          | Protocolo          |
|-------------------|-------------------------------------|--------------------|
| **Atlassian JIRA**| Busca de tickets, registro de work  | REST API v3 (HTTPS)|
| **Tempo Timesheets**| Consulta de worklogs por data     | REST API v4 (HTTPS)|
| **Gmail SMTP**    | Envio de tokens e backups por email | SMTP (TLS)         |

---

## 6. Fluxo de Autenticacao

```
Usuario → Informa e-mail → Backend gera token → Envia por e-mail
        → Usuario digita token → Backend valida → Cria sessao (12h por device)
```

- Na primeira vez, a conta e criada automaticamente.
- Validacao diaria por device fingerprint (12 horas sem re-autenticacao).
- Tokens expiram em 30 minutos.

---

## 7. Variaveis de Ambiente

| Variavel              | Descricao                                       |
|-----------------------|-------------------------------------------------|
| `DATABASE_URL`        | String de conexao PostgreSQL                    |
| `SYSTEM_EMAIL`        | E-mail do sistema (envio de tokens)             |
| `SYSTEM_EMAIL_PASSWORD`| Senha do e-mail do sistema                     |
| `EMAIL_USER`          | E-mail para envio de backups                    |
| `EMAIL_PASS`          | Senha do e-mail de backups                      |
| `BACKUP_API_KEY`      | Chave de API para rotas de backup               |
| `JIRA_BASE_URL`       | URL base do JIRA (legado)                       |
| `JIRA_USERNAME`       | Usuario JIRA (legado)                           |
| `JIRA_API_TOKEN`      | Token API JIRA (legado)                         |
| `TEMPO_API_TOKEN`     | Token API Tempo (legado)                        |
| `JIRA_USER_ID`        | ID do usuario JIRA (legado)                     |
| `PORT`                | Porta do servidor (padrao: 5000)                |

---

## 8. Dependencias do Projeto

| Pacote        | Versao   | Funcao                            |
|---------------|----------|-----------------------------------|
| `express`     | ^5.1.0   | Framework HTTP                    |
| `pg`          | ^8.16.3  | Driver PostgreSQL                 |
| `axios`       | ^1.11.0  | Cliente HTTP (JIRA/Tempo API)     |
| `nodemailer`  | ^7.0.5   | Envio de e-mails                  |
| `dotenv`      | ^17.2.1  | Variaveis de ambiente             |
| `moment`      | ^2.30.1  | Manipulacao de datas              |

---

## 9. Estrutura de Diretorios

```
/
├── index.js                     # Servidor Express (ponto de entrada)
├── auth.js                      # Sistema de autenticacao
├── database.js                  # Camada de acesso a dados (PostgreSQL)
├── user-jira-integration.js     # Integracao JIRA por usuario
├── jira-integration.js          # Integracao JIRA legada
├── backup-database.js           # Sistema de backup
├── backup-email.js              # Backup por e-mail
├── package.json                 # Dependencias Node.js
├── versao.json                  # Controle de versao do deploy
├── public/                      # Frontend (arquivos estaticos)
│   ├── index.html               # Pagina principal
│   ├── login.html               # Pagina de login
│   ├── config.html              # Pagina de configuracoes
│   ├── consulta.html            # Pagina de consulta
│   ├── app.js                   # Logica frontend (Voice Recognition)
│   ├── styles.css               # Estilos CSS
│   ├── manifest.json            # Manifest PWA
│   └── sw.js                    # Service Worker
├── server/
│   ├── config/
│   │   └── email.js             # Configuracao de e-mail
│   └── routes/
│       └── backupRoutes.js      # Rotas de backup
├── json-backup/                 # Backup dos dados JSON originais
│   ├── users.json
│   ├── user-credentials.json
│   ├── user-projects.json
│   ├── user-favorites.json
│   └── user-favorite-descriptions.json
└── docs/                        # Documentacao do projeto
    ├── DDL_modelo_fisico.sql    # Modelo fisico do banco
    └── ARQUITETURA.md           # Este documento
```
