// AgentPong — Electron-виджет Глосса Скряги
// Окно без рамки, прозрачное, поверх всех, живёт в трее.
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8091;
let win = null;
let tray = null;
let quitting = false;

/* ---------- внутренний статик-сервер (как tools/serve-ui.js) ---------- */
const MIME = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png',
};
function startServer() {
    // порт может быть занят UI-сервером — ищем свободный
    return new Promise((resolve) => {
        const tryListen = (port) => {
            const srv = http.createServer((req, res) => {
                let p = decodeURIComponent(req.url.split('?')[0]);
                if (p === '/') p = '/ui/';
                if (p.endsWith('/')) p += 'index.html';
                const file = path.normalize(path.join(ROOT, p));
                if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
                fs.readFile(file, (err, data) => {
                    if (err) { res.writeHead(404); return res.end(); }
                    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
                    res.end(data);
                });
            });
            srv.once('error', () => tryListen(port + 1));
            srv.listen(port, () => resolve({ srv, port }));
        };
        tryListen(PORT);
    });
}

/* ---------- окно ---------- */
function createWindow(url) {
    win = new BrowserWindow({
        width: 400,
        height: 640,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,          // живём в трее, а не в панели задач
        resizable: true,
        icon: path.join(ROOT, 'Asset', 'agent', 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
        },
    });
    win.loadURL(url);
    win.setAlwaysOnTop(true, 'screen-saver');

    // журнал движений — renderer сам решит, когда поворчать
    let lastMove = 0;
    win.on('move', () => {
        const now = Date.now();
        if (now - lastMove > 3000) { lastMove = now; win.webContents.send('ap:moved'); }
    });

    // закрытие = спрятаться в трей, выход — из меню трея
    win.on('close', (e) => {
        if (!quitting) {
            e.preventDefault();
            win.hide();
            win.webContents.send('ap:hidden');
        }
    });
}

/* ---------- трей ---------- */
function createTray() {
    const img = nativeImage.createFromPath(path.join(ROOT, 'Asset', 'agent', 'icon.png')).resize({ width: 32, height: 32 });
    tray = new Tray(img);
    tray.setToolTip('Глосс Скряга — AgentPong');
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Показать Скрягу', click: () => showWin() },
        { label: 'Спрятать (пусть ворчит)', click: () => hideWin() },
        { type: 'separator' },
        { label: 'Поверх всех окон', type: 'checkbox', checked: true, click: (mi) => { if (win) { win.setAlwaysOnTop(mi.checked, 'screen-saver'); } } },
        { type: 'separator' },
        { label: 'Выход', click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on('click', () => { if (win && win.isVisible()) hideWin(); else showWin(); });
}

function showWin() {
    if (!win) return;
    win.show();
    win.webContents.send('ap:shown');
}
function hideWin() {
    if (!win) return;
    win.hide();
    win.webContents.send('ap:hidden');
}

/* ---------- IPC от виджета ---------- */
ipcMain.on('ap:minimize', () => hideWin());
ipcMain.on('ap:quit', () => { quitting = true; app.quit(); });
ipcMain.on('ap:drag-start', () => { if (win) win.webContents.send('ap:drag'); });

/* ---------- старт ---------- */
app.whenReady().then(async () => {
    const { port } = await startServer();
    createWindow(`http://localhost:${port}/ui/?widget=1`);
    createTray();
    win.on('page-title-updated', (e) => e.preventDefault());
});

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { /* висим в трее */ });
