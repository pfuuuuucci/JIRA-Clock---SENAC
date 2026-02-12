
const readline = require('readline');
const axios = require('axios');
const DatabaseSystem = require('./database');

// Criar interface para entrada do usuário
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function askQuestion(question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer.trim());
        });
    });
}

async function getMyUserId() {
    let db;
    let userCredentials = null;
    
    try {
        console.log('🔧 Inicializando conexão com PostgreSQL...');
        
        // Verificar se DATABASE_URL existe
        if (!process.env.DATABASE_URL) {
            console.error('❌ DATABASE_URL não encontrada nas variáveis de ambiente');
            console.log('💡 Certifique-se que o PostgreSQL foi criado no Replit Database');
            rl.close();
            return;
        }
        
        db = new DatabaseSystem();
        
        // Inicializar tabelas se necessário
        await db.initializeTables();
        
        // Perguntar qual usuário buscar
        const username = await askQuestion('👤 Digite o username do usuário para buscar as informações: ');
        
        if (!username) {
            console.error('❌ Username não pode estar vazio');
            rl.close();
            return;
        }
        
        console.log(`🔍 Buscando credenciais para o usuário: ${username}`);
        
        // Buscar credenciais do PostgreSQL para o usuário informado
        userCredentials = await db.getUserCredentials(username);
        
        if (!userCredentials) {
            console.error(`❌ Credenciais do usuário "${username}" não encontradas no PostgreSQL`);
            console.log('💡 Configure as credenciais JIRA na tela de configurações do aplicativo');
            rl.close();
            return;
        }
        
        console.log('🔑 Usando credenciais para:', userCredentials.jira_username);
        console.log('🔍 Diagnóstico das credenciais:');
        console.log('   - JIRA Username:', userCredentials.jira_username);
        console.log('   - API Token (COMPLETO):', userCredentials.api_token);
        console.log('   - API Token (length):', userCredentials.api_token?.length);
        console.log('   - User ID:', userCredentials.user_id);
        console.log('   - Tempo Token configurado:', userCredentials.tempo_token ? 'Sim' : 'Não');
        
        // Mostrar como o token está sendo codificado
        const authString = `${userCredentials.jira_username}:${userCredentials.api_token}`;
        const base64Auth = Buffer.from(authString).toString('base64');
        console.log('');
        console.log('🔐 Processo de autenticação:');
        console.log('   1. String original (username:token):', authString.substring(0, 50) + '...');
        console.log('   2. Base64 encoded:', base64Auth.substring(0, 50) + '...');
        console.log('   3. Authorization header que será enviado:');
        console.log('      Authorization: Basic ' + base64Auth.substring(0, 30) + '...');
        
        // Validar formato do username
        if (!userCredentials.jira_username?.includes('@vertigo.com.br')) {
            console.warn('⚠️  ATENÇÃO: Username JIRA não parece estar no formato correto (email@vertigo.com.br)');
        }
        
        // Validar se API Token parece válido (não vazio, tamanho mínimo)
        if (!userCredentials.api_token || userCredentials.api_token.length < 10) {
            console.error('❌ API Token parece inválido ou muito curto');
            console.log('💡 Um API Token válido do JIRA tem geralmente mais de 20 caracteres');
            rl.close();
            return;
        }
        
        console.log('📡 Tentando autenticar no JIRA...');
        
        const authHeader = `Basic ${Buffer.from(`${userCredentials.jira_username}:${userCredentials.api_token}`).toString('base64')}`;
        const requestConfig = {
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        };
        
        console.log('');
        console.log('📤 Configuração da requisição:');
        console.log('   URL: https://contatot3i.atlassian.net/rest/api/3/myself');
        console.log('   Method: GET');
        console.log('   Headers:', JSON.stringify({
            'Authorization': authHeader.substring(0, 30) + '...',
            'Content-Type': 'application/json'
        }, null, 2));
        console.log('');
        
        const response = await axios.get(
            'https://contatot3i.atlassian.net/rest/api/3/myself',
            requestConfig
        );
        
        console.log('');
        console.log('✅ SUCESSO! Informações do usuário:');
        console.log(JSON.stringify(response.data, null, 2));
        console.log('');
        console.log('📋 Seu User ID é:', response.data.accountId);
        console.log('📧 Email:', response.data.emailAddress);
        console.log('👤 Nome:', response.data.displayName);
        console.log('');
        
    } catch (error) {
        console.error('');
        console.error('❌ ERRO ao autenticar:');
        
        if (error.response) {
            console.error('   Status HTTP:', error.response.status);
            console.error('   Mensagem:', error.response.data?.errorMessages || error.response.statusText);
            
            if (error.response.status === 401) {
                console.error('');
                console.error('💡 ERRO DE AUTENTICAÇÃO:');
                console.error('   1. Verifique se o email/username está correto');
                console.error('   2. Certifique-se de que o API Token foi copiado COMPLETAMENTE');
                console.error('   3. O token deve ter PELO MENOS 20 caracteres');
                console.error('   4. Gere um novo token em: https://id.atlassian.com/manage-profile/security/api-tokens');
            }
        } else if (error.request) {
            console.error('   Erro de conexão - verifique sua internet');
        } else {
            console.error('   Erro:', error.message);
        }
        console.error('');
    }
    
    rl.close();
});

