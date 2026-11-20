// AgentPong — эмоции агента по новым спрайт-листам 2x2 (Asset/agent/frames/)
// Каждое настроение — 4 кадра 512x512, нарезка: слева-направо, сверху-вниз.
// Эмоция = короткая петля из 4 кадров; idle — медленная петля happy.

const FR = (mood, n) => `../Asset/agent/frames/${mood}-${n}.png`;
const seq = (mood) => [1, 2, 3, 4].map((n) => FR(mood, n));

// настроение -> последовательность кадров (файлы mood-1..4.png)
export const EMOTIONS = {
    // события -> настроение-лист
    greet:    seq('happy'),     // поздоровались
    farewell: seq('angry'),     // уходит нехотя
    thanks:   seq('happy'),
    laugh:    seq('laugh'),
    mocking:  seq('mocking'),
    gotcha:   seq('mocking'),   // сарказм, подловил
    doubt:    seq('think'),
    idk:      seq('think'),
    think:    seq('think'),
    eureka:   seq('eureka'),
    shock:    seq('shock'),     // изумление
    sorry:    seq('bored'),
    stern:    seq('angry'),
    annoyed:  seq('angry'),
    accuse:   seq('mocking'),
    shrug:    seq('happy'),
    scheming: seq('scheming'),
    sneaky:   seq('scheming'),
    waiting:  seq('busy'),
    check:    seq('busy'),
    busy:     seq('busy'),
    search:   seq('search'),    // поиск/сканирование
    proud:    seq('happy'),
    bored:    seq('bored'),
    angry:    seq('angry'),
    happy:    seq('happy'),
    // старые теги ворчания виджета — алиасы на новые настроения
    'eyes-shut':     seq('bored'),
    strut:           seq('angry'),
    'outrage-point': seq('angry'),
    neutral:  null,             // idle-петля IDLE
};

// idle: медленная беззаботная петля «стоит, руки в карманах»
export const IDLE = seq('happy');

// ключи, при которых агент подпрыгивает (css .excited)
export const EXCITED = new Set(['laugh', 'mocking', 'gotcha', 'eureka', 'accuse']);

export function framesOf(key) {
    return EMOTIONS[key] || null;
}

// совместимость: одиночный кадр (первый из последовательности)
export function srcOf(key) {
    const f = framesOf(key);
    return f ? f[0] : null;
}

// предзагрузка всех кадров, чтобы петли не мигали при первой смене src
let preloaded = false;
export function preloadAll() {
    if (preloaded) return;
    preloaded = true;
    for (const frames of Object.values(EMOTIONS)) {
        if (!frames) continue;
        for (const src of frames) {
            const im = new Image();
            im.src = src;
        }
    }
}
