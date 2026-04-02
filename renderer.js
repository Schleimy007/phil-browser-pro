// renderer.js
let START_PAGE = '';
const sessionStartTime = Date.now();

// 🛡️ DEINE PERFEKTE PROFI-VERSION DES XSS-FILTERS
const escapeHTML = (str) => {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[tag] || tag));
};

function formatAIResponse(text) {
    if (!text) return '';
    let formatted = escapeHTML(text);
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/### (.*?)\n/g, '<h4 style="margin:10px 0 5px 0;">$1</h4>');
    formatted = formatted.replace(/## (.*?)\n/g, '<h3 style="margin:12px 0 6px 0;">$1</h3>');
    formatted = formatted.replace(/\n/g, '<br>');
    return formatted;
}

function stringToColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return `hsl(${Math.abs(hash) % 360}, 80%, 60%)`;
}

class BrowserApp {
    constructor() {
        this.settings = new SettingsManager();
        this.privacy = new PrivacyManager(this);
        this.session = new SessionManager(this);
        this.extensions = new ExtensionManager(this);

        this.history = JSON.parse(localStorage.getItem('phil_history')) || [];
        this.downloads = JSON.parse(localStorage.getItem('phil_downloads')) || [];
        this.bookmarks = JSON.parse(localStorage.getItem('phil_bookmarks')) || [];
        this.activeDownloads = {};
        
        this.currentChatHistory = [];
        this.currentChatUses = 0;

        this.tabManager = null;
        this.ui = new UIManager(this);
        this.omnibox = new OmniboxController(this);
        this.cmdPalette = new CommandPalette(this);

        this.init();

        window.addEventListener('beforeunload', () => {
            if (this.settings.get('clearOnExit')) localStorage.removeItem('phil_history');
            if (!this.settings.get('keepDownloads')) localStorage.removeItem('phil_downloads');
            this.session.saveSession();
        });
    }

    async init() {
        const appPath = await window.electronAPI.getAppPath();
        this.appPath = appPath;
        
        window.IS_DRM_ENABLED = await window.electronAPI.getDRMState();

        const fileArgUrl = await window.electronAPI.getStartArgs();

        let customStart = this.settings.get('startPage');

        if (fileArgUrl) {
            START_PAGE = fileArgUrl;
        } else if (customStart && customStart !== 'default' && customStart.trim() !== '') {
            if (!customStart.startsWith('http') && !customStart.startsWith('file://')) {
                customStart = 'https://' + customStart;
            }
            START_PAGE = customStart;
        } else {
            START_PAGE = `file://${appPath}/start.html`;
        }

        this.tabManager = new TabManager(this);
        this.settings.bindUI(this);
        this.ui.applyTheme(this.settings.get('theme'));
        this.ui.renderBookmarks();
        await this.extensions.load();
        this.setupIPC();
        this.session.restoreSession(START_PAGE);

        setTimeout(async () => {
            const isDefault = await window.electronAPI.isDefaultBrowser();
            if (!isDefault) {
                this.ui.showDefaultBrowserPrompt();
            }
        }, 5000);
    }

    checkAILimit() {
        const today = new Date().toDateString();
        let usage = JSON.parse(localStorage.getItem('phil_ai_usage')) || { date: today, count: 0 };
        if (usage.date !== today) usage = { date: today, count: 0 };
        if (usage.count >= 150) return false;
        usage.count++;
        localStorage.setItem('phil_ai_usage', JSON.stringify(usage));
        return usage.count;
    }

