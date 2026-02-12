const express = require('express');
const path = require('path');
const fs = require('fs');
const JiraIntegration = require('./jira-integration');
const UserJiraIntegration = require('./user-jira-integration');
const AuthSystem = require('./auth');

const app = express();
const jiraIntegration = new JiraIntegration(); // Manter para compatibilidade
const userJiraIntegration = new UserJiraIntegration();
let authSystem;
const PORT = process.env.PORT || 5000;

// API Routes (adicionar após as outras rotas)
const backupRoutes = require('./server/routes/backupRoutes');
app.use('/api/backup', backupRoutes);

// Inicializar AuthSystem e fazer migração de dados
async function initializeApp() {
  try {
    console.log('🔧 Inicializando aplicação com PostgreSQL...');
    authSystem = new AuthSystem();
    await authSystem.initializeDatabase();
    console.log('✅ Database PostgreSQL inicializado');

    // Verificar se é a primeira execução e fazer migração
    const user = await authSystem.db.getUser('pfucci');
    if (!user) {
      console.log('🔄 Primeira execução detectada - executando migração...');
      await authSystem.migrateData();
      console.log('✅ Migração automática concluída');
    }



  } catch (error) {
    console.error('❌ Erro ao inicializar aplicação:', error);
    console.error('💡 Certifique-se que o PostgreSQL foi criado no Replit');
    process.exit(1);
  }
}

// Middleware para garantir que o sistema foi inicializado
const ensureInitialized = (req, res, next) => {
  if (!authSystem) {
    return res.status(503).json({
      success: false,
      message: 'Sistema ainda inicializando. Aguarde alguns segundos.'
    });
  }
  next();
};

// Middleware para JSON
app.use(express.json());

// Aplicar middleware de inicialização em todas as rotas da API
app.use('/api', ensureInitialized);

// Disable caching
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// Servir arquivos estáticos da pasta public
app.use(express.static('public'));

// Servir versao.json explicitamente
app.get('/versao.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'versao.json'));
});

// Route for the main app
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route for config page
app.get('/config.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'config.html'));
});

// Route for login page
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// === ROTAS DE AUTENTICAÇÃO ===

