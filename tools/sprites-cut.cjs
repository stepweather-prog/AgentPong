// Нарезка спрайт-листов 2x2 -> 4 кадра PNG с прозрачным фоном.
// Фон глушится flood-fill'ом от краёв кадра (связанный белый), внутренние
// белые зоны (шар-голова, блики) не трогаются. Запуск: node tools/sprites-cut.cjs
const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');

const SRC = path.join(__dirname, '..', 'Asset', 'agent');
const OUT = path.join(SRC, 'frames');
fs.mkdirSync(OUT, { recursive: true });

// лист (по началу имени файла) -> ключ эмоции в коде
const SHEETS = [
    ['веселый', 'happy'],
    ['задумчивость', 'think'],
    ['размышление', 'eureka'],
    ['изумление', 'shock'],
    ['скряга', 'scheming'],
    ['вредный', 'mocking'],
    ['скучает', 'bored'],
    ['возмущение', 'angry'],
    ['поиск', 'search'],
    ['смех', 'laugh'],
    ['занятый', 'busy'],
];

const WHITE = 225;          // порог «практически белый»
async function cutFrame(img, x, y, size) {
    const f = img.clone().crop(x, y, size, size);
    const w = f.bitmap.width, h = f.bitmap.height;
    const data = f.bitmap.data;
    const isWhite = (i) => {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        return r >= WHITE && g >= WHITE && b >= WHITE && Math.abs(r - b) < 25 && Math.abs(r - g) < 25;
    };
    // BFS от всех краевых пикселей
    const seen = new Uint8Array(w * h);
    const queue = [];
    for (let px = 0; px < w; px++) { queue.push(px, 0, px, h - 1); }
    for (let py = 0; py < h; py++) { queue.push(0, py, w - 1, py); }
    while (queue.length) {
        const py = queue.pop(), px = queue.pop();
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        const idx = py * w + px;
        if (seen[idx]) continue;
        seen[idx] = 1;
        if (!isWhite(idx * 4)) continue;   // фон дальше не растёт
        data[idx * 4 + 3] = 0;             // глушим альфу
        queue.push(px + 1, py, px - 1, py, px, py + 1, px, py - 1);
    }
    return f;
}

(async () => {
    const files = fs.readdirSync(SRC).filter((f) => f.toLowerCase().endsWith('.jpeg'));
    let made = 0;
    for (const name of files) {
        const low = name.toLowerCase();
        const mood = SHEETS.find(([pre]) => low.startsWith(pre));
        if (!mood) { console.log('ПРОПУСК (нет ключа):', name); continue; }
        const img = await Jimp.read(path.join(SRC, name));
        const w = img.getWidth(), h = img.getHeight();
        if (w !== 1024 || h !== 1024) { console.log('ЖДЕМ 1024x1024, а тут', w, h, name); continue; }
        const half = w / 2;
        // порядок кадров: слева-направо, сверху-вниз
        const quads = [[0, 0], [half, 0], [0, half], [half, half]];
        for (let i = 0; i < 4; i++) {
            const f = await cutFrame(img, quads[i][0], quads[i][1], half);
            const out = path.join(OUT, mood[1] + '-' + (i + 1) + '.png');
            fs.writeFileSync(out, await f.getBufferAsync(Jimp.MIME_PNG));
            made++;
        }
        console.log('нарезано:', name, '->', mood[1] + '-1..4');
    }
    console.log('итого кадров:', made);
})().catch((e) => { console.error('ПАДАНИЕ:', e.message); process.exit(1); });
