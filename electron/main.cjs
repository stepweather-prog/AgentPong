// AgentPong — Electron-виджет Глосса Скряги
// Окно без рамки, прозрачное, поверх всех, живёт в трее.
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell } = require('electron');
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
    // обычное окно: системная шапка, фон как в браузере — тащится нативно и гладко
    win = new BrowserWindow({
        width: 420,
        height: 680,
        backgroundColor: '#141b24',
        alwaysOnTop: true,
        autoHideMenuBar: true,
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
ipcMain.on('ap:open-external', (e, url) => { if (/^https?:\/\//.test(String(url))) shell.openExternal(url); });

/* ---------- системный TTS Windows (0 МБ, оффлайн, надёжно) ---------- */
const { spawn } = require('child_process');

function runPs(script) {
    const args = ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
    return new Promise((resolve) => {
        const p = spawn('powershell.exe', args, { windowsHide: true });
        let out = '';
        p.stdout.on('data', (d) => { out += d; });
        let done = false;
        const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
        p.on('error', () => finish(null));
        p.on('exit', (code) => finish(code === 0 ? out : null));
    });
}

// список установленных голосов SAPI (для настроек виджета)
ipcMain.handle('tts:voices', async () => {
    const script =
        'Add-Type -AssemblyName System.Speech; ' +
        '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ' +
        "$s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name + '|' + $_.VoiceInfo.Culture.Name }";
    const out = await runPs(script);
    if (out === null) return { ok: false, voices: [], why: 'PowerShell System.Speech не поднялся' };
    const voices = String(out).split(/\r?\n/).map(l => l.trim()).filter(Boolean).map((l) => {
        const i = l.lastIndexOf('|');
        return { name: l.slice(0, i), culture: l.slice(i + 1) };
    });
    return { ok: true, voices };
});

// payload: { text, voiceName? } или просто строка (старый контракт)
ipcMain.handle('tts:ps', (event, payload) => {
    const { text, voiceName } = (payload && typeof payload === 'object' && !Buffer.isBuffer(payload))
        ? payload : { text: payload, voiceName: null };
    const textB64 = Buffer.from(String(text || ''), 'utf8').toString('base64');
    const voiceB64 = Buffer.from(String(voiceName || ''), 'utf8').toString('base64');
    const script =
        'Add-Type -AssemblyName System.Speech; ' +
        '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ' +
        "$all = $s.GetInstalledVoices(); " +
        "$pref = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + voiceB64 + "')); " +
        "$v = @($all | Where-Object { $_.VoiceInfo.Name -eq $pref })[0]; " +
        "if (-not $v) { $v = @($all | Where-Object { $_.VoiceInfo.Culture.Name -like 'ru*' })[0]; } " +
        'if (-not $v) { $v = @($all)[0]; } ' +
        'if ($v) { $s.SelectVoice($v.VoiceInfo.Name); } ' +
        "$t = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + textB64 + "')); " +
        '$s.Speak($t)';
    return runPs(script).then((out) => out !== null);
});

/* ---------- разведка железа (для автоконтроля памяти) ---------- */
const osInfo = require('os');

ipcMain.handle('hw:info', async () => {
    const total = Math.round(osInfo.totalmem() / (1024 * 1024));
    const script =
        'Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name + \'|\' + [math]::Round($_.AdapterRAM / 1MB) }';
    let gpuName = '';
    let vramMB = 0;
    try {
        const args = ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
        const p = spawn('powershell.exe', args, { windowsHide: true });
        const out = await new Promise((resolve) => {
            let s = '';
            p.stdout.on('data', (d) => { s += d; });
            p.on('error', () => resolve(''));
            p.on('exit', () => resolve(s));
        });
        // AdapterRAM — uint32: честен до 4 ГБ; для карт больше берём максимум строку с GPU
        for (const line of String(out).split(/\r?\n/).filter(Boolean)) {
            const i = line.lastIndexOf('|');
            const name = line.slice(0, i).trim();
            const mem = Number(line.slice(i + 1)) || 0;
            if (!gpuName || mem > vramMB) { gpuName = name; vramMB = mem; }
        }
    } catch (_) { /* без GPU-инфо работаем по ОЗУ */ }
    return {
        gpuName,
        vramMB: vramMB,   // если WMI не дал — 0, гвард работает только в режиме предупреждений
        ramTotalMB: total,
        ramFreeMB: Math.round(osInfo.freemem() / (1024 * 1024)),
    };
});

/* ---------- CORS-мост для облачных мозгов ---------- */
// Китайские API (api.z.ai, open.bigmodel.cn, dashscope…) не отдают заголовок
// Access-Control-Allow-Origin — Chromium рубит fetch у Скряги ещё до сети
// («не достучался»). Curl этот заголовок не проверяет, потому curl работает.
// Мост: доклеиваем разрешение на перелёте, webSecurity у окна НЕ трогаем.
const CORS_HOSTS = /(z\.ai|bigmodel\.cn|dashscope\.aliyuncs|deepseek\.com|api\.x\.ai|openrouter\.ai)$/;
app.whenReady().then(() => {
    const { session } = require('electron');
    const wr = (session.defaultSession || session).webRequest;
    const filter = { urls: ['https://*/*'] };
    wr.onHeadersReceived(filter, (details, cb) => {
        if (CORS_HOSTS.test(new URL(details.url).hostname)) {
            const h = details.responseHeaders || {};
            h['Access-Control-Allow-Origin'] = ['*'];
            h['Access-Control-Allow-Headers'] = ['*'];
            h['Access-Control-Allow-Methods'] = ['GET, POST, OPTIONS'];
            details.responseHeaders = h;
        }
        cb({ responseHeaders: details.responseHeaders });
    });
});

/* ---------- старт ---------- */
// разрешаем Dawn-фичу shader-f16 там, где карта умеет, но браузер по умолчанию
// держит её за флагом (иначе q4f16-модели падают с 'requires shader-f16')
app.commandLine.appendSwitch('enable-dawn-features', 'allow_unsafe_apis');

app.whenReady().then(async () => {
    const { port } = await startServer();
    createWindow(`http://localhost:${port}/ui/?widget=1`);
    createTray();
    win.on('page-title-updated', (e) => e.preventDefault());
});

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { /* висим в трее */ });
