// AgentPong — голосовые трамвайные пути, по убыванию надёжности:
// piper     — @mintplex-labs/piper-tts-web (Dmitri, ~63 МБ разово в OPFS)
// win       — системный TTS Windows через main-процесс Electron (0 МБ, оффлайн)
// webspeech — speechSynthesis браузера (0 МБ; в Electron голосов нет)
// off       — тихий

const PIPER_VOICE = localStorage.getItem('ap.voice') || 'ru_RU-dmitri-medium';
const PIPER_URL = '/node_modules/@mintplex-labs/piper-tts-web/dist/piper-tts-web.js';

let modPromise = null;
let session = null;

function loadPiper() {
    if (!modPromise) {
        modPromise = import(PIPER_URL);
        modPromise.catch(() => { modPromise = null; });
    }
    return modPromise;
}

let currentAudio = null;

const CHAIN = {           // кому передать эстафету при неудаче
    piper:     () => (window.apWidget ? 'win' : 'webspeech'),
    win:       () => 'webspeech',
    webspeech: () => null,
};

export const voice = {
    async speak(text, engine) {
        if (engine === 'off' || !text) return { ok: false, why: 'off' };
        this.stop();
        let eng = engine;
        let lastWhy = '';
        while (eng) {
            const r = await speakOne(text, eng);
            if (r.ok) return { ok: true, engine: eng };
            lastWhy = (eng + ': ' + (r.why || ''));
            console.warn('[voice]', lastWhy);
            eng = CHAIN[eng] ? CHAIN[eng]() : null;
        }
        return { ok: false, why: lastWhy };
    },

    stop() {
        if (currentAudio) { currentAudio.pause(); currentAudio = null; }
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    },

    async status(engine, onProgress) {
        if (engine === 'piper') return piperStatus(onProgress);
        if (engine === 'win') return winStatus();
        if (engine === 'webspeech') return 'Браузерный голос: ' + (ruVoiceName() || 'русских голосов ОС не найдено');
        return 'Голос выключен';
    },
};

async function winStatus() {
    if (!window.apWidget) return 'Системный голос — только в виджете';
    let res;
    try { res = await window.apWidget.voices(); } catch (e) { return 'Системный TTS недоступен: ' + e; }
    if (!res || !res.ok) return 'Системный TTS не поднялся: ' + (res && res.why ? res.why : '?');
    if (!res.voices.length) {
        return 'В Windows выключены голоса: Параметры → Время и язык → Речь → Добавить голоса';
    }
    const ru = res.voices.filter((v) => /^ru/i.test(v.culture));
    if (!ru.length) {
        return 'Голосов: ' + res.voices.length + ', но русских нет (только ' +
            res.voices.map(v => v.name).join(', ') +
            '). Поставь русский: Параметры → Время и язык → Речь → Добавить голоса → русский';
    }
    return 'Голосов: ' + res.voices.length + ', русский: ' + ru.map(v => v.name).join(', ');
}

async function speakOne(text, eng) {
    try {
        if (eng === 'piper') return await piperSpeak(text);
        if (eng === 'win') {
            if (!window.apWidget || !window.apWidget.tts) return { ok: false, why: 'не виджет' };
            const voiceName = localStorage.getItem('ap.win_voice') || null;
            const ok = await window.apWidget.tts(text, voiceName);
            return ok ? { ok: true } : { ok: false, why: 'powershell вернул ошибку' };
        }
        if (eng === 'webspeech') return webspeechSpeak(text);
        return { ok: false, why: 'неизвестный движок' };
    } catch (e) {
        return { ok: false, why: e && e.message ? e.message : String(e) };
    }
}

async function piperStatus(onProgress) {
    try {
        const mod = await loadPiper();
        if (mod.TtsSession) {
            if (session) return 'Piper готов, голос ' + PIPER_VOICE;
            session = await mod.TtsSession.create({
                voiceId: PIPER_VOICE,
                progress: (p) => onProgress && onProgress(p),
            });
            return 'Piper готов, голос ' + PIPER_VOICE;
        }
        return 'Piper готов (базовый режим), голос ' + PIPER_VOICE;
    } catch (e) {
        session = null;
        return 'Piper недоступен: ' + (e && e.message ? e.message : e);
    }
}

async function piperSpeak(text) {
    let wav;
    if (session) {
        wav = await session.predict(text);
    } else {
        const mod = await loadPiper();
        if (typeof mod.predict !== 'function') {
            throw new Error('экспорты пакета: ' + Object.keys(mod).join(', '));
        }
        wav = await mod.predict({ text, voiceId: PIPER_VOICE });
    }
    currentAudio = new Audio();
    currentAudio.src = URL.createObjectURL(wav);
    await currentAudio.play();
    return { ok: true };
}

function ruVoiceName() {
    if (!('speechSynthesis' in window)) return null;
    const ru = speechSynthesis.getVoices().filter(v => v.lang && v.lang.toLowerCase().startsWith('ru'));
    return ru.length ? ru[0].name : null;
}

function webspeechSpeak(text) {
    if (!('speechSynthesis' in window)) return { ok: false, why: 'нет speechSynthesis' };
    const ru = speechSynthesis.getVoices().filter(v => v.lang && v.lang.toLowerCase().startsWith('ru'));
    if (!ru.length) return { ok: false, why: 'голосов ОС нет (в Electron так и есть)' };
    const u = new SpeechSynthesisUtterance(text);
    u.voice = ru[0];
    u.rate = 0.98; u.pitch = 0.92;
    speechSynthesis.speak(u);
    return { ok: true };
}
