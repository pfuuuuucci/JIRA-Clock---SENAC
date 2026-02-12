class VoiceRecognition {
    constructor() {
        this.recognition = null;
        this.isRecording = false;
        this.finalTranscript = '';
        this.shouldRestart = false;
        this.isSubmittingWorklog = false; // Flag para prevenir submissões duplicadas

        // Sistema de favoritos
        this.favoriteTickets = [];
        this.favoriteDescriptions = []; // Adicionado para gerenciar descrições favoritas

        this.initElements();
        this.initSpeechRecognition();
        this.bindEvents();
        this.initFavorites();
    }

    async initFavorites() {
        this.favoriteTickets = await this.loadFavorites();
        this.favoriteDescriptions = await this.loadFavoriteDescriptions();
        console.log(`📋 ${this.favoriteTickets.length} tickets carregados dos favoritos`);
        console.log(`📝 ${this.favoriteDescriptions.length} descrições carregadas dos favoritos`);
    }

    // Gerenciamento de descrições favoritas
    async loadFavoriteDescriptions() {
        try {
            const response = await fetch('/api/favorite-descriptions', {
                headers: {
                    ...this.getAuthHeaders()
                }
            });
            const result = await response.json();

            if (result.success) {
                return result.descriptions || [];
            } else {
                console.error('Erro ao carregar descrições favoritas:', result.message);
                return [];
            }
        } catch (error) {
            console.error('Erro ao carregar descrições favoritas:', error);
            return [];
        }
    }

    async saveFavoriteDescription(description) {
        try {
            const response = await fetch('/api/favorite-descriptions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.getAuthHeaders()
                },
                body: JSON.stringify({ description })
            });

            const result = await response.json();

            if (result.success) {
                this.favoriteDescriptions = result.descriptions;
                return true;
            } else {
                console.error('Erro ao salvar descrição favorita:', result.message);
                return false;
            }
        } catch (error) {
            console.error('Erro ao salvar descrição favorita:', error);
            return false;
        }
    }

    showDescriptionSelection(parsedData) {
        const selectedTicket = parsedData.autoSelectedTicket || parsedData.selectedTicket;

        this.jiraResult.innerHTML = `
            <h4>✏️ Escolher Descrição</h4>
            <div class="validation-info">
                <p><strong>🎫 Ticket:</strong> ${selectedTicket.key} - ${selectedTicket.summary}</p>
                <p><strong>⏰ Duração:</strong> ${parsedData.timeSpent}</p>
                <p><strong>🕐 Início:</strong> ${parsedData.startTime}</p>
            </div>

            <div class="description-selection">
                <label for="descriptionSelect"><strong>📝 Escolha uma descrição favorita ou grave nova:</strong></label>
                <select id="descriptionSelect" class="description-select">
                    <option value="">-- Selecione uma descrição favorita --</option>
                    ${this.favoriteDescriptions
                        .map((desc, originalIndex) => ({ desc, originalIndex }))
                        .sort((a, b) => a.desc.localeCompare(b.desc, 'pt-BR', { sensitivity: 'base' }))
                        .map(({ desc, originalIndex }) =>
                            `<option value="${originalIndex}">${desc}</option>`
                        ).join('')}
                    <option value="NEW">🎤 GRAVAR NOVA DESCRIÇÃO</option>
                </select>

                <div id="newDescriptionArea" class="new-description-area" style="display: none;">
                    <div class="voice-description">
                        <button id="recordDescriptionBtn" class="record-desc-btn">
                            <span class="btn-icon">🎤</span>
                            GRAVAR NOVA DESCRIÇÃO
                        </button>
                        <div id="descriptionStatus" class="description-status"></div>
                        <div id="descriptionTranscript" class="description-transcript" contenteditable="true" placeholder="Descrição aparecerá aqui..."></div>
                        <div id="editDescriptionArea" class="edit-description-area" style="display: none;">
                    <small>📝 <em>Clique no texto acima para editar a descrição se necessário</em></small>
                </div>
                    </div>
                </div>

                <div class="description-buttons">
                    <button id="confirmDescriptionBtn" class="description-action-btn confirm-desc-btn" disabled>CONFIRMAR DESCRIÇÃO</button>
                    <button id="backToValidationBtn" class="description-action-btn back-desc-btn">VOLTAR</button>
                </div>
            </div>
        `;

        this.setupDescriptionSelectionEvents(parsedData);
    }

    setupDescriptionSelectionEvents(parsedData) {
        const descriptionSelect = document.getElementById('descriptionSelect');
        const newDescriptionArea = document.getElementById('newDescriptionArea');
        const confirmBtn = document.getElementById('confirmDescriptionBtn');
        const backBtn = document.getElementById('backToValidationBtn');
        const recordBtn = document.getElementById('recordDescriptionBtn');

        // Quando seleciona uma opção
        descriptionSelect.addEventListener('change', (e) => {
            const selectedValue = e.target.value;

            if (selectedValue === 'NEW') {
                // Mostrar área para gravar nova descrição
                newDescriptionArea.style.display = 'block';
                confirmBtn.disabled = true;
                // LIMPAR seleção anterior para evitar conflitos
                delete parsedData.selectedDescription;
                delete parsedData.newDescription;
            } else if (selectedValue !== '') {
                // Selecionou uma descrição existente
                newDescriptionArea.style.display = 'none';
                confirmBtn.disabled = false;
                parsedData.selectedDescription = this.favoriteDescriptions[parseInt(selectedValue)];
                // LIMPAR nova descrição para evitar conflitos
                delete parsedData.newDescription;
            } else {
                // Não selecionou nada
                newDescriptionArea.style.display = 'none';
                confirmBtn.disabled = true;
                // LIMPAR ambas as opções
                delete parsedData.selectedDescription;
                delete parsedData.newDescription;
            }
        });

        // Botão de gravar nova descrição
        recordBtn.addEventListener('click', () => {
            // LIMPAR seleção anterior ao iniciar gravação
            delete parsedData.selectedDescription;
            this.recordNewDescription(parsedData);
        });

        // Eventos para edição do campo transcript
        document.addEventListener('input', (e) => {
            if (e.target.id === 'descriptionTranscript') {
                const editedDescription = e.target.textContent.trim();
                if (editedDescription) {
                    parsedData.newDescription = editedDescription;
                    confirmBtn.disabled = false;
                    console.log('📝 Descrição editada pelo usuário:', editedDescription);
                } else {
                    confirmBtn.disabled = true;
                    delete parsedData.newDescription;
                }
            }
        });


        // Confirmar descrição selecionada (preservando case exato)
        confirmBtn.addEventListener('click', () => {
            if (this.isSubmittingWorklog) return;

            // Desabilitar botão para evitar múltiplos cliques
            confirmBtn.disabled = true;

            // PRIORIDADE: Nova descrição sempre sobrepõe a selecionada
            if (parsedData.newDescription) {
                parsedData.description = parsedData.newDescription;
                console.log('📝 Nova descrição criada (case preservado):', parsedData.description);
                // Limpar seleção anterior para evitar conflitos
                delete parsedData.selectedDescription;
                this.logWorkToJira(parsedData);
            } else if (parsedData.selectedDescription) {
                parsedData.description = parsedData.selectedDescription;
                console.log('📝 Descrição selecionada (case preservado):', parsedData.description);
                this.logWorkToJira(parsedData);
            } else {
                // Não deveria acontecer, mas como fallback
                confirmBtn.disabled = false;
                console.error('❌ Nenhuma descrição selecionada ou gravada');
            }
        });

        // Voltar para validação
        backBtn.addEventListener('click', () => {
            this.showValidationPreview(parsedData);
        });
    }

    recordNewDescription(parsedData) {
        const recordBtn = document.getElementById('recordDescriptionBtn');
        const status = document.getElementById('descriptionStatus');
        const transcript = document.getElementById('descriptionTranscript');
        const confirmBtn = document.getElementById('confirmDescriptionBtn');

        // SEMPRE criar nova instância do reconhecimento de voz para evitar problemas de reutilização
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const descriptionRecognition = new SpeechRecognition();
        descriptionRecognition.continuous = false;
        descriptionRecognition.interimResults = true;
        descriptionRecognition.lang = 'pt-BR';

        descriptionRecognition.onstart = () => {
            recordBtn.disabled = true;
            recordBtn.innerHTML = '<span class="btn-icon">⏹️</span> PARANDO...';
            status.textContent = '🎤 Gravando descrição... Fale agora!';
            status.className = 'description-status recording';
            console.log('🎤 Reconhecimento de descrição iniciado');
        };

        descriptionRecognition.onresult = (event) => {
            let finalTranscript = '';
            for (let i = 0; i < event.results.length; i++) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                }
            }

            if (finalTranscript.trim()) {
                // Preservar o case exato da descrição gravada
                const exactCaseDescription = finalTranscript.trim();

                transcript.textContent = exactCaseDescription;
                parsedData.newDescription = exactCaseDescription;

                // Mostrar área de edição (agora apenas um indicativo)
                const editArea = document.getElementById('editDescriptionArea');
                if (editArea) {
                    editArea.style.display = 'block';
                }
                confirmBtn.disabled = false;

                console.log('📝 Descrição gravada (preservando case):', exactCaseDescription);
            }
        };

        descriptionRecognition.onend = () => {
            recordBtn.disabled = false;
            recordBtn.innerHTML = '<span class="btn-icon">🎤</span> GRAVAR NOVA DESCRIÇÃO';
            status.textContent = parsedData.newDescription ?
                '✅ Descrição gravada com sucesso!' :
                'Tente gravar novamente.';
            status.className = parsedData.newDescription ?
                'description-status success' :
                'description-status error';
            console.log('🎤 Reconhecimento de descrição finalizado');
        };

        descriptionRecognition.onerror = (event) => {
            recordBtn.disabled = false;
            recordBtn.innerHTML = '<span class="btn-icon">🎤</span> GRAVAR NOVA DESCRIÇÃO';
            status.textContent = `❌ Erro: ${event.error}`;
            status.className = 'description-status error';
            console.error('❌ Erro no reconhecimento de descrição:', event.error);
        };

        // Confirmar descrição gravada
        const originalConfirmHandler = confirmBtn.onclick;
        confirmBtn.onclick = async () => {
            if (parsedData.newDescription) {
                // PRESERVAR CASE EXATO: salvar nova descrição nos favoritos sem modificação
                const exactDescription = parsedData.newDescription;
                const saved = await this.saveFavoriteDescription(exactDescription);
                if (saved) {
                    console.log('✅ Nova descrição salva nos favoritos (case preservado):', exactDescription);
                }

                parsedData.description = exactDescription;
                console.log('📝 Nova descrição criada (case preservado):', parsedData.description);
                this.logWorkToJira(parsedData);
            }
        };

        // Iniciar gravação com a nova instância
        try {
            descriptionRecognition.start();
            console.log('🎤 Iniciando gravação de descrição...');
        } catch (error) {
            console.error('❌ Erro ao iniciar gravação de descrição:', error);
            recordBtn.disabled = false;
            recordBtn.innerHTML = '<span class="btn-icon">🎤</span> GRAVAR NOVA DESCRIÇÃO';
            status.textContent = '❌ Erro ao iniciar gravação';
            status.className = 'description-status error';
        }
    }

    // Gerenciamento de favoritos
    async loadFavorites() {
        try {
            const response = await fetch('/api/favorites', {
                headers: {
                    ...this.getAuthHeaders()
                }
            });
            const result = await response.json();

            if (result.success) {
                return result.favorites || [];
            } else {
                console.error('Erro ao carregar favoritos:', result.message);
                return [];
            }
        } catch (error) {
            console.error('Erro ao carregar favoritos:', error);
            return [];
        }
    }

    async saveFavorite(ticket) {
        try {
            const response = await fetch('/api/favorites', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.getAuthHeaders()
                },
                body: JSON.stringify({ ticket })
            });

            const result = await response.json();

            if (result.success) {
                this.favoriteTickets = result.favorites;
                return true;
            } else {
                console.error('Erro ao salvar favorito:', result.message);
                return false;
            }
        } catch (error) {
            console.error('Erro ao salvar favorito:', error);
            return false;
        }
    }

    async addToFavorites(ticket) {
        // Verificar se já existe
        const exists = this.favoriteTickets.some(fav => fav.key === ticket.key);
        if (!exists) {
            const success = await this.saveFavorite(ticket);
            if (success) {
                console.log(`✅ Ticket ${ticket.key} adicionado aos favoritos`);
                return true;
            }
        }
        return false;
    }

    filterFavoriteTickets(allTickets) {
        return allTickets.filter(ticket =>
            this.favoriteTickets.some(fav => fav.key === ticket.key)
        );
    }

    initElements() {
        this.startBtn = document.getElementById('startBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.clearBtn = document.getElementById('clearBtn');
        this.analyzeBtn = document.getElementById('analyzeBtn');
        this.newAppointmentBtn = document.getElementById('newAppointmentBtn');
        this.status = document.getElementById('status');
        this.transcript = document.getElementById('transcript');

        this.jiraResult = document.getElementById('jiraResult');
    }

    getCurrentUser() {
        try {
            const userData = sessionStorage.getItem('currentUser');
            return userData ? JSON.parse(userData) : null;
        } catch (error) {
            console.error('Erro ao obter usuário atual:', error);
            return null;
        }
    }

    getAuthHeaders() {
        const currentUser = this.getCurrentUser();
        if (!currentUser) {
            return {};
        }

        return {
            'x-user-id': currentUser.username
        };
    }

    initSpeechRecognition() {
        // Check for browser support
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
            this.showError('Seu navegador não suporta reconhecimento de voz. Use Chrome, Safari ou Edge.');
            return;
        }

        // Initialize Speech Recognition
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.recognition = new SpeechRecognition();

        // NOVA DETECÇÃO: Samsung/Android problemáticos
        this.isSamsungAndroid = this.detectSamsungAndroid();
        this.isProblematicDevice = this.isSamsungAndroid;

        // FORÇAR MODO NÃO-CONTÍNUO PARA TODOS OS DISPOSITIVOS
        console.log('🔧 FORÇANDO MODO NÃO-CONTÍNUO PARA TODOS OS DISPOSITIVOS');
        this.recognition.continuous = false;
        this.recognition.interimResults = false;

        this.recognition.lang = 'pt-BR';
        this.recognition.maxAlternatives = 1;

        // Event handlers
        this.recognition.onstart = () => {
            console.log('Speech recognition started');
            this.isRecording = true;
            this.updateUI();
            this.updateStatus('🎤 Ouvindo... Fale agora!', 'recording');
        };

        this.recognition.onend = () => {
            console.log('Speech recognition ended');
            this.isRecording = false;
            this.updateUI();

            // MODO NÃO-CONTÍNUO PARA TODOS: nunca reiniciar automaticamente
            this.shouldRestart = false;
            this.updateStatus('Gravação finalizada. Clique "Iniciar" para gravar novamente.');
            console.log('🔧 Modo não-contínuo universal: não reiniciando automaticamente');
        };

        this.recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            this.isRecording = false;
            this.shouldRestart = false;
            this.updateUI();

            let errorMessage = 'Erro no reconhecimento de voz: ';
            switch(event.error) {
                case 'no-speech':
                    // MODO NÃO-CONTÍNUO PARA TODOS: silêncio é erro, não reinicia
                    errorMessage += 'Nenhuma fala detectada. Clique "Iniciar" e fale novamente.';
                    console.log('🔧 Modo não-contínuo universal: silêncio tratado como erro');
                    break;
                case 'audio-capture':
                    errorMessage += 'Erro ao acessar o microfone. Verifique as permissões.';
                    break;
                case 'not-allowed':
                    errorMessage += 'Permissão de microfone negada. Vá em Configurações > Safari > Microfone e permita o acesso.';
                    break;
                case 'network':
                    errorMessage += 'Erro de rede. Verifique sua conexão com a internet.';
                    break;
                case 'aborted':
                    // iOS often triggers this when stopping - ignore
                    if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
                        this.updateStatus('Gravação finalizada. Pronto para nova gravação.');
                        return;
                    }
                    errorMessage += 'Gravação interrompida.';
                    break;
                default:
                    errorMessage += event.error;
            }
            this.showError(errorMessage);
        };

        this.recognition.onresult = (event) => {
            // MODO NÃO-CONTÍNUO PARA TODOS: apenas resultado final
            for (let i = event.resultIndex; i < event.results.length; i++) {
                if (event.results[i].isFinal) {
                    const transcript = event.results[i][0].transcript;
                    this.finalTranscript += transcript + ' ';
                    console.log('🔧 Modo não-contínuo universal - Resultado final:', transcript);
                }
            }
            this.displayTranscript(this.finalTranscript, '');
        };
    }

    // NOVO: Detectar dispositivos Samsung/Android problemáticos
    detectSamsungAndroid() {
        const userAgent = navigator.userAgent.toLowerCase();
        const platform = navigator.platform.toLowerCase();
        
        // Detectar Samsung
        const isSamsung = userAgent.includes('samsung') || 
                         userAgent.includes('sm-') || 
                         userAgent.includes('gt-') ||
                         userAgent.includes('galaxy');
        
        // Detectar Android (mas não Chrome desktop que emula Android)
        const isAndroid = userAgent.includes('android') && !userAgent.includes('windows');
        
        // Detectar tablets especificamente (que são mais problemáticos)
        const isTablet = userAgent.includes('tablet') ||
                        userAgent.includes('ipad') ||
                        (isAndroid && !userAgent.includes('mobile'));
        
        const isProblematic = (isSamsung && isAndroid) || (isAndroid && isTablet);
        
        if (isProblematic) {
            console.log('🔧 DISPOSITIVO PROBLEMÁTICO DETECTADO:');
            console.log(`   Samsung: ${isSamsung}`);
            console.log(`   Android: ${isAndroid}`);
            console.log(`   Tablet: ${isTablet}`);
            console.log(`   User Agent: ${userAgent}`);
            console.log('   → Modo NÃO-CONTÍNUO será usado');
        }
        
        return isProblematic;
    }

    bindEvents() {
        this.startBtn.addEventListener('click', () => this.startRecording());
        this.stopBtn.addEventListener('click', () => this.stopRecording());
        this.clearBtn.addEventListener('click', () => this.clearTranscript());
        this.analyzeBtn.addEventListener('click', () => this.analyzeData());
        this.newAppointmentBtn.addEventListener('click', () => this.startNewAppointment());
    }

    startRecording() {
        if (!this.recognition) {
            this.showError('Reconhecimento de voz não está disponível.');
            return;
        }

        // MODO NÃO-CONTÍNUO PARA TODOS OS DISPOSITIVOS
        this.shouldRestart = false;
        console.log('🔧 Iniciando gravação em modo NÃO-CONTÍNUO (TODOS OS DISPOSITIVOS)');
        this.updateStatus('🎤 Modo não-contínuo: Fale e clique "Parar" quando terminar', 'recording');

        // Request microphone permission explicitly for iOS
        if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
            navigator.mediaDevices.getUserMedia({ audio: true })
                .then(() => {
                    this.startRecognitionProcess();
                })
                .catch((error) => {
                    console.error('Microphone permission denied:', error);
                    this.showError('Permissão de microfone necessária. Permita o acesso nas configurações.');
                });
        } else {
            this.startRecognitionProcess();
        }
    }

    startRecognitionProcess() {
        try {
            if (this.recognition && !this.isRecording) {
                this.recognition.start();
            }
        } catch (error) {
            console.error('Error starting recognition:', error);
            this.showError('Erro ao iniciar o reconhecimento de voz.');
        }
    }

    stopRecording() {
        this.shouldRestart = false;
        if (this.recognition && this.isRecording) {
            this.recognition.stop();
            
            if (this.isProblematicDevice) {
                console.log('🔧 Parando gravação em dispositivo Samsung/Android');
                this.updateStatus('🛑 Gravação parada. Processando texto...', 'processing');
            }
        }
    }

    clearTranscript() {
        this.finalTranscript = '';
        this.transcript.innerHTML = '<p class="placeholder">A transcrição aparecerá aqui...</p>';
        this.transcript.classList.remove('has-content');
        this.jiraResult.style.display = 'none';
        this.jiraResult.innerHTML = '';
        this.updateStatus('Transcrição limpa. Pronto para nova gravação.');
    }

    startNewAppointment() {
        this.clearTranscript();
        this.updateStatus('Iniciando novo apontamento...', 'processing');
        
        // NOVO: Auto-iniciar gravação ao criar novo registro
        console.log('🎤 Auto-iniciando gravação para novo apontamento...');
        setTimeout(() => {
            this.startRecording();
        }, 500); // Pequeno delay para melhor UX
    }

    async analyzeData() {
        if (!this.finalTranscript.trim()) {
            this.showError('Nenhuma transcrição disponível para processar');
            return;
        }

        // NOVO: Auto-parar gravação ao analisar
        if (this.isRecording) {
            console.log('🛑 Auto-parando gravação para análise...');
            this.stopRecording();
        }

        // Verificar se usuário está autenticado
        const currentUser = this.getCurrentUser();
        if (!currentUser) {
            this.showError('Usuário não autenticado. Redirecionando...');
            setTimeout(() => window.location.href = '/login.html', 2000);
            return;
        }

        // Prevenir submissões duplicadas
        if (this.isSubmittingWorklog) {
            this.showError('Um apontamento já está sendo processado. Aguarde.');
            return;
        }
        this.isSubmittingWorklog = true;

        this.analyzeBtn.disabled = true;
        this.analyzeBtn.innerHTML = 'Analisando...';
        this.updateStatus('Analisando fala e carregando listas...', 'processing');

        // NOVA ABORDAGEM: SEMPRE carregar AMBAS as listas
        await this.loadBothLists();
    }

    // NOVA ABORDAGEM: Carregar AMBAS as listas ao mesmo tempo
    async loadBothLists() {
        try {
            // OBTER DATA DO CAMPO DA TELA
            const worklogDateField = document.getElementById('worklogDate');
            const selectedDate = worklogDateField ? worklogDateField.value : null;

            if (!selectedDate) {
                this.showJiraError('Data não selecionada no campo');
                this.updateStatus('❌ Selecione uma data', 'error');
                this.isSubmittingWorklog = false;
                this.analyzeBtn.disabled = false;
                this.analyzeBtn.innerHTML = 'ANALISAR';
                return;
            }

            console.log('📅 Data obtida do campo da tela:', selectedDate);

            // Extrair dados localmente primeiro
            const parseResponse = await fetch('/api/parse-voice', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.getAuthHeaders()
                },
                body: JSON.stringify({
                    voiceText: this.finalTranscript,
                    searchOnlyFavorites: false // Não importa, vamos carregar ambas
                })
            });

            const parseResult = await parseResponse.json();

            if (!parseResult.success) {
                this.showJiraError(parseResult.message);
                this.updateStatus('❌ Erro ao processar dados', 'error');
                return;
            }

            const parsedData = parseResult.parsedData;
            
            // SUBSTITUIR DATA COM A DO CAMPO DA TELA
            parsedData.date = selectedDate;
            parsedData.isSpecificDate = true; // Sempre específica agora
            
            console.log('📋 Dados extraídos (com data da tela):', parsedData);

            // LISTA 1: Favoritos filtrados por projeto + palavras-chave
            const keywords = parsedData.searchKeywords || parsedData.description || '';
            const favoriteResult = await this.filterFavoritesByKeywords(keywords, parsedData.project);

            let filteredFavorites = [];
            let autoSelectedFromFavorites = null;

            if (favoriteResult && typeof favoriteResult === 'object' && favoriteResult.autoSelected) {
                autoSelectedFromFavorites = favoriteResult.autoSelected;
                filteredFavorites = favoriteResult.allFavorites || [favoriteResult.autoSelected];
            } else if (Array.isArray(favoriteResult)) {
                filteredFavorites = favoriteResult;
            } else {
                filteredFavorites = this.favoriteTickets;
            }

            // LISTA 2: JIRA filtrados por projeto + palavras-chave
            let jiraTickets = [];
            let autoSelectedFromJira = null;

            if (parsedData.project && parsedData.searchKeywords) {
                try {
                    const searchResponse = await fetch('/api/search-tickets', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...this.getAuthHeaders()
                        },
                        body: JSON.stringify({
                            project: parsedData.project,
                            keywords: parsedData.searchKeywords
                        })
                    });

                    const searchResult = await searchResponse.json();

                    if (searchResult.success && searchResult.tickets) {
                        jiraTickets = searchResult.tickets;

                        // Verificar auto-seleção no JIRA
                        if (jiraTickets.length >= 1) {
                            const currentUser = this.getCurrentUser();
                            const userTickets = jiraTickets.filter(ticket =>
                                ticket.assignee && (
                                    ticket.assignee.includes('Paulo Peltier Fucci') ||
                                    ticket.assignee.includes(currentUser?.username)
                                )
                            );

                            if (userTickets.length === 1) {
                                autoSelectedFromJira = userTickets[0];
                            }
                        }
                    }
                } catch (error) {
                    console.error('Erro ao buscar tickets no JIRA:', error);
                }
            }

            // Preparar dados com AMBAS as listas
            parsedData.jiraTickets = jiraTickets;
            parsedData.favoriteTickets = filteredFavorites;
            parsedData.autoSelectedFromJira = autoSelectedFromJira;
            parsedData.autoSelectedFromFavorites = autoSelectedFromFavorites;

            console.log('✅ Listas carregadas:');
            console.log(`   📋 JIRA: ${jiraTickets.length} tickets`);
            console.log(`   ⭐ Favoritos: ${filteredFavorites.length} tickets`);
            console.log(`   🎯 Auto-seleção JIRA: ${autoSelectedFromJira?.key || 'NENHUMA'}`);
            console.log(`   🎯 Auto-seleção Favoritos: ${autoSelectedFromFavorites?.key || 'NENHUMA'}`);

            // Mostrar interface baseada na checkbox atual
            this.showTicketSelectionWithBothLists(parsedData);

        } catch (error) {
            console.error('Erro ao carregar listas:', error);
            this.showJiraError('Erro de conexão com o servidor');
            this.updateStatus('❌ Erro de conexão', 'error');
        } finally {
            this.isSubmittingWorklog = false;
            this.analyzeBtn.disabled = false;
            this.analyzeBtn.innerHTML = 'ANALISAR';
        }
    }

    async filterFavoritesByKeywords(keywords, project) {
        // PRIMEIRO: Filtrar favoritos por PROJETO usando busca no banco
        let projectFilteredFavorites = this.favoriteTickets;

        if (project) {
            // Buscar projetos do usuário para obter o jiraProjectKey correto
            const currentUser = this.getCurrentUser();
            let projectKey = null;
            
            if (currentUser) {
                try {
                    const response = await fetch('/api/config/projects', {
                        headers: { ...this.getAuthHeaders() }
                    });
                    const result = await response.json();

                    if (result.success && result.projects) {
                        // Encontrar o projeto correspondente
                        const projectData = result.projects.find(p => p.name === project);
                        if (projectData) {
                            projectKey = projectData.jiraProjectKey;
                            console.log(`📋 Projeto "${project}" mapeado para chave JIRA: ${projectKey}`);
                        }
                    }
                } catch (error) {
                    console.error('Erro ao carregar projetos do usuário:', error);
                }
            }

            // Se encontrou o projectKey, buscar favoritos específicos deste projeto no banco
            if (projectKey) {
                try {
                    const response = await fetch(`/api/favorites/by-project/${projectKey}`, {
                        headers: { ...this.getAuthHeaders() }
                    });
                    const result = await response.json();

                    if (result.success) {
                        projectFilteredFavorites = result.favorites || [];
                        console.log(`📋 FILTRO PROJETO (BANCO): ${projectFilteredFavorites.length} favoritos encontrados para projeto ${project} (${projectKey})`);
                    } else {
                        console.error('Erro ao buscar favoritos por projeto:', result.message);
                        projectFilteredFavorites = [];
                    }
                } catch (error) {
                    console.error('Erro ao buscar favoritos por projeto:', error);
                    projectFilteredFavorites = [];
                }
            } else {
                console.warn(`⚠️ Projeto "${project}" não encontrado nos projetos do usuário`);
                projectFilteredFavorites = [];
            }
        }

        // SEGUNDO: Se não há palavras-chave, retornar todos os favoritos do projeto
        if (!keywords || projectFilteredFavorites.length === 0) {
            console.log(`🎯 Retornando ${projectFilteredFavorites.length} favoritos filtrados apenas por projeto`);
            return projectFilteredFavorites;
        }

        // TERCEIRO: Filtrar por palavras-chave dentro dos favoritos do projeto
        const keywordArray = keywords.toLowerCase()
            .split(/\s+/)
            .filter(k => k.length > 2);

        console.log(`🔍 Filtrando favoritos com palavras-chave: [${keywordArray.join(', ')}] no projeto ${project}`);

        // Calcular score para cada favorito do projeto
        const favoritesWithScore = projectFilteredFavorites.map(ticket => {
            const ticketText = `${ticket.summary} ${ticket.description || ''}`.toLowerCase();
            const wordsFound = [];

            // BUSCA RIGOROSA: apenas palavras completas
            keywordArray.forEach(keyword => {
                const completeWordRegex = new RegExp(`\\b${keyword}\\b`, 'i');
                if (completeWordRegex.test(ticketText)) {
                    wordsFound.push(keyword);
                }
            });

            const score = wordsFound.length;

            console.log(`⭐ ${ticket.key}: "${ticket.summary}"`);
            console.log(`   Texto completo: "${ticketText}"`);
            console.log(`   Palavras procuradas: [${keywordArray.join(', ')}]`);
            console.log(`   Palavras COMPLETAS encontradas: [${wordsFound.join(', ')}] (${wordsFound.length}/${keywordArray.length})`);
            console.log(`   Score: ${score} ${score > 0 ? '✅ INCLUÍDO' : '❌ REJEITADO'}`);
            console.log('   ---');

            return {
                ...ticket,
                wordsFound,
                score: score,
                matchScore: score
            };
        });

        // FILTRO RIGOROSO: apenas favoritos com score > 0 (pelo menos 1 palavra encontrada)
        const filteredFavorites = favoritesWithScore
            .filter(ticket => {
                const included = ticket.score > 0;
                if (!included) {
                    console.log(`❌ REJEITADO: ${ticket.key} - nenhuma palavra-chave encontrada`);
                }
                return included;
            })
            .sort((a, b) => b.score - a.score); // Ordenar por score decrescente

        console.log(`🎯 RESULTADO FINAL: ${filteredFavorites.length} favoritos incluídos de ${projectFilteredFavorites.length} do projeto`);

        // VERIFICAR AUTO-SELEÇÃO:
        // 1. Apenas 1 resultado, OU
        // 2. Match exato (80%+ das palavras-chave ou 2+ palavras coincidentes)
        if (filteredFavorites.length === 1) {
            console.log(`🎯 AUTO-SELEÇÃO: Apenas 1 favorito encontrado: ${filteredFavorites[0].key}`);
            return {
                autoSelected: filteredFavorites[0],
                allFavorites: filteredFavorites
            };
        } else if (filteredFavorites.length > 1) {
            // Buscar matches muito precisos para auto-seleção
            const exactMatches = this.findExactMatches(filteredFavorites, keywordArray);
            if (exactMatches.length === 1) {
                console.log(`🎯 AUTO-SELEÇÃO: Match exato encontrado: ${exactMatches[0].key}`);
                return {
                    autoSelected: exactMatches[0],
                    allFavorites: filteredFavorites
                };
            }
        }

        return filteredFavorites;
    }

    // Novo método para encontrar matches exatos
    findExactMatches(favorites, keywordArray) {
        return favorites.filter(ticket => {
            // Critério 1: 80% ou mais das palavras-chave encontradas
            const percentMatch = (ticket.wordsFound.length / keywordArray.length) * 100;

            // Critério 2: Pelo menos 2 palavras coincidentes (para frases como "reuniões diárias")
            const multiWordMatch = ticket.wordsFound.length >= 2;

            const isExactMatch = percentMatch >= 80 || multiWordMatch;

            if (isExactMatch) {
                console.log(`🎯 MATCH EXATO: ${ticket.key} - ${percentMatch.toFixed(1)}% match, ${ticket.wordsFound.length} palavras`);
            }

            return isExactMatch;
        });
    }

    showPreview(result) {
        const { parsedData } = result;
        this.lastParsedData = parsedData;

        // Se tem ticket auto-selecionado, mostrar preview para validação
        if (parsedData.autoSelectedTicket && this.isDataComplete(parsedData)) {
            this.showApprovalOptions(parsedData); // Mudado para showApprovalOptions
            return;
        }

        // Se há múltiplos tickets para escolher, mostrar seleção
        if (parsedData.suggestedTickets && parsedData.suggestedTickets.length > 0) {
            this.showTicketSelection(parsedData);
            return;
        }

        // Se dados incompletos, mostrar sugestões
        this.showDataIncompleteMessage(parsedData);
    }

    // Função para capitalizar descrição (Title Case)
    capitalizeDescription(text, preserveOriginal = false) {
        if (!text) return text;

        // Se preserveOriginal for true, não modificar
        if (preserveOriginal) {
            return text;
        }

        // Palavras que não devem ser capitalizadas (exceto se forem a primeira palavra)
        const prepositions = ['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'na', 'no', 'para', 'com', 'por', 'o', 'a', 'os', 'as'];

        // Siglas comuns que devem permanecer em maiúsculas
        const acronyms = ['TJRJ', 'SOMPO', 'FSW', 'API', 'UI', 'UX', 'HTML', 'CSS', 'JS', 'RDM'];

        return text.split(' ').map((word, index) => {
            const cleanWord = word.toLowerCase();

            // Verificar se é uma sigla conhecida
            const acronymMatch = acronyms.find(acronym =>
                cleanWord === acronym.toLowerCase() ||
                cleanWord.includes(acronym.toLowerCase())
            );

            if (acronymMatch) {
                // Preservar a sigla em maiúsculas
                return word.replace(new RegExp(acronymMatch, 'gi'), acronymMatch);
            }

            // Primeira palavra sempre capitalizada
            if (index === 0) {
                return cleanWord.charAt(0).toUpperCase() + cleanWord.slice(1);
            }

            // Preposições e artigos em minúsculas (exceto primeira palavra)
            if (prepositions.includes(cleanWord)) {
                return cleanWord;
            }

            // Outras palavras capitalizadas
            return cleanWord.charAt(0).toUpperCase() + cleanWord.slice(1);
        }).join(' ');
    }

    getDateDescription(date) {
        const now = new Date();
        const targetDate = new Date(date);
        const diffTime = now.getTime() - targetDate.getTime();
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
            return '(hoje)';
        } else if (diffDays === 1) {
            return '(ontem)';
        } else if (diffDays === 2) {
            return '(anteontem)';
        } else {
            return ''; // Não mostra nada para datas mais distantes
        }
    }

    formatDateForDisplay(dateString, isSpecificDate) {
        // AGORA SEMPRE TRATA COMO DATA ESPECÍFICA
        // Data vem do campo da tela no formato YYYY-MM-DD
        if (typeof dateString === 'string') {
            // Se contém 'T' (ISO), extrair apenas a parte da data
            const dateOnly = dateString.includes('T') ? dateString.split('T')[0] : dateString;
            const [year, month, day] = dateOnly.split('-').map(Number);
            const displayDate = new Date(year, month - 1, day);
            console.log(`📅 [FRONTEND] Data específica (campo tela): ${displayDate.toLocaleDateString('pt-BR')}`);
            return dateOnly.split('-').reverse().join('/');
        }
        
        return new Date().toISOString().split('T')[0].split('-').reverse().join('/');
    }

    // Função auxiliar para ajustar data na exibição se necessário
    adjustDisplayDateIfNeeded(formattedDate, isSpecificDate) {
        // AGORA TODAS AS DATAS SÃO ESPECÍFICAS (do campo da tela)
        // Não precisa mais de ajuste condicional
        return formattedDate;
    }

    showValidationPreview(parsedData) {
        this.jiraResult.style.display = 'block';
        this.jiraResult.className = 'jira-result validation';

        const projectName = parsedData.projectMapped || parsedData.project;

        this.jiraResult.innerHTML = `
            <h4>✅ Validar Apontamento</h4>
            <div class="validation-info">
                <p><strong>🎫 Ticket:</strong> ${parsedData.autoSelectedTicket.key} - ${parsedData.autoSelectedTicket.summary}</p>
                <p><strong>⏰ Duração:</strong> ${parsedData.timeSpent} (${parsedData.hours || '0h'} ${parsedData.minutes || '0min'})</p>
                <p><strong>🕐 Início:</strong> ${parsedData.startTime}</p>
                <p><strong>📅 Data:</strong> ${this.adjustDisplayDateIfNeeded(this.formatDateForDisplay(parsedData.date, parsedData.isSpecificDate), parsedData.isSpecificDate)}</p>
                <p><strong>📋 Projeto:</strong> ${projectName}</p>
            </div>

            <div class="validation-actions">
                <button id="approveWithoutDescBtn" class="approve-btn primary">
                    <span class="btn-icon">✅</span>
                    APROVAR SEM DESCRIÇÃO
                    <small>(usa summary do ticket)</small>
                </button>
                <button id="approveWithDescBtn" class="approve-btn secondary">
                    <span class="btn-icon">✏️</span>
                    APROVAR COM DESCRIÇÃO
                    <small>(escolher/gravar descrição)</small>
                </button>
                <button id="cancelValidationBtn" class="cancel-btn">❌ CANCELAR</button>
            </div>
        `;

        const approveWithoutDescBtn = document.getElementById('approveWithoutDescBtn');
        const approveWithDescBtn = document.getElementById('approveWithDescBtn');
        const cancelBtn = document.getElementById('cancelValidationBtn');

        // OPÇÃO 1: Aprovar sem descrição (usa summary do ticket)
        approveWithoutDescBtn.addEventListener('click', () => {
            if (this.isSubmittingWorklog) return;

            // Desabilitar botões para evitar múltiplos cliques
            approveWithoutDescBtn.disabled = true;
            approveWithDescBtn.disabled = true;

            parsedData.description = parsedData.autoSelectedTicket.summary;
            parsedData.useTicketSummary = true;
            console.log('📝 Usando summary do ticket como descrição:', parsedData.description);
            this.logWorkToJira(parsedData);
        });

        // OPÇÃO 2: Aprovar com descrição (mostra combo de favoritas)
        approveWithDescBtn.addEventListener('click', () => {
            if (this.isSubmittingWorklog) return;
            this.showDescriptionSelection(parsedData);
        });

        cancelBtn.addEventListener('click', () => {
            this.jiraResult.style.display = 'none';
            this.updateStatus('Apontamento cancelado. Pronto para nova gravação.');
        });
    }

    // NOVA VERSÃO: Interface que usa duas listas distintas
    showTicketSelectionWithBothLists(parsedData) {
        // Verificar se há auto-seleção para mostrar aprovação direto
        const favoritesCheckbox = document.getElementById('favoritesOnly');
        const showingFavorites = favoritesCheckbox ? favoritesCheckbox.checked : true;

        const autoSelected = showingFavorites ? parsedData.autoSelectedFromFavorites : parsedData.autoSelectedFromJira;

        if (autoSelected) {
            console.log(`🎯 AUTO-SELEÇÃO CONFIRMADA (${showingFavorites ? 'Favoritos' : 'JIRA'}):`, autoSelected.key);
            parsedData.autoSelectedTicket = autoSelected;
            this.showApprovalOptions(parsedData);
            this.updateStatus(`✅ Ticket ${autoSelected.key} auto-selecionado!`, 'success');
            return;
        }

        // Mostrar seleção manual
        this.jiraResult.style.display = 'block';
        this.jiraResult.className = 'jira-result ticket-selection';

        const projectName = parsedData.projectMapped || parsedData.project;
        const originalDescription = parsedData.description || parsedData.searchKeywords || '';

        const headerText = showingFavorites ? 'Favoritos Encontrados' : 'Tickets do JIRA';
        const selectLabel = showingFavorites ? 'Seus favoritos:' : 'Tickets do JIRA:';
        const selectPlaceholder = showingFavorites ? '-- Selecione um favorito --' : '-- Selecione um ticket --';

        // Definir lista atual baseada na checkbox
        const currentList = showingFavorites ? parsedData.favoriteTickets : parsedData.jiraTickets;

        this.jiraResult.innerHTML = `
            <h4>🎯 ${headerText}</h4>
            <div class="ticket-info">
                <p><strong>⏰ Tempo:</strong> ${parsedData.timeSpent} (${parsedData.hours || '0h'} ${parsedData.minutes || '0min'})</p>
                ${parsedData.startTime ? `<p><strong>🕐 Hora de início:</strong> ${parsedData.startTime}</p>` : ''}

                 <p><strong>📅 Data:</strong> ${this.adjustDisplayDateIfNeeded(this.formatDateForDisplay(parsedData.date, parsedData.isSpecificDate), parsedData.isSpecificDate)}</p>

                <p><strong>📝 Descrição:</strong> ${originalDescription}</p>
                <p><strong>📋 Projeto:</strong> ${projectName}</p>
            </div>



            <div class="ticket-selection">
                <label for="ticketSelect" class="ticket-selection-label"><strong>🎫 ${selectLabel}</strong></label>
                <select id="ticketSelect" class="ticket-select">
                    <option value="">${selectPlaceholder}</option>
                    ${currentList.map((ticket, index) => {
                        const isFavorite = this.favoriteTickets.some(fav => fav.key === ticket.key);
                        // ÍNDICES SEMPRE DISTINTOS: fav_X para favoritos, jira_X para JIRA
                        const optionValue = showingFavorites ? `fav_${index}` : `jira_${index}`;
                        return `<option value="${optionValue}" ${isFavorite ? 'data-favorite="true"' : ''}>${ticket.key} - ${ticket.summary}${isFavorite ? ' ⭐' : ''}</option>`;
                    }).join('')}
                </select>
                <button id="confirmTicketBtn" class="confirm-btn" disabled>✅ SELECIONAR E APROVAR</button>
            </div>
        `;

        this.updateStatus(`✅ ${currentList.length} tickets encontrados - escolha um!`, 'success');

        // Event listeners para a nova interface (SEM auto-atualização na checkbox)
        this.setupTicketSelectionWithBothLists(parsedData);
    }


    showDataIncompleteMessage(parsedData) {
        this.jiraResult.style.display = 'block';
        this.jiraResult.className = 'jira-result error';

        this.jiraResult.innerHTML = `
            <h4>❌ Dados Incompletos</h4>
            <p>Não foi possível encontrar seus tickets ou extrair todas as informações necessárias.</p>
            ${this.getSuggestionsHtml(parsedData)}
        `;
    }

    getSuggestionsHtml(parsedData) {
        let suggestions = [];

        if (!parsedData.timeSpent) {
            suggestions.push('📌 Para tempo: "trabalhei duas horas" ou "dediquei 30 minutos"');
        }
        // Verificar se há tickets disponíveis (auto-selecionados, sugeridos ou selecionados)
        const hasTicket = parsedData.autoSelectedTicket || (parsedData.suggestedTickets && parsedData.suggestedTickets.length > 0) || parsedData.selectedTicket;
        if (!hasTicket) {
            suggestions.push('📌 Para ticket: mencione palavras-chave da tarefa para encontrar tickets relacionados');
        }
        if (!parsedData.project) {
            suggestions.push('📌 Para projeto: "do projeto TJRJ" ou "no TJRJ"');
        }
        if (!parsedData.description) {
            suggestions.push('📌 Para descrição: "desenvolvendo frontend" ou "em gestão"');
        }

        return `
            <div class="suggestions">
                <p class="warning">⚠️ DADOS INCOMPLETOS - Tente falar assim:</p>
                <div class="suggestion-list">
                    ${suggestions.map(s => `<p class="suggestion">${s}</p>`).join('')}
                </div>
                <p class="example"><strong>💡 Exemplo completo:</strong><br>
                "Hoje eu trabalhei duas horas no ticket 114747 do projeto TJRJ desenvolvendo frontend"</p>
            </div>
        `;
    }

    // Método mantido para compatibilidade, mas agora redireciona para showApprovalOptions
    showValidationResult(parsedData) {
        this.showApprovalOptions(parsedData);
    }

    // Renamed from logToJira to logWorkToJira
    async logWorkToJira(parsedData) {
        // Proteção adicional contra duplicação na função de registro
        if (this.isSubmittingWorklog) {
            this.showError('Um apontamento já está sendo processado. Aguarde.');
            return;
        }
        this.isSubmittingWorklog = true;

        this.analyzeBtn.disabled = true;
        this.analyzeBtn.innerHTML = 'Registrando...';
        this.updateStatus('Registrando apontamento no JIRA...', 'processing');

        try {
            const response = await fetch('/api/log-work', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.getAuthHeaders()
                },
                body: JSON.stringify({
                    parsedData: parsedData
                })
            });

            // Verificar se a resposta HTTP está ok
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();
            console.log('Resposta do servidor:', result);

            if (result.success) {
                this.showJiraSuccess(result);
                this.updateStatus('✅ Apontamento registrado com sucesso!', 'success');
            } else {
                this.showJiraError(result.message || 'Erro desconhecido');
                this.updateStatus('❌ Erro ao registrar apontamento', 'error');
            }

        } catch (error) {
            console.error('Erro completo na requisição:', error);
            this.showJiraError(`Erro de conexão: ${error.message}`);
            this.updateStatus('❌ Erro de conexão', 'error');
        } finally {
            this.isSubmittingWorklog = false;
            this.analyzeBtn.disabled = false;
            this.analyzeBtn.innerHTML = 'ANALISAR';
        }
    }


    showJiraSuccess(result) {
        this.jiraResult.style.display = 'block';
        this.jiraResult.className = 'jira-result success';

        // Obter dados do ticket usado
        const usedTicket = result.parsedData?.selectedTicket || result.parsedData?.autoSelectedTicket;
        const isAlreadyFavorite = usedTicket ? this.favoriteTickets.some(fav => fav.key === usedTicket.key) : false;

        this.jiraResult.innerHTML = `
            <h4>✅ Apontamento Registrado!</h4>
            <div class="success-info">
                <p><strong>📋 Ticket:</strong> ${result.jiraCode || 'N/A'}</p>
                 <p><strong>📅 Data:</strong> ${this.adjustDisplayDateIfNeeded(this.formatDateForDisplay(result.parsedData.date, result.parsedData.isSpecificDate), result.parsedData.isSpecificDate)}</p>
                  ${result.parsedData?.startTime ? `<p><strong>🕐 Início:</strong> ${result.parsedData.startTime}</p>` : ''}
                <p><strong>⏰ Duração:</strong> ${result.parsedData?.timeSpent || 'N/A'}</p>
                <p><strong>📝 Descrição:</strong> ${result.parsedData?.description || 'N/A'}</p>
                <p><strong>🔗 Worklog ID:</strong> ${result.worklogId || 'N/A'}</p>
                ${result.message ? `<p><strong>💬 Mensagem:</strong> ${result.message}</p>` : ''}
            </div>

            ${usedTicket && !isAlreadyFavorite ? `
            <div class="favorite-prompt">
                <p><strong>⭐ Deseja adicionar este ticket aos seus favoritos?</strong></p>
                <div class="favorite-actions">
                    <button id="addToFavoritesBtn" class="favorite-btn">⭐ SIM, FAVORITAR</button>
                    <button id="skipFavoriteBtn" class="skip-btn">❌ NÃO, OBRIGADO</button>
                </div>
            </div>
            ` : (isAlreadyFavorite ? `
            <div class="already-favorite">
                <p>⭐ <strong>Este ticket já está nos seus favoritos!</strong></p>
            </div>
            ` : '')}
        `;

        // Eventos para favoritar
        if (usedTicket && !isAlreadyFavorite) {
            const addToFavoritesBtn = document.getElementById('addToFavoritesBtn');
            const skipFavoriteBtn = document.getElementById('skipFavoriteBtn');

            addToFavoritesBtn.addEventListener('click', async () => {
                const success = await this.addToFavorites(usedTicket);
                // Atualizar interface
                const favoritePrompt = document.querySelector('.favorite-prompt');
                if (favoritePrompt) {
                    if (success) {
                        favoritePrompt.innerHTML = `
                            <div class="favorite-added">
                                <p>⭐ <strong>Ticket ${usedTicket.key} adicionado aos favoritos!</strong></p>
                            </div>
                        `;
                    } else {
                        favoritePrompt.innerHTML = `
                            <div class="favorite-error">
                                <p>❌ <strong>Erro ao adicionar aos favoritos</strong></p>
                            </div>
                        `;
                    }
                }
            });

            skipFavoriteBtn.addEventListener('click', () => {
                const favoritePrompt = document.querySelector('.favorite-prompt');
                if (favoritePrompt) {
                    favoritePrompt.style.display = 'none';
                }
            });
        }
    }



    showJiraError(message) {
        this.jiraResult.style.display = 'block';
        this.jiraResult.className = 'jira-result error';
        this.jiraResult.innerHTML = `
            <h4>❌ Erro no Apontamento</h4>
            <p>${message}</p>
            <div class="help-text">
                <p><strong>Exemplo de uso:</strong></p>
                <p>"Hoje eu trabalhei duas horas no ticket 114747 do projeto TJRJ desenvolvendo frontend"</p>
            </div>
        `;
    }

    displayTranscript(finalText, interimText) {
        const display = (finalText + interimText).trim();

        if (display) {
            this.transcript.innerHTML = `
                <div class="final-text">${finalText}</div>
                <div class="interim-text" style="color: #666; font-style: italic;">${interimText}</div>
            `;
            this.transcript.classList.add('has-content');
        }
    }

    updateUI() {
        this.startBtn.disabled = this.isRecording;
        this.stopBtn.disabled = !this.isRecording;
    }

    updateStatus(message, className = '') {
        this.status.textContent = message;
        this.status.className = 'status ' + className;
    }

    showError(message) {
        this.updateStatus('❌ ' + message, 'error');
        console.error(message);
    }

    // Método para verificar se os dados estão completos
    isDataComplete(parsedData) {
        const hasTicket = parsedData.autoSelectedTicket || (parsedData.suggestedTickets && parsedData.suggestedTickets.length > 0) || parsedData.selectedTicket;
        return parsedData.timeSpent && hasTicket && parsedData.project && parsedData.description;
    }

    // Método para seleção de ticket pelo usuário
    selectTicket(ticketKey, ticketIndex) {
        // Atualizar dados com ticket selecionado
        if (this.lastParsedData) {
            this.lastParsedData.selectedTicket = this.lastParsedData.suggestedTickets[ticketIndex];

            // Reexibir preview com dados atualizados
            this.showPreview({ success: true, parsedData: this.lastParsedData });

            this.updateStatus(`✅ Ticket ${ticketKey} selecionado!`, 'success');
        }
    }



    showJiraPreview(parsedData) {
        const { hours, ticketNumber, project, description, date } = parsedData;

        // Mapear ticket para código JIRA se possível
        let jiraCode = 'Não mapeado';
        if (ticketNumber && project) {
            // Simular mapeamento (isso virá do backend normalmente)
            if (project === 'TJRJ' && ticketNumber === '114747') {
                jiraCode = 'TJRJFSW2-419';
            }
        }

        this.jiraResult.style.display = 'block';
        this.jiraResult.innerHTML = `
            <div class="preview-header">
                <h3>🎯 Pré-visualização dos Dados Extraídos</h3>
                <div class="extraction-summary">
                    <div class="data-item ${date ? 'success' : 'error'}">
                        📅 Data: ${date ? this.adjustDisplayDateIfNeeded(this.formatDateForDisplay(parsedData.date, parsedData.isSpecificDate), parsedData.isSpecificDate) : 'hoje'}

                    </div>
                    <div class="data-item ${hours ? 'success' : 'error'}">
                        ⌚ Horas: ${hours ? hours + 'h' : 'Não identificado'}
                    </div>
                    <div class="data-item ${parsedData.autoSelectedTicket ? 'success' : (parsedData.suggestedTickets && parsedData.suggestedTickets.length > 0 ? 'warning' : 'error')}">
                        🎫 Ticket: ${parsedData.autoSelectedTicket ? `Auto: ${parsedData.autoSelectedTicket.key}` : (parsedData.suggestedTickets && parsedData.suggestedTickets.length > 0 ? 'Aguardando seleção' : 'Não identificado')}
                    </div>
                    <div class="data-item ${project ? 'success' : 'error'}">
                        📋 Projeto: ${project || 'Não identificado'}
                    </div>
                    <div class="data-item ${description ? 'success' : 'error'}">
                        📝 Descrição: ${description || 'Não identificado'}
                    </div>
                    <div class="data-item ${jiraCode !== 'Não mapeado' ? 'success' : 'warning'}">
                        🔗 Código JIRA: ${jiraCode}
                    </div>
                </div>

                ${parsedData.suggestedTickets && parsedData.suggestedTickets.length > 0 ? `
                    <div class="suggested-tickets">
                        <h4>🎫 Tickets Encontrados para "${parsedData.description}":</h4>
                        ${parsedData.suggestedTickets.map((ticket, index) => {
                            const isMyTicket = ticket.assignee === 'Paulo Peltier Fucci';
                            return `
                            <div class="ticket-suggestion ${isMyTicket ? 'my-ticket' : ''}" onclick="voiceApp.selectTicket('${ticket.key}', ${index})">
                                <strong>${ticket.key}</strong> - ${ticket.summary}
                                ${isMyTicket ? '<span class="my-badge">👤 Meu</span>' : ''}
                                <br><small>Status: ${ticket.status} | Responsável: ${ticket.assignee}</small>
                                <span class="select-badge">👆 Clique para selecionar</span>
                            </div>
                        `;}).join('')}
                    </div>
                ` : ''}
            </div>

            ${parsedData.timeSpent && ticketNumber && project ? `
                <div class="preview-actions">
                    <button class="btn btn-success" onclick="voiceRecognition.logWorkToJira(${JSON.stringify(parsedData).replace(/"/g, '&quot;')})">
                        <span class="btn-icon">✅</span> Confirmar e Registrar no JIRA
                    </button>
                </div>
            ` : `
                <div class="suggestions">
                    <h4>💡 Dicas para melhorar o reconhecimento:</h4>
                    <p>Tente falar algo como:</p>
                    <div class="example">"Trabalhei duas horas no ticket 114747 do projeto TJRJ desenvolvendo frontend"</div>
                </div>
            `}
        `;
    }

    // NOVA VERSÃO: Event listeners para interface com duas listas
    setupTicketSelectionWithBothLists(parsedData) {
        const ticketSelect = document.getElementById('ticketSelect');
        const confirmBtn = document.getElementById('confirmTicketBtn');
        const globalFavoritesCheckbox = document.getElementById('favoritesOnly');

        // LIMPAR LISTENERS ANTERIORES para prevenir duplicação
        if (globalFavoritesCheckbox) {
            // Remover todos os event listeners anteriores
            const newCheckbox = globalFavoritesCheckbox.cloneNode(true);
            globalFavoritesCheckbox.parentNode.replaceChild(newCheckbox, globalFavoritesCheckbox);

            // Adicionar novo event listener APENAS para alternar visualmente
            newCheckbox.addEventListener('change', (e) => {
                const showingFavorites = e.target.checked;
                console.log(`🔄 Checkbox alterado para: ${showingFavorites ? 'FAVORITOS' : 'JIRA'}`);
                console.log(`💡 Para aplicar o filtro, clique em ANALISAR novamente`);

                // APENAS ALTERNAR VISUALMENTE - não refazer análise
                this.updateInterfaceForCheckboxChange(parsedData, showingFavorites);
            });
        }

        // Event listener para seleção de ticket
        if (ticketSelect) {
            ticketSelect.addEventListener('change', (e) => {
                const selectedValue = e.target.value;
                if (selectedValue !== '') {
                    let selectedTicket = null;

                    // USAR LISTAS DISTINTAS baseado no prefixo
                    if (selectedValue.startsWith('fav_')) {
                        // FAVORITOS: usar parsedData.favoriteTickets
                        const favIndex = parseInt(selectedValue.replace('fav_', ''));
                        if (parsedData.favoriteTickets && parsedData.favoriteTickets[favIndex]) {
                            selectedTicket = parsedData.favoriteTickets[favIndex];
                            console.log(`⭐ Ticket selecionado dos FAVORITOS (índice ${favIndex}):`, selectedTicket.key);
                        }
                    } else if (selectedValue.startsWith('jira_')) {
                        // JIRA: usar parsedData.jiraTickets
                        const jiraIndex = parseInt(selectedValue.replace('jira_', ''));
                        if (parsedData.jiraTickets && parsedData.jiraTickets[jiraIndex]) {
                            selectedTicket = parsedData.jiraTickets[jiraIndex];
                            console.log(`📋 Ticket selecionado do JIRA (índice ${jiraIndex}):`, selectedTicket.key);
                        }
                    } else {
                        console.error('❌ Formato de valor inválido:', selectedValue);
                    }

                    if (selectedTicket) {
                        parsedData.selectedTicket = selectedTicket;
                        confirmBtn.disabled = false;
                    } else {
                        console.error('❌ Ticket não encontrado para valor:', selectedValue);
                        confirmBtn.disabled = true;
                        delete parsedData.selectedTicket;
                    }
                } else {
                    confirmBtn.disabled = true;
                    delete parsedData.selectedTicket;
                }
            });
        }

        // Event listener para confirmação
        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => {
                if (!parsedData.selectedTicket) {
                    this.showError('Selecione um ticket antes de prosseguir.');
                    return;
                }

                console.log('🎯 TICKET CONFIRMADO:', parsedData.selectedTicket.key);

                // Definir como autoSelectedTicket para consistência
                parsedData.autoSelectedTicket = parsedData.selectedTicket;

                // Sempre mostrar tela de aprovação
                this.showApprovalOptions(parsedData);
                this.updateStatus(`✅ Ticket ${parsedData.selectedTicket.key} selecionado!`, 'success');
            });
        }
    }

    // NOVO MÉTODO: Apenas atualizar interface sem refazer análise
    updateInterfaceForCheckboxChange(parsedData, showingFavorites) {
        const headerText = showingFavorites ? 'Favoritos Encontrados' : 'Tickets do JIRA';
        const selectLabel = showingFavorites ? 'Seus favoritos:' : 'Tickets do JIRA:';
        const selectPlaceholder = showingFavorites ? '-- Selecione um favorito --' : '-- Selecione um ticket --';
        const currentList = showingFavorites ? parsedData.favoriteTickets : parsedData.jiraTickets;

        // Atualizar apenas o cabeçalho e o combo
        const header = document.querySelector('.jira-result h4');
        const label = document.querySelector('.ticket-selection-label');
        const select = document.getElementById('ticketSelect');
        const confirmBtn = document.getElementById('confirmTicketBtn');

        if (header) {
            header.textContent = `🎯 ${headerText}`;
        }

        if (label) {
            label.innerHTML = `<strong>🎫 ${selectLabel}</strong>`;
        }

        if (select) {
            select.innerHTML = `
                <option value="">${selectPlaceholder}</option>
                ${currentList.map((ticket, index) => {
                    const isFavorite = this.favoriteTickets.some(fav => fav.key === ticket.key);
                    const optionValue = showingFavorites ? `fav_${index}` : `jira_${index}`;
                    return `<option value="${optionValue}" ${isFavorite ? 'data-favorite="true"' : ''}>${ticket.key} - ${ticket.summary}${isFavorite ? ' ⭐' : ''}</option>`;
                }).join('')}
            `;

            // Resetar seleção
            select.value = '';
            if (confirmBtn) {
                confirmBtn.disabled = true;
            }
            delete parsedData.selectedTicket;
        }

        this.updateStatus(`✅ ${currentList.length} tickets encontrados - escolha um!`, 'success');
    }

    // Implementar fluxo de aprovação com/sem descrição
    showApprovalOptions(parsedData) {
        // Usar o ticket que foi selecionado (autoSelectedTicket ou selectedTicket)
        const selectedTicket = parsedData.autoSelectedTicket || parsedData.selectedTicket;

        if (!selectedTicket) {
            console.error('❌ Nenhum ticket selecionado para aprovação');
            this.showError('Erro: nenhum ticket selecionado');
            return;
        }

        console.log('🎯 Mostrando opções de aprovação para ticket:', selectedTicket.key);

        this.jiraResult.style.display = 'block';
        this.jiraResult.className = 'jira-result approval';
        this.jiraResult.innerHTML = `
            <h4>✅ Aprovar Apontamento</h4>
            <div class="validation-info">
                <p><strong>🎫 Ticket:</strong> ${selectedTicket.key} - ${selectedTicket.summary}</p>
                <p><strong>⏰ Duração:</strong> ${parsedData.timeSpent}</p>
                <p><strong>🕐 Início:</strong> ${parsedData.startTime || 'Não especificado'}</p>
                <p><strong>📅 Data:</strong> ${this.adjustDisplayDateIfNeeded(this.formatDateForDisplay(parsedData.date, parsedData.isSpecificDate), parsedData.isSpecificDate)}</p>
                <p><strong>📋 Projeto:</strong> ${parsedData.project}</p>
                <p><strong>📝 Palavras-chave:</strong> "${parsedData.searchKeywords || parsedData.description}"</p>
            </div>
            <div class="approval-buttons">
                <button id="approveWithoutDescBtn" class="approve-btn primary">
                    APROVAR SEM DESCRIÇÃO
                    <small>(usar descrição do próprio ticket)</small>
                </button>
                <button id="approveWithDescBtn" class="approve-btn secondary">
                    APROVAR COM DESCRIÇÃO
                    <small>(escolher das favoritas ou gravar nova)</small>
                </button>
                <button id="cancelValidationBtn" class="cancel-btn">CANCELAR</button>
            </div>
        `;

        // Aguardar o DOM ser atualizado antes de adicionar event listeners
        setTimeout(() => {
            const approveWithoutDescBtn = document.getElementById('approveWithoutDescBtn');
            const approveWithDescBtn = document.getElementById('approveWithDescBtn');
            const cancelBtn = document.getElementById('cancelValidationBtn');

            if (approveWithoutDescBtn) {
                // OPÇÃO 1: Aprovar sem descrição (usa summary do ticket)
                approveWithoutDescBtn.addEventListener('click', () => {
                    parsedData.description = selectedTicket.summary;
                    parsedData.useTicketSummary = true;
                    console.log('📝 Usando summary do ticket como descrição:', parsedData.description);
                    this.logWorkToJira(parsedData);
                });
            }

            if (approveWithDescBtn) {
                // OPÇÃO 2: Aprovar com descrição (mostra combo de favoritas)
                approveWithDescBtn.addEventListener('click', () => {
                    this.showDescriptionSelection(parsedData);
                });
            }

            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => {
                    this.jiraResult.style.display = 'none';
                    this.updateStatus('Apontamento cancelado.');
                });
            }
        }, 100);
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('Initializing Voice Recognition App...');
    window.voiceRecognition = new VoiceRecognition(); // Make it globally accessible for onclick
});

// PWA Service Worker registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then((registration) => {
                console.log('SW registered: ', registration);
            })
            .catch((registrationError) => {
                console.log('SW registration failed: ', registrationError);
            });
    });
}