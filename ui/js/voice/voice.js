// AgentPong — голосовые трамвайные пути.
// piper      — @mintplex-labs/piper-tts-web (ONNX WASM, модель качается разово, кэш браузера)
// webspeech  — встроенный синтез браузера (0 МБ, голоса ОС)
// off        — тихий

let piper = null;          // лениво созданный PiperTTS
let piperLoading = null;

const PIPER_VOICE = localStorage.getItem('ap.voice') || 'ru_RU-dmitri-medium';

async function loadPiper() {
    if (piper) return piper;
    if (!piperLoading) {
        piperLoading = (async () => {
            const mod = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/@mintplex-labs/piper-tts-web@1.0.5/+esm');
            const Ctor = mod.PiperTTS || mod.TTS || mod.default?.PiperTTS || mod.default?.TTS;
            if (!Ctor) throw new Error('в пакете не найден класс TTS: ' + Object.keys(mod).join(', '));
            piper = new Ctor();
            return piper;
        })();
        piperLoading.catch(() => { piperLoading = null; }); // позволить ретрай
    }
    return piperLoading;
}

let currentAudio = null;

export const voice = {
    async speak(text, engine) {
        if (engine === 'off' || !text) return { ok: false, why: 'off' };
        this.stop();
        if (engine === 'webspeech') return webspeechSpeak(text);
        if (engine === 'piper') return piperSpeak(text);
        return { ok: false, why: 'unknown engine' };
    },

    stop() {
        if (currentAudio) { currentAudio.pause(); currentAudio = null; }
        if ('visualViewport' in window && window.speechSynthesis) window.speechSynthesis.cancel();
    },

    // статусы для строки внизу UI
    async status(engine) {
        if (engine === 'piper') {
            try { await loadPiper(); return 'Piper готов, голос ' + PIPER_VOICE; }
            catch (e) { return 'Piper недоступен: ' + e.message; }
        }
        if (engine === 'webspeech') {
            return 'Встроенный голос: ' + (ruVoiceName() || 'русских голосов ОС не найдено');
        }
        return 'Голос выключен';
    },
};

async function piperSpeak(text) {
    try {
        const tts = await loadPiper();
        const wav = await tts.predict({ text, voiceId: PIPER_VOICE });
        currentAudio = new Audio();
        currentAudio.src = URL.createObjectURL(wav);
        await currentAudio.play();
        return { ok: true };
    } catch (e) {
        // пайпер не смонтировался (нет сети/WASM) — падаем на встроенный, не молчим
        const fb = webspeechSpeak(text);
        return { ok: fb.ok, fellBack: true, why: e.message };
    }
}

function ruVoiceName() {
    if (!('speechSynthesis' in window)) return null;
    const ru = speechSynthesis.getVoices().filter(v => v.lang && v.lang.toLowerCase().startsWith('ru'));
    return ru.length ? ru[0].name : null;
}

function webspeechSpeak(text) {
    if (!('speechSynthesis' in window)) return { ok: false, why: 'нет speechSynthesis' };
    const u = new SpeechSynthesisUtterance(text);
    const ru = speechSynthesis.getVoices().filter(v => v.lang && v.lang.toLowerCase().startsWith('ru'));
    if (ru.length) u.voice = ru[0];
    u.rate = 0.98; u.pitch = 0.92; // пониже — поворчливей
    speechSynthesis.speak(u);
    return { ok: true };
}