async function getUserCredentials(username) {
    return new Promise((resolve) => {
        const db = new DatabaseSystem();
        
        db.getUserCredentials(username.toLowerCase())
            .then(credentials => {
                db.close();
                resolve(credentials);
            })
            .catch(error => {
                console.error('Erro ao buscar credenciais:', error);
                db.close();
                resolve(null);
            });
    });
}

token || userCredentials.api_ertigobr.atlassian.net/rest/api/3/myself',
            requestConfig
        );

        console.log('=== INFORMAÇÕES DO USUÁRIO ===');
        console.log('Account ID (JIRA_USER_ID):', response.data.accountId);
        console.log('Display Name:', response.data.displayName);
        console.log('Email:', response.data.emailAddress);
        console.log('Username:', response.data.name || 'N/A');
        console.log('================================');
        
        // Verificar se o userId já está correto na tabela
        if (userCredentials.user_id === response.data.accountId) {
            console.log('✅ User ID já está correto no PostgreSQL');
        } else {
            console.log(`⚠️  User ID na tabela: ${userCredentials.user_id}`);
            console.log(`⚠️  User ID real: ${response.data.accountId}`);
            console.log('💡 Atualize o User ID na tela de configurações do aplicativo');
        }
        
        rl.close();
        return response.data.accountId;
        
    } catch (error) {
        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            console.error('❌ Erro de conexão com PostgreSQL:', error.message);
            console.log('💡 Soluções possíveis:');
            console.log('   1. Certifique-se que o PostgreSQL foi criado no Replit Database');
            console.log('   2. Verifique se DATABASE_URL está definida corretamente');
            console.log('   3. Aguarde alguns segundos - o banco pode estar "dormindo"');
        } else if (error.response?.data || error.response?.status) {
            console.error('❌ Erro ao buscar informações do usuário:', error.response?.data || error.message);
            
            if (error.response?.status === 401) {
                console.log('💡 Erro de autenticação (401 Unauthorized) - possíveis causas:');
                console.log('   1. ❌ API Token INVÁLIDO ou EXPIRADO');
                console.log('      → Gere um novo token em: https://id.atlassian.com/manage-profile/security/api-tokens');
                console.log('   2. ❌ Username JIRA incorreto');
                console.log('      → Deve ser o email completo: nome.sobrenome@vertigo.com.br');
                console.log('   3. 🔧 Como corrigir:');
                console.log('      → Acesse http://localhost:5000/config.html');
                console.log('      → Clique em "Configurações"');
                console.log('      → Atualize o "JIRA API Token" com um token NOVO e VÁLIDO');
                console.log('');
                if (userCredentials) {
                    console.log('📋 Credenciais atuais no banco:');
                    console.log(`   - Username: ${userCredentials.jira_username}`);
                    console.log(`   - Token configurado em: ${new Date(userCredentials.updated_at || Date.now()).toLocaleString('pt-BR')}`);
                }
            } else if (error.response?.status === 403) {
                console.log('💡 Erro de permissão (403 Forbidden):');
                console.log('   → O usuário não tem permissão para acessar o JIRA');
                console.log('   → Verifique se a conta está ativa no JIRA da Vertigo');
            }
        } else {
            console.error('❌ Erro geral:', error.message);
            console.error('Stack:', error.stack);
        }
    } finally {
        // Fechar conexão com o banco se foi criada
        if (db) {
            try {
                await db.close();
            } catch (closeError) {
                console.warn('⚠️ Erro ao fechar conexão:', closeError.message);
            }
        }
        
        // Garantir que a interface readline seja fechada
        rl.close();
    }
}

// Executar a função
getMyUserId();
