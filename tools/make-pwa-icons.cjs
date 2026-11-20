// AgentPong — генерация PWA-иконок из Asset/agent/icon.png
// Запуск: node tools/make-pwa-icons.cjs
const path = require('path');
const Jimp = require('jimp');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'Asset', 'agent', 'icon.png');
const OUT = path.join(ROOT, 'Asset', 'icons');

async function main() {
    const src = await Jimp.read(SRC);
    const bg = Jimp.intToRGBA(src.getPixelColor(0, 0));
    console.log('фон иконки: rgb(' + [bg.r, bg.g, bg.b].join(', ') + ')');

    // обычные — просто масштаб
    for (const size of [192, 512]) {
        await src.clone().resize(size, size).quality(90)
            .writeAsync(path.join(OUT, 'icon-' + size + '.png'));
    }

    // maskable — safe zone: картинка 80% по центру, фон из угла исходника
    const m = new Jimp(512, 512, Jimp.rgbaToInt(bg.r, bg.g, bg.b, 255));
    const inner = src.clone().resize(410, 410);
    m.composite(inner, (512 - 410) / 2, (512 - 410) / 2);
    await m.quality(90).writeAsync(path.join(OUT, 'icon-maskable-512.png'));

    console.log('готово: Asset/icons/{icon-192,icon-512,icon-maskable-512}.png');
}

main().catch((e) => { console.error(e); process.exit(1); });
