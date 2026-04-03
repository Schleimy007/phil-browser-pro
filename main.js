// main.js
const { app, BrowserWindow, session, ipcMain, Menu, MenuItem, shell, safeStorage, dialog } = require('electron');
const { autoUpdater } = require('electron-updater'); 
const path = require('path');
const fs = require('fs');

// --- WICHTIG: Pfade setzen BEVOR app ready ist, um Background-Crash zu vermeiden ---
const userDataPath = path.join(app.getPath('appData'), 'phil-browser-data');
app.setPath('userData', userDataPath);

const drmConfigPath = path.join(userDataPath, 'drm_config.json');
let drmEnabled = false;
try {
    if (fs.existsSync(drmConfigPath)) {
        drmEnabled = JSON.parse(fs.readFileSync(drmConfigPath, 'utf8')).enabled;
    }
} catch(e) {}

// --- FIX 1: Verhindert das nervige Windows Passkey (WebAuthn) Popup komplett ---
app.commandLine.appendSwitch('disable-features', 'WebAuthentication,WebAuthenticationUI');

// Performance Flags
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');
app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');

// --- FIX 2: Absolut kugelsicherer Chrome User-Agent für Google Login ---
const CHROME_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
app.userAgentFallback = CHROME_USER_AGENT;

if (process.defaultApp) {
    if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient('http', process.execPath, [path.resolve(process.argv[1])]);
        app.setAsDefaultProtocolClient('https', process.execPath, [path.resolve(process.argv[1])]);
    }
} else {
    app.setAsDefaultProtocolClient('http');
    app.setAsDefaultProtocolClient('https');
}

let rpc;
try {
    const DiscordRPC = require('discord-rpc');
    const clientId = '1489230408469184625';
    DiscordRPC.register(clientId);
    rpc = new DiscordRPC.Client({ transport: 'ipc' });
    rpc.on('ready', () => console.log('Discord RPC aktiv!'));
    rpc.login({ clientId }).catch(() => console.log("Discord RPC: Discord ist nicht offen."));
} catch (e) {
    console.log("Discord RPC Modul nicht gefunden.");
}

const gotTheLock = app.requestSingleInstanceLock();
let adblockEnabled = true;

const SUPPORTED_FILES = ['.html', '.htm', '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.mp4', '.webm', '.mp3', '.wav', '.txt', '.json', '.xml', '.md'];

