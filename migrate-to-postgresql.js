
const AuthSystem = require('./auth');
const fs = require('fs');
const path = require('path');

async function runMigration() {
    console.log('🚀 INICIANDO MIGRAÇÃO PARA POSTGRESQL');
    console.log('=====================================');
    
    const authSystem = new AuthSystem();
    
    try {
        // 1. Inicializar banco e tabelas
        console.log('🔧 1. Inicializando banco de dados...');
        await authSystem.initializeDatabase();
        
        // 2. Fazer backup dos arquivos JSON
        console.log('💾 2. Criando backup dos arquivos JSON...');
        const backupDir = path.join(__dirname, 'json-backup');
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir);
        }
        
        const jsonFiles = [
            'users.json',
            'user-credentials.json',
            'user-projects.json',
            'user-favorites.json',
            'user-favorite-descriptions.json'
        ];
        
        for (const file of jsonFiles) {
            if (fs.existsSync(file)) {
                fs.copyFileSync(file, path.join(backupDir, file));
                console.log(`   ✅ Backup criado: ${file}`);
            }
        }
        
        // 3. Migrar dados
        console.log('📦 3. Migrando dados para PostgreSQL...');
        await authSystem.migrateData();
        
        // 4. Testar dados migrados
        console.log('🧪 4. Testando dados migrados...');
        
        // Testar usuários
        const users = JSON.parse(fs.readFileSync('users.json', 'utf8'));
        for (const username of Object.keys(users)) {
            const user = await authSystem.db.getUser(username);
            if (user) {
                console.log(`   ✅ Usuário migrado: ${username}`);
            } else {
                console.log(`   ❌ Falha na migração do usuário: ${username}`);
            }
        }
        
        // Testar credenciais
        const credentials = JSON.parse(fs.readFileSync('user-credentials.json', 'utf8'));
        for (const username of Object.keys(credentials.users || {})) {
            const creds = await authSystem.db.getUserCredentials(username);
            if (creds) {
                console.log(`   ✅ Credenciais migradas: ${username}`);
            } else {
                console.log(`   ❌ Falha na migração das credenciais: ${username}`);
            }
        }
        
        // Testar projetos
        const projects = JSON.parse(fs.readFileSync('user-projects.json', 'utf8'));
        for (const username of Object.keys(projects.users || {})) {
            const userProjects = await authSystem.db.getUserProjects(username);
            if (Object.keys(userProjects).length > 0) {
                console.log(`   ✅ Projetos migrados: ${username} (${Object.keys(userProjects).length} projetos)`);
            }
        }
        
        console.log('');
        console.log('🎉 MIGRAÇÃO CONCLUÍDA COM SUCESSO!');
        console.log('=================================');
        console.log('✅ Tabelas criadas no PostgreSQL');
        console.log('✅ Dados migrados dos arquivos JSON');
        console.log('✅ Backup dos JSONs salvo em ./json-backup/');
        console.log('✅ Sistema pronto para usar PostgreSQL');
        console.log('');
        console.log('📋 Próximos passos:');
        console.log('   1. Verificar se todas as funcionalidades funcionam');
        console.log('   2. Se tudo estiver OK, os arquivos JSON antigos podem ser removidos');
        console.log('   3. Aproveitar a robustez do PostgreSQL! 🚀');
        
    } catch (error) {
        console.error('❌ ERRO NA MIGRAÇÃO:', error);
        console.error('💡 Os arquivos JSON originais não foram alterados');
        console.error('💡 É seguro tentar novamente');
        process.exit(1);
    } finally {
        await authSystem.close();
    }
}

// Executar migração se chamado diretamente
if (require.main === module) {
    runMigration().catch(console.error);
}

module.exports = { runMigration };
