const express = require('express');
const { criarBackup, listarBackups } = require('../../backup-database');

// Importar função de limpeza diretamente do arquivo
const limparBackupsAntigos = () => {
  try {
    const fs = require('fs');
    const path = require('path');

    const pastaBackups = path.join(__dirname, '../../backups');
    if (!fs.existsSync(pastaBackups)) return;

    const arquivos = fs.readdirSync(pastaBackups)
      .filter(arquivo => arquivo.endsWith('.sql'))
      .map(arquivo => ({
        nome: arquivo,
        caminho: path.join(pastaBackups, arquivo),
        data: fs.statSync(path.join(pastaBackups, arquivo)).mtime
      }))
      .sort((a, b) => b.nome.localeCompare(a.nome)); // Ordenação por nome - mais recente primeiro

    // Manter apenas os 10 mais recentes
    if (arquivos.length > 10) {
      const paraRemover = arquivos.slice(10); // Remove do final (os mais antigos)
      console.log(`🧹 Removendo ${paraRemover.length} backup(s) antigo(s)...`);

      paraRemover.forEach(arquivo => {
        fs.unlinkSync(arquivo.caminho);
        console.log(`   🗑️ Removido: ${arquivo.nome}`);
      });

      console.log(`✅ Limpeza concluída! Mantidos ${Math.min(arquivos.length, 10)} backups mais recentes.`);
    } else {
      console.log(`📊 Sistema limpo: ${arquivos.length} backup(s) encontrado(s) (limite: 10)`);
    }
  } catch (error) {
    console.error('❌ Erro na limpeza de backups:', error.message);
  }
};

const router = express.Router();

// Middleware de autenticação para rotas sensíveis
const backupAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;

  // Debug: verificar variáveis de ambiente
  console.log('🔍 DEBUG - Variáveis de ambiente:');
  console.log('BACKUP_API_KEY existe:', !!process.env.BACKUP_API_KEY);
  console.log('DATABASE_URL existe:', !!process.env.DATABASE_URL);

  // Verificar se API key está configurada e é válida
  if (!process.env.BACKUP_API_KEY) {
    return res.status(500).json({ 
      success: false, 
      error: 'BACKUP_API_KEY não configurada no servidor' 
    });
  }

  if (!apiKey || apiKey !== process.env.BACKUP_API_KEY) {
    return res.status(401).json({ 
      success: false, 
      error: 'API key inválida ou ausente' 
    });
  }

  next();
};

