// NOTA: Este arquivo será descontinuado após a migração completa das funcionalidades para user-jira-integration.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

class JiraIntegration {
    constructor() {
        this.baseUrl = process.env.JIRA_BASE_URL;
        this.username = process.env.JIRA_USERNAME;
        this.apiToken = process.env.JIRA_API_TOKEN;
        this.tempoToken = process.env.TEMPO_API_TOKEN;

        // Carregar mapeamento de projetos do arquivo
        this.loadProjectMapping();

        // Cache de tickets aprendidos
        this.learnedTickets = {};

        this.userMapping = {
            'Paulo Peltier Fucci': process.env.JIRA_USER_ID || 'paulo.fucci'
        };
    }

    loadProjectMapping() {
        try {
            const projectsPath = path.join(__dirname, 'project-mapping.json');
            
            if (fs.existsSync(projectsPath)) {
                const projectsData = fs.readFileSync(projectsPath, 'utf8');
                this.projectMapping = JSON.parse(projectsData);
                console.log(`✅ Projetos carregados: ${Object.keys(this.projectMapping).join(', ')}`);
            } else {
                // Projetos padrão se arquivo não existir
                this.projectMapping = {
                    'TJRJ': {
                        displayName: 'OPE-TJRJ-0333-FSW2',
                        jiraProjectKey: 'TJRJFSW2',
                        searchProject: 'OPE-TJRJ-0333-FSW2'
                    }
                };
                console.log('⚠️ Arquivo de projetos não encontrado, usando configuração padrão');
            }
        } catch (error) {
            console.error('❌ Erro ao carregar projetos:', error);
            this.projectMapping = {};
        }
    }

