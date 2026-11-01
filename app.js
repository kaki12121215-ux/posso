/* POSSO · la app
 * Todo en un archivo: datos, conexión con tu Google (Apps Script), voz, pantallas y animaciones.
 */
'use strict';

// =====================================================================
// 1 · CONSTANTES
// =====================================================================
const CATS = ['hoy', 'semana', 'algun', 'olvidar'];
const NOMBRE = { hoy: 'Hoy', semana: 'Esta semana', algun: 'Algún día', olvidar: 'Olvidar' };
const SUB = {
  hoy: 'Con esto, el día está cubierto.',
  semana: 'Te aviso de cada cosa el día que toca.',
  algun: 'Sin prisa. Te las recuerdo de vez en cuando.',
  olvidar: 'Lo has dicho y ya no pesa. Se borra solo.'
};
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIA_MS = 864e5;
const VERSION = '1.0';

// =====================================================================
// 2 · UTILIDADES
// =====================================================================
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2));
const pad = n => String(n).padStart(2, '0');
const isoDia = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const isoLocal = d => isoDia(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
const deIso = s => { const [d, t] = s.split('T'); const [Y, M, D] = d.split('-').map(Number); const [h, m] = (t || '09:00').split(':').map(Number); return new Date(Y, M - 1, D, h, m); };
const hoyIso = () => isoDia(new Date());
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = ms => new Promise(r => setTimeout(r, ms));
const vib = () => { try { navigator.vibrate && navigator.vibrate(8); } catch (e) {} };
const standalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

function load(k, def) { try { const v = JSON.parse(localStorage.getItem('posso.' + k)); return v == null ? def : v; } catch (e) { return def; } }
function save(k, v) { try { localStorage.setItem('posso.' + k, JSON.stringify(v)); } catch (e) {} }

// =====================================================================
// 3 · ESTADO
// =====================================================================
const S = {
  cfg: load('cfg', null),                       // { url, key } · null = modo prueba
  ideas: load('ideas', []),
  papelera: {},                                 // ideas borradas (para deshacer)
  carpetas: load('carpetas', ['Instituto', 'Familia', 'Casa']),
  ajustes: load('ajustes', { avisoSuaveDias: 3, horaAvisos: '09:00', alarmaCalendario: false, avisosActivos: true }),
  local: load('local', { tema: 'auto', vivo: true, onboarded: false, carpetasOn: true, demoSembrado: false }),
  outbox: load('outbox', []),
  cat: 'hoy',                                   // categoría abierta
  borrador: null,                               // resultado aún sin guardar
  entrada: null,                                // lo último que se mandó a ordenar ({audio,mime} | {texto})
  idea: null                                    // idea abierta en la hoja
};
function persist() {
  save('ideas', S.ideas); save('carpetas', S.carpetas); save('ajustes', S.ajustes);
  save('local', S.local); save('outbox', S.outbox); save('cfg', S.cfg);
}

// =====================================================================
// 4 · CONEXIÓN CON TU GOOGLE (Apps Script)
// =====================================================================
function leerCodigo(codigo) {
  codigo = String(codigo || '').trim().replace(/\s+/g, '');
  if (!codigo) return null;
  try {
    const b = atob(codigo.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((codigo.length + 3) % 4));
    const [url, key] = new TextDecoder().decode(Uint8Array.from(b, c => c.charCodeAt(0))).split('|');
    if (!/^https:\/\/script\.google\.com\//.test(url) || !key) return null;
    return { url, key };
  } catch (e) { return null; }
}

async function api(accion, datos = {}, espera = 30000) {
  if (!S.cfg) throw new Error('sin-conexion');
  const ctl = window.AbortController ? new AbortController() : null;
  const t = setTimeout(() => ctl && ctl.abort(), espera);
  let r;
  try {
    r = await fetch(S.cfg.url, { method: 'POST', body: JSON.stringify(Object.assign({}, datos, { accion, key: S.cfg.key })), signal: ctl ? ctl.signal : undefined });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'Tu Google está tardando demasiado en responder. Prueba otra vez en un momento.' : (e.message || 'Load failed'));
  } finally { clearTimeout(t); }
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j;
}

// Guardar la configuración también para el service worker (para los avisos)
async function cfgParaSW() {
  try {
    const c = await caches.open('posso-cfg');
    await c.put('cfg', new Response(JSON.stringify(S.cfg || {})));
  } catch (e) {}
}

// ---- cola de cambios: todo se hace al momento en el iPhone y se manda a Google por detrás ----
let sincronizando = false, sincTimer = null;
function encolar(op) { S.outbox.push(op); persist(); programarSync(); }
function programarSync(ms = 500) { clearTimeout(sincTimer); sincTimer = setTimeout(sincronizar, ms); }

async function sincronizar(traer = false) {
  if (!S.cfg || sincronizando) return;
  sincronizando = true;
  try {
    while (S.outbox.length) {
      const op = S.outbox[0];
      await api(op.accion, op);
      S.outbox.shift(); persist();
    }
    if (traer) {
      const r = await api('listar');
      // lo que haya cambiado mientras tanto en el iPhone tiene prioridad
      if (!S.outbox.length) {
        S.ideas = r.ideas; S.carpetas = r.carpetas; S.ajustes = Object.assign(S.ajustes, r.ajustes);
        persist(); pintarTodo();
      }
    }
  } catch (e) {
    if (String(e.message).indexOf('Clave') >= 0) toast('La clave no es válida. Revisa la conexión en Ajustes.');
    else programarSync(15000);
  } finally { sincronizando = false; }
}

// =====================================================================
// 5 · LAS IDEAS
// =====================================================================
function catDe(i) {
  if (i.cat === 'semana' && i.aviso && i.aviso.slice(0, 10) <= hoyIso()) return 'hoy';
  return i.cat;
}
function vivas() {
  const ahora = Date.now();
  return S.ideas.filter(i => {
    if (i.cat === 'olvidar' && ahora - i.creado > 7 * DIA_MS) return false;
    if (i.hecho && ahora - (i.hechoEn || 0) > 2 * DIA_MS) return false;
    return true;
  });
}
function ordenar(a, b) {
  if (a.hecho !== b.hecho) return a.hecho ? 1 : -1;
  if (a.hecho) return (b.hechoEn || 0) - (a.hechoEn || 0);
  if (a.urgente !== b.urgente) return a.urgente ? -1 : 1;
  if (!!a.aviso !== !!b.aviso) return a.aviso ? -1 : 1;
  if (a.aviso && b.aviso && a.aviso !== b.aviso) return a.aviso < b.aviso ? -1 : 1;
  return (a.orden || a.creado) - (b.orden || b.creado);
}
const deCat = c => vivas().filter(i => catDe(i) === c).sort(ordenar);
const pendientes = c => deCat(c).filter(i => !i.hecho);
const buscar = id => S.ideas.find(i => i.id === id);

// mutaciones básicas (se usan desde el historial para poder deshacer)
function crearIdeas(lista) {
  lista.forEach(i => { if (!buscar(i.id)) S.ideas.push(i); });
  persist();
  encolar({ accion: 'guardar', ideas: lista });
}
function cambiar(id, cambios) {
  const i = buscar(id); if (!i) return;
  Object.assign(i, cambios);
  if ('hecho' in cambios) i.hechoEn = cambios.hecho ? Date.now() : 0;
  persist();
  encolar({ accion: 'actualizar', id, cambios });
}
function quitar(id) {
  const k = S.ideas.findIndex(i => i.id === id); if (k < 0) return;
  S.papelera[id] = S.ideas[k]; S.ideas.splice(k, 1); persist();
  encolar({ accion: 'borrar', id });
}
function devolver(id) {
  const i = S.papelera[id]; if (!i) return;
  S.ideas.push(i); delete S.papelera[id]; persist();
  encolar({ accion: 'restaurar', id });
}

// ---- deshacer / rehacer ----
const H = { lista: { past: [], fut: [] }, borrador: { past: [], fut: [] } };
function hacer(op) { op.do(); H.lista.past.push(op); H.lista.fut = []; pintarUR(); }
const OP = {
  cambiar(id, cambios) {
    const i = buscar(id); const antes = {};
    Object.keys(cambios).forEach(k => antes[k] = i[k]);
    return { do: () => cambiar(id, cambios), undo: () => cambiar(id, antes) };
  },
  quitar(id) { return { do: () => quitar(id), undo: () => devolver(id) }; },
  crear(lista) {
    return { do: () => { lista.forEach(i => S.papelera[i.id] ? devolver(i.id) : null); if (!buscar(lista[0].id)) crearIdeas(lista); },
             undo: () => lista.forEach(i => quitar(i.id)) };
  }
};
function deshacer(cual) {
  if (cual === 'borrador') return borradorUR(-1);
  const op = H.lista.past.pop(); if (!op) return;
  op.undo(); H.lista.fut.push(op); vib(); pintarUR(); pintarTodo(true);
}
function rehacer(cual) {
  if (cual === 'borrador') return borradorUR(1);
  const op = H.lista.fut.pop(); if (!op) return;
  op.do(); H.lista.past.push(op); vib(); pintarUR(); pintarTodo(true);
}
function pintarUR() {
  $$('[data-ur]').forEach(el => {
    const h = H[el.dataset.ur];
    el.innerHTML =
      `<button data-act="deshacer" data-cual="${el.dataset.ur}" ${h.past.length ? '' : 'disabled'} aria-label="Deshacer">${ICO.undo}</button>` +
      `<button data-act="rehacer" data-cual="${el.dataset.ur}" ${h.fut.length ? '' : 'disabled'} aria-label="Rehacer">${ICO.redo}</button>`;
  });
}

// =====================================================================
// 6 · TEXTOS DE FECHAS Y ETIQUETAS
// =====================================================================
function fechaCorta(aviso, largo) {
  if (!aviso) return '';
  const d = deIso(aviso), hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const dias = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - hoy) / DIA_MS);
  const hora = d.getHours() + ':' + pad(d.getMinutes());
  let dia;
  if (dias === 0) dia = 'hoy';
  else if (dias === 1) dia = 'mañana';
  else if (dias > 1 && dias < 7) dia = DIAS[d.getDay()];
  else dia = d.getDate() + ' ' + MESES[d.getMonth()];
  return largo ? `${dia} a las ${hora}` : `${dia} ${hora}`;
}
function hace(ms) {
  const d = Math.floor((Date.now() - ms) / DIA_MS);
  if (d < 1) return 'Guardada hoy';
  if (d === 1) return 'Guardada ayer';
  if (d < 14) return `Guardada hace ${d} días`;
  if (d < 60) return `Guardada hace ${Math.round(d / 7)} semanas`;
  const m = Math.round(d / 30); return `Guardada hace ${m} ${m === 1 ? 'mes' : 'meses'}`;
}
function quedan(creado) {
  const d = 7 - Math.floor((Date.now() - creado) / DIA_MS);
  return d <= 0 ? 'Se borra hoy' : d === 1 ? 'Se borra mañana' : `Se borra en ${d} días`;
}

