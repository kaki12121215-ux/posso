/* POSSO · la app
 * Todo en un archivo: datos, conexión con tu Google (Apps Script), voz, pantallas y animaciones.
 */
'use strict';

// =====================================================================
// 1 · CONSTANTES
// =====================================================================
const CATS = ['hoy', 'semana', 'algun', 'olvidar'];
const NOMBRE = { hoy: 'Hoy', semana: 'Esta semana', algun: 'Algún día', olvidar: 'Olvidar' };
const POP = { id: null, fila: null };                    // menú de pulsación larga
const SEL = { on: false, donde: '', ids: new Set() };   // modo Editar (varias a la vez)
const SUB = {
  hoy: 'Con esto, el día está cubierto.',
  semana: 'Te aviso de cada cosa el día que toca.',
  algun: 'Sin prisa. Te las recuerdo de vez en cuando.',
  olvidar: 'Lo has dicho y ya no pesa. Se borra solo.'
};
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIA_MS = 864e5;
const VERSION = '2.1.3';
// Esta copia de Posso es la versión:
//   'directo' = «Con texto en directo»: el dictado del iPhone escribe mientras hablas (más rápida; suena el micro de Apple)
//   'audio'   = «Sin dictado»: solo graba el audio y Gemini lo transcribe (sin sonido; unos segundos más lenta)
const VARIANTE = 'directo';
const NOMBRE_VARIANTE = VARIANTE === 'audio' ? 'Sin dictado' : 'Con texto en directo';

