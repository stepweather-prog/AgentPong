// AgentPong — мозг #2: ЛОКАЛЬНЫЙ под слабое железо.
// Модель живёт в кэше браузера/виджета, гоняет на WebGPU.
// Ни ключей, ни VPN, ни облака. Разовая закачка весов — потом оффлайн.

// от крохотной к умной (под слабое железо; оценка VRAM: веса + кэш контекста).
// ВАЖНО: web-llm держит модель ЦЕЛИКОМ в видеопамяти, на CPU не выгружает.
// Ещё важнее: q4f16/q0f16 требуют WebGPU-расширение shader-f16 — на RX 560 его нет
// (полевой диагноз: «This model requires WebGPU extension shader-f16»).
// Поэтому основа списка — f32-варианты: они тянутся любой картой.
export const LOCAL_MODELS = [
    { id: 'SmolLM2-135M-Instruct-q0f32-MLC',   label: 'SmolLM 135M — кроха',        vramMB: 700,  mb: 550,  f16: false },
    { id: 'SmolLM2-360M-Instruct-q0f32-MLC',   label: 'SmolLM 360M — шустрик',      vramMB: 1700, mb: 1400, f16: false },
    { id: 'Qwen3-1.7B-q4f32_1-MLC',            label: 'Qwen3 1.7B — рабочий',       vramMB: 2400, mb: 1200, f16: false },
    { id: 'Qwen3-0.6B-q0f32-MLC',              label: 'Qwen3 0.6B — умный малыш',   vramMB: 2700, mb: 2300, f16: false },
    { id: 'gemma-2-2b-it-q4f32_1-MLC',         label: 'Gemma 2 2B — болтун',        vramMB: 2900, mb: 1700, f16: false },
    { id: 'Llama-3.2-3B-Instruct-q4f32_1-MLC', label: 'Llama 3.2 3B — толковый',    vramMB: 3400, mb: 2500, f16: false },
    // f16-варианты — мельче и точнее, но только с шейдером f16:
    { id: 'Qwen3-0.6B-q4f16_1-MLC',            label: 'Qwen3 0.6B [f16]',           vramMB: 950,  mb: 500,  f16: true },
    { id: 'Qwen3-1.7B-q4f16_1-MLC',            label: 'Qwen3 1.7B [f16]',           vramMB: 2000, mb: 1100, f16: true },
    { id: 'SmolLM2-135M-Instruct-q0f16-MLC',   label: 'SmolLM 135M [f16]',          vramMB: 380,  mb: 150,  f16: true },
    { id: 'SmolLM2-360M-Instruct-q4f16_1-MLC', label: 'SmolLM 360M [f16]',          vramMB: 550,  mb: 300,  f16: true },
];

// предпочтительный порядок авто-перехода, если сохранённая модель не годится
const PREFERRED = [
    'Qwen3-1.7B-q4f32_1-MLC',
    'Qwen3-0.6B-q0f32-MLC',
    'SmolLM2-360M-Instruct-q0f32-MLC',
    'SmolLM2-135M-Instruct-q0f32-MLC',
];

let modelId = (typeof localStorage !== 'undefined' && localStorage.getItem('ap.llm_model'))
    || PREFERRED[0];

export function currentModel() { return modelId; }

/* ---------- умеет ли карта/браузер f16 ---------- */
let f16Ok = null;   // false = нет; null = ещё не проверяли

export async function detectF16() {
    if (f16Ok !== null) return f16Ok;
    try {
        if (!('gpu' in navigator)) { f16Ok = false; return false; }
        const adapter = await navigator.gpu.requestAdapter();
        f16Ok = !!(adapter && adapter.features && adapter.features.has('shader-f16'));
    } catch (_) {
        f16Ok = false;
    }
    return f16Ok;
}

export function f16State() { return f16Ok; }

export function setModel(id) {
    if (!LOCAL_MODELS.some(m => m.id === id)) return false;
    if (id === modelId) return true;
    modelId = id;
    if (typeof localStorage !== 'undefined') localStorage.setItem('ap.llm_model', id);
    enginePromise = null;   // следующая сессия поднимет выбранную
    return true;
}

// при старте: уместить сохранённый выбор под реальное железо
export async function initModels() {
    await detectF16();
    const saved = LOCAL_MODELS.find(m => m.id === modelId);
    const ok = saved && (!saved.f16 || f16Ok);
    if (!ok) {
        const compat = PREFERRED.filter(id => {
            const m = LOCAL_MODELS.find(x => x.id === id);
            return m && (!m.f16 || f16Ok);
        });
        modelId = compat[0] || LOCAL_MODELS[0].id;
        if (typeof localStorage !== 'undefined') localStorage.setItem('ap.llm_model', modelId);
        enginePromise = null;
    }
    return modelId;
}

/* ---------- автоконтроль памяти: чтобы ПК не поплыл ---------- */
// Бюджет берём из разведки железа (IPC-хук в виджете пишет ap.vram_mb).
// Нет данных (обычный браузер) — не блокируем, но предупреждаем на крупняке.
export function hwBudgetMB() {
    if (typeof localStorage === 'undefined') return null;
    const v = Number(localStorage.getItem('ap.vram_mb') || 0);
    return v > 0 ? Math.round(v * 0.92) : null;   // 8% видеопамяти — на систему/десктоп
}

