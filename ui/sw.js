// AgentPong — service worker: офлайн-кэш для установки как PWA
const VERSION = 'agentpong-v2';   // v2: анимация-кроссфейд + SiliconFlow/Qwen-intl
const CORE = [
    './',
    './index.html',
    './css/ui.css',
    './js/main.js',
    './js/emotions.js',
    './js/widget.js',
    './manifest.webmanifest',
    '../Asset/agent/icon.png',
    '../Asset/icons/icon-192.png',
    '../Asset/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

    // переходы по страницам: сеть, при офлайне — кэш
    if (req.mode === 'navigate') {
        e.respondWith(
            fetch(req).then((res) => {
                const copy = res.clone();
                caches.open(VERSION).then((c) => c.put(req, copy));
                return res;
            }).catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
        );
        return;
    }

    // ассеты: кэш первым, в фоне обновляем
    e.respondWith(
        caches.open(VERSION).then((c) => c.match(req).then((hit) => {
            const net = fetch(req).then((res) => {
                if (res.ok) c.put(req, res.clone());
                return res;
            }).catch(() => hit);
            return hit || net;
        }))
    );
});
