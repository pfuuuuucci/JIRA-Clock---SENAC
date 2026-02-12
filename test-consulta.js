const axios = require('axios');

const TEMPO_API_TOKEN = 'VsrkUXJvukhupPqdyV0hfdjwTaBiiX-us';
const ACCOUNT_ID = '712020:eda48d95-a137-4186-a357-81657f4a6eaf'; // Não é o username, é o accountId Atlassian!
const FROM = '2025-09-11';
const TO = '2025-09-11';

async function buscaApontamentos() {
  try {
    // 1. Buscar worklogs do Tempo
    console.log('🔍 Buscando worklogs do Tempo...');
    const response = await axios.get('https://api.tempo.io/4/worklogs', {
      params: {
        from: FROM,
        to: TO,
        limit: 100
      },
      headers: {
        'Authorization': `Bearer ${TEMPO_API_TOKEN}`
      }
    });

    // Filtra para o seu usuário
    const results = response.data.results.filter(wl => wl.author && wl.author.accountId === ACCOUNT_ID);

    console.log(`✅ Encontrados ${results.length} worklogs para análise`);

    // 2. Para cada worklog, buscar informações completas do ticket no JIRA
    for (const worklog of results) {
      console.log('\n--- Worklog + Informações do Ticket ---');
      
      // 🔍 DEBUG: Estrutura completa do worklog.issue
      console.log('🔍 DEBUG - Estrutura do worklog.issue:');
      console.log(JSON.stringify(worklog.issue, null, 2));
      
      // Dados básicos do worklog
      console.log('📝 Worklog básico:');
      console.log(`   Issue Key: ${worklog.issue?.key || 'N/A'}`);
      console.log(`   Issue ID: ${worklog.issue?.id || 'N/A'}`);
      console.log(`   Issue Self: ${worklog.issue?.self || 'N/A'}`);
      console.log(`   Autor: ${worklog.author?.displayName || 'N/A'}`);
      console.log(`   Data: ${worklog.startDate}`);
      console.log(`   Hora: ${worklog.startTime}`);
      console.log(`   Tempo: ${Math.floor(worklog.timeSpentSeconds / 3600)}h ${Math.floor((worklog.timeSpentSeconds % 3600) / 60)}m`);
      console.log(`   Descrição: ${worklog.description || 'N/A'}`);

      // ✅ Usando a descrição diretamente da API do Tempo
      console.log('\n🎯 DADOS FINAIS PARA O APP:');
      console.log(`   📋 Descrição/Projeto: "${worklog.description || 'Sem descrição'}"`);
      console.log(`   🕐 Horário: ${worklog.startTime}`);
      console.log(`   ⏱️ Tempo gasto: ${Math.floor(worklog.timeSpentSeconds / 3600)}h ${Math.floor((worklog.timeSpentSeconds % 3600) / 60)}m`);
      console.log(`   👤 Autor: ${worklog.author?.displayName || 'N/A'}`);
      console.log(`   📅 Data: ${worklog.startDate}`);
    }

  } catch (err) {
    console.error('❌ Erro geral:', err.response ? err.response.data : err.message);
  }
}

buscaApontamentos();