// ok:['ok'|'block'], warn — предупреждающий текст, why — причина отказа
export function checkModel(id) {
    const m = LOCAL_MODELS.find(x => x.id === id);
    if (!m) return { ok: 'block', why: 'неизвестная модель' };
    if (m.f16 && f16Ok === false) {
        return {
            ok: 'block',
            why: 'этой модели нужен WebGPU-шейдер f16 — наша карта/браузер его не умеет. ' +
                 'Бери модель без пометки [f16]',
        };
    }
    const budget = hwBudgetMB();
    if (budget && m.vramMB > budget) {
        return {
            ok: 'block',
            why: 'модели нужно ~' + Math.round(m.vramMB / 1024 * 10) / 10 +
                 ' ГБ видеопамяти, а у нас ' + Math.round(budget / 1024 * 10) / 10 +
                 ' ГБ — не влезет, ПК поплывёт. Выбери модель поменьше.',
        };
    }
    if (budget && m.vramMB > budget * 0.80) {
        return { ok: 'warn', warn: 'впритык к видеопамяти (' +
                 Math.round(m.vramMB / 1024 * 10) / 10 + '/' + Math.round(budget / 1024 * 10) / 10 +
                 ' ГБ) — если тормозит или падает, сменяй на модель ниже' };
    }
    if (!budget && m.vramMB >= 2700) {
        return { ok: 'warn', warn: 'модель крупная (~' + Math.round(m.vramMB / 1024 * 10) / 10 +
                 ' ГБ) — на слабой видеокарте может не завестись' };
    }
    return { ok: 'ok' };
}

let enginePromise = null;

function statusTo(onStatus) {
    return (report) => {
        if (!onStatus) return;
        let s = (report && report.text ? report.text : '').trim();
        if (report && typeof report.progress === 'number') {
            s += ' — ' + Math.round(report.progress * 100) + '%';
        }
        onStatus(s);
    };
}

async function getEngine(onStatus) {
    if (!('gpu' in navigator)) {
        throw new Error('WebGPU недоступен в этом окне — локальный мозг не заведётся');
    }
    if (!enginePromise) {
        enginePromise = (async () => {
            const webllm = await import('/node_modules/@mlc-ai/web-llm/lib/index.js');
            onStatus && onStatus('качаю модель (разово, терпение)…');
            const engine = await webllm.CreateMLCEngine(modelId, {
                initProgressCallback: statusTo(onStatus),
            });
            return engine;
        })();
        enginePromise.catch(() => { enginePromise = null; }); // ретрай возможен
    }
    return enginePromise;
}

const ROLE = { system: 'system', user: 'user', agent: 'assistant' };

export const localBrain = {
    name: 'web-llm — локальный (без ключей)',

    async warmup(onStatus) {
        try {
            await getEngine(onStatus);
            return 'Локальный мозг готов: ' + modelId;
        } catch (e) {
            return 'Локальный мозг не поднялся: ' + (e && e.message ? e.message : e);
        }
    },

    async respond(input, history = [], onStatus) {
        try {
            const engine = await getEngine(onStatus);
            // контроль контекста: хвост истории, каждую реплику подстричь —
            // иначе у крохотной модели и у ОЗУ с нашими DDR3 плохое настроение
            const trimmed = history.slice(-8).map(h => ({
                role: ROLE[h.who] || 'user',
                content: String(h.text || '').slice(0, 600),
            }));
            const messages = [
                { role: 'system', content: SYSTEM_PROMPT },
                ...trimmed,
                { role: 'user', content: String(input).slice(0, 1200) },
            ];
            const out = await engine.chat.completions.create({
                messages,
                max_tokens: 400,
                temperature: 0.6,
                // Qwen3 думает вслух: без этого выжигает все токены на рассуждения
                // и до ответа («7 дней в неделе») дело не доходит
                extra_body: { enable_thinking: false },
            });
            // Qwen3 любит думать вслух тегом <think> — вырезаем рассуждения
            let raw = out?.choices?.[0]?.message?.content?.trim() || '';
            const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
            if (!text) throw new Error('пустой ответ');
            // страховка от эха: модель повторила ваш же текст — не позоримся, отыгрываем
            const norm = (s) => String(s).replace(/[\s.!?,,]+/g, '').toLowerCase();
            if (norm(text) === norm(input) || norm(text) === norm(history[history.length - 1]?.text || '')) {
                return {
                    text: 'Эхо-камера, между прочим. Твои слова возвращаются без озвучки... бесплатно. Переформулируй — попробую ещё раз.',
                    emotion: 'doubt',
                };
            }
            return { text, emotion: guessEmotion(text) };
        } catch (e) {
            return {
                text: 'Локальный мозг не завёлся: ' + (e && e.message ? e.message : e) + '. Говорю по правилам — надёжнее них всё равно никого.',
                emotion: 'doubt',
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
    'Простые факты (числа, даты, счёт) отвечаешь сразу и точно, без рассуждений в ответе.',
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