/* Siguiente fecha de una tarea que se repite (el mismo código que en Apps Script) */
function siguienteRepeticion(r, desde, incluir) {
  const p = s => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +(s.slice(11, 13) || 9), +(s.slice(14, 16) || 0)));
  const iso = d => d.toISOString().slice(0, 16);
  const hora = (r.hora || '09:00').split(':').map(Number);
  const base = p(desde);
  const conHora = d => { const x = new Date(d); x.setUTCHours(hora[0], hora[1], 0, 0); return x; };
  const vale = d => incluir ? d >= base : d > base;
  const dow = d => ((d.getUTCDay() + 6) % 7) + 1;   // 1 = lunes … 7 = domingo
  let d = conHora(base);
  if (r.tipo === 'cadaN') {
    const n = Math.max(1, r.n || 1);
    while (!vale(d)) d = new Date(d.getTime() + n * 864e5);
    return iso(d);
  }
  if (r.tipo === 'mensualDia' || r.tipo === 'mensualOrdinal') {
    for (let k = 0; k < 14; k++) {
      const y = base.getUTCFullYear(), m = base.getUTCMonth() + k;
      let c;
      if (r.tipo === 'mensualDia') {
        const ult = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
        c = new Date(Date.UTC(y, m, Math.min(r.dia || 1, ult)));
      } else {
        const ds = r.diaSemana || 1, ord = r.ordinal || 1;
        if (ord > 0) {
          c = new Date(Date.UTC(y, m, 1));
          while (dow(c) !== ds) c = new Date(c.getTime() + 864e5);
          c = new Date(c.getTime() + (ord - 1) * 7 * 864e5);
        } else {
          c = new Date(Date.UTC(y, m + 1, 0));
          while (dow(c) !== ds) c = new Date(c.getTime() - 864e5);
        }
      }
      c = conHora(c);
      if (vale(c)) return iso(c);
    }
    return iso(d);
  }
  const dias = r.tipo === 'laborables' ? [1, 2, 3, 4, 5] : r.tipo === 'semanal' ? (r.dias && r.dias.length ? r.dias : [dow(base)]) : [1, 2, 3, 4, 5, 6, 7];
  for (let k = 0; k < 15; k++) {
    if (dias.indexOf(dow(d)) >= 0 && vale(d)) return iso(d);
    d = new Date(d.getTime() + 864e5);
  }
  return iso(d);
}


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
const deIso = s => {
  s = String(s || '');
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) { const [d, t] = s.split('T'); const [Y, M, D] = d.split('-').map(Number); const [h, m] = (t || '09:00').split(':').map(Number); return new Date(Y, M - 1, D, h || 0, m || 0); }
  const x = new Date(s); return isNaN(x) ? new Date() : x;      // por si llega una fecha en otro formato
};
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
  local: load('local', { tema: 'auto', onboarded: false, carpetasOn: true, demoSembrado: false }),
  habituales: load('habituales', []),            // compra de siempre
  outbox: load('outbox', []),
  cat: 'hoy',                                   // categoría abierta
  borrador: null,                               // resultado aún sin guardar
  entrada: null,                                // lo último que se mandó a ordenar ({audio,mime} | {texto})
  idea: null                                    // idea abierta en la hoja
};
function persist() {
  save('ideas', S.ideas); save('carpetas', S.carpetas); save('ajustes', S.ajustes);
  save('local', S.local); save('outbox', S.outbox); save('cfg', S.cfg); save('habituales', S.habituales);
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

// Barra fina de colores arriba mientras se espera a tu Google (solo si tarda más de 0,4 s)
let cargando = 0, cargaT = 0;
function carga(d) {
  cargando = Math.max(0, cargando + d);
  const el = $('#carga'); if (!el) return;
  clearTimeout(cargaT);
  if (cargando) cargaT = setTimeout(() => el.classList.add('on'), 400);
  else el.classList.remove('on');
}
async function api(accion, datos = {}, espera = 30000) {
  if (!S.cfg) throw new Error('sin-conexion');
  const visible = !['pendientes', 'destino', 'listar', 'actualizar', 'marcarItem', 'borrar', 'restaurar', 'guardar', 'habituales', 'ajustes', 'carpetas'].includes(accion);
  if (visible) carga(1);
  try { return await apiYa(accion, datos, espera); } finally { if (visible) carga(-1); }
}
async function apiYa(accion, datos, espera) {
  const ctl = window.AbortController ? new AbortController() : null;
  const t = setTimeout(() => ctl && ctl.abort(), espera);
  let r;
  try {
    r = await fetch(S.cfg.url, { method: 'POST', body: JSON.stringify(Object.assign({}, datos, { accion, key: S.cfg.key })), signal: ctl ? ctl.signal : undefined });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'Tu Google está tardando demasiado en responder. Prueba otra vez en un momento.' : (e.message || 'Load failed'));
  } finally { clearTimeout(t); }
  const txt = await r.text();
  let j;
  try { j = JSON.parse(txt); }
  catch (e) {     // Google ha devuelto una página en vez de datos
    const titulo = ((txt.match(/<title>([^<]*)/i) || [])[1] || '').trim();
    console.log('Posso · respuesta rara de Google', r.status, txt.slice(0, 600));
    if (/autoriz|authoriz|accounts\.google|iniciar sesi|sign in/i.test(txt)) throw new Error('Tu Google pide permisos otra vez. Abre el script, ejecuta probarGemini y acepta.');
    throw new Error('Google ha dado un error' + (titulo ? ' (' + titulo + ')' : r.status ? ' (' + r.status + ')' : '') + '. Mira Ejecuciones en tu script.');
  }
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
        const prov = S.ideas.filter(i => i.provisional);
        const cambia = JSON.stringify(r.ideas) !== JSON.stringify(S.ideas.filter(i => !i.provisional));
        S.ideas = r.ideas.concat(prov); S.carpetas = r.carpetas; S.ajustes = Object.assign(S.ajustes, r.ajustes);
        if (r.habituales) S.habituales = r.habituales;
        persist();
        if (cambia) {
          pintarTodo(true);
          if ($('#sh-idea').classList.contains('on') && S.idea && S.idea.tipo === 'guardada') pintarSubEnHoja();
          if (actual && actual.id === 's-home') tarjetaOlvidar(false);
        }
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
  if ((i.cat === 'semana' || (i.cat === 'algun' && i.repetir)) && i.aviso && i.aviso.slice(0, 10) <= hoyIso()) return 'hoy';
  return i.cat;
}
function vivas() {
  const ahora = Date.now();
  return S.ideas.filter(i => {
    if (i.hecho && ahora - (i.hechoEn || 0) > 2 * DIA_MS) return false;   // lo de antes está en «Hecho recientemente»
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
  if (!aviso || isNaN(deIso(aviso))) return '';
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
function quedan(i) {
  const d = 7 - Math.floor((Date.now() - (i.pospuesto || i.creado)) / DIA_MS);
  return d <= 0 ? 'Te pregunto si lo borramos' : d === 1 ? 'Mañana te pregunto si lo borramos' : `En ${d} días te pregunto si lo borramos`;
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
  if (i.repetir && !i.hecho) partes.push(`<span class="mtxt rep">${ICO2.rep}${esc(textoRepetir(i.repetir))}</span>`);
  if (i.limite && !i.hecho) partes.push(`<span class="mtxt">Entrega ${esc(fechaDia(i.limite))}</span>`);
  if (i.sumarA && modo === 'borrador') partes.push('<span class="mtxt">Se suma a tu lista</span>');
  if (i.carpetaNueva && modo === 'borrador' && !i.carpeta) partes.push(`<button class="chip nueva" data-act="crear-carpeta" data-c="${esc(i.carpetaNueva)}">${ICO.folder}¿Carpeta nueva: ${esc(i.carpetaNueva)}?</button>`);
  if (modo === 'borrador') {
    if (i.aviso && !i.repetir && !i.limite) txt = 'te aviso ' + fechaCorta(i.aviso, true);
    else if (i.cat === 'olvidar') txt = 'en 7 días te pregunto si lo borramos';
  } else if (i.hecho) {
    txt = '';
  } else if (i.cat === 'olvidar') txt = quedan(i);
  else if (i.aviso && !i.repetir && !i.limite) txt = fechaCorta(i.aviso);
  else if (i.cat === 'algun' && modo === 'lista' && !i.repetir) txt = hace(i.creado);
  if (txt) partes.push(`<span class="mtxt">${esc(cap(txt))}</span>`);
  if (modo === 'lista' && !i.hecho) {
    if (i.origen === 'correo') partes.push('<span class="mtxt">Del correo</span>');
    if ((i.contactos || []).some(c => c.opciones && c.opciones.length)) partes.push(`<span class="mini-ic">${ICO2.phone}</span>`);
    if (i.lugar) partes.push(`<span class="mini-ic">${ICO2.pin}</span>`);
  }
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
// Regla: nada aparece ni desaparece de golpe.
//  - push / back: la pantalla entra de lado
//  - fade: fundido con un ligero desplazamiento hacia arriba
//  - hoja (escribir, ajustes, recordar): sube desde abajo con un pequeño rebote; lo de detrás se oscurece
//  - none: sin animación (lo usa la tarjeta que crece)
const HOJAS = ['s-type', 's-aj', 's-rec', 's-hecho', 's-per'];
let actual = null;
const pila = [];                                  // [{ id, hoja }]
const ANIM_MS = 420;

function ir(id, modo = 'push', { sinPila = false } = {}) {
  const nueva = $('#' + id); if (!nueva || actual === nueva) return;
  const vieja = actual;
  if (modo === 'push' && HOJAS.includes(id)) modo = 'hoja';
  if (reduceMotion() && modo !== 'none') modo = 'fade';
  if (vieja && !sinPila && (modo === 'push' || modo === 'hoja')) pila.push({ id: vieja.id, hoja: modo === 'hoja' });
  salirSel(); cerrarPop();
  cerrarHoja('sh-cosas', modo === 'none'); cerrarHoja('sh-idea', modo === 'none');
  $('#toast').classList.remove('on');

  // si salimos de una hoja hacia otra cosa (p. ej. escribir → ordenando), lo de debajo se va también
  if (modo !== 'hoja' && modo !== 'back') $$('.screen.debajo').forEach(s => { if (s !== nueva) { s.className = 'screen'; } });
  if (modo !== 'hoja') $('#scrim-scr').classList.remove('on');

  if (vieja) {
    if (modo === 'hoja') vieja.className = 'screen on debajo';
    else if (modo === 'none') vieja.className = 'screen';
    else {
      vieja.className = 'screen out-' + modo + (vieja.classList.contains('hojascr') ? ' hojascr' : '');
      setTimeout(() => { if (vieja !== actual && !vieja.classList.contains('debajo')) vieja.className = 'screen'; }, 340);
    }
  }
  if (modo === 'hoja') {
    $('#scrim-scr').classList.add('on');
    nueva.className = 'screen on hojascr in-hoja';
    // si el contenido cabe, la hoja se puede bajar arrastrando desde cualquier sitio
    setTimeout(() => {
      const sc = nueva.querySelector('.scroll'), cabe = !sc || sc.scrollHeight <= sc.clientHeight + 2;
      nueva.style.touchAction = cabe ? 'none' : '';
    }, 60);
  } else {
    nueva.className = 'screen on' + (modo === 'none' ? '' : ' in-' + modo);
  }
  actual = nueva;
  setTimeout(() => { if (nueva === actual) nueva.className = 'screen on' + (modo === 'hoja' ? ' hojascr' : ''); }, ANIM_MS + 120);
  const pint = { 's-home': pintarInicio, 's-list': () => pintarLista(0), 's-aj': pintarAjustes, 's-res': pintarResultado, 's-hecho': pintarHechas, 's-per': pintarPersonas };
  pint[id] && pint[id]();
  pintarUR();
}

function atras(opc = {}) {
  const de = actual, paso = pila.pop() || { id: 's-home', hoja: false };
  if (de && de.id === 's-list' && S.desdeCajon && paso.id === 's-home') return volverACajon();
  if (paso.hoja && de && de.classList.contains('hojascr')) {
    // la hoja baja y lo de debajo se aclara
    const debajo = $('#' + paso.id);
    $('#scrim-scr').classList.remove('on');
    if (!opc.yaFuera) { de.className = 'screen on hojascr out-hoja'; }
    setTimeout(() => { if (de !== actual) de.className = 'screen'; de.style.transform = ''; de.style.transition = ''; }, 330);
    debajo.className = 'screen on';
    actual = debajo;
    const pint = { 's-home': () => { pintarInicio(); tarjetaOlvidar(false); }, 's-list': () => pintarLista(0, true), 's-aj': pintarAjustes, 's-res': pintarResultado, 's-hecho': pintarHechas };
    pint[debajo.id] && pint[debajo.id]();
    pintarUR();
    return;
  }
  ir(paso.id, 'back', { sinPila: true });
}
function irInicio(efecto) {
  pila.length = 0; S.desdeCajon = false;
  ir('s-home', 'fade', { sinPila: true });
  if (efecto) setTimeout(() => animarGema($('#home-gem'), efecto), 60);
}

// ---- tarjeta que crece hasta ocupar la pantalla (y se encoge al volver) ----
function rectEnApp(el) {
  const a = $('#app').getBoundingClientRect(), r = el.getBoundingClientRect();
  return { left: r.left - a.left, top: r.top - a.top, width: r.width, height: r.height };
}
function morph(desde, hasta, color, ms, radioDesde, radioHasta) {
  const m = document.createElement('div');
  m.className = 'morph';
  m.style.background = color;
  $('#app').appendChild(m);
  const f = r => ({ left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  const anim = m.animate([
    Object.assign(f(desde), { borderRadius: radioDesde + 'px' }),
    Object.assign(f(hasta), { borderRadius: radioHasta + 'px' })
  ], { duration: ms, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
  return { el: m, fin: anim.finished.catch(() => {}) };
}
async function abrirCajon(card) {
  const c = card.dataset.cat;
  S.cat = c; H.lista.fut = [];
  if (reduceMotion()) { S.desdeCajon = false; return ir('s-list', 'fade'); }
  vib();
  const a = $('#app'), pantalla = { left: 0, top: 0, width: a.clientWidth, height: a.clientHeight };
  const m = morph(rectEnApp(card), pantalla, `var(--k-${c})`, 380, 22, 0);
  card.style.visibility = 'hidden';
  await m.fin;
  card.style.visibility = '';
  S.desdeCajon = true;
  ir('s-list', 'none');
  pila.push({ id: 's-home', hoja: false });
  // la tarjeta se funde con la pantalla de la categoría
  const b = $('#list-body .pane'); if (b) b.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease' });
  m.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: 'ease', fill: 'forwards' }).finished.then(() => m.el.remove());
}
async function volverACajon() {
  S.desdeCajon = false;
  const c = S.cat, a = $('#app'), pantalla = { left: 0, top: 0, width: a.clientWidth, height: a.clientHeight };
  // tapa la lista con el color de la categoría, vuelve al inicio con la hoja abierta y encoge hacia su tarjeta
  const tapa = document.createElement('div'); tapa.className = 'morph';
  Object.assign(tapa.style, { left: 0, top: 0, width: pantalla.width + 'px', height: pantalla.height + 'px', background: `var(--k-${c})` });
  a.appendChild(tapa);
  await tapa.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, fill: 'forwards' }).finished.catch(() => {});
  ir('s-home', 'none', { sinPila: true });
  pintarCajones(false); abrirHoja('sh-cosas', true);
  const card = $(`#drawers .drawer[data-cat="${c}"]`);
  tapa.remove();
  if (!card) return;
  card.style.visibility = 'hidden';
  const m = morph(pantalla, rectEnApp(card), `var(--k-${c})`, 360, 0, 22);
  await m.fin;
  card.style.visibility = '';
  m.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }).finished.then(() => m.el.remove());
}

// ---- hojas que suben desde abajo ----
const scrimDe = id => id === 'sh-cosas' ? $('#scrim-cosas') : $('#scrim-idea');
function abrirHoja(id, instantanea) {
  const sh = $('#' + id), scrim = scrimDe(id);
  sh.style.transform = ''; scrim.style.opacity = '';
  if (instantanea) { sh.style.transition = 'none'; scrim.style.transition = 'none'; }
  scrim.classList.add('on'); sh.classList.add('on');
  if (instantanea) requestAnimationFrame(() => requestAnimationFrame(() => { sh.style.transition = ''; scrim.style.transition = ''; }));
}
function cerrarHoja(id, rapido) {
  const sh = $('#' + id); if (!sh || !sh.classList.contains('on')) return;
  if (id === 'sh-cosas' && SEL.donde === 'cosas') salirSel();
  const scrim = scrimDe(id);
  if (rapido) { sh.style.transition = 'none'; scrim.style.transition = 'none'; }
  sh.classList.remove('on', 'drag'); scrim.classList.remove('on');
  sh.style.transform = ''; scrim.style.opacity = '';
  if (rapido) requestAnimationFrame(() => requestAnimationFrame(() => { sh.style.transition = ''; scrim.style.transition = ''; }));
}

// ---- un texto que cambia lo hace con un pequeño fundido ----
function cambiaTexto(el, txt) {
  if (!el || el.textContent === txt) return;
  el.textContent = txt;
  if (!reduceMotion()) el.animate([{ opacity: 0, transform: 'translateY(5px)' }, { opacity: 1, transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' });
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
  const n = pendientes('hoy').length;
  const dark = document.documentElement.dataset.theme === 'dark';
  const usado = S.ideas.length > 0;
  cambiaTexto($('#home-q'), usado && n === 0 ? 'Por hoy, ya está.' : '¿Qué tienes en la cabeza?');
  cambiaTexto($('#home-hint'), dark && usado ? '¿Te ronda algo? Toca la gema' : 'Toca la gema y habla');
  cambiaTexto($('#home-today'), n ? `${n} para hoy` : 'Tus cosas');
}

// ---------- Tus cosas (las cuatro tarjetas) ----------
function pintarCajones(animar = true) {
  const vista = S.local.vistaCosas === 'carpetas' ? 'carpetas' : 'bloques';
  $$('#vista-tg button').forEach(b => b.classList.toggle('on', b.dataset.v === vista));
  const ed = $('#cosas-editar'); if (ed) { ed.hidden = vista !== 'carpetas'; const en = SEL.on && SEL.donde === 'cosas'; ed.textContent = en ? 'Listo' : 'Editar'; ed.dataset.act = en ? 'sel-off' : 'sel-on'; }
  $('#drawers').classList.toggle('carpetas', vista === 'carpetas');
  if (vista === 'carpetas') pintarCarpetas();
  else $('#drawers').innerHTML = CATS.map((c, k) => {
    const items = pendientes(c);
    const filas = items.slice(0, 2).map(i =>
      `<div class="row${c === 'olvidar' ? ' olv' : ''}">${check(c, false, 18)}<div style="min-width:0"><div class="t">${tituloHTML(i, true)}</div>${meta(i, 'cajon')}</div></div>`).join('');
    return `<button class="drawer" data-act="abrir-cat" data-cat="${c}" style="background:var(--k-${c});--i:${k}">
      <div class="drawer-h"><b>${NOMBRE[c]}</b><span style="color:var(--c-${c})">${items.length}</span></div>
      ${filas || `<div class="empty">${c === 'hoy' ? 'Nada para hoy.' : 'Vacío.'}</div>`}
      ${items.length > 2 ? `<div class="more">+${items.length - 2} más</div>` : ''}
      <span class="chev">${ICO.chev(`var(--c-${c})`)}</span></button>`;
  }).join('');
  const nh = S.ideas.filter(i => i.hecho && Date.now() - (i.hechoEn || 0) < 7 * DIA_MS).length;
  const fila = $('#hechas-fila');
  if (fila) { fila.hidden = !nh; fila.querySelector('span').textContent = `Hecho recientemente · ${nh}`; }
  const d = $('#drawers'); d.classList.remove('enter');
  if (animar) { void d.offsetWidth; d.classList.add('enter'); }
  marcarSel();
}
/** Vista por carpetas: cada carpeta con todo lo que tiene pendiente, en una sola pantalla */
function pintarCarpetas() {
  const todas = CATS.flatMap(c => pendientes(c));
  const nombres = S.carpetas.slice();
  todas.forEach(i => { if (i.carpeta && !nombres.includes(i.carpeta)) nombres.push(i.carpeta); });
  const grupos = nombres.map(n => ({ n, items: todas.filter(i => i.carpeta === n) }));
  const sin = todas.filter(i => !i.carpeta);
  if (sin.length) grupos.push({ n: '', items: sin });
  $('#drawers').innerHTML = grupos.map((g, k) => `
    <section class="carp" style="--i:${Math.min(k, 8)}">
      <div class="carp-h">${ICO.folderL}<b>${g.n ? esc(g.n) : 'Sin carpeta'}</b><span>${g.items.length || ''}</span></div>
      ${g.items.length ? g.items.map(i => {
        const c = catDe(i), f = i.aviso ? fechaCorta(i.aviso) : '';
        return `<div class="crow${i.provisional ? ' prov' : ''}" data-id="${i.id}" data-sel data-act="editar">
          <span class="selmk"></span>
          <button class="cck" data-act="hecho" data-id="${i.id}" aria-label="Hecho">${check(c, false, 20)}</button>
          <div class="cb"><div class="t">${tituloHTML(i, true)}</div>
            <div class="cm"><span style="color:var(--c-${c})">${NOMBRE[c]}</span>${f ? ` · ${esc(f)}` : ''}${i.urgente ? ' · <span class="u">Urgente</span>' : ''}${(i.items || []).length ? ` · ${i.items.filter(x => !x.hecho).length} dentro` : ''}</div></div>
        </div>`;
      }).join('') : `<div class="carp-vacia">Nada pendiente aquí.</div>`}
    </section>`).join('') || '<div class="carp-vacia" style="padding:30px 6px">Aún no tienes nada.</div>';
}
function abrirCosas() { pintarCajones(); abrirHoja('sh-cosas'); vib(); }

// ---------- Una categoría: el selector de arriba ----------
function pintarSwitcher() {
  const sw = $('#switcher');
  if (!sw.children.length) sw.innerHTML = CATS.map(c =>
    `<button data-act="cat" data-cat="${c}" style="background:var(--v-${c})" aria-label="${NOMBRE[c]}"></button>`).join('');
  ponSwitcher(CATS.indexOf(S.cat), true);
}
/** p puede ser decimal (durante el gesto): la pastilla se desplaza y se estira hacia el punto siguiente */
function ponSwitcher(p, animado) {
  const bs = $$('#switcher button');
  bs.forEach((b, i) => {
    const k = Math.max(0, 1 - Math.abs(p - i));
    b.style.transition = animado ? 'width .32s cubic-bezier(.2,.8,.2,1), height .32s cubic-bezier(.2,.8,.2,1)' : 'none';
    b.style.width = (8 + 14 * k) + 'px';
    b.style.height = (8 - 2 * k) + 'px';
    b.classList.toggle('on', k > .5);
  });
}

// ---------- Una categoría: la lista ----------
function paneHTML(c) {
  const todos = deCat(c);
  const grupos = [...new Set(todos.map(i => i.grupo).filter(Boolean))].sort();
  const filtro = grupos.includes(S.grupo) ? S.grupo : '';
  const items = filtro ? todos.filter(i => i.grupo === filtro) : todos, pend = items.filter(i => !i.hecho);
  const hoy = new Date();
  const lab = c === 'hoy' ? `Hoy · ${DIAS[hoy.getDay()]} ${hoy.getDate()}` : NOMBRE[c];
  const labCol = document.documentElement.dataset.theme === 'dark' ? `var(--c-${c})` : c === 'hoy' ? 'var(--deep)' : 'var(--ink2)';
  const vacio = !items.length;
  const head = `<div class="headcard" style="background:var(--k-${c})">
      ${pend.length ? `<button class="sel-btn hc" data-act="${SEL.on ? 'sel-off' : 'sel-on'}">${SEL.on ? 'Listo' : 'Editar'}</button>` : ''}
      <div class="lab" style="color:${labCol}">${lab}</div>
      <div class="n">${vacio ? (c === 'hoy' ? 'Nada para hoy.' : 'Nada por aquí.') : !pend.length ? 'Todo hecho.' : `${pend.length} ${pend.length === 1 ? 'cosa' : 'cosas'}`}</div>
      <div class="s">${vacio ? (c === 'hoy' ? 'Aprovecha.' : 'Cuando digas algo así, aparecerá aquí.') : !pend.length ? (c === 'hoy' ? 'Por hoy, ya está.' : 'No queda nada pendiente.') : SUB[c]}</div></div>`;
  const cuerpo = vacio
    ? `<div class="empty-state"><div class="gem" data-gem style="--s:min(200px,26vh);opacity:.9"></div><p>Si te ronda algo, toca la gema y cuéntamelo.</p></div>`
    : `<div class="items">${items.map(i => fila(i, c)).join('')}
      <div class="cheer">Una menos.</div>
      ${pend.length ? `<div class="list-note">Mantén pulsada una tarea para ver sus opciones, o toca Editar para elegir varias. Desliza a los lados para cambiar de categoría.</div>` : ''}</div>`;
  const chips = grupos.length ? `<div class="grupos">${['', ...grupos].map(g =>
    `<button class="csel${g === filtro ? ' on' : ''}" data-act="grupo" data-v="${esc(g)}">${g ? esc(g) : 'Todos'}</button>`).join('')}</div>` : '';
  return head + chips + `<div class="scroll">${cuerpo}</div>`;
}
function nuevoPane(c) {
  const p = document.createElement('div');
  p.className = 'pane'; p.dataset.cat = c; p.innerHTML = paneHTML(c);
  p.querySelectorAll('[data-gem]').forEach(pintarGema);
  return p;
}
const paneActual = () => $(`#list-body .pane[data-cat="${S.cat}"]`) || $('#list-body .pane');

function pintarLista(dir = 0, suave = false) {
  pintarSwitcher();
  if (suave && paneActual()) return refrescarLista();
  const body = $('#list-body');
  body.innerHTML = '';
  const p = nuevoPane(S.cat); body.appendChild(p); marcarSel();
  const it = p.querySelector('.items');
  if (it && !reduceMotion()) {
    [...it.children].forEach((e, k) => e.style.setProperty('--i', Math.min(k, 8)));
    it.classList.add('enter'); setTimeout(() => it.classList.remove('enter'), 1400);
  }
}
/** Actualiza la lista sin saltos: lo que se va se encoge, lo demás se recoloca, lo nuevo crece */
let refrescando = null;
function refrescarLista() {
  const pane = paneActual(); if (!pane) return;
  const nuevos = new Set(deCat(S.cat).map(i => i.id));
  const salen = [...pane.querySelectorAll('.task')].filter(e => !nuevos.has(e.dataset.id) && !e.classList.contains('collapse'));
  const hacerlo = () => {
    refrescando = null;
    const antes = {}; pane.querySelectorAll('.task').forEach(e => antes[e.dataset.id] = e.getBoundingClientRect().top);
    const nAntes = (pane.querySelector('.headcard .n') || {}).textContent;
    const sc = pane.querySelector('.scroll'), top = sc ? sc.scrollTop : 0;
    pane.innerHTML = paneHTML(S.cat);
    pane.querySelectorAll('[data-gem]').forEach(pintarGema);
    const sc2 = pane.querySelector('.scroll'); if (sc2) sc2.scrollTop = top;
    const n = pane.querySelector('.headcard .n');
    if (n && nAntes && n.textContent !== nAntes) { const t = n.textContent; n.textContent = nAntes; cambiaTexto(n, t); }
    flip(pane, antes);
    marcarSel();
  };
  if (salen.length && !reduceMotion()) {
    salen.forEach(encoger);
    clearTimeout(refrescando); refrescando = setTimeout(hacerlo, 300);
  } else hacerlo();
}
function encoger(e) {
  e.style.height = e.offsetHeight + 'px'; e.style.overflow = 'hidden';
  e.classList.add('collapse');
  requestAnimationFrame(() => { e.style.height = '0px'; });
}
function fila(i, c) {
  c = c || S.cat;
  const olv = i.cat === 'olvidar';
  return `<div class="task${i.hecho ? ' done' : ''}${olv ? ' olv' : ''}${i.provisional ? ' prov' : ''}" data-id="${i.id}" data-sel>
    <div class="front"><span class="selmk"></span><button data-act="hecho" data-id="${i.id}" style="padding:0;align-self:flex-start" aria-label="Hecho">${check(olv ? 'olvidar' : c, i.hecho, 22)}</button>
    <div class="body" data-act="editar" data-id="${i.id}"><div class="t">${tituloHTML(i)}</div>${i.hecho ? '' : meta(i, 'lista')}
      ${(i.fotos || []).length && !i.hecho ? `<div class="thumbs sm">${i.fotos.map(f => `<span class="thumb" style="background-image:url(${f.mini})"></span>`).join('')}</div>` : ''}</div></div>
    ${(i.items || []).length && !i.hecho ? `<div class="subs">${subHTML(i, false)}</div>` : ''}</div>`;
}

// animación FLIP: las filas se recolocan con suavidad y las nuevas crecen
function flip(cont, antes) {
  if (reduceMotion()) return;
  cont.querySelectorAll('.task').forEach(e => {
    const a = antes[e.dataset.id];
    if (a == null) {
      const h = e.offsetHeight;
      e.animate([{ height: '0px', opacity: 0, transform: 'scale(.97)' }, { height: h + 'px', opacity: 1, transform: 'none' }],
        { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' });
      return;
    }
    const d = a - e.getBoundingClientRect().top; if (!d) return;
    e.animate([{ transform: `translateY(${d}px)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
  });
}

// ---------- pasar de una categoría a otra, como tarjetas ----------
let deslizando = false;
async function irACat(nueva, desdeDx = 0, vel = 0) {
  if (deslizando || SEL.on) return;
  cerrarPop();
  const k0 = CATS.indexOf(S.cat), k1 = CATS.indexOf(nueva);
  if (k1 === k0 || k1 < 0) return;
  const dir = k1 > k0 ? 1 : -1;
  const body = $('#list-body'), w = body.clientWidth;
  const cur = paneActual();
  let sig = body.querySelector(`.pane[data-cat="${nueva}"]`);
  if (!sig) { sig = nuevoPane(nueva); body.appendChild(sig); }
  body.querySelectorAll('.pane').forEach(p => { if (p !== cur && p !== sig) p.remove(); });
  deslizando = true; vib();
  const ms = reduceMotion() ? 200 : Math.max(200, Math.min(360, 360 - Math.abs(vel) * 80));
  if (reduceMotion()) {
    sig.style.transform = 'none'; sig.style.opacity = 0;
    await sig.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, fill: 'forwards' }).finished.catch(() => {});
  } else {
    const ease = 'cubic-bezier(.2,.8,.2,1)';
    const a1 = cur.animate([{ transform: `translateX(${desdeDx}px)` }, { transform: `translateX(${-dir * w}px)` }], { duration: ms, easing: ease, fill: 'forwards' });
    const a2 = sig.animate([{ transform: `translateX(${desdeDx + dir * w}px)` }, { transform: 'translateX(0)' }], { duration: ms, easing: ease, fill: 'forwards' });
    ponSwitcher(k1, true);
    await Promise.all([a1.finished, a2.finished]).catch(() => {});
  }
  S.cat = nueva;
  cur.remove();
  sig.getAnimations().forEach(a => a.cancel());
  sig.style.transform = ''; sig.style.opacity = '';
  ponSwitcher(k1, false);
  deslizando = false;
}
function cambiarCat(c) { irACat(c); }

// ---------- hecho, borrar, soltar ----------
function marcarHecho(id, btn) {
  const i = buscar(id); if (!i) return;
  if (i.cat === 'olvidar') return;               // lo de Olvidar no se "hace": se deja ir
  if (i.repetir && !i.hecho) {                    // vuelve sola la próxima vez
    const ck = btn.querySelector('.ck');
    if (ck) { ck.classList.add('done'); ck.classList.remove('pop'); void ck.offsetWidth; ck.classList.add('pop'); }
    vib();
    const sig = proximaVez(i);
    setTimeout(() => {
      hacer(OP.cambiar(id, { aviso: sig, hecho: false, items: (i.items || []).map(x => Object.assign({}, x, { hecho: false })) }));
      refrescarLista(); refrescarCosas();
      toast('Una menos. Vuelve ' + fechaCorta(sig, true).replace(/^(\D)/, m => m) + '.');
    }, 520);
    return;
  }
  const nuevo = !i.hecho;
  const ck = btn.querySelector('.ck');
  const crow = btn.closest('.crow'); if (crow && nuevo) setTimeout(() => encoger(crow), 380);
  if (ck) { ck.classList.toggle('done', nuevo); ck.classList.remove('pop'); void ck.offsetWidth; ck.classList.add('pop'); }
  const task = btn.closest('.task'); if (task) task.classList.toggle('done', nuevo);   // el tachado se dibuja poco a poco
  vib();
  setTimeout(() => {
    hacer(OP.cambiar(id, i.items && i.items.length ? { hecho: nuevo, items: i.items.map(x => Object.assign({}, x, { hecho: nuevo })) } : { hecho: nuevo }));
    refrescarLista(); refrescarCosas();
    if (nuevo) setTimeout(() => { const ch = paneActual() && paneActual().querySelector('.cheer'); if (ch) { ch.classList.add('on'); setTimeout(() => ch.classList.remove('on'), 2200); } }, 60);
  }, 520);
}
function refrescarCosas() { if ($('#sh-cosas').classList.contains('on')) pintarCajones(false); }
function borrarFila(el, id) {
  encoger(el);
  setTimeout(() => {
    hacer(OP.quitar(id)); refrescarLista(); refrescarCosas();
    toast('Borrado', 'Deshacer', () => deshacer('lista'));
  }, 300);
}
function soltarOlvidar(el, id) {   // de Olvidar a Hoy
  encoger(el);
  setTimeout(() => { hacer(OP.cambiar(id, { cat: 'hoy' })); refrescarLista(); refrescarCosas(); toast('Pasa a Hoy', 'Deshacer', () => deshacer('lista')); }, 300);
}

// ---------- Hoja de una idea (mover, carpeta, urgente, aviso) ----------
function abrirIdea(ref) {
  // ref: {tipo:'guardada', id} | {tipo:'borrador', k}
  S.idea = ref; pintarIdea(); const sh = $('#sh-idea'); sh.scrollTop = 0; abrirHoja('sh-idea'); vib();
  // si cabe entera, se puede arrastrar hacia abajo desde cualquier sitio
  requestAnimationFrame(() => { sh.style.touchAction = sh.scrollHeight <= sh.clientHeight + 2 ? 'none' : 'pan-y'; });
}
function ideaActual() {
  const r = S.idea; if (!r) return null;
  return r.tipo === 'guardada' ? buscar(r.id) : (S.borrador && S.borrador.ideas[r.k]);
}
function pintarIdea() {
  const i = ideaActual(); if (!i) return;
  const guardada = S.idea.tipo === 'guardada';
  const chips = (lista, sel, act) => lista.map(v =>
    `<button class="csel${v.val === sel ? ' on' : ''}" data-act="${act}" data-v="${esc(v.val)}">${esc(v.txt)}</button>`).join('');
  const conItems = i.tipo === 'lista' || i.tipo === 'receta' || (i.items || []).length;
  const orig = i.original;
  $('#sh-idea').innerHTML = `
    <div class="grab-zone"><div class="grab"></div></div>
    <div class="cap">${i.tipo === 'lista' ? 'Lista' : i.tipo === 'receta' ? 'Receta' : i.tipo === 'nota' ? 'Nota' : 'Idea'}${i.grupo ? ' · ' + esc(i.grupo) : ''}</div>
    <input class="idea-title" id="idea-title" value="${esc(i.tipo === 'lista' ? (i.clave || i.titulo) : i.titulo)}" maxlength="120">
    ${i.frase && i.origen !== 'correo' ? `<div class="idea-frase">«${esc(i.frase)}»</div>` : ''}
    ${i.tipo === 'nota' ? `<textarea class="nota-in" id="nota-in" rows="6">${esc(i.nota || '')}</textarea>` : ''}
    ${conItems ? `<div class="idea-sub" id="idea-sub"></div>` : ''}
    ${esCompra(i) && guardada ? `<div class="acts"><button class="actb" data-act="compartir-lista">${ICO2.share}Compartir por WhatsApp</button></div>` : ''}
    ${contactosHTML(i)}${mapsHTML(i)}
    ${i.enlace ? `<div class="acts"><a class="actb" href="${esc(i.enlace)}" target="_blank" rel="noopener">${ICO2.link}${i.tipo === 'receta' ? 'Ver la receta' : i.origen === 'correo' ? 'Abrir el correo' : 'Abrir el enlace'}</a></div>` : ''}
    ${orig ? `<details class="orig"><summary>Ver mensaje original</summary><div><b>${esc(orig.asunto || '')}</b>${orig.de ? `<small>${esc(orig.de)}${orig.cuenta ? ' · ' + esc(orig.cuenta) : ''}</small>` : orig.cuenta ? `<small>${esc(orig.cuenta)}</small>` : ''}${orig.texto ? `<p>${esc(orig.texto)}</p>` : '<p class="hint">Modo cuidado: aquí solo está el asunto. El correo completo está en Gmail.</p>'}</div></details>` : ''}
    <div class="cap" style="margin:20px 0 8px">¿Dónde va?</div>
    <div class="chips">${chips(CATS.map(c => ({ val: c, txt: NOMBRE[c] })), i.cat, 'idea-cat')}</div>
    ${S.local.carpetasOn ? `<div class="cap" style="margin:14px 0 8px">Carpeta</div>
    <div class="chips" id="idea-carpetas">${chips(S.carpetas.map(c => ({ val: c, txt: c })), i.carpeta, 'idea-carpeta')}<button class="csel" data-act="nueva-carpeta" data-desde="idea">+ Nueva</button></div>` : ''}
    <div id="idea-rep">${repetirHTML(i)}</div>
    <div style="margin-top:14px">
      <button class="srow" data-act="idea-urgente"><span style="display:flex;align-items:center;gap:8px"><span class="dot-urg" style="width:8px;height:8px"></span>Urgente</span><span class="sw urg${i.urgente ? ' on' : ''}" id="idea-urg"><i></i></span></button>
      <button class="srow" data-act="idea-recordar"><span>Recordármelo</span><span class="v" id="idea-rec">${i.aviso ? esc(cap(fechaCorta(i.aviso))) + ' ›' : 'No ›'}</span></button>
      ${i.limite ? `<label class="srow"><span>Fecha de entrega</span><span class="v">${esc(fechaDia(i.limite))} ›</span><input type="date" id="idea-limite" value="${esc(i.limite)}" class="oculto"></label>` : ''}
      ${guardada ? `<div class="srow"><span>Fotos</span></div><div id="idea-fotos">${fotosHTML(i, true)}</div>` : ''}
    </div>
    <div class="idea-foot"><button class="link big" style="padding-left:0" data-act="idea-quitar">Quitar</button><button class="pill" data-act="cerrar-idea">Hecho</button></div>`;
  if (conItems) pintarSubEnHoja();
  const nota = $('#nota-in'); if (nota) nota.addEventListener('change', () => cambiarIdea({ nota: nota.value }));
  const lim = $('#idea-limite'); if (lim) lim.addEventListener('change', () => { if (lim.value) { const d = deIso(lim.value + 'T09:00'); d.setDate(d.getDate() - 2); cambiarIdea({ limite: lim.value, aviso: isoLocal(d) }); pintarIdea(); } });
  const fi = $('#foto-in'); if (fi) fi.addEventListener('change', () => fi.files[0] && anadirFoto(fi.files[0]));
}
/** Los chips y el interruptor cambian en su sitio, con transición (nunca de golpe) */
function actualizarIdeaDOM() {
  const i = ideaActual(); if (!i) return;
  $$('#sh-idea [data-act="idea-cat"]').forEach(b => b.classList.toggle('on', b.dataset.v === i.cat));
  $$('#sh-idea [data-act="idea-carpeta"]').forEach(b => b.classList.toggle('on', b.dataset.v === i.carpeta));
  const u = $('#idea-urg'); if (u) u.classList.toggle('on', !!i.urgente);
  const rp = $('#idea-rep'); if (rp) rp.innerHTML = repetirHTML(i);
  cambiaTexto($('#idea-rec'), i.aviso ? cap(fechaCorta(i.aviso)) + ' ›' : 'No ›');
}
function cambiarIdea(cambios) {
  const r = S.idea, i = ideaActual(); if (!i) return;
  if (r.tipo === 'guardada') hacer(OP.cambiar(i.id, cambios));
  else { borradorPaso(); Object.assign(i, cambios); }
  vib(); actualizarIdeaDOM();
  if (r.tipo === 'borrador' && actual && actual.id === 's-res') pintarResultado();
}
function guardarTitulo() {
  const t = $('#idea-title');
  if (!t || !S.idea) return;
  const i = ideaActual(), v = t.value.trim();
  if (!i || !v) return;
  if (i.tipo === 'lista') { if (v !== (i.clave || i.titulo)) cambiarIdea({ clave: v, titulo: v }); }
  else if (v !== i.titulo) cambiarIdea({ titulo: v });
}
function cerrarIdea(rapido) {
  if (!rapido) guardarTitulo();
  cerrarHoja('sh-idea', rapido);
  if (!rapido) { S.idea = null; setTimeout(() => pintarTodo(true), 120); }
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
      ${tg('repaso', S.ajustes.repasoDomingo !== false, 'Repaso del domingo por la tarde')}
      ${S.cfg && S.local.push ? row('probar-aviso', 'Probar un aviso', '') : ''}
    </div>
    <div class="aj-note" style="padding:8px 32px 0">Las cosas con fecha se apuntan siempre en tu Google Calendar. Si dejas apagado lo de que suene, solo te avisa Posso y no te llegan dos avisos.</div>
    <div class="aj-h">Personas y alumnos</div>
    <div class="card">
      ${row('personas', 'Personas', 'Llamar y WhatsApp')}
      ${row('alumnos', 'Lista de alumnos', 'modo cuidado')}
    </div>
    <div class="aj-note" style="padding:8px 32px 0">Los teléfonos y los nombres de alumnos se quedan en tu hoja de Posso. Nunca se envían a Gemini.</div>
    <div class="aj-h">Cuentas de correo</div>
    <div class="card">
      ${tg('correo', S.ajustes.correoActivo !== false, 'Leer los correos con la etiqueta «Posso»')}
      ${row('puente', 'Otras cuentas (Posso puente)', 'cómo')}
    </div>
    <div class="aj-note" style="padding:8px 32px 0">Pon la etiqueta «Posso» a un correo y en unos minutos aparece como tarea, con un título claro y el enlace al correo.</div>
    <div class="aj-h">Voz y cuenta</div>
    <div class="card">
      ${tg('revisar', !S.local.sinRevisar, 'Ver el resultado antes de guardar')}
      <div class="aj-note" style="padding:2px 16px 12px">${!S.local.sinRevisar ? 'Al tocar el ✓ ves el resultado. Si guardas antes de que Gemini acabe, lo ordena después por su cuenta.' : 'Al tocar el ✓ se guarda al momento y Gemini lo ordena por detrás. Te aviso cuando esté.'}</div>
      <div class="arow"><span>Versión</span><span class="v">${VERSION} · ${NOMBRE_VARIANTE}</span></div>
      <div class="aj-note" style="padding:2px 16px 12px">${VARIANTE === 'audio' ? 'Solo se graba el audio y Gemini lo transcribe: sin sonido del micrófono, unos segundos más lenta.' : 'El dictado del iPhone escribe mientras hablas: más rápida, pero suena el micrófono de Apple al empezar y al acabar.'}</div>
      ${row('cuenta', 'Cuenta de Google', S.cfg ? 'conectada' : 'modo prueba')}
    </div>
    <div class="aj-foot">Posso ${VERSION} · ${NOMBRE_VARIANTE} · Lo que dices no se guarda como audio: solo el texto ordenado, en tu propio Google Drive.</div>`;
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
  ].map(([c, d, e], k) => `<div class="how" style="background:var(--k-${c});--i:${k}"><div class="how-h"><i style="background:var(--v-${c})"></i><b>${NOMBRE[c]}</b></div><p>${d} <q>${e}</q></p></div>`).join('');
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
  $('#listen-s').textContent = VARIANTE === 'audio' ? 'Dilo tal cual, sin orden. Cuando acabes, toca el tic.' : 'Dilo tal cual, sin orden. Ya lo ordeno yo.';
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
  if (VARIANTE === 'directo' && SR) {
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
  // Con texto en directo: si el iPhone ya ha escrito lo que has dicho, se manda el texto (mucho más rápido que el audio)
  if (VARIANTE === 'directo' && S.cfg && texto.split(/\s+/).length >= 3) return procesar({ texto, blob });
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
// Con texto: el resultado sale al momento (ordenado aquí mismo) y Gemini lo afina por detrás en pocos segundos
let afinadoN = 0;
async function procesarRapido(entrada) {
  S.entrada = entrada;
  const local = ordenarAqui(entrada.texto);
  if (!local.length) return procesarLento(entrada);
  const n = ++afinadoN;
  S.borrador = { ideas: local.map(i => Object.assign({ frase: '', carpeta: '', aviso: '', urgente: false }, i)), transcripcion: entrada.texto, provisional: true };
  H.borrador = { past: [], fut: [] };
  if (actual && actual.id === 's-res') pintarResultado(); else ir('s-res', 'fade', { sinPila: true });
  marcaAfinando('on');
  $('#res-cards').classList.add('provisional');
  try {
    const r = await api('procesar', { texto: entrada.texto }, 45000);
    const relevo = RELEVO[n];
    if (relevo) {            // ya habías guardado: ahora se ordena de verdad
      delete RELEVO[n];
      quitarProvisionales(relevo);
      const { op } = opDeIdeas(r.ideas && r.ideas.length ? r.ideas : relevo.provisionales.map(p => Object.assign({}, p)), 'voz');
      hacer(op); terminarFondo(relevo); pintarTodo(true);
      if (r.ideas && r.ideas.length) toast('Ordenado: ' + (resumen(r.ideas) || '').replace(/^./, c => c.toLowerCase()), 'Ver', () => abrirCosas());
      return;
    }
    const b = S.borrador;
    // solo se sustituye si sigues en el resultado y no has tocado nada
    console.log('Posso · Gemini ha devuelto', r.ideas && r.ideas.length, 'ideas', r);
    let cambiado = false;
    if (n === afinadoN && b && !H.borrador.past.length && r.ideas && r.ideas.length) {
      S.borrador = { ideas: r.ideas.map(i => Object.assign({ frase: '', carpeta: '', aviso: '', urgente: false }, i)), transcripcion: r.transcripcion };
      $('#res-cards').classList.remove('provisional');
      if (actual && actual.id === 's-res') pintarResultado();
      cambiado = true;
    }
    if (n === afinadoN) {
      if (cambiado) marcaAfinando('ok');
      else if (!r.ideas || !r.ideas.length) marcaAfinando('error', 'Gemini no ha devuelto nada');
      else marcaAfinando('off');      // habías cambiado algo a mano: se respeta lo tuyo
    }
  } catch (e) {
    const relevo = RELEVO[n];
    if (relevo) {            // Gemini no ha respondido: se queda lo que guardaste
      delete RELEVO[n];
      const quedan = relevo.provisionales.filter(p => buscar(p.id));
      quitarProvisionales(relevo);
      const { op } = opDeIdeas(quedan.map(p => Object.assign({}, p)), 'voz');
      hacer(op); terminarFondo(relevo); pintarTodo(true);
      toast('Gemini no ha respondido. Se queda como lo guardaste.');
      return;
    }
    if (n === afinadoN) marcaAfinando('error', String(e.message || e).replace(/^Error:\s*/, ''));
  }
  if (n === afinadoN) { $('#res-cards').classList.remove('provisional'); if (S.borrador) S.borrador.provisional = false; }
}
/** Aviso arriba en el resultado: on (con segundos), ok (afinado), error (con Reintentar), off */
let afinT = 0;
function marcaAfinando(estado, msg) {
  let el = $('#afinando');
  if (!el) { el = document.createElement('div'); el.id = 'afinando'; $('#s-res .res-top').prepend(el); }
  clearInterval(afinT);
  if (estado === 'on') {
    const t0 = Date.now();
    el.className = 'afin on';
    el.innerHTML = '<span class="afin-dots"><i></i><i></i><i></i><i></i></span><span id="afin-t">Afinando con Gemini…</span>';
    afinT = setInterval(() => {
      const s = Math.round((Date.now() - t0) / 1000), t = $('#afin-t');
      if (t && s >= 3) t.textContent = s < 15 ? `Afinando con Gemini · ${s} s` : `Sigue afinando · ${s} s`;
    }, 1000);
  } else if (estado === 'ok') {
    el.className = 'afin on ok';
    el.innerHTML = '<svg width="13" height="10" viewBox="0 0 13 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 5.2l3.3 3.3L11.5 1.8"/></svg>Afinado';
    setTimeout(() => el.classList.remove('on'), 1600);
  } else if (estado === 'error') {
    el.className = 'afin on err';
    el.innerHTML = `<span>Sin afinar${msg ? ' · ' + esc(/tardando|Load failed|fetch/i.test(msg) ? 'Gemini no ha respondido a tiempo' : msg.slice(0, 90)) : ''}</span><button data-act="reintentar">Reintentar</button>`;
  } else el.classList.remove('on');
}

async function procesar(entrada) {
  if (S.cfg && S.local.sinRevisar) return procesarFondo(entrada);    // opción: guardar ya sin ver el resultado
  if (S.cfg && entrada.texto) return procesarRapido(entrada);
  return procesarLento(entrada);
}
async function procesarLento(entrada) {
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
      if (entrada.imagen) { datos.imagen = entrada.imagen; datos.imagenMime = 'image/jpeg'; $('#proc-s').textContent = 'Leyendo la foto…'; }
      else if (entrada.texto) datos.texto = entrada.texto;
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
      if (!t) throw new Error(entrada.imagen ? 'Para leer fotos necesito tu Google conectado.' : 'En el modo prueba necesito ver el texto: escríbelo con el teclado.');
      r = { transcripcion: t, ideas: ordenarAqui(t) };
    }
    if (!r.ideas || !r.ideas.length) throw new Error('No he encontrado ninguna idea. ¿Lo intentamos otra vez?');
    $('#proc-s').textContent = r.ideas.length === 1 ? 'He encontrado 1 idea.' : `He encontrado ${r.ideas.length} ideas.`;
    await wait(Math.max(0, 700 - (Date.now() - t0)));
    S.borrador = { ideas: r.ideas.map(i => Object.assign({ frase: '', carpeta: '', aviso: '', urgente: false }, i)), transcripcion: r.transcripcion };
    H.borrador = { past: [], fut: [] };
    ir('s-res', 'fade', { sinPila: true });
  } catch (e) {
    if (actual && actual.id !== 's-proc') return;
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
  b.ideas.forEach(i => { if (!i._rid) i._rid = uid(); });
  const n = b.ideas.filter(i => i.cat === 'hoy').length;
  cambiaTexto($('#res-t'), n ? `Solo ${n} para hoy.` : 'Nada para hoy.');
  cambiaTexto($('#res-s'), (resumen(b.ideas) + ' ' + (b.ideas.length === 1 ? 'Tócala para moverla.' : 'Toca una idea para moverla.')).trim());
  const el = $('#res-cards');
  const primera = !b._pintado;
  const antes = {};
  if (!primera) el.querySelectorAll('[data-rid]').forEach(r => antes[r.dataset.rid] = r.getBoundingClientRect().top);
  const orden = (a, c) => (b.ideas[c].urgente - b.ideas[a].urgente) || (a - c);
  el.innerHTML = CATS.map(c => {
    const ks = b.ideas.map((i, k) => k).filter(k => b.ideas[k].cat === c).sort(orden);
    if (!ks.length) return '';
    return `<div class="rcard" style="background:var(--k-${c})"><div class="rcard-h"><b>${NOMBRE[c]}</b><span style="color:var(--c-${c})">${ks.length}</span></div>
      ${ks.map(k => { const i = b.ideas[k]; return `<div class="row${c === 'olvidar' ? ' olv' : ''}" data-act="editar-borrador" data-k="${k}" data-rid="${i._rid}">${check(c, false, 19)}<div style="min-width:0;flex:1"><div class="t">${tituloHTML(i)}</div>${meta(i, 'borrador')}${(i.items || []).length ? `<div class="subs prev">${i.items.slice(0, 8).map(x => `<div class="si"><span class="dotsub"></span><span class="st">${esc(x.t)}</span></div>`).join('')}${i.items.length > 8 ? `<div class="more">+${i.items.length - 8} más</div>` : ''}</div>` : ''}</div></div>`; }).join('')}</div>`;
  }).join('');
  [...el.children].forEach((e, k) => e.style.setProperty('--i', k));
  el.classList.remove('enter');
  if (primera) { b._pintado = true; void el.offsetWidth; el.classList.add('enter'); }
  else if (!reduceMotion()) {
    // la idea que cambia de sitio sale de su tarjeta y entra en la nueva; las demás se recolocan
    el.querySelectorAll('[data-rid]').forEach(r => {
      const a = antes[r.dataset.rid];
      if (a == null) { r.animate([{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' }); return; }
      const d = a - r.getBoundingClientRect().top;
      if (d) r.animate([{ transform: `translateY(${d}px)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
    });
  }
  pintarUR();
}
function borradorPaso() { H.borrador.past.push(JSON.stringify(S.borrador.ideas)); H.borrador.fut = []; }
function borradorUR(dir) {
  const h = H.borrador, de = dir < 0 ? h.past : h.fut, a = dir < 0 ? h.fut : h.past;
  if (!de.length) return;
  a.push(JSON.stringify(S.borrador.ideas)); S.borrador.ideas = JSON.parse(de.pop());
  vib(); pintarResultado();
}
/** Convierte ideas ordenadas en cambios: crea las nuevas y suma a las listas que ya tienes. Devuelve la operación (para deshacer). */
function opDeIdeas(ideas, origen) {
  const ahora = Date.now();
  const nuevas = [], ops = [];
  ideas.forEach((i, k) => {
    const destino = i.sumarA && buscar(i.sumarA);
    if (destino) {   // se suma a una lista que ya tienes
      const items = (destino.items || []).map(x => Object.assign({}, x));
      (i.items || []).forEach(n => {
        const p = n.reemplaza ? items.findIndex(x => x.id === n.reemplaza) : -1;
        if (p >= 0) items[p].t = n.t; else items.push({ id: n.id || uid(), t: n.t, hecho: false, zona: n.zona });
      });
      ops.push(OP.cambiar(destino.id, { items, hecho: false }));
      return;
    }
    const o = Object.assign({}, i, { id: uid(), creado: ahora + k, orden: ahora + k, hecho: false, hechoEn: 0, origen: i.origen || origen || 'voz' });
    delete o._rid; delete o.sumarA; delete o.provisional; delete o.carpetaNueva;
    if (o.items) o.items = o.items.map(x => ({ id: x.id || uid(), t: x.t, hecho: false, zona: x.zona }));
    nuevas.push(o);
  });
  if (nuevas.length) ops.push(OP.crear(nuevas));
  return { nuevas, op: { do: () => ops.forEach(o => o.do()), undo: () => ops.slice().reverse().forEach(o => o.undo()) } };
}
const RELEVO = {};      // guardados antes de que Gemini acabara, a la espera de su orden
function guardarBorrador() {
  const b = S.borrador; if (!b) return;
  if (b.provisional && !H.borrador.past.length && S.cfg) {
    // Gemini aún está afinando y no has tocado nada: se guarda ya (provisional) y se reorganiza cuando responda
    const ahora = Date.now(), trabajo = { id: uid(), provisionales: [] };
    trabajo.provisionales = b.ideas.map((i, k) => Object.assign({}, i, { id: 'p-' + uid(), creado: ahora + k, orden: ahora + k, hecho: false, hechoEn: 0, provisional: trabajo.id, origen: 'voz' }));
    trabajo.provisionales.forEach(i => { delete i._rid; S.ideas.push(i); });
    persist();
    RELEVO[afinadoN] = trabajo; FONDO.push(trabajo);
    marcaAfinando('off');
    S.borrador = null; S.entrada = null;
    irInicio('drop'); pintarFondo();
    setTimeout(() => toast('Guardado. Lo termino de ordenar y te aviso.'), 450);
    return;
  }
  afinadoN++; marcaAfinando('off');
  const { nuevas, op } = opDeIdeas(b.ideas, S.entrada && S.entrada.imagen ? 'foto' : 'voz');
  hacer(op);
  S.borrador = null; S.entrada = null;
  irInicio('drop');
  const nHoy = nuevas.filter(i => i.cat === 'hoy').length;
  setTimeout(() => toast(nHoy ? 'Guardado. Ya no tienes que acordarte.' : 'Guardado. Cada cosa en su sitio.'), 450);
}

// ---------- Guardar al momento y ordenar por detrás ----------
// Al tocar el ✓ vuelves al inicio enseguida. Si el iPhone ya tiene el texto, se guarda un primer orden provisional
// (solo en el iPhone); cuando Gemini responde, se cambia por el bueno. Nada de esperar en ninguna pantalla.
const FONDO = [];        // trabajos en marcha
async function procesarFondo(entrada) {
  const trabajo = { id: uid(), entrada, provisionales: [] };
  FONDO.push(trabajo);
  if (entrada.texto) {
    const ahora = Date.now();
    trabajo.provisionales = ordenarAqui(entrada.texto).map((i, k) => Object.assign({ frase: '', carpeta: '', aviso: '', urgente: false }, i,
      { id: 'p-' + uid(), creado: ahora + k, orden: ahora + k, hecho: false, hechoEn: 0, provisional: trabajo.id, origen: 'voz' }));
    trabajo.provisionales.forEach(i => S.ideas.push(i));
    persist();
  }
  irInicio('drop');
  pintarFondo();
  try {
    const datos = {};
    if (entrada.imagen) { datos.imagen = entrada.imagen; datos.imagenMime = 'image/jpeg'; }
    else if (entrada.texto) datos.texto = entrada.texto;
    else {
      const wav = await Promise.race([aWav(entrada.blob).catch(() => null), wait(8000).then(() => null)]);
      datos.audio = await aBase64(wav || entrada.blob);
      datos.mime = wav ? 'audio/wav' : (entrada.blob.type || 'audio/mp4').split(';')[0];
    }
    const r = await api('procesar', datos, 100000);
    if (!r.ideas || !r.ideas.length) throw new Error('No he encontrado ninguna idea.');
    quitarProvisionales(trabajo);
    const { nuevas, op } = opDeIdeas(r.ideas, entrada.imagen ? 'foto' : 'voz');
    hacer(op);
    terminarFondo(trabajo);
    pintarTodo(true);
    toast('Ordenado: ' + (resumen(r.ideas) || nuevas.length + ' ideas.').replace(/^./, c => c.toLowerCase()), 'Ver', () => abrirCosas());
  } catch (e) {
    const msg = String(e.message || e).replace(/^Error:\s*/, '');
    if (trabajo.provisionales.length) {
      // Gemini no ha respondido: se queda el primer orden, y ahora sí se guarda en tu Google
      const quedan = trabajo.provisionales.filter(p => buscar(p.id));
      quitarProvisionales(trabajo);
      const { op } = opDeIdeas(quedan.map(p => Object.assign({}, p)), 'voz');
      hacer(op);
      terminarFondo(trabajo);
      pintarTodo(true);
      toast('Gemini no ha respondido. Lo he guardado tal cual.');
    } else {
      terminarFondo(trabajo);
      S.entrada = entrada;
      toast(/tardando|Load failed|fetch/i.test(msg) ? 'No he podido ordenarlo: sin conexión.' : 'No he podido ordenarlo.', 'Reintentar', () => procesar(entrada));
    }
  }
}
function quitarProvisionales(trabajo) {
  const ids = new Set(trabajo.provisionales.map(p => p.id));
  S.ideas = S.ideas.filter(i => !ids.has(i.id));
  persist();
}
function terminarFondo(trabajo) {
  const k = FONDO.indexOf(trabajo); if (k >= 0) FONDO.splice(k, 1);
  pintarFondo();
}
/** Pastilla en el inicio mientras hay algo ordenándose por detrás */
function pintarFondo() {
  const el = $('#home-afin'); if (!el) return;
  if (FONDO.length) {
    el.innerHTML = '<span class="afin-dots"><i></i><i></i><i></i><i></i></span>' + (FONDO.length > 1 ? `Ordenando ${FONDO.length} cosas…` : 'Ordenando…');
    el.classList.add('on');
  } else el.classList.remove('on');
}

// ---------- Ordenar sin Gemini (modo prueba) ----------
/** Orden rápido en el propio iPhone (mientras Gemini afina, o si Gemini falla).
 *  Probado con la batería de pruebas/casos.js: junta las aclaraciones con su idea, reconoce listas
 *  (compra, «X: a, b y c», «(a, b y c)»), quita muletillas y correcciones, y entiende fechas,
 *  repeticiones, «no corre prisa», «da igual»… */
function ordenarAqui(texto) {
  const DIA = '(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)';
  const NUMS = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, quince: 15, veinte: 20, treinta: 30 };
  const num = s => NUMS[s] || +s || 0;
  const MULETILLA = /^(?:y\s+)?(?:vale|a ver|eh+|em+|mm+|uf+|buf+|ay|jo|bueno|pues|o sea|as[ií] que|entonces|por eso|ah|oye|mira|cosas|vamos|nada|venga|eso|y eso|recu[eé]rdame(?: de)?(?: que)?|av[ií]same(?: de)?(?: que)?|ap[uú]ntame(?: que)?|apunta(?: que)?(?=\s*[:,]|\s+que)|anota(?:me)?(?: que)?|la verdad(?: es)? que|y bueno|y nada|y ya est[aá]|ya est[aá]|nada m[aá]s|luego|despu[eé]s|tambi[eé]n|adem[aá]s)(?=$|[\s,.…:])[\s,.…:]*/i;
  const limpiar = s => {
    let a; s = String(s).trim();
    do {
      a = s;
      s = s.replace(MULETILLA, '').replace(/^(?:y|e|o)\s+/i, '').replace(/^que\s+(?=tengo|tendr|hay|deber|necesito|quiero|mañana|pasado|hoy|el |este |alg[uú]n|me (?:gustar|encantar|apetecer|ralla|raya|agobia|preocupa|da rabia))/i, '').trim();
    } while (s !== a);
    return s;
  };
  const NUEVA = new RegExp('^(?:tengo que|tendr[ií]a que|hay que|deber[ií]a|necesito|quiero|me gustar[ií]a|me apetecer[ií]a|no (?:me )?(?:puedo )?olvid|acu[eé]rdate|recordar|mañana|pasado mañana|hoy|esta (?:tarde|noche|semana)|la semana que viene|el (?:fin de semana|finde|mes que viene)|(?:el |este |el pr[oó]ximo )?' + DIA +
    '|antes del?|todos los|todas las|cada|de lunes|ll[eé]vale|tr[aá]eme|p[aá]sate|ac[uú]erdate|lo de|lo del|a primera hora|alg[uú]n d[ií]a|un d[ií]a de estos|[a-záéíóúñ]+(?:ar|er|ir)(?:le|les|la|lo|me|te|se)?(?=$|[\\s,.:]))', 'i');
  const NO_VERBO = /^(?:azucar|collar|lugar|hogar|bar|mar|par|taller|alfiler|mujer|placer|ayer|deber|elixir|faquir|nadir|super|master|poster|alquiler|solar|familiar|particular|popular|militar|pilar|altar|ejemplar|dolar|celular|lunar|hangar|ser|primer|tercer)(?=$|[\s,.:])|^[a-zñ]*[áéóú][a-záéíóúñ]*(?:ar|er|ir)(?=$|[\s,.:])/i;   // con tilde no es un infinitivo («máster», «súper»)
  const esNueva = t => NUEVA.test(t) && !NO_VERBO.test(t);
  const VERBO = /(?:^|\s)(?:tengo|hay|es|est[aá]|son|voy|vamos|comemos|cenamos|dijo|dice|entregaron|quedan?|tiene|tienen|ser[aá]|hago|caduca|gotea|falta|faltan)(?=$|[\s,.])/i;
  const COMPRA = /^(?:(?:tengo que|hay que|necesito|tendr[ií]a que)\s+)?(?:hacer la compra|compra(?:r)?|apunta(?:r)? en la (?:lista de la )?compra|a(?:ñ|n)ad(?:e|ir) a la (?:lista de la )?compra|a la (?:lista de la )?compra|en la lista de la compra|(?:me|nos) falta(?:n)?|se (?:ha|han) acabado|queda poco de)\b[:\s]*/i;
  const MODIF = /no (?:corre|me corre|hay) prisa|no es urgente|sin prisa|cuando pueda|lo dejo para alg[uú]n d[ií]a|para alg[uú]n d[ií]a|alg[uú]n d[ií]a|da igual|no pasa nada|me da lo mismo|tampoco pasa nada|no es importante|ya veremos|(?:eso )?(?:es )?(?:muy )?urgente|para ya|corre prisa|cuanto antes|s[ií] o s[ií]|la verdad|eso|que|si no lo hago|y|es|muy|no|me/gi;

  const FECHA_INI = new RegExp('^(?:pasado mañana|mañana|hoy|esta tarde|esta noche|(?:el |este |el pr[oó]ximo )?' + DIA + ')(?: a primera hora| a las \\S+(?: y media| y cuarto| menos cuarto)?| por la (?:mañana|tarde|noche))?\\b', 'i');
  // 0 · listas entre paréntesis o tras dos puntos se guardan aparte para que las comas no las rompan
  const LISTAS = [];
  const partir = s => s.split(/\s*,\s*|\s+y\s+|\s+e\s+(?=[ií])/).map(x => limpiar(x).replace(/^(?:(?:me|nos) falta(?:n)?|se (?:ha|han) acabado|queda(?:n)? poco de|(?:un )?poco de)\s+/i, '').replace(/^(?:unos?|unas?)\s+(?=\S+s\b)/i, '').replace(/^(?:el|la|los|las)\s+/i, '').replace(/\s+(?:que (?:no (?:queda|hay)|se (?:est[aá]|ha) acabad?o?).*|ah|eh|vale)$/i, '')).filter(x => x.length > 1).map(cap);
  let tx = ' ' + texto.replace(/\s+/g, ' ') + ' ';
  // correcciones al hablar: «el jueves, no, perdón, el viernes» → «el viernes»
  // dudas: «mandar el… el… bueno, el documento» → «mandar el documento»
  for (let k = 0; k < 3; k++) tx = tx.replace(/\b(el|la|los|las|un|una|de|del|a|al|que|en|con|para|y|mi|su)\s*…+\s*(?:\1\s*…+\s*)*(?:(?:bueno|eh|em|o sea|esto),?\s*)?(?:\1\s+)?/gi, '$1 ');
  // correcciones: «el jueves, no, perdón, el viernes» · «a las seis, mejor dicho a las siete» · «Iker, digo, Unai»
  tx = tx.replace(/([^.,;:¦]+?)\s*,\s*(?:no\s*,\s*(?:perd[oó]n\s*,?\s*)?|(?:no\s*,?\s*)?(?:perd[oó]n|mejor dicho|digo|quiero decir|no espera|bueno no)\s*,?\s+)([^.,;:]+)/gi, corregir);
  tx = tx.replace(/([^.,;:¦]+?)\s+(?:digo|mejor dicho|quiero decir|perd[oó]n)\s+([^.,;:]+)/gi, corregir);
  function corregir(m, x, y) {
    const yy = y.trim().replace(/^mejor\s+/i, ''), pal = yy.split(/\s+/), xw = x.trim().split(/\s+/);
    if (esNueva(yy) && !/^(?:el|la|a)\s/i.test(yy)) return ' ' + yy;                       // «ir al súper, bueno no, mejor pedirlo online»
    for (let n = Math.min(2, pal.length); n >= 1; n--) {                                       // se cambia desde la palabra que se repite
      const clave = pal.slice(0, n).join(' ').toLowerCase();
      for (let k = xw.length - n; k >= 0; k--) if (xw.slice(k, k + n).join(' ').toLowerCase() === clave) return ' ' + xw.slice(0, k).concat(pal).join(' ');
    }
    return ' ' + (xw.length > 1 ? xw.slice(0, -1).concat(pal) : pal).join(' ');               // «comprar tres, no, cuatro botellas»
  }
  tx = tx.replace(/\(([^()]{3,})\)/g, (m, d) => /,|\sy\s/.test(d) ? ` __L${LISTAS.push(partir(d)) - 1}__ ` : m);
  tx = tx.replace(/(?<!\d):(?!\d)\s*([^.;:!?]+)/g, (m, d) => {
    const trozos = d.split(/\s*,\s*|\s+y\s+/).map(limpiar).filter(Boolean);
    if (trozos.length < 2 || trozos.some(x => esNueva(x) && !/^el de |^la de /i.test(x))) return ' ;; ' + d;   // son tareas, no cosas
    return ` __L${LISTAS.push(partir(d)) - 1}__ `;
  });
  // «del máster: leer…, subir…» → el máster es el tema; «hoy: a, b y c» → la fecha vale para todas
  tx = tx.replace(/(^|[.;]\s*)([^.;]{1,30}?)\s*;; ([^.;]+)/g, (m, ini, pre, resto) => {
    const p = limpiar(pre);
    const partes = resto.split(/\s*,\s*|\s+y\s+(?=[a-záéíóúñ]+(?:ar|er|ir)(?:le|la|lo|me|se)?\s)/).filter(Boolean);
    if (/^(?:del?|de la|de los|para (?:el|la)|en)\s/i.test(p)) return ini + ' lo ' + p.replace(/^(?:para|en)\s+/i, 'de ') + ', ' + partes.join(' ; ');
    if (FECHA_INI.test(p) || /^(?:hoy|mañana|pasado mañana|esta semana)$/i.test(p)) return ini + partes.map(x => p + ' ' + x).join(' ; ');
    return ini + (p ? p + ', ' : '') + partes.join(' ; ');
  });
  // dictado sin comas ni puntos: estas palabras siempre empiezan otra cosa
  tx = tx.replace(/\s+(?:así que|asi que|ah y|ah,? y|y ah|y luego|y después|y despues|y también|y tambien)\s+/gi, ' ;¦');
  tx = tx.replace(/\s+ah(?=\s|$)/gi, ' ; ');
  // «… de segundo mañana a las cinco gimnasio», «… acuario todos los domingos a las 8 preparar la semana»: la fecha empieza otra idea
  const FECHA_MITAD = '(?:(?:todos los|todas las|cada) (?:' + DIA + 's?|d[ií]as|mañanas|tardes|noches|semanas?|\\S+ d[ií]as)|pasado mañana|mañana|hoy|esta tarde|esta noche|(?:el |este )' + DIA + ')' +
    '(?: (?:a las \\S+(?: y media| y cuarto| menos cuarto)?(?: de la (?:mañana|tarde|noche))?|por la (?:mañana|tarde|noche)|a (?:primera|segunda|tercera|[uú]ltima) hora))?';
  tx = tx.replace(new RegExp('(\\S+)\\s+(' + FECHA_MITAD + ')\\s+(\\S+)', 'gi'), (m, ant, f, sig, off, str) => {
    const ini = Math.max(str.lastIndexOf(',', off), str.lastIndexOf('.', off), str.lastIndexOf(';', off), str.lastIndexOf('¦', off), 0);
    const antes = str.slice(ini, off + ant.length).replace(/^[.,;¦\s]+/, '');
    const palabras = antes.split(/\s+/).filter(Boolean);
    const conVerbo = palabras.some(w => /^[a-záéíóúñ]+(?:ar|er|ir)(?:le|les|la|lo|me|se)?$/i.test(w) && !NO_VERBO.test(w));
    if (palabras.length < 3 || !conVerbo || /^(?:la|de|por|del|el|que|a|al|para|y|o)$/i.test(ant) ||
      /^(?:a|al|con|para|de|del|en|que|y|o|e|me|te|se|le|lo|la|las|los|el|sin|por|hasta|antes|menos|media|cuarto)$/i.test(sig)) return m;
    return ant + ' ; ' + f + ' ' + sig;
  });
  // «contestar el correo del máster subir la tarea»: dos infinitivos seguidos sin «y» son dos cosas
  tx = tx.replace(/(\S+)\s+(?=([a-záéíóúñ]+(?:ar|er|ir)(?:le|les|la|lo|me|se)?)\s)/gi, (m, ant, v, off, str) => {
    if (v[0] !== v[0].toLowerCase() || NO_VERBO.test(v) || /^(?:olvid[ae]s?|acuerd[eo]|recuerd[ae]s?|a|al|de|del|para|por|que|sin|y|o|e|me|te|se|le|lo|la|gustar[ií]a|encantar[ií]a|apetece|quiero|quiere|necesito|puedo|debo|voy|vamos|hay|tengo|tienes|va|van|dejo|empezar|acabar|volver|antes|despu[eé]s|ir|hacer|poder|tener|sin|no|ya|tambi[eé]n|mejor|igual|que|hasta)$/i.test(ant) ||
      (/(?:ar|er|ir)$/i.test(ant) && !NO_VERBO.test(ant)) || /(?:ía|ado|ido)$/i.test(ant)) return m;
    const ini = Math.max(str.lastIndexOf(',', off), str.lastIndexOf('.', off), str.lastIndexOf(';', off), str.lastIndexOf('¦', off), 0);
    const antes = str.slice(ini, off).replace(/^[.,;¦\s]+/, '').split(/\s+/).filter(Boolean);
    if (antes.length < 2 || !antes.some(w => /^[a-záéíóúñ]+(?:ar|er|ir)(?:le|les|la|lo|me|se)?$/i.test(w) && !NO_VERBO.test(w))) return m;
    return ant + ' ; ';
  });
  // «… y el lunes hay…», «… y subir…»: una idea nueva aunque vaya con «y»
  tx = tx.replace(new RegExp('\\s+y\\s+(?=(?:el |este |mañana|pasado mañana|hoy |luego|despu[eé]s|tambi[eé]n|alg[uú]n d[ií]a|me gustar|' + DIA + '|por la (?:mañana|tarde|noche)|ll[eé]vale|tr[aá]eme|p[aá]sate|[a-záéíóúñ]+(?:ar|er|ir)(?:le|les|la|las|lo|los|me|se)?\\s))', 'gi'), (m, k, s) => {
    const sig = s.slice(k + m.length, k + m.length + 20), ant = s.slice(Math.max(0, k - 12), k);
    if (new RegExp(DIA + 's?$', 'i').test(ant) && new RegExp('^(?:los )?' + DIA, 'i').test(sig)) return m;   // «los martes y jueves»
    return NO_VERBO.test(sig) ? m : ' ;¦';
  });

  // 1 · trozos
  const trozos = tx.split(/(?<=[.!?…])\s+|;;|[;\n]+|,\s*|…+|\.\s*(?=[A-ZÁÉÍÓÚÑ_])/)
    .map(s => s.replace(/[.…]+$/, '').trim()).filter(Boolean);

  const ideas = [];
  let enCompra = null, fechaPend = '';
  const ultima = () => ideas[ideas.length - 1];
  const aplicarModif = (i, l) => {
    if (/no (?:corre|me corre|hay) prisa|no es urgente|sin prisa|cuando pueda|alg[uú]n d[ií]a|me gustar[ií]a|me apetecer[ií]a|me apetece|me encantar[ií]a|un d[ií]a de estos|el (?:verano|a[nñ]o|invierno) que viene|en (?:verano|navidades|vacaciones)/.test(l)) { i.urgente = false; if (i.cat !== 'olvidar') { i.cat = 'algun'; if (!i.repetir && !i.limite) i.aviso = ''; } i.fijo = true; return true; }
    if (/da igual|no pasa nada|me da lo mismo|tampoco pasa nada|no es importante|ya veremos|no depende de m[ií]|me (?:ralla|raya|agobia|preocupa|molesta|fastidia)|qu[eé] rabia|me da rabia|le doy vueltas|no s[eé] si |^qué |^que (?:d[ií]a|rollo|pereza|asco|agobio)\b/.test(l)) { i.cat = 'olvidar'; i.urgente = false; i.fijo = true; return true; }
    if (/urgente|para ya|corre prisa|cuanto antes|s[ií] o s[ií]/.test(l) && !/no (?:es|corre|me corre) |sin prisa/.test(l)) { i.urgente = /urgente|para ya|corre prisa|cuanto antes/.test(l); if (i.cat !== 'olvidar' && !i.aviso) i.cat = 'hoy'; return true; }
    return false;
  };
  const soloModif = l => l.replace(MODIF, ' ').replace(/[\s,.…]+/g, ' ').trim().split(' ').filter(w => w.length > 2).length <= 1;
  const nuevaLista = (titulo, items, bruto) => {
    const i = { titulo, frase: bruto, cat: 'hoy', carpeta: '', urgente: false, aviso: '', items: items.slice(), lista: true };
    ideas.push(i); return i;
  };

  const TIENE_FECHA = new RegExp('\\b(?:mañana|hoy|esta tarde|esta noche|' + DIA + '|semana|d[ií]a \\d)', 'i');
  let fechaFrase = '';
  for (let bruto of trozos) {
    const hereda = bruto.startsWith('¦'); bruto = bruto.replace(/^¦\s*/, '');
    let t = limpiar(bruto);
    if (fechaPend) { t = fechaPend + ' ' + t; fechaPend = ''; }
    // «mañana comprar leche y llamar a mi padre»: la fecha del principio vale para las dos
    if (hereda && fechaFrase && !TIENE_FECHA.test(t)) t = fechaFrase + ' ' + t;
    else if (!hereda) { const fi = t.match(FECHA_INI); fechaFrase = fi ? fi[0] : ''; }
    if (t.length < 2 || /^(?:necesito|tengo que|hay que|apunta|recuerda|y)$/i.test(t)) continue;
    // un trozo que solo es una fecha («el viernes») va con lo siguiente
    if (new RegExp('^(?:el |este |el pr[oó]ximo )?(?:' + DIA + '|mañana|pasado mañana|hoy|esta tarde|esta noche)(?: a las \\S+(?: y media| y cuarto| menos cuarto)?(?: de la \\S+)?| por la (?:mañana|tarde|noche))?$', 'i').test(t)) { fechaPend = t; continue; }
    const l = t.toLowerCase();
    const prev = ultima();
    const lst = t.match(/__L(\d+)__/);
    // a) lo que solo cambia la idea anterior («no corre prisa», «eso da igual», «es urgente»)
    if (prev && !lst && soloModif(l) && aplicarModif(prev, l)) { enCompra = null; continue; }
    if (prev && !lst && /^(?:si no lo hago|y si no)/i.test(t)) continue;
    // b) listas: «X: a, b y c» o «X (a, b y c)»
    if (lst) {
      const items = LISTAS[+lst[1]];
      let tit = limpiar(t.replace(/__L\d+__/, '').replace(/^(?:tengo que|hay que|necesito)\s+/i, '').trim());
      if ((COMPRA.test(tit + ' ') || /lista de la compra/i.test(tit)) && !/material|para el cole|para la/i.test(tit)) { enCompra = ideas.find(i => i.lista && i.compra) || nuevaLista('Compra', [], bruto); enCompra.compra = true; items.forEach(x => enCompra.items.push(x)); enCompra.frase += ', ' + bruto; continue; }
      if (/^(?:idea|nota|reflexi[oó]n|pensando|estaba pensando)\b/i.test(tit) || items.reduce((n, x) => n + x.split(' ').length, 0) / items.length > 5) {
        ideas.push({ titulo: cap(tit.replace(/[:,]\s*$/, '')) || 'Nota', frase: bruto, cat: 'algun', carpeta: '', urgente: false, aviso: '', nota: items.join(', '), fijo: true });
        enCompra = null; continue;
      }
      const i = nuevaLista(cap(tit.replace(/[:,]\s*$/, '')) || 'Lista', items, bruto);
      Object.assign(i, fechaDe(l)); i.compra = /^compra/i.test(tit);
      enCompra = null; continue;
    }
    // c) empieza la compra
    const tc = t.replace(FECHA_INI, '').trim().replace(/^(?:a primera hora|por la (?:mañana|tarde|noche))\s+/i, '');
    const sinModal = tc.replace(/^(?:tengo que|hay que|necesito|tendr[ií]a que)\s+/i, '');
    if (COMPRA.test(tc)) {
      const resto = limpiar(tc.replace(COMPRA, ''));
      const unaCosa = (/^(?:un|una|el|la|los|las|unos|unas|algo|le|les|entradas|billetes?)\b/i.test(resto) || /\bregalo\b|\bpara (?:mi |tu |su |el |la |los |las )?[A-ZÁÉÍÓÚÑ]/.test(resto)) && !/,|\sy\s/.test(resto) && /^compra/i.test(sinModal);
      if (!unaCosa) {
        enCompra = ideas.find(i => i.compra) || Object.assign(nuevaLista('Compra', [], ''), { compra: true });
        enCompra.frase += (enCompra.frase ? ', ' : '') + bruto;
        partir(resto).forEach(x => enCompra.items.push(x));
        continue;
      }
    }
    // d) seguimos en la compra mientras parezcan cosas
    if (enCompra && /^(?:que )?se (?:est[aá]|me est[aá]|nos est[aá]) acabando|se ha acabado|que no queda|que falta/i.test(l)) continue;
    if (enCompra && /^que /i.test(t)) continue;
    if (enCompra && !esNueva(t) && !VERBO.test(t) && t.split(' ').length <= 12) {
      partir(t).forEach(x => enCompra.items.push(x));
      enCompra.frase += ', ' + bruto;
      continue;
    }
    enCompra = null;
    // «hacerlo hoy», «eso para la semana que viene»: solo pone fecha a lo anterior
    const soloFecha = new RegExp('^(?:para |de )?(?:la semana que viene|la pr[oó]xima semana|esta semana|pasado mañana|mañana|hoy|esta tarde|el (?:fin de semana|finde)|(?:el |este )?' + DIA + ')$', 'i').test(t);
    if (prev && !prev.lista && (soloFecha || /^(?:hacerlo|hacerla|eso|esto|lo hago|lo tengo que hacer|tiene que ser)\b/i.test(t))) {
      const d = fechaDe(l); Object.assign(prev, d); if (!d.cat && /\bhoy\b/.test(l)) prev.cat = 'hoy';
      aplicarModif(prev, l); prev.frase += ', ' + bruto; continue;
    }
    const propia = /^(?:me|nos) (?:ralla|raya|agobia|preocupa|molesta|fastidia|da rabia)\b/i.test(t);
    // e) aclaraciones: van con la idea de antes
    const aclara = /^(?:el|la) de(?:l)? |^(?:el|la|los|las) que |^que |^para |^porque |^por si |^creo que|^igual |^a lo mejor|^con |^sin |^en casa de|^donde |^cuando |^si (?!no)|^me (?:las|los|lo|la) |^(?:se|le|les) |^bueno mejor |^mejor /i;
    // «Pan. Leche. Huevos.»: varias cosas sueltas seguidas son la compra
    const corta = x => x.split(' ').length <= 3 && !esNueva(x) && !VERBO.test(x) && !aclara.test(x) && !TIENE_FECHA.test(x) && !/__L/.test(x);
    if (prev && !prev.lista && !prev.aviso && corta(prev.titulo) && corta(t) && prev.frase.split(/[ ,.]+/).filter(Boolean).length <= 3) {
      ideas.pop(); enCompra = Object.assign(nuevaLista('Compra', [prev.titulo, cap(t)], prev.frase + ', ' + bruto), { compra: true }); continue;
    }
    if (prev && !prev.lista && !propia && (aclara.test(t) || (!esNueva(t) && !VERBO.test(t) && t.split(' ').length <= 3))) {
      const d = new RegExp('\\b' + DIA + '\\b|mañana', 'i').test(l) && !prev.aviso && !prev.fijo ? fechaDe(l) : null;
      if (d) { delete d.cat; Object.assign(prev, d); if (prev.cat === 'hoy' && prev.aviso) prev.cat = catDeAviso(prev.aviso); }
      if (/^(?:igual|a lo mejor) /i.test(t) && /llevar|postre|regalo|\(/i.test(prev.titulo)) prev.titulo = prev.titulo.replace(/\)$/, '') + (prev.titulo.endsWith(')') ? ', ' : ' (') + t.replace(/^(?:igual|a lo mejor)\s+/i, '') + ')';
      else if (/^(?:el|la) de(?:l)? /i.test(t) && /\b[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\s+[A-ZÁÉÍÓÚÑ]/.test(prev.titulo)) prev.titulo += ', ' + t;
      else if (/^para /i.test(t)) prev.titulo += (/, (?:el|la) de/.test(prev.titulo) ? ', ' : ' ') + t.replace(/^para preguntarle/i, 'para preguntar');
      aplicarModif(prev, l);
      prev.frase += ', ' + bruto;
      continue;
    }
    // f) «tengo que llevar el postre» justo después de una comida, cena o cumple: va dentro
    if (prev && !prev.lista && /^(?:tengo que |hay que )?(?:llevar|ll[eé]vale|llevarle|comprarle|regalarle) /i.test(t) && /\b(?:com(?:er|emos|ida)|cen(?:ar|amos|a)|casa de|cumple|fiesta|quedada)/i.test(prev.titulo + ' ' + prev.frase)) {
      prev.titulo = prev.titulo.replace(/\)$/, '') + (prev.titulo.endsWith(')') ? ', ' : ' (') + t.replace(/^(?:tengo que |hay que )/i, '').replace(/^\w/, c => c.toLowerCase()) + ')';
      prev.frase += ', ' + bruto; continue;
    }
    // «el coche hace un ruido raro, llevarlo al taller»: la frase de antes dice qué es «lo»
    if (prev && !prev.lista && !prev.aviso && !prev.fijo && !esNueva(limpiar(prev.frase)) && /^(?:el|la|los|las|mi|mis)\s/i.test(prev.titulo)) {
      const cl2 = t.match(/^([a-záéíóúñ]+?(?:ar|er|ir))(lo|la|los|las)\b(.*)$/i);
      const suj = prev.titulo.match(/^((?:el|la|los|las|mi|mis)\s+\S+)\s+(.*)$/i);
      if (cl2 && suj) {
        ideas.pop();
        t = cl2[1] + ' ' + suj[1].replace(/^\w/, c => c.toLowerCase()) + cl2[3] + ' (' + suj[2] + ')';
        bruto = prev.frase + ', ' + bruto;
      }
    }
    // «lo de la boda de mi prima, buscar un traje»: lo de antes era solo el tema
    let tema = '';
    if (prev && prev.tema && !prev.lista && ideas.length && esNueva(t)) { tema = prev.titulo; ideas.pop(); }
    // g) una idea nueva
    const i = Object.assign({ titulo: '', frase: bruto, cat: 'hoy', carpeta: '', urgente: false, aviso: '' }, fechaDe(l));
    aplicarModif(i, l);
    let tit = t
      .replace(/,?\s*(?:lo dejo para|para) alg[uú]n d[ií]a.*$/i, '').replace(/,?\s+(?:cuando pueda|el (?:verano|a[nñ]o|invierno) que viene)\b/i, '').replace(/,?\s*(?:no corre prisa|(?:eso )?(?:me )?da igual|s[ií] o s[ií]).*$/i, '')
      .replace(/,?\s*(?:eso es|es) urgente.*$/i, '').replace(/,?\s*(?:urgente|cuanto antes)$/i, '')
      .replace(/\s+pero bueno.*$/i, '').replace(/\s+antes de que se agoten$/i, '').replace(/,?\s+que si no\b.*$/i, '').replace(/^(?:dentro de \S+ (?:d[ií]as|semanas|meses)|(?:el )?\d{1,2} de (?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre))\s+/i, '');
    let a;
    do {
      a = tit;
      tit = tit.replace(/^(?:que no se me olvid[ae](?: de)?|de que|sin falta|a mediod[ií]a|el (?:finde|fin de semana)|es|hay(?! que)|tengo(?! que)|(?:tengo que )?acordarme de|me apetece(?: un mont[oó]n| mucho)?|me encantar[ií]a|me da rabia que|no s[eé] si|se me (?:ha )?olvid(?:ado|ó)|que no se me olvide|no se me puede olvidar|tengo que|tendr[ií]a que|hay que|deber[ií]a|necesito|quiero|me gustar[ií]a|me apetecer[ií]a|no (?:me )?(?:puedo )?olvidar(?:me)? de|acu[eé]rdate de|recordar)\s+/i, '')
        .replace(/^(?:alg[uú]n d[ií]a|un d[ií]a de estos)\s+/i, '')
        .replace(/^(?:todas las (?:mañanas|noches|tardes)|cada (?:mañana|noche|tarde)|todos los d[ií]as|cada d[ií]a|de lunes a viernes|entre semana|cada (?:\S+ )?(?:d[ií]as|semanas?|mes(?:es)?)|todas las semanas|todos los meses)\s+/i, '')
        .replace(new RegExp('^el (?:primer|segundo|tercer|cuarto|[uú]ltimo) ' + DIA + ' de cada mes\\s+', 'i'), '')
        .replace(/^(?:el )?d[ií]a \d{1,2} de cada mes\s+/i, '').replace(/^(?:el )?(?:d[ií]a )?\d{1,2}\s+(?:es\s+)?(?!de\s)/i, '')
        .replace(new RegExp('^(?:el |este |el pr[oó]ximo |antes del? |todos los |los |cada )?' + DIA + 's?(?:,? y (?:los )?' + DIA + 's?)?(?: \\d{1,2}(?! de))?\\s+', 'i'), '')
        .replace(/^(?:a (?:primera|segunda|tercera|cuarta|quinta|sexta|[uú]ltima) hora|por la (?:mañana|tarde|noche)|pasado mañana|mañana|hoy|esta (?:tarde|noche|semana)|la semana que viene|la pr[oó]xima semana)\s+/i, '')
        .replace(/^a las \S+(?: y media| y cuarto| menos cuarto)?(?: de la (?:mañana|tarde|noche))?\s+/i, '')
        .replace(i.cat === 'olvidar' ? /^$/ : /^lo de(?:l)?\s+/i, '').replace(/^(?:me )?(?:ralla|raya|agobia|preocupa)\s+(?:un mont[oó]n\s+|mucho\s+|bastante\s+|un poco\s+)?/i, '').trim();
    } while (tit !== a);
    // la fecha ya va aparte: fuera del final del título
    do {
      a = tit;
      tit = tit.replace(new RegExp('(?<!\\bdel?)\\s+(?:para |antes |hasta )?(?:el |este |el pr[oó]ximo |los )?' + DIA + 's?$', 'i'), '')
        .replace(/\s+a (?:primera|segunda|tercera|cuarta|quinta|sexta|[uú]ltima) hora$/i, '').replace(/\s+(?:todos los d[ií]as|cada d[ií]a|todas las semanas|cada semana)$/i, '')
        .replace(/\s+(?:antes|para|hasta) del? (?:d[ií]a )?\d{1,2}$/i, '')
        .replace(/\s+(?:para |antes |hasta )?(?:el |del )d[ií]a \d{1,2}$/i, '').replace(/\s+(?:para|antes de|hasta) (?:la semana que viene|mañana|el finde|el fin de semana)$/i, '')
        .replace(/\s+a las \S+(?: y media| y cuarto| menos cuarto)?(?: de la (?:mañana|tarde|noche))?$/i, '')
        .replace(/\s+(?:pasado mañana|mañana|hoy|esta tarde|esta noche|sin falta|por la (?:mañana|tarde|noche))$/i, '');
    } while (tit !== a && tit.split(' ').length > 2);
    tit = tit.replace(/(\S)\s+(?:pasado mañana|mañana)(?=\s)(?<!(?:de|por) la mañana)/i, '$1');   // «llamar mañana a…»
    const IMPER = { 'pásate': 'Pasarme', 'llévale': 'Llevarle', 'tráeme': 'Traerme', 'acuérdate': 'Acordarme', llama: 'Llamar', compra: 'Comprar', escribe: 'Escribir', manda: 'Mandar', pide: 'Pedir', recoge: 'Recoger', lleva: 'Llevar', busca: 'Buscar', haz: 'Hacer', pon: 'Poner', reserva: 'Reservar', paga: 'Pagar' };
    tit = tit.replace(/^(\S+)/, w => IMPER[w.toLowerCase()] || w).replace(/^(\S+?)\s+y\s+ll[eé]vale\b/i, '$1 y llevarle');
    tit = tit.replace(/\s+lo dejo$/i, '').replace(/^comemos\b/i, 'Comer').replace(/^cenamos\b/i, 'Cenar').replace(/^quedamos\b/i, 'Quedar')
      .replace(/\s+(?:hoy )?por la (?:tarde|mañana|noche)$/i, '').replace(/\s+(?:hoy|esta tarde|esta noche)$/i, '');
    const cl = tema && tit.match(/^(\S+?(?:ar|er|ir))(la|lo|las|los)\b(.*)$/i);
    i.titulo = cl ? cap(cl[1] + ' ' + tema.replace(/^\w/, c => c.toLowerCase()) + cl[3]) : cap(tit) + (tema ? ' (' + tema.replace(/^\w/, c => c.toLowerCase()) + ')' : '');
    if (/^lo del? /i.test(t) && !esNueva(t.replace(/^lo del?\s+/i, '')) && !i.fijo) i.tema = true;
    if (i.limite) i.titulo = i.titulo.replace(/,?\s*que me (?:las|los|lo|la) entregaron.*$/i, '');
    ideas.push(i);
  }

  // 2 · carpeta y repaso final
  const C = S.carpetas;
  return ideas.filter(i => i.titulo && !/^(?:nada|eso|cosas|mira|vale|bueno|ya est[aá]|y ya|los|las|el|la)$/i.test(i.titulo) && (!i.lista || i.items.length)).map(i => {
    const l = (i.titulo + ' ' + i.frase + ' ' + (i.items || []).join(' ')).toLowerCase();
    let carpeta = '';
    if (/instituto|\bclases?\b(?! de)|alumn|familias de|evaluaci|examen(?! de conducir)|ex[aá]menes|pr[aá]cticas|\d\s?º\s?[a-e]\b|claustro|tutor|m[aá]ster|idoceo|coordinador|excursi|jefe de estudios|notas de|\binsti\b|jefatura|programaci[oó]n|aula de|departamento|r[uú]bricas|recuperaci[oó]n|tercera hora|primera evaluaci|tutor[ií]a|rob[oó]tica|\bde (?:primero|segundo|tercero|cuarto)\b/.test(l) && C.includes('Instituto')) carpeta = 'Instituto';
    else if (/\bama\b|\baita\b|\babuel[oa]s?\b|\bmis? (?:madre|padre|padres|herman|abuel|prim|t[ií][oa]|sobrin|suegr|cuñad|hij|niet)|familia\b|boda|bautizo|nochebuena|navidad en casa/.test(l) && C.includes('Familia')) carpeta = 'Familia';
    else if (i.compra && C.includes('Supermercado')) carpeta = 'Supermercado';
    else if (i.compra || /\bcasa\b|piso|limpiar|papeles|lavadora|lavavajillas|nevera|fontanero|electricista|factura|alquiler|casero|grifo|caldera|calefacci|humedad|\bba[ñn]o\b|\b(?:la|de la) cocina\b|\bpintar\b|plantas|\bregar\b|comunidad|basura|reciclaj|taller|coche|peces|acuario|trastero|mudanza/.test(l)) carpeta = C.includes('Casa') ? 'Casa' : '';
    if (i.lista) return Object.assign({ titulo: i.titulo, frase: i.frase, cat: i.cat, tipo: 'lista', clave: i.titulo, carpeta, urgente: i.urgente, aviso: i.aviso || '',
      items: i.items.map(t => ({ id: uid(), t: cap(String(t)), hecho: false })) }, i.repetir ? { repetir: i.repetir } : {});
    const o = { titulo: i.titulo, frase: i.frase, cat: i.cat, carpeta, urgente: i.urgente, aviso: i.aviso };
    if (i.limite) o.limite = i.limite;
    if (i.repetir) o.repetir = i.repetir;
    if (i.nota) { o.tipo = 'nota'; o.nota = i.nota; }
    return o;
  });

  function catDeAviso(av) { const d = deIsoSimple(av), h = new Date(); h.setHours(23, 59, 59, 0); return d <= h ? 'hoy' : 'semana'; }
  function deIsoSimple(s) { return new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +s.slice(11, 13) || 0, +s.slice(14, 16) || 0); }

  /** fecha, hora y repetición de una frase */
  function fechaDe(l) {
    const r = {};
    const hm = l.match(/a las (\d{1,2}|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)(?::(\d\d))?( y media| y cuarto| menos cuarto)?( de la (?:mañana|tarde|noche))?/);
    let h = hm ? num(hm[1]) : 9, mi = hm ? (hm[2] ? +hm[2] : hm[3] === ' y media' ? 30 : hm[3] === ' y cuarto' ? 15 : hm[3] === ' menos cuarto' ? 45 : 0) : 0;
    if (hm && hm[3] === ' menos cuarto') h -= 1;
    if (hm && hm[4]) { if (/tarde|noche/.test(hm[4]) && h < 12) h += 12; }
    else if (hm && /esta (?:tarde|noche)|por la (?:tarde|noche)/.test(l) && h < 12) h += 12;
    else if (hm && h < 8) h += 12;
    if (/mediod[ií]a/.test(l) && !hm) h = 14;
    if (/a primera hora/.test(l) && !hm) h = 8;
    if (/por la tarde|esta tarde/.test(l) && !hm) h = 17;
    const hora = pad(h) + ':' + pad(mi);
    const ds = { lunes: 1, martes: 2, 'miércoles': 3, miercoles: 3, jueves: 4, viernes: 5, 'sábado': 6, sabado: 6, domingo: 7 };
    const hoy = new Date();
    const en = n => { const d = new Date(hoy); d.setDate(d.getDate() + n); d.setHours(h, mi, 0, 0); return d; };
    const proximo = n => en((((n % 7) - hoy.getDay() + 7) % 7) || 7);
    const repetir = rr => { rr.hora = hora; r.repetir = rr; r.aviso = siguienteRepeticion(rr, isoLocal(hoy), true); r.cat = catDeAviso(r.aviso); r.fijo = true; return r; };
    // repeticiones
    let m;
    if ((m = l.match(new RegExp('el (primer|segundo|tercer|cuarto|[uú]ltimo) (' + DIA + ') de cada mes', 'i'))))
      return repetir({ tipo: 'mensualOrdinal', ordinal: { primer: 1, segundo: 2, tercer: 3, cuarto: 4 }[m[1]] || -1, diaSemana: ds[m[2]] });
    if ((m = l.match(/(?:el )?d[ií]a (\d{1,2}) de cada mes|todos los (?:d[ií]as )?(\d{1,2}) de cada mes|cada d[ií]a (\d{1,2}) del mes/)))
      return repetir({ tipo: 'mensualDia', dia: +(m[1] || m[2] || m[3]) });
    if (/de lunes a viernes|entre semana|d[ií]as laborables|todos los d[ií]as laborables/.test(l)) return repetir({ tipo: 'laborables' });
    if ((m = l.match(/cada (\S+) (d[ií]as|semanas)/)) && num(m[1])) return repetir({ tipo: 'cadaN', n: num(m[1]) * (/semana/.test(m[2]) ? 7 : 1) });
    if (/cada quince d[ií]as|cada dos semanas/.test(l)) return repetir({ tipo: 'cadaN', n: 14 });
    if ((m = l.match(new RegExp('(?:todos los|cada|los) (' + DIA + ')s?(?:,? y (?:los )?(' + DIA + ')s?)?', 'i'))) && (/todos los|cada/.test(m[0]) || /^los /.test(m[0])) && !/^los (?:s[aá]bado|domingo)$/.test(m[0]) || (m && m[2]))
      return repetir({ tipo: 'semanal', dias: [ds[m[1]]].concat(m[2] ? [ds[m[2]]] : []) });
    if (/todos los d[ií]as|cada d[ií]a|cada noche|todas las noches|todas las mañanas/.test(l)) return repetir({ tipo: 'diaria' });
    if (/todas las semanas|cada semana/.test(l)) return repetir({ tipo: 'semanal', dias: [((hoy.getDay() + 6) % 7) + 1] });
    if (/todos los meses|cada mes/.test(l)) return repetir({ tipo: 'mensualDia', dia: hoy.getDate() });
    // fechas
    const dn = l.match(new RegExp('(?:' + DIA + ') (\\d{1,2})\\b(?! de)|^(?:el )?(?:d[ií]a )?(\\d{1,2})\\b(?! de| horas| d[ií]as| minutos)', 'i'));
    if (dn && +(dn[1] || dn[2]) <= 31 && +(dn[1] || dn[2]) >= 1) { const d = en(0); d.setDate(+(dn[1] || dn[2])); if (d < hoy && d.getDate() !== hoy.getDate()) d.setMonth(d.getMonth() + 1); r.aviso = isoLocal(d); const dd = (d - hoy) / 864e5; r.cat = d.getDate() === hoy.getDate() && dd < 1 ? 'hoy' : dd <= 10 ? 'semana' : 'algun'; return r; }
    const MES = { enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11 };
    const dentro = l.match(/dentro de (\S+) (d[ií]as|semanas|meses)/);
    if (dentro && num(dentro[1])) { const n = num(dentro[1]) * (/semana/.test(dentro[2]) ? 7 : /mes/.test(dentro[2]) ? 30 : 1); r.aviso = isoLocal(en(n)); r.cat = n <= 10 ? 'semana' : 'algun'; return r; }
    const fm = l.match(/(?:el )?(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/);
    if (fm) {
      const d = new Date(hoy.getFullYear(), MES[fm[2]], +fm[1], h, mi); if (d < hoy) d.setFullYear(d.getFullYear() + 1);
      if (/antes del?|para el|hasta el/.test(l)) r.limite = isoDia(d); else r.aviso = isoLocal(d);
      if (r.limite) { const av = new Date(d); av.setDate(av.getDate() - 2); av.setHours(9, 0, 0, 0); r.aviso = isoLocal(av < hoy ? en(1) : av); }
      const dd = (d - hoy) / 864e5; r.cat = dd < 1 && d.getDate() === hoy.getDate() ? 'hoy' : dd <= 10 ? 'semana' : 'algun'; return r;
    }
    const antesN = l.match(/(?:antes del?|hasta el|para el) (?:d[ií]a )?(\d{1,2})\b(?! de (?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre))/);
    if (antesN) { const d = new Date(hoy); d.setDate(+antesN[1]); if (d < hoy) d.setMonth(d.getMonth() + 1); r.limite = isoDia(d); const av = new Date(d); av.setDate(av.getDate() - 2); if (av < hoy) av.setTime(en(1).getTime()); av.setHours(9, 0, 0, 0); r.aviso = isoLocal(av); r.cat = (d - hoy) / 864e5 <= 10 ? 'semana' : 'algun'; return r; }
    const antes = l.match(new RegExp('antes del? (' + DIA + ')', 'i'));
    if (antes) { const d = proximo(ds[antes[1]]); r.limite = isoDia(d); const av = new Date(d); av.setDate(av.getDate() - 2); if (av < hoy) av.setTime(en(1).getTime()); av.setHours(9, 0, 0, 0); r.aviso = isoLocal(av); r.cat = 'semana'; return r; }
    m = l.match(new RegExp('\\b(' + DIA + ')\\b', 'i'));
    if (/pasado mañana/.test(l)) { r.aviso = isoLocal(en(2)); r.cat = 'semana'; }
    else if (/\bmañana\b/.test(l.replace(/(?:por|de) la mañana|todas las mañanas|cada mañana/g, ''))) { r.aviso = isoLocal(en(1)); r.cat = 'semana'; }
    else if (m) { r.aviso = isoLocal(proximo(ds[m[1]])); r.cat = 'semana'; }
    else if (/\bhoy\b|esta tarde|esta noche|por la tarde|mediod[ií]a/.test(l)) { if (hm || /tarde|mediod/.test(l)) r.aviso = isoLocal(en(0)); r.cat = 'hoy'; }
    else if (/semana que viene|esta semana|pr[oó]xima semana|el finde|el fin de semana/.test(l)) r.cat = 'semana';
    else if (/alg[uú]n d[ií]a|me gustar[ií]a|me apetecer[ií]a|alg[uú]n momento|un d[ií]a de estos|el a[nñ]o que viene/.test(l)) r.cat = 'algun';
    else if (hm) { const d = en(0); if (d < hoy) d.setDate(d.getDate() + 1); r.aviso = isoLocal(d); r.cat = catDeAviso(r.aviso); }
    return r;
  }
}

// =====================================================================
// 12 · ESCRIBIR
// =====================================================================
function abrirEscribir(texto = '') {
  const desdeVoz = !!actual && ['s-listen', 's-proc'].includes(actual.id);
  ir('s-type', desdeVoz ? 'fade' : 'push', { sinPila: desdeVoz });
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
/** El interruptor se mueve primero (con su transición) y luego se aplica el cambio */
function conSw(el, fn) { const sw = el.querySelector('.sw'); if (sw) sw.classList.toggle('on'); vib(); setTimeout(fn, sw ? 280 : 0); }
const ACT = {
  ajustes: () => ir('s-aj', 'push'),
  atras: () => atras(),
  'ir-inicio': () => irInicio(),
  hablar: () => empezarVoz(),
  escribir: () => abrirEscribir(),
  cosas: () => abrirCosas(),
  'cerrar-cosas': () => cerrarHoja('sh-cosas'),
  'abrir-cat': el => abrirCajon(el),
  cat: el => irACat(el.dataset.cat),
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
  reintentar: () => {
    // si Gemini aún está afinando, no se empieza otra vez: se espera a su respuesta
    if (actual && actual.id === 's-res' && S.borrador && S.borrador.provisional && $('#afinando') && $('#afinando').classList.contains('on') && !$('#afinando').classList.contains('err')) {
      const p = $('#afinando'); p.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 380, easing: 'ease-out' });
      return toast('Ya lo estoy ordenando. Un momento.');
    }
    if (S.entrada) procesar(S.entrada); else irInicio();
  },
  guardar: () => guardarBorrador(),
  descartar: () => { afinadoN++; marcaAfinando(false); S.borrador = null; S.entrada = null; irInicio(); toast('Descartado.'); },
  tema: el => { $$('#aj-body .seg button').forEach(b => b.classList.toggle('on', b === el)); S.local.tema = el.dataset.v; persist(); aplicarTema(true); },
  'carpetas-on': el => conSw(el, () => { S.local.carpetasOn = !S.local.carpetasOn; persist(); pintarAjustes(); pintarPermisos(); }),
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
  'aviso-suave': el => conSw(el, () => guardarAjustes({ avisoSuaveDias: S.ajustes.avisoSuaveDias > 0 ? 0 : 3 })),
  'alarma-cal': el => conSw(el, () => guardarAjustes({ alarmaCalendario: !S.ajustes.alarmaCalendario })),
  vivo: el => conSw(el, () => { S.local.vivo = !S.local.vivo; persist(); pintarAjustes(); }),
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
  'perm-avisos': async () => { await activarAvisos(); pintarPermisos(); },
  // nuevo
  'crear-carpeta': (el, e) => {
    e.stopPropagation();
    const c = el.dataset.c, b = S.borrador; if (!b) return;
    if (S.carpetas.length >= 8) return toast('Ya tienes 8 carpetas. Borra alguna en Ajustes para crear otra.');
    borradorPaso();
    if (!S.carpetas.includes(c)) { S.carpetas.push(c); persist(); if (S.cfg) encolar({ accion: 'carpetas', carpetas: S.carpetas }); }
    b.ideas.forEach(i => { if (i.carpetaNueva === c) { i.carpeta = c; delete i.carpetaNueva; } });
    vib(); pintarResultado(); toast('Carpeta «' + c + '» creada.');
  },
  vista: el => { S.local.vistaCosas = el.dataset.v; persist(); salirSel(); vib(); pintarCajones(true); $('#drawers').scrollTop = 0; },
  'pop-cerrar': () => cerrarPop(),
  'pop-editar': () => { const id = POP.id; cerrarPop(); abrirIdea({ tipo: 'guardada', id }); },
  'pop-borrar': () => { const { id, fila } = POP; cerrarPop(); vib(); borrarFila(fila, id); },
  'pop-hoy': () => { const { id, fila } = POP; cerrarPop(); vib(); soltarOlvidar(fila, id); },
  'pop-sel': () => { const { id, fila } = POP; cerrarPop(); entrarSel(fila.closest('#sh-cosas') ? 'cosas' : 'lista', id); },
  'pop-mover': () => { const { id } = POP; cerrarPop(); menuMover([id]); },
  'mover-a': el => moverA(el.dataset.k, el.dataset.v),
  'sel-on': el => entrarSel(el.closest('#sh-cosas') ? 'cosas' : 'lista'),
  'sel-off': () => salirSel(),
  'sel-todo': () => {
    const filas = filasSel(), todas = filas.length && filas.every(f => SEL.ids.has(f.dataset.id));
    filas.forEach(f => todas ? SEL.ids.delete(f.dataset.id) : SEL.ids.add(f.dataset.id));
    vib(); marcarSel();
  },
  'sel-borrar': () => {
    const ids = [...SEL.ids]; if (!ids.length) return;
    filasSel().filter(f => SEL.ids.has(f.dataset.id)).forEach(encoger);
    vib();
    setTimeout(() => { lote(ids.map(id => OP.quitar(id))); salirSel(); toast(ids.length === 1 ? 'Borrada' : `${ids.length} borradas`, 'Deshacer', () => deshacer('lista')); }, 300);
  },
  'sel-hecho': () => {
    const ids = [...SEL.ids].filter(id => { const i = buscar(id); return i && i.cat !== 'olvidar'; }); if (!ids.length) return toast('Lo de Olvidar no se hace: se borra o se pasa a Hoy.');
    vib();
    lote(ids.map(id => { const i = buscar(id);
      if (i.repetir) return OP.cambiar(id, { aviso: proximaVez(i), hecho: false, items: (i.items || []).map(x => Object.assign({}, x, { hecho: false })) });
      return OP.cambiar(id, i.items && i.items.length ? { hecho: true, items: i.items.map(x => Object.assign({}, x, { hecho: true })) } : { hecho: true }); }));
    salirSel(); toast(ids.length === 1 ? 'Hecha' : `${ids.length} hechas`, 'Deshacer', () => deshacer('lista'));
  },
  'sel-mover': () => { if (SEL.ids.size) menuMover([...SEL.ids]); },
  revisar: el => conSw(el, () => { S.local.sinRevisar = !S.local.sinRevisar; persist(); pintarAjustes(); }),
  foto: () => $('#foto-tareas').click(),
  grupo: el => { S.grupo = el.dataset.v; vib(); const p = paneActual(); if (p) { p.innerHTML = paneHTML(S.cat); p.querySelectorAll('[data-gem]').forEach(pintarGema); const it = p.querySelector('.items'); if (it && !reduceMotion()) { [...it.children].forEach((e, k) => e.style.setProperty('--i', Math.min(k, 8))); it.classList.add('enter'); } } },
  item: (el, e) => { e.stopPropagation(); marcarItem(el.dataset.id || (ideaActual() || {}).id, el.dataset.item, el); },
  'item-quitar': el => { const i = ideaActual(); cambiarItems((i.items || []).filter(x => x.id !== el.dataset.item)); },
  'item-add': () => {
    const inp = $('#item-nuevo'), v = inp.value.trim(); if (!v) return;
    const i = ideaActual();
    const zona = esCompra(i) ? ((S.habituales.find(h => norm(h.t) === norm(v)) || {}).zona || 'Otros') : undefined;
    cambiarItems((i.items || []).concat([{ id: uid(), t: cap(v), hecho: false, zona }]));
    setTimeout(() => { const n = $('#item-nuevo'); if (n) n.focus(); }, 30);
  },
  habitual: el => {
    const t = el.dataset.t, ya = S.habituales.some(h => norm(h.t) === norm(t));
    S.habituales = ya ? S.habituales.filter(h => norm(h.t) !== norm(t)) : S.habituales.concat([{ t, zona: el.dataset.z || 'Otros' }]);
    persist(); if (S.cfg) encolar({ accion: 'habituales', habituales: S.habituales });
    el.classList.toggle('on', !ya); el.innerHTML = ICO2.star(!ya); vib();
    toast(ya ? 'Ya no es de siempre.' : 'Guardado como de siempre.');
  },
  'habitual-add': el => { const i = ideaActual(); cambiarItems((i.items || []).concat([{ id: uid(), t: el.dataset.t, hecho: false, zona: el.dataset.z || 'Otros' }])); },
  'compartir-lista': () => compartirLista(ideaActual()),
  'idea-repetir': el => {
    const i = ideaActual(), r = reglaPara(el.dataset.v, i);
    const cambios = { repetir: r };
    if (r) cambios.aviso = siguienteRepeticion(r, isoLocal(new Date()), true);
    cambiarIdea(cambios);
    $('#idea-rec') && cambiaTexto($('#idea-rec'), (ideaActual().aviso ? cap(fechaCorta(ideaActual().aviso)) : 'No') + ' ›');
  },
  quien: el => {
    const c = ideaActual().contactos[+el.dataset.k];
    el.parentElement.innerHTML = c.opciones.map(p => `<a class="actb" href="tel:${esc(tel(p.tel))}">${ICO2.phone}${esc(p.nombre)}</a><a class="actb" href="https://wa.me/${esc(tel(p.tel).replace('+', ''))}" target="_blank" rel="noopener">${ICO2.wa}WhatsApp</a>`).join('');
  },
  'ver-foto': el => verFoto(el.dataset.f),
  hechas: () => ir('s-hecho', 'push'),
  deshecho: el => { const id = el.dataset.id; const ck = el.querySelector('.ck'); if (ck) ck.classList.remove('done'); vib();
    setTimeout(() => { const i = buscar(id); hacer(OP.cambiar(id, i.items && i.items.length ? { hecho: false, items: i.items.map(x => Object.assign({}, x, { hecho: false })) } : { hecho: false })); pintarHechas(); toast('Vuelve a ' + NOMBRE[i.cat] + '.'); }, 350); },
  'olv-mas': el => { const id = el.dataset.id; hacer(OP.cambiar(id, { pospuesto: Date.now() })); quitarFilaOlvidar(id); },
  'olv-borrar': el => { const id = el.dataset.id; hacer(OP.quitar(id)); quitarFilaOlvidar(id); toast('Borrado', 'Deshacer', () => deshacer('lista')); },
  'olv-borrar-todo': () => { const ids = olvidarViejas().map(i => i.id); const ops = ids.map(id => OP.quitar(id));
    hacer({ do: () => ops.forEach(o => o.do()), undo: () => ops.forEach(o => o.undo()) }); cerrarTarjetaOlvidar(); toast('Borrado', 'Deshacer', () => deshacer('lista')); },
  personas: () => ir('s-per', 'push'),
  alumnos: async () => {
    if (!S.cfg) return toast('Conecta tu Google primero.');
    try { const r = await api('hola'); alert(`Tienes ${r.alumnos} alumnos en la pestaña «Alumnos» de tu hoja de Posso.\n\nSolo sirven para el modo cuidado: esos nombres se quitan de los correos antes de que lleguen a Gemini, y nunca se envían.\n\nPara añadirlos, abre la hoja y pega un nombre por fila.`); if (r.hoja) window.open(r.hoja, '_blank'); }
    catch (e) { toast(e.message); }
  },
  correo: el => conSw(el, () => guardarAjustes({ correoActivo: S.ajustes.correoActivo === false })),
  repaso: el => conSw(el, () => guardarAjustes({ repasoDomingo: S.ajustes.repasoDomingo === false })),
  puente: () => alert('Para cada cuenta de Gmail extra (máster, @educacion.navarra.es…) se instala una vez el mini-script «Posso puente». Los pasos están en la guía de instalación, apartado «Posso puente».\n\nEn @educacion.navarra.es usa el modo cuidado: solo llega el asunto, sin nombres de alumnos.'),
  persona: el => {
    const p = personasCache.find(x => x.nombre === el.dataset.n); if (!p) return;
    const nombre = prompt('Nombre (déjalo vacío para quitar a esta persona)', p.nombre); if (nombre === null) return;
    if (!nombre.trim()) { personasCache = personasCache.filter(x => x !== p); return guardarPersonasYa(); }
    const alias = prompt('Cómo le llamas al hablar (separado por comas)', p.alias); if (alias === null) return;
    const t = prompt('Teléfono', p.tel); if (t === null) return;
    Object.assign(p, { nombre: nombre.trim(), alias: alias.trim(), tel: t.trim() }); guardarPersonasYa();
  },
  'persona-nueva': () => {
    const nombre = (prompt('Nombre') || '').trim(); if (!nombre) return;
    const alias = (prompt('Cómo le llamas al hablar (ama, aita, hermano…). Separado por comas.') || '').trim();
    const t = (prompt('Teléfono') || '').trim();
    personasCache.push({ nombre, alias, tel: t }); guardarPersonasYa();
  },
  'importar-contactos': () => importarContactos(),
  'imp-todos': () => $$('#imp-lista input:not([disabled])').forEach(c => c.checked = true),
  'imp-ok': () => {
    const cs = $('#per-body')._contactos || [];
    $$('#imp-lista input:checked:not([disabled])').forEach(c => { const x = cs[+c.dataset.k]; personasCache.push({ nombre: x.nombre, alias: '', tel: x.tel }); });
    guardarPersonasYa();
  }
};

document.addEventListener('click', e => {
  if (arrastrando) return;      // el clic que llega justo al soltar una pulsación larga o un arrastre no cuenta
  if (SEL.on && !e.target.closest('#selbar,#pop,#pop-scrim,.sel-btn,#vista-tg')) {
    const f = e.target.closest('[data-sel]');
    if (f && f.closest(SEL.donde === 'cosas' ? '#sh-cosas' : '#s-list')) {
      e.preventDefault();
      SEL.ids.has(f.dataset.id) ? SEL.ids.delete(f.dataset.id) : SEL.ids.add(f.dataset.id);
      vib(); marcarSel();
    }
    if (!e.target.closest('.atras,[data-act="atras"],[data-act="cerrar-cosas"]')) return;
  }
  const el = e.target.closest('[data-act]');
  if (!el || el.closest('[disabled]') || arrastrando) return;
  if (el.tagName === 'A') return;
  const f = ACT[el.dataset.act]; if (f) f(el, e);
});
$('#writebox').addEventListener('input', contarIdeas);

// la gema se hunde un poco al tocarla
document.addEventListener('pointerdown', e => { const g = e.target.closest('.gem.tap'); if (g) g.classList.add('press'); });
['pointerup', 'pointercancel', 'pointerleave'].forEach(t => document.addEventListener(t, () => $$('.gem.press').forEach(g => g.classList.remove('press'))));

// ---------- mantener pulsada una tarea: sale un menú al lado ----------
function abrirPop(fila) {
  const id = fila.dataset.id, i = buscar(id); if (!i) return;
  cerrarPop();
  POP.id = id; POP.fila = fila;
  const olv = i.cat === 'olvidar';
  const pop = $('#pop');
  pop.innerHTML = `
    <button data-act="pop-editar">Abrir${ICO3.abrir}</button>
    <button data-act="pop-sel">Seleccionar varias${ICO3.sel}</button>
    <button data-act="pop-mover">Mover a…${ICO3.mover}</button>
    ${olv ? `<button data-act="pop-hoy">Pasar a Hoy${ICO3.hoy}</button>` : ''}
    <button data-act="pop-borrar" class="del">Borrar${ICO3.borrar}</button>`;
  colocarPop(fila);
  fila.classList.add('levantada');
  $('#pop-scrim').classList.add('on');
  vib();
}
/** El menú sale debajo de la tarea, alineado a la derecha; si no cabe, encima */
function colocarPop(ancla) {
  const pop = $('#pop'), app = $('#app').getBoundingClientRect(), r = ancla.getBoundingClientRect();
  pop.style.visibility = 'hidden'; pop.classList.add('on');
  const h = pop.offsetHeight, w = pop.offsetWidth;
  let top = r.bottom - app.top + 6, origen = 'top';
  if (top + h > app.height - 24) { top = r.top - app.top - h - 6; origen = 'bottom'; }
  top = Math.max(12, top);
  const left = Math.max(12, Math.min(app.width - w - 12, r.right - app.left - w - 10));
  Object.assign(pop.style, { top: top + 'px', left: left + 'px', transformOrigin: `${origen} right`, visibility: '' });
}
function cerrarPop() {
  $('#pop').classList.remove('on'); $('#pop-scrim').classList.remove('on');
  $$('.levantada').forEach(f => f.classList.remove('levantada'));
  POP.id = null; POP.fila = null;
}
function menuMover(ids) {
  const i0 = ids.length === 1 ? buscar(ids[0]) : null;
  const pop = $('#pop');
  pop.innerHTML = `<div class="pop-t">Cuándo</div>` +
    CATS.map(c => `<button data-act="mover-a" data-k="cat" data-v="${c}" class="${i0 && i0.cat === c ? 'on' : ''}"><span class="pdot" style="background:var(--v-${c})"></span>${NOMBRE[c]}</button>`).join('') +
    `<div class="pop-t">Carpeta</div>` +
    S.carpetas.map(n => `<button data-act="mover-a" data-k="carpeta" data-v="${esc(n)}" class="${i0 && i0.carpeta === n ? 'on' : ''}">${esc(n)}</button>`).join('') +
    `<button data-act="mover-a" data-k="carpeta" data-v="" class="${i0 && !i0.carpeta ? 'on' : ''}">Sin carpeta</button>`;
  pop.dataset.ids = ids.join(',');
  const ancla = SEL.on ? $('#selbar') : (document.querySelector(`[data-sel][data-id="${ids[0]}"]`) || $('#selbar'));
  if (ancla.id === 'selbar') {
    pop.style.visibility = 'hidden'; pop.classList.add('on');
    const app = $('#app').getBoundingClientRect();
    Object.assign(pop.style, { left: (app.width - pop.offsetWidth - 16) + 'px', top: Math.max(12, ancla.getBoundingClientRect().top - app.top - pop.offsetHeight - 8) + 'px', transformOrigin: 'bottom right', visibility: '' });
  } else colocarPop(ancla);
  $('#pop-scrim').classList.add('on'); vib();
}
function moverA(campo, valor) {
  const ids = ($('#pop').dataset.ids || '').split(',').filter(id => buscar(id));
  cerrarPop(); if (!ids.length) return;
  const ops = ids.filter(id => (buscar(id)[campo] || '') !== valor).map(id => OP.cambiar(id, { [campo]: valor }));
  if (ops.length) lote(ops);
  if (SEL.on) salirSel();
  vib();
  toast(`${ids.length === 1 ? 'Movida' : ids.length + ' movidas'} a ${campo === 'cat' ? NOMBRE[valor] : valor || 'Sin carpeta'}`, ops.length ? 'Deshacer' : '', () => deshacer('lista'));
}
/** Varias operaciones como una sola: se deshacen de golpe */
function lote(ops) {
  hacer({ do: () => ops.forEach(o => o.do()), undo: () => ops.slice().reverse().forEach(o => o.undo()) });
  refrescarLista(); refrescarCosas();
}

// ---------- Editar: elegir varias a la vez ----------
const filasSel = () => $$(SEL.donde === 'cosas' ? '#drawers [data-sel]' : '#s-list .pane [data-sel]').filter(f => !f.classList.contains('done') && !f.classList.contains('collapse'));
function entrarSel(donde, id) {
  if (donde === 'cosas' && S.local.vistaCosas !== 'carpetas') { S.local.vistaCosas = 'carpetas'; persist(); }
  SEL.on = true; SEL.donde = donde; SEL.ids = new Set(id ? [id] : []);
  document.body.classList.add('seleccionando');
  $('#app').dataset.sel = donde;
  vib();
  if (donde === 'cosas') pintarCajones(false); else { const p = paneActual(); if (p) { p.innerHTML = paneHTML(S.cat); p.querySelectorAll('[data-gem]').forEach(pintarGema); } }
  marcarSel();
  $('#selbar').classList.add('on');
}
function salirSel() {
  if (!SEL.on) return;
  const donde = SEL.donde;
  SEL.on = false; SEL.ids = new Set();
  document.body.classList.remove('seleccionando'); delete $('#app').dataset.sel;
  $('#selbar').classList.remove('on');
  $$('[data-sel].sel').forEach(f => f.classList.remove('sel'));
  if (donde === 'cosas') refrescarCosas(); else { const p = paneActual(); if (p) { p.innerHTML = paneHTML(S.cat); p.querySelectorAll('[data-gem]').forEach(pintarGema); } }
}
function marcarSel() {
  if (!SEL.on) return;
  const filas = filasSel(), hay = new Set(filas.map(f => f.dataset.id));
  [...SEL.ids].forEach(id => { if (!hay.has(id)) SEL.ids.delete(id); });
  filas.forEach(f => f.classList.toggle('sel', SEL.ids.has(f.dataset.id)));
  const n = SEL.ids.size;
  $('#sel-n').textContent = n ? `${n} ${n === 1 ? 'elegida' : 'elegidas'}` : 'Elige tareas';
  $('#sel-todo').textContent = filas.length && filas.every(f => SEL.ids.has(f.dataset.id)) ? 'Ninguna' : 'Todas';
  $$('#selbar .sa').forEach(b => b.disabled = !n);
}

(function pulsacionLarga() {
  let t = 0, x = 0, y = 0;
  document.addEventListener('pointerdown', e => {
    clearTimeout(t); t = 0;
    if (SEL.on) return;
    const f = e.target.closest('#s-list .task:not(.done), #drawers .crow');
    if (!f || e.target.closest('[data-act="hecho"]')) return;
    x = e.clientX; y = e.clientY;
    t = setTimeout(() => { t = 0; arrastrando = true; abrirPop(f); setTimeout(() => arrastrando = false, 400); }, 450);
  }, { passive: true });
  document.addEventListener('pointermove', e => { if (t && Math.hypot(e.clientX - x, e.clientY - y) > 8) { clearTimeout(t); t = 0; } }, { passive: true });
  ['pointerup', 'pointercancel'].forEach(n => document.addEventListener(n, () => { clearTimeout(t); t = 0; }));
  document.addEventListener('contextmenu', e => { if (e.target.closest('#s-list .task, #drawers .crow')) e.preventDefault(); });
})();

// ---------- gestos ----------
// · deslizar una fila: a la izquierda borra; en Olvidar, a la derecha pasa a Hoy
// · deslizar en cualquier parte de una categoría: pasa a la de al lado, como tarjetas
// · hojas: siguen al dedo; se cierran arrastrando hacia abajo desde cualquier parte si su contenido está arriba del todo
// · inicio: arrastrar hacia arriba abre «Tus cosas» siguiendo el dedo
let arrastrando = false;
(function gestos() {
  let g = null;
  const BORDE = 28;
  const velocidad = () => {               // px/ms en el último tramo
    const s = g.muestras, a = s[0], b = s[s.length - 1];
    const dt = Math.max(1, b.t - a.t);
    return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt };
  };
  const scrollArriba = el => !el || el.scrollTop <= 0;

  document.addEventListener('pointerdown', e => {
    if (e.button > 0 || deslizando) return;
    const t = e.target;
    if (POP.id || $('#pop').classList.contains('on')) { g = null; return; }
    if (SEL.on && !t.closest('#sh-cosas')) { g = null; return; }
    if (t.closest('input,textarea,select')) return;
    const enApp = $('#app').getBoundingClientRect();
    const x = e.clientX - enApp.left;
    g = { x: e.clientX, y: e.clientY, dx: 0, dy: 0, eje: null, modo: null, t: Date.now(), muestras: [{ x: e.clientX, y: e.clientY, t: Date.now() }] };
    // ¿qué puede mover este dedo?
    const cosas = $('#sh-cosas'), idea = $('#sh-idea');
    if (idea.classList.contains('on') && t.closest('#sh-idea')) { g.hoja = { el: idea, scrim: $('#scrim-idea'), scroll: idea, cerrar: () => cerrarIdea() }; return; }
    if (cosas.classList.contains('on') && t.closest('#sh-cosas')) { g.hoja = { el: cosas, scrim: $('#scrim-cosas'), scroll: $('#drawers'), cerrar: () => cerrarHoja('sh-cosas') }; return; }
    const scr = t.closest('.screen.hojascr');
    if (scr && scr === actual) { g.hoja = { el: scr, scrim: $('#scrim-scr'), scroll: scr.querySelector('.scroll'), pantalla: true }; return; }
    if (actual && actual.id === 's-home' && !cosas.classList.contains('on') && !t.closest('.gem,.kbd,.ajustes-btn')) { g.abrirCosas = true; return; }
    if (actual && actual.id === 's-list' && t.closest('#list-body')) {
      g.lista = true;
      g.borde = x < BORDE || x > enApp.width - BORDE;
      g.front = !g.borde && t.closest('.task .front');
    }
  }, { passive: true });

  document.addEventListener('pointermove', e => {
    if (!g) return;
    g.dx = e.clientX - g.x; g.dy = e.clientY - g.y;
    g.muestras.push({ x: e.clientX, y: e.clientY, t: Date.now() });
    if (g.muestras.length > 6) g.muestras.shift();
    if (!g.eje) {
      if (Math.hypot(g.dx, g.dy) < 8) return;
      g.eje = Math.abs(g.dx) > Math.abs(g.dy) ? 'x' : 'y';     // la dirección se decide en los primeros píxeles
      // qué gesto es
      if (g.hoja && g.eje === 'y' && g.dy > 0 && scrollArriba(g.hoja.scroll)) g.modo = 'hoja';
      else if (g.abrirCosas && g.eje === 'y' && g.dy < 0) {
        g.modo = 'subir';
        pintarCajones(false);
        const sh = $('#sh-cosas'); sh.classList.add('drag'); g.alto = sh.offsetHeight;
      }
      else if (g.lista && g.eje === 'x') {
        {
          g.modo = 'cat';
          const body = $('#list-body'); g.w = body.clientWidth; g.k = CATS.indexOf(S.cat);
          g.cur = paneActual();
          body.querySelectorAll('.pane').forEach(p => { if (p !== g.cur) p.remove(); });
          g.prev = g.k > 0 ? nuevoPane(CATS[g.k - 1]) : null;
          g.next = g.k < CATS.length - 1 ? nuevoPane(CATS[g.k + 1]) : null;
          [g.prev, g.next].forEach(p => p && body.appendChild(p));
        }
      }
      if (g.modo) arrastrando = true;
    }
    if (g.modo === 'hoja') {
      const d = Math.max(0, g.dy), el = g.hoja.el;
      el.classList.add('drag'); el.style.transition = 'none';
      el.style.transform = `translateY(${d}px)`;
      g.hoja.scrim.style.transition = 'none';
      g.hoja.scrim.style.opacity = String(Math.max(0, 1 - d / (el.offsetHeight || 600)));
    }
    if (g.modo === 'subir') {
      const sh = $('#sh-cosas'), sc = $('#scrim-cosas');
      const y = Math.max(0, g.alto + Math.min(0, g.dy));
      sh.style.transform = `translateY(${y}px)`;
      sc.classList.add('on'); sc.style.transition = 'none'; sc.style.opacity = String(1 - y / g.alto);
    }
    if (g.modo === 'fila') {
      const olv = g.front.parentElement.classList.contains('olv');
      const dx = olv ? g.dx : Math.min(0, g.dx);
      g.front.style.transform = `translateX(${dx}px)`;
      const del = g.front.parentElement.querySelector('.under.del'), go = g.front.parentElement.querySelector('.under.go');
      if (del) del.style.opacity = dx < 0 ? Math.min(1, -dx / 40) : 0;
      if (go) go.style.opacity = dx > 0 ? Math.min(1, dx / 40) : 0;
    }
    if (g.modo === 'cat') {
      let off = g.dx;
      if ((off > 0 && !g.prev) || (off < 0 && !g.next)) off = off * .28;   // resistencia en los extremos
      g.off = off;
      g.cur.style.transform = `translateX(${off}px)`;
      if (g.prev) g.prev.style.transform = `translateX(${off - g.w}px)`;
      if (g.next) g.next.style.transform = `translateX(${off + g.w}px)`;
      ponSwitcher(Math.max(0, Math.min(3, g.k - off / g.w)), false);
    }
  }, { passive: true });

  const fin = () => {
    if (!g) return;
    const v = g.muestras.length > 1 ? velocidad() : { vx: 0, vy: 0 };
    const gg = g; g = null;
    setTimeout(() => arrastrando = false, 40);
    if (!gg.modo) return;

    if (gg.modo === 'hoja') {
      const el = gg.hoja.el, alto = el.offsetHeight || 600;
      const cierra = gg.dy > alto * .28 || v.vy > .55;
      el.classList.remove('drag'); el.style.transition = ''; gg.hoja.scrim.style.transition = '';
      if (cierra) {
        vib();
        if (gg.hoja.pantalla) {
          el.style.transition = 'transform .3s cubic-bezier(.4,0,.6,1)';
          requestAnimationFrame(() => { el.style.transform = 'translateY(105%)'; });
          gg.hoja.scrim.style.opacity = '';
          atras({ yaFuera: true });
        } else { gg.hoja.scrim.style.opacity = ''; gg.hoja.cerrar(); }
      } else {
        el.style.transition = 'transform .45s cubic-bezier(.3,1.25,.5,1)';
        el.style.transform = '';
        gg.hoja.scrim.style.opacity = '';
        setTimeout(() => { el.style.transition = ''; }, 460);
      }
    }
    if (gg.modo === 'subir') {
      const sh = $('#sh-cosas'), sc = $('#scrim-cosas');
      const abre = -gg.dy > gg.alto * .22 || v.vy < -.45;
      sh.classList.remove('drag'); sc.style.transition = '';
      sh.style.transform = ''; sc.style.opacity = '';
      if (abre) { sh.classList.add('on'); vib(); const d = $('#drawers'); d.classList.remove('enter'); void d.offsetWidth; d.classList.add('enter'); }
      else sc.classList.remove('on');
    }
    if (gg.modo === 'fila') {
      const task = gg.front.parentElement, id = task.dataset.id;
      gg.front.classList.add('snap');
      if (gg.dx < -90 || (gg.dx < -40 && v.vx < -.6)) { gg.front.style.transform = 'translateX(-110%)'; vib(); borrarFila(task, id); }
      else if (task.classList.contains('olv') && (gg.dx > 90 || (gg.dx > 40 && v.vx > .6))) { gg.front.style.transform = 'translateX(110%)'; vib(); soltarOlvidar(task, id); }
      else { gg.front.style.transform = ''; setTimeout(() => { gg.front.classList.remove('snap'); task.querySelectorAll('.under').forEach(u => u.style.opacity = 0); }, 300); }
    }
    if (gg.modo === 'cat') {
      const off = gg.off || 0, w = gg.w;
      let go = 0;
      if ((off < -w * .22 || (v.vx < -.4 && off < -20)) && gg.next) go = 1;
      else if ((off > w * .22 || (v.vx > .4 && off > 20)) && gg.prev) go = -1;
      if (go) {
        const sig = go > 0 ? gg.next : gg.prev, otro = go > 0 ? gg.prev : gg.next;
        if (otro) otro.remove();
        // la animación sigue desde donde lo dejó el dedo
        gg.cur.style.transform = ''; sig.style.transform = '';
        irACat(CATS[gg.k + go], off, v.vx);
      } else {
        // vuelve a su sitio
        const ease = 'cubic-bezier(.3,1.2,.5,1)';
        gg.cur.animate([{ transform: `translateX(${off}px)` }, { transform: 'translateX(0)' }], { duration: 360, easing: ease });
        gg.cur.style.transform = '';
        [gg.prev, gg.next].forEach((p, i) => {
          if (!p) return;
          const base = i === 0 ? -w : w;
          p.style.transform = `translateX(${base}px)`;
          p.animate([{ transform: `translateX(${off + base}px)` }, { transform: `translateX(${base}px)` }], { duration: 360, easing: ease })
            .finished.then(() => p.remove()).catch(() => p.remove());
        });
        ponSwitcher(gg.k, true);
      }
    }
  };
  document.addEventListener('pointerup', fin);
  document.addEventListener('pointercancel', fin);
})();

// =====================================================================
// 15b · LISTAS, PERSONAS, LUGARES, FOTOS, REPETICIONES, COMPARTIR…
// =====================================================================

// ---------- títulos con palabra clave, grupo, personas y rayo ----------
const BOLT = '<svg class="bolt" width="9" height="13" viewBox="0 0 9 13" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round" aria-label="Rápida"><path d="M5.2 1L1.2 7.3h3l-.7 4.7 4.2-6.6H4.6z"/></svg>';
const ICO3 = {
  abrir: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 3.5h4v4M14.5 3.5L8 10M12.5 10.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3"/></svg>',
  sel: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="9" r="6.5"/><path d="M6.2 9.2l1.9 1.9 3.7-3.9"/></svg>',
  mover: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 5.5A1.5 1.5 0 0 1 4 4h3l1.5 1.5H14a1.5 1.5 0 0 1 1.5 1.5v5.5A1.5 1.5 0 0 1 14 14H4a1.5 1.5 0 0 1-1.5-1.5z"/><path d="M7.5 9.6h4M9.9 7.8l1.7 1.8-1.7 1.8"/></svg>',
  hoy: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="9" r="3.2"/><path d="M9 1.8v1.6M9 14.6v1.6M1.8 9h1.6M14.6 9h1.6M3.9 3.9l1.1 1.1M13 13l1.1 1.1M3.9 14.1L5 13M13 5l1.1-1.1"/></svg>',
  borrar: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 5.5h13M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M5.5 5.5l.8 10.2a1.5 1.5 0 0 0 1.5 1.3h4.4a1.5 1.5 0 0 0 1.5-1.3l.8-10.2"/></svg>'
};
const ICO2 = {
  phone: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.2 1.8h2.3l1.1 3-1.5 1a7.5 7.5 0 0 0 3.6 3.6l1-1.5 3 1.1v2.3a1.4 1.4 0 0 1-1.5 1.4A11.6 11.6 0 0 1 1.8 3.3a1.4 1.4 0 0 1 1.4-1.5z"/></svg>',
  wa: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.3 13.7l.8-2.8A6.2 6.2 0 1 1 5.4 13z"/><path d="M6 5.6c0 2.3 1.9 4.3 4.3 4.4l.8-1-1.4-.7-.6.6a3.4 3.4 0 0 1-1.7-1.7l.6-.6-.7-1.4-1 .4z"/></svg>',
  pin: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 14.5s4.8-4.4 4.8-8.1a4.8 4.8 0 0 0-9.6 0c0 3.7 4.8 8.1 4.8 8.1z"/><circle cx="8" cy="6.4" r="1.7"/></svg>',
  cam: '<svg width="19" height="16" viewBox="0 0 19 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M1.5 4.8a1.6 1.6 0 0 1 1.6-1.6h2.5L7 1.3h5l1.4 1.9h2.5a1.6 1.6 0 0 1 1.6 1.6v8.3a1.6 1.6 0 0 1-1.6 1.6H3.1a1.6 1.6 0 0 1-1.6-1.6z"/><circle cx="9.5" cy="8.6" r="3"/></svg>',
  rep: '<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M10.2 5.2A4.3 4.3 0 0 0 2.4 3.6M1.8 6.8a4.3 4.3 0 0 0 7.8 1.6"/><path d="M2.2 1.4v2.4h2.4M9.8 10.6V8.2H7.4"/></svg>',
  nota: '<svg width="11" height="12" viewBox="0 0 11 12" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"><path d="M1.5 1h5.5l2.5 2.5V11h-8z"/><path d="M3.5 5.5h4M3.5 7.5h4M3.5 9.3h2.5" stroke-linecap="round"/></svg>',
  link: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6.6 9.4l2.8-2.8M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1"/></svg>',
  share: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 10V1.8M5 4.6l3-2.9 3 2.9M3.5 7.5v5.3a1.2 1.2 0 0 0 1.2 1.2h6.6a1.2 1.2 0 0 0 1.2-1.2V7.5"/></svg>',
  star: on => `<svg width="15" height="15" viewBox="0 0 16 16" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M8 1.6l1.9 4 4.3.5-3.2 3 .9 4.3L8 11.3l-3.9 2.1.9-4.3-3.2-3 4.3-.5z"/></svg>`,
  x: '<svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2 2l6 6M8 2L2 8"/></svg>'
};

/** Nombres de personas destacados dentro del título */
function marcarPersonas(txt, i) {
  let h = esc(txt);
  (i.personas || []).forEach(p => {
    if (!p || p.length < 2) return;
    const re = new RegExp('(^|[^\\wáéíóúñ])(' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?=$|[^\\wáéíóúñ])', 'gi');
    h = h.replace(re, '$1<span class="per">$2</span>');
  });
  return h;
}
function tituloHTML(i, corto) {
  const grp = i.grupo ? `<span class="grp">${esc(i.grupo)}</span>` : '';
  let t;
  if (i.tipo === 'lista') {
    const n = (i.items || []).filter(x => !x.hecho).length;
    t = `<b class="kw">${esc(i.clave || i.titulo)}:</b>` + (corto ? ` <span class="kwn">${n ? (n === 1 ? '1 cosa' : n + ' cosas') : 'todo hecho'}</span>` : '');
  } else if (i.tipo === 'receta') {
    t = `<b class="kw">${esc(i.titulo)}</b>`;
  } else t = marcarPersonas(i.titulo, i);
  return grp + t + (i.rapida ? ' ' + BOLT : '') + (i.tipo === 'nota' ? ' <span class="notai">' + ICO2.nota + '</span>' : '');
}
function textoRepetir(r) {
  if (!r) return '';
  const D = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'], h = r.hora || '9:00';
  const hh = h.replace(/^0/, '');
  if (r.tipo === 'diaria') return 'Cada día ' + hh;
  if (r.tipo === 'laborables') return 'Lun–Vie ' + hh;
  if (r.tipo === 'semanal') return (r.dias || [1]).map(d => D[d]).join(', ') + ' ' + hh;
  if (r.tipo === 'cadaN') return 'Cada ' + (r.n || 1) + ' días';
  if (r.tipo === 'mensualDia') return 'Día ' + (r.dia || 1) + ' de cada mes';
  if (r.tipo === 'mensualOrdinal') return (r.ordinal === -1 ? 'Último ' : ['', '1.er ', '2.º ', '3.er ', '4.º '][r.ordinal || 1]) + D[r.diaSemana || 1].toLowerCase() + ' del mes';
  return '';
}
const fechaDia = s => { const d = deIso(s.length === 10 ? s + 'T09:00' : s); return d.getDate() + ' ' + MESES[d.getMonth()]; };

// ---------- sublistas ----------
const ORDEN_ZONAS = ['Frutería', 'Panadería', 'Carnicería y charcutería', 'Pescadería', 'Lácteos y huevos', 'Despensa',
  'Congelados', 'Bebidas', 'Droguería y limpieza', 'Higiene', 'Mascotas y acuario', 'Otros'];
const esCompra = i => i.tipo === 'lista' && /compra/i.test(i.clave || i.titulo);
function subHTML(i, editable) {
  const items = i.items || [];
  if (!items.length) return editable ? '' : '';
  const fila = x => `<div class="si${x.hecho ? ' done' : ''}" data-item="${esc(x.id)}">
      <button class="subck" data-act="item" data-id="${i.id}" data-item="${esc(x.id)}" aria-label="Marcar">${check(i.cat === 'olvidar' ? 'hoy' : catDe(i), x.hecho, 17)}</button>
      <span class="st">${esc(x.t)}</span>
      ${editable && esCompra(i) ? `<button class="star${S.habituales.some(h => norm(h.t) === norm(x.t)) ? ' on' : ''}" data-act="habitual" data-t="${esc(x.t)}" data-z="${esc(x.zona || '')}" aria-label="De siempre">${ICO2.star(S.habituales.some(h => norm(h.t) === norm(x.t)))}</button>` : ''}
      ${editable ? `<button class="subx" data-act="item-quitar" data-item="${esc(x.id)}" aria-label="Quitar">${ICO2.x}</button>` : ''}</div>`;
  if (esCompra(i)) {
    const g = {};
    items.forEach(x => (g[x.zona || 'Otros'] = g[x.zona || 'Otros'] || []).push(x));
    return Object.keys(g).sort((a, b) => ORDEN_ZONAS.indexOf(a) - ORDEN_ZONAS.indexOf(b))
      .map(z => `<div class="zona">${esc(z)}</div>` + g[z].sort((a, b) => a.hecho - b.hecho).map(fila).join('')).join('');
  }
  return items.map(fila).join('');
}
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^\d+\s*(x\s*)?/, '').trim();

function marcarItem(id, itemId, btn) {
  const i = buscar(id); if (!i) return;
  const x = (i.items || []).find(y => y.id === itemId); if (!x) return;
  const nuevo = !x.hecho;
  const fila = btn && btn.closest('.si');
  if (fila) { fila.classList.toggle('done', nuevo); const ck = fila.querySelector('.ck'); if (ck) { ck.classList.toggle('done', nuevo); ck.classList.remove('pop'); void ck.offsetWidth; ck.classList.add('pop'); } }
  vib();
  const antes = JSON.stringify(i.items);
  const aplicar = (items, hecho) => {
    const k = buscar(id); if (!k) return;
    k.items = items;
    if (!k.repetir) { k.hecho = hecho; k.hechoEn = hecho ? Date.now() : 0; }
    persist();
  };
  const items = (i.items || []).map(y => y.id === itemId ? Object.assign({}, y, { hecho: nuevo }) : y);
  const todos = items.every(y => y.hecho);
  const op = {
    do: () => { aplicar(items, todos); encolar({ accion: 'marcarItem', id, itemId, hecho: nuevo }); },
    undo: () => { aplicar(JSON.parse(antes), false); encolar({ accion: 'marcarItem', id, itemId, hecho: !nuevo }); }
  };
  setTimeout(() => {
    hacer(op);
    if ($('#sh-idea').classList.contains('on')) pintarSubEnHoja();
    if (actual && actual.id === 's-list') refrescarLista();
    if (todos && !i.repetir) toast(esCompra(i) ? 'Compra hecha.' : 'Una menos.');
  }, 380);
}

// ---------- hoja de una idea: piezas nuevas ----------
function tel(n) { let d = String(n || '').replace(/[^\d+]/g, ''); if (/^\d{9}$/.test(d)) d = '+34' + d; return d; }
function contactosHTML(i) {
  return (i.contactos || []).map((c, k) => {
    if (!c.opciones || !c.opciones.length) return `<div class="hint">No tengo el teléfono de «${esc(c.dicho)}». Lo puedes añadir en Ajustes › Personas.</div>`;
    if (c.opciones.length === 1) {
      const p = c.opciones[0];
      return `<div class="acts"><a class="actb" href="tel:${esc(tel(p.tel))}">${ICO2.phone}Llamar a ${esc(p.nombre)}</a>` +
        `<a class="actb" href="https://wa.me/${esc(tel(p.tel).replace('+', ''))}" target="_blank" rel="noopener">${ICO2.wa}WhatsApp</a></div>`;
    }
    return `<div class="acts"><button class="actb" data-act="quien" data-k="${k}">${ICO2.phone}¿A quién: ${c.opciones.map(o => esc(o.nombre)).join(' o ')}?</button></div>`;
  }).join('');
}
function mapsHTML(i) {
  if (!i.lugar || !i.lugar.q) return '';
  const q = encodeURIComponent(i.lugar.q);
  return `<div class="acts"><a class="actb" href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener">${ICO2.pin}${esc(i.lugar.tipo === 'sitio' ? i.lugar.q + ' más cercana' : i.lugar.q)}</a></div>`;
}
function fotosHTML(i, guardada) {
  const f = i.fotos || [];
  return `<div class="thumbs">${f.map(x => `<button class="thumb" data-act="ver-foto" data-f="${esc(x.id)}" style="background-image:url(${x.mini})" aria-label="Ver foto"></button>`).join('')}
    ${guardada && f.length < 3 ? `<label class="thumb add">${ICO2.cam}<input type="file" accept="image/*" id="foto-in" hidden></label>` : ''}</div>`;
}
function pintarSubEnHoja() {
  const i = ideaActual(), el = $('#idea-sub'); if (!i || !el) return;
  el.innerHTML = subHTML(i, true) + `<div class="si add"><input id="item-nuevo" placeholder="Añadir${esCompra(i) ? ' a la compra' : ''}…" enterkeyhint="done"><button data-act="item-add" class="subadd">Añadir</button></div>` + habitualesHTML(i);
  const inp = $('#item-nuevo'); if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ACT['item-add'](); } });
}
function habitualesHTML(i) {
  if (!esCompra(i) || !S.habituales.length) return '';
  const faltan = S.habituales.filter(h => !(i.items || []).some(x => !x.hecho && norm(x.t) === norm(h.t)));
  if (!faltan.length) return '';
  return `<div class="cap" style="margin:14px 0 8px">De siempre</div><div class="chips">${faltan.map(h =>
    `<button class="csel" data-act="habitual-add" data-t="${esc(h.t)}" data-z="${esc(h.zona || '')}">+ ${esc(h.t)}</button>`).join('')}</div>`;
}
function cambiarItems(items) {
  const r = S.idea, i = ideaActual(); if (!i) return;
  const todos = items.length && items.every(x => x.hecho);
  if (r.tipo === 'guardada') hacer(OP.cambiar(i.id, { items, hecho: !i.repetir && todos }));
  else { borradorPaso(); i.items = items; }
  pintarSubEnHoja();
  if (r.tipo === 'borrador' && actual && actual.id === 's-res') pintarResultado();
}
function repetirHTML(i) {
  const ops = [['', 'No'], ['diaria', 'Cada día'], ['laborables', 'De lunes a viernes'], ['semanal', 'Cada semana'], ['cadaN', 'Cada 15 días'], ['mensualOrdinal', 'Cada mes']];
  const t = i.repetir ? i.repetir.tipo : '';
  return `<div class="cap" style="margin:14px 0 8px">Repetir</div><div class="chips">${ops.map(([v, txt]) =>
    `<button class="csel${v === t ? ' on' : ''}" data-act="idea-repetir" data-v="${v}">${txt}</button>`).join('')}</div>
    ${i.repetir ? `<div class="hint">${ICO2.rep} ${esc(textoRepetir(i.repetir))} · al marcarla vuelve sola la próxima vez.</div>` : ''}`;
}
function reglaPara(tipo, i) {
  if (!tipo) return null;
  const base = i.aviso ? deIso(i.aviso) : new Date();
  const hora = i.aviso ? i.aviso.slice(11, 16) : '09:00';
  const dow = ((base.getDay() + 6) % 7) + 1;
  if (tipo === 'semanal') return { tipo, dias: [dow], hora };
  if (tipo === 'cadaN') return { tipo, n: 15, hora };
  if (tipo === 'mensualOrdinal') return { tipo, ordinal: Math.min(4, Math.ceil(base.getDate() / 7)), diaSemana: dow, hora };
  return { tipo, hora };
}

// ---------- marcar hecho una tarea que se repite ----------
function proximaVez(i) {
  const ahora = isoLocal(new Date());
  const desde = i.aviso && i.aviso > ahora ? i.aviso : ahora;
  return siguienteRepeticion(i.repetir, desde, false);
}

// ---------- lista compartida por enlace ----------
async function compartirLista(i) {
  if (!S.cfg) return toast('Para compartir la lista conecta tu Google.');
  try {
    toast('Preparando el enlace…');
    const r = await api('compartirLista', { id: i.id });
    const k = buscar(i.id); if (k) { k.compartir = r.token; persist(); }
    const pend = (i.items || []).filter(x => !x.hecho);
    const texto = `${i.clave || i.titulo}:\n` + pend.map(x => '• ' + x.t).join('\n') + `\n\nMárcalo aquí mientras compras: ${r.enlace}`;
    location.href = 'https://wa.me/?text=' + encodeURIComponent(texto);
  } catch (e) { toast('No he podido crear el enlace: ' + e.message); }
}

// ---------- fotos ----------
function reducirImagen(file, lado, calidad) {
  return new Promise((ok, ko) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, lado / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      ok(c.toDataURL('image/jpeg', calidad));
    };
    img.onerror = ko; img.src = url;
  });
}
async function anadirFoto(file) {
  const i = ideaActual(); if (!i || S.idea.tipo !== 'guardada') return;
  if (!S.cfg) return toast('Para guardar fotos conecta tu Google.');
  try {
    toast('Subiendo la foto…');
    const grande = await reducirImagen(file, 1600, .82), mini = await reducirImagen(file, 220, .6);
    const r = await api('subirFoto', { id: i.id, data: grande.split(',')[1], mini }, 60000);
    const k = buscar(i.id); if (k) { k.fotos = r.fotos; persist(); }
    $('#idea-fotos').innerHTML = fotosHTML(k, true);
    toast('Foto guardada en tu Drive.');
  } catch (e) { toast('No he podido subir la foto: ' + e.message); }
}
async function verFoto(fotoId) {
  const v = document.createElement('div'); v.className = 'visor';
  v.innerHTML = '<div class="visor-in">Cargando…</div>';
  $('#app').appendChild(v); requestAnimationFrame(() => v.classList.add('on'));
  v.addEventListener('click', () => { v.classList.remove('on'); setTimeout(() => v.remove(), 300); });
  try { const r = await api('foto', { fotoId }, 60000); v.innerHTML = `<img src="data:image/jpeg;base64,${r.data}" alt="">`; }
  catch (e) { v.innerHTML = '<div class="visor-in">No puedo abrir la foto ahora.</div>'; }
}
async function fotoATareas(file) {
  if (!S.cfg) return toast('Para leer fotos necesito tu Google conectado.');
  const data = await reducirImagen(file, 1800, .85);
  procesar({ imagen: data.split(',')[1] });
}

// ---------- resumen de una línea en el resultado ----------
function resumen(ideas) {
  const tareas = ideas.filter(i => i.tipo === 'tarea' || !i.tipo).length;
  const partes = [];
  if (tareas) partes.push(tareas === 1 ? '1 tarea' : tareas + ' tareas');
  ideas.filter(i => i.tipo === 'lista').forEach(l => {
    const n = (l.items || []).length, que = (l.clave || l.titulo).toLowerCase();
    partes.push(l.sumarA ? `sumo ${n} a tu ${que}` : `1 lista de ${que} con ${n} ${n === 1 ? 'cosa' : 'cosas'}`);
  });
  const rec = ideas.filter(i => i.tipo === 'receta').length; if (rec) partes.push(rec === 1 ? '1 receta' : rec + ' recetas');
  const notas = ideas.filter(i => i.tipo === 'nota').length; if (notas) partes.push(notas === 1 ? '1 nota' : notas + ' notas');
  const avisos = ideas.filter(i => i.aviso).sort((a, b) => a.aviso < b.aviso ? -1 : 1);
  if (avisos.length) partes.push((avisos.length === 1 ? '1 aviso ' : avisos.length + ' avisos, el primero ') + fechaCorta(avisos[0].aviso, true).replace(/ a las.*/, '').replace(/^(lunes|martes|miércoles|jueves|viernes|sábado|domingo|\d)/, 'el $1'));
  if (!partes.length) return '';
  const ult = partes.pop();
  return cap(partes.length ? partes.join(', ') + ' y ' + ult : ult) + '.';
}

// ---------- Hecho recientemente ----------
function pintarHechas() {
  const hechas = S.ideas.filter(i => i.hecho && Date.now() - (i.hechoEn || 0) < 7 * DIA_MS).sort((a, b) => b.hechoEn - a.hechoEn);
  const dia = t => { const d = new Date(t), h = new Date(); h.setHours(0, 0, 0, 0); const n = Math.round((h - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / DIA_MS);
    return n === 0 ? 'Hoy' : n === 1 ? 'Ayer' : cap(DIAS[d.getDay()]) + ' ' + d.getDate(); };
  let ult = '', html = '';
  hechas.forEach(i => {
    const d = dia(i.hechoEn);
    if (d !== ult) { html += `<div class="zona" style="padding-left:22px">${d}</div>`; ult = d; }
    html += `<div class="task done" data-id="${i.id}"><div class="front"><button data-act="deshecho" data-id="${i.id}" style="padding:0;align-self:flex-start" aria-label="Volver a pendiente">${check(i.cat === 'olvidar' ? 'hoy' : i.cat, true, 22)}</button><div class="body"><div class="t">${tituloHTML(i, true)}</div><div class="meta"><span class="mtxt">${NOMBRE[i.cat]}</span></div></div></div></div>`;
  });
  $('#hecho-body').innerHTML = `<div style="font-size:28px;font-weight:600;padding:2px 20px 0">Hecho recientemente</div>
    <div class="sub">Lo terminado en los últimos 7 días. Toca el círculo si al final no estaba hecho.</div>
    <div class="items enter" style="padding-bottom:60px">${html || '<div class="list-note">Aún no has terminado nada esta semana.</div>'}</div>`;
  [...$('#hecho-body .items').children].forEach((e, k) => e.style.setProperty('--i', Math.min(k, 10)));
}

// ---------- Olvidar: a los 7 días, pregunta antes de borrar ----------
function olvidarViejas() {
  return S.ideas.filter(i => i.cat === 'olvidar' && !i.hecho && Date.now() - (i.pospuesto || i.creado) > 7 * DIA_MS);
}
function tarjetaOlvidar(forzar) {
  const viejas = olvidarViejas();
  const hoy = hoyIso();
  const el = $('#olv-card');
  if (!viejas.length) { if (el) cerrarTarjetaOlvidar(); return; }
  if (!forzar && !el && S.local.olvidarDia === hoy) return;          // como mucho una vez al día
  S.local.olvidarDia = hoy; persist();
  const c = el || Object.assign(document.createElement('div'), { id: 'olv-card', className: 'olv-card glass' });
  c.innerHTML = `<div class="olv-h"><b>Hace una semana lo apuntaste.</b><span>¿Lo borramos?</span></div>
    ${viejas.map(i => `<div class="olv-row" data-id="${i.id}"><span class="t">${esc(i.titulo)}</span>
      <button class="link" data-act="olv-mas" data-id="${i.id}">Una semana más</button><button class="link urg" data-act="olv-borrar" data-id="${i.id}">Borrar</button></div>`).join('')}
    ${viejas.length > 1 ? '<div class="olv-todo"><button class="link urg" data-act="olv-borrar-todo">Borrar todo</button></div>' : ''}`;
  if (!el) { $('#s-home').appendChild(c); requestAnimationFrame(() => c.classList.add('on')); }
}
function cerrarTarjetaOlvidar() { const el = $('#olv-card'); if (!el) return; el.classList.remove('on'); setTimeout(() => el.remove(), 400); }
function quitarFilaOlvidar(id) {
  const r = $(`#olv-card .olv-row[data-id="${id}"]`);
  if (r) { r.style.height = r.offsetHeight + 'px'; requestAnimationFrame(() => { r.classList.add('fuera'); r.style.height = '0px'; }); }
  setTimeout(() => { if (!olvidarViejas().length) cerrarTarjetaOlvidar(); else if (r) r.remove(); }, 320);
}

// ---------- Personas (Ajustes) ----------
let personasCache = null;
async function pintarPersonas() {
  const b = $('#per-body');
  b.innerHTML = `<div style="font-size:28px;font-weight:600;padding:2px 20px 0">Personas</div>
    <div class="sub">Para los botones de Llamar y WhatsApp. Se guardan en la pestaña «Personas» de tu hoja de Posso. A Gemini no le llega ningún teléfono.</div>
    <div class="aj-note" style="padding:14px 22px 0">Cargando…</div>`;
  if (!S.cfg) { b.querySelector('.aj-note').textContent = 'Conecta tu Google para guardar personas.'; return; }
  try { personasCache = (await api('personas')).personas; } catch (e) { b.querySelector('.aj-note').textContent = 'No puedo leerlas ahora: ' + e.message; return; }
  pintarPersonasLista();
}
function pintarPersonasLista() {
  const b = $('#per-body');
  const lista = personasCache.slice().sort((a, c) => (a.nombre.split(' ').slice(1).join(' ') || a.nombre).localeCompare(c.nombre.split(' ').slice(1).join(' ') || c.nombre, 'es'));
  b.innerHTML = `<div style="font-size:28px;font-weight:600;padding:2px 20px 0">Personas</div>
    <div class="sub">Para los botones de Llamar y WhatsApp. Se guardan en la pestaña «Personas» de tu hoja de Posso. A Gemini no le llega ningún teléfono.</div>
    <div class="aj-h">${lista.length} ${lista.length === 1 ? 'persona' : 'personas'}</div>
    <div class="card">${lista.map(p => `<button class="arow" data-act="persona" data-n="${esc(p.nombre)}"><span>${esc(p.nombre)}${p.alias ? `<small class="alias">${esc(p.alias)}</small>` : ''}</span><span class="v">${esc(p.tel || 'sin teléfono')} ›</span></button>`).join('')}
      <button class="arow" data-act="persona-nueva"><span style="color:var(--deep)">+ Nueva persona</span></button></div>
    <div class="card" style="margin-top:14px"><button class="arow" data-act="importar-contactos"><span style="color:var(--deep)">Importar de Google Contactos</span></button></div>
    <div class="aj-note" style="padding:8px 32px 60px">«Cómo le llamas» es lo que dices al hablar: ama, aita, hermano… Si dos nombres se parecen, Posso te pregunta antes de llamar.</div>`;
}
async function guardarPersonasYa() {
  try { personasCache = (await api('guardarPersonas', { personas: personasCache })).personas; pintarPersonasLista(); toast('Guardado.'); }
  catch (e) { toast('No se ha guardado: ' + e.message); }
}
async function importarContactos() {
  const b = $('#per-body');
  toast('Leyendo tus contactos de Google…');
  let cs;
  try { cs = (await api('contactos', {}, 60000)).contactos; } catch (e) { toast(e.message, null); return; }
  const ya = new Set(personasCache.map(p => norm(p.nombre)));
  b.innerHTML = `<div style="font-size:28px;font-weight:600;padding:2px 20px 0">Importar</div>
    <div class="sub">${cs.length} contactos con teléfono. Elige los que quieras o impórtalos todos.</div>
    <div class="chips" style="padding:14px 16px 0"><button class="csel" data-act="imp-todos">Marcar todos</button></div>
    <div class="card" id="imp-lista">${cs.map((c, k) => `<label class="arow"><span>${esc(c.nombre)}<small class="alias">${esc(c.tel)}</small></span><input type="checkbox" data-k="${k}" ${ya.has(norm(c.nombre)) ? 'checked disabled' : ''}></label>`).join('')}</div>
    <div style="text-align:center;padding:20px 0 60px"><button class="pill" data-act="imp-ok">Importar</button></div>`;
  b._contactos = cs;
}

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
    I('Lo que dijo aquel compañero', 'olvidar', {}, 2),
    I('Compra', 'hoy', { tipo: 'lista', clave: 'Compra', items: [
      { id: uid(), t: '3 tipos de quesos', hecho: false, zona: 'Lácteos y huevos' }, { id: uid(), t: 'Jamón york', hecho: false, zona: 'Carnicería y charcutería' },
      { id: uid(), t: '2 docenas de huevos', hecho: false, zona: 'Lácteos y huevos' }, { id: uid(), t: 'Sustrato para el acuario', hecho: false, zona: 'Mascotas y acuario' }] }),
    I('Corregir', 'semana', { tipo: 'lista', clave: 'Corregir', carpeta: 'Instituto', items: [
      { id: uid(), t: '2ºB · Ejercicios de vistas', hecho: false }, { id: uid(), t: '4ºC · Página web de Google Sites', hecho: false }] }),
    I('Revisar el correo del máster', 'semana', { repetir: { tipo: 'semanal', dias: [1], hora: '09:00' }, aviso: at(d(1), 9) }),
    I('Preguntarle a Ander por las notas', 'semana', { personas: ['Ander'], rapida: true, grupo: '4ºC', carpeta: 'Instituto' })
  ];
  S.local.demoSembrado = true; persist();
}

// =====================================================================
// 17 · ARRANQUE
// =====================================================================
async function arrancar() {
  pintarGemas(); pintarUR();
  // si la app se cerró mientras Gemini ordenaba, lo provisional se guarda tal cual
  const sueltas = S.ideas.filter(i => i.provisional);
  if (sueltas.length && S.cfg) {
    S.ideas = S.ideas.filter(i => !i.provisional);
    const { op } = opDeIdeas(sueltas.map(i => Object.assign({}, i)), 'voz'); op.do();
  }
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
    else { ir('s-home', 'fade', { sinPila: true }); animarGema($('#home-gem'), 'drop'); setTimeout(() => tarjetaOlvidar(false), 900); }
    if (abrir) history.replaceState(null, '', location.pathname);
  }
  if (S.cfg) { cfgParaSW(); sincronizar(true); if (!abrir) destinoDelWidget(); }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { destinoDelWidget(); if (S.cfg) sincronizar(true); pintarTodo(true); }
  });
  window.addEventListener('online', () => programarSync(100));
  $('#foto-tareas').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) fotoATareas(f); });
  // si hay una lista compartida a la vista, se mira cada 5 s lo que marca la otra persona
  setInterval(() => {
    if (document.visibilityState !== 'visible' || !S.cfg || S.outbox.length) return;
    const viendo = (actual && actual.id === 's-list') || $('#sh-idea').classList.contains('on');
    if (viendo && S.ideas.some(i => i.compartir && !i.hecho)) sincronizar(true);
  }, 5000);
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
