// AgentPong — мозг #2: ЛОКАЛЬНЫЙ. Модель живёт в кэше браузера/виджета,
// гоняет на WebGPU. Ниже всего: ни ключей, ни VPN, ни облака.
// Разовая загрузка весов (~350-900 МБ), потом полностью оффлайн.

const MODEL_ID = localStorage.getItem('ap.llm_model') || 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';

let enginePromise = null;

function statusTo(onStatus) {
    return (progress) => onStatus && onStatus(progress.text || '');
}

async function getEngine(onStatus) {
    if (!('gpu' in navigator)) {
        throw new Error('WebGPU недоступен в этом окне — локальный мозг не заведётся');
    }
    if (!enginePromise) {
        enginePromise = (async () => {
            const webllm = await import('/node_modules/@mlc-ai/web-llm/lib/index.js');
            onStatus && onStatus('качаю модель (разово, терпение — потом оффлайн)…');
            const engine = await webllm.CreateMLCEngine(MODEL_ID, {
                initProgressCallback: statusTo(onStatus),
            });
            return engine;
        })();
        enginePromise.catch(() => { enginePromise = null; }); // ретрай возможен
    }
    return enginePromise;
}

const ROLE = {
    system: 'system', user: 'user', agent: 'assistant',
};

export const localBrain = {
    name: 'web-llm — локальный (без ключей)',

    async warmup(onStatus) {
        try {
            await getEngine(onStatus);
            return 'Локальный мозг готов: ' + MODEL_ID;
        } catch (e) {
            return 'Локальный мозг не поднялся: ' + (e && e.message ? e.message : e);
        }
    },

    async respond(input, history = [], onStatus) {
        try {
            const engine = await getEngine(onStatus);
            const messages = [
                { role: 'system', content: SYSTEM_PROMPT },
                ...history.slice(-10).map(h => ({
                    role: ROLE[h.who] || 'user',
                    content: h.text,
                })),
                { role: 'user', content: input },
            ];
            const out = await engine.chat.completions.create({ messages, max_tokens: 300, temperature: 0.8 });
            const text = out?.choices?.[0]?.message?.content?.trim();
            if (!text) throw new Error('пустой ответ');
            return { text, emotion: guessEmotion(text) };
        } catch (e) {
            return {
                text: 'Локальный мозг не завёлся: ' + (e && e.message ? e.message : e) + '. Говорит правила-скряга — надёжнее него всё равно никого.',
                emotion: 'doubt',
                speak: true,
            };
        }
    },
};

const SYSTEM_PROMPT = [
    'Ты — Глосс Скряга, виртуальный агент-навигатор проекта AgentPong.',
    'Характер: скупой, саркастичный, ворчишь про бесплатность и экономию байтов,',
    'но по существу вопроса отвечаешь чётко, точно и полезно. Принцип «не навреди» — железно.',
    'Говоришь по-русски, коротко (1-3 предложения), с иронией и фирменной жадностью, но без грубости.',
    'Любимые темы: всё бесплатно, живые узлы P2P, протокол HTTPR, одноразовые сессии, без хранения.',
].join(' ');

function guessEmotion(text) {
    const t = text.toLowerCase();
    if (/(не знаю|нет данных|затрудняюсь|хм)/.test(t)) return 'idk';
    if (/(готов|вот|держи|нашёл|нашел)/.test(t)) return 'eureka';
    if (/(шутк|ха-ха|смешно)/.test(t)) return 'laugh';
    if (/(погоди|сейчас|минутку)/.test(t)) return 'waiting';
    if (/(жаль|увы)/.test(t)) return 'sorry';
    return 'neutral';
}