    setupIPC() {
        window.electronAPI.onShowToast((msg) => this.ui.showToast(msg));
        window.electronAPI.onAdBlocked((count) => document.getElementById('ad-counter').textContent = count);
        window.electronAPI.onDownloadStart((data) => this.ui.handleDownloadStart(data));
        window.electronAPI.onDownloadProgress((data) => this.ui.handleDownloadProgress(data));
        window.electronAPI.onDownloadDone((data) => this.ui.handleDownloadDone(data));

        window.electronAPI.onAIAction(async(data) => {
            this.ui.showModal('ai-modal');
            const aiContent = document.getElementById('ai-content');
            
            const usageCount = this.checkAILimit();
            if (!usageCount) {
                aiContent.innerHTML = `<div style="color:var(--danger); padding:20px;">🚨 Daily Limit erreicht! Komm morgen wieder (Max. 150 Anfragen/Tag).</div>`;
                return;
            }

            this.currentChatUses = 1;
            this.currentChatHistory = [
                { role: 'system', content: 'Du bist der intelligente Assistent des Phil Browser Pro. Du antwortest immer auf Deutsch. WICHTIG: Wenn du zu einer Person, einem Ereignis oder Begriff keine topaktuellen Daten hast, MUSST du zwingend das Internet durchsuchen (Deep Search). Wenn du es nicht weißt, suche!' }
            ];

            let initialDisplayHTML = '';

            aiContent.innerHTML = `
                <div id="chat-messages" style="height: 350px; overflow-y: auto; padding-right: 10px; display: flex; flex-direction: column; gap: 12px; margin-bottom: 15px;">
                </div>
                <div style="display: flex; gap: 10px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 15px; align-items: center;">
                    <input type="text" id="chat-input" placeholder="Frag etwas dazu..." style="flex: 1; padding: 12px 16px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.4); color: white; font-family: inherit; outline: none; transition: 0.2s;">
                    <button id="chat-send" class="win-btn" style="width: 42px; height: 42px; min-width: 42px; padding: 0; display: flex; align-items: center; justify-content: center; background: #6366f1; color: white; border-radius: 50%; font-size: 20px; cursor: pointer; border: none;">
                        <i class="ph ph-paper-plane-right" style="margin-left: 2px;"></i>
                    </button>
                </div>
                <div style="font-size: 11px; color: var(--text-muted); margin-top: 8px; display: flex; justify-content: space-between;">
                    <span id="ai-model-info"><i class="ph ph-spinner ph-spin"></i> Verbinde zu KI...</span>
                    <span id="chat-counter">${this.currentChatUses}/20 Nachrichten</span>
                </div>
                <style>
                    #chat-input:focus { border-color: #6366f1 !important; }
                    #chat-send:hover { background: #4f46e5 !important; transform: scale(1.05); }
                    .chat-bubble { padding: 12px 16px; border-radius: 12px; max-width: 90%; line-height: 1.6; }
                    .chat-user { background: #6366f1; color: white; align-self: flex-end; border-bottom-right-radius: 2px; }
                    .chat-ai { background: rgba(255,255,255,0.05); color: var(--text-main); align-self: flex-start; border-left: 3px solid #10b981; border-bottom-left-radius: 2px; }
                </style>
            `;

            const chatMessages = document.getElementById('chat-messages');
            const chatInput = document.getElementById('chat-input');
            const chatSend = document.getElementById('chat-send');
            const chatCounter = document.getElementById('chat-counter');

            const appendMessage = (role, htmlContent) => {
                const msg = document.createElement('div');
                msg.className = `chat-bubble ${role === 'user' ? 'chat-user' : 'chat-ai'}`;
                msg.innerHTML = htmlContent;
                chatMessages.appendChild(msg);
                chatMessages.scrollTop = chatMessages.scrollHeight;
            };

            const triggerAI = async () => {
                const loadingId = 'loading-' + Date.now();
                appendMessage('assistant', `<span id="${loadingId}"><i class="ph ph-spinner ph-spin text-green"></i> KI denkt nach...</span>`);
                chatInput.disabled = true; chatSend.disabled = true;

                try {
                    const result = await window.electronAPI.fetchAI(this.currentChatHistory);
                    
                    const loadingEl = document.getElementById(loadingId);
                    if (loadingEl) loadingEl.parentElement.remove();

                    if (!result.success) {
                         appendMessage('assistant', `<span style="color:var(--danger);">🚨 API Fehler: ${escapeHTML(result.error)}</span>`);
                    } else {
                         this.currentChatHistory.push({ role: 'assistant', content: result.text });
                         appendMessage('assistant', formatAIResponse(result.text));
                         if(result.usedModel) {
                             document.getElementById('ai-model-info').innerHTML = `<i class="ph ph-cpu"></i> Läuft auf: ${escapeHTML(result.usedModel.split('/')[1] || 'Auto')}`;
                         }
                    }
                } catch (err) {
                    const loadingEl = document.getElementById(loadingId);
                    if (loadingEl) loadingEl.parentElement.remove();
                    appendMessage('assistant', `<span style="color:var(--danger);">🚨 Systemfehler: ${escapeHTML(err.message)}</span>`);
                }

                chatInput.disabled = false; chatSend.disabled = false;
                chatInput.focus();
            };

            if (data.type === 'image') {
                document.getElementById('ai-model-info').innerHTML = '<i class="ph ph-image"></i> Bild-Modus (Auto-Fallback)';

                initialDisplayHTML = `<strong>${escapeHTML(data.task)}</strong><br><img src="${data.url}" style="max-height: 100px; border-radius: 8px; margin-top: 10px;">`;
                appendMessage('user', initialDisplayHTML);
                
                const loadingId = 'loading-img-' + Date.now();
                appendMessage('assistant', `<span id="${loadingId}"><i class="ph ph-spinner ph-spin text-green"></i> Mache Screenshot...</span>`);
                
                const base64Data = await window.electronAPI.fetchImage({ x: data.x, y: data.y });
                document.getElementById(loadingId).parentElement.remove();

                if (!base64Data) {
                    appendMessage('assistant', `<span style="color:var(--danger);">🚨 Fehler: Konnte den Bereich nicht scannen.</span>`);
                    return;
                }

                this.currentChatHistory.push({
                    role: 'user',
                    content: [
                        { type: 'text', text: data.task },
                        { type: 'image_url', image_url: { url: base64Data } }
                    ]
                });
                await triggerAI();
            } else {
                document.getElementById('ai-model-info').innerHTML = '<i class="ph ph-magnifying-glass"></i> Deep Search aktiv';
                
                initialDisplayHTML = `<strong>Aktion:</strong> ${escapeHTML(data.task)}<br><i>"${escapeHTML(data.text)}"</i>`;
                appendMessage('user', initialDisplayHTML);
                
                this.currentChatHistory.push({ role: 'user', content: `${data.task}\n\n${data.text}` });
                await triggerAI();
            }

            const handleSend = async () => {
                const text = chatInput.value.trim();
                if (!text) return;
                
                if (this.currentChatUses >= 20) {
                    appendMessage('assistant', `<span style="color:var(--danger);">Limit von 20 Nachrichten erreicht. Bitte starte einen neuen Chat!</span>`);
                    chatInput.disabled = true;
                    return;
                }

                chatInput.value = '';
                this.currentChatUses++;
                chatCounter.textContent = `${this.currentChatUses}/20 Nachrichten`;

                appendMessage('user', escapeHTML(text));
                
                this.currentChatHistory.push({ role: 'user', content: text });
                
                await triggerAI();
            };

            chatSend.addEventListener('click', handleSend);
            chatInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') handleSend();
            });
            setTimeout(() => chatInput.focus(), 100);
        });

        window.electronAPI.onTabAction((data) => {
            const tab = this.tabManager.tabs.get(this.tabManager.activeTabId);
            
            if (data.action === 'duplicate') {
                const t = this.tabManager.tabs.get(data.id);
                if (t) this.tabManager.createTab(t.url, t.isPrivate);
            }
            if (data.action === 'close-others') {
                Array.from(this.tabManager.tabs.keys()).forEach(id => { if (id !== data.id) this.tabManager.closeTab(id); });
            }
            if (data.action === 'devtools') {
                const t = this.tabManager.tabs.get(data.id);
                if (t) t.webview.openDevTools();
            }
            if (data.action === 'new-tab-url') {
                this.tabManager.createTab(data.url);
            }
            if (data.action === 'new-private-tab-url') {
                this.tabManager.createTab(data.url, true);
            }
            if (data.action === 'search-web') {
                const searchUrl = this.settings.get('searchEngine') + encodeURIComponent(data.text);
                this.tabManager.createTab(searchUrl);
            }
            if (data.action === 'inspect-element' && tab) {
                try { tab.webview.inspectElement(data.x, data.y); } catch(e){}
            }
            if (data.action === 'go-back' && tab) {
                try { if(tab.webview.canGoBack()) tab.webview.goBack(); } catch(e){}
            }
            if (data.action === 'go-forward' && tab) {
                try { if(tab.webview.canGoForward()) tab.webview.goForward(); } catch(e){}
            }
            if (data.action === 'reload' && tab) {
                try { tab.webview.reload(); } catch(e){}
            }
            if (data.action === 'bookmark-url') {
                const existsIndex = this.bookmarks.findIndex(b => b.url === data.url);
                if (existsIndex < 0) {
                    this.bookmarks.push({ url: data.url, title: data.title });
                    localStorage.setItem('phil_bookmarks', JSON.stringify(this.bookmarks));
                    this.ui.renderBookmarks();
                    this.ui.showToast('Lesezeichen gespeichert! ⭐');
                }
            }
        });

        window.electronAPI.onExecuteFind((data) => {
            const tab = this.tabManager.tabs.get(data.tabId);
            if (tab && data.text) tab.webview.findInPage(data.text);
            else if (tab) tab.webview.stopFindInPage('clearSelection');
        });

        setInterval(async() => {
            try {
                const mem = await window.electronAPI.getMemoryInfo();
                const freeMB = Math.round(mem.free / 1024);
                const hud = document.getElementById('perf-hud');
                hud.textContent = `RAM: ${freeMB} MB frei`;
                hud.className = `perf-hud ${freeMB < 1000 ? 'critical' : (freeMB < 2048 ? 'warning' : '')}`;
            } catch (e) {}
        }, 3000);
    }
}

