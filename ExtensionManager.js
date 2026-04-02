// managers/ExtensionManager.js
class ExtensionManager {
    constructor(app) {
        this.app = app;
        this.extensions = [];
        this.bindUI();
    }

    async load() {
        this.extensions = await window.electronAPI.getExtensions();
        this.renderUI();
    }

    inject(webview) {
        const activeExts = this.extensions.filter(e => e.enabled);
        activeExts.forEach(ext => {
            if (ext.script) {
                // BUGFIX: Wir zwingen das Script "null" zurückzugeben, damit Electron nicht versucht DOM-Nodes zu klonen!
                webview.executeJavaScript(ext.script + '\n;null;').catch(err => console.error('Extension Error:', err));
            }
            if (ext.manifest.css) {
                webview.insertCSS(ext.manifest.css).catch(err => console.error('Ext CSS Error:', err));
            }
        });
    }

    toggle(id) {
        const ext = this.extensions.find(e => e.id === id);
        if (ext) {
            ext.enabled = !ext.enabled;
            window.electronAPI.saveExtensionState(id, ext.enabled);
            this.renderUI();
            this.app.ui.showToast(`Erweiterung ${ext.manifest.name} ${ext.enabled ? 'aktiviert' : 'deaktiviert'}`);
        }
    }

    bindUI() {
        const list = document.getElementById('extensions-list');
        if (list) {
            list.addEventListener('change', (e) => {
                if (e.target.tagName === 'INPUT' && e.target.classList.contains('ext-toggle')) {
                    this.toggle(e.target.getAttribute('data-ext-id'));
                }
            });
        }
    }

    renderUI() {
        const list = document.getElementById('extensions-list');
        if (!list) return;
        if (this.extensions.length === 0) {
            list.innerHTML = '<p style="color:var(--text-muted);text-align:center;">Keine Erweiterungen im userData Ordner gefunden.</p>';
            return;
        }
        list.innerHTML = this.extensions.map(e => `
            <div class="ext-item">
                <div class="ext-info">
                    <strong>${e.manifest.name || e.id}</strong>
                    <small style="color:var(--text-muted)">v${e.manifest.version || '1.0'} - ${e.manifest.description || ''}</small>
                </div>
                <label class="switch">
                    <input type="checkbox" class="ext-toggle" data-ext-id="${e.id}" ${e.enabled ? 'checked' : ''}>
                    <span class="slider"></span>
                </label>
            </div>
        `).join('');
    }
}