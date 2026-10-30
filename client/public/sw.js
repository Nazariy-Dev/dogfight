// Service worker: кешує оболонку гри (HTML, JS, ассети), щоб застосунок можна було встановити.
// API і WebSocket не кешуються — гра без мережі неможлива за задумом.
const CACHE = 'dogfight-v1'
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(['/', '/manifest.webmanifest', '/assets/manifest.json'])),
  )
  self.skipWaiting()
})
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) =>
        Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      ),
  )
  self.clients.claim()
})
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (
    e.request.method !== 'GET' ||
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/ws')
  )
    return
  // network-first: свіжа версія, кеш — лише якщо мережа недоступна
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(e.request, copy))
        }
        return res
      })
      .catch(() => caches.match(e.request).then((r) => r ?? Response.error())),
  )
})