class TabManager {
    constructor(app) {
        this.app = app;
        this.tabs = new Map();
        this.activeTabId = null;
        this.tabCounter = 0;
        this.isSplit = false;

        document.getElementById('btn-new-tab').addEventListener('click', () => this.createTab());
        document.getElementById('menu-new-private').addEventListener('click', () => {
            this.createTab(START_PAGE, true);
            document.getElementById('main-menu').classList.remove('active');
        });

        setInterval(() => this.checkSnoozing(), 60000);
    }

    createTab(url = START_PAGE, isPrivate = false, lazy = false) {
        if (this.tabs.size >= 50) { this.app.ui.showToast("Tab-Limit erreicht."); return null; }

        this.tabCounter++;
        const id = `tab-${this.tabCounter}`;

        const webview = document.createElement('webview');
        webview.id = `view-${id}`;
        webview.src = lazy ? 'about:blank' : url;
        webview.setAttribute('allowpopups', '');
        
        if (window.IS_DRM_ENABLED) {
            webview.setAttribute('plugins', ''); 
            webview.setAttribute('useragent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
        }

        webview.setAttribute('partition', isPrivate ? 'in-memory' : 'persist:session');
        document.getElementById('workspace').appendChild(webview);

        const tabEl = document.createElement('div');
        tabEl.className = `tab ${isPrivate ? 'private-tab' : ''}`;
        tabEl.id = `ui-${id}`;
        tabEl.setAttribute('draggable', 'true');
        tabEl.title = url;
        tabEl.innerHTML = `
            <div class="tab-icon" id="icon-${id}"><i class="ph ph-circle-notch ph-spin"></i></div>
            <div class="tab-title" id="title-${id}">Lade...</div>
            <button class="tab-mute" title="Stummschalten"><i class="ph ph-speaker-high"></i></button>
            <button class="tab-close"><i class="ph ph-x"></i></button>
        `;

        tabEl.addEventListener('click', (e) => {
            if (e.target.closest('.tab-close') || e.target.closest('.tab-mute')) return;
            this.switchTab(id);
        });

        tabEl.addEventListener('auxclick', (e) => {
            if (e.button === 1) this.createTab(this.tabs.get(id).url, isPrivate);
        });

        tabEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            window.electronAPI.showTabMenu(id);
        });
        tabEl.querySelector('.tab-close').addEventListener('click', (e) => {
            e.stopPropagation();
            this.closeTab(id);
        });

        tabEl.querySelector('.tab-mute').addEventListener('click', (e) => {
            e.stopPropagation();
            const isMuted = webview.isAudioMuted();
            webview.setAudioMuted(!isMuted);
            e.currentTarget.innerHTML = !isMuted ? '<i class="ph ph-speaker-slash text-danger"></i>' : '<i class="ph ph-speaker-high"></i>';
        });

        tabEl.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', id));
        tabEl.addEventListener('dragover', (e) => e.preventDefault());
        tabEl.addEventListener('drop', (e) => this.handleDrop(e, id));

        document.getElementById('tabs-list').appendChild(tabEl);

        const tabData = { id, webview, tabEl, url, title: 'Neu', isPrivate, isSnoozed: lazy, lastActive: Date.now(), currentZoom: 1, isReady: false };
        this.tabs.set(id, tabData);

        this.bindEvents(tabData);
        if (!lazy) this.switchTab(id);

