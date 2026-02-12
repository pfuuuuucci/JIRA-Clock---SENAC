const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

class DatabaseSystem {
    constructor() {
        // Usar connection pooling para melhor performance
        const databaseUrl = process.env.DATABASE_URL;
        if (!databaseUrl) {
            throw new Error('DATABASE_URL não configurada. Certifique-se que o banco PostgreSQL foi criado.');
        }

        // Usar pooler para connections otimizadas
        const poolUrl = databaseUrl.includes('-pooler') ? databaseUrl : databaseUrl.replace('.us-east-2', '-pooler.us-east-2');

        this.pool = new Pool({
            connectionString: poolUrl,
            max: 10,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2000,
        });

        console.log('✅ Database Pool criado com sucesso');
    }

    async initializeTables() {
        console.log('🔧 Inicializando tabelas do banco...');

        const client = await this.pool.connect();
        try {
            // 1. Tabela USERS
            await client.query(`
                CREATE TABLE IF NOT EXISTS users (
                    username VARCHAR(50) PRIMARY KEY,
                    email VARCHAR(255) NOT NULL,
                    jira_username VARCHAR(255),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // 2. Tabela USER_CREDENTIALS
            await client.query(`
                CREATE TABLE IF NOT EXISTS user_credentials (
                    username VARCHAR(50) PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE,
                    jira_username VARCHAR(255) NOT NULL,
                    api_token TEXT NOT NULL,
                    user_id VARCHAR(255) NOT NULL,
                    tempo_token VARCHAR(255),
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // 3. Tabela USER_PROJECTS
            await client.query(`
                CREATE TABLE IF NOT EXISTS user_projects (
                    id SERIAL PRIMARY KEY,
                    username VARCHAR(50) REFERENCES users(username) ON DELETE CASCADE,
                    project_name VARCHAR(255) NOT NULL,
                    display_name VARCHAR(255) NOT NULL,
                    jira_project_key VARCHAR(50) NOT NULL,
                    search_project VARCHAR(255) NOT NULL,
                    UNIQUE(username, project_name)
                )
            `);

            // 4. Tabela USER_FAVORITES (tickets favoritos)
            await client.query(`
                CREATE TABLE IF NOT EXISTS user_favorites (
                    id SERIAL PRIMARY KEY,
                    username VARCHAR(50) REFERENCES users(username) ON DELETE CASCADE,
                    ticket_key VARCHAR(50) NOT NULL,
                    summary TEXT NOT NULL,
                    status VARCHAR(100),
                    assignee VARCHAR(255),
                    project_key VARCHAR(50),
                    date_added TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(username, ticket_key)
                )
            `);

            // Adicionar coluna project_key se não existir (para bancos existentes)
            await client.query(`
                ALTER TABLE user_favorites 
                ADD COLUMN IF NOT EXISTS project_key VARCHAR(50)
            `);

            // 5. Tabela USER_FAVORITE_DESCRIPTIONS
            await client.query(`
                CREATE TABLE IF NOT EXISTS user_favorite_descriptions (
                    id SERIAL PRIMARY KEY,
                    username VARCHAR(100) NOT NULL,
                    description TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(username, description)
                )
            `);

            // NOVA TABELA: Validações de token diário por device
            await client.query(`
                CREATE TABLE IF NOT EXISTS daily_token_validations (
                    id SERIAL PRIMARY KEY,
                    validation_key VARCHAR(255) UNIQUE NOT NULL,
                    username VARCHAR(100) NOT NULL,
                    device_fingerprint VARCHAR(255) NOT NULL,
                    validated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    expires_at TIMESTAMP NOT NULL
                )
            `);

            // Criar índices separadamente para PostgreSQL
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_daily_token_username 
                ON daily_token_validations(username)
            `);
            
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_daily_token_expires 
                ON daily_token_validations(expires_at)
            `);

            console.log('✅ Todas as tabelas criadas/verificadas com sucesso');
        } catch (error) {
            console.error('❌ Erro ao criar tabelas:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    async migrateFromJsonFiles() {
        console.log('📦 Iniciando migração dos arquivos JSON...');

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            // 1. MIGRAR USERS
            await this.migrateUsers(client);

            // 2. MIGRAR USER_CREDENTIALS  
            await this.migrateUserCredentials(client);

            // 3. MIGRAR USER_PROJECTS
            await this.migrateUserProjects(client);

            // 4. MIGRAR USER_FAVORITES
            await this.migrateUserFavorites(client);

            // 5. MIGRAR USER_FAVORITE_DESCRIPTIONS
            await this.migrateUserFavoriteDescriptions(client);

            await client.query('COMMIT');
            console.log('✅ Migração completa realizada com sucesso!');

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('❌ Erro na migração:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    async migrateUsers(client) {
        const usersFile = path.join(__dirname, 'users.json');
        if (!fs.existsSync(usersFile)) return;

        const usersData = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
        console.log('📋 Migrando usuarios:', Object.keys(usersData));

        for (const [username, userData] of Object.entries(usersData)) {
            await client.query(`
                INSERT INTO users (username, email, jira_username, created_at, last_login)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (username) DO UPDATE SET
                    email = EXCLUDED.email,
                    jira_username = EXCLUDED.jira_username,
                    last_login = EXCLUDED.last_login
            `, [
                username,
                userData.email,
                userData.jiraUsername,
                userData.createdAt,
                userData.lastLogin
            ]);
        }

        console.log(`✅ ${Object.keys(usersData).length} usuários migrados`);
    }

    async migrateUserCredentials(client) {
        const credentialsFile = path.join(__dirname, 'user-credentials.json');
        if (!fs.existsSync(credentialsFile)) return;

        const credentialsData = JSON.parse(fs.readFileSync(credentialsFile, 'utf8'));
        console.log('🔑 Migrando credenciais:', Object.keys(credentialsData.users || {}));

        for (const [username, credentials] of Object.entries(credentialsData.users || {})) {
            await client.query(`
                INSERT INTO user_credentials (username, jira_username, api_token, user_id, tempo_token, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (username) DO UPDATE SET
                    jira_username = EXCLUDED.jira_username,
                    api_token = EXCLUDED.api_token,
                    user_id = EXCLUDED.user_id,
                    tempo_token = EXCLUDED.tempo_token,
                    updated_at = EXCLUDED.updated_at
            `, [
                username,
                credentials.jiraUsername,
                credentials.apiToken,
                credentials.userId,
                credentials.tempoToken || '',
                credentials.updatedAt
            ]);
        }

        console.log(`✅ ${Object.keys(credentialsData.users || {}).length} credenciais migradas`);
    }

    async migrateUserProjects(client) {
        const projectsFile = path.join(__dirname, 'user-projects.json');
        if (!fs.existsSync(projectsFile)) return;

        const projectsData = JSON.parse(fs.readFileSync(projectsFile, 'utf8'));
        console.log('📋 Migrando projetos:', Object.keys(projectsData.users || {}));

        for (const [username, projects] of Object.entries(projectsData.users || {})) {
            for (const [projectName, projectData] of Object.entries(projects)) {
                await client.query(`
                    INSERT INTO user_projects (username, project_name, display_name, jira_project_key, search_project)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (username, project_name) DO UPDATE SET
                        display_name = EXCLUDED.display_name,
                        jira_project_key = EXCLUDED.jira_project_key,
                        search_project = EXCLUDED.search_project
                `, [
                    username,
                    projectName,
                    projectData.displayName,
                    projectData.jiraProjectKey,
                    projectData.searchProject
                ]);
            }
        }

        console.log(`✅ Projetos de usuários migrados`);
    }

    async migrateUserFavorites(client) {
        const favoritesFile = path.join(__dirname, 'user-favorites.json');
        if (!fs.existsSync(favoritesFile)) return;

        const favoritesData = JSON.parse(fs.readFileSync(favoritesFile, 'utf8'));
        console.log('⭐ Migrando favoritos:', Object.keys(favoritesData.users || {}));

        // Função para extrair project_key da ticket_key
        const extractProjectKey = (ticketKey) => {
            if (ticketKey.startsWith('VTGPREVEND-')) return 'VTGPV';
            if (ticketKey.startsWith('TJRJFSW2-')) return 'TJRJFSW2';
            if (ticketKey.startsWith('SOMPOSUS-')) return 'SOMPOSUS';
            if (ticketKey.startsWith('VTGGO-')) return 'VTGGO';
            if (ticketKey.startsWith('VTGGENTE-')) return 'VTGGENTE';

            // Fallback: usar tudo antes do primeiro hífen
            const match = ticketKey.match(/^([A-Z0-9]+)-/);
            return match ? match[1] : null;
        };

        for (const [username, favorites] of Object.entries(favoritesData.users || {})) {
            for (const favorite of favorites) {
                const projectKey = extractProjectKey(favorite.key);

                await client.query(`
                    INSERT INTO user_favorites (username, ticket_key, summary, status, assignee, project_key, date_added)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (username, ticket_key) DO UPDATE SET
                        summary = EXCLUDED.summary,
                        status = EXCLUDED.status,
                        assignee = EXCLUDED.assignee,
                        project_key = EXCLUDED.project_key
                `, [
                    username,
                    favorite.key,
                    favorite.summary,
                    favorite.status,
                    favorite.assignee,
                    projectKey,
                    favorite.dateAdded
                ]);
            }
        }

        console.log(`✅ Favoritos de usuários migrados com project_key`);
    }

    async migrateUserFavoriteDescriptions(client) {
        const descriptionsFile = path.join(__dirname, 'user-favorite-descriptions.json');
        if (!fs.existsSync(descriptionsFile)) return;

        const descriptionsData = JSON.parse(fs.readFileSync(descriptionsFile, 'utf8'));
        console.log('📝 Migrando descrições favoritas:', Object.keys(descriptionsData.users || {}));

        for (const [username, descriptions] of Object.entries(descriptionsData.users || {})) {
            for (const description of descriptions) {
                await client.query(`
                    INSERT INTO user_favorite_descriptions (username, description)
                    VALUES ($1, $2)
                    ON CONFLICT (username, description) DO NOTHING
                `, [username, description]);
            }
        }

        console.log(`✅ Descrições favoritas migradas`);
    }

    // === MÉTODOS PARA SUBSTITUIR OS ARQUIVOS JSON ===

    // USERS
    async getUser(username) {
        const client = await this.pool.connect();
        try {
            const result = await client.query('SELECT * FROM users WHERE username = $1', [username]);
            return result.rows[0] || null;
        } finally {
            client.release();
        }
    }

    async createUser(userData) {
        const client = await this.pool.connect();
        try {
            await client.query(`
                INSERT INTO users (username, email, jira_username, created_at, last_login)
                VALUES ($1, $2, $3, $4, $5)
            `, [
                userData.username,
                userData.email,
                userData.jiraUsername,
                userData.createdAt,
                userData.lastLogin
            ]);
            return true;
        } catch (error) {
            console.error('Erro ao criar usuário:', error);
            return false;
        } finally {
            client.release();
        }
    }

    async updateLastLogin(username) {
        const client = await this.pool.connect();
        try {
            await client.query(
                'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE username = $1',
                [username]
            );
        } finally {
            client.release();
        }
    }

    // USER_CREDENTIALS
    async getUserCredentials(username) {
        const client = await this.pool.connect();
        try {
            const result = await client.query('SELECT * FROM user_credentials WHERE username = $1', [username]);
            return result.rows[0] || null;
        } finally {
            client.release();
        }
    }

    async setUserCredentials(username, credentials) {
        const client = await this.pool.connect();
        try {
            await client.query(`
                INSERT INTO user_credentials (username, jira_username, api_token, user_id, tempo_token, updated_at)
                VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
                ON CONFLICT (username) DO UPDATE SET
                    jira_username = EXCLUDED.jira_username,
                    api_token = EXCLUDED.api_token,
                    user_id = EXCLUDED.user_id,
                    tempo_token = EXCLUDED.tempo_token,
                    updated_at = CURRENT_TIMESTAMP
            `, [
                username,
                credentials.jiraUsername,
                credentials.apiToken,
                credentials.userId,
                credentials.tempoToken || ''
            ]);
            return true;
        } catch (error) {
            console.error('Erro ao salvar credenciais:', error);
            return false;
        } finally {
            client.release();
        }
    }

    // USER_PROJECTS
    async getUserProjects(username) {
        const client = await this.pool.connect();
        try {
            const result = await client.query('SELECT * FROM user_projects WHERE username = $1', [username]);
            const projects = {};
            for (const row of result.rows) {
                projects[row.project_name] = {
                    displayName: row.display_name,
                    jiraProjectKey: row.jira_project_key,
                    searchProject: row.search_project
                };
            }
            return projects;
        } finally {
            client.release();
        }
    }

    async setUserProject(username, projectName, displayName, jiraProjectKey) {
        const client = await this.pool.connect();
        try {
            await client.query(`
                INSERT INTO user_projects (username, project_name, display_name, jira_project_key, search_project)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (username, project_name) DO UPDATE SET
                    display_name = EXCLUDED.display_name,
                    jira_project_key = EXCLUDED.jira_project_key,
                    search_project = EXCLUDED.search_project
            `, [username, projectName, displayName, jiraProjectKey, displayName]);
            return true;
        } catch (error) {
            console.error('Erro ao salvar projeto:', error);
            return false;
        } finally {
            client.release();
        }
    }

    async removeUserProject(username, projectName) {
        const client = await this.pool.connect();
        try {
            const result = await client.query(
                'DELETE FROM user_projects WHERE username = $1 AND project_name = $2',
                [username, projectName]
            );
            return result.rowCount > 0;
        } catch (error) {
            console.error('Erro ao remover projeto:', error);
            return false;
        } finally {
            client.release();
        }
    }

    // USER_FAVORITES
    async getUserFavorites(username) {
        const client = await this.pool.connect();
        try {
            const result = await client.query(
                'SELECT * FROM user_favorites WHERE username = $1 ORDER BY date_added DESC',
                [username]
            );
            return result.rows.map(row => ({
                key: row.ticket_key,
                summary: row.summary,
                status: row.status,
                assignee: row.assignee,
                dateAdded: row.date_added
            }));
        } finally {
            client.release();
        }
    }

    async addUserFavorite(username, ticket) {
        const client = await this.pool.connect();
        try {
            // Função para extrair project_key da ticket_key
            const extractProjectKey = (ticketKey) => {
                if (ticketKey.startsWith('VTGPREVEND-')) return 'VTGPV';
                if (ticketKey.startsWith('TJRJFSW2-')) return 'TJRJFSW2';
                if (ticketKey.startsWith('SOMPOSUS-')) return 'SOMPOSUS';
                if (ticketKey.startsWith('VTGGO-')) return 'VTGGO';
                if (ticketKey.startsWith('VTGGENTE-')) return 'VTGGENTE';

                // Fallback: usar tudo antes do primeiro hífen
                const match = ticketKey.match(/^([A-Z0-9]+)-/);
                return match ? match[1] : null;
            };

            const projectKey = extractProjectKey(ticket.key);

            await client.query(`
                INSERT INTO user_favorites (username, ticket_key, summary, status, assignee, project_key, date_added)
                VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
                ON CONFLICT (username, ticket_key) DO UPDATE SET
                    summary = EXCLUDED.summary,
                    status = EXCLUDED.status,
                    assignee = EXCLUDED.assignee,
                    project_key = EXCLUDED.project_key
            `, [username, ticket.key, ticket.summary, ticket.status, ticket.assignee, projectKey]);
            return true;
        } catch (error) {
            console.error('Erro ao adicionar favorito:', error);
            return false;
        } finally {
            client.release();
        }
    }

    async removeUserFavorite(username, ticketKey) {
        const client = await this.pool.connect();
        try {
            const result = await client.query(
                'DELETE FROM user_favorites WHERE username = $1 AND ticket_key = $2',
                [username, ticketKey]
            );
            return result.rowCount > 0;
        } catch (error) {
            console.error('Erro ao remover favorito:', error);
            return false;
        } finally {
            client.release();
        }
    }

    // USER_FAVORITE_DESCRIPTIONS
    async getUserFavoriteDescriptions(username) {
        const client = await this.pool.connect();
        try {
            const result = await client.query(
                'SELECT description FROM user_favorite_descriptions WHERE username = $1 ORDER BY created_at',
                [username]
            );
            return result.rows.map(row => row.description);
        } finally {
            client.release();
        }
    }

    async addUserFavoriteDescription(username, description) {
        const client = await this.pool.connect();
        try {
            await client.query(`
                INSERT INTO user_favorite_descriptions (username, description)
                VALUES ($1, $2)
                ON CONFLICT (username, description) DO NOTHING
            `, [username, description]);
            return true;
        } catch (error) {
            console.error('Erro ao adicionar descrição favorita:', error);
            return false;
        } finally {
            client.release();
        }
    }

    async removeUserFavoriteDescription(username, description) {
        const client = await this.pool.connect();
        try {
            const result = await client.query(
                'DELETE FROM user_favorite_descriptions WHERE username = $1 AND description = $2',
                [username, description]
            );
            return result.rowCount > 0;
        } catch (error) {
            console.error('Erro ao remover descrição favorita:', error);
            return false;
        } finally {
            client.release();
        }
    }

    async removeUserFavoriteDescriptionByIndex(username, index) {
        const client = await this.pool.connect();
        try {
            // Primeiro, obter todas as descrições ordenadas
            const descriptionsResult = await client.query(
                'SELECT id FROM user_favorite_descriptions WHERE username = $1 ORDER BY created_at',
                [username]
            );

            if (index < 0 || index >= descriptionsResult.rows.length) {
                return false;
            }

            const targetId = descriptionsResult.rows[index].id;

            const result = await client.query(
                'DELETE FROM user_favorite_descriptions WHERE id = $1',
                [targetId]
            );

            return result.rowCount > 0;
        } catch (error) {
            console.error('Erro ao remover descrição favorita por índice:', error);
            return false;
        } finally {
            client.release();
        }
    }

    // Novo método para buscar favoritos por projeto
    async getUserFavoritesByProject(username, projectKey) {
        const client = await this.pool.connect();
        try {
            const result = await client.query(
                'SELECT * FROM user_favorites WHERE username = $1 AND project_key = $2 ORDER BY date_added DESC',
                [username, projectKey]
            );
            return result.rows.map(row => ({
                key: row.ticket_key,
                summary: row.summary,
                status: row.status,
                assignee: row.assignee,
                projectKey: row.project_key,
                dateAdded: row.date_added
            }));
        } finally {
            client.release();
        }
    }

    // === MÉTODOS PARA TOKENS DIÁRIOS ===

    async getDailyTokenValidation(validationKey) {
        const client = await this.pool.connect();
        try {
            const result = await client.query(
                'SELECT * FROM daily_token_validations WHERE validation_key = $1',
                [validationKey]
            );
            return result.rows[0] || null;
        } catch (error) {
            console.error('Erro ao buscar validação de token diário:', error);
            return null;
        } finally {
            client.release();
        }
    }

    async saveDailyTokenValidation(validationKey, data) {
        const client = await this.pool.connect();
        try {
            await client.query(`
                INSERT INTO daily_token_validations (validation_key, username, device_fingerprint, validated_at, expires_at)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (validation_key) 
                DO UPDATE SET 
                    validated_at = EXCLUDED.validated_at,
                    expires_at = EXCLUDED.expires_at
            `, [
                validationKey,
                data.username,
                data.device_fingerprint,
                data.validated_at,
                data.expires_at
            ]);
            return true;
        } catch (error) {
            console.error('Erro ao salvar validação de token diário:', error);
            return false;
        } finally {
            client.release();
        }
    }

    async removeDailyTokenValidation(validationKey) {
        const client = await this.pool.connect();
        try {
            await client.query(
                'DELETE FROM daily_token_validations WHERE validation_key = $1',
                [validationKey]
            );
            return true;
        } catch (error) {
            console.error('Erro ao remover validação de token diário:', error);
            return false;
        } finally {
            client.release();
        }
    }

    async cleanExpiredDailyTokenValidations() {
        const client = await this.pool.connect();
        try {
            const result = await client.query(
                'DELETE FROM daily_token_validations WHERE expires_at < NOW()'
            );
            console.log(`🧹 ${result.rowCount} tokens diários expirados removidos`);
            return result.rowCount;
        } catch (error) {
            console.error('Erro ao limpar tokens diários expirados:', error);
            return 0;
        } finally {
            client.release();
        }
    }

    async close() {
        if (this.pool) {
            await this.pool.end();
            console.log('✅ Conexão com PostgreSQL fechada');
        }
    }
}

module.exports = DatabaseSystem;