    // Analisa o texto falado e extrai informações
    async parseVoiceInput(text) {
        console.log('🎤 Analisando texto:', text);

        const result = {
            timeSpent: null,
            startTime: null,
            project: null,
            description: '',
            date: new Date(),
            originalText: text,
            hours: null,
            minutes: null
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

        // PADRÕES PARA PERÍODO: PRIORIDADE ABSOLUTA - "de X até Y", "das X às Y"
        const timeRangePatterns = [
            // === PADRÕES MOBILE ESPECÍFICOS (MÁXIMA PRIORIDADE) ===
            // Formato mobile: "de 9h01 minuto até 11h30" (singular "minuto")
            /de\s+(\d+)h(\d{2})\s+minuto\s+até\s+(\d+)h(\d{2})/gi,
            // Formato mobile: "de 9h01 minutos até 11h30" (plural "minutos")
            /de\s+(\d+)h(\d{2})\s+minutos\s+até\s+(\d+)h(\d{2})/gi,
            // Formato mobile: "das 9h01 minuto até 11h30"
            /das\s+(\d+)h(\d{2})\s+minutos?\s+até\s+(\d+)h(\d{2})/gi,
            
            // === PADRÕES MOBILE VARIAÇÕES ADICIONAIS ===
            // Formato: "de 16 horas até 16 horas e 45 minutos" (mobile pode transcrever assim)
            /de\s+(\d+)\s+horas?\s+até\s+(\d+)\s+horas?\s+e\s+(\d+)\s+minutos?/gi,
            // Formato: "das 16 horas até 16 horas e 45 minutos"
            /das\s+(\d+)\s+horas?\s+até\s+(\d+)\s+horas?\s+e\s+(\d+)\s+minutos?/gi,
            // Formato: "de 16h até 16h45" (sem espaços)
            /de\s+(\d+)h\s+até\s+(\d+)h(\d{2})/gi,
            // Formato: "das 16h até 16h45"
            /das\s+(\d+)h\s+até\s+(\d+)h(\d{2})/gi,
            
            // === PADRÕES HÍBRIDOS NUMÉRICO-EXTENSO (MAIS ESPECÍFICOS PRIMEIRO) ===
            // Formato: de 9 horas e um minuto até 11:30
            /de\s+(\d+)\s*horas?\s+e\s+(um|uma|dois|duas|três|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|quinze|vinte|trinta|quarenta|cinquenta|\d+)\s*minutos?\s+até\s+(\d+):(\d{2})/gi,
            // Formato: de 9 horas e 1 minuto até 11:30 
            /de\s+(\d+)\s*horas?\s+e\s+(\d+)\s*minutos?\s+até\s+(\d+):(\d{2})/gi,
            // Formato: de 9 horas até 11:30
            /de\s+(\d+)\s*horas?\s+até\s+(\d+):(\d{2})/gi,
            
            // === PADRÕES EXTENSOS (RECONHECIMENTO DE VOZ DESKTOP) ===
            // Formato: de nove horas até onze horas e trinta minutos
            /de\s+(uma|dois|duas|três|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|um|\d+)\s*horas?\s*(?:e\s+(uma|dois|duas|três|quatro|cinco|seis|sete|oito|nove|dez|quinze|vinte|trinta|quarenta|cinquenta|um|\d+)\s*minutos?)?\s+até\s+(?:as\s+)?(uma|dois|duas|três|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|um|\d+)\s*horas?\s*(?:e\s+(uma|dois|duas|três|quatro|cinco|seis|sete|oito|nove|dez|quinze|vinte|trinta|quarenta|cinquenta|um|\d+)\s*minutos?)?/gi,
            // Formato: das nove horas às onze horas e trinta minutos  
            /das\s+(uma|dois|duas|três|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|um|\d+)\s*horas?\s*(?:e\s+(uma|dois|duas|três|quatro|cinco|seis|sete|oito|nove|dez|quinze|vinte|trinta|quarenta|cinquenta|um|\d+)\s*minutos?)?\s+às\s+(uma|dois|duas|três|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|um|\d+)\s*horas?\s*(?:e\s+(uma|dois|duas|três|quatro|cinco|seis|sete|oito|nove|dez|quinze|vinte|trinta|quarenta|cinquenta|um|\d+)\s*minutos?)?/gi,
            
            // === PADRÕES COMPACTOS (MOBILE/DIGITAÇÃO) ===
            // Formato: de 9h até 11h30, de 8h30 até as 10h
            /de\s+(\d+)h(\d{1,2})?\s+até\s+(?:as\s+)?(\d+)h(\d{1,2})?/gi,
            // Formato: das 9h às 11h30, das 8h30 às 10h
            /das\s+(\d+)h(\d{1,2})?\s+às\s+(\d+)h(\d{1,2})?/gi,
            
            // === PADRÕES FORMATOS HH:MM ===
            // Formato: das 11:30 às 12:30 (PRINCIPAL - SEM "até")
            /das\s+(\d{1,2}):(\d{2})\s+às\s+(\d{1,2}):(\d{2})/gi,
            // Formato: de 11:30 às 12:30 (SEM "até")
            /de\s+(\d{1,2}):(\d{2})\s+às\s+(\d{1,2}):(\d{2})/gi,
            // Formato: das 11:30 até às 12:30, das 09:00 até às 10:30
            /das\s+(\d{1,2}):(\d{2})\s+até\s+às\s+(\d{1,2}):(\d{2})/gi,
            // Formato: de 11:30 até às 12:30, de 09:00 até às 10:30
            /de\s+(\d{1,2}):(\d{2})\s+até\s+às\s+(\d{1,2}):(\d{2})/gi,
            // Formato: das 11:30 até as 12:30, das 09:00 até as 10:30
            /das\s+(\d{1,2}):(\d{2})\s+até\s+as\s+(\d{1,2}):(\d{2})/gi,
            // Formato: de 11:30 até as 12:30, de 09:00 até as 10:30
            /de\s+(\d{1,2}):(\d{2})\s+até\s+as\s+(\d{1,2}):(\d{2})/gi,
            
            // === PADRÕES COM VÍRGULA (RECONHECIMENTO DE VOZ MOBILE CONFUSO) ===
            // Formato: de 8,50 até 11 horas (vírgula interpretada como decimal)
            /de\s+(\d+)[,.](\d{1,2})\s+até\s+(?:as\s+)?(\d+)\s*horas?/gi,
            // Formato: das 8,50 às 11 horas
            /das\s+(\d+)[,.](\d{1,2})\s+às\s+(\d+)\s*horas?/gi,
            
            // === PADRÕES HÍBRIDOS ===
            // Formato: de 9 horas até as 11 e 30
            /de\s+(\d+)\s*horas?\s+até\s+(?:as\s+)?(\d+)\s+e\s+(\d+)/gi,
            // Formato: das 9 horas às 11 e 30
            /das\s+(\d+)\s*horas?\s+às\s+(\d+)\s+e\s+(\d+)/gi
        ];

        for (const pattern of timeRangePatterns) {
            const matches = [...text.matchAll(pattern)];
            if (matches.length > 0) {
                const match = matches[0];
                console.log('🎯 PERÍODO DE TEMPO encontrado:', match[0]);
                console.log('🔢 Grupos capturados:', match);

                const matchText = match[0].toLowerCase();
                
                // IDENTIFICAR TIPO DE PADRÃO E EXTRAIR DADOS
                if (/de\s+\d+h\d{2}\s+minutos?\s+até\s+\d+h\d{2}/.test(matchText) || /das\s+\d+h\d{2}\s+minutos?\s+até\s+\d+h\d{2}/.test(matchText)) {
                    // FORMATO MOBILE: "de 9h01 minuto até 11h30"
                    startHour = parseInt(match[1]) || 0;
                    startMinute = parseInt(match[2]) || 0;
                    endHour = parseInt(match[3]) || 0;
                    endMinute = parseInt(match[4]) || 0;
                    
                    console.log(`📱 Formato mobile detectado: ${startHour}h${startMinute.toString().padStart(2, '0')} até ${endHour}h${endMinute.toString().padStart(2, '0')}`);
                }
                else if (/de\s+\d+\s+horas?\s+até\s+\d+\s+horas?\s+e\s+\d+\s+minutos?/.test(matchText) || /das\s+\d+\s+horas?\s+até\s+\d+\s+horas?\s+e\s+\d+\s+minutos?/.test(matchText)) {
                    // FORMATO MOBILE VARIAÇÃO: "de 16 horas até 16 horas e 45 minutos"
                    startHour = parseInt(match[1]) || 0;
                    startMinute = 0;
                    endHour = parseInt(match[2]) || 0;
                    endMinute = parseInt(match[3]) || 0;
                    
                    console.log(`📱 Formato mobile horas extenso: ${startHour}:00 até ${endHour}:${endMinute.toString().padStart(2, '0')}`);
                }
                else if (/de\s+\d+h\s+até\s+\d+h\d{2}/.test(matchText) || /das\s+\d+h\s+até\s+\d+h\d{2}/.test(matchText)) {
                    // FORMATO MOBILE COMPACTO: "de 16h até 16h45"
                    startHour = parseInt(match[1]) || 0;
                    startMinute = 0;
                    endHour = parseInt(match[2]) || 0;
                    endMinute = parseInt(match[3]) || 0;
                    
                    console.log(`📱 Formato mobile compacto: ${startHour}:00 até ${endHour}:${endMinute.toString().padStart(2, '0')}`);
                }
                else if (/de\s+\d+\s*horas?\s+(?:e\s+\w+\s*minutos?\s+)?até\s+\d+:\d{2}/.test(matchText)) {
                    // FORMATO HÍBRIDO: "de 9 horas e um minuto até 11:30"
                    startHour = parseInt(match[1]) || 0;
                    
                    if (match[2]) {
                        // Converter minutos (pode ser número ou palavra)
                        startMinute = numberMap[match[2]?.toLowerCase()] || parseInt(match[2]) || 0;
                    } else {
                        startMinute = 0;
                    }
                    
                    endHour = parseInt(match[3]) || 0;
                    endMinute = parseInt(match[4]) || 0;
                    
                    console.log(`🔄 Formato híbrido numérico-extenso: ${startHour}h${startMinute}min até ${endHour}:${endMinute.toString().padStart(2, '0')}`);
                }
                else if (/de\s+\d+[,.]/.test(matchText) || /das\s+\d+[,.]/.test(matchText)) {
                    // FORMATO COM VÍRGULA: "de 8,50 até 11 horas"
                    startHour = parseInt(match[1]) || 0;
                    startMinute = parseInt(match[2]) || 0;
                    endHour = parseInt(match[3]) || 0;
                    endMinute = 0; // Vírgula formato não especifica minutos no final
                    
                    console.log(`🔢 Formato vírgula: ${startHour},${startMinute} → ${endHour} horas`);
                } 
                else if (/\d+h/.test(matchText)) {
                    // FORMATO COMPACTO: "de 9h até 11h30" 
                    startHour = parseInt(match[1]) || 0;
                    startMinute = match[2] ? parseInt(match[2]) : 0;
                    endHour = parseInt(match[3]) || 0;
                    endMinute = match[4] ? parseInt(match[4]) : 0;
                    
                    console.log(`📱 Formato compacto: ${startHour}h${startMinute.toString().padStart(2, '0')} até ${endHour}h${endMinute.toString().padStart(2, '0')}`);
                }
                else if (/das\s+\d{1,2}:\d{2}\s+às\s+\d{1,2}:\d{2}/.test(matchText) || /de\s+\d{1,2}:\d{2}\s+às\s+\d{1,2}:\d{2}/.test(matchText) || /das\s+\d{1,2}:\d{2}\s+até\s+às?\s+\d{1,2}:\d{2}/.test(matchText) || /de\s+\d{1,2}:\d{2}\s+até\s+às?\s+\d{1,2}:\d{2}/.test(matchText)) {
                    // FORMATO HH:MM: "das 11:30 às 12:30" ou "das 11:30 até às 12:30"
                    startHour = parseInt(match[1]) || 0;
                    startMinute = parseInt(match[2]) || 0;
                    endHour = parseInt(match[3]) || 0;
                    endMinute = parseInt(match[4]) || 0;
                    
                    console.log(`🕐 Formato HH:MM: ${startHour}:${startMinute.toString().padStart(2, '0')} às ${endHour}:${endMinute.toString().padStart(2, '0')}`);
                }
                else if (/\d+\s*horas?\s+até.*?\d+\s+e\s+\d+/.test(matchText)) {
                    // FORMATO HÍBRIDO: "de 9 horas até as 11 e 30"
                    startHour = parseInt(match[1]) || 0;
                    startMinute = 0; // Não especificado no início
                    endHour = parseInt(match[2]) || 0;
                    endMinute = parseInt(match[3]) || 0;
                    
                    console.log(`🔄 Formato híbrido: ${startHour}h00 até ${endHour}h${endMinute.toString().padStart(2, '0')}`);
                }
                else {
                    // FORMATO EXTENSO: "de nove horas até onze horas e trinta minutos"
                    startHour = numberMap[match[1]?.toLowerCase()] || parseInt(match[1]) || 0;
                    startMinute = match[2] ? (numberMap[match[2]?.toLowerCase()] || parseInt(match[2]) || 0) : 0;
                    endHour = numberMap[match[3]?.toLowerCase()] || parseInt(match[3]) || 0;
                    endMinute = match[4] ? (numberMap[match[4]?.toLowerCase()] || parseInt(match[4]) || 0) : 0;
                    
                    console.log(`📝 Formato extenso: ${startHour}h${startMinute.toString().padStart(2, '0')} até ${endHour}h${endMinute.toString().padStart(2, '0')}`);
                }
                
                foundTimeRange = true;
                break;
            }
        }

        // CALCULAR DURAÇÃO AUTOMATICAMENTE BASEADO NO PERÍODO EXTRAÍDO
        if (foundTimeRange && startHour !== null && endHour !== null) {
            // Converter horários para minutos totais desde meia-noite
            const startTotalMinutes = (startHour * 60) + startMinute;
            const endTotalMinutes = (endHour * 60) + endMinute;
            
            // Calcular diferença de tempo
            let durationMinutes = endTotalMinutes - startTotalMinutes;
            
            // Validar se o período faz sentido
            if (durationMinutes <= 0) {
                console.log(`⚠️ ATENÇÃO: Período inválido - hora final (${endHour}:${endMinute.toString().padStart(2, '0')}) <= hora inicial (${startHour}:${startMinute.toString().padStart(2, '0')})`);
                // Assumir que passou para o próximo dia se necessário
                if (durationMinutes < 0) {
                    durationMinutes += (24 * 60);
                    console.log(`🔄 Assumindo trabalho durante a madrugada: ${durationMinutes} minutos`);
                }
            }
            
            // Configurar resultados
            result.startTime = `${startHour.toString().padStart(2, '0')}:${startMinute.toString().padStart(2, '0')}`;
            
            const hours = Math.floor(durationMinutes / 60);
            const minutes = durationMinutes % 60;
            result.timeSpent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
            result.hours = hours > 0 ? `${hours}h` : null;
            result.minutes = minutes > 0 ? `${minutes}min` : null;
            
            console.log(`✅ PERÍODO PROCESSADO COM SUCESSO:`);
            console.log(`   🕐 Hora inicial: ${result.startTime}`);
            console.log(`   🕐 Hora final: ${endHour.toString().padStart(2, '0')}:${endMinute.toString().padStart(2, '0')}`);
            console.log(`   ⏰ Duração calculada: ${durationMinutes} minutos = ${result.timeSpent}`);
            console.log(`   📊 Breakdown: ${result.hours || '0h'} ${result.minutes || '0min'}`);
        }

        // === FALLBACK: EXTRAÇÃO DE HORA INICIAL APENAS (COMPATIBILIDADE) ===
        const startTimePatterns = [
            // === PADRÕES COMPACTOS MOBILE ===  
            // Formato: a partir das 8h55, das 9h30 (formato compacto)
            /a\s+partir\s+das?\s+(\d+)h(\d{1,2})(?:\s+da\s+(?:manhã|tarde|noite))?/gi,
            // Formato: a partir de 8h55, de 9h30 (formato compacto)
            /a\s+partir\s+de\s+(\d+)h(\d{1,2})(?:\s+da\s+(?:manhã|tarde|noite))?/gi,
            // Formato: a partir das 8h, das 9h (só horas compactas)
            /a\s+partir\s+das?\s+(\d+)h(?!\d)(?:\s+da\s+(?:manhã|tarde|noite))?/gi,
            // Formato: a partir de 8h, de 9h (só horas compactas)
            /a\s+partir\s+de\s+(\d+)h(?!\d)(?:\s+da\s+(?:manhã|tarde|noite))?/gi
        ];

        // FALLBACK: Se não encontrou período completo, buscar apenas hora inicial
        if (!foundTimeRange) {
            for (const pattern of startTimePatterns) {
                const matches = [...text.matchAll(pattern)];
                if (matches.length > 0) {
                    const match = matches[0];
                    let fallbackStartHour, fallbackStartMinute = 0;

                    const matchText = match[0].toLowerCase();
                    
                    // FORMATO COMPACTO: das 8h55, das 9h30, das 8h
                    if (/\d+h/.test(matchText)) {
                        fallbackStartHour = parseInt(match[1]);
                        fallbackStartMinute = match[2] ? parseInt(match[2]) : 0;
                        console.log(`📱→🕐 Formato compacto (fallback): ${match[1]}h${match[2] || ''} → ${fallbackStartHour}:${fallbackStartMinute.toString().padStart(2, '0')}`);
                    }

                    result.startTime = `${fallbackStartHour.toString().padStart(2, '0')}:${fallbackStartMinute.toString().padStart(2, '0')}`;
                    console.log(`⏰ Hora de início encontrada (fallback): ${result.startTime} de: ${match[0]}`);
                    break;
                }
            }
        }

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

        // === EXTRAÇÃO DE DATA - FORMATOS BRASILEIROS ===
        if (/\bhoje\b/i.test(text)) {
            result.date = new Date();
            console.log('📅 Data: hoje');
        } else if (/\bontem\b/i.test(text)) {
            result.date = new Date();
            result.date.setDate(result.date.getDate() - 1);
            console.log('📅 Data: ontem');
        } else if (/\banteontem\b/i.test(text)) {
            result.date = new Date();
            result.date.setDate(result.date.getDate() - 2);
            console.log('📅 Data: anteontem');
        } else if (/\bamanhã\b/i.test(text)) {
            result.date = new Date();
            result.date.setDate(result.date.getDate() + 1);
            console.log('📅 Data: amanhã');
        } else {
            // Padrões para dias da semana passados
            const weekDayPatterns = [
                { pattern: /(segunda[- ]feira|segunda)\s+passada?/gi, dayOffset: -6 },
                { pattern: /(terça[- ]feira|terça)\s+passada?/gi, dayOffset: -5 },
                { pattern: /(quarta[- ]feira|quarta)\s+passada?/gi, dayOffset: -4 },
                { pattern: /(quinta[- ]feira|quinta)\s+passada?/gi, dayOffset: -3 },
                { pattern: /(sexta[- ]feira|sexta)\s+passada?/gi, dayOffset: -2 },
                { pattern: /(sábado|sabado)\s+passado?/gi, dayOffset: -1 },
                { pattern: /domingo\s+passado?/gi, dayOffset: 0 }
            ];

            let weekDayFound = false;
            for (const weekDay of weekDayPatterns) {
                if (weekDay.pattern.test(text)) {
                    result.date = new Date();
                    const today = result.date.getDay(); // 0=domingo, 1=segunda...
                    const targetDay = (weekDay.dayOffset + 7) % 7; // Normalizar para 0-6
                    let daysBack = today - targetDay;
                    if (daysBack <= 0) daysBack += 7; // Se é hoje ou futuro, vai para semana passada
                    result.date.setDate(result.date.getDate() - daysBack);
                    console.log('📅 Data: dia da semana passado');
                    weekDayFound = true;
                    break;
                }
            }

            if (!weekDayFound) {
                // Buscar datas específicas em vários formatos
                const datePatterns = [
                    // DD/MM/YYYY
                    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/,
                    // DD/MM
                    /(\d{1,2})[\/\-](\d{1,2})(?![\/\-]\d)/,
                    // dia DD/MM/YYYY ou dia DD/MM
                    /dia\s+(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{4}))?/gi
                ];

                let dateFound = false;
                for (const pattern of datePatterns) {
                    const dateMatch = text.match(pattern);
                    if (dateMatch) {
                        const day = parseInt(dateMatch[1]);
                        const month = parseInt(dateMatch[2]) - 1; // JavaScript months are 0-based
                        const year = dateMatch[3] ? parseInt(dateMatch[3]) : new Date().getFullYear();

                        result.date = new Date(year, month, day);
                        console.log(`📅 Data específica: ${day}/${month + 1}/${year}`);
                        dateFound = true;
                        break;
                    }
                }

                // Se não especificou, assume hoje
                if (!dateFound) {
                    result.date = new Date();
                    console.log('📅 Data: hoje (padrão)');
                }
            }
        }

        // === EXTRAÇÃO DE DESCRIÇÃO - SEPARAR BUSCA DO WORKLOG ===
        
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
            // Extrair apenas o que vem depois de "com a descrição"
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
        
        // STEP 3: Se não encontrou nem "em X" nem "com a descrição", usar outros padrões
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
                                if (desc.length > 2) {
                                    descriptions.push(desc);
                                    console.log('📝 Descrição candidata encontrada:', desc, 'de:', match[0]);
                                }
                            }
                        }
                    }
                } catch (e) {
                    // Fallback para padrões sem global flag
                    const match = text.match(pattern);
                    if (match && match[1]) {
                        let desc = match[1].trim().replace(/\s+/g, ' ');
                        if (desc.length > 2) {
                            descriptions.push(desc);
                            console.log('📝 Descrição candidata encontrada (fallback):', desc);
                        }
                    }
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
            const keywords = text.toLowerCase().match(/\b(frontend|backend|fullstack|gestão\s+de\s+projetos|gestão|análise|desenvolvimento|teste|bug|feature|correção|melhoria|refatoração|documentação|reunião|planejamento|revisão|deploy|configuração|ui|ux|api|database|banco|dados|código|programação|javascript|python|java|react|vue|angular)\b/g);
            if (keywords) {
                const keywordString = [...new Set(keywords)].join(', ');
                searchKeywords = keywordString;
                worklogDescription = keywordString;
                console.log('📝 Usando palavras-chave técnicas:', keywordString);
            }
        }

        // Definir a descrição final (para compatibilidade)
        result.description = worklogDescription;
        result.searchKeywords = searchKeywords; // Novo campo para palavras de busca

        // Mapear projeto para nome completo se encontrado
        if (result.project && this.projectMapping[result.project]) {
            result.projectMapped = this.projectMapping[result.project].displayName;
            console.log(`📋 Projeto mapeado: ${result.project} → ${result.projectMapped}`);
        }

        // IMPORTANTE: NÃO buscar tickets aqui no backend se a busca será feita nos favoritos
        // O frontend fará a filtragem dos favoritos localmente
        console.log(`📋 Análise completa - projeto: ${result.project}, palavras-chave: "${result.searchKeywords}"`);
        console.log(`⚠️ NOTA: Busca de tickets será feita pelo frontend (favoritos ou JIRA)`);

        console.log('✅ Resultado da análise completa:', result);

        // Log detalhado para debug
        console.log('🔍 Debug detalhado:');
        console.log('   - Tempo gasto extraído:', result.timeSpent);
        console.log('   - Horas extraídas:', result.hours || 'NÃO IDENTIFICADAS');
        console.log('   - Minutos extraídos:', result.minutes || 'NÃO IDENTIFICADOS');
        console.log('   - Hora de início extraída:', result.startTime);
        console.log('   - Projeto extraído:', result.project);
        console.log('   - Palavras para BUSCA:', result.searchKeywords || 'NÃO IDENTIFICADAS');
        console.log('   - Descrição para WORKLOG:', result.description || 'NÃO IDENTIFICADA');
        console.log('   - Data extraída:', result.date.toLocaleDateString('pt-BR'));
        console.log('   - Tickets sugeridos:', result.suggestedTickets?.length || 0);
        console.log('   - Ticket auto-selecionado:', result.autoSelectedTicket?.key || 'NENHUM');

        return result;
    }

    // Converte tempo do formato HH:MM para formato aceito pelo JIRA
    convertTimeToJiraFormat(timeSpent) {
        if (!timeSpent) return null;
        
        // Se já está no formato do JIRA (ex: "1h 30m"), retornar como está
        if (timeSpent.includes('h') || timeSpent.includes('m')) {
            return timeSpent;
        }
        
        // Converter de HH:MM para formato JIRA
        const [hours, minutes] = timeSpent.split(':').map(Number);
        let jiraFormat = '';
        
        if (hours > 0) {
            jiraFormat += `${hours}h`;
        }
        if (minutes > 0) {
            if (jiraFormat) jiraFormat += ' ';
            jiraFormat += `${minutes}m`;
        }
        
        console.log(`🔄 Convertendo tempo: ${timeSpent} → ${jiraFormat}`);
        return jiraFormat || '0m';
    }

    // Mapeia o ticket selecionado para o código JIRA
    mapTicketToJiraCode(project, selectedTicket = null, autoSelectedTicket = null) {
        if (!this.projectMapping[project]) {
            throw new Error(`Projeto ${project} não encontrado no mapeamento`);
        }

        // Se temos um ticket selecionado pelo usuário, usar seu key
        if (selectedTicket && selectedTicket.key) {
            console.log(`🎯 Usando ticket selecionado: ${selectedTicket.key}`);
            return selectedTicket.key;
        }

        // Se temos um ticket auto-selecionado, usar seu key
        if (autoSelectedTicket && autoSelectedTicket.key) {
            console.log(`🤖 Usando ticket auto-selecionado: ${autoSelectedTicket.key}`);
            return autoSelectedTicket.key;
        }

        throw new Error(`Nenhum ticket foi selecionado para o projeto ${project}`);
    }

    // Registra o apontamento no JIRA (API nativa)
    async logWorkTime(parsedData) {
        try {
            const { timeSpent, startTime, project, description, date, selectedTicket } = parsedData;

            // Validações
            if (!timeSpent || !project) {
                throw new Error('Dados insuficientes: necessário tempo e projeto');
            }

            if (!selectedTicket && !parsedData.autoSelectedTicket) {
                throw new Error('Nenhum ticket foi selecionado');
            }

            // Mapear ticket para código JIRA
            const jiraIssueKey = this.mapTicketToJiraCode(project, selectedTicket, parsedData.autoSelectedTicket);

            // Converter tempo para formato aceito pelo JIRA (ex: "1h 30m")
            const timeInJiraFormat = this.convertTimeToJiraFormat(timeSpent);
            
            // Preparar dados para a API nativa do JIRA
            const worklogData = {
                timeSpent: timeInJiraFormat, // Formato aceito pelo JIRA (ex: "1h 30m")
                comment: {
                    type: "doc",
                    version: 1,
                    content: [
                        {
                            type: "paragraph",
                            content: [
                                {
                                    type: "text",
                                    text: description || 'Trabalho registrado via reconhecimento de voz'
                                }
                            ]
                        }
                    ]
                }
            };

            // Adicionar startedAt se temos hora de início
            if (startTime) {
                // Combinar data + hora de início - manter horário local
                const startDateTime = new Date(date);
                const [hours, minutes] = startTime.split(':');
                startDateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
                
                // Converter para formato ISO mantendo o timezone local (-0300 para Brasil)
                const offset = startDateTime.getTimezoneOffset();
                const localDateTime = new Date(startDateTime.getTime() - (offset * 60 * 1000));
                worklogData.started = localDateTime.toISOString().replace('Z', '-0300');
                
                console.log(`🕐 Hora de início configurada: ${startTime} → ${worklogData.started}`);
            } else {
                // Se não tem hora específica, usar meio-dia da data
                const startDateTime = new Date(date);
                startDateTime.setHours(12, 0, 0, 0);
                const offset = startDateTime.getTimezoneOffset();
                const localDateTime = new Date(startDateTime.getTime() - (offset * 60 * 1000));
                worklogData.started = localDateTime.toISOString().replace('Z', '-0300');
            }

            console.log('📤 Enviando worklog para JIRA:', jiraIssueKey, worklogData);

            // Fazer requisição para a API nativa do JIRA
            const response = await axios.post(
                `${this.baseUrl}/rest/api/3/issue/${jiraIssueKey}/worklog`,
                worklogData,
                {
                    headers: {
                        'Authorization': `Basic ${Buffer.from(`${this.username}:${this.apiToken}`).toString('base64')}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    }
                }
            );

            console.log('✅ Worklog registrado com sucesso:', response.data);

            return {
                success: true,
                data: response.data,
                message: `Apontamento registrado: ${timeSpent} no ticket ${jiraIssueKey}`,
                worklogId: response.data.id
            };

        } catch (error) {
            console.error('❌ Erro ao registrar apontamento:', error.response?.data || error.message);
            
            let errorMessage = 'Erro desconhecido';
            if (error.response?.status === 403) {
                errorMessage = 'Acesso negado - verifique permissões do usuário no JIRA';
            } else if (error.response?.status === 404) {
                errorMessage = `Ticket ${jiraIssueKey || ticketNumber} não encontrado`;
            } else if (error.response?.status === 400) {
                errorMessage = 'Dados inválidos - verifique formato de tempo e ticket';
            } else if (error.response?.data?.errorMessages) {
                errorMessage = error.response.data.errorMessages.join(', ');
            } else if (error.message) {
                errorMessage = error.message;
            }

            return {
                success: false,
                error: errorMessage,
                message: `Erro: ${errorMessage}`,
                statusCode: error.response?.status
            };
        }
    }

    // Buscar tickets por palavras-chave no projeto
    async searchTicketsByKeywords(project, keywords) {
        try {
            const projectMapping = this.projectMapping[project];
            if (!projectMapping) {
                console.log(`❌ Projeto ${project} não encontrado no mapeamento`);
                return [];
            }

            // Extrair palavras-chave para filtro rigoroso
            const keywordArray = keywords.toLowerCase().split(/\s+/).filter(k => k.length > 2);
            console.log(`🔍 Palavras-chave para busca rigorosa: ${keywordArray.join(', ')}`);

            // JQL SIMPLES - buscar apenas tickets NÃO concluídos do projeto
            const jql = `project = "${projectMapping.jiraProjectKey}" AND status != "Concluído" ORDER BY updated DESC`;

            console.log('🔍 Buscando tickets com JQL (sem filtro de palavra):', jql);

            // Buscar TODOS os tickets não concluídos do projeto
            const response = await axios.get(
                `${this.baseUrl}/rest/api/3/search/jql`,
                {
                    params: {
                        jql: jql,
                        maxResults: 50,
                        fields: 'summary,status,assignee,description'
                    },
                    headers: {
                        'Authorization': `Basic ${Buffer.from(`${this.username}:${this.apiToken}`).toString('base64')}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    }
                }
            );

            let allTickets = response.data.issues.map(issue => ({
                key: issue.key,
                summary: issue.fields.summary,
                status: issue.fields.status.name,
                assignee: issue.fields.assignee?.displayName || 'Não atribuído',
                description: issue.fields.description || ''
            }));

            console.log(`📋 Total de tickets não concluídos encontrados: ${allTickets.length}`);

            // FILTRO RIGOROSO: buscar apenas tickets que tenham pelo menos 1 palavra-chave COMPLETA
            const ticketsWithScore = allTickets.map(ticket => {
                const ticketText = `${ticket.summary} ${ticket.description}`.toLowerCase();
                
                // Usar regex para encontrar palavras completas (não partes de outras palavras)
                const wordsFound = keywordArray.filter(word => {
                    const wordRegex = new RegExp(`\\b${word.toLowerCase()}\\b`, 'i');
                    const found = wordRegex.test(ticketText);
                    if (found) {
                        console.log(`   ✅ Palavra "${word}" encontrada em: "${ticket.summary}"`);
                    }
                    return found;
                });
                
                const score = wordsFound.length;
                
                console.log(`🎫 ${ticket.key}: "${ticket.summary}" (Status: ${ticket.status})`);
                console.log(`   Texto analisado: "${ticketText.substring(0, 100)}..."`);
                console.log(`   Palavras-chave procuradas: [${keywordArray.join(', ')}]`);
                console.log(`   Palavras COMPLETAS encontradas: [${wordsFound.join(', ')}] (${wordsFound.length}/${keywordArray.length})`);
                console.log(`   Score: ${score} ${score > 0 ? '✅ APROVADO' : '❌ REJEITADO'}`);
                console.log('');
                
                return { ...ticket, score, wordsFound };
            });

            // Filtrar APENAS tickets com pelo menos 1 palavra correspondente COMPLETA
            const filteredTickets = ticketsWithScore
                .filter(ticket => ticket.score > 0)
                .sort((a, b) => b.score - a.score); // Ordenar por score decrescente

            console.log(`🎫 RESUMO FINAL:`);
            console.log(`   📋 Total de tickets não concluídos: ${allTickets.length}`);
            console.log(`   🎯 Tickets com palavras-chave correspondentes: ${filteredTickets.length}`);
            console.log(`   🔍 Palavras buscadas: [${keywordArray.join(', ')}]`);
            
            // Se não encontrou NENHUM com correspondência exata, retornar array vazio
            if (filteredTickets.length === 0) {
                console.log(`❌ NENHUM ticket encontrado com as palavras-chave especificadas!`);
                console.log(`   Retornando lista vazia para forçar busca geral.`);
                return [];
            }
            
            console.log(`✅ Retornando ${Math.min(filteredTickets.length, 10)} tickets com correspondências exatas`);
            return filteredTickets.slice(0, 10);

        } catch (error) {
            console.error('Erro ao buscar tickets por palavras-chave:', error.response?.data || error.message);

            // Fallback: buscar tickets recentes do projeto se a busca por keyword falhar
            try {
                console.log('🔄 Tentando busca alternativa...');
                const fallbackJql = `project = "${this.projectMapping[project].jiraProjectKey}" AND status != "Concluído" ORDER BY updated DESC`;

                const fallbackResponse = await axios.get(
                    `${this.baseUrl}/rest/api/3/search/jql`,
                    {
                        params: {
                            jql: fallbackJql,
                            maxResults: 5,
                            fields: 'summary,status,assignee,description'
                        },
                        headers: {
                            'Authorization': `Basic ${Buffer.from(`${this.username}:${this.apiToken}`).toString('base64')}`,
                            'Content-Type': 'application/json',
                            'Accept': 'application/json'
                        }
                    }
                );

                const fallbackTickets = fallbackResponse.data.issues.map(issue => ({
                    key: issue.key,
                    summary: issue.fields.summary,
                    status: issue.fields.status.name,
                    assignee: issue.fields.assignee?.displayName || 'Não atribuído',
                    description: issue.fields.description || ''
                }));

                console.log(`🎫 Busca alternativa: ${fallbackTickets.length} tickets recentes encontrados`);
                return fallbackTickets;

            } catch (fallbackError) {
                console.error('Erro na busca alternativa:', fallbackError.response?.data || fallbackError.message);
                return [];
            }
        }
    }

    // Buscar TODOS os tickets do projeto (sem filtro de assignee)
    async searchAllTicketsInProject(project) {
        try {
            const projectMapping = this.projectMapping[project];
            if (!projectMapping) {
                console.log(`❌ Projeto ${project} não encontrado no mapeamento`);
                return [];
            }

            const jql = `project = "${projectMapping.jiraProjectKey}" AND status != "Concluído" ORDER BY updated DESC`;

            console.log('🔍 Buscando TODOS os tickets do projeto com JQL:', jql);

            const response = await axios.get(
                `${this.baseUrl}/rest/api/3/search/jql`,
                {
                    params: {
                        jql: jql,
                        maxResults: 50, // Buscar mais tickets
                        fields: 'summary,status,assignee,description'
                    },
                    headers: {
                        'Authorization': `Basic ${Buffer.from(`${this.username}:${this.apiToken}`).toString('base64')}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    }
                }
            );

            const tickets = response.data.issues.map(issue => ({
                key: issue.key,
                summary: issue.fields.summary,
                status: issue.fields.status.name,
                assignee: issue.fields.assignee?.displayName || 'Não atribuído',
                description: issue.fields.description || ''
            }));

            console.log(`🎫 Encontrados ${tickets.length} tickets no projeto`);
            return tickets;

        } catch (error) {
            console.error('Erro ao buscar todos os tickets do projeto:', error.response?.data || error.message);
            return [];
        }
    }

    // Buscar informações do ticket
    async getTicketInfo(jiraIssueKey) {
        try {
            const response = await axios.get(
                `${this.baseUrl}/rest/api/3/issue/${jiraIssueKey}`,
                {
                    headers: {
                        'Authorization': `Basic ${Buffer.from(`${this.username}:${this.apiToken}`).toString('base64')}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            return {
                key: response.data.key,
                summary: response.data.fields.summary,
                status: response.data.fields.status.name,
                assignee: response.data.fields.assignee?.displayName
            };
        } catch (error) {
            console.error('Erro ao buscar informações do ticket:', error);
            return null;
        }
    }

    // Processar entrada de voz completa
    async processVoiceInput(voiceText) {
        try {
            console.log('Processando entrada de voz:', voiceText);

            // 1. Analisar o texto
            const parsedData = await this.parseVoiceInput(voiceText);
            console.log('Dados extraídos:', parsedData);

            // 2. Validar dados extraídos
            if (!parsedData.timeSpent || (!parsedData.autoSelectedTicket && (!parsedData.suggestedTickets || parsedData.suggestedTickets.length === 0)) || !parsedData.project) {
                return {
                    success: false,
                    message: 'Não foi possível extrair todas as informações necessárias. Tente falar algo como: "Hoje eu trabalhei uma hora em gestão de projetos no projeto TJRJ a partir das 10 horas"'
                };
            }

            // 3. Buscar informações do ticket
            const jiraCode = this.mapTicketToJiraCode(parsedData.project, parsedData.selectedTicket, parsedData.autoSelectedTicket);
            const ticketInfo = await this.getTicketInfo(jiraCode);

            // 4. Registrar o apontamento
            const result = await this.logWorkTime(parsedData);

            return {
                ...result,
                parsedData,
                ticketInfo,
                jiraCode
            };

        } catch (error) {
            console.error('Erro no processamento:', error);
            return {
                success: false,
                message: error.message
            };
        }
    }
}

module.exports = JiraIntegration;