if (!gotTheLock) {
    app.quit();
} else {
    let mainWindow;
    const activeDownloads = new Map();

    function createWindow() {
        mainWindow = new BrowserWindow({
            width: 1400,
            height: 900,
            minWidth: 800,
            minHeight: 600,
            frame: false,
            titleBarStyle: 'hidden',
            icon: path.join(__dirname, 'icon.png'),
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                webviewTag: true, 
                plugins: drmEnabled,
                webSecurity: false, 
                preload: path.join(__dirname, 'preload.js')
            }
        });

        // --- TIEFER SESSION FIX (Google Login & Popups) ---
        const sessionsToFix = [
            session.defaultSession, 
            session.fromPartition('in-memory'), 
            session.fromPartition('persist:session')
        ];
        
        sessionsToFix.forEach(sess => {
            sess.setPermissionRequestHandler((webContents, permission, callback) => {
                if (permission === 'security-key') {
                    return callback(false); 
                }
                callback(true);
            });

            sess.webRequest.onBeforeSendHeaders({ 
                urls: ['*://*.google.com/*', '*://*.accounts.google.com/*', '*://*.youtube.com/*'] 
            }, (details, callback) => {
                details.requestHeaders['User-Agent'] = CHROME_USER_AGENT;
                delete details.requestHeaders['sec-ch-ua'];
                delete details.requestHeaders['sec-ch-ua-mobile'];
                delete details.requestHeaders['sec-ch-ua-platform'];
                callback({ cancel: false, requestHeaders: details.requestHeaders });
            });
        });

        mainWindow.loadFile('index.html');
        mainWindow.maximize();

        mainWindow.webContents.on('before-input-event', (event, input) => {
            if (input.key === 'F12' && input.type === 'keyDown') mainWindow.webContents.toggleDevTools();
        });

        setupAdblocker();
        setupDownloadManager();
        setupContextMenus();
        setupExtensions();

        // --- AUTO UPDATER LOGIK ---
        autoUpdater.autoDownload = false; 
        
        autoUpdater.on('update-available', (info) => {
            if (mainWindow) mainWindow.webContents.send('update-available', info.version);
        });

        autoUpdater.on('update-downloaded', () => {
            if (mainWindow) mainWindow.webContents.send('update-downloaded');
        });

        autoUpdater.checkForUpdatesAndNotify();
    }

    // --- APP LIFECYCLE ---
    app.whenReady().then(() => {
        createWindow();
        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') app.quit();
    });

    app.on('second-instance', (event, commandLine, workingDirectory) => { 
        if (mainWindow) { 
            if (mainWindow.isMinimized()) mainWindow.restore(); 
            mainWindow.focus(); 
            for (let i = 1; i < commandLine.length; i++) {
                const target = commandLine[i];
                if (!target.startsWith('-') && fs.existsSync(target) && fs.statSync(target).isFile()) {
                    const ext = path.extname(target).toLowerCase();
                    if (SUPPORTED_FILES.includes(ext) || ext === '') {
                        const fileUrl = 'file:///' + target.replace(/\\/g, '/');
                        mainWindow.webContents.send('tab-action', { action: 'new-tab-url', url: fileUrl });
                        break;
                    }
                }
            }
        } 
    });

    // --- IPC HANDLERS ---
    ipcMain.on('download-update', () => { autoUpdater.downloadUpdate(); });
    ipcMain.on('install-update', () => { autoUpdater.quitAndInstall(true, true); });
    ipcMain.on('quit-app', () => { app.quit(); });

    ipcMain.handle('get-drm-state', () => drmEnabled);
    ipcMain.handle('set-drm-state', (event, state) => {
        fs.writeFileSync(drmConfigPath, JSON.stringify({ enabled: state }));
        app.relaunch(); 
        app.exit(0); 
    });

    ipcMain.handle('is-default-browser', () => app.isDefaultProtocolClient('http'));
    ipcMain.handle('set-as-default-browser', async () => {
        const success = app.setAsDefaultProtocolClient('http');
        app.setAsDefaultProtocolClient('https');
        if (process.platform === 'win32') await shell.openExternal('ms-settings:defaultapps');
        return success;
    });

    ipcMain.handle('get-start-args', () => {
        const args = process.argv;
        if (args.length > 1) {
            const target = args[args.length - 1];
            if (!target.startsWith('-') && fs.existsSync(target) && fs.statSync(target).isFile()) {
                const ext = path.extname(target).toLowerCase();
                if (SUPPORTED_FILES.includes(ext) || ext === '') {
                    return 'file:///' + target.replace(/\\/g, '/');
                }
            }
        }
        return null;
    });

    ipcMain.handle('fetch-image', async (event, rect) => {
        try {
            const win = BrowserWindow.getFocusedWindow();
            if (!win) return null;
            const captureRect = { x: Math.max(0, rect.x - 20), y: Math.max(0, rect.y - 20), width: 350, height: 250 };
            let image = await win.webContents.capturePage(captureRect);
            if (image.isEmpty()) return null;
            image = image.resize({ width: 300 }); 
            const jpegBuffer = image.toJPEG(70); 
            return `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;
        } catch (e) { return null; }
    });

    ipcMain.handle('install-extension', async () => {
        const { dialog } = require('electron');
        const result = await dialog.showOpenDialog({ title: 'Erweiterungs-Ordner auswählen', properties: ['openDirectory'] });
        if (!result.canceled && result.filePaths.length > 0) {
            const sourcePath = result.filePaths[0];
            const extName = path.basename(sourcePath);
            const destPath = path.join(app.getPath('userData'), 'extensions', extName);
            try {
                if (!fs.existsSync(path.join(app.getPath('userData'), 'extensions'))) {
                    fs.mkdirSync(path.join(app.getPath('userData'), 'extensions'), { recursive: true });
                }
                fs.cpSync(sourcePath, destPath, { recursive: true });
                return { success: true, name: extName };
            } catch (err) { return { success: false, error: err.message }; }
        }
        return { success: false, canceled: true };
    });

    // --- NEU: DEEP SEARCH & NATIVE GEMINI API (Spare Credits + Live Google Suche) ---
    ipcMain.handle('fetch-ai', async (event, messagesArray) => {
        try {
            if (!Array.isArray(messagesArray) || messagesArray.length === 0) return { success: false, error: "Leerer Chatverlauf." };
            
            const GOOGLE_API_KEY = "AIzaSyDLCxowgHj5tgo7lsNCm1Lu_wjV6nw350U";
            
            // Format für die direkte, offizielle Gemini API anpassen
            let contents = [];
            let sysInstr = null;

            messagesArray.forEach(m => {
                if (m.role === 'system') {
                    sysInstr = m.content;
                    return;
                }
                let parts = [];
                if (Array.isArray(m.content)) {
                    m.content.forEach(c => {
                        if (c.type === 'text') parts.push({ text: c.text });
                        if (c.type === 'image_url') {
                            parts.push({
                                inlineData: {
                                    mimeType: "image/jpeg",
                                    data: c.image_url.url.split(',')[1]
                                }
                            });
                        }
                    });
                } else {
                    parts.push({ text: m.content });
                }
                contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: parts });
            });

            // Wir nutzen gemini-2.5-flash: Extrem intelligent, free tier, unterstützt Google Deep Search perfekt!
            const modelName = "gemini-2.5-flash"; 
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GOOGLE_API_KEY}`;
            
            const payload = {
                contents: contents,
                tools: [{ googleSearch: {} }] // HIER WIRD DIE DEEP SEARCH VON GOOGLE AKTIVIERT!
            };
            if (sysInstr) {
                payload.systemInstruction = { parts: [{ text: sysInstr }] };
            }

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            
            if (!response.ok) {
                return { success: false, error: data.error?.message || `HTTP ${response.status}` };
            }

            let text = data.candidates[0].content.parts[0].text;
            let sources = [];
            
            // Extrahiere die Google-Suchergebnisse (Grounding Metadata), damit der Browser sie hübsch mit Logos anzeigen kann!
            if (data.candidates[0].groundingMetadata && data.candidates[0].groundingMetadata.groundingChunks) {
                sources = data.candidates[0].groundingMetadata.groundingChunks.map(chunk => {
                    if (chunk.web && chunk.web.uri) {
                        return { title: chunk.web.title, url: chunk.web.uri };
                    }
                    return null;
                }).filter(Boolean);
            }

            return { success: true, text: text, usedModel: modelName, sources: sources };
        } catch (error) { return { success: false, error: error.message }; }
    });

    ipcMain.handle('get-app-path', () => app.getAppPath());
    
    ipcMain.handle('get-memory-info', async () => {
        try {
            return process.getSystemMemoryInfo();
        } catch(e) {
            return process.getBlinkMemoryInfo(); 
        }
    });

    ipcMain.handle('get-extensions', async () => {
        const extPath = path.join(app.getPath('userData'), 'extensions');
        const statesFile = path.join(app.getPath('userData'), 'extensions_state.json');
        let states = {};
        try { if (fs.existsSync(statesFile)) states = JSON.parse(fs.readFileSync(statesFile, 'utf8')); } catch(e){}
        let exts = [];
        if (fs.existsSync(extPath)) {
            try {
                const dirs = fs.readdirSync(extPath).filter(f => fs.statSync(path.join(extPath, f)).isDirectory());
                for (const d of dirs) {
                    let manifest = {}, script = null, css = null;
                    if (fs.existsSync(path.join(extPath, d, 'manifest.json'))) manifest = JSON.parse(fs.readFileSync(path.join(extPath, d, 'manifest.json'), 'utf8'));
                    if (fs.existsSync(path.join(extPath, d, 'script.js'))) script = fs.readFileSync(path.join(extPath, d, 'script.js'), 'utf8'); 
                    if (fs.existsSync(path.join(extPath, d, 'style.css'))) css = fs.readFileSync(path.join(extPath, d, 'style.css'), 'utf8'); 
                    exts.push({ id: d, manifest, script, css, enabled: states[d] !== false }); 
                }
            } catch (e) {} 
        }
        return exts;
    });

    const loginsPath = path.join(app.getPath('userData'), 'logins.json');
    ipcMain.handle('save-credentials', (event, { domain, username, password }) => {
        let logins = {}; if (fs.existsSync(loginsPath)) logins = JSON.parse(fs.readFileSync(loginsPath, 'utf8'));
        const encrypted = safeStorage.encryptString(password).toString('base64');
        logins[domain] = { username, password: encrypted };
        fs.writeFileSync(loginsPath, JSON.stringify(logins));
        return true;
    });

    ipcMain.handle('get-credentials', (event, domain) => {
        if (!fs.existsSync(loginsPath)) return null;
        const logins = JSON.parse(fs.readFileSync(loginsPath, 'utf8'));
        if (logins[domain]) { try { const decrypted = safeStorage.decryptString(Buffer.from(logins[domain].password, 'base64')); return { username: logins[domain].username, password: decrypted }; } catch (e) { return null; } }
        return null;
    });

    ipcMain.handle('clear-data', async() => { await session.defaultSession.clearStorageData(); if (fs.existsSync(loginsPath)) fs.unlinkSync(loginsPath); return true; });
    ipcMain.handle('clear-cookies', async(event, domain) => { const cookies = await session.defaultSession.cookies.get({ domain }); for (const c of cookies) { let url = (c.secure ? 'https://' : 'http://') + c.domain + c.path; await session.defaultSession.cookies.remove(url, c.name); } return true; });

    // --- IPC ON (EVENTS) ---
    ipcMain.on('save-extension-state', (event, id, state) => { 
        const statesFile = path.join(app.getPath('userData'), 'extensions_state.json'); 
        let states = {}; 
        if (fs.existsSync(statesFile)) states = JSON.parse(fs.readFileSync(statesFile, 'utf8')); 
        states[id] = state; 
        fs.writeFileSync(statesFile, JSON.stringify(states)); 
    });
    
    ipcMain.on('open-folder', (e, folderPath) => shell.showItemInFolder(folderPath));
    ipcMain.on('open-file', (e, filePath) => shell.openPath(filePath));
    ipcMain.on('update-adblocker', (event, enabled) => { adblockEnabled = enabled; });
    ipcMain.on('update-activity', (event, data) => {
        if (!rpc) return;
        try { rpc.setActivity({ details: "Benutzt Phil Browser Pro 🚀", state: data.state, startTimestamp: data.startTimestamp, largeImageKey: 'https://i.imgur.com/jQrZgDb.png', largeImageText: 'Phil Browser Pro', buttons: [{ label: "📥 Browser Downloaden", url: "https://drive.google.com/file/d/12eB1KL0irguTkEuwftYhiTLXOmc7mSnf/view" }], instance: false, }); } catch (e) {}
    });

    ipcMain.on('window-control', (e, command) => { 
        if (!mainWindow) return; 
        if (command === 'min') mainWindow.minimize(); 
        if (command === 'max') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); 
        if (command === 'close') mainWindow.close(); 
    });
    
    ipcMain.on('download-action', (e, { id, action }) => { 
        const item = activeDownloads.get(id); 
        if (item) { 
            if (action === 'pause') item.pause(); 
            if (action === 'resume') item.resume(); 
            if (action === 'cancel') { item.cancel(); activeDownloads.delete(id); } 
        } 
    });

    ipcMain.on('find-in-page', (event, { tabId, text }) => { if (mainWindow) mainWindow.webContents.send('execute-find', { tabId, text }); });

    ipcMain.on('set-wallpaper', async (event, imageUrl) => {
        try {
            const tempPath = path.join(app.getPath('temp'), 'phil_bg.jpg');
            const res = await fetch(imageUrl);
            const buffer = await res.arrayBuffer();
            fs.writeFileSync(tempPath, Buffer.from(buffer));
            
            if (process.platform === 'win32') {
                const { exec } = require('child_process');
                const psScript = `
                    $path = "${tempPath}"
                    $code = @'
                    using System.Runtime.InteropServices;
                    public class Wallpaper {
                        [DllImport("user32.dll", CharSet=CharSet.Auto)]
                        public static extern int SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);
                    }
'@
                    Add-Type $code
                    [Wallpaper]::SystemParametersInfo(0x0014, 0, $path, 0x01 -bOr 0x02)
                `;
                exec(`powershell -command "${psScript}"`);
                event.sender.send('show-toast', 'Hintergrundbild erfolgreich geändert! 🎨');
            }
        } catch (e) {
            event.sender.send('show-toast', 'Fehler beim Ändern des Hintergrunds.');
        }
    });

    function setupAdblocker() {
        const blockList = ['*://*.doubleclick.net/*', '*://partner.googleadservices.com/*', '*://*.googlesyndication.com/*', '*://*.google-analytics.com/*', '*://adservice.google.com/*', '*://*.amazon-adsystem.com/*', '*://*.scorecardresearch.com/*', '*://*.outbrain.com/*', '*://*.taboola.com/*', '*://*.youtube.com/pagead/*', '*://*.youtube.com/api/stats/ads*', '*://*.youtube.com/ptracking/*', '*://*.youtube.com/get_midroll_info*', '*://*.googlevideo.com/*&adformat=*', '*://*.googlevideo.com/*&ad_type=*', '*://*.googlevideo.com/*&adurl=*', '*://*.criteo.com/*', '*://*.rubiconproject.com/*', '*://*.moatads.com/*', '*://*.appnexus.com/*', '*://*.openx.net/*'];
        const blockHandler = (details, callback) => {
            if (!adblockEnabled) return callback({ cancel: false });
            if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.webContents.send('ad-blocked', 1); }
            callback({ cancel: true });
        };
        const targetSessions = [session.defaultSession, session.fromPartition('in-memory'), session.fromPartition('persist:session')];
        targetSessions.forEach(sess => { sess.webRequest.onBeforeRequest({ urls: blockList }, blockHandler); });
    }

    function setupDownloadManager() {
        const dlHandler = (event, item, webContents) => handleDownloadItem(item);
        const targetSessions = [session.defaultSession, session.fromPartition('in-memory'), session.fromPartition('persist:session')];
        targetSessions.forEach(sess => sess.on('will-download', dlHandler));
    }

    function handleDownloadItem(item) {
        const id = item.getStartTime().toString();
        activeDownloads.set(id, item);
        const fileName = item.getFilename();
        const totalBytes = item.getTotalBytes();
        const savePath = item.getSavePath() || path.join(app.getPath('downloads'), fileName);
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('download-start', { id, name: fileName, total: totalBytes, path: savePath });
        let lastSend = 0, lastBytes = 0;
        item.on('updated', (event, state) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                const now = Date.now();
                if (now - lastSend > 500 || state !== 'progressing') {
                    const received = item.getReceivedBytes();
                    const speed = ((received - lastBytes) / ((now - lastSend) / 1000)).toFixed(0);
                    mainWindow.webContents.send('download-progress', { id, state, received, total: totalBytes, speed });
                    lastSend = now; lastBytes = received;
                }
            }
        });
        item.once('done', (event, state) => {
            activeDownloads.delete(id);
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('download-done', { id, name: fileName, state: state, path: item.getSavePath() || savePath, size: totalBytes, timestamp: Date.now() });
        });
    }

    function setupExtensions() {
        const extPath = path.join(app.getPath('userData'), 'extensions');
        if (!fs.existsSync(extPath)) fs.mkdirSync(extPath, { recursive: true });
        let dirs = []; try { dirs = fs.readdirSync(extPath); } catch (e) {}
        if (dirs.length < 5) {
            const extensionsToCreate = [
                { id: 'yt-skipper', name: "YouTube Ad Skipper", desc: "Überspringt Video-Ads sofort.", script: `setInterval(() => { const btn = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button'); if(btn) btn.click(); }, 500);` },
                { id: 'yt-pro-design', name: "YouTube Pro Design", desc: "Macht YouTube moderner (Shorts weg, Ränder rund).", css: `ytd-rich-section-renderer.ytd-rich-grid-renderer, [is-shorts], ytd-reel-shelf-renderer { display: none !important; } ytd-thumbnail, ytd-thumbnail-overlay-time-status-renderer { border-radius: 12px !important; } #background.ytd-masthead { background: rgba(15,15,19,0.85) !important; backdrop-filter: blur(15px); border-bottom: 1px solid rgba(255,255,255,0.1); }` },
                { id: 'video-pip', name: "Video PiP Mode", desc: "Drücke Alt+P auf Videos für den Mini-Player.", script: `document.addEventListener('keydown', (e) => { if(e.altKey && e.key.toLowerCase()==='p'){ const v = document.querySelector('video'); if(v){ document.pictureInPictureElement ? document.exitPictureInPicture() : v.requestPictureInPicture(); } } });` },
                { id: 'dark-mode', name: "Universal Dark Mode", desc: "Drücke Strg+Alt+D, um den Dark Mode überall umzuschalten.", script: `let isDark=false; document.addEventListener('keydown', (e) => { if(e.ctrlKey && e.altKey && e.key.toLowerCase()==='d'){ isDark=!isDark; document.documentElement.style.filter = isDark ? 'invert(1) hue-rotate(180deg)' : ''; document.documentElement.style.background = isDark ? '#fff' : ''; document.querySelectorAll('img, picture, video').forEach(m => m.style.filter = isDark ? 'invert(1) hue-rotate(180deg)' : ''); }});` },
                { id: 'custom-scroll', name: "Modern Scrollbars", desc: "Macht alle Scrollbars schöner.", script: `const style = document.createElement('style'); style.textContent = '::-webkit-scrollbar { width: 10px; height: 10px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: #6366f188; border-radius: 5px; } ::-webkit-scrollbar-thumb:hover { background: #6366f1; }'; document.head.appendChild(style);` },
                { id: 'smooth-scroll', name: "Smooth Scrolling", desc: "Erzwingt weiches Scrollen auf allen Webseiten.", script: `document.documentElement.style.setProperty('scroll-behavior', 'smooth', 'important');` }
            ];
            extensionsToCreate.forEach(ext => {
                const p = path.join(extPath, ext.id);
                if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
                fs.writeFileSync(path.join(p, 'manifest.json'), JSON.stringify({ name: ext.name, version: "1.0", description: ext.desc, css: ext.css ? 'style.css' : undefined }));
                if (ext.script) fs.writeFileSync(path.join(p, 'script.js'), ext.script);
                if (ext.css) fs.writeFileSync(path.join(p, 'style.css'), ext.css);
            });
        }
    }

    function setupContextMenus() {
        ipcMain.on('show-context-menu', (event, params) => {
            const menu = new Menu();
            const win = BrowserWindow.fromWebContents(event.sender);

            if (params.linkURL) {
                menu.append(new MenuItem({ label: 'Link in neuem Tab öffnen', click: () => event.sender.send('tab-action', { action: 'new-tab-url', url: params.linkURL }) }));
                menu.append(new MenuItem({ label: 'Link in privatem Tab öffnen', click: () => event.sender.send('tab-action', { action: 'new-private-tab-url', url: params.linkURL }) }));
                menu.append(new MenuItem({ type: 'separator' }));
                menu.append(new MenuItem({ label: 'Lesezeichen für Link hinzufügen...', click: () => event.sender.send('tab-action', { action: 'bookmark-url', url: params.linkURL, title: params.linkText || params.linkURL }) }));
                menu.append(new MenuItem({ type: 'separator' }));
                menu.append(new MenuItem({ label: 'Link-Adresse kopieren', click: () => { const { clipboard } = require('electron'); clipboard.writeText(params.linkURL); } }));
                try {
                    const cleanUrl = new URL(params.linkURL);
                    cleanUrl.search = ''; 
                    menu.append(new MenuItem({ label: 'Saubere Link-Adresse kopieren', click: () => { const { clipboard } = require('electron'); clipboard.writeText(cleanUrl.toString()); } }));
                } catch(e) {}
                menu.append(new MenuItem({ type: 'separator' }));
            }

            if (params.mediaType === 'image') {
                menu.append(new MenuItem({ label: '✨ Bild mit AI analysieren', click: () => event.sender.send('ai-action', { type: 'image', task: 'Beschreibe mir dieses Bild im Detail.', url: params.srcURL, x: params.x, y: params.y }) }));
                menu.append(new MenuItem({ type: 'separator' }));
                menu.append(new MenuItem({ label: 'Grafik in neuem Tab öffnen', click: () => event.sender.send('tab-action', { action: 'new-tab-url', url: params.srcURL }) }));
                menu.append(new MenuItem({ label: 'Grafik speichern unter...', click: () => event.sender.downloadURL(params.srcURL) }));
                menu.append(new MenuItem({ label: 'Grafik kopieren', click: () => win.webContents.copyImageAt(params.x, params.y) }));
                menu.append(new MenuItem({ label: 'Grafikadresse kopieren', click: () => { const { clipboard } = require('electron'); clipboard.writeText(params.srcURL); } }));
                menu.append(new MenuItem({ type: 'separator' }));
                
                if (process.platform === 'win32') {
                    menu.append(new MenuItem({ label: 'Bild als Hintergrundbild einrichten...', click: () => {
                        event.sender.send('show-toast', 'Hintergrund wird eingerichtet... ⏳');
                        ipcMain.emit('set-wallpaper', event, params.srcURL);
                    }}));
                    menu.append(new MenuItem({ type: 'separator' }));
                }
            }

            if (params.selectionText && params.selectionText.trim().length > 0) {
                const selText = params.selectionText.trim();
                
                const aiMenu = new Menu();
                aiMenu.append(new MenuItem({ label: 'Zusammenfassen', click: () => event.sender.send('ai-action', { type: 'explain', task: 'Fasse diesen Text in wenigen Sätzen präzise zusammen:', text: selText }) }));
                aiMenu.append(new MenuItem({ label: 'Erkläre das', click: () => event.sender.send('ai-action', { type: 'explain', task: 'Erkläre diesen Text einfach und verständlich:', text: selText }) }));
                aiMenu.append(new MenuItem({ label: 'Frag mich ab', click: () => event.sender.send('ai-action', { type: 'explain', task: 'Stelle mir 3 kurze Quiz-Fragen zu diesem Text, um mein Wissen zu testen:', text: selText }) }));
                aiMenu.append(new MenuItem({ label: 'Korrekturlesen', click: () => event.sender.send('ai-action', { type: 'explain', task: 'Korrigiere Rechtschreibung und Grammatik für diesen Text:', text: selText }) }));

                menu.append(new MenuItem({ label: '✨ Einen KI-Chatbot fragen', submenu: aiMenu }));
                
                let shortText = selText.substring(0, 20);
                if (selText.length > 20) shortText += '...';
                menu.append(new MenuItem({ label: `Nach "${shortText}" suchen`, click: () => event.sender.send('tab-action', { action: 'search-web', text: selText }) }));
                menu.append(new MenuItem({ type: 'separator' }));
                menu.append(new MenuItem({ label: 'Kopieren', role: 'copy' }));
            }

            if (!params.linkURL && params.mediaType !== 'image' && !params.selectionText) {
                menu.append(new MenuItem({ label: 'Zurück', click: () => event.sender.send('tab-action', { action: 'go-back' }) }));
                menu.append(new MenuItem({ label: 'Vorwärts', click: () => event.sender.send('tab-action', { action: 'go-forward' }) }));
                menu.append(new MenuItem({ label: 'Neu laden', click: () => event.sender.send('tab-action', { action: 'reload' }) }));
                menu.append(new MenuItem({ type: 'separator' }));
                menu.append(new MenuItem({ label: 'Alles auswählen', role: 'selectAll' }));
                menu.append(new MenuItem({ type: 'separator' }));
                menu.append(new MenuItem({ label: 'Drucken...', role: 'print' }));
            }

            menu.append(new MenuItem({ type: 'separator' }));
            menu.append(new MenuItem({ label: 'Untersuchen (Q)', click: () => event.sender.send('tab-action', { action: 'inspect-element', x: params.x, y: params.y }) }));

            menu.popup(win);
        });

        ipcMain.on('show-tab-menu', (event, tabId) => {
            const menu = new Menu();
            menu.append(new MenuItem({ label: 'Duplizieren', click: () => event.sender.send('tab-action', { action: 'duplicate', id: tabId }) }));
            menu.append(new MenuItem({ label: 'Alle anderen schließen', click: () => event.sender.send('tab-action', { action: 'close-others', id: tabId }) }));
            menu.append(new MenuItem({ type: 'separator' }));
            menu.append(new MenuItem({ label: 'DevTools öffnen', click: () => event.sender.send('tab-action', { action: 'devtools', id: tabId }) }));
            menu.popup(BrowserWindow.fromWebContents(event.sender));
        });
    }
}