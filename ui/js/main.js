// AgentPong — сцена агента
import { srcOf, framesOf, IDLE, EXCITED, preloadAll } from './emotions.js';
import { getBrain, brainList } from './brain/brain.js';
import { cloudStatusText, pingCloud } from './brain/llm-api.js';
import { LOCAL_MODELS, setModel, currentModel, checkModel, hwBudgetMB, initModels, f16State } from './brain/local-llm.js';
import { voice } from './voice/voice.js';
import { initWidget } from './widget.js';

const $ = (id) => document.getElementById(id);
const agent = $('agent'), agentText = $('agent-text'), log = $('log');
const say = $('say'), send = $('send'), mic = $('mic');
const voiceSel = $('voice-engine'), brainSel = $('brain-engine'), status = $('engine-status');

const history = []; // {who:'user'|'agent', text} — только в памяти, как и положено сеансу

/* ---------- покадровый плеер (4-кадровые листы) ---------- */
let animTimer = null, emotionUntil = 0;

function startSeq(frames, ms) {                 // петля из кадров настроения
    clearInterval(animTimer);
    let i = 0;
    agent.src = frames[i];
    animTimer = setInterval(() => {
        if (document.body.classList.contains('dragging')) return;  // тащим — кадр не меняем
        i = (i + 1) % frames.length;
        agent.src = frames[i];
    }, ms);
}

function startIdle() {                          // медленная беззаботная петля
    agent.dataset.emotion = '';
    agent.classList.remove('excited');
    startSeq(IDLE, 520);
}

function playEmotion(key, holdMs = 2600) {
    const frames = framesOf(key);
    if (!frames) return;
    agent.dataset.emotion = key;
    agent.classList.toggle('excited', EXCITED.has(key));
    emotionUntil = performance.now() + holdMs;
    startSeq(frames, 150);                      // живая мимика: цикл ~0.6 с
}

// эмоция отыграла — тихо вернуть idle-петлю
setInterval(() => {
    if (agent.dataset.emotion && performance.now() >= emotionUntil) startIdle();
}, 400);

/* ---------- реплики ---------- */
function logLine(who, text) {
    const div = document.createElement('div');
    div.className = who === 'user' ? 'u' : 'a';
    div.innerHTML = `<span class="who">${who === 'user' ? 'Ты' : 'Понг'}:</span> `;
    div.appendChild(document.createTextNode(text));
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
}

async function agentSay(text, emotion = 'neutral') {
    agentText.textContent = text;
    playEmotion(emotion);
    logLine('agent', text);
    await voice.speak(text, voiceSel.value);
}

/* ---------- руки: локальный парсер команд (этажи 1-3, offline, мгновенно) ---------- */
// Команда ловится ДО мозга: звук/открытие/железо не зависят от облака и не стоят токенов.
// Исполнение — только через apSys (белый список в main-процессе); модель рук не имеет.
const SY = window.apSys;   // в браузере (не виджет) рук нет — уходит обычной репликой

const HANDS = [
    { re: /громче|погромче|(прибав|увелич|повысь|поднажми|добавь)[а-яё]*\s*(звук|громкост)|(звук|громкость)[а-яё]*\s*(больше|выше|прибав|увелич|повыш|добав)/i, run: () => SY.volume('up', 10) },
    { re: /тише|потише|(убав|уменьш|снизь|пониж)[а-яё]*\s*(звук|громкост)|(звук|громкость)[а-яё]*\s*(меньше|ниже|убав|уменьш|сниж|пониж)/i, run: () => SY.volume('down', 10) },
    { re: /(выключ|отключ|заглуши|приглуши)[а-яё]*\s*(звук|громкост)|без\s+звука|мьют/i, run: () => SY.volume('mute') },
    { re: /(запусти|открой)(те)?\s+браузер/i, perm: 'launch', run: () => SY.openApp('browser') },
    { re: /(запусти|открой)(те)?\s+блокнот/i, perm: 'launch', run: () => SY.openApp('notepad') },
    { re: /(запусти|открой)(те)?\s+калькулятор/i, perm: 'launch', run: () => SY.openApp('calc') },
    { re: /что\s+у\s+нас\s+с\s+железом|сколько\s+памяти|какая\s+(видео)?карта|характеристик/i, run: async () => {
        const hw = SY.hw ? await SY.hw() : null;
        if (!hw) return 'Нахожусь в обычном браузере — туда моё железное чутьё не дотягивается.';
        return 'Глянем в нутро: ' + (hw.gpuName || 'видеокарта не опознана')
            + ', VRAM около ' + hw.vramMB + ' МБ, ОЗУ свободно '
            + hw.ramFreeMB + ' из ' + hw.ramTotalMB + ' МБ. Половину всё равно скуплю.';
    } },
];