        this.app.session.saveSession();
        return id;
    }

    bindEvents(tabData) {
        const { webview, id, tabEl } = tabData;

        const updateNavLive = (eUrl) => {
            tabData.url = eUrl;
            tabEl.title = tabData.title + "\n" + eUrl;

            try {
                if (!eUrl.startsWith('file://')) {
                    const hostname = new URL(eUrl).hostname;
                    tabEl.style.borderTop = `3px solid ${stringToColor(hostname)}`;
                } else {
                    tabEl.style.borderTop = `3px solid transparent`;
                }
            } catch (err) {}

            if (this.activeTabId === id) {
                this.app.ui.updateNavigationState(eUrl, webview);
                this.app.ui.updateDiscordPresence(tabData);
            }
            if (!tabData.isPrivate && !eUrl.includes('start.html') && !eUrl.includes('offline.html')) {
                const titleToSave = webview.getTitle() || eUrl;
                if (this.app.history.length === 0 || this.app.history[0].url !== eUrl) {
                    this.app.history.unshift({ url: eUrl, title: titleToSave, time: Date.now() });
                    if (this.app.history.length > 2000) this.app.history.pop();
                    localStorage.setItem('phil_history', JSON.stringify(this.app.history));
                }
            }
            this.app.session.saveSession();
        };

        webview.addEventListener('did-navigate', (e) => updateNavLive(e.url));
        webview.addEventListener('did-navigate-in-page', (e) => updateNavLive(e.url));

        webview.addEventListener('did-fail-load', (e) => {
            if (e.errorCode === -106) {
                webview.loadURL(`file://${this.app.appPath}/offline.html`);
            }
        });

        webview.addEventListener('dom-ready', async () => {
            tabData.isReady = true; 
            if (this.activeTabId === id) this.app.ui.updateNavigationState(tabData.url, webview);

            this.app.extensions.inject(webview);

            if (!tabData.isPrivate) {
                try {
                    const url = new URL(webview.src);
                    const domain = url.hostname;
                    const creds = await window.electronAPI.getCredentials(domain);
                    if (creds) {
                        webview.executeJavaScript(`
                            setTimeout(() => {
                                const pw = document.querySelector('input[type="password"]');
                                if (pw) {
                                    pw.value = '${creds.password}';
                                    const user = document.querySelector('input[type="text"], input[type="email"], input[name*="user"], input[name*="login"]');
                                    if (user) user.value = '${creds.username}';
                                }
                            }, 800);
                            null;
                        `).catch(()=>{});
                    }

                    webview.executeJavaScript(`
                        document.addEventListener('submit', (e) => {
                            const pw = document.querySelector('input[type="password"]');
                            if (pw && pw.value) {
                                const userField = document.querySelector('input[type="text"], input[type="email"], input[name*="user"], input[name*="login"]');
                                const username = userField ? userField.value : '';
                                console.log('PHIL_LOGIN_CAPTURE|' + location.hostname + '|' + username + '|' + pw.value);
                            }
                        });
                        null;
                    `).catch(()=>{});
                } catch(e) {}
            }

            webview.executeJavaScript(`
                let __startX = 0;
                document.addEventListener('mousedown', e => { if (e.button === 2) { __startX = e.clientX; } });
                document.addEventListener('mouseup', e => {
                    if (e.button === 2 && __startX > 0) {
                        const diff = e.clientX - __startX;
                        if (diff > 120) window.history.forward();
                        else if (diff < -120) window.history.back();
                        __startX = 0;
                    }
                });
                null;
            `).catch(e => {});
        });

        webview.addEventListener('console-message', (e) => {
            if (e.message.startsWith('PHIL_LOGIN_CAPTURE|')) {
                const parts = e.message.split('|');
                this.app.ui.showPasswordPrompt(parts[1], parts[2], parts[3]);
            }
        });

        webview.addEventListener('page-title-updated', (e) => {
            tabData.title = e.title;
            document.getElementById(`title-${id}`).textContent = e.title;
            tabEl.title = e.title + "\n" + tabData.url;
            if (this.activeTabId === id) this.app.ui.updateDiscordPresence(tabData);
        });

        webview.addEventListener('page-favicon-updated', (e) => {
            if (e.favicons && e.favicons.length > 0) {
                document.getElementById(`icon-${id}`).innerHTML = `<img src="${e.favicons[0]}" alt="">`;
            }
        });

        webview.addEventListener('context-menu', (e) => {
            window.electronAPI.showContextMenu(e.params);
        });

        webview.addEventListener('new-window', (e) => {
            e.preventDefault();
            if (e.url.startsWith('http://') || e.url.startsWith('https://') || e.url === START_PAGE) {
                this.createTab(e.url, tabData.isPrivate);
            }
        });
    }

    switchTab(id) {
        const oldTab = this.tabs.get(this.activeTabId);
        if (oldTab) oldTab.lastActive = Date.now();

        this.activeTabId = id;
        const currentTab = this.tabs.get(id);
        if (!currentTab) return;

        if (currentTab.isSnoozed) {
            currentTab.webview.src = currentTab.url;
            currentTab.isSnoozed = false;
            currentTab.tabEl.classList.remove('snoozed');
        }

        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.workspace webview').forEach(v => {
            v.classList.remove('active');
            v.classList.remove('split-secondary');
        });

        currentTab.tabEl.classList.add('active');
        currentTab.webview.classList.add('active');

        if (currentTab.isPrivate) document.body.classList.add('incognito-active');
        else document.body.classList.remove('incognito-active');

        if (this.isSplit && this.tabs.size > 1) {
            const otherTab = Array.from(this.tabs.values()).find(t => t.id !== id && !t.isSnoozed);
            if (otherTab) otherTab.webview.classList.add('split-secondary');
        }

        this.app.ui.updateNavigationState(currentTab.url, currentTab.webview);
        this.app.ui.updateDiscordPresence(currentTab);
        currentTab.tabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });

        document.getElementById('find-bar').classList.remove('active');
        this.app.session.saveSession();
    }

    closeTab(id) {
        const tab = this.tabs.get(id);
        if (!tab) return;
        tab.tabEl.remove();
        tab.webview.remove();
        this.tabs.delete(id);

        if (this.tabs.size === 0) {
            window.electronAPI.windowControl('close');
        } else if (this.activeTabId === id) {
            const remainingIds = Array.from(this.tabs.keys());
            this.switchTab(remainingIds[remainingIds.length - 1]);
        }
        this.app.session.saveSession();
    }

    handleDrop(e, targetId) {
        const draggedId = e.dataTransfer.getData('text/plain');
        if (draggedId && draggedId !== targetId) {
            const tabsList = document.getElementById('tabs-list');
            const draggedEl = document.getElementById(`ui-${draggedId}`);
            const targetEl = document.getElementById(`ui-${targetId}`);
            tabsList.insertBefore(draggedEl, targetEl);
        }
    }

    checkSnoozing() {
        if (!this.app.settings.get('snoozingEnabled')) return;
        const now = Date.now();
        const SNOOZE_TIMEOUT = 5 * 60 * 1000;

        this.tabs.forEach((tab, id) => {
            if (id !== this.activeTabId && !tab.isSnoozed && (now - tab.lastActive > SNOOZE_TIMEOUT)) {
                tab.isSnoozed = true;
                tab.webview.src = 'about:blank';
                tab.tabEl.classList.add('snoozed');
            }
        });
    }

    toggleSplitView() {
        this.isSplit = !this.isSplit;
        document.getElementById('workspace').classList.toggle('split-active', this.isSplit);
        this.switchTab(this.activeTabId);
    }
}

