// AgentPong — голосовые трамвайные пути.
// piper      — @mintplex-labs/piper-tts-web (ONNX WASM; модель качается разово в OPFS)
// webspeech  — встроенный синтез браузера (0 МБ; в Electron голосов ОС нет)
// off        — тихий

const PIPER_VOICE = localStorage.getItem('ap.voice') || 'ru_RU-dmitri-medium';
const PIPER_URL = '/node_modules/@mintplex-labs/piper-tts-web/dist/piper-tts-web.js';

let modPromise = null;
let session = null; // TtsSession держит воркера тёплым

function loadPiper() {
    if (!modPromise) {
        modPromise = import(PIPER_URL);
        modPromise.catch(() => { modPromise = null; }); // позволить ретрай
    }
    return modPromise;
}

let currentAudio = null;

export const voice = {
    async speak(text, engine) {
        if (engine === 'off' || !text) return { ok: false, why: 'off' };
        this.stop();
        if (engine === 'piper') return piperSpeak(text);
        if (engine === 'webspeech') return webspeechSpeak(text);
        return { ok: false, why: 'unknown engine' };
    },

    stop() {
        if (currentAudio) { currentAudio.pause(); currentAudio = null; }
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    },

    async status(engine, onProgress) {
        if (engine === 'piper') return piperStatus(onProgress);
        if (engine === 'webspeech') return 'Встроенный голос: ' + (ruVoiceName() || 'русских голосов ОС не найдено');
        return 'Голос выключен';
    },
};

async function piperStatus(onProgress) {
    try {
        const { TtsSession, predict, stored } = await loadPiper();
        const have = stored ? await stored() : [];
        if (session) return 'Piper готов, голос ' + PIPER_VOICE;
        // пытаемся приготовить сессию с прогрессом первой загрузки
        if (TtsSession) {
            session = await TtsSession.create({
                voiceId: PIPER_VOICE,
                progress: (p) => onProgress && onProgress(p),
            });
            return 'Piper готов, голос ' + PIPER_VOICE;
        }
        // старый API — просто функция predict
        void predict; // лениво дернётся при speak
        return 'Piper готов (базовый), голос ' + PIPER_VOICE + (have.length ? '' : ' (первый ответ качает модель)');
    } catch (e) {
        session = null;
        return 'Piper недоступен: ' + (e && e.message ? e.message : e);
    }
}

async function piperSpeak(text) {
    try {
        let wav;
        if (session) {
            wav = await session.predict(text);
        } else {
            const mod = await loadPiper();
            const { predict } = mod;
            if (typeof predict !== 'function') {
                throw new Error('экспорты пакета: ' + Object.keys(mod).join(', '));
            }
            wav = await predict({ text, voiceId: PIPER_VOICE });
        }
        currentAudio = new Audio();
        currentAudio.src = URL.createObjectURL(wav);
        await currentAudio.play();
        return { ok: true };
    } catch (e) {
        // Piper смонтировался плохо — падаем на встроенный, но ругаемся в консоль
        console.warn('[voice] piper failed:', e);
        return webspeechSpeak(text);
    }
}

function ruVoiceName() {
    if (!('speechSynthesis' in window)) return null;
    const ru = speechSynthesis.getVoices().filter(v => v.lang && v.lang.toLowerCase().startsWith('ru'));
    return ru.length ? ru[0].name : null;
}

function webspeechSpeak(text) {
    if (!('speechSynthesis' in window)) return { ok: false, why: 'нет speechSynthesis' };
    const ru = speechSynthesis.getVoices().filter(v => v.lang && v.lang.toLowerCase().startsWith('ru'));
    if (!ru.length) return { ok: false, why: 'голосов ОС нет (в Electron так и есть — нужен Piper)' };
    const u = new SpeechSynthesisUtterance(text);
    u.voice = ru[0];
    u.rate = 0.98; u.pitch = 0.92; // пониже — поворчливей
    speechSynthesis.speak(u);
    return { ok: true };
}
