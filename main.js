// main.js
const { app, BrowserWindow, session, ipcMain, Menu, MenuItem, shell, safeStorage } = require('electron');
const { autoUpdater } = require('electron-updater'); // Der Auto-Updater
const path = require('path');
const fs = require('fs');

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

const userDataPath = path.join(app.getPath('appData'), 'phil-browser-data');
app.setPath('userData', userDataPath);

app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');
app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');

const gotTheLock = app.requestSingleInstanceLock();
let adblockEnabled = true;

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
                sandbox: true,
                webviewTag: true,
                preload: path.join(__dirname, 'preload.js')
            }
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

        // Checkt lautlos im Hintergrund auf Updates
        autoUpdater.checkForUpdatesAndNotify();
    }

    function setupAdblocker() {
        const blockList = [
            '*://*.doubleclick.net/*', '*://partner.googleadservices.com/*',
            '*://*.googlesyndication.com/*', '*://*.google-analytics.com/*',
            '*://adservice.google.com/*', '*://*.amazon-adsystem.com/*',
            '*://*.scorecardresearch.com/*', '*://*.outbrain.com/*',
            '*://*.taboola.com/*', '*://*.youtube.com/pagead/*',
            '*://*.youtube.com/api/stats/ads*', '*://*.youtube.com/ptracking*',
            '*://*.youtube.com/get_midroll_info*',
            '*://*.googlevideo.com/*&adformat=*',
            '*://*.googlevideo.com/*&ad_type=*',
            '*://*.googlevideo.com/*&adurl=*',
            '*://*.criteo.com/*', '*://*.rubiconproject.com/*',
            '*://*.moatads.com/*', '*://*.appnexus.com/*', '*://*.openx.net/*'
        ];

        const blockHandler = (details, callback) => {
            if (!adblockEnabled) return callback({ cancel: false });
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('ad-blocked', 1);
            }
            callback({ cancel: true });
        };

        const targetSessions = [
            session.defaultSession,
            session.fromPartition('in-memory'),
            session.fromPartition('persist:session')
        ];

        targetSessions.forEach(sess => {
            sess.webRequest.onBeforeRequest({ urls: blockList }, blockHandler);
        });
    }

    function setupDownloadManager() {
        const dlHandler = (event, item, webContents) => handleDownloadItem(item);
        const targetSessions = [
            session.defaultSession,
            session.fromPartition('in-memory'),
            session.fromPartition('persist:session')
        ];
        targetSessions.forEach(sess => sess.on('will-download', dlHandler));
    }

    function handleDownloadItem(item) {
        const id = item.getStartTime().toString();
        activeDownloads.set(id, item);
        const fileName = item.getFilename();
        const totalBytes = item.getTotalBytes();
        const savePath = item.getSavePath() || path.join(app.getPath('downloads'), fileName);

        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('download-start', { id, name: fileName, total: totalBytes, path: savePath });

        let lastSend = 0,
            lastBytes = 0;
        item.on('updated', (event, state) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                const now = Date.now();
                if (now - lastSend > 500 || state !== 'progressing') {
                    const received = item.getReceivedBytes();
                    const speed = ((received - lastBytes) / ((now - lastSend) / 1000)).toFixed(0);
                    mainWindow.webContents.send('download-progress', { id, state, received, total: totalBytes, speed });
                    lastSend = now;
                    lastBytes = received;
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

        let dirs = [];
        try { dirs = fs.readdirSync(extPath); } catch (e) {}

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
            if (params.selectionText) {
                menu.append(new MenuItem({ label: '✨ Mit AI erklären', click: () => event.sender.send('ai-action', { type: 'explain', text: params.selectionText }) }));
                menu.append(new MenuItem({ type: 'separator' }));
                menu.append(new MenuItem({ label: 'Kopieren', role: 'copy' }));
            } else {
                menu.append(new MenuItem({ label: 'Zurück', role: 'back' }));
                menu.append(new MenuItem({ label: 'Vorwärts', role: 'forward' }));
                menu.append(new MenuItem({ label: 'Neu laden', role: 'reload' }));
            }
            menu.popup(BrowserWindow.fromWebContents(event.sender));
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

    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    app.whenReady().then(createWindow);

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') app.quit();
    });

    // PASSWORT MANAGER LOGIK
    const loginsPath = path.join(app.getPath('userData'), 'logins.json');

    ipcMain.handle('save-credentials', (event, { domain, username, password }) => {
        let logins = {};
        if (fs.existsSync(loginsPath)) logins = JSON.parse(fs.readFileSync(loginsPath, 'utf8'));
        // Militärgradige Verschlüsselung via Electron safeStorage (OS-gebunden)
        const encrypted = safeStorage.encryptString(password).toString('base64');
        logins[domain] = { username, password: encrypted };
        fs.writeFileSync(loginsPath, JSON.stringify(logins));
        return true;
    });

    ipcMain.handle('get-credentials', (event, domain) => {
        if (!fs.existsSync(loginsPath)) return null;
        const logins = JSON.parse(fs.readFileSync(loginsPath, 'utf8'));
        if (logins[domain]) {
            try {
                const decrypted = safeStorage.decryptString(Buffer.from(logins[domain].password, 'base64'));
                return { username: logins[domain].username, password: decrypted };
            } catch (e) { return null; }
        }
        return null;
    });

    ipcMain.handle('get-memory-info', async() => process.getSystemMemoryInfo());
    ipcMain.handle('get-app-path', () => app.getAppPath());
    ipcMain.on('update-adblocker', (event, enabled) => { adblockEnabled = enabled; });

    ipcMain.on('update-activity', (event, data) => {
        if (!rpc) return;
        try {
            rpc.setActivity({
                details: "Benutzt Phil Browser Pro 🚀",
                state: data.state,
                startTimestamp: data.startTimestamp,
                largeImageKey: 'https://i.imgur.com/jQrZgDb.png',
                largeImageText: 'Phil Browser Pro',
                buttons: [{ label: "📥 Browser Downloaden", url: "https://drive.google.com/file/d/12eB1KL0irguTkEuwftYhiTLXOmc7mSnf/view" }],
                instance: false,
            });
        } catch (e) {}
    });

    ipcMain.handle('clear-data', async() => {
        await session.defaultSession.clearStorageData();
        if (fs.existsSync(loginsPath)) fs.unlinkSync(loginsPath); // Passwörter auch löschen
        return true;
    });

    ipcMain.handle('clear-cookies', async(event, domain) => {
        const cookies = await session.defaultSession.cookies.get({ domain });
        for (const c of cookies) {
            let url = (c.secure ? 'https://' : 'http://') + c.domain + c.path;
            await session.defaultSession.cookies.remove(url, c.name);
        }
        return true;
    });

    ipcMain.handle('get-extensions', async() => {
        const extPath = path.join(app.getPath('userData'), 'extensions');
        const statesFile = path.join(app.getPath('userData'), 'extensions_state.json');
        let states = {};
        if (fs.existsSync(statesFile)) states = JSON.parse(fs.readFileSync(statesFile, 'utf8'));
        const exts = [];
        if (!fs.existsSync(extPath)) return exts;
        const dirs = fs.readdirSync(extPath);
        for (const d of dirs) {
            try {
                const manifest = JSON.parse(fs.readFileSync(path.join(extPath, d, 'manifest.json'), 'utf8'));
                let script = '',
                    css = '';
                if (fs.existsSync(path.join(extPath, d, 'script.js'))) script = fs.readFileSync(path.join(extPath, d, 'script.js'), 'utf8');
                if (fs.existsSync(path.join(extPath, d, 'style.css'))) css = fs.readFileSync(path.join(extPath, d, 'style.css'), 'utf8');
                exts.push({ id: d, manifest, script, css, enabled: states[d] !== false });
            } catch (e) {}
        }
        return exts;
    });

    ipcMain.on('save-extension-state', (event, id, state) => {
        const statesFile = path.join(app.getPath('userData'), 'extensions_state.json');
        let states = {};
        if (fs.existsSync(statesFile)) states = JSON.parse(fs.readFileSync(statesFile, 'utf8'));
        states[id] = state;
        fs.writeFileSync(statesFile, JSON.stringify(states));
    });

    ipcMain.on('open-folder', (e, folderPath) => shell.showItemInFolder(folderPath));
    ipcMain.on('open-file', (e, filePath) => shell.openPath(filePath));
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
            if (action === 'cancel') {
                item.cancel();
                activeDownloads.delete(id);
            }
        }
    });
    ipcMain.on('find-in-page', (event, { tabId, text }) => {
        if (mainWindow) mainWindow.webContents.send('execute-find', { tabId, text });
    });
}