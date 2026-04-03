// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getAppPath: () => ipcRenderer.invoke('get-app-path'),
    windowControl: (command) => ipcRenderer.send('window-control', command),
    getMemoryInfo: () => ipcRenderer.invoke('get-memory-info'),
    openFolder: (path) => ipcRenderer.send('open-folder', path),
    openFile: (path) => ipcRenderer.send('open-file', path),
    showContextMenu: (params) => ipcRenderer.send('show-context-menu', params),
    showTabMenu: (tabId) => ipcRenderer.send('show-tab-menu', tabId),
    clearData: () => ipcRenderer.invoke('clear-data'),
    clearCookies: (domain) => ipcRenderer.invoke('clear-cookies', domain),
    getExtensions: () => ipcRenderer.invoke('get-extensions'),
    saveExtensionState: (id, state) => ipcRenderer.send('save-extension-state', id, state),
    installExtension: () => ipcRenderer.invoke('install-extension'), 
    downloadAction: (data) => ipcRenderer.send('download-action', data),
    updateAdblocker: (enabled) => ipcRenderer.send('update-adblocker', enabled),
    findInPage: (data) => ipcRenderer.send('find-in-page', data),
    updateActivity: (data) => ipcRenderer.send('update-activity', data),
    saveCredentials: (data) => ipcRenderer.invoke('save-credentials', data),
    getCredentials: (domain) => ipcRenderer.invoke('get-credentials', domain),

    isDefaultBrowser: () => ipcRenderer.invoke('is-default-browser'),
    setAsDefaultBrowser: () => ipcRenderer.invoke('set-as-default-browser'),
    getDRMState: () => ipcRenderer.invoke('get-drm-state'),
    setDRMState: (state) => ipcRenderer.invoke('set-drm-state', state),

    getStartArgs: () => ipcRenderer.invoke('get-start-args'),
    
    fetchImage: (url) => ipcRenderer.invoke('fetch-image', url),
    fetchAI: (messages) => ipcRenderer.invoke('fetch-ai', messages),

    onAdBlocked: (callback) => ipcRenderer.on('ad-blocked', (event, count) => callback(count)),
    onDownloadStart: (callback) => ipcRenderer.on('download-start', (event, data) => callback(data)),
    onDownloadProgress: (callback) => ipcRenderer.on('download-progress', (event, data) => callback(data)),
    onDownloadDone: (callback) => ipcRenderer.on('download-done', (event, data) => callback(data)),
    onAIAction: (callback) => ipcRenderer.on('ai-action', (event, data) => callback(data)),
    onTabAction: (callback) => ipcRenderer.on('tab-action', (event, data) => callback(data)),
    onExecuteFind: (callback) => ipcRenderer.on('execute-find', (event, data) => callback(data)),
    onShowToast: (callback) => ipcRenderer.on('show-toast', (event, msg) => callback(msg)),

    // --- NEU: AUTO UPDATER BINDINGS ---
    onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (event, version) => callback(version)),
    onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', () => callback()),
    downloadUpdate: () => ipcRenderer.send('download-update'),
    installUpdate: () => ipcRenderer.send('install-update'),
    quitApp: () => ipcRenderer.send('quit-app')
});