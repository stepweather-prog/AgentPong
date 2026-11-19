// AgentPong — мозг #2: бесплатная LLM через OpenRouter (free tier).
// Ключ лежит в localStorage ТОЛЬКО у пользователя, в репо не попадает.
// Персона Глосса Скряги — в системном промпте.

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// бесплатные модели на OpenRouter free tier (периодически меняются — поле редактируемое)
const FREE_MODEL = localStorage.getItem('ap.model') || 'meta-llama/llama-3.2-3b-instruct:free';

const PERSONA = [
    'Ты — Глосс Скряга, виртуальный агент-навигатор проекта AgentPong.',
    'Характер: скупой, саркастичный, ворчит про бесплатность и экономию байтов,',
    'но по существу вопроса отвечает чётко и полезно (вредить не наносить вреда — принцип «не навреди»).',
    'Говоришь по-русски, коротко (1-3 предложения), с иронией, без длинных нотаций.',
    'Любимые темы: пусть всё бесплатно, живые узлы P2P, протокол HTTPR, безопасная связь.',
].join(' ');

export const llmBrain = {
    name: 'llm-api',

    async respond(input, history = []) {
        const key = localStorage.getItem('ap.openrouter_key');
        if (!key) {
            const k = prompt('Ключ OpenRouter (бесплатный: openrouter.ai → Keys). Останется в твоём браузере, в репо не попадёт:');
            if (!k) return { text: 'Без ключа останусь тупеньким, но гипнотически честным. Правила-скряга на подхвате.', emotion: 'shrug' };
            localStorage.setItem('ap.openrouter_key', k.trim());
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
                    'Authorization': 'Bearer ' + localStorage.getItem('ap.openrouter_key'),
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ model: FREE_MODEL, messages }),
            });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const data = await resp.json();
            const text = data?.choices?.[0]?.message?.content?.trim();
            if (!text) throw new Error('пустой ответ');
            return { text, emotion: guessEmotion(text) };
        } catch (e) {
            return {
                text: 'Облако прижалось... ' + e.message + '. Работаешь, кстати, бесплатно — упёрлись в лимит или ключ не тот. А правила у меня при себе.',
                emotion: 'annoyed',
            };
        }
    },
};

// грубая разметка тона ответа -> эмоция для спрайта
function guessEmotion(text) {
    const t = text.toLowerCase();
    if (/(не знаю|нет данных|хм|затрудняюсь)/.test(t)) return 'idk';
    if (/(готов|вот|держи|наш)/.test(t)) return 'eureka';
    if (/(шутк|ха|смешно)/.test(t)) return 'laugh';
    if (/(погоди|сейчас|минут)/.test(t)) return 'waiting';
    return 'neutral';
}