// фразы похожи на команду про звук (слова есть), но парсер не понял — помогаем, а не издеваемся
const SOUNDISH = /(звук|громкост)/i;

// реплика руками: в память сеанса + озвучка (история рук тоже одноразовая)
async function handSay(text, emotion = 'neutral') {
    history.push({ who: 'agent', text });
    await agentSay(text, emotion);
}

/* ---------- скилы и турникет разрешений ---------- */
// Скил = действия этажа 3+ (нужен пропуск). Этажи 1-2 (звук, чтение железа) — свободный проход.
// Три состояния на скил: 'ask' | 'always' | 'never'. Хранится только на машине.
const SKILLS = {
    launch: { title: 'Запуск программ из белого списка (браузер, блокнот, калькулятор)' },
};

function perms() {
    try { return JSON.parse(localStorage.getItem('ap.perms') || '{}'); } catch (_) { return {}; }
}
function savePerm(id, v) {
    const p = perms();
    p[id] = v;
    localStorage.setItem('ap.perms', JSON.stringify(p));
}

// спрашивалка: промис — «всегда/сейчас/нет»; в браузере без DOM-элементов просто нет
let permPending = null;
function askPerm(id) {
    if (permPending) { permPending(null); }
    const gate = $('perm-gate'), txt = $('perm-text');
    txt.textContent = 'Скил: ' + SKILLS[id].title + '. Разрешить?';
    gate.hidden = false;
    return new Promise((resolve) => {
        permPending = resolve;
        const done = (v) => { gate.hidden = true; permPending = null; resolve(v); };
        $('perm-always').onclick = () => done('always');
        $('perm-once').onclick = () => done('once');
        $('perm-never').onclick = () => done('never');
    });
}

async function withPerm(id, run, happy, denied) {
    let p = perms()[id] || 'ask';
    if (p === 'never') { await handSay(denied, 'stern'); return; }
    if (p === 'ask') {
        const answer = await askPerm(id);
        if (answer === 'always') { savePerm(id, 'always'); }
        else if (answer === 'never') { savePerm(id, 'never'); await handSay(denied, 'stern'); return; }
        else if (answer === null) { await handSay('Я спрашивал, а ты ушёл. Скупой платит дважды.', 'doubt'); return; }
    }
    await run();
    await handSay(happy, 'eureka');
}

const GATE_REPLIES = {
    happy: [
        'Сделано. Халява, между прочим: ни одного облачного токена не потратил.',
        'Есть. Руками шевелить — это бесплатно, в отличие от вашего интернета.',
        'Готово. Внесено в бухгалтерию под графом «мелочь, не жалко».',
        'Выполнено и зафиксировано: сессия одноразовая, история — тоже.',
    ],
    denied: [
        'Сам ставил турникет «нет» — я не слуга, я экономист. Менять согласие только в настройках.',
        'Пропуск ты мне выписал: «нет». Уважаю: байты целее. Переиграешь — скажи.',
    ],
};

async function tryHands(input) {
    if (!SY) return null;
    for (const [idx, hand] of HANDS.entries()) {
        const m = input.match(hand.re);
        if (!m) continue;
        const happy = GATE_REPLIES.happy[idx % 4];
        if (hand.perm) {
            withPerm(hand.perm, hand.run, happy, GATE_REPLIES.denied[idx % 2]);
        } else {
            try { await hand.run(); } catch (e) { /* отчёт ниже всё равно честный */ }
            await handSay(happy, 'eureka');
        }
        return true;
    }
    // похоже на команду про звук, но ни один жест не узнал фразу — помогаем списком
    if (SOUNDISH.test(input)) {
        return {
            text: 'Команды по звуку я понял бы так: «громче», «тише», «выключи звук». Формулируй ближе — руки у меня быстрые, языковой центр туговат.',
            emotion: 'doubt',
        };
    }
    return null;
}

