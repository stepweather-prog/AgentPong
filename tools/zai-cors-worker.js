// AgentPong — CORS-шлюз к api.z.ai для PWA на GitHub Pages (Cloudflare Workers)
// Развертывание: workers.cloudflare.com → Create Worker → вставить этот файл → Deploy
// Подробности — README.md, раздел «Мозг-облако в PWA».

const ALLOWED = [
    'https://stepweather-prog.github.io',           // PWA с Pages
    'http://localhost:4200', 'http://localhost:8087', // локальная разработка
    'http://localhost:8091', 'http://127.0.0.1:8091', // Electron-виджет
];

const CORS = {
    'Access-Control-Allow-Origin': '',              // подставится ниже
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Max-Age': '86400',
};

const TARGET = 'https://api.z.ai/api/paas/v4/chat/completions';

export default {
    async fetch(request) {
        const origin = request.headers.get('origin') || '';

        // preflight браузера — просто сказать «можно»
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Allow-Origin': origin } });
        }

        // чужих не пускаем: шлюз для своих страниц, ключ всё равно у клиента
        if (!ALLOWED.includes(origin)) {
            return json({ error: 'origin не в белом списке' }, 403, origin);
        }

        // переписка 1:1 в z.ai; ключ летит сквозь нас и нигде не хранится
        const resp = await fetch(TARGET, {
            method: 'POST',
            headers: {
                'Authorization': request.headers.get('authorization') || '',
                'Content-Type': 'application/json',
            },
            body: await request.text(),
        });

        return new Response(resp.body, {
            status: resp.status,
            headers: {
                'Content-Type': resp.headers.get('content-type') || 'application/json',
                ...CORS,
                'Access-Control-Allow-Origin': origin,
            },
        });
    },
};

function json(obj, status, origin) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: { 'Content-Type': 'application/json', ...CORS, 'Access-Control-Allow-Origin': origin },
    });
}