const ICO = {
  folder: '<svg width="9" height="8" viewBox="0 0 9 8"><path d="M.5 1.5a1 1 0 0 1 1-1h2l1 1h3a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1z"/></svg>',
  chev: c => `<svg width="7" height="12" viewBox="0 0 9 15" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 1.5l6 6-6 6"/></svg>`,
  undo: '<svg width="20" height="18" viewBox="0 0 20 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4L3 8l4 4"/><path d="M3 8h9a5 5 0 0 1 0 10h-2"/></svg>',
  redo: '<svg width="20" height="18" viewBox="0 0 20 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="transform:scaleX(-1)"><path d="M7 4L3 8l4 4"/><path d="M3 8h9a5 5 0 0 1 0 10h-2"/></svg>',
  trash: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 5.5h13M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M5.5 5.5l.8 10.2a1.5 1.5 0 0 0 1.5 1.3h4.4a1.5 1.5 0 0 0 1.5-1.3l.8-10.2"/></svg>',
  arrowR: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10h11M11 5.5l4.5 4.5-4.5 4.5"/></svg>',
  mic: '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="7.5" y="2.5" width="7" height="11" rx="3.5"/><path d="M4.5 10.5a6.5 6.5 0 0 0 13 0M11 17v3"/></svg>',
  bell: '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15V10a5 5 0 0 1 10 0v5l1.5 2h-13z"/><path d="M9.5 19.5a1.8 1.8 0 0 0 3 0"/></svg>',
  folderL: '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2h7A1.5 1.5 0 0 1 19 8.5v8A1.5 1.5 0 0 1 17.5 18h-13A1.5 1.5 0 0 1 3 16.5z"/></svg>'
};