/* ---------- обмен с мозгом ---------- */
async function handleUser(input) {
    const clean = (input || '').trim();
    if (!clean) return;
    $('user-text').textContent = clean;
    history.push({ who: 'user', text: clean });
    logLine('user', clean);
    say.value = '';

    playEmotion('think', 900);
    status.textContent = 'думает…';
    // сперва руки: команда выполняется локально, без мозга и сети
    if (await tryHands(clean)) {
        status.textContent = '';
        return;
    }
    const brain = getBrain(brainSel.value);
    // ВАЖНО: input уже в history — отдаём историю без него,
    // иначе вопрос уходит в модель дважды и она эхом возвращает его же
    const { text, emotion } = await brain.respond(clean, history.slice(0, -1));
    history.push({ who: 'agent', text });
    status.textContent = '';
    await agentSay(text, emotion);
}

/* ---------- голосовой ввод (STT, ru-RU, встроенный) ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;

mic.addEventListener('click', () => {
    if (!SR) { status.textContent = 'Голосовой ввод тут не поддерживается браузером'; return; }
    if (rec) { rec.stop(); return; }
    rec = new SR();
    rec.lang = 'ru-RU';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => handleUser(e.results[0][0].transcript);
    rec.onend = () => { rec = null; mic.classList.remove('listening'); status.textContent = ''; };
    rec.onerror = (e) => { rec = null; mic.classList.remove('listening'); status.textContent = 'STT: ' + e.error; };
    mic.classList.add('listening');
    status.textContent = 'слушаю…';
    rec.start();
});

/* ---------- события UI ---------- */
send.addEventListener('click', () => handleUser(say.value));
say.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleUser(say.value); });

$('gear').addEventListener('click', () => {
    const s = $('switches');
    s.hidden = !s.hidden;
    if (!s.hidden) refreshStatus();
});

// выход из настроек: крестик, клик мимо окна, Esc
// (клик по ⚙ не считаем «мимо» — иначе обработчик мимо закрывает окно сразу после открытия)
function closeSwitches() { $('switches').hidden = true; }
$('switches-close').addEventListener('click', closeSwitches);
$('switches').addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', (e) => {
    if ($('switches').hidden || $('switches').contains(e.target)) return;
    if (e.target === $('gear') || $('gear').contains(e.target)) return;
    closeSwitches();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSwitches(); });
$('log-toggle').addEventListener('click', () => {
    const l = $('log');
    l.hidden = !l.hidden;
    if (!l.hidden) l.scrollTop = l.scrollHeight;
});

async function refreshStatus() {
    status.textContent = '…';
    status.textContent = await voice.status(voiceSel.value, (p) => {
        status.textContent = `Piper: качаю модель ${(p.loaded / 1e6).toFixed(1)} / ${(p.total / 1e6).toFixed(1)} МБ`;
    });
}

// ---- облако: провайдер + ключ (Grok / OpenRouter / свой URL) ----
const cloudProvider = $('cloud-provider'), cloudUrl = $('cloud-url'),
    cloudModel = $('cloud-model'), cloudKey = $('cloud-key'), cloudStatus = $('cloud-status');

function refreshCloudUI() {
    const on = brainSel.value === 'llm-api';
    $('cloud-row').hidden = !on;
    const prov = localStorage.getItem('ap.cloud_provider') || 'grok';
    const custom = prov === 'custom';
    $('cloud-url-row').hidden = !on || !custom;
    $('cloud-model-row').hidden = !on;
    $('cloud-key-row').hidden = !on;
    $('cloud-status').hidden = !on;
    if (on && !cloudStatus.textContent) cloudStatus.textContent = 'мозг облако: ' + cloudStatusText();
}

// выбор провайдера: дефолтные модель/URL сразу в поля — видно, что будет использовано
cloudProvider.addEventListener('change', () => {
    localStorage.setItem('ap.cloud_provider', cloudProvider.value);
    localStorage.removeItem('ap.cloud_model');       // сброс перекрытия на дефолт провайдера
    cloudStatus.textContent = 'поставщик: ' + cloudStatusText();
    refreshCloudUI();
});

// модель можно перекрыть своей строкой
cloudModel.addEventListener('change', () => {
    const m = cloudModel.value.trim();
    if (m) localStorage.setItem('ap.cloud_model', m);
    else localStorage.removeItem('ap.cloud_model');
    cloudStatus.textContent = 'модель: ' + (m || 'по умолчанию поставщика');
});

