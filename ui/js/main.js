// AgentPong — Глосс Скряга: сцена
import { srcOf, EMOTIONS, IDLE } from './emotions.js';
import { getBrain, brainList } from './brain/brain.js';
import { LOCAL_MODELS, setModel, currentModel, checkModel, hwBudgetMB } from './brain/local-llm.js';
import { voice } from './voice/voice.js';
import { initWidget } from './widget.js';

const $ = (id) => document.getElementById(id);
const agent = $('agent'), agentText = $('agent-text'), log = $('log');
const say = $('say'), send = $('send'), mic = $('mic');
const voiceSel = $('voice-engine'), brainSel = $('brain-engine'), status = $('engine-status');

const history = []; // {who:'user'|'agent', text} — только в памяти, как и положено сеансу

/* ---------- idle-дыхание (переливы поз) ---------- */
let idleIdx = 0, idleTimer = null, emotionUntil = 0;

function startIdle() {
    idleTimer = setInterval(() => {
        if (performance.now() < emotionUntil) return; // эмоция ещё играет
        idleIdx = (idleIdx + 1) % IDLE.length;
        if (agent.dataset.emotion) {   // эмоция кончилась — тихо вернуть idle
            agent.dataset.emotion = '';
            agent.classList.remove('excited');
        }
        agent.src = IDLE[idleIdx];
    }, 3600);
}

function playEmotion(key, holdMs = 2600) {
    const src = srcOf(key);
    if (!src) return;
    agent.src = src;
    agent.dataset.emotion = key;
    agent.classList.toggle('excited', ['laugh', 'mocking', 'gotcha', 'eureka', 'accuse'].includes(key));
    emotionUntil = performance.now() + holdMs;
}

/* ---------- реплики ---------- */
function logLine(who, text) {
    const div = document.createElement('div');
    div.className = who === 'user' ? 'u' : 'a';
    div.innerHTML = `<span class="who">${who === 'user' ? 'Ты' : 'Скряга'}:</span> `;
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
    const brain = getBrain(brainSel.value);
    const { text, emotion } = await brain.respond(clean, history);
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

// ключ OpenRouter — вводится в настройках, хранится только локально
$('or-save').addEventListener('click', () => {
    const k = $('or-key').value.trim();
    if (!k) { status.textContent = 'поле пустое — ключ не сохранён'; return; }
    localStorage.setItem('ap.openrouter_key', k);
    $('or-key').value = '';
    status.textContent = 'ключ OpenRouter сохранён (только в этом браузере)';
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
brainSel.addEventListener('change', () => {
    if (brainSel.value === 'web-llm') {
        // готовим локальный мозг сразу: прогресс в статусе
        warmLocal();
    } else {
        refreshStatus();
    }
});

function warmLocal() {
    status.textContent = 'готовит локальный мозг…';
    getBrain('web-llm').warmup((s) => { status.textContent = 'мозг: ' + s; })
        .then((t) => { status.textContent = t; });
}

// заполнить выбор локальной модели и держать в актуальном состоянии
const llmModelSel = $('llm-model');
for (const m of LOCAL_MODELS) {
    const o = document.createElement('option');
    o.value = m.id; o.textContent = m.label + ' (~' + m.mb + ' МБ закачка)';
    if (m.id === currentModel()) o.selected = true;
    llmModelSel.appendChild(o);
}
llmModelSel.addEventListener('change', () => {
    // автоконтроль памяти: не даём выбрать модель, которая поплавит ПК
    const verdict = checkModel(llmModelSel.value);
    if (verdict.ok === 'block') {
        status.textContent = verdict.why;
        llmModelSel.value = currentModel();   // откат выбора
        return;
    }
    setModel(llmModelSel.value);
    status.textContent = 'модель сменена: ' + llmModelSel.selectedOptions[0].textContent
        + (verdict.warn ? ' — ' + verdict.warn : '');
    if (brainSel.value === 'web-llm') warmLocal(); // поднять выбранную
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
initWidget(agentSay);           // виджет-режим: трей, перетаскивание, ворчание
agent.addEventListener('mousedown', () => {
    if (window.apWidget) window.apWidget.dragStart();
});
agent.addEventListener('dblclick', () => {  // ладошка: скажет что-нибудь сам
    const idle = getBrain(brainSel.value);
    idle.respond('', []).then(({ text, emotion }) => agentSay(text, emotion));
});

startIdle();
refreshStatus();
