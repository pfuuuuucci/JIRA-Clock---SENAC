const nodemailer = require('nodemailer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const DatabaseSystem = require('./database');

class AuthSystem {
    constructor() {
        this.tokensFile = path.join(__dirname, 'pending-tokens.json');
        this.db = new DatabaseSystem();

        // Configurar transportador de email
        this.emailTransporter = nodemailer.createTransport({
            // Para Gmail
            service: 'gmail',
            auth: {
                user: process.env.SYSTEM_EMAIL || 'sistema@vertigo.com.br',
                pass: process.env.SYSTEM_EMAIL_PASSWORD
            }

            // Para servidor SMTP corporativo (descomente e configure se necessário)
            /*
            host: process.env.SMTP_HOST || 'smtp.vertigo.com.br',
            port: process.env.SMTP_PORT || 587,
            secure: false,
            auth: {
                user: process.env.SYSTEM_EMAIL || 'sistema@vertigo.com.br',
                pass: process.env.SYSTEM_EMAIL_PASSWORD
            }
            */
        });

        this.initializeFiles();
    }

    initializeFiles() {
        if (!fs.existsSync(this.tokensFile)) {
            fs.writeFileSync(this.tokensFile, JSON.stringify({}, null, 2));
        }
    }

    async initializeDatabase() {
        try {
            await this.db.initializeTables();
            console.log('✅ Database inicializado com sucesso');
        } catch (error) {
            console.error('❌ Erro ao inicializar database:', error);
            throw error;
        }
    }

    async migrateData() {
        try {
            await this.db.migrateFromJsonFiles();
            console.log('✅ Migração de dados concluída');
        } catch (error) {
            console.error('❌ Erro na migração:', error);
            throw error;
        }
    }

    loadPendingTokens() {
        try {
            const data = fs.readFileSync(this.tokensFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.error('Erro ao carregar tokens:', error);
            return {};
        }
    }

    savePendingTokens(tokens) {
        try {
            fs.writeFileSync(this.tokensFile, JSON.stringify(tokens, null, 2));
            return true;
        } catch (error) {
            console.error('Erro ao salvar tokens:', error);
            return false;
        }
    }

    generateToken() {
        return crypto.randomBytes(32).toString('hex').substring(0, 8).toUpperCase();
    }

    async checkUser(username, deviceFingerprint = null) {
        const userKey = username.toLowerCase();

        // Verificar se usuário existe no PostgreSQL
        const user = await this.db.getUser(userKey);
        const isFirstAccess = !user;

        // NOVA LÓGICA: Verificar token diário por device se fingerprint fornecido
        if (deviceFingerprint && !isFirstAccess) {
            const isValidated = await this.checkDailyTokenValidation(userKey, deviceFingerprint);
            if (isValidated) {
                console.log(`✅ Token diário válido para ${username} no device ${deviceFingerprint}`);
                return {
                    exists: true,
                    needsToken: false, // NÃO precisa de token
                    email: username, // Email completo como foi informado
                    tokenSent: false,
                    isFirstAccess: false,
                    dailyTokenValid: true
                };
            }
        }

        // SEMPRE gerar e enviar token se chegou até aqui
        const token = this.generateToken();
        const email = username; // Usar o email completo como foi informado pelo usuário

        // Salvar token pendente
        const pendingTokens = this.loadPendingTokens();
        pendingTokens[userKey] = {
            token: token,
            email: email,
            username: username,
            timestamp: new Date().toISOString(),
            expires: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 minutos
            isFirstAccess: isFirstAccess,
            deviceFingerprint: deviceFingerprint
        };
        this.savePendingTokens(pendingTokens);

        // Enviar email
        const emailSent = await this.sendTokenEmail(email, username, token, isFirstAccess);

        console.log(`🔐 Token gerado para ${username} (${isFirstAccess ? 'primeiro acesso' : 'validação de segurança'})`);

        return {
            exists: !isFirstAccess,
            needsToken: true, // SEMPRE precisa de token agora
            email: email,
            tokenSent: emailSent,
            isFirstAccess: isFirstAccess,
            dailyTokenValid: false
        };
    }

    async sendTokenEmail(email, username, token, isFirstAccess = false) {
        try {
            const accessType = isFirstAccess ? 'primeira vez' : 'novamente';
            const welcomeMessage = isFirstAccess 
                ? 'Você está tentando acessar o JIRA Voice Assistant pela primeira vez.'
                : 'Você está tentando acessar o JIRA Voice Assistant.';

            const mailOptions = {
                from: process.env.SYSTEM_EMAIL || 'sistema@example.com',
                to: email,
                subject: `Token de Acesso - JIRA Voice Assistant ${isFirstAccess ? '(Primeiro Acesso)' : ''}`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #3b82f6;">🎤 JIRA Voice Assistant</h2>
                        <p>Olá,</p>
                        <p>${welcomeMessage}</p>
                        <p>🔐 <strong>Por segurança, sempre enviamos um token de validação.</strong></p>
                        <p>Use o token abaixo para confirmar sua identidade:</p>
                        <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
                            <h1 style="color: #1f2937; font-size: 2rem; letter-spacing: 4px; margin: 0;">${token}</h1>
                        </div>
                        <p><strong>⚠️ Este token expira em 30 minutos.</strong></p>
                        ${isFirstAccess ? '<p><strong>✨ Após validar este token, sua conta será criada automaticamente.</strong></p>' : ''}
                        <p>Se você não solicitou este acesso, ignore este email.</p>
                        <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
                        <p style="color: #6b7280; font-size: 0.9rem;">
                            JIRA Voice Assistant - Sistema de Apontamentos
                        </p>
                    </div>
                `
            };

            await this.emailTransporter.sendMail(mailOptions);
            console.log(`✅ Token enviado para ${email}: ${token} (${accessType})`);
            return true;
        } catch (error) {
            console.error('Erro ao enviar email:', error);
            return false;
        }
    }

    async validateToken(username, inputToken, deviceFingerprint = null) {
        const pendingTokens = this.loadPendingTokens();
        const userKey = username.toLowerCase();

        if (!pendingTokens[userKey]) {
            return { valid: false, message: 'Token não encontrado' };
        }

        const tokenData = pendingTokens[userKey];

        // Verificar expiração
        if (new Date() > new Date(tokenData.expires)) {
            delete pendingTokens[userKey];
            this.savePendingTokens(pendingTokens);
            return { valid: false, message: 'Token expirado' };
        }

        // Verificar token
        if (tokenData.token !== inputToken.toUpperCase()) {
            return { valid: false, message: 'Token inválido' };
        }

        // Token válido - verificar se é primeiro acesso ou não
        let userData;

        if (tokenData.isFirstAccess) {
            // PRIMEIRO ACESSO: criar usuário no PostgreSQL
            userData = {
                username: userKey,
                email: tokenData.email,
                jiraUsername: username,
                createdAt: new Date().toISOString(),
                lastLogin: new Date().toISOString()
            };

            const success = await this.db.createUser(userData);

            if (!success) {
                return { valid: false, message: 'Erro ao criar usuário no banco' };
            }

            console.log(`✅ PRIMEIRO ACESSO: Usuário ${username} criado e autenticado`);
        } else {
            // ACESSO SUBSEQUENTE: buscar usuário existente
            const existingUser = await this.db.getUser(userKey);

            if (!existingUser) {
                return { valid: false, message: 'Usuário não encontrado no sistema' };
            }

            userData = {
                username: existingUser.username,
                email: existingUser.email,
                jiraUsername: existingUser.jira_username,
                createdAt: existingUser.created_at,
                lastLogin: existingUser.last_login
            };

            // Atualizar último login
            await this.updateLastLogin(userKey);

            console.log(`✅ ACESSO VALIDADO: Usuário ${username} autenticado com token`);
        }

        // NOVO: Salvar validação diária por device (12 horas)
        if (deviceFingerprint) {
            await this.saveDailyTokenValidation(userKey, deviceFingerprint);
            console.log(`🔐 Token diário salvo para ${username} no device ${deviceFingerprint}`);
        }

        // Remover token usado
        delete pendingTokens[userKey];
        this.savePendingTokens(pendingTokens);

        return {
            valid: true,
            user: userData,
            message: tokenData.isFirstAccess ? 'Conta criada e login realizado com sucesso' : 'Login validado com sucesso'
        };
    }

    // NOVO MÉTODO: Verificar se token diário ainda é válido
    async checkDailyTokenValidation(username, deviceFingerprint) {
        try {
            const validationKey = `daily_token_${username}_${deviceFingerprint}`;
            const validationData = await this.db.getDailyTokenValidation(validationKey);

            if (!validationData) {
                return false;
            }

            // Verificar se ainda está dentro das 12 horas
            const validatedAt = new Date(validationData.validated_at);
            const now = new Date();
            const diffHours = (now - validatedAt) / (1000 * 60 * 60);

            if (diffHours > 12) {
                // Token diário expirado - remover do banco
                await this.db.removeDailyTokenValidation(validationKey);
                console.log(`⏰ Token diário expirado para ${username} no device ${deviceFingerprint} (${diffHours.toFixed(1)}h)`);
                return false;
            }

            console.log(`✅ Token diário válido para ${username} no device ${deviceFingerprint} (${diffHours.toFixed(1)}h/12h)`);
            return true;

        } catch (error) {
            console.error('Erro ao verificar token diário:', error);
            return false;
        }
    }

    // NOVO MÉTODO: Salvar validação diária por device
    async saveDailyTokenValidation(username, deviceFingerprint) {
        try {
            const validationKey = `daily_token_${username}_${deviceFingerprint}`;
            const expiresAt = new Date(Date.now() + (12 * 60 * 60 * 1000)); // 12 horas

            await this.db.saveDailyTokenValidation(validationKey, {
                username: username,
                device_fingerprint: deviceFingerprint,
                validated_at: new Date().toISOString(),
                expires_at: expiresAt.toISOString()
            });

            return true;
        } catch (error) {
            console.error('Erro ao salvar token diário:', error);
            return false;
        }
    }

    // NOVO MÉTODO: Invalidar token diário (logout)
    async invalidateDailyTokenValidation(username, deviceFingerprint) {
        try {
            const validationKey = `daily_token_${username}_${deviceFingerprint}`;
            await this.db.removeDailyTokenValidation(validationKey);
            console.log(`🗑️ Token diário invalidado para ${username} no device ${deviceFingerprint}`);
            return true;
        } catch (error) {
            console.error('Erro ao invalidar token diário:', error);
            return false;
        }
    }

    async updateLastLogin(username) {
        await this.db.updateLastLogin(username.toLowerCase());
    }

    async getUserCredentials(username) {
        const user = await this.db.getUser(username.toLowerCase());

        if (user) {
            return {
                jiraUsername: user.jira_username,
                email: user.email
            };
        }

        return null;
    }

    // === MÉTODOS para CREDENCIAIS JIRA (agora usando PostgreSQL) ===

    async getUserJiraCredentials(username) {
        return await this.db.getUserCredentials(username.toLowerCase());
    }

    async setUserJiraCredentials(username, jiraUsername, apiToken, userId, tempoToken) {
        const credentials = {
            jiraUsername: jiraUsername,
            apiToken: apiToken,
            userId: userId,
            tempoToken: tempoToken || ''
        };

        return await this.db.setUserCredentials(username.toLowerCase(), credentials);
    }

    // === MÉTODOS para PROJETOS (agora usando PostgreSQL) ===

    async getUserProjects(username) {
        return await this.db.getUserProjects(username.toLowerCase());
    }

    async setUserProject(username, projectName, displayName, jiraProjectKey) {
        return await this.db.setUserProject(username.toLowerCase(), projectName, displayName, jiraProjectKey);
    }

    async removeUserProject(username, projectName) {
        return await this.db.removeUserProject(username.toLowerCase(), projectName);
    }

    async close() {
        if (this.db) {
            await this.db.close();
        }
    }
}

module.exports = AuthSystem;