class OmniboxController {
    constructor(app) {
        this.app = app;
        this.input = document.getElementById('url-input');
        this.suggestionsBox = document.getElementById('omnibox-suggestions');

        this.input.addEventListener('input', (e) => this.handleInput(e.target.value));
        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.navigate(this.input.value);
                this.hideSuggestions();
                this.input.blur();
            }
        });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.omnibox-wrapper')) this.hideSuggestions();
        });
    }

    handleInput(query) {
        if (!query) { this.hideSuggestions(); return; }
        if (query.startsWith('yt ')) {
            this.showSuggestions([{ title: `YouTube Suche: ${query.substring(3)}`, url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query.substring(3))}` }]);
            return;
        }

        const uniqueMatches = [];
        const seenUrls = new Set();

        for (const b of this.app.bookmarks) {
            if ((b.url.includes(query) || b.title.toLowerCase().includes(query.toLowerCase())) && !seenUrls.has(b.url)) {
                uniqueMatches.push({...b, isBookmark: true });
                seenUrls.add(b.url);
            }
        }

        for (const h of this.app.history) {
            if ((h.url.includes(query) || h.title.toLowerCase().includes(query.toLowerCase())) && !seenUrls.has(h.url)) {
                uniqueMatches.push(h);
                seenUrls.add(h.url);
            }
            if (uniqueMatches.length >= 6) break;
        }

        if (uniqueMatches.length > 0) this.showSuggestions(uniqueMatches);
        else this.showSuggestions([{ title: `Suchen nach: ${query}`, url: query }]);
    }

    showSuggestions(items) {
            this.suggestionsBox.innerHTML = items.map(item => `
            <div class="suggestion-item" data-url="${escapeHTML(item.url)}">
                <i class="ph ${item.isBookmark ? 'ph-star text-star' : (item.url.startsWith('http') ? 'ph-clock' : 'ph-magnifying-glass')}"></i>
                <div class="sugg-text">
                    <div class="sugg-title">${escapeHTML(item.title)}</div>
                    ${item.url !== item.title ? `<div class="sugg-url">${escapeHTML(item.url)}</div>` : ''}
                </div>
            </div>
        `).join('');
        this.suggestionsBox.classList.add('active');

        this.suggestionsBox.querySelectorAll('.suggestion-item').forEach(el => {
            el.addEventListener('click', () => {
                const url = el.getAttribute('data-url');
                this.input.value = url;
                this.navigate(url);
                this.hideSuggestions();
            });
        });
    }

    hideSuggestions() { this.suggestionsBox.classList.remove('active'); }

    navigate(query) {
        const activeTab = this.app.tabManager.tabs.get(this.app.tabManager.activeTabId);
        if (!activeTab) return;

        let url = query.trim();
        const domainRegex = /^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/.*)?$/;
        
        if (domainRegex.test(url)) url = 'https://' + url;
        else if (!url.includes('.') || url.includes(' ')) url = this.app.settings.get('searchEngine') + encodeURIComponent(url);
        else if (!url.startsWith('http') && !url.startsWith('file://')) url = 'https://' + url;
        
        activeTab.webview.loadURL(url);
    }
}

class CommandPalette {
    constructor(app) {
        this.app = app;
        this.overlay = document.getElementById('cmd-overlay');
        this.input = document.getElementById('cmd-input');
        this.results = document.getElementById('cmd-results');
        
        this.commands = [
            { name: "Split-View umschalten", icon: "ph-columns", action: () => document.getElementById('menu-splitview').click() },
            { name: "Einstellungen öffnen", icon: "ph-gear", action: () => this.app.ui.showModal('settings-modal') },
            { name: "Neuer Tab", icon: "ph-plus", action: () => this.app.tabManager.createTab() },
            { name: "Neuer Privater Tab", icon: "ph-mask-happy", action: () => this.app.tabManager.createTab(START_PAGE, true) },
            { name: "Erweiterungen", icon: "ph-puzzle-piece", action: () => this.app.ui.showModal('extensions-modal') },
            { name: "Verlauf durchsuchen", icon: "ph-clock", action: () => this.app.ui.showModal('history-modal') },
            { name: "Downloads anzeigen", icon: "ph-download", action: () => document.querySelector('[data-modal="downloads-modal"]').click() },
            { name: "Screenshot der Seite", icon: "ph-camera", action: () => this.app.ui.takeScreenshot() },
            { name: "Farbpipette (Color Picker)", icon: "ph-eyedropper", action: () => this.app.ui.pickColor() },
            { name: "Seite Drucken", icon: "ph-printer", action: () => this.app.ui.getActiveWebview()?.print() },
            { name: "Notizen öffnen", icon: "ph-note", action: () => document.getElementById('btn-notes').click() }
        ];

        document.getElementById('menu-cmd').onclick = () => this.open();
        this.input.addEventListener('input', (e) => this.renderResults(e.target.value.toLowerCase()));
        this.overlay.addEventListener('click', (e) => { if(e.target === this.overlay) this.close(); });
    }

    open() {
        this.overlay.classList.add('active');
        this.input.value = '';
        this.input.focus();
        this.renderResults('');
    }

    close() {
        this.overlay.classList.remove('active');
    }

    renderResults(query) {
        this.results.innerHTML = '';
        const filtered = this.commands.filter(c => c.name.toLowerCase().includes(query));
        filtered.forEach(c => {
            const el = document.createElement('div');
            el.className = 'cmd-item';
            el.innerHTML = `<i class="ph ${c.icon}"></i> ${c.name}`;
            el.onclick = () => { c.action(); this.close(); };
            this.results.appendChild(el);
        });
    }
}

class UIManager {
    constructor(app) {
        this.app = app;
        this.setupEventListeners();
        this.initNotes();
        this.injectDRMToggle(); 
    }

    injectDRMToggle() {
        setTimeout(() => {
            const settingsBody = document.querySelector('#settings-modal .modal-body');
            if (settingsBody) {
                const drmHtml = `
                <div class="setting-item" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; padding: 15px; background: rgba(255,255,255,0.05); border-radius: 8px;">
                    <div style="flex: 1;">
                        <strong style="display: block; margin-bottom: 4px;">🎬 Netflix / DRM Modus</strong>
                        <div style="font-size: 12px; color: var(--text-muted);">Aktiviert Kopierschutz (Browser startet neu!)</div>
                    </div>
                    <label class="switch" style="margin: 0; flex-shrink: 0;">
                        <input type="checkbox" id="toggle-drm" ${window.IS_DRM_ENABLED ? 'checked' : ''}>
                        <span class="slider round"></span>
                    </label>
                </div>`;
                settingsBody.insertAdjacentHTML('beforeend', drmHtml);

                document.getElementById('toggle-drm').addEventListener('change', async (e) => {
                    const enable = e.target.checked;
                    await window.electronAPI.setDRMState(enable);
                });
            }
        }, 500);
    }

    showPasswordPrompt(domain, username, password) {
        const prompt = document.getElementById('password-prompt');
        if (!prompt) return;
        document.getElementById('pw-domain').textContent = domain;
        prompt.classList.add('active');
        
        document.getElementById('btn-save-pw').onclick = async () => {
            await window.electronAPI.saveCredentials({ domain, username, password });
            prompt.classList.remove('active');
            this.showToast('Passwort sicher gespeichert! 🔐');
        };
        document.getElementById('btn-ignore-pw').onclick = () => prompt.classList.remove('active');
    }

    showDefaultBrowserPrompt() {
        const prompt = document.getElementById('default-browser-prompt');
        if (!prompt) return;
        prompt.classList.add('active');
        
        document.getElementById('btn-set-default').onclick = async () => {
            await window.electronAPI.setAsDefaultBrowser();
            prompt.classList.remove('active');
            this.showToast('Einstellungen geöffnet! Wähle Phil Browser Pro aus. 🚀');
        };
        document.getElementById('btn-ignore-default').onclick = () => prompt.classList.remove('active');
    }

    initNotes() {
        const notesArea = document.getElementById('notes-textarea');
        notesArea.value = localStorage.getItem('phil_notes') || '';
        notesArea.addEventListener('input', (e) => localStorage.setItem('phil_notes', e.target.value));
        document.getElementById('btn-notes').onclick = () => document.getElementById('notes-panel').classList.toggle('active');
    }

    updateDiscordPresence(tab) {
        if (!tab || tab.isPrivate) {
            window.electronAPI.updateActivity({ state: "Surft inkognito 🥷", startTimestamp: sessionStartTime });
            return;
        }
        let state = (tab.title && tab.title !== 'Neu') ? tab.title.substring(0, 100) : "Startseite";
        if (tab.url.includes("youtube.com/watch")) state = "Schaut YouTube 📺";
        else if (tab.url.includes("twitch.tv")) state = "Schaut Twitch 🎮";
        else if (tab.url.includes("discord.com")) state = "Chattet auf Discord 💬";
        window.electronAPI.updateActivity({ state, startTimestamp: sessionStartTime });
    }

    async takeScreenshot() {
        const wv = this.getActiveWebview();
        if (!wv) return;
        try {
            const img = await wv.capturePage();
            const a = document.createElement('a');
            a.href = img.toDataURL();
            a.download = `Screenshot_${Date.now()}.png`;
            a.click();
            this.showToast('📸 Screenshot erfolgreich gespeichert!');
        } catch(e) { this.showToast('Screenshot fehlgeschlagen.'); }
    }

    async pickColor() {
        if (!window.EyeDropper) return this.showToast('Color Picker wird hier nicht unterstützt.');
        const dropper = new EyeDropper();
        try {
            const result = await dropper.open();
            navigator.clipboard.writeText(result.sRGBHex);
            this.showToast(`Farbe ${result.sRGBHex} kopiert!`);
        } catch(e) {}
    }

    renderBookmarks() {
        const list = document.getElementById('bookmarks-list');
        if (!list) return;
        list.innerHTML = this.app.bookmarks.map(b => `
            <div class="bookmark-item" data-url="${escapeHTML(b.url)}" title="${escapeHTML(b.title)}">
                <i class="ph ph-star text-star"></i> ${escapeHTML(b.title.substring(0, 20))}
            </div>
        `).join('');
        list.querySelectorAll('.bookmark-item').forEach(el => el.onclick = () => this.app.tabManager.createTab(el.getAttribute('data-url')));
    }

    renderHistory(query = '') {
        const list = document.getElementById('history-list');
        if (!list) return;
        const filtered = this.app.history.filter(h => h.title.toLowerCase().includes(query.toLowerCase()) || h.url.toLowerCase().includes(query.toLowerCase()));
        if (filtered.length === 0) {
            list.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px;">Keine Einträge gefunden.</p>';
            return;
        }
        list.innerHTML = filtered.map(h => `
            <div class="dl-history-item" style="padding: 10px;">
                <div class="dl-history-info" style="cursor:pointer;" onclick="window.browserApp.tabManager.createTab('${escapeHTML(h.url)}')">
                    <span class="dl-name" style="font-weight: 500;">${escapeHTML(h.title)}</span>
                    <span class="dl-meta">${escapeHTML(h.url)}</span>
                </div>
                <button class="set-btn danger" onclick="window.browserApp.ui.deleteHistoryItem('${escapeHTML(h.url)}')"><i class="ph ph-trash"></i></button>
            </div>
        `).join('');
    }

    deleteHistoryItem(url) {
        this.app.history = this.app.history.filter(h => h.url !== url);
        localStorage.setItem('phil_history', JSON.stringify(this.app.history));
        this.renderHistory(document.getElementById('history-search').value);
    }

    setupEventListeners() {
        document.querySelectorAll('.win-btn[data-win]').forEach(btn => btn.addEventListener('click', () => window.electronAPI.windowControl(btn.getAttribute('data-win'))));
        
        document.getElementById('btn-back').onclick = () => { try { this.getActiveWebview()?.goBack(); } catch(e){} };
        document.getElementById('btn-forward').onclick = () => { try { this.getActiveWebview()?.goForward(); } catch(e){} };
        document.getElementById('btn-reload').onclick = () => { try { this.getActiveWebview()?.reload(); } catch(e){} };
        
        document.getElementById('btn-home').onclick = () => this.getActiveWebview()?.loadURL(START_PAGE);
        document.getElementById('btn-bookmark').onclick = () => {
            const wv = this.getActiveWebview();
            if (!wv) return;
            const url = wv.getURL();
            if (url.includes('start.html')) return;
            const title = wv.getTitle() || url;
            const existsIndex = this.app.bookmarks.findIndex(b => b.url === url);
            if (existsIndex >= 0) {
                this.app.bookmarks.splice(existsIndex, 1);
                document.getElementById('btn-bookmark').classList.remove('is-bookmarked');
                this.showToast('Lesezeichen entfernt');
            } else {
                this.app.bookmarks.push({ url, title });
                document.getElementById('btn-bookmark').classList.add('is-bookmarked');
                this.showToast('Lesezeichen gespeichert!');
            }
            localStorage.setItem('phil_bookmarks', JSON.stringify(this.app.bookmarks));
            this.renderBookmarks();
        };
        document.getElementById('btn-menu').onclick = (e) => { e.stopPropagation(); document.getElementById('main-menu').classList.toggle('active'); };
        document.querySelectorAll('[data-modal]').forEach(btn => btn.addEventListener('click', () => { this.showModal(btn.getAttribute('data-modal')); document.getElementById('main-menu').classList.remove('active'); }));
        document.querySelectorAll('.close-modal').forEach(btn => btn.addEventListener('click', (e) => e.target.closest('.modal-overlay').classList.remove('active')));
        document.getElementById('history-search')?.addEventListener('input', (e) => this.renderHistory(e.target.value));
        document.querySelectorAll('.app-icon-btn').forEach(btn => {
            btn.onclick = () => {
                const sidebar = document.getElementById('sidebar');
                const webview = document.getElementById('sidebar-webview');
                const wasActive = btn.classList.contains('active');
                document.querySelectorAll('.app-icon-btn').forEach(b => b.classList.remove('active'));
                if (sidebar.classList.contains('active') && wasActive) { sidebar.classList.remove('active'); } else { btn.classList.add('active'); if (webview.src !== btn.getAttribute('data-url')) webview.src = btn.getAttribute('data-url'); sidebar.classList.add('active'); }
            };
        });
        document.getElementById('btn-reader').onclick = () => {
            const wv = this.getActiveWebview(); if(!wv) return;
            wv.executeJavaScript(`
                if(window.__readerMode) { window.location.reload(); window.__readerMode = false; }
                else {
                    window.__readerMode = true;
                    const article = document.querySelector('article') || document.querySelector('main') || document.body;
                    document.body.innerHTML = '<div style="max-width:800px;margin:0 auto;padding:40px;font-family:Georgia,serif;font-size:20px;line-height:1.6;color:#e4e4e7;background:#18181b;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,0.5);">' + article.innerHTML + '</div>';
                    document.body.style.background = '#0f0f13';
                    document.querySelectorAll('img').forEach(i => { i.style.maxWidth = '100%'; i.style.height = 'auto'; });
                }
                null;
            `);
            document.getElementById('btn-reader').classList.toggle('active');
        };
        document.getElementById('menu-splitview').onclick = () => { this.app.tabManager.toggleSplitView(); document.getElementById('main-menu').classList.remove('active'); };
        document.getElementById('menu-zoom-in').onclick = () => this.handleZoom(0.1);
        document.getElementById('menu-zoom-out').onclick = () => this.handleZoom(-0.1);
        
        // 🛑 DER GELB-KILLER FIX:
        const findBar = document.getElementById('find-bar');
        const findInput = document.getElementById('find-input');
        
        findInput.addEventListener('input', (e) => { 
            if (this.app.tabManager.activeTabId) {
                window.electronAPI.findInPage({ 
                    tabId: this.app.tabManager.activeTabId, 
                    text: e.target.value 
                }); 
            }
        });

        document.getElementById('find-close').onclick = () => { 
            findBar.classList.remove('active'); 
            const tabId = this.app.tabManager.activeTabId;
            const tab = this.app.tabManager.tabs.get(tabId);
            
            if (tab) {
                // Wir senden einen leeren String, um die Suche zu stoppen
                window.electronAPI.findInPage({ tabId: tabId, text: '' });
                // 'clearSelection' entfernt die gelben Highlights sofort
                tab.webview.stopFindInPage('clearSelection');
            }
            findInput.value = ''; 
        };
        
        window.onclick = (e) => { if(!e.target.closest('.dropdown-menu') && !e.target.closest('#btn-menu')) document.getElementById('main-menu').classList.remove('active'); };
        window.addEventListener('keydown', (e) => {
            if(e.key === 'F8') return window.electronAPI.windowControl('min'); 
            if(e.key === 'Escape' && findBar.classList.contains('active')) return document.getElementById('find-close').click();
            if(e.key === 'Escape' && this.app.cmdPalette.overlay.classList.contains('active')) return this.app.cmdPalette.close();
            const shorts = this.app.settings.get('shortcuts');
            const keys = []; if (e.ctrlKey) keys.push('ctrl'); if (e.shiftKey) keys.push('shift'); if (e.altKey) keys.push('alt'); keys.push(e.key.toLowerCase()); const combo = keys.join('+');
            if (combo === shorts.newTab) { e.preventDefault(); this.app.tabManager.createTab(); }
            else if (combo === shorts.newPrivateTab) { e.preventDefault(); this.app.tabManager.createTab(START_PAGE, true); }
            else if (combo === shorts.closeTab) { e.preventDefault(); this.app.tabManager.closeTab(this.app.tabManager.activeTabId); }
            else if (combo === shorts.focusUrl) { e.preventDefault(); document.getElementById('url-input').select(); }
            else if (combo === shorts.history) { e.preventDefault(); this.showModal('history-modal'); }
            else if (combo === shorts.find) { e.preventDefault(); findBar.classList.add('active'); findInput.focus(); findInput.select(); }
            else if (combo === shorts.print) { e.preventDefault(); try { this.getActiveWebview()?.print(); } catch(err){} }
            else if (combo === shorts.cmdPalette) { e.preventDefault(); this.app.cmdPalette.open(); }
            else if (e.key === 'F5' || combo === 'ctrl+r') { e.preventDefault(); try { e.shiftKey ? this.getActiveWebview()?.reloadIgnoringCache() : this.getActiveWebview()?.reload(); } catch(err){} }
        });
    }

    handleZoom(delta) {
        const id = this.app.tabManager.activeTabId; if (!id) return;
        const tab = this.app.tabManager.tabs.get(id);
        if (tab) { tab.currentZoom += delta; tab.webview.setZoomLevel(tab.currentZoom); this.showToast(`🔍 Zoom: ${Math.round((tab.currentZoom + 1) * 100)}%`); }
    }

    getActiveWebview() { if (!this.app.tabManager) return null; const id = this.app.tabManager.activeTabId; return id ? this.app.tabManager.tabs.get(id).webview : null; }

    updateNavigationState(url, webview) {
        document.getElementById('url-input').value = (url.includes('start.html') || url.includes('offline.html')) ? '' : url;
        
        try {
            const activeTab = this.app.tabManager.tabs.get(this.app.tabManager.activeTabId);
            if (activeTab && activeTab.isReady) {
                document.getElementById('btn-back').disabled = !webview.canGoBack();
                document.getElementById('btn-forward').disabled = !webview.canGoForward();
            } else {
                document.getElementById('btn-back').disabled = true;
                document.getElementById('btn-forward').disabled = true;
            }
        } catch(e) {
            document.getElementById('btn-back').disabled = true;
            document.getElementById('btn-forward').disabled = true;
        }
        
        const secIcon = document.getElementById('security-icon');
        const isPrivate = webview.getAttribute('partition') === 'in-memory';
        if (isPrivate) secIcon.innerHTML = `<i class="ph ph-mask-happy" style="color:var(--private)"></i>`;
        else if (url.includes('start.html') || url.includes('offline.html')) secIcon.innerHTML = `<i class="ph ph-house"></i>`;
        else if (url.startsWith('https')) secIcon.innerHTML = `<i class="ph ph-lock-key text-green"></i>`;
        else secIcon.innerHTML = `<i class="ph ph-warning-circle" style="color:var(--danger)"></i>`;
        document.getElementById('btn-reader').classList.remove('active');
        const isBookmarked = this.app.bookmarks.some(b => b.url === url);
        document.getElementById('btn-bookmark').classList.toggle('is-bookmarked', isBookmarked);
    }

    applyTheme(theme) {
        if (theme === 'auto') { const hour = new Date().getHours(); const isNight = hour >= 20 || hour < 8; document.body.className = isNight ? 'dark-mode' : 'light-mode'; }
        else { document.body.className = theme === 'gaming' ? 'gaming-mode' : (theme === 'light' ? 'light-mode' : ''); }
    }

    showModal(id) { document.getElementById(id).classList.add('active'); if (id === 'downloads-modal') this.renderDownloadsList(); if (id === 'history-modal') this.renderHistory(); }

    showToast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.innerHTML = `<i class="ph ph-info"></i> ${escapeHTML(msg)}`; document.getElementById('toast-container').appendChild(t); setTimeout(() => t.remove(), 4000); }

    handleDownloadStart(data) { this.app.activeDownloads[data.id] = data; this.showToast(`Download gestartet: ${data.name}`); if (document.getElementById('downloads-modal').classList.contains('active')) this.renderDownloadsList(); }

    handleDownloadProgress(data) {
        if (this.app.activeDownloads[data.id]) {
            this.app.activeDownloads[data.id].received = data.received; this.app.activeDownloads[data.id].state = data.state; this.app.activeDownloads[data.id].speed = data.speed;
            const pBar = document.getElementById(`dl-prog-${data.id}`); if (pBar && data.total > 0) pBar.style.width = `${(data.received / data.total) * 100}%`;
            const speedEl = document.getElementById(`dl-speed-${data.id}`); if (speedEl && data.speed) speedEl.textContent = `${(data.speed / (1024*1024)).toFixed(1)} MB/s`;
        }
    }

    handleDownloadDone(data) { delete this.app.activeDownloads[data.id]; this.app.downloads.unshift(data); if(this.app.downloads.length > 50) this.app.downloads.pop(); localStorage.setItem('phil_downloads', JSON.stringify(this.app.downloads)); if (document.getElementById('downloads-modal').classList.contains('active')) this.renderDownloadsList(); this.showToast("Download abgeschlossen: " + data.name); }

    renderDownloadsList() {
        const list = document.getElementById('downloads-list'); list.innerHTML = ''; const activeVals = Object.values(this.app.activeDownloads);
        if (activeVals.length === 0 && this.app.downloads.length === 0) { list.innerHTML = '<p style="text-align:center; color:var(--text-muted); margin-top: 20px;">Keine Downloads vorhanden.</p>'; return; }
        const header = document.createElement('div'); header.style.cssText = "display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px;"; header.innerHTML = `<span style="color:var(--text-muted); font-size:14px; font-weight:600;">Download-Verlauf</span><button class="set-btn danger" id="btn-clear-downloads" style="padding: 6px 12px; font-size: 12px;"><i class="ph ph-trash"></i> Alle leeren</button>`; list.appendChild(header);
        header.querySelector('#btn-clear-downloads').addEventListener('click', () => { this.app.downloads = []; localStorage.setItem('phil_downloads', JSON.stringify([])); this.renderDownloadsList(); });
        activeVals.forEach(dl => { const el = document.createElement('div'); el.className = 'dl-history-item'; el.innerHTML = `<div class="dl-history-info"><span class="dl-name"><i class="ph ph-spinner ph-spin text-green"></i> ${escapeHTML(dl.name)}</span><span class="dl-meta"><div class="dl-progress-bar-small"><div class="dl-progress-fill" id="dl-prog-${dl.id}" style="width:${(dl.received/dl.total)*100}%"></div></div>${dl.state === 'paused' ? 'Pausiert' : `<span id="dl-speed-${dl.id}">${dl.speed ? (dl.speed/(1024*1024)).toFixed(1) : 0} MB/s</span>`}</span></div><div style="display:flex; gap:5px;"><button class="set-btn" onclick="window.electronAPI.downloadAction({id:'${dl.id}', action:'${dl.state==='paused'?'resume':'pause'})}">${dl.state==='paused'?'<i class="ph ph-play"></i>':'<i class="ph ph-pause"></i>'}</button><button class="set-btn danger" onclick="window.electronAPI.downloadAction({id:'${dl.id}', action:'cancel'})"><i class="ph ph-x"></i></button></div>`; list.appendChild(el); });
        this.app.downloads.forEach((dl, index) => { const el = document.createElement('div'); el.className = 'dl-history-item'; el.innerHTML = `<div class="dl-history-info"><span class="dl-name"><i class="ph ph-file-check ${dl.state==='completed'?'text-green':'text-muted'}"></i> ${escapeHTML(dl.name)}</span><span class="dl-meta">${(dl.size/(1024*1024)).toFixed(2)} MB • ${new Date(dl.timestamp).toLocaleString()} ${dl.state !== 'completed' ? `(${dl.state})` : ''}</span></div><div style="display:flex; gap:5px;">${dl.state === 'completed' ? `<button class="set-btn btn-open-file" data-path="${escapeHTML(dl.path)}" title="Datei öffnen" style="padding:6px 10px; font-size:14px;"><i class="ph ph-file"></i></button>` : ''}<button class="set-btn btn-open-folder" data-path="${escapeHTML(dl.path)}" title="Ordner öffnen" style="padding:6px 10px; font-size:14px;"><i class="ph ph-folder"></i></button><button class="set-btn danger btn-remove-dl" data-index="${index}" title="Eintrag entfernen" style="padding:6px 10px; font-size:14px;"><i class="ph ph-x"></i></button></div>`; if (dl.state === 'completed') el.querySelector('.btn-open-file').addEventListener('click', (e) => window.electronAPI.openFile(e.currentTarget.getAttribute('data-path'))); el.querySelector('.btn-open-folder').addEventListener('click', (e) => window.electronAPI.openFolder(e.currentTarget.getAttribute('data-path'))); el.querySelector('.btn-remove-dl').addEventListener('click', (e) => { const idx = parseInt(e.currentTarget.getAttribute('data-index')); this.app.downloads.splice(idx, 1); localStorage.setItem('phil_downloads', JSON.stringify(this.app.downloads)); this.renderDownloadsList(); }); list.appendChild(el); });
    }
}
window.onload = () => { window.browserApp = new BrowserApp(); };