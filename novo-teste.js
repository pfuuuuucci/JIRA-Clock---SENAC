const axios = require('axios');

const TEMPO_API_TOKEN = 'VsrkUXJvukhupPqdyV0hfdjwTaBiiX-us';
const ACCOUNT_ID = '712020:eda48d95-a137-4186-a357-81657f4a6eaf'; // Não é o username, é o accountId Atlassian!
const FROM = '2025-09-11';
const TO = '2025-09-11';

async function buscaApontamentos() {
  try {
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

    // Imprime o objeto completo para análise
    results.forEach(wl => {
      console.log('--- Worklog completo ---');
      console.log(JSON.stringify(wl, null, 2));
    });

  } catch (err) {
    console.error(err.response ? err.response.data : err.message);
  }
}

buscaApontamentos();
