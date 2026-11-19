// AgentPong — мозг #2: бесплатная LLM через OpenRouter (free tier).
// Ключ вводится в настройках (⚙), живёт в localStorage, в репо не попадает.
// Бесплатный ключ: openrouter.ai → регистрация → Keys → Create Key.

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const FREE_MODEL = (typeof localStorage !== 'undefined' && localStorage.getItem('ap.model')) || 'meta-llama/llama-3.2-3b-instruct:free';

const PERSONA = [
    'Ты — Глосс Скряга, виртуальный агент-навигатор проекта AgentPong.',
    'Характер: скупой, саркастичный, ворчишь про бесплатность и экономию байтов,',
    'но по существу вопроса отвечаешь чётко, точно и полезно. Принцип «не навреди» — железно.',
    'Говоришь по-русски, коротко (1-3 предложения), с иронией и фирменной жадностью,',
    'но без грубости и без длинных нотаций.',
    'Любимые темы: всё бесплатно, живые узлы P2P, протокол HTTPR, одноразовые сессии, без хранения.',
].join(' ');

export const llmBrain = {
    name: 'llm-api',

    async respond(input, history = []) {
        const key = localStorage.getItem('ap.openrouter_key');
        if (!key) {
            return {
                text: 'Мозг-облако без ключа — как сейф без стенки. Впиши OpenRouter ключ в настройках (⚙), регистрация бесплатная. А пока правила-скряга.',
                emotion: 'shrug',
            };
        }
        try {
            const messages = [
                { role: 'system', content: PERSONA },
                ...history.slice(-8).map(h => ({
                    role: h.who === 'user' ? 'user' : 'assistant',
                    content: h.text,
                })),
                { role: 'user', content: input },
            ];
            const resp = await fetch(OPENROUTER_URL, {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + key,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ model: FREE_MODEL, messages }),
            });
            if (resp.status === 401) {
                localStorage.removeItem('ap.openrouter_key');
                return { text: 'Ключ Open Router отвергнут — стёр его. Возьми свежий в настройках.', emotion: 'stern' };
            }
            if (resp.status === 429) {
                return { text: 'Дневная халява израсходована. Приходи завтра — бесплатность не любит спешки.', emotion: 'waiting' };
            }
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const data = await resp.json();
            const text = data?.choices?.[0]?.message?.content?.trim();
            if (!text) throw new Error('пустой ответ');
            return { text, emotion: guessEmotion(text) };
        } catch (e) {
            return {
                text: 'Облако не отозвалось: ' + (e && e.message ? e.message : e) + '. Правила-скряга всегда при мне — надёжнее облака моё нутро.',
                emotion: 'doubt',
            };
        }
    },
};

function guessEmotion(text) {
    const t = text.toLowerCase();
    if (/(не знаю|нет данных|хм|затрудняюсь)/.test(t)) return 'idk';
    if (/(готов|вот|держи|наш)/.test(t)) return 'eureka';
    if (/(шутк|ха|смешно)/.test(t)) return 'laugh';
    if (/(погоди|сейчас|минут)/.test(t)) return 'waiting';
    return 'neutral';
}
