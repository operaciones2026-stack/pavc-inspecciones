// Service Worker: guarda la aplicación para que funcione sin conexión. No guarda datos de campo
// (esos están en IndexedDB) ni archivos fuera de la lista (p. ej. datos_entrada o pruebas).

const VERSION = 'pavc-app-v17';
const ARCHIVOS = [
  './', './index.html', './manifest.webmanifest', './icons/icon.svg', './css/app.css',
  './js/app.js', './js/app-ctx.js', './js/config.js', './js/db.js', './js/ids.js', './js/geo.js', './js/rules.js', './js/states.js', './js/repo.js',
  './js/photos.js', './js/search.js', './js/stats.js', './js/ui.js',
  './js/import/zip-read.js', './js/import/xlsx-reader.js', './js/import/maestro.js',
  './js/export/zip-write.js', './js/export/xlsx-writer.js', './js/export/export.js',
  './js/sync/outbox.js', './js/sync/adapter-null.js', './js/sync/adapter-sim.js', './js/sync/adapter-gas.js', './js/sync/google-auth.js',
  './js/views/inicio.js', './js/views/buscar.js', './js/views/locacion.js', './js/views/inspeccion.js', './js/views/hallazgo.js',
  './js/views/historial.js', './js/views/datos.js', './js/views/fotos-widget.js',
  './demo/demo-seed.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ARCHIVOS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => { if (e.data === 'activar') self.skipWaiting(); });

const enLista = (url) => {
  const rel = './' + url.pathname.slice(new URL(self.registration.scope).pathname.length);
  return ARCHIVOS.includes(rel === './' ? './' : rel);
};

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const navegacion = e.request.mode === 'navigate';
  if (!enLista(url)) return; // pruebas, datos_entrada, etc.: siempre red
  // Caché primero (funciona sin conexión); en segundo plano se refresca la copia si hay red.
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const clave = navegacion ? './index.html' : e.request;
    const enCache = await cache.match(clave, { ignoreSearch: navegacion });
    const deRed = fetch(e.request).then((r) => { if (r.ok && !navegacion) cache.put(e.request, r.clone()); return r; }).catch(() => null);
    if (enCache) { e.waitUntil(deRed); return enCache; }
    const r = await deRed;
    return r || new Response('Sin conexión y sin copia local de este recurso.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  })());
});
