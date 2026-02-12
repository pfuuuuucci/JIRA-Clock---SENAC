# JIRA Voice Assistant

Sistema web para registro de apontamentos de horas no JIRA/Tempo por meio de comandos de voz, com autenticacao por e-mail e gerenciamento de favoritos.

O aplicativo encontra-se em ambiente produtivo, no endereço abaixo:
https://jira-clock-senac.replit.app

Os servidores de Backend e Frontend estão operacionais na plataforma REPLIT.COM

O vídeo demonstrativo do funcionamento da aplicação está em [`docs/Video JIRA CLOCK SENAC - Projeto Integrador.MP4`] .

---

## Sobre o Projeto

O **JIRA Voice Assistant** permite que profissionais registrem suas horas de trabalho no JIRA de forma rapida e intuitiva usando a voz. O usuario fala a atividade que realizou, e o sistema extrai automaticamente as informacoes de tempo, projeto, descricao e ticket, enviando o apontamento diretamente para o JIRA/Tempo.

### Principais Funcionalidades

- **Registro por voz**: Captura de fala via Web Speech API com extracao automatica de dados (tempo, projeto, descricao).
- **Integracao JIRA/Tempo**: Busca de tickets, registro de worklogs e consulta de apontamentos.
- **Autenticacao por e-mail**: Login via token enviado por e-mail com sessao de 12 horas por dispositivo.
- **Tickets favoritos**: Salve tickets frequentes para acesso rapido.
- **Descricoes favoritas**: Reutilize descricoes de atividades recorrentes.
- **Consulta de apontamentos**: Visualize os apontamentos registrados por data.
- **Backup automatizado**: Sistema de backup do banco de dados com envio por e-mail.
- **PWA (Progressive Web App)**: Instalavel no dispositivo como aplicativo nativo.

---

## Tecnologias Utilizadas

| Camada       | Tecnologia                          |
|--------------|-------------------------------------|
| **Frontend** | HTML5, CSS3, JavaScript (Vanilla)   |
| **Backend**  | Node.js 22, Express.js 5           |
| **Banco**    | PostgreSQL 16 (Neon)               |
| **APIs**     | Atlassian JIRA REST API v3, Tempo API v4 |
| **E-mail**   | Nodemailer (Gmail SMTP)            |
| **HTTP**     | Axios                              |

---

## Arquitetura

O projeto utiliza a arquitetura **Cliente-Servidor**, onde um unico servidor Node.js/Express serve tanto o frontend estatico quanto a API REST do backend.

A documentacao completa da arquitetura esta em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

O modelo fisico do banco de dados (DDL) esta em [`docs/DDL_modelo_fisico.sql`](docs/DDL_modelo_fisico.sql).

---

## Pre-requisitos

- Node.js 22 ou superior
- PostgreSQL 16
- Conta no Atlassian JIRA com API Token
- Conta Gmail com App Password (para envio de tokens e backups)

---

## Variaveis de Ambiente

Crie um arquivo `.env` na raiz do projeto com as seguintes variaveis:

```env
DATABASE_URL=postgresql://usuario:senha@host:porta/banco
SYSTEM_EMAIL=seu-email@gmail.com
SYSTEM_EMAIL_PASSWORD=sua-app-password
EMAIL_USER=seu-email@gmail.com
EMAIL_PASS=sua-app-password
BACKUP_API_KEY=sua-chave-de-api
PORT=5000
```

---

## Instalacao e Execucao

```bash
# 1. Clonar o repositorio
git clone <url-do-repositorio>

# 2. Instalar dependencias
npm install

# 3. Configurar variaveis de ambiente
cp .env.example .env
# Edite o .env com suas credenciais

# 4. Iniciar o servidor
node index.js
```

O servidor inicia na porta 5000. Acesse: `http://localhost:5000`

Na primeira execucao, as tabelas do banco sao criadas automaticamente e, se houver dados nos arquivos JSON legados, a migracao e feita automaticamente.

---