// свой URL (только для «Свой URL»)
cloudUrl.addEventListener('change', () => {
    const u = cloudUrl.value.trim();
    if (u) localStorage.setItem('ap.cloud_url', u);
    else localStorage.removeItem('ap.cloud_url');
    cloudStatus.textContent = 'URL сохранён';
});

// ключ — только в localStorage, в репо не попадает
$('cloud-save').addEventListener('click', () => {
    const k = cloudKey.value.trim();
    if (!k) { cloudStatus.textContent = 'поле пустое — ключ не сохранён'; return; }
    localStorage.setItem('ap.cloud_key', k);
    cloudKey.value = '';
    cloudStatus.textContent = 'ключ сохранён (только на этой машине)';
});

// проверка ключа живым запросом
$('cloud-ping').addEventListener('click', async () => {
    cloudStatus.textContent = 'стучусь в облако…';
    cloudStatus.textContent = await pingCloud();
});

// сброс турникета: все скилы снова спрашивают
$('perms-reset').addEventListener('click', () => {
    localStorage.removeItem('ap.perms');
    cloudStatus.textContent = 'разрешения скилов сброшены — спрошу заново при случае';
});

// выбор голоса/мозга запоминаем; в виджете — системный голос по умолчанию
function defaultVoiceEngine() {
    if (localStorage.getItem('ap.engine')) return localStorage.getItem('ap.engine');
    return window.apWidget ? 'win' : 'piper';
}
voiceSel.value = defaultVoiceEngine();
voiceSel.addEventListener('change', () => {
    localStorage.setItem('ap.engine', voiceSel.value);
    refreshStatus();
});
voiceSel.addEventListener('change', refreshStatus);

// проба голоса: сразу слышно, кто на линии
$('voice-test').addEventListener('click', async () => {
    status.textContent = 'пробую голос…';
    const r = await voice.speak('Раз, два. Проба голоса. Ну хоть кто-нибудь здесь живой?', voiceSel.value);
    status.textContent = r.ok ? 'голос: ' + r.engine : 'голос молчит: ' + (r.why || '?');
});

// мозг тоже запоминаем: без этого каждый старт снова rules — и модель «не работает»
brainSel.value = localStorage.getItem('ap.brain') || 'rules';
cloudProvider.value = localStorage.getItem('ap.cloud_provider') || 'zai';
const savedCloudModel = localStorage.getItem('ap.cloud_model');
if (savedCloudModel) cloudModel.value = savedCloudModel;
const savedCloudUrl = localStorage.getItem('ap.cloud_url');
if (savedCloudUrl) cloudUrl.value = savedCloudUrl;
refreshCloudUI();
brainSel.addEventListener('change', () => {
    localStorage.setItem('ap.brain', brainSel.value);
    refreshCloudUI();
    if (brainSel.value === 'web-llm') {
        warmLocal();   // готовим локальный мозг сразу: прогресс в статусе
    } else {
        refreshStatus();
    }
});

let warmNote = '';   // предупреждение от гварда модели — не теряется под статусом

function warmLocal() {
    const label = llmModelSel.selectedOptions[0]
        ? llmModelSel.selectedOptions[0].textContent : currentModel();
    status.textContent = 'мозг «' + label + '»: готовлюсь…';
    getBrain('web-llm').warmup((s) => {
        // в прогрессе web-llm уже слова + проценты — показываем как есть
        status.textContent = 'мозг: ' + s;
    }).then((t) => {
        status.textContent = t + warmNote;
        if (brainSel.value !== 'web-llm') {
            status.textContent += ' (включи мозг «Локальный» — иначе она молчит)';
        }
    });
}

// заполнить выбор локальной модели: после разведки f16, несовместимое — потушено
const llmModelSel = $('llm-model');
let llmReady = initModels().then(() => {
    const noF16 = f16State() === false;
    for (const m of LOCAL_MODELS) {
        const o = document.createElement('option');
        const dead = m.f16 && noF16;
        o.value = m.id;
        o.textContent = m.label + ' (~' + m.mb + ' МБ)' + (dead ? ' — карта не умеет f16' : '');
        if (dead) o.disabled = true;
        if (m.id === currentModel()) o.selected = true;
        llmModelSel.appendChild(o);
    }
    if (noF16 && !llmModelSel.selectedOptions.length) {
        const first = [...llmModelSel.options].find((o) => !o.disabled);
        if (first) llmModelSel.value = first.value;
    }
    console.log('[brain] model: ' + currentModel() + ', f16: ' + f16State());
});
llmModelSel.addEventListener('change', () => {
    // автоконтроль памяти: не даём выбрать модель, которая поплавит ПК
    const verdict = checkModel(llmModelSel.value);
    if (verdict.ok === 'block') {
        status.textContent = verdict.why;
        llmModelSel.value = currentModel();   // откат выбора
        return;
    }
    setModel(llmModelSel.value);
    warmNote = verdict.warn ? ' — ' + verdict.warn : '';
    // модель всегда готовим сразу — качаем в фоне с процентами в статусе
    warmLocal();
});

