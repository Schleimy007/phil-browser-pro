// managers/SettingsManager.js
class SettingsManager {
    constructor() {
        this.config = JSON.parse(localStorage.getItem('phil_settings_v4')) || {
            theme: 'dark',
            searchEngine: 'https://www.google.com/search?q=',
            startPage: 'default',
            snoozingEnabled: true,
            blockTrackers: true,
            clearOnExit: false,
            keepDownloads: true,
            restoreTabs: false,
            shortcuts: {
                newTab: 'ctrl+t',
                newPrivateTab: 'ctrl+shift+n',
                closeTab: 'ctrl+w',
                focusUrl: 'ctrl+l',
                history: 'ctrl+h',
                find: 'ctrl+f',
                print: 'ctrl+p',
                cmdPalette: 'ctrl+shift+p'
            }
        };
    }

    get(key) { return this.config[key]; }

    set(key, value) {
        this.config[key] = value;
        localStorage.setItem('phil_settings_v4', JSON.stringify(this.config));
    }

    bindUI(app) {
        document.getElementById('set-theme').value = this.get('theme');
        document.getElementById('set-startpage').value = this.get('startPage');
        document.getElementById('set-search').value = this.get('searchEngine');
        document.getElementById('set-snoozing').checked = this.get('snoozingEnabled');
        document.getElementById('set-blockers').checked = this.get('blockTrackers');
        document.getElementById('set-clear-exit').checked = this.get('clearOnExit');
        document.getElementById('set-keep-dl').checked = this.get('keepDownloads');
        document.getElementById('set-restore-tabs').checked = this.get('restoreTabs');

        // Der neue Game-Style Shortcut Listener!
        const shorts = this.get('shortcuts');
        for (const [key, val] of Object.entries(shorts)) {
            const el = document.getElementById(`short-${key}`);
            if (el) {
                el.value = val;
                el.readOnly = true; // Verhindert normales Tippen

                el.addEventListener('keydown', (e) => {
                    e.preventDefault(); // Stoppt das Eingeben von Buchstaben

                    if (e.key === 'Escape') {
                        el.blur();
                        return;
                    }

                    // Ignoriere reine Modifier-Tasten, bis eine "echte" Taste gedrückt wird
                    if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(e.key)) return;

                    const keys = [];
                    if (e.ctrlKey) keys.push('ctrl');
                    if (e.altKey) keys.push('alt');
                    if (e.shiftKey) keys.push('shift');

                    let mainKey = e.key.toLowerCase();
                    if (mainKey === ' ') mainKey = 'space';

                    keys.push(mainKey);
                    const combo = keys.join('+');

                    el.value = combo;

                    const current = this.get('shortcuts');
                    current[key] = combo;
                    this.set('shortcuts', current);

                    app.ui.showToast(`Tastenkürzel gespeichert: ${combo}`);
                    el.blur();
                });
            }
        }

        window.electronAPI.updateAdblocker(this.get('blockTrackers'));

        document.getElementById('set-theme').addEventListener('change', (e) => {
            this.set('theme', e.target.value);
            app.ui.applyTheme(e.target.value);
            app.ui.showToast("Theme aktualisiert!");
        });
        document.getElementById('set-startpage').addEventListener('change', (e) => {
            this.set('startPage', e.target.value);
            app.ui.showToast("Startseite gespeichert");
        });
        document.getElementById('set-search').addEventListener('change', (e) => {
            this.set('searchEngine', e.target.value);
            app.ui.showToast("Suchmaschine gespeichert");
        });
        document.getElementById('set-snoozing').addEventListener('change', (e) => this.set('snoozingEnabled', e.target.checked));
        document.getElementById('set-blockers').addEventListener('change', (e) => {
            this.set('blockTrackers', e.target.checked);
            window.electronAPI.updateAdblocker(e.target.checked);
            app.ui.showToast("Tracker-Blocker aktualisiert");
        });
        document.getElementById('set-clear-exit').addEventListener('change', (e) => this.set('clearOnExit', e.target.checked));
        document.getElementById('set-keep-dl').addEventListener('change', (e) => this.set('keepDownloads', e.target.checked));
        document.getElementById('set-restore-tabs').addEventListener('change', (e) => {
            this.set('restoreTabs', e.target.checked);
            app.ui.showToast(e.target.checked ? "Tabs werden beim nächsten Start wiederhergestellt" : "Tabs werden beim Beenden gelöscht");
        });

        document.querySelectorAll('.settings-sidebar .set-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.settings-sidebar .set-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.set-section').forEach(s => s.style.display = 'none');
                tab.classList.add('active');
                document.getElementById(tab.getAttribute('data-target')).style.display = 'block';
            });
        });
    }
}