// managers/PrivacyManager.js
class PrivacyManager {
    constructor(app) {
        this.app = app;
        this.bindUI();
    }

    bindUI() {
        document.getElementById('btn-clear-domain').addEventListener('click', async() => {
            const domain = document.getElementById('clear-domain-input').value.trim();
            if (!domain) return;
            await window.electronAPI.clearCookies(domain);
            this.app.ui.showToast(`Cookies für ${domain} gelöscht!`);
            document.getElementById('clear-domain-input').value = '';
        });

        document.getElementById('btn-clear-data').onclick = async() => {
            await window.electronAPI.clearData();
            localStorage.clear();
            this.app.history = [];
            this.app.downloads = [];
            this.app.ui.showToast('Alle Browserdaten erfolgreich gelöscht!');
            setTimeout(() => window.location.reload(), 1500);
        };
    }
}