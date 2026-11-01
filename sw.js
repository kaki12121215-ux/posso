/* POSSO · service worker
 * - Guarda la app para que abra al momento (y sin conexión).
 * - Recibe los avisos: llega un "toque" sin contenido, pregunta a tu Apps Script qué decir y lo muestra.
 */
const VERSION = 'posso-2.0.5-directo';
const ARCHIVOS = ['./', 'index.html', 'app.css', 'app.js', 'gema.js', 'manifest.webmanifest', 'lista.html',
  'fonts/PlusJakartaSans.woff', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon-32.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== 'posso-cfg').map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Primero la red (para recibir mejoras), si no hay, lo guardado
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) { const copia = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copia)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});

async function config() {
  try { const r = await (await caches.open('posso-cfg')).match('cfg'); return r ? await r.json() : {}; } catch (e) { return {}; }
}

self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let avisos = [];
    const cfg = await config();
    if (cfg.url) {
      try {
        const r = await fetch(cfg.url, { method: 'POST', body: JSON.stringify({ accion: 'pendientes', key: cfg.key }) });
        avisos = (await r.json()).avisos || [];
      } catch (err) {}
    }
    if (!avisos.length) avisos = [{ titulo: 'Posso', cuerpo: 'Tienes algo pendiente. Toca para verlo.', abrir: 'hoy' }];
    for (const a of avisos.slice(-3)) {
      await self.registration.showNotification(a.titulo || 'Posso', {
        body: a.cuerpo || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
        tag: 'posso-' + (a.t || Date.now()), data: { abrir: a.abrir || 'hoy' }
      });
    }
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const abrir = (e.notification.data && e.notification.data.abrir) || 'hoy';
  e.waitUntil((async () => {
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (cs.length) { cs[0].postMessage({ abrir }); return cs[0].focus(); }
    return self.clients.openWindow('./?abrir=' + abrir);
  })());
});
