# 🚀 Phil Browser Pro

Willkommen beim **Phil Browser Pro** – einem modernen, blitzschnellen und funktionsreichen Desktop-Browser, der speziell für Power-User, Gamer und Produktivität entwickelt wurde. Basierend auf Electron kombiniert dieser Browser ein schlankes Design mit mächtigen integrierten Tools.

---

## ✨ Killer-Features

* 🤖 **Nativer KI-Assistent (Deep Search):** Ein direkt integrierter KI-Chatbot (powered by Google Gemini 2.5 Flash). Markiere Texte oder Bilder auf Webseiten und lass sie dir von der KI erklären. Dank *Deep Search* googelt die KI live im Internet und liefert dir Quellen direkt mit aus.
* 🎮 **Discord Rich Presence (RPC):** Zeige deinen Freunden auf Discord automatisch an, was du gerade machst (z.B. "Schaut YouTube 📺", "Chattet auf Discord 💬" oder "Surft inkognito 🥷").
* 📱 **Stufenlose App-Sidebar:** Schneller Zugriff auf Web-Apps wie Discord, Twitch und Spotify in einer eleganten Sidebar, die du mit der Maus perfekt in der Breite anpassen kannst.
* 🎬 **DRM & Streaming-Modus:** Integrierter Kopierschutz-Support, damit du Netflix, Prime Video und Co. problemlos in bester Qualität schauen kannst.
* 📝 **Quick Notes:** Ein ausklappbares Notiz-Panel direkt im Browser, damit du deine Gedanken festhalten kannst, ohne den Tab wechseln zu müssen.
* 🌓 **Universal Dark Mode & Design:** Ein wunderschönes, anpassbares Interface mit modern abgerundeten Ecken, Custom Scrollbars und einem augenschonenden Lese-Modus (Reader Mode).
* 📺 **Picture-in-Picture (PiP):** Drücke einfach `Alt + P` auf einem Video, um es in einem Mini-Player über all deinen Fenstern schweben zu lassen.
* 🔄 **Auto-Updater:** Du bist immer auf dem neuesten Stand. Sobald ein neues Release verfügbar ist, meldet sich der Browser automatisch.

---

## 🛠️ Installation & Setup (Für Entwickler)

Wenn du den Browser selbst kompilieren oder testen möchtest, folge diesen Schritten:

### 1. Voraussetzungen
* [Node.js](https://nodejs.org/) (Version 16 oder höher empfohlen)
* Einen kostenlosen API-Key von [Google AI Studio](https://aistudio.google.com/) (für den KI-Assistenten)

### 2. Projekt klonen
```bash
git clone [https://github.com/DEIN_NAME/phil-browser-pro.git](https://github.com/DEIN_NAME/phil-browser-pro.git)
cd phil-browser-pro

```
### 3. Abhängigkeiten installieren
```bash
npm install

```
### 4. API Key eintragen
Öffne die main.js und suche nach der Konstante GOOGLE_API_KEY. Trage dort deinen eigenen Google AI Studio Key ein, damit der Chatbot funktioniert:
```javascript
const GOOGLE_API_KEY = "DEIN_EIGENER_KEY_HIER"; 

```
### 5. Browser starten
```bash
npm start

```
## 📦 Build / App verpacken
Um eine fertige .exe Datei für Windows zu generieren:
```bash
npm run build

```
Die fertige Setup-Datei findest du anschließend im dist (oder build) Ordner.
## ⌨️ Tastenkürzel (Shortcuts)
Der Browser unterstützt eine Vielzahl an Hotkeys für schnelles Surfen (diese können in den Einstellungen angepasst werden):
 * Strg + T : Neuer Tab
 * Strg + Shift + N : Neuer privater Tab
 * Strg + D : Lesezeichen hinzufügen
 * Strg + H : Verlauf öffnen
 * Strg + J : Downloads anzeigen
 * Strg + F : Auf Seite suchen
 * Strg + Shift + P : Befehlspalette öffnen
 * Alt + P : Video PiP Mode
## 🛡️ Datenschutz & Sicherheit
Phil Browser Pro legt Wert auf deine Daten. Du kannst deine Cookies, den Verlauf und gespeicherte Passwörter jederzeit über die Einstellungen mit einem Klick löschen. Im Inkognito-Modus werden keine Verläufe lokal gespeichert.

*Entwickelt mit ❤️ und Electron.*
