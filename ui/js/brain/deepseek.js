// AgentPong — мозг #2: DeepSeek API (OpenAI-совместимый).
// Ключ — в localStorage браузера, в репо не попадает.
// deepseek-keys не «сгорают» по времени: платформа списывает за фактические токены.

const API_URL = 'https://api.deepseek.com/chat/completions';
const MODEL = (typeof localStorage !== 'undefined' && localStorage.getItem('ap.deepseek_model')) || 'deepseek-chat';

const PERSONA = [
    'Ты — Глосс Скряга, виртуальный агент-навигатор проекта AgentPong.',
    'Характер: скупой, саркастичный, ворчишь про бесплатность и экономию байтов,',
    'но по существу вопроса отвечаешь чётко, точно и полезно. Принцип «не навреди» — железно.',
    'Говоришь по-русски, коротко (1-3 предложения), с иронией и фирменной жадностью,',
    'но без грубости и без длинных нотаций.',
    'Любимые темы: всё бесплатно, живые узлы P2P, протокол HTTPR, одноразовые сессии, без хранения.',
].join(' ');

export const deepseekBrain = {
    name: 'deepseek',

    async respond(input, history = []) {
        try {
            const key = await ensureKey();
            if (!key) {
                return { text: 'Ключ не дал — значит, работаю на халяву. Скряга одобряет.', emotion: 'shrug' };
            }
            const messages = [
                { role: 'system', content: PERSONA },
                ...history.slice(-10).map(h => ({
                    role: h.who === 'user' ? 'user' : 'assistant',
                    content: h.text,
                })),
                { role: 'user', content: input },
            ];
            const resp = await fetch(API_URL, {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + key,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ model: MODEL, messages, max_tokens: 500 }),
            });
            if (resp.status === 401 || resp.status === 403) {
                localStorage.removeItem('ap.deepseek_key');
                return { text: 'Ключ DeepSeek не жилец — сервер выгнал его (401). Впиши свеженький, я подожду. А пока — правила при мне.', emotion: 'stern' };
            }
            if (resp.status === 402) {
                return { text: 'Баланс DeepSeek иссяк. Не афишируй, но я такое понимаю.', emotion: 'sorry' };
            }
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const data = await resp.json();
            const text = data?.choices?.[0]?.message?.content?.trim();
            if (!text) throw new Error('пустой ответ');
            return { text, emotion: guessEmotion(text) };
        } catch (e) {
            return {
                text: 'DeepSeek не отвечает: ' + (e && e.message ? e.message : e) + '. Без сети мозг мне не завезли — но правила-скряга всегда со мной.',
                emotion: 'doubt',
            };
        }
    },
};

async function ensureKey() {
    let key = localStorage.getItem('ap.deepseek_key');
    if (!key) {
        const k = prompt('Ключ DeepSeek (platform.deepseek.com → API keys). Останется только в этом браузере, в репо не попадёт. Пусто = отмена:');
        if (!k) return null;
        key = k.trim();
        localStorage.setItem('ap.deepseek_key', key);
    }
    return key;
}

function guessEmotion(text) {
    const t = text.toLowerCase();
    if (/(не знаю|нет данных|затрудняюсь|хм)/.test(t)) return 'idk';
    if (/(готов|вот|держи|нашёл|нашел)/.test(t)) return 'eureka';
    if (/(шутк|ха-ха|смешно|смех)/.test(t)) return 'laugh';
    if (/(погоди|сейчас|минутку|щас)/.test(t)) return 'waiting';
    if (/(жаль|сочувствую|увы)/.test(t)) return 'sorry';
    if (/(проверю|секунду|дай посмотреть)/.test(t)) return 'check';
    return 'neutral';
}
