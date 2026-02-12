const fs = require('fs');

function gerarVersao() {
  const agora = new Date();
  const timestamp = Date.now();

  // Formatação brasileira da data
  const dataFormatada = agora.toLocaleString('pt-BR', { 
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit', 
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const versaoData = {
    deploy: dataFormatada,
    versao: `v${timestamp}`
  };

  // Salvar no arquivo JSON
  fs.writeFileSync('versao.json', JSON.stringify(versaoData, null, 2));

  // Exibir no console
  console.log('=== NOVA VERSÃO GERADA ===');
  console.log(`Deploy: ${versaoData.deploy}`);
  console.log(`Versão: ${versaoData.versao}`);
  console.log('===========================');
  console.log('Arquivo versao.json atualizado!');

  return versaoData;
}

// Executar se chamado diretamente
if (require.main === module) {
  gerarVersao();
}

module.exports = { gerarVersao };
