/* Moneta — Service Worker: полностью офлайн-приложение.
   Чтобы выпустить обновление, увеличьте номер в VERSION: старый кэш будет удалён автоматически. */
const VERSION = "moneta-v39";

const ASSETS = [
  "./",
  "index.html",
  "styles.css",
  "bg.jpg",
  "bg.blue.jpg",
  "app.js",
  "manifest.json",
  "vendor/react.production.min.js",
  "vendor/react-dom.production.min.js",
  "vendor/htm.umd.js",
  "fonts/roboto-cyrillic-400-normal.woff2",
  "fonts/roboto-cyrillic-500-normal.woff2",
  "fonts/roboto-cyrillic-700-normal.woff2",
  "fonts/roboto-latin-400-normal.woff2",
  "fonts/roboto-latin-500-normal.woff2",
  "fonts/roboto-latin-700-normal.woff2",
  "fonts/roboto-latin-ext-400-normal.woff2",
  "fonts/roboto-latin-ext-500-normal.woff2",
  "fonts/roboto-latin-ext-700-normal.woff2",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png"
];

// Установка: кладём в кэш все файлы приложения (HTML, CSS, JS, шрифты, иконки)
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

// Активация: удаляем кэши старых версий и сразу берём страницы под управление
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Запросы: сначала кэш (мгновенно и без сети), параллельно тихо обновляем кэш из сети
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // чужие домены не трогаем

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(req, { ignoreSearch: true });

    const refresh = fetch(req)
      .then((res) => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      })
      .catch(() => null);

    if (cached) {
      event.waitUntil(refresh); // обновление в фоне, ответ не ждёт сеть
      return cached;
    }
    const res = await refresh;
    if (res) return res;
    // офлайн и файла нет в кэше: для переходов по страницам отдаём оболочку приложения
    if (req.mode === "navigate") {
      const shell = await cache.match("index.html");
      if (shell) return shell;
    }
    return new Response("Нет подключения к сети", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  })());
});