function check(cat, done, size) {
  const c = `var(--c-${cat})`;
  if (cat === 'olvidar')
    return `<svg class="ck" width="${size}" height="${size}" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8.6" fill="none" stroke="${c}" stroke-width="1.3" stroke-dasharray="2.6 2.4"/></svg>`;
  return `<svg class="ck${done ? ' done' : ''}" width="${size}" height="${size}" viewBox="0 0 20 20">` +
    `<circle class="f" cx="10" cy="10" r="9.2" fill="${c}"/><circle cx="10" cy="10" r="8.6" fill="none" stroke="${c}" stroke-width="1.3"/>` +
    `<path d="M6 10.3l2.6 2.6L14.2 7.4" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/** Etiquetas debajo de cada idea: Urgente primero, luego la carpeta, luego fecha o nota. */
function meta(i, modo) {
  const partes = [];
  if (i.urgente) partes.push('<span class="urgchip"><i></i>Urgente</span>');
  if (i.carpeta && S.local.carpetasOn) partes.push(`<span class="chip">${ICO.folder}${esc(i.carpeta)}</span>`);
  let txt = '';
  if (modo === 'borrador') {
    if (i.aviso) txt = 'te aviso ' + fechaCorta(i.aviso, true);
    else if (i.cat === 'olvidar') txt = 'se borra solo en 7 días';
  } else if (i.hecho) {
    txt = '';
  } else if (i.cat === 'olvidar') txt = quedan(i.creado);
  else if (i.aviso) txt = fechaCorta(i.aviso);
  else if (i.cat === 'algun' && modo === 'lista') txt = hace(i.creado);
  if (txt) partes.push(`<span class="mtxt">${esc(cap(txt))}</span>`);
  return partes.length ? `<div class="meta">${partes.join('')}</div>` : '';
}

// =====================================================================
// 7 · LA GEMA
// =====================================================================
let gemN = 0;
function pintarGema(el) {
  const dark = document.documentElement.dataset.theme === 'dark';
  const k = 'g' + (++gemN);
  const body = (dark ? GEMA.dark : GEMA.light).replace(/__K__/g, k);
  const sh = `<svg viewBox="0 0 100 100"><defs>${(dark ? GEMA.darkShadowDefs : GEMA.lightShadowDefs).replace(/__K__/g, k + 's')}</defs>` +
    `${(dark ? GEMA.darkShadow : GEMA.lightShadow).replace(/__K__/g, k + 's')}</svg>`;
  el.innerHTML = `<div class="gem-halo"></div><div class="gem-move"><div class="gem-shadow">${sh}</div><div class="gem-body">${body}</div></div>`;
}
const pintarGemas = () => $$('[data-gem]').forEach(pintarGema);
function animarGema(el, clase) {
  if (!el) return;
  el.classList.remove('drop', 'settle'); void el.offsetWidth; el.classList.add(clase);
  setTimeout(() => el.classList.remove(clase), 800);
}

// =====================================================================
// 8 · NAVEGACIÓN ENTRE PANTALLAS
// =====================================================================
let actual = null;
const pila = [];
function ir(id, modo = 'push', { sinPila = false } = {}) {
  const nueva = $('#' + id); if (!nueva || actual === nueva) return;
  const vieja = actual;
  if (vieja && !sinPila && modo === 'push') pila.push(vieja.id);
  if (vieja) {
    vieja.className = 'screen out-' + modo;
    setTimeout(() => { if (vieja !== actual) vieja.className = 'screen'; }, 320);
  }
  nueva.className = 'screen on in-' + modo;
  actual = nueva;
  setTimeout(() => { if (nueva === actual) nueva.className = 'screen on'; }, 420);
  cerrarHoja('sh-cosas', true); cerrarIdea(true);
  $('#toast').classList.remove('on');
  const pint = { 's-home': pintarInicio, 's-list': () => pintarLista(0), 's-aj': pintarAjustes, 's-res': pintarResultado };
  pint[id] && pint[id]();
  pintarUR();
}
function atras() {
  const id = pila.pop() || 's-home';
  ir(id, 'back', { sinPila: true });
}
function irInicio(efecto) {
  pila.length = 0;
  ir('s-home', 'fade', { sinPila: true });
  if (efecto) setTimeout(() => animarGema($('#home-gem'), efecto), 60);
}

// ---- hojas que suben desde abajo ----
function abrirHoja(id) {
  const sh = $('#' + id), scrim = id === 'sh-cosas' ? $('#scrim-cosas') : $('#scrim-idea');
  scrim.classList.add('on'); sh.classList.add('on');
}
function cerrarHoja(id, rapido) {
  const sh = $('#' + id); if (!sh || !sh.classList.contains('on')) return;
  const scrim = id === 'sh-cosas' ? $('#scrim-cosas') : $('#scrim-idea');
  sh.classList.remove('on'); scrim.classList.remove('on');
  if (rapido) { sh.style.transition = 'none'; requestAnimationFrame(() => sh.style.transition = ''); }
}

// =====================================================================
// 9 · PANTALLAS
// =====================================================================
function pintarTodo(suave) {
  if (!actual) return;
  if (actual.id === 's-home') pintarInicio();
  if (actual.id === 's-list') pintarLista(0, suave);
  if (actual.id === 's-res') pintarResultado();
  if ($('#sh-cosas').classList.contains('on')) pintarCajones(false);
}

// ---------- Inicio ----------
function pintarInicio() {
  const n = pendientes('hoy').length, total = vivas().filter(i => !i.hecho).length;
  const dark = document.documentElement.dataset.theme === 'dark';
  const usado = S.ideas.length > 0;
  $('#home-q').textContent = usado && n === 0 ? 'Por hoy, ya está.' : '¿Qué tienes en la cabeza?';
  $('#home-hint').textContent = dark && usado ? '¿Te ronda algo? Toca la gema' : 'Toca la gema y habla';
  $('#home-today').textContent = n ? `${n} para hoy` : total ? 'Tus cosas' : 'Tus cosas';
}

// ---------- Tus cosas (las cuatro tarjetas) ----------
function pintarCajones(animar = true) {
  $('#drawers').innerHTML = CATS.map((c, k) => {
    const items = pendientes(c);
    const filas = items.slice(0, 2).map(i =>
      `<div class="row${c === 'olvidar' ? ' olv' : ''}">${check(c, false, 18)}<div style="min-width:0"><div class="t">${esc(i.titulo)}</div>${meta(i, 'cajon')}</div></div>`).join('');
    return `<button class="drawer" data-act="abrir-cat" data-cat="${c}" style="background:var(--k-${c});--i:${k}">
      <div class="drawer-h"><b>${NOMBRE[c]}</b><span style="color:var(--c-${c})">${items.length}</span></div>
      ${filas || `<div class="empty">${c === 'hoy' ? 'Nada para hoy.' : 'Vacío.'}</div>`}
      ${items.length > 2 ? `<div class="more">+${items.length - 2} más</div>` : ''}
      <span class="chev">${ICO.chev(`var(--c-${c})`)}</span></button>`;
  }).join('');
  const d = $('#drawers'); d.classList.remove('enter');
  if (animar) { void d.offsetWidth; d.classList.add('enter'); }
}
function abrirCosas() { pintarCajones(); abrirHoja('sh-cosas'); vib(); }

// ---------- Una categoría ----------
function pintarSwitcher() {
  $('#switcher').innerHTML = CATS.map(c =>
    `<button data-act="cat" data-cat="${c}" class="${c === S.cat ? 'on' : ''}" style="background:var(--v-${c})" aria-label="${NOMBRE[c]}"></button>`).join('');
}
function pintarLista(dir = 0, suave = false) {
  pintarSwitcher();
  const c = S.cat, items = deCat(c), pend = items.filter(i => !i.hecho);
  const hoy = new Date();
  const lab = c === 'hoy' ? `Hoy · ${DIAS[hoy.getDay()]} ${hoy.getDate()}` : NOMBRE[c];
  const labCol = document.documentElement.dataset.theme === 'dark' ? `var(--c-${c})` : c === 'hoy' ? 'var(--deep)' : 'var(--ink2)';
  const vacio = !items.length;
  const head = `<div class="headcard" data-swipecat style="background:var(--k-${c})">
      <div class="lab" style="color:${labCol}">${lab}</div>
      <div class="n">${vacio ? (c === 'hoy' ? 'Nada para hoy.' : 'Nada por aquí.') : `${pend.length} ${pend.length === 1 ? 'cosa' : 'cosas'}`}</div>
      <div class="s">${vacio ? (c === 'hoy' ? 'Aprovecha.' : 'Cuando digas algo así, aparecerá aquí.') : SUB[c]}</div></div>`;
  let cuerpo;
  if (vacio) {
    cuerpo = `<div class="empty-state" data-swipecat><div class="gem" data-gem style="--s:min(200px,26vh);opacity:.9"></div><p>Si te ronda algo, toca la gema y cuéntamelo.</p></div>`;
  } else {
    cuerpo = `<div class="items" data-swipecat>${items.map(fila).join('')}
      <div class="cheer" id="cheer">Una menos.</div>
      ${c === 'hoy' && pend.length ? '<div class="list-note">Desliza a la izquierda para borrar.</div>' : ''}
      ${c === 'olvidar' ? '<div class="list-note">Desliza una idea a la derecha si al final sí quieres hacerla.</div>' : ''}</div>`;
  }
  const body = $('#list-body');
  const antes = suave ? posiciones() : null;
  body.innerHTML = head + `<div class="scroll">${cuerpo}</div>`;
  body.querySelectorAll('[data-gem]').forEach(pintarGema);
  body.className = 'list-body' + (dir > 0 ? ' slide-l' : dir < 0 ? ' slide-r' : '');
  if (antes) flip(antes);
  else if (dir === 0 && !suave) { const it = body.querySelector('.items'); if (it) { [...it.children].forEach((e, k) => e.style.setProperty('--i', Math.min(k, 8))); it.classList.add('enter'); setTimeout(() => it.classList.remove('enter'), 1400); } }
}
function fila(i) {
  const c = S.cat, olv = i.cat === 'olvidar';
  const under = olv
    ? `<div class="under go"><div class="act">${ICO.arrowR}Hacer</div></div><div class="under del"><div class="act">${ICO.trash}Borrar</div></div>`
    : `<div class="under del"><div class="act">${ICO.trash}Borrar</div></div>`;
  return `<div class="task${i.hecho ? ' done' : ''}${olv ? ' olv' : ''}" data-id="${i.id}">${under}
    <div class="front"><button data-act="hecho" data-id="${i.id}" style="padding:0;align-self:flex-start" aria-label="Hecho">${check(olv ? 'olvidar' : c, i.hecho, 22)}</button>
    <div class="body" data-act="editar" data-id="${i.id}"><div class="t">${esc(i.titulo)}</div>${i.hecho ? '' : meta(i, 'lista')}</div></div></div>`;
}

// animación FLIP: las filas se recolocan con suavidad
function posiciones() {
  const m = {}; $$('#list-body .task').forEach(e => m[e.dataset.id] = e.getBoundingClientRect().top); return m;
}
function flip(antes) {
  if (reduceMotion()) return;
  $$('#list-body .task').forEach(e => {
    const a = antes[e.dataset.id]; if (a == null) { e.style.animation = 'rise .4s var(--ease) both'; return; }
    const d = a - e.getBoundingClientRect().top; if (!d) return;
    e.style.transform = `translateY(${d}px)`; e.style.transition = 'none';
    requestAnimationFrame(() => { e.style.transition = 'transform .45s var(--ease)'; e.style.transform = ''; });
  });
}
function cambiarCat(c, dir) {
  if (c === S.cat) return;
  dir = dir || (CATS.indexOf(c) > CATS.indexOf(S.cat) ? 1 : -1);
  S.cat = c; vib(); pintarLista(dir);
}

function marcarHecho(id, btn) {
  const i = buscar(id); if (!i) return;
  if (i.cat === 'olvidar') return;               // lo de Olvidar no se "hace": se deja ir
  const nuevo = !i.hecho;
  const ck = btn.querySelector('.ck');
  if (ck) { ck.classList.toggle('done', nuevo); ck.classList.add('pop'); }
  vib();
  setTimeout(() => {
    hacer(OP.cambiar(id, { hecho: nuevo }));
    pintarLista(0, true);
    if (nuevo) { const ch = $('#cheer'); if (ch) { ch.classList.add('on'); setTimeout(() => ch.classList.remove('on'), 2200); } }
  }, 420);
}
function borrarFila(el, id) {
  const h = el.offsetHeight;
  el.style.height = h + 'px';
  requestAnimationFrame(() => { el.classList.add('collapse'); el.style.height = '0px'; });
  setTimeout(() => {
    hacer(OP.quitar(id)); pintarLista(0, true);
    toast('Borrado', 'Deshacer', () => deshacer('lista'));
  }, 300);
}
function soltarOlvidar(el, id) {   // de Olvidar a Hoy
  el.classList.add('leave');
  setTimeout(() => { hacer(OP.cambiar(id, { cat: 'hoy' })); pintarLista(0, true); toast('Pasa a Hoy', 'Deshacer', () => deshacer('lista')); }, 380);
}

// ---------- Hoja de una idea (mover, carpeta, urgente, aviso) ----------
function abrirIdea(ref) {
  // ref: {tipo:'guardada', id} | {tipo:'borrador', k}
  S.idea = ref; pintarIdea(); abrirHoja('sh-idea'); vib();
}
function ideaActual() {
  const r = S.idea; if (!r) return null;
  return r.tipo === 'guardada' ? buscar(r.id) : S.borrador.ideas[r.k];
}
function pintarIdea() {
  const i = ideaActual(); if (!i) return;
  const chips = (lista, sel, act) => lista.map(v =>
    `<button class="csel${v.val === sel ? ' on' : ''}" data-act="${act}" data-v="${esc(v.val)}">${esc(v.txt)}</button>`).join('');
  $('#sh-idea').innerHTML = `
    <div class="grab-zone" data-drag="sh-idea"><div class="grab"></div></div>
    <div class="cap">Idea</div>
    <input class="idea-title" id="idea-title" value="${esc(i.titulo)}" maxlength="120">
    ${i.frase ? `<div class="idea-frase">«${esc(i.frase)}»</div>` : ''}
    <div class="cap" style="margin:20px 0 8px">¿Dónde va?</div>
    <div class="chips">${chips(CATS.map(c => ({ val: c, txt: NOMBRE[c] })), i.cat, 'idea-cat')}</div>
    ${S.local.carpetasOn ? `<div class="cap" style="margin:14px 0 8px">Carpeta</div>
    <div class="chips">${chips(S.carpetas.map(c => ({ val: c, txt: c })), i.carpeta, 'idea-carpeta')}<button class="csel" data-act="nueva-carpeta" data-desde="idea">+ Nueva</button></div>` : ''}
    <div style="margin-top:14px">
      <button class="srow" data-act="idea-urgente"><span style="display:flex;align-items:center;gap:8px"><span class="dot-urg" style="width:8px;height:8px"></span>Urgente</span><span class="sw urg${i.urgente ? ' on' : ''}"><i></i></span></button>
      <button class="srow" data-act="idea-recordar"><span>Recordármelo</span><span class="v">${i.aviso ? esc(cap(fechaCorta(i.aviso))) + ' ›' : 'No ›'}</span></button>
    </div>
    <div class="idea-foot"><button class="link big" style="padding-left:0" data-act="idea-quitar">Quitar</button><button class="pill" data-act="cerrar-idea">Hecho</button></div>`;
}
function cambiarIdea(cambios) {
  const r = S.idea, i = ideaActual(); if (!i) return;
  if (r.tipo === 'guardada') hacer(OP.cambiar(i.id, cambios));
  else { borradorPaso(); Object.assign(i, cambios); }
  vib(); pintarIdea();
}
function guardarTitulo() {
  const t = $('#idea-title');
  if (!t || !S.idea) return;
  const i = ideaActual(), v = t.value.trim();
  if (i && v && v !== i.titulo) cambiarIdea({ titulo: v });
}
function cerrarIdea(rapido) {
  if (!rapido) guardarTitulo();
  cerrarHoja('sh-idea', rapido);
  if (!rapido) { S.idea = null; pintarTodo(true); }
}

// ---------- Recordar ----------
let recSel = null, recVuelta = null;
function opcionesAviso() {
  const ahora = new Date(), o = [];
  const at = (d, h, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x; };
  if (ahora.getHours() < 17) o.push({ t: 'Esta tarde', d: at(ahora, 18) });
  const man = new Date(ahora); man.setDate(man.getDate() + 1);
  o.push({ t: 'Mañana por la mañana', d: at(man, 9) });
  const sab = new Date(ahora); sab.setDate(sab.getDate() + ((6 - sab.getDay() + 7) % 7 || 7));
  if ((sab - ahora) / DIA_MS > 1.2) o.push({ t: 'El fin de semana', d: at(sab, 10) });
  const lun = new Date(ahora); lun.setDate(lun.getDate() + ((1 - lun.getDay() + 7) % 7 || 7));
  o.push({ t: 'La semana que viene', d: at(lun, 9) });
  const vistos = {};
  return o.filter(x => { const k = isoLocal(x.d); if (vistos[k]) return false; vistos[k] = 1; return true; });
}
function abrirRecordar() {
  guardarTitulo();
  const i = ideaActual(); if (!i) return;
  recSel = i.aviso || null;
  recVuelta = S.idea;
  cerrarHoja('sh-idea', true);
  pintarRecordar();
  ir('s-rec', 'push');
}
function pintarRecordar() {
  S.idea = recVuelta;
  const i = ideaActual(); if (!i) return;
  const ops = opcionesAviso();
  const propia = recSel && !ops.some(o => isoLocal(o.d) === recSel);
  const w = (t, sub, val, extra = '') =>
    `<button class="when${val === recSel ? ' on' : ''}" data-act="rec-sel" data-v="${val || ''}"><b>${t}</b><span>${sub}</span>${extra}</button>`;
  $('#rec-body').innerHTML = `
    <div class="cap" style="padding:4px 22px 0">${NOMBRE[i.cat]}</div>
    <div class="h1" style="padding-top:4px">${esc(i.titulo)}</div>
    ${i.carpeta && S.local.carpetasOn ? `<div style="padding:10px 22px 0"><span class="chip">${ICO.folder}${esc(i.carpeta)}</span></div>` : ''}
    <div style="padding:18px 22px 0;font-size:18px;font-weight:600">¿Cuándo te lo recuerdo?</div>
    <div style="padding:4px 16px 0" class="enter">
      ${ops.map((o, k) => w(o.t, cap(fechaCorta(isoLocal(o.d))), isoLocal(o.d))).join('')}
      <label class="when${propia ? ' on' : ''}"><b>Elegir fecha</b><span>${propia ? esc(cap(fechaCorta(recSel))) : '›'}</span>
        <input type="datetime-local" id="rec-input" value="${recSel || isoLocal(new Date(Date.now() + 36e5))}"></label>
      ${i.aviso ? w('Sin aviso', '', '') : ''}
    </div>
    <div style="padding:16px 22px 140px;font-size:13px;color:var(--ink3);line-height:1.45">El aviso te llega como notificación de Posso y queda apuntado en tu Google Calendar.</div>`;
  [...$('#rec-body .enter').children].forEach((e, k) => e.style.setProperty('--i', k));
  $('#rec-input').addEventListener('change', e => { if (e.target.value) { recSel = e.target.value.slice(0, 16); pintarRecordar(); } });
}
function confirmarRecordar() {
  S.idea = recVuelta;
  const i = ideaActual();
  if (i) {
    const cambios = { aviso: recSel || '' };
    if (recSel && i.cat === 'algun') cambios.cat = 'semana';
    if (S.idea.tipo === 'guardada') hacer(OP.cambiar(i.id, cambios)); else { borradorPaso(); Object.assign(i, cambios); }
  }
  atras();
  setTimeout(() => { if (S.idea) { pintarIdea(); abrirHoja('sh-idea'); } }, 380);
}

// ---------- Ajustes ----------
function pintarAjustes() {
  const tg = (act, on, label, urg) => `<button class="arow tg" data-act="${act}"><span>${label}</span><span class="sw${on ? ' on' : ''}"><i></i></span></button>`;
  const row = (act, label, v, extra = '') => `<button class="arow" data-act="${act}"><span>${label}</span><span class="v">${v} ›</span>${extra}</button>`;
  const cuenta = n => vivas().filter(i => i.carpeta === n && !i.hecho).length;
  const pushTxt = !S.cfg ? 'Conecta primero' : !('PushManager' in window) ? (standalone() ? 'No disponible' : 'Desde el icono') :
    Notification.permission === 'granted' && S.local.push ? 'Activados' : 'Activar';
  $('#aj-body').innerHTML = `
    <div style="font-size:30px;font-weight:600;padding:2px 20px 0">Ajustes</div>
    <div class="aj-h">Apariencia</div>
    <div class="card" style="padding:12px">
      <div class="seg">${[['claro', 'Claro'], ['oscuro', 'Oscuro'], ['auto', 'Automático']].map(([v, t]) =>
        `<button class="${S.local.tema === v ? 'on' : ''}" data-act="tema" data-v="${v}">${t}</button>`).join('')}</div>
      <div class="aj-note">«Automático» sigue el modo del iPhone: claro de día y oscuro de noche.</div></div>
    <div class="aj-h">Carpetas</div>
    <div class="card">
      ${tg('carpetas-on', S.local.carpetasOn, 'Usar carpetas')}
      ${S.local.carpetasOn ? S.carpetas.map((n, k) => row('carpeta', esc(n), cuenta(n)).replace('data-act="carpeta"', `data-act="carpeta" data-k="${k}"`)).join('') +
        `<button class="arow" data-act="nueva-carpeta"><span style="color:var(--deep)">+ Nueva carpeta</span></button>` : ''}
    </div>
    <div class="aj-h">Avisos</div>
    <div class="card">
      ${row('push', 'Avisos en este iPhone', pushTxt)}
      ${tg('aviso-suave', S.ajustes.avisoSuaveDias > 0, 'Recordar si llevo días sin usarla')}
      <div class="arow"><span>Hora de los avisos</span><span class="v">${esc(S.ajustes.horaAvisos)} ›</span><input type="time" id="aj-hora" value="${esc(S.ajustes.horaAvisos)}"></div>
      ${tg('alarma-cal', S.ajustes.alarmaCalendario, 'Que también suene Google Calendar')}
      ${S.cfg && S.local.push ? row('probar-aviso', 'Probar un aviso', '') : ''}
    </div>
    <div class="aj-note" style="padding:8px 32px 0">Las cosas con fecha se apuntan siempre en tu Google Calendar. Si dejas apagado lo de que suene, solo te avisa Posso y no te llegan dos avisos.</div>
    <div class="aj-h">Voz y cuenta</div>
    <div class="card">
      ${tg('vivo', S.local.vivo, 'Ver lo que digo mientras hablo')}
      ${row('cuenta', 'Cuenta de Google', S.cfg ? 'conectada' : 'modo prueba')}
    </div>
    <div class="aj-foot">Posso ${VERSION} · Lo que dices no se guarda como audio: solo el texto ordenado, en tu propio Google Drive.</div>`;
  $('#aj-hora').addEventListener('change', e => { if (e.target.value) guardarAjustes({ horaAvisos: e.target.value }); });
}
function guardarAjustes(c) {
  Object.assign(S.ajustes, c); persist();
  if (S.cfg) encolar({ accion: 'ajustes', ajustes: c });
  pintarAjustes();
}
function aplicarTema(animar) {
  const t = S.local.tema;
  const dark = t === 'oscuro' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  const nuevo = dark ? 'dark' : 'light';
  const root = document.documentElement;
  $('#theme-color').setAttribute('content', dark ? '#071D1C' : '#EEF6F5');
  if (root.dataset.theme === nuevo && !animar) return;
  if (animar && !reduceMotion()) { root.classList.add('theme-anim'); setTimeout(() => root.classList.remove('theme-anim'), 600); }
  root.dataset.theme = nuevo;
  $('#theme-color').setAttribute('content', dark ? '#071D1C' : '#EEF6F5');
  pintarGemas(); pintarTodo(true);
}

// ---------- Bienvenida ----------
let paso = 0;
function pintarBienvenida() {
  $('#onb-how').innerHTML = [
    ['hoy', 'Lo que toca ya.', 'contestar a las familias'],
    ['semana', 'Con fecha cercana. Te aviso.', 'el regalo de la ama, el lunes'],
    ['algun', 'Ideas sin prisa.', 'una escapada a Biarritz'],
    ['olvidar', 'No es tarea. Lo sueltas y se borra solo.', 'lo que dijo aquel compañero']
  ].map(([c, d, e], k) => `<div class="how" style="background:var(--k-${c});--i:${k}"><div class="how-h"><i style="background:var(--c-${c})"></i><b>${NOMBRE[c]}</b></div><p>${d} <q>${e}</q></p></div>`).join('');
  pintarPermisos();
}
function pintarPermisos() {
  const p = (act, ic, t, s, on) => `<button class="perm" data-act="${act}"><div class="ic">${ic}</div><div class="tx"><b>${t}</b><small>${s}</small></div><span class="sw${on ? ' on' : ''}"><i></i></span></button>`;
  $('#onb-perms').innerHTML =
    p('perm-mic', ICO.mic, 'Micrófono', 'Para escucharte cuando toques la gema.', !!S.local.micOk) +
    p('perm-avisos', ICO.bell, 'Avisos', S.cfg ? 'Te recuerdo las cosas con fecha. También van a tu Google Calendar.' : 'Te recuerdo las cosas con fecha (al conectar tu Google).', !!S.local.push) +
    p('carpetas-on', ICO.folderL, 'Carpetas', 'Instituto, Familia, Casa… Las puedes cambiar luego.', S.local.carpetasOn);
}
function mostrarPaso(n) {
  if (n === 2 && S.cfg) n = paso < 2 ? 3 : 1;      // ya conectado: se salta este paso
  paso = n;
  $$('.onb-step').forEach(e => e.classList.toggle('on', +e.dataset.step === n));
  $$('#onb-dots span').forEach((e, k) => e.classList.toggle('on', k === n));
  $('#onb-next').textContent = n === 3 ? 'Empezar' : n === 2 ? 'Conectar' : 'Siguiente';
  $('#onb-demo').style.visibility = n === 2 ? 'visible' : 'hidden';
  const st = $(`.onb-step[data-step="${n}"]`);
  if (!reduceMotion()) { st.style.animation = 'none'; void st.offsetWidth; st.style.animation = 'inPush .4s var(--ease) both'; }
  const en = st.querySelector('.enter'); if (en) { en.classList.remove('enter'); void en.offsetWidth; en.classList.add('enter'); }
}
async function conectarCon(codigo, msgEl) {
  const cfg = leerCodigo(codigo);
  if (!cfg) { if (msgEl) msgEl.textContent = 'Ese código no parece correcto. Cópialo entero desde el registro de Apps Script.'; return false; }
  if (msgEl) msgEl.textContent = 'Conectando…';
  const antes = S.cfg; S.cfg = cfg;
  try {
    const r = await api('hola');
    S.carpetas = r.carpetas; S.ajustes = Object.assign(S.ajustes, r.ajustes);
    // si venías del modo prueba, lo de prueba no se sube
    if (!antes) { S.ideas = []; S.outbox = []; }
    persist(); cfgParaSW(); sincronizar(true);
    if (msgEl) msgEl.textContent = 'Conectado.';
    return true;
  } catch (e) {
    S.cfg = antes;
    if (msgEl) msgEl.textContent = /Clave/.test(e.message) ? 'La clave no coincide. Vuelve a copiar el código.' : 'No llego a tu Google. Mira que la implementación esté en «Cualquier usuario».';
    return false;
  }
}

// =====================================================================
// 10 · VOZ
// =====================================================================
const V = { stream: null, rec: null, trozos: [], ctx: null, an: null, raf: 0, t0: 0, timer: 0, sr: null, texto: '', interino: '', activa: false, cancelada: false };

async function empezarVoz() {
  ir('s-listen', 'fade');
  $('#live').innerHTML = ''; V.texto = ''; V.interino = '';
  $('#listen-t').textContent = 'Te escucho.';
  $('#listen-s').textContent = 'Dilo tal cual, sin orden. Ya lo ordeno yo.';
  $('#rec-time').textContent = 'Escuchando · 0:00';
  $('#rec-state').style.visibility = 'visible';
  try {
    V.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    $('#listen-t').textContent = 'No te oigo.';
    $('#listen-s').textContent = 'Toca la gema para empezar. Si no funciona, deja usar el micrófono en Ajustes del iPhone › Safari › Micrófono.';
    $('#rec-state').style.visibility = 'hidden';
    V.activa = false;
    return;
  }
  S.local.micOk = true; persist();
  V.activa = true; V.cancelada = false; V.trozos = [];
  const tipos = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];
  const mime = tipos.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
  V.rec = new MediaRecorder(V.stream, mime ? { mimeType: mime } : undefined);
  V.rec.ondataavailable = e => e.data && e.data.size && V.trozos.push(e.data);
  V.rec.start(1000);
  V.t0 = Date.now();
  V.timer = setInterval(() => {
    const s = Math.floor((Date.now() - V.t0) / 1000);
    $('#rec-time').textContent = `Escuchando · ${Math.floor(s / 60)}:${pad(s % 60)}`;
    if (s >= 300) terminarVoz();                  // máximo 5 minutos
  }, 250);
  // nivel de la voz para el halo y los anillos
  try {
    V.ctx = V.ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (V.ctx.state === 'suspended') V.ctx.resume();
    const src = V.ctx.createMediaStreamSource(V.stream);
    V.an = V.ctx.createAnalyser(); V.an.fftSize = 512; src.connect(V.an);
    const buf = new Uint8Array(V.an.fftSize); let suave = 0;
    const stage = $('#listen-stage'), gem = $('#listen-gem');
    const tic = () => {
      if (!V.activa) return;
      V.an.getByteTimeDomainData(buf);
      let s = 0; for (let k = 0; k < buf.length; k++) { const v = (buf[k] - 128) / 128; s += v * v; }
      const nivel = Math.min(1, Math.sqrt(s / buf.length) * 5);
      suave = suave * .75 + nivel * .25;
      stage.style.setProperty('--lvl', suave.toFixed(3)); gem.style.setProperty('--lvl', suave.toFixed(3));
      V.raf = requestAnimationFrame(tic);
    };
    if (!reduceMotion()) tic();
  } catch (e) {}
  // texto en directo (si el iPhone lo permite)
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (S.local.vivo && SR) {
    try {
      const sr = new SR(); V.sr = sr;
      sr.lang = 'es-ES'; sr.continuous = true; sr.interimResults = true;
      sr.onresult = e => {
        let fin = '', inter = '';
        for (let k = e.resultIndex; k < e.results.length; k++) {
          if (e.results[k].isFinal) fin += e.results[k][0].transcript + ' '; else inter += e.results[k][0].transcript;
        }
        V.texto += fin; V.interino = inter; pintarVivo();
      };
      sr.onend = () => { if (V.activa && V.sr === sr) { try { sr.start(); } catch (e) {} } };
      sr.onerror = () => {};
      sr.start();
    } catch (e) { V.sr = null; }
  }
}
function pintarVivo() {
  const marca = s => esc(s).replace(/\b(urgente|urgentes|urgencia)\b/gi, '<span class="w-urg">$1</span>');
  $('#live').innerHTML = `<div>…${marca(V.texto)}<span class="interim">${marca(V.interino)}</span></div>`;
}
function pararVoz() {
  V.activa = false;
  clearInterval(V.timer); cancelAnimationFrame(V.raf);
  $('#listen-stage').style.setProperty('--lvl', 0); $('#listen-gem').style.setProperty('--lvl', 0);
  if (V.sr) { const sr = V.sr; V.sr = null; try { sr.stop(); } catch (e) {} }
  return new Promise(res => {
    if (!V.rec || V.rec.state === 'inactive') { soltarMic(); return res(null); }
    V.rec.onstop = () => { soltarMic(); res(new Blob(V.trozos, { type: V.rec.mimeType || 'audio/mp4' })); };
    V.rec.stop();
  });
}
function soltarMic() { if (V.stream) V.stream.getTracks().forEach(t => t.stop()); V.stream = null; }

async function terminarVoz() {
  if (!V.activa) return;
  const dur = Date.now() - V.t0;
  animarGema($('#listen-gem'), 'settle'); vib();
  const blob = await pararVoz();
  const texto = (V.texto + ' ' + V.interino).trim();
  if (!blob || dur < 800) { if (texto) return procesar({ texto }); irInicio(); return; }
  procesar({ blob, textoVivo: texto });
}
async function cancelarVoz() { await pararVoz(); irInicio(); }
async function vozATexto() {
  const t = (V.texto + ' ' + V.interino).trim();
  await pararVoz();
  abrirEscribir(t);
}

/** Pasa la grabación a WAV mono de 16 kHz, que es lo que mejor entiende Gemini. */
async function aWav(blob) {
  const ab = await blob.arrayBuffer();
  let buf = null;
  for (const sr of [16000, 22050]) {
    try {
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const ctx = new OAC(1, 1, sr);
      buf = await new Promise((ok, ko) => { const p = ctx.decodeAudioData(ab.slice(0), ok, ko); if (p && p.then) p.then(ok, ko); });
      break;
    } catch (e) { buf = null; }
  }
  if (!buf) return null;
  const n = buf.length, ch = buf.numberOfChannels, sr = buf.sampleRate;
  const datos = new Float32Array(n);
  for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let k = 0; k < n; k++) datos[k] += d[k] / ch; }
  const out = new DataView(new ArrayBuffer(44 + n * 2));
  const w = (o, s) => { for (let k = 0; k < s.length; k++) out.setUint8(o + k, s.charCodeAt(k)); };
  w(0, 'RIFF'); out.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, sr, true); out.setUint32(28, sr * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
  w(36, 'data'); out.setUint32(40, n * 2, true);
  for (let k = 0; k < n; k++) { const v = Math.max(-1, Math.min(1, datos[k])); out.setInt16(44 + k * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true); }
  return new Blob([out], { type: 'audio/wav' });
}
const aBase64 = blob => new Promise(ok => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.readAsDataURL(blob); });

// =====================================================================
// 11 · ORDENAR (Gemini o, en modo prueba, aquí mismo)
// =====================================================================
async function procesar(entrada) {
  S.entrada = entrada;
  ir('s-proc', 'fade', { sinPila: true });
  $('#proc-t').textContent = 'Ordenando…';
  $('#proc-s').textContent = 'Un momento.';
  $('#proc-wave').hidden = false; $('#proc-err').hidden = true;
  $('#proc-gem').classList.add('think');
  const t0 = Date.now();
  try {
    let r;
    if (S.cfg) {
      const datos = {};
      if (entrada.texto) datos.texto = entrada.texto;
      else {
        if (!entrada.audio) {
          const wav = await Promise.race([aWav(entrada.blob).catch(() => null), wait(8000).then(() => null)]);
          entrada.audio = await aBase64(wav || entrada.blob);
          entrada.mime = wav ? 'audio/wav' : (entrada.blob.type || 'audio/mp4').split(';')[0];
        }
        datos.audio = entrada.audio; datos.mime = entrada.mime;
      }
      const avisoLento = setTimeout(() => { if (actual && actual.id === 's-proc') $('#proc-s').textContent = 'Sigo con ello. Cuando hay mucho que ordenar tardo un poco más.'; }, 12000);
      try { r = await api('procesar', datos, 100000); } finally { clearTimeout(avisoLento); }
    } else {
      await wait(900);
      const t = entrada.texto || entrada.textoVivo;
      if (!t) throw new Error('En el modo prueba necesito ver el texto. Activa «Ver lo que digo mientras hablo» o escríbelo.');
      r = { transcripcion: t, ideas: ordenarAqui(t) };
    }
    if (!r.ideas || !r.ideas.length) throw new Error('No he encontrado ninguna idea. ¿Lo intentamos otra vez?');
    $('#proc-s').textContent = r.ideas.length === 1 ? 'He encontrado 1 idea.' : `He encontrado ${r.ideas.length} ideas.`;
    await wait(Math.max(0, 700 - (Date.now() - t0)));
    S.borrador = { ideas: r.ideas.map(i => Object.assign({ frase: '', carpeta: '', aviso: '', urgente: false }, i)), transcripcion: r.transcripcion };
    H.borrador = { past: [], fut: [] };
    ir('s-res', 'fade', { sinPila: true });
  } catch (e) {
    $('#proc-gem').classList.remove('think');
    $('#proc-t').textContent = 'No he podido ordenarlo.';
    const m = String(e.message || e);
    $('#proc-s').textContent = /Failed to fetch|NetworkError|Load failed/i.test(m) ? 'Parece que no hay conexión. Lo tengo guardado: prueba otra vez en un momento.' : m.replace(/^Error:\s*/, '');
    $('#proc-wave').hidden = true; $('#proc-err').hidden = false;
  }
}

// ---------- Resultado ----------
function pintarResultado() {
  const b = S.borrador; if (!b) return;
  const n = b.ideas.filter(i => i.cat === 'hoy').length;
  $('#res-t').textContent = n ? `Solo ${n} para hoy.` : 'Nada para hoy.';
  $('#res-s').textContent = b.ideas.length === 1 ? 'Ya tiene su sitio. Tócala para moverla.' : 'Lo demás ya tiene su sitio. Toca una idea para moverla.';
  const orden = (a, c) => (b.ideas[c].urgente - b.ideas[a].urgente) || (a - c);
  $('#res-cards').innerHTML = CATS.map(c => {
    const ks = b.ideas.map((i, k) => k).filter(k => b.ideas[k].cat === c).sort(orden);
    if (!ks.length) return '';
    return `<div class="rcard" style="background:var(--k-${c})"><div class="rcard-h"><b>${NOMBRE[c]}</b><span style="color:var(--c-${c})">${ks.length}</span></div>
      ${ks.map(k => { const i = b.ideas[k]; return `<div class="row${c === 'olvidar' ? ' olv' : ''}" data-act="editar-borrador" data-k="${k}">${check(c, false, 19)}<div style="min-width:0"><div class="t">${esc(i.titulo)}</div>${meta(i, 'borrador')}</div></div>`; }).join('')}</div>`;
  }).join('');
  const el = $('#res-cards');
  [...el.children].forEach((e, k) => e.style.setProperty('--i', k));
  if (!H.borrador.past.length && !H.borrador.fut.length) { el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter'); }
  else el.classList.remove('enter');
  pintarUR();
}
function borradorPaso() { H.borrador.past.push(JSON.stringify(S.borrador.ideas)); H.borrador.fut = []; }
function borradorUR(dir) {
  const h = H.borrador, de = dir < 0 ? h.past : h.fut, a = dir < 0 ? h.fut : h.past;
  if (!de.length) return;
  a.push(JSON.stringify(S.borrador.ideas)); S.borrador.ideas = JSON.parse(de.pop());
  vib(); pintarResultado();
}
function guardarBorrador() {
  const b = S.borrador; if (!b) return;
  const ahora = Date.now();
  const lista = b.ideas.map((i, k) => ({
    id: uid(), creado: ahora + k, orden: ahora + k, titulo: i.titulo, frase: i.frase || '', cat: i.cat,
    carpeta: i.carpeta || '', urgente: !!i.urgente, aviso: i.aviso || '', hecho: false, hechoEn: 0
  }));
  hacer(OP.crear(lista));
  S.borrador = null; S.entrada = null;
  irInicio('drop');
  const nHoy = lista.filter(i => i.cat === 'hoy').length;
  setTimeout(() => toast(nHoy ? 'Guardado. Ya no tienes que acordarte.' : 'Guardado. Cada cosa en su sitio.'), 450);
}

// ---------- Ordenar sin Gemini (modo prueba) ----------
function ordenarAqui(texto) {
  const trozos = texto.replace(/\b(y luego|y también|también|además|y después|y otra cosa)\b/gi, ',')
    .split(/[,;.\n]+|\s+y\s+(?=(?:tengo|hay|el|la|los|las|mañana|algún|me|que|llamar|comprar|preparar|hacer|ir|mandar|enviar)\b)/i)
    .map(s => s.trim()).filter(s => s.length > 3)
    .reduce((acc, s) => {             // "eso es urgente" va con la idea de antes
      if (/^(y\s+)?(eso\s+)?(es\s+)?(muy\s+)?urgente$|^(es\s+)?para\s+ya$/i.test(s) && acc.length) acc[acc.length - 1] += ', urgente';
      else acc.push(s);
      return acc;
    }, []);
  const hoy = new Date();
  const diaSem = { lunes: 1, martes: 2, miércoles: 3, miercoles: 3, jueves: 4, viernes: 5, sábado: 6, sabado: 6, domingo: 0 };
  return trozos.map(t => {
    const l = t.toLowerCase();
    let cat = 'hoy', aviso = '', urgente = /urgente|cuanto antes|corre prisa|ya mismo/.test(l);
    const m = l.match(/\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/);
    const hora = l.match(/a las (\d{1,2})(?::(\d\d))?/);
    const fijar = d => { d.setHours(hora ? +hora[1] : 9, hora && hora[2] ? +hora[2] : 0, 0, 0); aviso = isoLocal(d); };
    if (/me preocupa|me molesta|me ralla|me raya|no depende de m[ií]|qu[eé] rabia|me fastidia|me agobia|lo que dijo/.test(l)) cat = 'olvidar';
    else if (/alg[uú]n d[ií]a|me gustar[ií]a|alg[uú]n momento|cuando pueda|el a[nñ]o que viene|un d[ií]a de estos/.test(l)) cat = 'algun';
    else if (m) { cat = 'semana'; const d = new Date(hoy); d.setDate(d.getDate() + ((diaSem[m[1]] - d.getDay() + 7) % 7 || 7)); fijar(d); }
    else if (/pasado mañana/.test(l)) { cat = 'semana'; const d = new Date(hoy); d.setDate(d.getDate() + 2); fijar(d); }
    else if (/\bmañana\b/.test(l)) { cat = 'semana'; const d = new Date(hoy); d.setDate(d.getDate() + 1); fijar(d); }
    else if (/semana que viene|esta semana|pr[oó]xima semana/.test(l)) cat = 'semana';
    if (urgente && cat !== 'olvidar' && !aviso) cat = 'hoy';
    let carpeta = '';
    const C = S.carpetas;
    if (/instituto|clase|alumn|famil(ias)? de|evaluaci|examen|\dº|claustro|tutor/.test(l) && C.includes('Instituto')) carpeta = 'Instituto';
    else if (/\bama\b|\baita\b|madre|padre|herman|cumplea|abuel|famil/.test(l) && C.includes('Familia')) carpeta = 'Familia';
    else if (/casa|piso|compra|limpiar|papeles|lavadora|fontanero|factura/.test(l) && C.includes('Casa')) carpeta = 'Casa';
    let titulo = t.replace(/^(y |que |pues |bueno |eh )+/i, '').replace(/^(tengo que|hay que|tendría que|debería|me gustaría|quiero)\s+/i, '')
      .replace(/,?\s*(eso es|es) urgente/i, '').replace(/,?\s*(urgente|cuanto antes)$/i, '')
      .replace(/^(el|este|el próximo)\s+(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\s+/i, '')
      .replace(/^(pasado mañana|mañana|la semana que viene|esta semana|la próxima semana|algún día|algun dia)\s+/i, '')
      .replace(/^(tengo que|hay que|quiero|me gustaría)\s+/i, '').trim();
    return { titulo: cap(titulo), frase: t, cat, carpeta, urgente, aviso };
  });
}

// =====================================================================
// 12 · ESCRIBIR
// =====================================================================
function abrirEscribir(texto = '') {
  ir('s-type', 'push', { sinPila: !!actual && ['s-listen', 's-proc'].includes(actual.id) });
  const w = $('#writebox'); w.value = texto; contarIdeas();
  setTimeout(() => w.focus(), 350);
}
function contarIdeas() {
  const v = $('#writebox').value.trim();
  const n = v ? v.split(/[,;.\n]+|\s+y\s+/).filter(s => s.trim().length > 3).length : 0;
  $('#write-n').textContent = n ? (n === 1 ? '1 idea' : `${n} ideas`) : '';
  $('#write-go').disabled = !v;
}

// =====================================================================
// 13 · AVISOS (notificaciones de Posso)
// =====================================================================
async function activarAvisos() {
  if (!S.cfg) { toast('Primero conecta tu Google en Ajustes.'); return false; }
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    toast(standalone() ? 'Este iPhone no permite avisos web. Necesitas iOS 16.4 o más.' : 'Abre Posso desde el icono de tu pantalla de inicio para activar los avisos.');
    return false;
  }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Sin permiso para avisar. Puedes darlo en Ajustes del iPhone › Notificaciones › Posso.'); return false; }
    const reg = await navigator.serviceWorker.ready;
    const { clave } = await api('clavePush');
    const k = Uint8Array.from(atob(clave.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((clave.length + 3) % 4)), c => c.charCodeAt(0));
    let sub = await reg.pushManager.getSubscription();
    if (sub) { try { await sub.unsubscribe(); } catch (e) {} }
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: k });
    await api('suscribir', { suscripcion: sub.toJSON() });
    await cfgParaSW();
    S.local.push = true; persist();
    toast('Avisos activados.');
    return true;
  } catch (e) {
    toast('No he podido activar los avisos: ' + (e.message || e));
    return false;
  }
}

// =====================================================================
// 14 · AVISO FLOTANTE
// =====================================================================
let toastT = 0;
function toast(texto, boton, accion) {
  const t = $('#toast'), b = $('#toast-b');
  $('#toast-t').textContent = texto;
  b.hidden = !boton; b.textContent = boton || '';
  b.onclick = () => { t.classList.remove('on'); accion && accion(); };
  t.classList.add('on'); clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('on'), boton ? 4000 : 2800);
}

// =====================================================================
// 15 · TOQUES
// =====================================================================
const ACT = {
  ajustes: () => ir('s-aj', 'push'),
  atras: () => atras(),
  'ir-inicio': () => irInicio(),
  hablar: () => empezarVoz(),
  escribir: () => abrirEscribir(),
  cosas: () => abrirCosas(),
  'cerrar-cosas': () => cerrarHoja('sh-cosas'),
  'abrir-cat': el => { S.cat = el.dataset.cat; H.lista.fut = []; ir('s-list', 'push'); },
  cat: el => cambiarCat(el.dataset.cat),
  hecho: el => marcarHecho(el.dataset.id, el),
  editar: el => abrirIdea({ tipo: 'guardada', id: el.dataset.id }),
  'editar-borrador': el => abrirIdea({ tipo: 'borrador', k: +el.dataset.k }),
  'cerrar-idea': () => cerrarIdea(),
  'idea-cat': el => cambiarIdea({ cat: el.dataset.v }),
  'idea-carpeta': el => { const i = ideaActual(); cambiarIdea({ carpeta: i.carpeta === el.dataset.v ? '' : el.dataset.v }); },
  'idea-urgente': () => cambiarIdea({ urgente: !ideaActual().urgente }),
  'idea-recordar': () => abrirRecordar(),
  'idea-quitar': () => {
    const r = S.idea;
    if (r.tipo === 'guardada') { cerrarHoja('sh-idea'); S.idea = null; hacer(OP.quitar(r.id)); pintarTodo(true); toast('Borrado', 'Deshacer', () => deshacer('lista')); }
    else { borradorPaso(); S.borrador.ideas.splice(r.k, 1); cerrarHoja('sh-idea'); S.idea = null;
      if (!S.borrador.ideas.length) { S.borrador = null; irInicio(); } else pintarResultado(); }
  },
  'rec-sel': el => { recSel = el.dataset.v || null; vib(); pintarRecordar(); },
  'rec-ok': () => confirmarRecordar(),
  deshacer: el => deshacer(el.dataset.cual),
  rehacer: el => rehacer(el.dataset.cual),
  'voz-gema': () => { if (V.activa) terminarVoz(); else empezarVoz(); },
  'voz-listo': () => { if (V.activa) terminarVoz(); },
  'cancelar-voz': () => cancelarVoz(),
  'voz-a-texto': () => vozATexto(),
  'ordenar-texto': () => { const t = $('#writebox').value.trim(); if (t) { $('#writebox').blur(); procesar({ texto: t }); } },
  'error-escribir': () => abrirEscribir((S.entrada && (S.entrada.texto || S.entrada.textoVivo)) || ''),
  reintentar: () => { if (S.entrada) procesar(S.entrada); else irInicio(); },
  guardar: () => guardarBorrador(),
  descartar: () => { S.borrador = null; S.entrada = null; irInicio(); toast('Descartado.'); },
  tema: el => { S.local.tema = el.dataset.v; persist(); aplicarTema(true); pintarAjustes(); },
  'carpetas-on': () => { S.local.carpetasOn = !S.local.carpetasOn; persist(); pintarAjustes(); pintarPermisos(); },
  carpeta: el => {
    const k = +el.dataset.k, viejo = S.carpetas[k];
    const nuevo = prompt(`Cambia el nombre de «${viejo}».\nDéjalo vacío para quitar la carpeta.`, viejo);
    if (nuevo === null) return;
    const n = nuevo.trim();
    if (n) S.carpetas[k] = n; else S.carpetas.splice(k, 1);
    S.ideas.forEach(i => { if (i.carpeta === viejo) { const c = { carpeta: n }; Object.assign(i, c); encolar({ accion: 'actualizar', id: i.id, cambios: c }); } });
    persist(); if (S.cfg) encolar({ accion: 'carpetas', carpetas: S.carpetas }); pintarAjustes();
  },
  'nueva-carpeta': el => {
    const n = (prompt('Nombre de la nueva carpeta') || '').trim();
    if (!n || S.carpetas.includes(n)) return;
    S.carpetas.push(n); persist(); if (S.cfg) encolar({ accion: 'carpetas', carpetas: S.carpetas });
    if (el.dataset.desde === 'idea') cambiarIdea({ carpeta: n }); else pintarAjustes();
  },
  push: async () => { await activarAvisos(); pintarAjustes(); },
  'probar-aviso': async () => { try { await api('probarAviso'); toast('Enviado. Te llegará en unos segundos.'); } catch (e) { toast('No ha salido: ' + e.message); } },
  'aviso-suave': () => guardarAjustes({ avisoSuaveDias: S.ajustes.avisoSuaveDias > 0 ? 0 : 3 }),
  'alarma-cal': () => guardarAjustes({ alarmaCalendario: !S.ajustes.alarmaCalendario }),
  vivo: () => { S.local.vivo = !S.local.vivo; persist(); pintarAjustes(); },
  cuenta: async () => {
    if (S.cfg) {
      if (confirm('¿Desconectar Posso de tu Google en este iPhone? Tus cosas siguen en tu Drive.')) { S.cfg = null; S.ideas = []; S.outbox = []; persist(); cfgParaSW(); pintarAjustes(); }
      return;
    }
    const c = prompt('Pega tu código de conexión');
    if (c && await conectarCon(c)) { toast('Conectado.'); pintarAjustes(); } else if (c) toast('No he podido conectar. Revisa el código.');
  },
  // bienvenida
  'onb-next': async () => {
    if (paso === 2) {
      const ok = await conectarCon($('#onb-code').value, $('#onb-code-msg'));
      if (ok) { pintarPermisos(); mostrarPaso(3); }
      return;
    }
    if (paso < 3) return mostrarPaso(paso + 1);
    S.local.onboarded = true; persist(); irInicio('drop');
  },
  'onb-demo': () => {
    S.cfg = null;
    if (!S.local.demoSembrado) sembrarDemo();
    pintarPermisos(); mostrarPaso(3);
  },
  'pegar-codigo': async () => {
    try { $('#onb-code').value = (await navigator.clipboard.readText()).trim(); } catch (e) { $('#onb-code').focus(); }
  },
  'perm-mic': async () => {
    try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach(t => t.stop()); S.local.micOk = true; }
    catch (e) { toast('Sin micrófono. Siempre puedes escribir.'); }
    persist(); pintarPermisos();
  },
  'perm-avisos': async () => { await activarAvisos(); pintarPermisos(); }
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.closest('[disabled]') || arrastrando) return;
  const f = ACT[el.dataset.act]; if (f) f(el, e);
});
$('#writebox').addEventListener('input', contarIdeas);

// la gema se hunde un poco al tocarla
document.addEventListener('pointerdown', e => { const g = e.target.closest('.gem.tap'); if (g) g.classList.add('press'); });
['pointerup', 'pointercancel', 'pointerleave'].forEach(t => document.addEventListener(t, () => $$('.gem.press').forEach(g => g.classList.remove('press'))));

// ---------- gestos: deslizar filas, cambiar de categoría, arrastrar hojas, subir en inicio ----------
let arrastrando = false;
(function gestos() {
  let g = null;
  document.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    const drag = e.target.closest('[data-drag]');
    const front = e.target.closest('#s-list .task .front');
    const cat = !front && e.target.closest('#s-list [data-swipecat]');
    const home = !drag && actual && actual.id === 's-home' && !$('#sh-cosas').classList.contains('on') && !e.target.closest('.gem,.kbd,.ajustes-btn');
    if (!drag && !front && !cat && !home) return;
    g = { x: e.clientX, y: e.clientY, dx: 0, dy: 0, eje: null, drag, front, cat, home, t: Date.now() };
  }, { passive: true });
  document.addEventListener('pointermove', e => {
    if (!g) return;
    g.dx = e.clientX - g.x; g.dy = e.clientY - g.y;
    if (!g.eje && Math.hypot(g.dx, g.dy) > 8) g.eje = Math.abs(g.dx) > Math.abs(g.dy) ? 'x' : 'y';
    if (g.drag && g.eje === 'y') {
      const sh = $('#' + g.drag.dataset.drag); sh.classList.add('drag');
      sh.style.transform = `translateY(${Math.max(0, g.dy)}px)`; arrastrando = true;
    }
    if (g.front && g.eje === 'x') {
      const olv = g.front.parentElement.classList.contains('olv');
      const dx = olv ? g.dx : Math.min(0, g.dx);
      g.front.style.transform = `translateX(${dx}px)`; arrastrando = true;
      const del = g.front.parentElement.querySelector('.under.del'), go = g.front.parentElement.querySelector('.under.go');
      if (del) del.style.opacity = dx < 0 ? 1 : 0;
      if (go) go.style.opacity = dx > 0 ? 1 : 0;
    }
  }, { passive: true });
  const fin = () => {
    if (!g) return;
    const { dx, dy, eje } = g, rapido = Date.now() - g.t < 300;
    if (g.drag) {
      const sh = $('#' + g.drag.dataset.drag); sh.classList.remove('drag'); sh.style.transform = '';
      if (eje === 'y' && (dy > 110 || (rapido && dy > 40))) g.drag.dataset.drag === 'sh-idea' ? cerrarIdea() : cerrarHoja('sh-cosas');
    }
    if (g.front && eje === 'x') {
      const task = g.front.parentElement, id = task.dataset.id;
      g.front.classList.add('snap');
      if (dx < -90) { g.front.style.transform = 'translateX(-110%)'; vib(); borrarFila(task, id); }
      else if (dx > 90 && task.classList.contains('olv')) { g.front.style.transform = 'translateX(110%)'; vib(); soltarOlvidar(task, id); }
      else { g.front.style.transform = ''; setTimeout(() => task.querySelectorAll('.under').forEach(u => u.style.opacity = 0), 300); }
    }
    if (g.cat && eje === 'x' && Math.abs(dx) > 60) {
      const k = CATS.indexOf(S.cat) + (dx < 0 ? 1 : -1);
      if (k >= 0 && k < CATS.length) cambiarCat(CATS[k], dx < 0 ? 1 : -1);
    }
    if (g.home && eje === 'y' && dy < -60) abrirCosas();
    g = null;
    setTimeout(() => arrastrando = false, 30);
  };
  document.addEventListener('pointerup', fin);
  document.addEventListener('pointercancel', fin);
})();

// =====================================================================
// 16 · DATOS DE EJEMPLO (solo en modo prueba)
// =====================================================================
function sembrarDemo() {
  const a = Date.now(), d = n => { const x = new Date(); x.setDate(x.getDate() + ((n - x.getDay() + 7) % 7 || 7)); return x; };
  const at = (x, h, m = 0) => { x.setHours(h, m, 0, 0); return isoLocal(x); };
  const I = (titulo, cat, extra = {}, edad = 0) => Object.assign({ id: uid(), titulo, frase: '', cat, carpeta: '', urgente: false, aviso: '', hecho: false, hechoEn: 0, creado: a - edad * DIA_MS, orden: a - edad * DIA_MS }, extra);
  S.ideas = [
    I('Contestar a las familias de 2ºD', 'hoy', { urgente: true, carpeta: 'Instituto' }),
    I('Preparar la evaluación', 'hoy', { carpeta: 'Instituto', aviso: at(d(5), 9) }),
    I('Regalo de cumpleaños para la ama', 'semana', { carpeta: 'Familia', aviso: at(d(1), 9) }),
    I('Ordenar papeles del piso', 'semana', { carpeta: 'Casa', aviso: at(d(6), 10) }),
    I('Escapada a Biarritz', 'algun', {}, 14),
    I('Aprender a tocar el piano', 'algun', {}, 31),
    I('Lo que dijo aquel compañero', 'olvidar', {}, 2)
  ];
  S.local.demoSembrado = true; persist();
}

// =====================================================================
// 17 · ARRANQUE
// =====================================================================
async function arrancar() {
  pintarGemas(); pintarUR();
  // ¿viene un código de conexión en el enlace? (#c=...)
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get('c')) {
    const cfg = leerCodigo(hash.get('c'));
    if (cfg && (!S.cfg || S.cfg.key !== cfg.key || S.cfg.url !== cfg.url)) {
      if (!S.cfg) { S.ideas = []; S.outbox = []; }
      S.cfg = cfg; S.local.onboarded = true; persist(); cfgParaSW();
    }
    history.replaceState(null, '', location.pathname + location.search);
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => S.local.tema === 'auto' && aplicarTema(true));
  aplicarTema(false);

  const abrir = new URLSearchParams(location.search).get('abrir');
  if (!S.local.onboarded && !abrir) {
    pintarBienvenida(); ir('s-onb', 'fade', { sinPila: true }); mostrarPaso(0);
  } else {
    if (!S.local.onboarded) { S.local.onboarded = true; persist(); }
    if (CATS.includes(abrir)) { S.cat = abrir; actual = null; ir('s-home', 'fade', { sinPila: true }); ir('s-list', 'push'); }
    else if (abrir === 'hablar') { ir('s-home', 'fade', { sinPila: true }); empezarVoz(); }
    else if (abrir === 'cosas') { ir('s-home', 'fade', { sinPila: true }); setTimeout(abrirCosas, 300); }
    else { ir('s-home', 'fade', { sinPila: true }); animarGema($('#home-gem'), 'drop'); }
    if (abrir) history.replaceState(null, '', location.pathname);
  }
  if (S.cfg) { cfgParaSW(); sincronizar(true); if (!abrir) destinoDelWidget(); }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { destinoDelWidget(); if (S.cfg) sincronizar(true); pintarTodo(true); }
  });
  window.addEventListener('online', () => programarSync(100));
  // un aviso pulsado con la app abierta
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', e => {
    if (e.data && e.data.abrir) abrirDesdeAviso(e.data.abrir);
  });
}
function abrirDesdeAviso(a) {
  if (CATS.includes(a)) { S.cat = a; pila.length = 0; ir('s-home', 'fade', { sinPila: true }); ir('s-list', 'push'); }
  else if (a === 'hablar') { pila.length = 0; ir('s-home', 'fade', { sinPila: true }); empezarVoz(); }
  else if (a === 'cosas') { irInicio(); setTimeout(abrirCosas, 300); }
  else if (a === 'inicio') { irInicio('drop'); }
}
// Si la app se abre desde el widget, el widget ha dejado dicho en tu Google a qué pestaña ir
let mirandoDestino = false;
async function destinoDelWidget() {
  if (!S.cfg || mirandoDestino || !S.local.onboarded) return;
  if (V.activa) return;
  mirandoDestino = true;
  try { const r = await api('destino'); if (r.abrir) abrirDesdeAviso(r.abrir); } catch (e) {}
  mirandoDestino = false;
}
arrancar();
