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
    downloadAction: (data) => ipcRenderer.send('download-action', data),
    updateAdblocker: (enabled) => ipcRenderer.send('update-adblocker', enabled),
    findInPage: (data) => ipcRenderer.send('find-in-page', data),
    updateActivity: (data) => ipcRenderer.send('update-activity', data),

    // NEU: Passwörter sichern
    saveCredentials: (data) => ipcRenderer.invoke('save-credentials', data),
    getCredentials: (domain) => ipcRenderer.invoke('get-credentials', domain),

    onAdBlocked: (callback) => ipcRenderer.on('ad-blocked', (event, count) => callback(count)),
    onDownloadStart: (callback) => ipcRenderer.on('download-start', (event, data) => callback(data)),
    onDownloadProgress: (callback) => ipcRenderer.on('download-progress', (event, data) => callback(data)),
    onDownloadDone: (callback) => ipcRenderer.on('download-done', (event, data) => callback(data)),
    onAIAction: (callback) => ipcRenderer.on('ai-action', (event, data) => callback(data)),
    onTabAction: (callback) => ipcRenderer.on('tab-action', (event, data) => callback(data)),
    onExecuteFind: (callback) => ipcRenderer.on('execute-find', (event, data) => callback(data))
});