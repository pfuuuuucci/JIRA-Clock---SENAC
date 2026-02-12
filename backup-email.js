const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Verificar se o módulo de e-mail está disponível
let emailService;
try {
  emailService = require('./server/config/email');
  console.log('✅ Módulo de e-mail carregado com sucesso');
} catch (error) {
  console.error('❌ Erro ao carregar módulo de e-mail:', error.message);
  throw new Error('Falha ao carregar serviço de e-mail: ' + error.message);
}

async function criarBackupEmail(destinatarioEmail = 'paulo.fucci@gmail.com') {
  try {
    console.log('📧 Iniciando backup com envio por e-mail...');
    console.log(`🎯 Destinatário: ${destinatarioEmail}`);

    // Verificar se DATABASE_URL existe
    if (!process.env.DATABASE_URL) {
      console.error('❌ DATABASE_URL não configurada!');
      throw new Error('DATABASE_URL não configurada');
    }

    // Verificar configurações de e-mail
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.error('❌ Configurações de e-mail não encontradas!');
      console.error('   EMAIL_USER:', !!process.env.EMAIL_USER);
      console.error('   EMAIL_PASS:', !!process.env.EMAIL_PASS);
      throw new Error('Configurações de e-mail ausentes');
    }

    console.log('✅ Credenciais de e-mail configuradas');
    console.log(`📧 Email: ${process.env.EMAIL_USER}`);
    console.log(`🔑 Senha configurada: ${process.env.EMAIL_PASS ? 'Sim' : 'Não'}`);

    // Verificar se o serviço de e-mail está funcionando
    console.log('🔗 Verificando serviço de e-mail...');
    if (!emailService || typeof emailService.sendBackupEmail !== 'function') {
      throw new Error('Serviço de e-mail não disponível ou método sendBackupEmail não encontrado');
    }

    // Criar pasta temporária para o backup
    const pastaTempBackups = path.join(__dirname, 'temp-backups');
    if (!fs.existsSync(pastaTempBackups)) {
      fs.mkdirSync(pastaTempBackups);
      console.log('📁 Pasta temporária criada');
    }

    // Gerar nome do arquivo usando timestamp atual
    const now = new Date();
    const timestamp = now.toISOString()
      .replace(/[-:]/g, '')
      .replace(/\..+/, '')
      .replace('T', '');

    const nomeArquivo = `backup_jira_${timestamp}.sql`;
    const caminhoCompleto = path.join(pastaTempBackups, nomeArquivo);

    console.log(`📝 Criando backup: ${nomeArquivo}`);

    // Criar cabeçalho com instruções para o arquivo SQL
    const cabecalho = `--
-- 🔄 BACKUP DO JIRA - ${new Date().toLocaleString('pt-BR')}
-- ============================================
-- 
-- 📁 Arquivo: ${nomeArquivo}
-- 🕒 Timestamp: ${timestamp}
-- 💾 Gerado automaticamente pelo sistema JIRA
-- 
-- 🔄 COMO RESTAURAR ESTE BACKUP:
-- 
-- OPÇÃO A (Interativa):
-- node backup-database.js restore
-- 
-- OPÇÃO B (Direta - Recomendada):
-- node backup-database.js restore ${nomeArquivo}
-- 
-- OPÇÃO C (Manual via psql):
-- psql "$DATABASE_URL" < backups/${nomeArquivo}
-- 
-- ⚠️  ATENÇÃO: A restauração irá sobrescrever todos os dados atuais!
-- 
-- ============================================
--

`;

    // Comando pg_dump
    const comando = `pg_dump "${process.env.DATABASE_URL}" --no-password --clean --if-exists`;

    return new Promise((resolve, reject) => {
      exec(comando, async (error, stdout, stderr) => {
        if (error) {
          console.error('❌ Erro no backup:', error.message);
          reject(error);
          return;
        }

        // Escrever cabeçalho + conteúdo do backup no arquivo
        try {
          const conteudoCompleto = cabecalho + stdout;
          fs.writeFileSync(caminhoCompleto, conteudoCompleto);
          console.log('📝 Cabeçalho com instruções adicionado ao backup');
        } catch (writeError) {
          console.error('❌ Erro ao escrever arquivo:', writeError.message);
          reject(writeError);
          return;
        }

        try {
          // Verificar se arquivo foi criado e tem conteúdo
          if (fs.existsSync(caminhoCompleto)) {
            const stats = fs.statSync(caminhoCompleto);
            const tamanhoMB = (stats.size / 1024 / 1024).toFixed(2);

            console.log('✅ Backup criado com sucesso!');
            console.log(`📊 Arquivo: ${nomeArquivo}`);
            console.log(`📏 Tamanho: ${tamanhoMB} MB`);
            console.log(`📧 Enviando para: ${destinatarioEmail}`);

            // Enviar por e-mail
            await emailService.sendBackupEmail(destinatarioEmail, caminhoCompleto);

            console.log('✅ Backup enviado por e-mail com sucesso!');

            // Remover arquivo temporário após envio
            fs.unlinkSync(caminhoCompleto);
            console.log('🗑️ Arquivo temporário removido');

            // Tentar remover pasta temporária se estiver vazia
            try {
              fs.rmdirSync(pastaTempBackups);
              console.log('🗑️ Pasta temporária removida');
            } catch (err) {
              // Pasta não está vazia, normal
            }

            resolve({
              arquivo: nomeArquivo,
              tamanho: tamanhoMB,
              destinatario: destinatarioEmail,
              timestamp: now.toISOString()
            });

          } else {
            console.error('❌ Arquivo de backup não foi criado');
            reject(new Error('Backup não foi criado'));
          }

        } catch (emailError) {
          console.error('❌ Erro ao enviar e-mail:', emailError.message);

          // Remover arquivo temporário mesmo se o e-mail falhou
          if (fs.existsSync(caminhoCompleto)) {
            fs.unlinkSync(caminhoCompleto);
            console.log('🗑️ Arquivo temporário removido após erro');
          }

          reject(emailError);
        }
      });
    });

  } catch (error) {
    console.error('❌ Erro geral no backup:', error.message);
    throw error;
  }
}

// Execução principal
if (require.main === module) {
  console.log('💾 Sistema de Backup por E-mail do JIRA');
  console.log('==========================================');

  criarBackupEmail('paulo.fucci@gmail.com')
    .then((resultado) => {
      console.log('\n🎉 Backup concluído com sucesso!');
      if (resultado && resultado.destinatario) {
        console.log(`📧 Enviado para: ${resultado.destinatario}`);
        console.log(`📊 Arquivo: ${resultado.arquivo} (${resultado.tamanho} MB)`);
      }
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Falha no backup:', error.message);
      process.exit(1);
    });
}

module.exports = { criarBackupEmail };