// managers/SessionManager.js
class SessionManager {
    constructor(app) {
        this.app = app;
    }

    saveSession() {
        if (!this.app.tabManager) return;

        if (!this.app.settings.get('restoreTabs')) {
            localStorage.removeItem('phil_session_v2');
            return;
        }

        const tabsData = Array.from(this.app.tabManager.tabs.values()).map(t => ({
            url: t.url,
            title: t.title,
            isPrivate: t.isPrivate,
            active: t.id === this.app.tabManager.activeTabId
        }));
        localStorage.setItem('phil_session_v2', JSON.stringify(tabsData));
    }

    restoreSession(startPage) {
        const tabsData = this.app.settings.get('restoreTabs') ? (JSON.parse(localStorage.getItem('phil_session_v2')) || []) : [];

        if (tabsData.length === 0) {
            this.app.tabManager.createTab(startPage);
            return;
        }

        let activeId = null;
        tabsData.forEach(t => {
            if (!t.isPrivate) {
                const id = this.app.tabManager.createTab(t.url, false, true);
                if (t.active) activeId = id;
            }
        });

        if (this.app.tabManager.tabs.size === 0) {
            this.app.tabManager.createTab(startPage);
        } else if (activeId) {
            this.app.tabManager.switchTab(activeId);
        } else {
            const firstId = Array.from(this.app.tabManager.tabs.keys())[0];
            this.app.tabManager.switchTab(firstId);
        }
    }

}