// разведка железа для автоконтроля памяти (в виджете — честные цифры)
async function probeHardware() {
    if (window.apWidget && window.apWidget.hw) {
        try {
            const hw = await window.apWidget.hw();
            if (hw.vramMB > 0) localStorage.setItem('ap.vram_mb', hw.vramMB);
            const line = $('hw-line');
            const parts = [];
            if (hw.gpuName) parts.push('GPU: ' + hw.gpuName + (hw.vramMB ? ' (' + (hw.vramMB / 1024).toFixed(1) + ' ГБ)' : ''));
            if (hw.ramTotalMB) parts.push('ОЗУ: ' + (hw.ramTotalMB / 1024).toFixed(1) + ' ГБ, свободно ' + (hw.ramFreeMB / 1024).toFixed(1));
            if (parts.length) {
                line.hidden = false;
                line.textContent = 'железо: ' + parts.join('; ') +
                    (hw.vramMB ? '; бюджет мозга: ' + (hwBudgetMB() / 1024).toFixed(1) + ' ГБ' : '');
            }
            // спасаем пользователя от сохранённой когда-то тяжёлой модели
            const v = checkModel(currentModel());
            if (v.ok === 'block') status.textContent = 'сохранённая модель: ' + v.why;
        } catch (_) { /* браузерный режим — только предупреждения */ }
    } else {
        $('hw-line').hidden = false;
        $('hw-line').textContent = 'видеокарта не разведана — крупные модели только с предупреждением';
    }
}
probeHardware();

// системный голос Windows (только в виджете): список из ОС + выбор
const winVoiceSel = $('win-voice');
if (window.apWidget) {
    window.apWidget.voices().then((res) => {
        if (!res || !res.ok || !res.voices || !res.voices.length) {
            if (res && !res.ok) status.textContent = 'SAPI не поднялся: ' + (res.why || '?');
            return;
        }
        $('win-voices-row').hidden = false;
        const saved = localStorage.getItem('ap.win_voice');
        for (const v of res.voices) {
            const o = document.createElement('option');
            o.value = v.name;
            o.textContent = v.name + ' [' + v.culture + ']';
            winVoiceSel.appendChild(o);
        }
        if (saved && res.voices.some((v) => v.name === saved)) {
            winVoiceSel.value = saved;
        } else {
            const ru = res.voices.find((v) => /^ru/i.test(v.culture));
            if (ru) {
                winVoiceSel.value = ru.name;
                localStorage.setItem('ap.win_voice', ru.name);
            }
        }
        // RHVoice: живые бесплатные голоса — если не стоит, отказываемся нажать ссылку
        if (!res.voices.some((v) => /rhvoice/i.test(v.name))) {
            const rb = $('rhvoice');
            rb.hidden = false;
            rb.onclick = () => {
                // nvda.ru — понятная русская страница с SAPI5-комплектами RHVoice
                // (github-релизы проекта сейчас содержат только исходники и Android/NVDA)
                const url = 'https://nvda.ru/sintezator-rhvoice';
                if (window.apWidget && window.apWidget.openExternal) window.apWidget.openExternal(url);
                else window.open(url, '_blank');
            };
        }
    });
    winVoiceSel.addEventListener('change', () => {
        localStorage.setItem('ap.win_voice', winVoiceSel.value);
        refreshStatus();
    });
}

// список голосов ОС мог ещё не прогрузиться
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = refreshStatus;

/* ---------- старт ---------- */
initWidget(agentSay);           // виджет-режим: трей и ворчание
agent.addEventListener('dblclick', () => {  // ладошка: скажет что-нибудь сам
    const idle = getBrain(brainSel.value);
    idle.respond('', []).then(({ text, emotion }) => agentSay(text, emotion));
});

startIdle();
preloadAll();   // кадры в кэш — петли не мигают при первом переключении
refreshStatus();