// POST /api/backup/create - Criar backup automaticamente
router.post('/create', backupAuth, async (req, res) => {
  try {
    console.log('📡 Backup solicitado via API');

    const caminhoBackup = await criarBackup();

    // Executar limpeza automática após criar o backup
    console.log('🧹 Executando limpeza automática de backups antigos...');
    limparBackupsAntigos();

    res.json({
      success: true,
      message: 'Backup criado com sucesso',
      backup: {
        arquivo: require('path').basename(caminhoBackup),
        caminho: caminhoBackup,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Erro na API de backup:', error);
    res.status(500).json({
      success: false,
      error: 'Falha ao criar backup',
      details: error.message
    });
  }
});

// GET /api/backup/list - Listar backups existentes
router.get('/list', backupAuth, (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');

    const pastaBackups = path.join(__dirname, '../../backups');

    if (!fs.existsSync(pastaBackups)) {
      return res.json({
        success: true,
        backups: [],
        total: 0
      });
    }

    const arquivos = fs.readdirSync(pastaBackups)
      .filter(arquivo => arquivo.endsWith('.sql'))
      .map(arquivo => {
        const stats = fs.statSync(path.join(pastaBackups, arquivo));
        return {
          nome: arquivo,
          tamanho: (stats.size / 1024 / 1024).toFixed(2) + ' MB',
          data: stats.mtime.toISOString(),
          dataFormatada: stats.mtime.toLocaleString('pt-BR')
        };
      })
      .sort((a, b) => b.nome.localeCompare(a.nome));

    res.json({
      success: true,
      backups: arquivos,
      total: arquivos.length
    });

  } catch (error) {
    console.error('❌ Erro ao listar backups via API:', error);
    res.status(500).json({
      success: false,
      error: 'Falha ao listar backups',
      details: error.message
    });
  }
});

// GET /api/backup/status - Status do sistema de backup
router.get('/status', backupAuth, (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');

    const pastaBackups = path.join(__dirname, '../../backups');
    const temPasta = fs.existsSync(pastaBackups);

    let ultimoBackup = null;
    if (temPasta) {
      const arquivos = fs.readdirSync(pastaBackups)
        .filter(arquivo => arquivo.endsWith('.sql'))
        .map(arquivo => ({
          nome: arquivo,
          data: fs.statSync(path.join(pastaBackups, arquivo)).mtime
        }))
        .sort((a, b) => b.nome.localeCompare(a.nome)); // Ordenação por nome - mais recente primeiro

      if (arquivos.length > 0) {
        ultimoBackup = {
          arquivo: arquivos[0].nome,
          data: arquivos[0].data.toISOString(),
          dataFormatada: arquivos[0].data.toLocaleString('pt-BR')
        };
      }
    }

    res.json({
      success: true,
      status: {
        sistemaAtivo: true,
        pastaBackups: temPasta,
        databaseUrl: !!process.env.DATABASE_URL,
        ultimoBackup: ultimoBackup,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Erro ao verificar status via API:', error);
    res.status(500).json({
      success: false,
      error: 'Falha ao verificar status',
      details: error.message
    });
  }
});

// GET /api/backup/download/:filename - Download de backup específico
router.get('/download/:filename', backupAuth, (req, res) => {
  try {
    const { filename } = req.params;
    const path = require('path');
    const fs = require('fs');

    // Validar nome do arquivo
    if (!filename.endsWith('.sql') || filename.includes('..')) {
      return res.status(400).json({
        success: false,
        error: 'Nome de arquivo inválido'
      });
    }

    const pastaBackups = path.join(__dirname, '../../backups');
    const caminhoArquivo = path.join(pastaBackups, filename);

    // Verificar se arquivo existe
    if (!fs.existsSync(caminhoArquivo)) {
      return res.status(404).json({
        success: false,
        error: 'Arquivo de backup não encontrado'
      });
    }

    // Configurar headers para download
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/sql');

    // Enviar arquivo
    res.sendFile(caminhoArquivo);

  } catch (error) {
    console.error('❌ Erro no download de backup:', error);
    res.status(500).json({
      success: false,
      error: 'Falha no download',
      details: error.message
    });
  }
});

// POST /api/backup/email - Criar backup e enviar por e-mail
router.post('/email', backupAuth, async (req, res) => {
  try {
    console.log('📧 Backup por e-mail solicitado via API');
    console.log('🌐 Content-Type recebido:', req.headers['content-type'] || 'Não informado');
    console.log('🔑 X-API-Key recebido:', req.headers['x-api-key'] ? 'Sim' : 'Não');
    console.log('📨 Body recebido:', JSON.stringify(req.body, null, 2));
    console.log('🔍 Verificando variáveis de ambiente...');
    console.log('DATABASE_URL configurada:', !!process.env.DATABASE_URL);
    console.log('EMAIL_USER configurado:', !!process.env.EMAIL_USER);
    console.log('EMAIL_PASS configurado:', !!process.env.EMAIL_PASS);

    // Verificar se todas as variáveis necessárias estão configuradas
    if (!process.env.DATABASE_URL) {
      console.error('❌ DATABASE_URL não configurada');
      return res.status(500).json({
        success: false,
        error: 'DATABASE_URL não configurada no servidor'
      });
    }

    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.error('❌ Configurações de e-mail ausentes');
      console.error('EMAIL_USER:', !!process.env.EMAIL_USER);
      console.error('EMAIL_PASS:', !!process.env.EMAIL_PASS);
      return res.status(500).json({
        success: false,
        error: 'Configurações de e-mail não encontradas (EMAIL_USER ou EMAIL_PASS)'
      });
    }

    console.log('✅ Todas as variáveis de ambiente estão configuradas');

    const { criarBackupEmail } = require('../../backup-email');
    // Suportar email no body, query param ou usar padrão
    const destinatario = (req.body && req.body.email) || req.query.email || 'paulo.fucci@gmail.com';

    console.log(`📧 Iniciando backup para: ${destinatario}`);
    const resultado = await criarBackupEmail(destinatario);

    console.log('✅ Backup por e-mail concluído com sucesso');
    res.json({
      success: true,
      message: 'Backup criado e enviado por e-mail com sucesso',
      backup: {
        arquivo: resultado.arquivo,
        tamanho: resultado.tamanho,
        destinatario: resultado.destinatario,
        timestamp: resultado.timestamp
      }
    });

  } catch (error) {
    console.error('❌ Erro detalhado na API de backup por e-mail:');
    console.error('Tipo do erro:', error.constructor.name);
    console.error('Mensagem:', error.message);
    console.error('Stack:', error.stack);

    // Tentar identificar o tipo específico de erro
    let errorMessage = 'Falha ao criar e enviar backup por e-mail';
    let errorCode = 500;

    if (error.message && error.message.includes('Invalid login')) {
      errorMessage = 'Erro de autenticação de e-mail - verifique EMAIL_USER e EMAIL_PASS';
      errorCode = 401;
    } else if (error.message && error.message.includes('ENOTFOUND')) {
      errorMessage = 'Erro de conexão - verifique a conexão com o servidor SMTP';
      errorCode = 503;
    } else if (error.message && error.message.includes('pg_dump')) {
      errorMessage = 'Erro ao criar backup da base de dados - verifique DATABASE_URL';
      errorCode = 500;
    }

    res.status(errorCode).json({
      success: false,
      error: errorMessage,
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/backup/health - Health check simples (sem autenticação)
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Serviço de backup ativo',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;