const axios = require('axios');
const AuthSystem = require('./auth');
const fs = require('fs');
const path = require('path');

class UserJiraIntegration {
    constructor() {
        this.authSystem = new AuthSystem();
        this.loadProjectMapping();
    }

    loadProjectMapping() {
        try {
            const projectsPath = path.join(__dirname, 'project-mapping.json');

            if (fs.existsSync(projectsPath)) {
                const projectsData = fs.readFileSync(projectsPath, 'utf8');
                this.projectMapping = JSON.parse(projectsData);
                console.log(`✅ Projetos carregados para usuário: ${Object.keys(this.projectMapping).join(', ')}`);
            } else {
                this.projectMapping = {};
                console.log('⚠️ Arquivo de projetos não encontrado');
            }
        } catch (error) {
            console.error('❌ Erro ao carregar projetos:', error);
            this.projectMapping = {};
        }
    }

    async getUserJiraClient(username) {
        const credentials = await this.authSystem.getUserJiraCredentials(username);

        if (!credentials) {
            throw new Error(`Credenciais JIRA não encontradas para o usuário: ${username}`);
        }

        return {
            baseURL: 'https://contatot3i.atlassian.net',
            auth: {
                username: credentials.jira_username,
                password: credentials.api_token
            },
            userId: credentials.user_id,
            tempoToken: credentials.tempo_token,
            username: credentials.jira_username // Adicionado para usar no getWorklogs
        };
    }

    async getUserProjects(username) {
        return await this.authSystem.getUserProjects(username);
    }

