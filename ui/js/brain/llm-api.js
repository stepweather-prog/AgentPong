// AgentPong — мозг #3: облако через любой OpenAI-совместимый API.
// По умолчанию — Grok (xAI, https://api.x.ai). Ключ живёт в localStorage, в репо не попадает.
// Бесплатный путь Grok: console.x.ai → Billing → Credits → opt-in на шаринг данных
// (запросы уходят xAI — решай сам, это плата приватностью, не деньгами).

const PROVIDERS = {
    // полевой тест с машины в РФ (2026): 403 = блок Cloudflare, 401 = жив, ждёт ключ
    glm: {
        url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
        model: 'glm-4-flash',          // бесплатный постоянно, не пробник
        hint: 'GLM (Zhipu BigModel) — без VPN',
    },
    qwen: {
        url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        model: 'qwen-plus',            // 1 млн токенов на модель, 90 дней
        hint: 'Qwen (Alibaba, Сингапур) — без VPN',
    },
    deepseek: {
        url: 'https://api.deepseek.com/chat/completions',
        model: 'deepseek-chat',        // API платный, копейки; чат бесплатный
        hint: 'DeepSeek — без VPN, пополнение от $1',
    },
    grok: {
        url: 'https://api.x.ai/v1/chat/completions',
        model: 'grok-3-mini',
        hint: 'Grok (xAI) — из РФ 403, нужен VPN',
    },
    openrouter: {
        url: 'https://openrouter.ai/api/v1/chat/completions',
        model: 'meta-llama/llama-3.2-3b-instruct:free',
        hint: 'OpenRouter — из РФ 403, нужен VPN',
    },
};

const PERSONA = [
    'Ты — Глосс Скряга, виртуальный агент-навигатор проекта AgentPong.',
    'Характер: скупой, саркастичный, ворчишь про бесплатность и экономию байтов,',
    'но по существу вопроса отвечаешь чётко, точно и полезно. Принцип «не навреди» — железно.',
    'Говоришь по-русски, коротко (1-3 предложения), с иронией и фирменной жадностью,',
    'но без грубости и без длинных нотаций.',
    'Любимые темы: всё бесплатно, живые узлы P2P, протокол HTTPR, одноразовые сессии, без хранения.',
].join(' ');

function cfg() {
    let provider = 'grok';
    if (typeof localStorage !== 'undefined') provider = localStorage.getItem('ap.cloud_provider') || 'glm';
    const known = PROVIDERS[provider];
    let url = known ? known.url : (localStorage.getItem('ap.cloud_url') || '');
    let model = known ? known.model : 'gpt-3.5-turbo';
    const modelOverride = typeof localStorage !== 'undefined' ? localStorage.getItem('ap.cloud_model') : null;
    if (modelOverride) model = modelOverride;
    // свой URL: с хвостом /chat/completions удобнее, чем гадать
    if (url && !/\/chat\/completions$/.test(url)) url = url.replace(/\/+$/, '') + '/chat/completions';
    return { url, model, provider };
}

export function cloudStatusText() {
    const { provider, model } = cfg();
    const p = PROVIDERS[provider];
    return (p ? p.hint : 'свой URL') + ' / ' + model;
}

export const llmBrain = {
    name: 'llm-api — облако (OpenAI-совместимое)',

    async respond(input, history = []) {
        const key = typeof localStorage !== 'undefined'
            ? (localStorage.getItem('ap.cloud_key') || localStorage.getItem('ap.openrouter_key'))
            : null;
        if (!key) {
            return {
                text: 'Мозг-облако без ключа — как сейф без стенки. Впиши ключ в настройках (⚙). У Грока халява через opt-in в console.x.ai, но он берёт платы данными. А пока правила-скряга.',
                emotion: 'shrug',
            };
        }
        const { url, model } = cfg();
        try {
            const messages = [
                { role: 'system', content: PERSONA },
                ...history.slice(-8).map(h => ({
                    role: h.who === 'user' ? 'user' : 'assistant',
                    content: String(h.text || '').slice(0, 600),
                })),
                { role: 'user', content: String(input).slice(0, 1200) },
            ];
            const resp = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + key,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model,
                    messages,
                    max_tokens: 300,
                    temperature: 0.6,
                }),
            });
            if (resp.status === 401 || resp.status === 403) {
                if (typeof localStorage !== 'undefined') localStorage.removeItem('ap.cloud_key');
                return { text: 'Ключ отвергнут — стёр его. Возьми свежий в настройках.', emotion: 'stern' };
            }
            if (resp.status === 429) {
                return { text: 'Бесплатная норма на сегодня выбита. Приходи завтра — халява не любит спешки.', emotion: 'waiting' };
            }
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const data = await resp.json();
            let raw = data?.choices?.[0]?.message?.content?.trim() || '';
            const text = raw.replace(/&lt;think&gt;[\s\S]*?&lt;\/think&gt;/gi, '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
            if (!text) throw new Error('пустой ответ');
            const norm = (s) => String(s).replace(/[\s.!?,,]+/g, '').toLowerCase();
            if (norm(text) === norm(input)) {
                return { text: 'Эхо из облака — оно там тоже бесплатное. Переформулируй.', emotion: 'doubt' };
            }
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

// тест ключа из настроек: короткий пинг
export async function pingCloud() {
    const key = localStorage.getItem('ap.cloud_key');
    if (!key) return 'ключ не введён';
    const { url, model } = cfg();
    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages: [{ role: 'user', content: '1+1=?' }], max_tokens: 30 }),
        });
        if (resp.status === 401 || resp.status === 403) return 'ключ отвергнут (' + resp.status + ')';
        if (resp.status === 429) return 'ключ жив, лимит исчерпан (429)';
        if (!resp.ok) return 'сервер ответил ' + resp.status;
        const data = await resp.json();
        const t = data?.choices?.[0]?.message?.content?.trim();
        return t ? 'живой: ' + t.slice(0, 60) : 'живой, но ответ пустой';
    } catch (e) {
        return 'не достучался: ' + (e && e.message ? e.message : e) + ' (для РФ — VPN)';
    }
}