// Verificar usuário e enviar token se necessário
app.post('/api/auth/check-user', async (req, res) => {
  try {
    const { username, deviceFingerprint } = req.body;

    if (!username) {
      return res.status(400).json({
        success: false,
        message: 'Username é obrigatório'
      });
    }

    const result = await authSystem.checkUser(username, deviceFingerprint);

    res.status(200).json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Erro ao verificar usuário:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// Validar token de autenticação
app.post('/api/auth/validate-token', async (req, res) => {
  try {
    const { username, token, deviceFingerprint } = req.body;

    if (!username || !token) {
      return res.status(400).json({
        success: false,
        message: 'Username e token são obrigatórios'
      });
    }

    const result = await authSystem.validateToken(username, token, deviceFingerprint);

    if (result.valid) {
      res.status(200).json({
        success: true,
        data: result,
        message: result.message
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }

  } catch (error) {
    console.error('Erro ao validar token:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// Obter informações do usuário atual
app.get('/api/auth/current-user', (req, res) => {
  try {
    const username = req.headers['x-user-id']; // Será enviado pelo frontend

    if (!username) {
      return res.status(401).json({
        success: false,
        message: 'Usuário não autenticado'
      });
    }

    const credentials = authSystem.getUserCredentials(username);

    if (!credentials) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado'
      });
    }

    // Atualizar último login
    authSystem.updateLastLogin(username);

    res.status(200).json({
      success: true,
      data: credentials
    });

  } catch (error) {
    console.error('Erro ao obter usuário atual:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// Rota para analisar dados da fala (sem registrar)
app.post('/api/parse-voice', async (req, res) => {
  try {
    const username = req.headers['x-user-id'];
    const { voiceText } = req.body;

    if (!username) {
      return res.status(401).json({
        success: false,
        message: 'Usuário não autenticado'
      });
    }

    if (!voiceText) {
      return res.status(400).json({
        success: false,
        message: 'Texto de voz é obrigatório'
      });
    }

    // Verificar se usuário tem credenciais configuradas
    const userCredentials = await authSystem.getUserJiraCredentials(username);
    if (!userCredentials) {
      return res.status(400).json({
        success: false,
        message: 'Usuário precisa configurar credenciais JIRA primeiro',
        needsCredentials: true
      });
    }

    // Usar integração específica do usuário
    const parsedData = await userJiraIntegration.parseVoiceInput(username, voiceText);

    res.status(200).json({
      success: true,
      parsedData,
      suggestedTickets: parsedData.suggestedTickets || [],
      message: 'Dados extraídos com sucesso'
    });

  } catch (error) {
    console.error('Erro na análise:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
});

// Rota para registrar apontamento com dados já validados e ticket selecionado
app.post('/api/log-work', async (req, res) => {
  try {
    const username = req.headers['x-user-id'];
    const { parsedData } = req.body;

    console.log('🔥 [LOG-WORK] Iniciando registro de apontamento para usuário:', username);
    console.log('🔥 [LOG-WORK] Dados recebidos:', JSON.stringify(parsedData, null, 2));

    if (!username) {
      return res.status(401).json({
        success: false,
        message: 'Usuário não autenticado'
      });
    }

    if (!parsedData) {
      return res.status(400).json({
        success: false,
        message: 'Dados do apontamento são obrigatórios'
      });
    }

    // Verificar se usuário tem credenciais configuradas
    const userCredentials = await authSystem.getUserJiraCredentials(username);
    if (!userCredentials) {
      return res.status(400).json({
        success: false,
        message: 'Usuário precisa configurar credenciais JIRA primeiro',
        needsCredentials: true
      });
    }

    console.log('🔥 [LOG-WORK] Credenciais encontradas para usuário:', userCredentials.jira_username);

    // TESTE DE CONECTIVIDADE: Verificar se as credenciais estão funcionando
    try {
      console.log('🔍 [LOG-WORK] Testando conectividade com JIRA...');
      const axios = require('axios');
      const authHeader = `Basic ${Buffer.from(`${userCredentials.jira_username}:${userCredentials.api_token}`).toString('base64')}`;

      const myselfResponse = await axios.get(
        'https://contatot3i.atlassian.net/rest/api/3/myself',
        {
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log('✅ [LOG-WORK] Conectividade OK - Usuário autenticado:', {
        accountId: myselfResponse.data.accountId,
        emailAddress: myselfResponse.data.emailAddress,
        displayName: myselfResponse.data.displayName
      });

    } catch (connectError) {
      console.error('❌ [LOG-WORK] FALHA na conectividade com JIRA:');
      console.error(`   - Status: ${connectError.response?.status}`);
      console.error(`   - Data:`, connectError.response?.data);

      return res.status(400).json({
        success: false,
        message: 'Falha na autenticação com JIRA. Verifique suas credenciais.',
        error: connectError.response?.data,
        needsCredentials: true
      });
    }

    // Verificar se há ticket selecionado
    const selectedTicket = parsedData.selectedTicket || parsedData.autoSelectedTicket;
    if (!selectedTicket || !selectedTicket.key) {
      return res.status(400).json({
        success: false,
        message: 'Nenhum ticket foi selecionado para o apontamento'
      });
    }

    // PROTEÇÃO RIGOROSA: SEMPRE deve ter aprovação explícita
    if (!parsedData.description && !parsedData.useTicketSummary) {
      console.log('🚨 [BACKEND] BLOQUEANDO registro sem aprovação explícita - falta descrição ou flag useTicketSummary');
      return res.status(400).json({
        success: false,
        message: 'Apontamento deve passar pela aprovação explícita primeiro (com ou sem descrição)',
        needsApproval: true
      });
    }

    // PROTEÇÃO EXTRA: Se tem autoSelectedTicket mas não tem flags de aprovação
    if (parsedData.autoSelectedTicket && !parsedData.description && !parsedData.useTicketSummary) {
      console.log('🚨 [BACKEND] BLOQUEANDO auto-seleção sem aprovação');
      return res.status(400).json({
        success: false,
        message: 'Ticket auto-selecionado deve passar pela aprovação explícita',
        needsApproval: true
      });
    }

    console.log('🔥 [LOG-WORK] Ticket para apontamento:', selectedTicket.key);

    // Verificar permissões no ticket antes de tentar registrar apontamento
    try {
      console.log('🔥 [LOG-WORK] Verificando acesso ao ticket...');
      console.log('🔑 [LOG-WORK] Credenciais sendo usadas:');
      console.log(`   - Username: ${userCredentials.jira_username}`);
      console.log(`   - Token: ${userCredentials.api_token.substring(0, 10)}...`);
      console.log(`   - Ticket: ${selectedTicket.key}`);

      const axios = require('axios');
      const authHeader = `Basic ${Buffer.from(`${userCredentials.jira_username}:${userCredentials.api_token}`).toString('base64')}`;
      console.log(`🔑 [LOG-WORK] Authorization header: Basic ${authHeader.substring(6, 20)}...`);

      const ticketCheckResponse = await axios.get(
        `https://contatot3i.atlassian.net/rest/api/3/issue/${selectedTicket.key}`,
        {
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log('✅ [LOG-WORK] Ticket acessível:', ticketCheckResponse.data.key);
      console.log('📋 [LOG-WORK] Ticket data:', {
        key: ticketCheckResponse.data.key,
        summary: ticketCheckResponse.data.fields?.summary,
        status: ticketCheckResponse.data.fields?.status?.name,
        project: ticketCheckResponse.data.fields?.project?.key
      });
    } catch (ticketError) {
      console.error('❌ [LOG-WORK] ERRO DETALHADO ao acessar ticket:');
      console.error(`   - Status: ${ticketError.response?.status}`);
      console.error(`   - URL tentada: https://contatot3i.atlassian.net/rest/api/3/issue/${selectedTicket.key}`);
      console.error(`   - Response data:`, ticketError.response?.data);
      console.error(`   - Headers enviados:`, ticketError.config?.headers);

      let errorMessage = 'Erro ao acessar o ticket';
      if (ticketError.response?.status === 404) {
        errorMessage = `Ticket ${selectedTicket.key} não encontrado ou você não tem permissão para acessá-lo`;

        // Tentar buscar o ticket por JQL para verificar se existe
        try {
          console.log('🔍 [LOG-WORK] Tentando buscar ticket via JQL...');
          const axios = require('axios');
          const jqlResponse = await axios.get(
            `https://contatot3i.atlassian.net/rest/api/3/search`,
            {
              params: {
                jql: `key = ${selectedTicket.key}`,
                fields: 'summary,status,project'
              },
              headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json'
              }
            }
          );

          console.log('🔍 [LOG-WORK] Resultado JQL:', {
            total: jqlResponse.data.total,
            issues: jqlResponse.data.issues.length
          });

          if (jqlResponse.data.total === 0) {
            errorMessage = `Ticket ${selectedTicket.key} não existe no JIRA`;
          } else {
            errorMessage = `Ticket ${selectedTicket.key} existe mas você não tem permissão direta para acessá-lo`;
          }
        } catch (jqlError) {
          console.error('❌ [LOG-WORK] Erro na busca JQL:', jqlError.response?.data);
        }

      } else if (ticketError.response?.status === 403) {
        errorMessage = `Sem permissão para acessar o ticket ${selectedTicket.key}`;
      } else if (ticketError.response?.data?.errorMessages) {
        errorMessage = ticketError.response.data.errorMessages.join(', ');
      }

      return res.status(400).json({
        success: false,
        message: errorMessage,
        ticketKey: selectedTicket.key,
        debugInfo: {
          status: ticketError.response?.status,
          data: ticketError.response?.data,
          username: userCredentials.jira_username
        }
      });
    }

    // Registrar o apontamento usando credenciais do usuário
    const result = await userJiraIntegration.logWorkTime(username, parsedData);

    console.log('🔥 [LOG-WORK] Resultado do registro:', result);

    if (result.success) {
      // Retornar dados completos
      res.status(200).json({
        ...result,
        parsedData: parsedData,
        worklogId: result.data?.id || result.worklogId,
        jiraCode: selectedTicket.key
      });
    } else {
      res.status(400).json(result);
    }

  } catch (error) {
    console.error('Erro ao registrar apontamento:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
});

// Rota para consultar apontamentos por data
app.post('/api/consulta-apontamentos', async (req, res) => {
  try {
    const username = req.headers['x-user-id'];
    const { date } = req.body;

    if (!username) {
      return res.status(401).json({
        success: false,
        message: 'Usuário não autenticado'
      });
    }

    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'Data é obrigatória'
      });
    }

    console.log(`🔍 [CONSULTA] Buscando apontamentos para ${username} na data ${date}`);

    // Buscar apontamentos do usuário na data especificada
    const worklogs = await userJiraIntegration.getWorklogsForDate(username, date);

    console.log(`📋 [CONSULTA] Encontrados ${worklogs.length} apontamentos`);

    res.status(200).json({
      success: true,
      worklogs: worklogs,
      date: date,
      count: worklogs.length
    });

  } catch (error) {
    console.error('❌ [CONSULTA] Erro:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
});

// Rota para carregar favoritos
app.get('/api/favorites', async (req, res) => {
  try {
    const username = req.headers['x-user-id'];

    if (!username) {
      return res.status(401).json({
        success: false,
        message: 'Usuário não autenticado'
      });
    }

    const favorites = await authSystem.db.getUserFavorites(username);

    res.status(200).json({
      success: true,
      favorites: favorites
    });

  } catch (error) {
    console.error('Erro ao carregar favoritos:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao carregar favoritos'
    });
  }
});

// Rota para adicionar favorito
app.post('/api/favorites', async (req, res) => {
  try {
    const username = req.headers['x-user-id'];
    const { ticket } = req.body;

    if (!username) {
      return res.status(401).json({
        success: false,
        message: 'Usuário não autenticado'
      });
    }

    if (!ticket || !ticket.key) {
      return res.status(400).json({
        success: false,
        message: 'Dados do ticket são obrigatórios'
      });
    }

    // Verificar se já existe
    const existingFavorites = await authSystem.db.getUserFavorites(username);
    const exists = existingFavorites.some(fav => fav.key === ticket.key);

    if (exists) {
      return res.status(400).json({
        success: false,
        message: 'Ticket já está nos favoritos'
      });
    }

    // Adicionar novo favorito
    const success = await authSystem.db.addUserFavorite(username, ticket);

    if (!success) {
      return res.status(500).json({
        success: false,
        message: 'Erro ao salvar favorito no banco'
      });
    }

    // Obter lista atualizada
    const updatedFavorites = await authSystem.db.getUserFavorites(username);

    console.log(`✅ Ticket ${ticket.key} adicionado aos favoritos do usuário ${username}`);

    res.status(200).json({
      success: true,
      message: `Ticket ${ticket.key} adicionado aos favoritos`,
      favorites: updatedFavorites
    });

  } catch (error) {
    console.error('Erro ao adicionar favorito:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao salvar favorito'
    });
  }
});

// Rota para remover favorito
app.delete('/api/favorites/:ticketKey', async (req, res) => {
  try {
    const username = req.headers['x-user-id'];
    const { ticketKey } = req.params;

    if (!username) {
      return res.status(401).json({
        success: false,
        message: 'Usuário não autenticado'
      });
    }

    // Remover favorito do banco
    const success = await authSystem.db.removeUserFavorite(username, ticketKey);

    if (!success) {
      return res.status(404).json({
        success: false,
        message: 'Ticket não encontrado nos favoritos'
      });
    }

    // Obter lista atualizada
    const updatedFavorites = await authSystem.db.getUserFavorites(username);

    console.log(`❌ Ticket ${ticketKey} removido dos favoritos do usuário ${username}`);

    res.status(200).json({
      success: true,
      message: `Ticket ${ticketKey} removido dos favoritos`,
      favorites: updatedFavorites
    });

  } catch (error) {
    console.error('Erro ao remover favorito:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao remover favorito'
    });
  }
});

// Rota para buscar favoritos por projeto
app.get('/api/favorites/by-project/:projectKey', async (req, res) => {
  try {
    const username = req.headers['x-user-id'];
    const projectKey = req.params.projectKey;
    const favorites = await authSystem.db.getUserFavoritesByProject(username, projectKey);

    console.log(`📋 Favoritos encontrados para ${username} no projeto ${projectKey}:`, favorites.length);

    res.json({
      success: true,
      favorites: favorites
    });
  } catch (error) {
    console.error('Erro ao carregar favoritos por projeto:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao carregar favoritos por projeto'
    });
  }
});


// === ROTAS PARA CONFIGURAÇÃO ===

// Rota para carregar configuração atual do usuário
app.get('/api/config', async (req, res) => {
  try {
    const username = req.headers['x-user-id'];

    if (!username) {
      return res.status(401).json({
        success: false,
        message: 'Usuário não autenticado'
      });
    }

    const userCredentials = await authSystem.getUserJiraCredentials(username);

    res.status(200).json({
      success: true,
      credentials: {
        username: userCredentials ? userCredentials.jira_username.split('@')[0] : '',
        userId: userCredentials ? userCredentials.user_id : '',
        hasCredentials: !!userCredentials
      }
    });
  } catch (error) {
    console.error('Erro ao carregar configuração:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao carregar configuração'
    });
  }
});

// Rota para salvar credenciais do usuário
app.post('/api/config/credentials', async (req, res) => {
  try {
    const username = req.headers['x-user-id'];
    const { username: jiraUser, apiToken, userId, tempoToken } = req.body;

    if (!username) {
      return res.status(401).json({
        success: false,
        message: 'Usuário não autenticado'
      });
    }

    if (!jiraUser || !apiToken || !userId) {
      return res.status(400).json({
        success: false,
        message: 'Username, API Token e User ID são obrigatórios'
      });
    }

    const jiraUsername = jiraUser;

    const success = await authSystem.setUserJiraCredentials(
      username,
      jiraUsername,
      apiToken,
      userId,
      tempoToken
    );

    if (success) {
      console.log(`✅ Credenciais salvas para usuário: ${username}`);

      res.status(200).json({
        success: true,
        message: 'Credenciais salvas com sucesso'
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Erro ao salvar credenciais'
      });
    }

  } catch (error) {
    console.error('Erro ao salvar credenciais:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao salvar credenciais'
    });
  }
});

// Rota para carregar projetos do usuário
app.get('/api/config/projects', async (req, res) => {
  try {
    const username = req.headers['x-user-id'];

    if (!username) {
      return res.status(401).json({
        success: false,
        message: 'Usuário não autenticado'
      });
    }

    const userProjects = await authSystem.getUserProjects(username);

    const projects = Object.entries(userProjects).map(([key, value]) => ({
      name: key,
      displayName: value.displayName,
      jiraProjectKey: value.jiraProjectKey,
      searchProject: value.searchProject
    }));

    res.status(200).json({
      success: true,
      projects: projects
    });

  } catch (error) {
    console.error('Erro ao carregar projetos:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao carregar projetos'
    });
  }
});

// Rota para adicionar projeto do usuário
app.post('/api/config/projects', async (req, res) => {
  try {
    const username = req.headers['x-user-id'];
    const { name, displayName, jiraProjectKey } = req.body;

    if (!username) {
      return res.status(401).json({
        success: false,
        message: 'Usuário não autenticado'
      });
    }

    if (!name || !displayName || !jiraProjectKey) {
      return res.status(400).json({
        success: false,
        message: 'Todos os campos são obrigatórios'
      });
    }

    const userProjects = await authSystem.getUserProjects(username);

    // Verificar se já existe
    if (userProjects[name]) {
      return res.status(400).json({
        success: false,
        message: 'Projeto já existe'
      });
    }

    // Adicionar novo projeto
    const success = await authSystem.setUserProject(username, name, displayName, jiraProjectKey);

    if (success) {
      console.log(`✅ Projeto ${name} adicionado para usuário ${username}`);

      res.status(200).json({
        success: true,
        message: `Projeto ${name} adicionado com sucesso`
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Erro ao adicionar projeto'
      });
    }

  } catch (error) {
    console.error('Erro ao adicionar projeto:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao adicionar projeto'
    });
  }
});

// Rota para remover projeto do usuário
app.delete('/api/config/projects/:projectName', (req, res) => {
  try {
    const username = req.headers['x-user-id'];
    const { projectName } = req.params;

    console.log(`🗑️ [DELETE-PROJECT] Tentativa de remoção:`);
    console.log(`   - Username do header: "${username}"`);
    console.log(`   - Project Name: "${projectName}"`);
    console.log(`   - Headers recebidos:`, Object.keys(req.headers));

    if (!username || username.trim() === '') {
      console.log(`❌ [DELETE-PROJECT] Username vazio ou não fornecido`);
      return res.status(401).json({
        success: false,
        message: 'Usuário não autenticado - header x-user-id não encontrado'
      });
    }

    // Verificar se usuário existe no sistema
    const userCredentials = authSystem.getUserCredentials(username);
    if (!userCredentials) {
      console.log(`❌ [DELETE-PROJECT] Usuário ${username} não encontrado no sistema`);
      return res.status(401).json({
        success: false,
        message: 'Usuário não encontrado no sistema'
      });
    }

    console.log(`✅ [DELETE-PROJECT] Usuário ${username} autenticado, removendo projeto ${projectName}`);

    const success = authSystem.removeUserProject(username, projectName);

    if (success) {
      console.log(`✅ [DELETE-PROJECT] Projeto ${projectName} removido para usuário ${username}`);

      res.status(200).json({
        success: true,
        message: `Projeto ${projectName} removido com sucesso`
      });
    } else {
      console.log(`❌ [DELETE-PROJECT] Projeto ${projectName} não encontrado para usuário ${username}`);
      res.status(404).json({
        success: false,
        message: 'Projeto não encontrado'
      });
    }

  } catch (error) {
    console.error('❌ [DELETE-PROJECT] Erro ao remover projeto:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno ao remover projeto'
    });
  }
});

// Função para atualizar o projectMapping no jira-integration.js
function updateJiraIntegrationProjects(projectMapping) {
  try {
    const jiraIntegrationPath = path.join(__dirname, 'jira-integration.js');
    let fileContent = fs.readFileSync(jiraIntegrationPath, 'utf8');

    // Gerar o código do mapeamento
    const mappingCode = `this.projectMapping = ${JSON.stringify(projectMapping, null, 12)};`;

    // Substituir o projectMapping existente
    const regex = /this\.projectMapping\s*=\s*\{[\s\S]*?\};/;

    if (regex.test(fileContent)) {
      fileContent = fileContent.replace(regex, mappingCode);
    } else {
      console.warn('⚠️ Não foi possível encontrar projectMapping no jira-integration.js');
      return;
    }

    fs.writeFileSync(jiraIntegrationPath, fileContent);
    console.log('✅ jira-integration.js atualizado com novos projetos');

  } catch (error) {
    console.error('Erro ao atualizar jira-integration.js:', error);
  }
}

// === ROTAS PARA DESCRIÇÕES FAVORITAS ===

// Rota para carregar descrições favoritas POR USUÁRIO
app.get('/api/favorite-descriptions', async (req, res) => {
  try {
    const username = req.headers['x-user-id'];

    if (!username) {
      return res.status(401).json({
        success: false,
        message: 'Usuário não autenticado'
      });
    }

    let userDescriptions = await authSystem.db.getUserFavoriteDescriptions(username);

    // Se usuário não tem descrições, criar padrão
    if (userDescriptions.length === 0) {
      const defaultDescriptions = [
        "Reuniões de alinhamento e status",
        "Desenvolvimento de funcionalidades",
        "Correção de bugs e melhorias",
        "Análise e planejamento técnico",
        "Documentação e especificações",
        "Testes e validações",
        "Deploy e configurações",
        "Revisão de código",
        "Gestão de atividades e controle",
        "Preenchimento de avaliações"
      ];

      // Adicionar descrições padrão para o usuário
      for (const desc of defaultDescriptions) {
        await authSystem.db.addUserFavoriteDescription(username, desc);
      }

      userDescriptions = defaultDescriptions;
    }

    res.status(200).json({
      success: true,
      descriptions: userDescriptions
    });

  } catch (error) {
    console.error('Erro ao carregar descrições favoritas:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao carregar descrições favoritas'
    });
  }
});

// Rota para adicionar descrição favorita POR USUÁRIO (preservando case exato)
app.post('/api/favorite-descriptions', async (req, res) => {
  try {
    const username = req.headers['x-user-id'];
    const { description } = req.body;

    if (!username) {
      return res.status(401).json({
        success: false,
        message: 'Usuário não autenticado'
      });
    }

    if (!description || description.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Descrição é obrigatória'
      });
    }

    // PRESERVAR case EXATO como digitado pelo usuário
    const exactDescription = description.trim();

    // Verificar se já existe (case-insensitive)
    const userDescriptions = await authSystem.db.getUserFavoriteDescriptions(username);
    const exists = userDescriptions.some(
      desc => desc.toLowerCase() === exactDescription.toLowerCase()
    );

    if (exists) {
      return res.status(400).json({
        success: false,
        message: 'Descrição já existe nos favoritos'
      });
    }

    // Adicionar nova descrição preservando case EXATO
    const success = await authSystem.db.addUserFavoriteDescription(username, exactDescription);

    if (!success) {
      return res.status(500).json({
        success: false,
        message: 'Erro ao salvar descrição no banco'
      });
    }

    // Obter lista atualizada
    const updatedDescriptions = await authSystem.db.getUserFavoriteDescriptions(username);

    console.log(`✅ Nova descrição adicionada aos favoritos do usuário ${username}: "${exactDescription}"`);

    res.status(200).json({
      success: true,
      message: `Descrição adicionada aos favoritos`,
      descriptions: updatedDescriptions
    });

  } catch (error) {
    console.error('Erro ao adicionar descrição favorita:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao salvar descrição favorita'
    });
  }
});

// Rota para remover descrição favorita POR USUÁRIO
app.delete('/api/favorite-descriptions/:index', async (req, res) => {
  try {
    const username = req.headers['x-user-id'];
    const { index } = req.params;

    if (!username) {
      return res.status(401).json({
        success: false,
        message: 'Usuário não autenticado'
      });
    }

    const descIndex = parseInt(index);

    if (isNaN(descIndex) || descIndex < 0) {
      return res.status(404).json({
        success: false,
        message: 'Índice de descrição inválido'
      });
    }

    // Remover descrição por índice
    const success = await authSystem.db.removeUserFavoriteDescriptionByIndex(username, descIndex);

    if (!success) {
      return res.status(404).json({
        success: false,
        message: 'Descrição não encontrada ou índice inválido'
      });
    }

    // Obter lista atualizada
    const updatedDescriptions = await authSystem.db.getUserFavoriteDescriptions(username);

    console.log(`❌ Descrição removida dos favoritos do usuário ${username} (índice ${descIndex})`);

    res.status(200).json({
      success: true,
      message: `Descrição removida dos favoritos`,
      descriptions: updatedDescriptions
    });

  } catch (error) {
    console.error('Erro ao remover descrição favorita:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao remover descrição favorita'
    });
  }
});

// Rota para excluir worklog
app.delete('/api/delete-worklog', async (req, res) => {
  try {
    const username = req.headers['x-user-id'];
    const { worklogId } = req.body;

    console.log(`🗑️ [DELETE-WORKLOG] Iniciando exclusão do worklog ${worklogId} para usuário: ${username}`);

    if (!username) {
      return res.status(401).json({
        success: false,
        message: 'Usuário não autenticado'
      });
    }

    if (!worklogId) {
      return res.status(400).json({
        success: false,
        message: 'ID do worklog é obrigatório'
      });
    }

    // Verificar credenciais do usuário
    const userCredentials = await authSystem.getUserJiraCredentials(username);
    if (!userCredentials) {
      return res.status(400).json({
        success: false,
        message: 'Usuário precisa configurar credenciais primeiro',
        needsCredentials: true
      });
    }

    console.log(`✅ [DELETE-WORKLOG] Credenciais encontradas para: ${userCredentials.jira_username}`);

    // Excluir via API do Tempo
    const result = await userJiraIntegration.deleteWorklog(username, worklogId);

    if (result.success) {
      console.log(`✅ [DELETE-WORKLOG] Worklog ${worklogId} excluído com sucesso`);
      res.status(200).json(result);
    } else {
      console.log(`❌ [DELETE-WORKLOG] Falha ao excluir worklog ${worklogId}: ${result.message}`);
      res.status(400).json(result);
    }

  } catch (error) {
    console.error('❌ [DELETE-WORKLOG] Erro completo:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
});

// Rota para buscar tickets no JIRA
app.post('/api/search-tickets', async (req, res) => {
  try {
    const username = req.headers['x-user-id'];
    const { project, keywords } = req.body;

    console.log(`🔍 [SEARCH-TICKETS] Iniciando busca para usuário: ${username}`);
    console.log(`📋 [SEARCH-TICKETS] Projeto: ${project}, Palavras-chave: ${keywords}`);

    if (!username) {
      console.log('❌ [SEARCH-TICKETS] Usuário não autenticado');
      return res.status(401).json({
        success: false,
        message: 'Usuário não autenticado'
      });
    }

    if (!project || !keywords) {
      console.log('❌ [SEARCH-TICKETS] Projeto ou palavras-chave ausentes');
      return res.status(400).json({
        success: false,
        message: 'Projeto e palavras-chave são obrigatórios'
      });
    }

    // Verificar se usuário tem credenciais configuradas
    const userCredentials = await authSystem.getUserJiraCredentials(username);
    if (!userCredentials) {
      console.log('❌ [SEARCH-TICKETS] Usuário sem credenciais JIRA');
      return res.status(400).json({
        success: false,
        message: 'Usuário precisa configurar credenciais JIRA primeiro',
        needsCredentials: true
      });
    }

    console.log(`✅ [SEARCH-TICKETS] Credenciais encontradas para: ${userCredentials.jira_username}`);

    // Obter projetos do usuário
    const userProjects = await authSystem.getUserProjects(username);
    console.log(`📋 [SEARCH-TICKETS] Projetos do usuário:`, Object.keys(userProjects));

    // Mapear projeto para chave JIRA
    const projectMapping = userProjects[project];
    if (!projectMapping) {
      console.log(`❌ [SEARCH-TICKETS] Projeto ${project} não encontrado nos projetos do usuário`);
      return res.status(400).json({
        success: false,
        message: `Projeto ${project} não encontrado`,
        tickets: []
      });
    }

    console.log(`✅ [SEARCH-TICKETS] Projeto mapeado:`, projectMapping);

    // Implementar busca usando as credenciais do usuário
    const axios = require('axios');
    const baseURL = 'https://contatot3i.atlassian.net';

    // Buscar tickets no JIRA
    const jql = `project = "${projectMapping.jiraProjectKey}" AND status != "Concluído" ORDER BY updated DESC`;
    console.log(`🔍 [SEARCH-TICKETS] JQL: ${jql}`);

    const authString = Buffer.from(`${userCredentials.jira_username}:${userCredentials.api_token}`).toString('base64');
    console.log(`🔑 [SEARCH-TICKETS] Auth configurado para: ${userCredentials.jira_username}`);

    const response = await axios.get(
      `${baseURL}/rest/api/3/search/jql`,
      {
        params: {
          jql: jql,
          maxResults: 50,
          fields: 'summary,status,assignee,description'
        },
        headers: {
          'Authorization': `Basic ${authString}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      }
    );

    console.log(`✅ [SEARCH-TICKETS] Resposta JIRA recebida. Status: ${response.status}`);
    console.log(`📊 [SEARCH-TICKETS] Total de issues retornadas: ${response.data.issues.length}`);
    console.log(`📋 [SEARCH-TICKETS] Total de issues encontradas: ${response.data.issues.length}`);

    // Verificar se o projeto existe fazendo uma busca mais ampla
    if (response.data.issues.length === 0) {
      console.log(`⚠️ [SEARCH-TICKETS] ZERO tickets encontrados. Testando se o projeto existe...`);

      try {
        const testJql = `project = "${projectMapping.jiraProjectKey}"`;
        console.log(`🔍 [SEARCH-TICKETS] Teste com JQL mais amplo: ${testJql}`);

        const testResponse = await axios.get(
          `${baseURL}/rest/api/3/search/jql`,
          {
            params: {
              jql: testJql,
              maxResults: 5,
              fields: 'summary,status'
            },
            headers: {
              'Authorization': `Basic ${authString}`,
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            }
          }
        );

        console.log(`📊 [SEARCH-TICKETS] Teste amplo - Total: ${testResponse.data.issues.length}`);
        if (testResponse.data.issues.length > 0) {
          console.log(`📋 [SEARCH-TICKETS] Tickets encontrados no teste amplo:`,
            testResponse.data.issues.map(i => `${i.key}: ${i.fields.summary} (${i.fields.status.name})`));
        }
      } catch (testError) {
        console.error(`❌ [SEARCH-TICKETS] Erro no teste amplo:`, testError.response?.data || testError.message);
      }
    }

    let allTickets = response.data.issues.map(issue => ({
      key: issue.key,
      summary: issue.fields.summary,
      status: issue.fields.status.name,
      assignee: issue.fields.assignee?.displayName || 'Não atribuído',
      description: issue.fields.description || ''
    }));

    console.log(`📋 [SEARCH-TICKETS] Tickets mapeados:`, allTickets.map(t => `${t.key}: ${t.summary}`));

    // Filtrar por palavras-chave
    const keywordArray = keywords.toLowerCase().split(/\s+/).filter(k => k.length > 2);
    console.log(`🔍 [SEARCH-TICKETS] Palavras-chave para filtro:`, keywordArray);

    const filteredTickets = allTickets.filter(ticket => {
      const ticketText = `${ticket.summary} ${ticket.description}`.toLowerCase();
      const matches = keywordArray.some(keyword => {
        const wordRegex = new RegExp(`\\b${keyword}\\b`, 'i');
        return wordRegex.test(ticketText);
      });

      if (matches) {
        console.log(`✅ [SEARCH-TICKETS] Ticket corresponde: ${ticket.key} - ${ticket.summary}`);
      }

      return matches;
    });

    console.log(`📋 [SEARCH-TICKETS] RESULTADO FINAL - Total encontrados: ${allTickets.length}, Filtrados: ${filteredTickets.length}`);

    res.json({
      success: true,
      tickets: filteredTickets.slice(0, 10),
      total: filteredTickets.length,
      allTicketsCount: allTickets.length
    });

  } catch (error) {
    console.error('❌ [SEARCH-TICKETS] Erro completo na busca de tickets:', error);
    console.error('❌ [SEARCH-TICKETS] Stack trace:', error.stack);
    console.error('❌ [SEARCH-TICKETS] Response data:', error.response?.data);
    console.error('❌ [SEARCH-TICKETS] Response status:', error.response?.status);

    res.json({
      success: false,
      message: `Erro ao buscar tickets no JIRA: ${error.message}`,
      tickets: [],
      error: error.message,
      errorDetails: error.response?.data
    });
  }
});




// Middleware para autenticação
const authenticateUser = (req, res, next) => {
  const userId = req.headers['x-user-id'];

  if (!userId) {
    return res.status(401).json({ success: false, message: 'Usuário não autenticado' });
  }

  req.user = { username: userId }; // Assumindo que x-user-id é o username
  next();
};


// Inicializar aplicação e depois o servidor
initializeApp().then(() => {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 PWA Server running on port ${PORT} with PostgreSQL`);
    console.log(`✅ Database connection: READY`);
    console.log(`📊 All data is now persistent in PostgreSQL!`);
  });

  // Handler para shutdown gracioso
  const gracefulShutdown = (signal) => {
    console.log(`\n🛑 ${signal} recebido. Encerrando servidor...`);
    
    server.close(() => {
      console.log('✅ Servidor HTTP encerrado');
      
      // Fechar conexão com banco de dados
      if (authSystem && authSystem.db && authSystem.db.pool) {
        authSystem.db.pool.end(() => {
          console.log('✅ Conexão com PostgreSQL encerrada');
          process.exit(0);
        });
      } else {
        process.exit(0);
      }
    });

    // Forçar encerramento após 10 segundos
    setTimeout(() => {
      console.error('⚠️ Forçando encerramento após timeout');
      process.exit(1);
    }, 10000);
  };

  // Capturar sinais de encerramento
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // Nodemon usa isso

}).catch(error => {
  console.error('❌ Falha ao inicializar aplicação:', error);
  process.exit(1);
});