## Estrutura do Projeto

```
/
├── index.js                     # Servidor Express (ponto de entrada)
├── auth.js                      # Sistema de autenticacao
├── database.js                  # Camada de acesso a dados (PostgreSQL)
├── user-jira-integration.js     # Integracao JIRA por usuario
├── backup-database.js           # Sistema de backup
├── backup-email.js              # Backup por e-mail
├── public/                      # Frontend (arquivos estaticos)
│   ├── index.html               # Pagina principal (apontamento por voz)
│   ├── login.html               # Pagina de login
│   ├── config.html              # Pagina de configuracoes
│   ├── consulta.html            # Consulta de apontamentos
│   ├── app.js                   # Logica de reconhecimento de voz
│   ├── styles.css               # Estilos da aplicacao
│   ├── manifest.json            # Manifest PWA
│   └── sw.js                    # Service Worker
├── server/
│   ├── config/email.js          # Configuracao de e-mail
│   └── routes/backupRoutes.js   # Rotas de backup
└── docs/                        # Documentacao
    ├── DDL_modelo_fisico.sql    # Modelo fisico (DDL)
    └── ARQUITETURA.md           # Documento de arquitetura
```

---

## Modelo de Dados

O banco de dados PostgreSQL possui 6 tabelas:

| Tabela                        | Descricao                                      |
|-------------------------------|-------------------------------------------------|
| `users`                       | Cadastro de usuarios                            |
| `user_credentials`            | Credenciais JIRA/Tempo por usuario              |
| `user_projects`               | Projetos JIRA configurados por usuario          |
| `user_favorites`              | Tickets JIRA favoritos                          |
| `user_favorite_descriptions`  | Descricoes de atividades favoritas              |
| `daily_token_validations`     | Controle de sessoes por dispositivo             |

O script DDL completo esta em [`docs/DDL_modelo_fisico.sql`](docs/DDL_modelo_fisico.sql).

---

## Endpoints da API

### Autenticacao
| Metodo | Rota                          | Descricao                      |
|--------|-------------------------------|--------------------------------|
| POST   | `/api/auth/check-user`        | Verificar usuario e enviar token |
| POST   | `/api/auth/validate-token`    | Validar token de acesso        |
| GET    | `/api/auth/current-user`      | Obter usuario autenticado      |

### Apontamentos
| Metodo | Rota                           | Descricao                      |
|--------|--------------------------------|--------------------------------|
| POST   | `/api/parse-voice`             | Analisar texto de voz          |
| POST   | `/api/log-work`                | Registrar apontamento          |
| POST   | `/api/consulta-apontamentos`   | Consultar por data             |

### Favoritos
| Metodo | Rota                                       | Descricao                |
|--------|---------------------------------------------|--------------------------|
| GET    | `/api/favorites`                            | Listar favoritos         |
| POST   | `/api/favorites`                            | Adicionar favorito       |
| DELETE | `/api/favorites/:ticketKey`                 | Remover favorito         |
| GET    | `/api/favorites/by-project/:projectKey`     | Favoritos por projeto    |

### Configuracao
| Metodo | Rota                                  | Descricao                    |
|--------|---------------------------------------|------------------------------|
| GET    | `/api/config`                         | Carregar configuracao        |
| POST   | `/api/config/credentials`             | Salvar credenciais JIRA      |
| POST   | `/api/config/projects`                | Salvar projeto               |
| DELETE | `/api/config/projects/:projectName`   | Remover projeto              |

### Backup
| Metodo | Rota                    | Descricao                    |
|--------|-------------------------|------------------------------|
| POST   | `/api/backup/create`    | Criar backup                 |
| GET    | `/api/backup/list`      | Listar backups               |
| GET    | `/api/backup/status`    | Status do sistema            |
| POST   | `/api/backup/email`     | Backup por e-mail            |
| GET    | `/api/backup/health`    | Health check                 |

---

## Autor

Desenvolvido como projeto academico universitario.

---

## Licenca

ISC
