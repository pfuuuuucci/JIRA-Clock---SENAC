/**
 * 🔄 SISTEMA DE BACKUP E RESTAURAÇÃO - JIRA
 * ============================================
 * 
 * COMO USAR:
 * 
 * 📦 CRIAR BACKUP:
 * node backup-database.js
 * 
 * 📋 LISTAR BACKUPS:
 * node backup-database.js list
 * 
 * 🔄 RESTAURAR BACKUP:
 * 
 * OPÇÃO A (Interativa):
 * node backup-database.js restore
 * 
 * OPÇÃO B (Direta - Recomendada):
 * node backup-database.js restore nome_do_arquivo.sql
 * 
 * EXEMPLO OPÇÃO B:
 * node backup-database.js restore backup_jira_20250803000239.sql
 * 
 * A Opção B é mais rápida e prática para automação ou quando você já sabe
 * qual backup específico deseja restaurar.
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

async function criarBackup() {
  try {
    console.log('🔄 Iniciando backup da base de dados...');

    // Verificar se DATABASE_URL existe
    if (!process.env.DATABASE_URL) {
      console.error('❌ DATABASE_URL não configurada!');
      return;
    }

    // Criar pasta de backups se não existir
    const pastaBackups = path.join(__dirname, 'backups');
    if (!fs.existsSync(pastaBackups)) {
      fs.mkdirSync(pastaBackups);
      console.log('📁 Pasta backups criada');
    }

    // Gerar nome do arquivo com timestamp usando data do banco de dados
    const timestamp = await new Promise((resolve, reject) => {
      exec(`psql "${process.env.DATABASE_URL}" -c "SELECT to_char(NOW(), 'YYYYMMDDHH24MISS')" -t`, (error, stdout, stderr) => {
        if (error) {
          console.error('❌ Erro ao buscar data do banco:', error.message);
          reject(error);
          return;
        }
        // Remove quebras de linha e espaços
        const dbTimestamp = stdout.trim();
        console.log('🕒 Timestamp do banco de dados:', dbTimestamp);
        resolve(dbTimestamp);
      });
    });

    const nomeArquivo = `backup_jira_${timestamp}.sql`;
    const caminhoCompleto = path.join(pastaBackups, nomeArquivo);

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
      exec(comando, (error, stdout, stderr) => {
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

        // Verificar se arquivo foi criado e tem conteúdo
        if (fs.existsSync(caminhoCompleto)) {
          const stats = fs.statSync(caminhoCompleto);
          const tamanhoMB = (stats.size / 1024 / 1024).toFixed(2);

          console.log('✅ Backup criado com sucesso!');
          console.log(`📊 Arquivo: ${nomeArquivo}`);
          console.log(`📏 Tamanho: ${tamanhoMB} MB`);
          console.log(`📍 Local: ${caminhoCompleto}`);

          // Listar backups existentes
          listarBackups();

          resolve(caminhoCompleto);
        } else {
          console.error('❌ Arquivo de backup não foi criado');
          reject(new Error('Backup não foi criado'));
        }
      });
    });

  } catch (error) {
    console.error('❌ Erro geral no backup:', error.message);
  }
}

function listarBackups() {
  try {
    const pastaBackups = path.join(__dirname, 'backups');
    if (!fs.existsSync(pastaBackups)) {
      console.log('📁 Nenhum backup encontrado');
      return;
    }

    const arquivos = fs.readdirSync(pastaBackups)
      .filter(arquivo => arquivo.endsWith('.sql'))
      .map(arquivo => {
        const stats = fs.statSync(path.join(pastaBackups, arquivo));
        return {
          nome: arquivo,
          tamanho: (stats.size / 1024 / 1024).toFixed(2),
          data: stats.mtime.toLocaleString('pt-BR')
        };
      })
      .sort((a, b) => b.nome.localeCompare(a.nome)); // Mais recente primeiro

    console.log('\n📋 Backups disponíveis:');
    console.log('==========================================');
    arquivos.forEach((arquivo, index) => {
      console.log(`${index + 1}. ${arquivo.nome}`);
      console.log(`   📏 ${arquivo.tamanho} MB - 📅 ${arquivo.data}`);
    });
    console.log('==========================================');
  } catch (error) {
    console.error('❌ Erro ao listar backups:', error.message);
  }
}

// Função para limpeza automática (manter apenas os 10 backups mais recentes)
function limparBackupsAntigos() {
  try {
    const pastaBackups = path.join(__dirname, 'backups');
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
    }
  } catch (error) {
    console.error('❌ Erro na limpeza de backups:', error.message);
  }
}

// Função para restaurar backup
async function restaurarBackup(nomeArquivo) {
  try {
    console.log('🔄 Iniciando restauração da base de dados...');

    if (!process.env.DATABASE_URL) {
      console.error('❌ DATABASE_URL não configurada!');
      return;
    }

    const pastaBackups = path.join(__dirname, 'backups');
    const caminhoArquivo = nomeArquivo.includes('/') ? nomeArquivo : path.join(pastaBackups, nomeArquivo);

    if (!fs.existsSync(caminhoArquivo)) {
      console.error(`❌ Arquivo de backup não encontrado: ${nomeArquivo}`);
      console.log('\n📋 Backups disponíveis:');
      listarBackups();
      return;
    }

    console.log(`📁 Restaurando backup: ${path.basename(caminhoArquivo)}`);
    console.log('⚠️  ATENÇÃO: Isso irá sobrescrever todos os dados atuais!');

    const comando = `psql "${process.env.DATABASE_URL}" < "${caminhoArquivo}"`;

    return new Promise((resolve, reject) => {
      exec(comando, (error, stdout, stderr) => {
        if (error) {
          console.error('❌ Erro na restauração:', error.message);
          reject(error);
          return;
        }

        console.log('✅ Backup restaurado com sucesso!');
        console.log(`📊 Arquivo: ${path.basename(caminhoArquivo)}`);
        resolve();
      });
    });

  } catch (error) {
    console.error('❌ Erro geral na restauração:', error.message);
  }
}

// Função para restauração interativa
async function restaurarBackupInterativo() {
  const readline = require('readline');

  try {
    const pastaBackups = path.join(__dirname, 'backups');
    if (!fs.existsSync(pastaBackups)) {
      console.log('📁 Nenhum backup encontrado para restaurar');
      return;
    }

    const arquivos = fs.readdirSync(pastaBackups)
      .filter(arquivo => arquivo.endsWith('.sql'))
      .map(arquivo => {
        const stats = fs.statSync(path.join(pastaBackups, arquivo));
        return {
          nome: arquivo,
          tamanho: (stats.size / 1024 / 1024).toFixed(2),
          data: stats.mtime.toLocaleString('pt-BR')
        };
      })
      .sort((a, b) => b.nome.localeCompare(a.nome)); // Ordenação por nome - mais recente primeiro

    if (arquivos.length === 0) {
      console.log('📁 Nenhum backup encontrado para restaurar');
      return;
    }

    console.log('\n📋 Backups disponíveis para restauração:');
    console.log('==========================================');
    arquivos.forEach((arquivo, index) => {
      console.log(`${index + 1}. ${arquivo.nome}`);
      console.log(`   📏 ${arquivo.tamanho} MB - 📅 ${arquivo.data}`);
    });
    console.log('==========================================');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve, reject) => {
      rl.question('\n🔸 Digite o número do backup que deseja restaurar (ou 0 para cancelar): ', async (resposta) => {
        rl.close();

        const numero = parseInt(resposta);

        if (numero === 0) {
          console.log('❌ Operação cancelada pelo usuário');
          resolve();
          return;
        }

        if (isNaN(numero) || numero < 1 || numero > arquivos.length) {
          console.log('❌ Número inválido! Operação cancelada.');
          resolve();
          return;
        }

        const arquivoSelecionado = arquivos[numero - 1];
        console.log(`\n🎯 Backup selecionado: ${arquivoSelecionado.nome}`);
        console.log('⚠️  ATENÇÃO: Esta operação irá sobrescrever TODOS os dados atuais!');

        const rl2 = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });

        rl2.question('🔸 Tem certeza que deseja continuar? (sim/nao): ', async (confirmacao) => {
          rl2.close();

          if (confirmacao.toLowerCase() !== 'sim' && confirmacao.toLowerCase() !== 's') {
            console.log('❌ Operação cancelada pelo usuário');
            resolve();
            return;
          }

          try {
            await restaurarBackup(arquivoSelecionado.nome);
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      });
    });

  } catch (error) {
    console.error('❌ Erro na restauração interativa:', error.message);
  }
}

// Execução principal
if (require.main === module) {
  const args = process.argv.slice(2);
  const comando = args[0];

  console.log('💾 Sistema de Backup do JIRA');
  console.log('==================================');

  if (comando === 'restore') {
    const arquivo = args[1];

    if (arquivo) {
      // Restauração direta com arquivo especificado
      restaurarBackup(arquivo)
        .then(() => {
          console.log('\n🎉 Restauração concluída com sucesso!');
          process.exit(0);
        })
        .catch(error => {
          console.error('❌ Falha na restauração:', error.message);
          process.exit(1);
        });
    } else {
      // Restauração interativa
      restaurarBackupInterativo()
        .then(() => {
          process.exit(0);
        })
        .catch(error => {
          console.error('❌ Falha na restauração:', error.message);
          process.exit(1);
        });
    }
  } else if (comando === 'list') {
    listarBackups();
    process.exit(0);
  } else {
    // Backup padrão
    criarBackup()
      .then(() => {
        console.log('\n🎉 Backup concluído com sucesso!');
        console.log('💡 Dica: Baixe o arquivo de backup regularmente');

        // Limpeza automática
        limparBackupsAntigos();

        process.exit(0);
      })
      .catch(error => {
        console.error('❌ Falha no backup:', error.message);
        process.exit(1);
      });
  }
}

module.exports = { criarBackup, listarBackups, restaurarBackup, restaurarBackupInterativo };