    async parseVoiceInput(username, text) {
        console.log('🎤 Analisando texto do usuário:', text);

        const result = {
            timeSpent: null,
            startTime: null,
            project: null,
            description: '',
            date: new Date(),
            originalText: text,
            hours: null,
            minutes: null,
            isSpecificDate: false
        };

        // === EXTRAÇÃO DE PERÍODO: HORA INICIAL → HORA FINAL → CALCULAR DURAÇÃO ===

        // Mapeamento números por extenso
        const numberMap = {
            'uma': 1, 'um': 1, '1': 1,
            'dois': 2, 'duas': 2, '2': 2,
            'três': 3, '3': 3,
            'quatro': 4, '4': 4,
            'cinco': 5, '5': 5,
            'seis': 6, '6': 6,
            'sete': 7, '7': 7,
            'oito': 8, '8': 8,
            'nove': 9, '9': 9,
            'dez': 10, '10': 10,
            'onze': 11, '11': 11,
            'doze': 12, '12': 12,
            'treze': 13, '13': 13,
            'quatorze': 14, '14': 14,
            'quinze': 15, '15': 15,
            'dezesseis': 16, '16': 16,
            'dezessete': 17, '17': 17,
            'dezoito': 18, '18': 18,
            'dezenove': 19, '19': 19,
            'vinte': 20, '20': 20,
            'trinta': 30, '30': 30,
            'quarenta': 40, '40': 40,
            'cinquenta': 50, '50': 50
        };

        let startHour = null;
        let startMinute = 0;
        let endHour = null;
        let endMinute = 0;
        let foundTimeRange = false;

        const timeRangePatterns = [
            // === PADRÕES BÁSICOS COM MINUTOS ===
            // Formato: das 11:30 até às 12:05
            /das\s+(\d{1,2}):(\d{2})\s+até\s+às\s+(\d{1,2}):(\d{2})/gi,
            /de\s+(\d{1,2}):(\d{2})\s+até\s+às?\s+(\d{1,2}):(\d{2})/gi,
            // Formato: das 11:30 às 12:05
            /das\s+(\d{1,2}):(\d{2})\s+às\s+(\d{1,2}):(\d{2})/gi,
            /de\s+(\d{1,2}):(\d{2})\s+às\s+(\d{1,2}):(\d{2})/gi,

            // === PADRÕES ESPECÍFICOS PARA OS CASOS REPORTADOS ===
            // Desktop: "das 14 horas às 17:42" (início fechado, fim HH:MM)
            /das\s+(\d{1,2})\s+horas?\s+às\s+(\d{1,2}):(\d{2})/gi,
            /de\s+(\d{1,2})\s+horas?\s+às\s+(\d{1,2}):(\d{2})/gi,
            // Mobile: "das 14h00 às 17h42" (formato compacto com h)
            /das\s+(\d{1,2})h(\d{2})\s+às\s+(\d{1,2})h(\d{2})/gi,
            /de\s+(\d{1,2})h(\d{2})\s+às\s+(\d{1,2})h(\d{2})/gi,

            // === PADRÕES HÍBRIDOS (ORDEM IMPORTANTE!) ===
            // Formato: das 11 horas até às 12:30 (início em horas fechadas, fim preciso)
            /das\s+(\d{1,2})\s*horas?\s+até\s+às?\s+(\d{1,2}):(\d{2})/gi,
            /de\s+(\d{1,2})\s*horas?\s+até\s+às?\s+(\d{1,2}):(\d{2})/gi,
            // Formato: das 11:30 até às 12 horas (início preciso, fim em horas fechadas)
            /das\s+(\d{1,2}):(\d{2})\s+até\s+às?\s+(\d{1,2})\s*horas?/gi,
            /de\s+(\d{1,2}):(\d{2})\s+até\s+às?\s+(\d{1,2})\s*horas?/gi,

            // === PADRÕES PARA HORAS FECHADAS ===
            // Formato: das 11 horas até às 12 horas (ambos horas fechadas)
            /das\s+(\d{1,2})\s*horas?\s+até\s+às?\s+(\d{1,2})\s*horas?/gi,
            /de\s+(\d{1,2})\s*horas?\s+até\s+às?\s+(\d{1,2})\s*horas?/gi,
            // Formato: das 11:30 até às 12:00 (fim com :00 explícito)
            /das\s+(\d{1,2}):(\d{2})\s+até\s+às\s+(\d{1,2}):00/gi,
            /de\s+(\d{1,2}):(\d{2})\s+até\s+às?\s+(\d{1,2}):00/gi,
            // Formato: das 11 horas e zero minutos até às 12 horas
            /das\s+(\d{1,2})\s*horas?\s+e\s+zero\s*minutos?\s+até\s+às?\s+(\d{1,2})\s*horas?/gi,
            /de\s+(\d{1,2})\s*horas?\s+e\s+zero\s*minutos?\s+até\s+às?\s+(\d{1,2})\s*horas?/gi,
        ];

        for (const pattern of timeRangePatterns) {
            const matches = [...text.matchAll(pattern)];
            if (matches.length > 0) {
                const match = matches[0];

                const matchText = match[0].toLowerCase();

                // Identificar tipo de formato baseado no match e texto
                if (/das\s+\d{1,2}\s+horas?\s+às\s+\d{1,2}:\d{2}/.test(matchText) || /de\s+\d{1,2}\s+horas?\s+às\s+\d{1,2}:\d{2}/.test(matchText)) {
                    // FORMATO HÍBRIDO DESKTOP: "das 14 horas às 17:42" (início fechado, fim HH:MM)
                    startHour = parseInt(match[1]) || 0;
                    startMinute = 0; // início é hora fechada
                    endHour = parseInt(match[2]) || 0;
                    endMinute = parseInt(match[3]) || 0;

                    console.log(`💻 Desktop híbrido: ${startHour}:00 às ${endHour}:${endMinute.toString().padStart(2, '0')}`);
                }
                else if (/das\s+\d{1,2}h\d{2}\s+às\s+\d{1,2}h\d{2}/.test(matchText) || /de\s+\d{1,2}h\d{2}\s+às\s+\d{1,2}h\d{2}/.test(matchText)) {
                    // FORMATO COMPACTO MOBILE: "das 14h00 às 17h42"
                    startHour = parseInt(match[1]) || 0;
                    startMinute = parseInt(match[2]) || 0;
                    endHour = parseInt(match[3]) || 0;
                    endMinute = parseInt(match[4]) || 0;

                    console.log(`📱 Mobile compacto: ${startHour}h${startMinute.toString().padStart(2, '0')} às ${endHour}h${endMinute.toString().padStart(2, '0')}`);
                }
                else if (/das\s+\d{1,2}:\d{2}\s+às\s+\d{1,2}:\d{2}/.test(matchText) || /de\s+\d{1,2}:\d{2}\s+às\s+\d{1,2}:\d{2}/.test(matchText) || /das\s+\d{1,2}:\d{2}\s+até\s+às?\s+\d{1,2}:\d{2}/.test(matchText) || /de\s+\d{1,2}:\d{2}\s+até\s+às?\s+\d{1,2}:\d{2}/.test(matchText)) {
                    // FORMATO HH:MM para ambos: "das 11:30 às 12:28"
                    startHour = parseInt(match[1]) || 0;
                    startMinute = parseInt(match[2]) || 0;
                    endHour = parseInt(match[3]) || 0;
                    endMinute = parseInt(match[4]) || 0;

                    console.log(`🕐 Formato HH:MM completo: ${startHour}:${startMinute.toString().padStart(2, '0')} às ${endHour}:${endMinute.toString().padStart(2, '0')}`);
                }
                else if (/das\s+\d{1,2}\s*horas?\s+até\s+às?\s+\d{1,2}:\d{2}/.test(matchText) || /de\s+\d{1,2}\s*horas?\s+até\s+às?\s+\d{1,2}:\d{2}/.test(matchText)) {
                    // FORMATO HÍBRIDO: início em horas fechadas, fim preciso - "das 11 horas até às 12:30"
                    startHour = parseInt(match[1]) || 0;
                    startMinute = 0; // início é hora fechada
                    endHour = parseInt(match[2]) || 0;
                    endMinute = parseInt(match[3]) || 0;

                    console.log(`🕐 Formato híbrido (início fechado): ${startHour}:00 até ${endHour}:${endMinute.toString().padStart(2, '0')}`);
                }
                else if (/das\s+\d{1,2}:\d{2}\s+até\s+às?\s+\d{1,2}\s*horas?/.test(matchText) || /de\s+\d{1,2}:\d{2}\s+até\s+às?\s+\d{1,2}\s*horas?/.test(matchText)) {
                    // FORMATO HÍBRIDO: início preciso, fim em horas fechadas - "das 11:30 até às 12 horas"
                    startHour = parseInt(match[1]) || 0;
                    startMinute = parseInt(match[2]) || 0;
                    endHour = parseInt(match[3]) || 0;
                    endMinute = 0; // fim é hora fechada

                    console.log(`🕐 Formato híbrido (fim fechado): ${startHour}:${startMinute.toString().padStart(2, '0')} até ${endHour}:00`);
                }
                else if (/das\s+\d{1,2}\s*horas?\s+até\s+às?\s+\d{1,2}\s*horas?/.test(matchText) || /de\s+\d{1,2}\s*horas?\s+até\s+às?\s+\d{1,2}\s*horas?/.test(matchText)) {
                    // FORMATO HORAS FECHADAS: ambos são horas fechadas - "das 11 horas até às 12 horas"
                    startHour = parseInt(match[1]) || 0;
                    startMinute = 0;
                    endHour = parseInt(match[2]) || 0;
                    endMinute = 0;

                    console.log(`🕐 Formato ambas horas fechadas: ${startHour}:00 até ${endHour}:00`);
                }
                else if (/das\s+\d{1,2}\s*horas?\s+e\s+zero\s*minutos?\s+até\s+às?\s+\d{1,2}\s*horas?/.test(matchText) || /de\s+\d{1,2}\s*horas?\s+e\s+zero\s*minutos?\s+até\s+às?\s+\d{1,2}\s*horas?/.test(matchText)) {
                    // FORMATO E ZERO MINUTOS: "das 11 horas e zero minutos até às 12 horas"
                    startHour = parseInt(match[1]) || 0;
                    startMinute = 0;
                    endHour = parseInt(match[2]) || 0;
                    endMinute = 0;

                    console.log(`🕐 Formato com zero minutos explícito: ${startHour}:00 até ${endHour}:00`);
                }
                else if (/\d+h/.test(matchText)) {
                    // FORMATO COMPACTO: "das 9h às 11h30" 
                    startHour = parseInt(match[1]) || 0;
                    startMinute = match[2] ? parseInt(match[2]) : 0;
                    endHour = parseInt(match[3]) || 0;
                    endMinute = match[4] ? parseInt(match[4]) : 0;

                    console.log(`📱 Formato compacto: ${startHour}h${startMinute.toString().padStart(2, '0')} até ${endHour}h${endMinute.toString().padStart(2, '0')}`);
                }
                else {
                    // FORMATO EXTENSO: "de nove horas até onze horas e trinta minutos"
                    startHour = numberMap[match[1]?.toLowerCase()] || parseInt(match[1]) || 0;
                    startMinute = match[2] ? (numberMap[match[2]?.toLowerCase()] || parseInt(match[2]) || 0) : 0;
                    endHour = numberMap[match[3]?.toLowerCase()] || parseInt(match[3]) || 0;
                    endMinute = match[4] ? (numberMap[match[4]?.toLowerCase()] || parseInt(match[4]) || 0) : 0;

                    console.log(`🔄 Formato extenso: ${startHour}h${startMinute.toString().padStart(2, '0')} até ${endHour}h${endMinute.toString().padStart(2, '0')}`);
                }

                foundTimeRange = true;
                break;
            }
        }

        // CALCULAR DURAÇÃO AUTOMATICAMENTE
        if (foundTimeRange && startHour !== null && endHour !== null) {
            const startTotalMinutes = (startHour * 60) + startMinute;
            const endTotalMinutes = (endHour * 60) + endMinute;

            let durationMinutes = endTotalMinutes - startTotalMinutes;

            if (durationMinutes <= 0) {
                console.log(`⚠️ Período inválido, assumindo próximo dia`);
                durationMinutes += (24 * 60);
            }

            result.startTime = `${startHour.toString().padStart(2, '0')}:${startMinute.toString().padStart(2, '0')}`;

            const hours = Math.floor(durationMinutes / 60);
            const minutes = durationMinutes % 60;
            result.timeSpent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
            result.hours = hours > 0 ? `${hours}h` : null;
            result.minutes = minutes > 0 ? `${minutes}min` : null;

            console.log(`✅ Duração calculada: ${result.timeSpent}`);
        }

        // === DATA REMOVIDA DO RECONHECIMENTO DE VOZ ===
        // A data agora vem do campo visual da tela (worklogDate)
        // Não processamos mais datas por voz
        console.log('📅 Data será obtida do campo visual da tela');
        result.date = null; // Será preenchida pelo frontend
        result.isSpecificDate = true; // Sempre específica agora


        // === EXTRAÇÃO DE PROJETO - PADRÕES ESPECÍFICOS ===
        const projectPatterns = [
            // TJRJ com possíveis espaços (celular pode separar em "TJ RJ")
            /projeto\s+(?:tj\s*rj|tjrj)/gi,
            /\bdo\s+projeto\s+(?:tj\s*rj|tjrj)\b/gi,
            /\bno\s+projeto\s+(?:tj\s*rj|tjrj)\b/gi,
            // Seguradora Sompo com possíveis variações
            /projeto\s+(?:seguradora\s+sompo|sompo)/gi,
            /\bdo\s+projeto\s+(?:seguradora\s+sompo|sompo)\b/gi,
            /\bno\s+projeto\s+(?:seguradora\s+sompo|sompo)\b/gi,
            // Delivery
            /projeto\s+delivery/gi,
            /\bdo\s+projeto\s+delivery\b/gi,
            /\bno\s+projeto\s+delivery\b/gi,
            // Fallback para projetos de uma palavra apenas
            /projeto\s+([A-Z]{2,15})/gi,
            /\bdo\s+projeto\s+([A-Z]{2,15})\b/gi,
            /\bno\s+projeto\s+([A-Z]{2,15})\b/gi
        ];

        for (const pattern of projectPatterns) {
            const matches = [...text.matchAll(pattern)];
            if (matches.length > 0) {
                const matchedText = matches[0][0].toLowerCase();
                let projectName = '';

                // Normalizar variações do TJRJ
                if (matchedText.includes('tj') && (matchedText.includes('rj') || matchedText.includes('tjrj'))) {
                    projectName = 'TJRJ';
                }
                // Normalizar variações do Sompo
                else if (matchedText.includes('seguradora') && matchedText.includes('sompo') || matchedText.includes('sompo')) {
                    projectName = 'SEGURADORA SOMPO';
                }
                // Delivery
                else if (matchedText.includes('delivery')) {
                    projectName = 'DELIVERY';
                }
                // Fallback para capture group
                else if (matches[0][1]) {
                    projectName = matches[0][1].toUpperCase();

                    // Mapear nomes alternativos
                    if (projectName === 'SEGURADORA SOMPO' || projectName.includes('SEGURADORA')) {
                        projectName = 'SEGURADORA SOMPO';
                    }
                }

                if (projectName) {
                    result.project = projectName;
                    console.log('📋 Projeto encontrado:', result.project, 'de:', matches[0][0]);
                    break;
                }
            }
        }

        // === EXTRAÇÃO DE DESCRIÇÃO - APENAS PALAVRAS-CHAVE RELEVANTES ===

        let searchKeywords = '';
        let worklogDescription = '';

        // STEP 1: Extrair palavras para BUSCA (sempre do que vem após "em")
        const emPattern = /\bem\s+([^.!?]+?)(?:\s+com\s+a\s+descrição|\s+(?:no\s+projeto|do\s+projeto|na\s+projeto|a\s+partir)\s+|$)/gi;
        const emMatches = [...text.matchAll(emPattern)];

        if (emMatches.length > 0 && emMatches[0][1]) {
            searchKeywords = emMatches[0][1].trim().replace(/\s+/g, ' ');
            console.log('🔍 Palavras para busca extraídas após "em":', searchKeywords);
        }

        // STEP 2: Extrair descrição para WORKLOG (prioridade: "com a descrição")
        const comDescricaoPattern = /com\s+a\s+descrição\s+([^.!?]+?)(?:\s+(?:no\s+projeto|do\s+projeto|na\s+projeto|a\s+partir)\s+|$)/gi;
        const comDescricaoMatch = text.match(comDescricaoPattern);

        if (comDescricaoMatch && comDescricaoMatch[0]) {
            const match = comDescricaoPattern.exec(text);
            if (match && match[1]) {
                worklogDescription = match[1].trim().replace(/\s+/g, ' ');
                console.log('📝 Descrição para worklog encontrada após "com a descrição":', worklogDescription);
            }
        } else {
            // Se não tem "com a descrição", usar as palavras de busca como descrição
            worklogDescription = searchKeywords;
            console.log('📝 Usando palavras de busca como descrição do worklog:', worklogDescription);
        }

        // STEP 3: Se não encontrou nem "em X" nem "com a descrição", usar outros padrões mais específicos
        if (!searchKeywords && !worklogDescription) {
            const descriptionPatterns = [
                // Atividades específicas com contexto completo
                /\b(?:desenvolvendo|fazendo|trabalhando|criando|implementando|corrigindo|testando|analisando|documentando|reunindo|estudando)\s+([^.!?]+?)(?:\s+(?:no\s+projeto|do\s+projeto|na\s+projeto|a\s+partir)\s+|$)/gi,
                // "com X", "sobre X", "para X" - similar ao padrão acima (mas não "com a descrição")
                /\b(?:com(?!\s+a\s+descrição)|sobre|para)\s+([^.!?]+?)(?:\s+(?:no\s+projeto|do\s+projeto|na\s+projeto|a\s+partir)\s+|$)/gi,
                // "no/na X" - mas não quando X é "projeto"
                /\b(?:no|na)\s+(?!projeto)([^.!?]+?)(?:\s+(?:do\s+projeto|na\s+projeto|a\s+partir)\s+|$)/gi
            ];

            let descriptions = [];

            for (const pattern of descriptionPatterns) {
                try {
                    const matches = [...text.matchAll(pattern)];
                    if (matches.length > 0) {
                        for (const match of matches) {
                            if (match[1]) {
                                let desc = match[1].trim().replace(/\s+/g, ' ');
                                if (desc.length > 2 && !desc.includes('das ') && !desc.includes('às ') && !desc.includes('horas')) {
                                    descriptions.push(desc);
                                    console.log('📝 Descrição candidata encontrada:', desc, 'de:', match[0]);
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.error('Erro no padrão de descrição:', e);
                }
            }

            if (descriptions.length > 0) {
                searchKeywords = descriptions[0];
                worklogDescription = descriptions[0];
                console.log('📝 Usando descrição candidata para busca e worklog:', descriptions[0]);
            }
        }

        // STEP 4: Fallback para palavras-chave técnicas se ainda não encontrou nada
        if (!searchKeywords && !worklogDescription) {
            const keywords = text.toLowerCase().match(/\b(frontend|backend|fullstack|gestão\s+de\s+projetos|gestão|análise|desenvolvimento|teste|bug|feature|correção|melhoria|refatoração|documentação|reunião|reuniões|planejamento|revisão|deploy|configuração|ui|ux|api|database|banco|dados|código|programação|javascript|python|java|react|vue|angular|diárias|daily)\b/g);
            if (keywords) {
                const keywordString = [...new Set(keywords)].join(', ');
                searchKeywords = keywordString;
                worklogDescription = keywordString;
                console.log('📝 Usando palavras-chave técnicas:', keywordString);
            }
        }

        // Definir a descrição final (para compatibilidade)
        result.description = worklogDescription;
        result.searchKeywords = searchKeywords;

        // Obter projetos do usuário
        const userProjects = await this.getUserProjects(username);
        result.userProjects = userProjects;

        console.log('✅ Resultado da análise:', result);
        console.log('🔍 Debug:');
        console.log('   - Tempo:', result.timeSpent);
        console.log('   - Projeto:', result.project);
        console.log('   - Palavras-chave:', result.searchKeywords);
        console.log('   - Descrição:', result.description);

        return result;
    }

    async logWorkTime(username, parsedData) {
        try {
            const jiraClient = await this.getUserJiraClient(username);
            const selectedTicket = parsedData.selectedTicket || parsedData.autoSelectedTicket;

            console.log('🔧 [USER-JIRA] Iniciando logWorkTime para:', username);
            console.log('🔧 [USER-JIRA] Ticket selecionado:', selectedTicket?.key);
            console.log('🔧 [USER-JIRA] Tempo gasto:', parsedData.timeSpent);

            if (!selectedTicket || !selectedTicket.key) {
                throw new Error('Ticket não especificado ou inválido');
            }

            // Converter tempo para formato aceito pelo JIRA
            let timeSpentJira;
            if (parsedData.timeSpent) {
                // Se tem formato HH:MM, converter para "1h 30m"
                if (parsedData.timeSpent.includes(':')) {
                    const [hours, minutes] = parsedData.timeSpent.split(':').map(Number);
                    let timeStr = '';
                    if (hours > 0) timeStr += `${hours}h`;
                    if (minutes > 0) {
                        if (timeStr) timeStr += ' ';
                        timeStr += `${minutes}m`;
                    }
                    timeSpentJira = timeStr || '0m';
                } else {
                    timeSpentJira = parsedData.timeSpent;
                }
            } else {
                throw new Error('Tempo gasto não especificado');
            }

            console.log('🔧 [USER-JIRA] Tempo convertido para JIRA:', timeSpentJira);

            // Preparar dados do worklog
            const worklogData = {
                timeSpent: timeSpentJira,
                comment: {
                    type: 'doc',
                    version: 1,
                    content: [{
                        type: 'paragraph',
                        content: [{
                            type: 'text',
                            text: parsedData.description || selectedTicket.summary || 'Trabalho registrado via reconhecimento de voz'
                        }]
                    }]
                }
            };

            // Adicionar data/hora de início se disponível
            if (parsedData.startTime && parsedData.date) {
                const startDateTime = new Date(parsedData.date);
                const [hours, minutes] = parsedData.startTime.split(':');
                startDateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);

                // Converter para ISO com timezone local
                const offset = startDateTime.getTimezoneOffset();
                const localDateTime = new Date(startDateTime.getTime() - (offset * 60 * 1000));

                // Verificar se o worklog está sendo criado após 21:00 (horário de Brasília) e ajustar o started
                const now = new Date();
                // Converter para horário de Brasília (UTC-3)
                const brasiliaTime = new Date(now.getTime() - (3 * 60 * 60 * 1000));
                const createdHour = brasiliaTime.getHours();

                console.log(`🕐 [USER-JIRA] Hora atual (Brasília): ${brasiliaTime.getHours()}:${brasiliaTime.getMinutes().toString().padStart(2, '0')}`);

                if (createdHour >= 21 && !parsedData.isSpecificDate) {
                    // Se é 21:00 ou mais tarde E data NÃO é específica (é referencial), diminuir um dia do started
                    localDateTime.setDate(localDateTime.getDate() - 1);
                    console.log(`🕘 [USER-JIRA] Worklog criado após 21:00 (${createdHour}:${brasiliaTime.getMinutes().toString().padStart(2, '0')}), diminuindo um dia do started`);
                    console.log(`🔄 [USER-JIRA] Started ajustado de ${new Date(parsedData.date).toISOString().split('T')[0]} para ${localDateTime.toISOString().split('T')[0]}`);
                }

                worklogData.started = localDateTime.toISOString().replace('Z', '-0300');

                console.log('🔧 [USER-JIRA] Data/hora de início:', worklogData.started);
            }

            console.log('🔧 [USER-JIRA] Enviando worklog:', JSON.stringify(worklogData, null, 2));

            // Preparar autenticação
            const authString = `${jiraClient.auth.username}:${jiraClient.auth.password}`;
            const base64Auth = Buffer.from(authString).toString('base64');
            
            console.log('');
            console.log('🔐 [USER-JIRA] Processo de autenticação do worklog:');
            console.log('   - Username:', jiraClient.auth.username);
            console.log('   - Token (COMPLETO):', jiraClient.auth.password);
            console.log('   - Token (length):', jiraClient.auth.password?.length);
            console.log('   - String auth (username:token):', authString.substring(0, 50) + '...');
            console.log('   - Base64 encoded:', base64Auth.substring(0, 50) + '...');
            console.log('   - Authorization header:', 'Basic ' + base64Auth.substring(0, 30) + '...');
            console.log('');

            // Fazer requisição para registrar worklog
            const response = await axios.post(
                `${jiraClient.baseURL}/rest/api/3/issue/${selectedTicket.key}/worklog`,
                worklogData,
                {
                    headers: {
                        'Authorization': `Basic ${base64Auth}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    }
                }
            );

            console.log('✅ [USER-JIRA] Worklog registrado com sucesso:', response.data.id);

            return {
                success: true,
                message: `Apontamento registrado: ${timeSpentJira} no ticket ${selectedTicket.key}`,
                data: response.data,
                worklogId: response.data.id,
                ticketKey: selectedTicket.key
            };

        } catch (error) {
            console.error('❌ [USER-JIRA] Erro ao registrar apontamento:', error.response?.data || error.message);

            let errorMessage = 'Erro ao registrar apontamento';
            if (error.response?.status === 403) {
                errorMessage = 'Sem permissão para registrar apontamento neste ticket';
            } else if (error.response?.status === 404) {
                errorMessage = 'Ticket não encontrado';
            } else if (error.response?.status === 400) {
                errorMessage = 'Dados do apontamento inválidos';
            } else if (error.response?.data?.errorMessages) {
                errorMessage = error.response.data.errorMessages.join(', ');
            } else if (error.message) {
                errorMessage = error.message;
            }

            return {
                success: false,
                message: errorMessage,
                error: error.response?.data || error.message,
                statusCode: error.response?.status
            };
        }
    }

    convertSecondsToReadableTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);

        if (hours > 0 && minutes > 0) {
            return `${hours}h ${minutes}m`;
        } else if (hours > 0) {
            return `${hours}h`;
        } else if (minutes > 0) {
            return `${minutes}m`;
        } else {
            return '< 1m';
        }
    }

    async getWorklogsForDate(username, date) {
        try {
            console.log(`🔍 [WORKLOGS] Buscando apontamentos via API do Tempo na data ${date}`);

            // Obter credenciais do usuário para acessar o token do Tempo
            const jiraClient = await this.getUserJiraClient(username);

            if (!jiraClient || !jiraClient.tempoToken) {
                console.log('❌ [WORKLOGS] Token do Tempo não encontrado nas credenciais do usuário');
                return [];
            }

            console.log(`✅ [WORKLOGS] Token do Tempo encontrado para usuário: ${username}`);

            // Buscar todos os worklogs da data usando a API do Tempo
            const response = await axios.get('https://api.tempo.io/4/worklogs', {
                params: {
                    from: date,
                    to: date,
                    limit: 1000
                },
                headers: {
                    'Authorization': `Bearer ${jiraClient.tempoToken}`
                }
            });

            console.log(`📊 [WORKLOGS] API Tempo retornou ${response.data.results.length} worklogs totais`);

            const worklogs = [];

            if (response.data.results && response.data.results.length > 0) {
                for (const worklog of response.data.results) {
                    // Verificar se o worklog é do usuário específico
                    let isCorrectUser = true;
                    if (username && username.trim() !== '') {
                        // Comparar com o userId do usuário (accountId do Atlassian)
                        isCorrectUser = worklog.author && worklog.author.accountId === jiraClient.userId;
                    }

                    if (isCorrectUser) {
                        // Converter timestamp para horários locais
                        const startDate = new Date(worklog.startDate + ' ' + worklog.startTime);
                        const startTime = startDate.toLocaleTimeString('pt-BR', { 
                            hour: '2-digit', 
                            minute: '2-digit' 
                        });

                        // Calcular horário de término baseado no tempo gasto
                        const timeSpentSeconds = worklog.timeSpentSeconds;
                        const endDate = new Date(startDate.getTime() + (timeSpentSeconds * 1000));
                        const endTime = endDate.toLocaleTimeString('pt-BR', { 
                            hour: '2-digit', 
                            minute: '2-digit' 
                        });

                        worklogs.push({
                            issueKey: worklog.issue?.key || 'N/A',
                            startTime: startTime,
                            endTime: endTime,
                            timeSpent: this.convertSecondsToReadableTime(timeSpentSeconds),
                            comment: worklog.description || 'Sem descrição',
                            started: worklog.startDate + 'T' + worklog.startTime,
                            author: worklog.author?.displayName || 'Usuário desconhecido',
                            tempoWorklogId: worklog.tempoWorklogId || worklog.id
                        });

                        console.log(`📝 [WORKLOGS] Worklog encontrado: ${worklog.issue.key} - ${startTime} - ${this.convertSecondsToReadableTime(timeSpentSeconds)} - Autor: ${worklog.author?.displayName}`);
                    }
                }
            }

            // Ordenar por horário de início
            worklogs.sort((a, b) => new Date(a.started) - new Date(b.started));

            const contexto = username && username.trim() !== '' ? `usuário "${username}"` : 'todos os usuários';
            console.log(`✅ [WORKLOGS] Encontrados ${worklogs.length} apontamentos para ${contexto} na data ${date}`);
            return worklogs;

        } catch (error) {
            console.error('❌ [WORKLOGS] Erro ao buscar apontamentos via API Tempo:', error.response?.data || error.message);
            return [];
        }
    }

    // Método auxiliar para converter segundos em formato legível
    convertSecondsToReadableTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);

        let result = '';
        if (hours > 0) {
            result += `${hours}h`;
        }
        if (minutes > 0) {
            if (result) result += ' ';
            result += `${minutes}m`;
        }

        return result || '0m';
    }

    async deleteWorklog(username, worklogId) {
        try {
            console.log(`🗑️ [DELETE-WORKLOG] Iniciando exclusão do worklog ${worklogId} para usuário ${username}`);

            // Obter credenciais do usuário para acessar o token do Tempo
            const jiraClient = await this.getUserJiraClient(username);

            if (!jiraClient || !jiraClient.tempoToken) {
                console.log('❌ [DELETE-WORKLOG] Token do Tempo não encontrado nas credenciais do usuário');
                return {
                    success: false,
                    message: 'Token do Tempo não configurado. Verifique suas credenciais.'
                };
            }

            console.log(`✅ [DELETE-WORKLOG] Token do Tempo encontrado para usuário: ${username}`);

            // Excluir worklog via API do Tempo
            const response = await axios.delete(`https://api.tempo.io/4/worklogs/${worklogId}`, {
                headers: {
                    'Authorization': `Bearer ${jiraClient.tempoToken}`
                }
            });

            console.log(`✅ [DELETE-WORKLOG] Worklog ${worklogId} excluído com sucesso via API do Tempo`);
            console.log(`📊 [DELETE-WORKLOG] Response status: ${response.status}`);

            return {
                success: true,
                message: `Apontamento ${worklogId} excluído com sucesso`,
                worklogId: worklogId
            };

        } catch (error) {
            console.error('❌ [DELETE-WORKLOG] Erro ao excluir worklog:', error.response?.data || error.message);

            let errorMessage = 'Erro ao excluir apontamento';

            if (error.response?.status === 404) {
                errorMessage = 'Apontamento não encontrado ou já foi excluído';
            } else if (error.response?.status === 403) {
                errorMessage = 'Sem permissão para excluir este apontamento';
            } else if (error.response?.status === 400) {
                errorMessage = 'Dados inválidos para exclusão';
            } else if (error.response?.data?.errors) {
                const errors = error.response.data.errors;
                if (typeof errors === 'object') {
                    errorMessage = Object.values(errors).join(', ');
                } else if (Array.isArray(errors)) {
                    errorMessage = errors.join(', ');
                } else {
                    errorMessage = errors.toString();
                }
            } else if (error.response?.data?.message) {
                errorMessage = error.response.data.message;
            } else if (error.message) {
                errorMessage = error.message;
            }

            return {
                success: false,
                message: errorMessage,
                error: error.response?.data || error.message,
                statusCode: error.response?.status
            };
        }
    }




    async close() {
        // Limpar recursos se necessário
    }
}

module.exports = UserJiraIntegration;