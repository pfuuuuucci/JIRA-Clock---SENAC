-- ============================================================
-- JIRA Voice Assistant - Modelo Físico do Banco de Dados (DDL)
-- SGBD: PostgreSQL 16 (Neon-backed, hospedado no Replit)
-- Data: Fevereiro/2026
-- ============================================================

-- ============================================================
-- 1. TABELA: users
-- Descrição: Armazena os dados cadastrais dos usuários do sistema.
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    username        VARCHAR(50)     PRIMARY KEY,
    email           VARCHAR(255)    NOT NULL,
    jira_username   VARCHAR(255),
    created_at      TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    last_login      TIMESTAMP       DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 2. TABELA: user_credentials
-- Descrição: Armazena as credenciais de integração com JIRA/Tempo
--            de cada usuário. Relacionamento 1:1 com users.
-- ============================================================
CREATE TABLE IF NOT EXISTS user_credentials (
    username        VARCHAR(50)     PRIMARY KEY
                                    REFERENCES users(username) ON DELETE CASCADE,
    jira_username   VARCHAR(255)    NOT NULL,
    api_token       TEXT            NOT NULL,
    user_id         VARCHAR(255)    NOT NULL,
    tempo_token     VARCHAR(255),
    updated_at      TIMESTAMP       DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 3. TABELA: user_projects
-- Descrição: Armazena os projetos JIRA configurados por cada
--            usuário. Relacionamento 1:N com users.
-- ============================================================
CREATE TABLE IF NOT EXISTS user_projects (
    id              SERIAL          PRIMARY KEY,
    username        VARCHAR(50)     REFERENCES users(username) ON DELETE CASCADE,
    project_name    VARCHAR(255)    NOT NULL,
    display_name    VARCHAR(255)    NOT NULL,
    jira_project_key VARCHAR(50)   NOT NULL,
    search_project  VARCHAR(255)    NOT NULL,
    UNIQUE(username, project_name)
);

-- ============================================================
-- 4. TABELA: user_favorites
-- Descrição: Armazena os tickets JIRA favoritos de cada usuário
--            para acesso rápido. Relacionamento 1:N com users.
-- ============================================================
CREATE TABLE IF NOT EXISTS user_favorites (
    id              SERIAL          PRIMARY KEY,
    username        VARCHAR(50)     REFERENCES users(username) ON DELETE CASCADE,
    ticket_key      VARCHAR(50)     NOT NULL,
    summary         TEXT            NOT NULL,
    status          VARCHAR(100),
    assignee        VARCHAR(255),
    project_key     VARCHAR(50),
    date_added      TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(username, ticket_key)
);

-- ============================================================
-- 5. TABELA: user_favorite_descriptions
-- Descrição: Armazena descrições de atividades favoritas para
--            reuso em apontamentos. Relacionamento 1:N com users.
-- ============================================================
CREATE TABLE IF NOT EXISTS user_favorite_descriptions (
    id              SERIAL          PRIMARY KEY,
    username        VARCHAR(100)    NOT NULL,
    description     TEXT            NOT NULL,
    created_at      TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(username, description)
);

-- ============================================================
-- 6. TABELA: daily_token_validations
-- Descrição: Controla a validação diária de tokens de autenticação
--            por dispositivo, permitindo sessão de 12 horas sem
--            re-autenticação no mesmo device.
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_token_validations (
    id                  SERIAL          PRIMARY KEY,
    validation_key      VARCHAR(255)    UNIQUE NOT NULL,
    username            VARCHAR(100)    NOT NULL,
    device_fingerprint  VARCHAR(255)    NOT NULL,
    validated_at        TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    expires_at          TIMESTAMP       NOT NULL
);

-- ============================================================
-- ÍNDICES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_daily_token_username
    ON daily_token_validations(username);

CREATE INDEX IF NOT EXISTS idx_daily_token_expires
    ON daily_token_validations(expires_at);
