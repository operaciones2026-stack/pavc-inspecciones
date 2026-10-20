// Arranque, cabecera de estado y enrutador por hash.

import { abrir, getMeta, setMeta } from './db.js';
import { setContexto } from './repo.js';
import { recuperarColgadas, resumenCola } from './sync/outbox.js';
import { uuid } from './ids.js';
import { app } from './app-ctx.js';
import { $, esc, dialogo, aviso, mostrarError } from './ui.js';

import * as vInicio from './views/inicio.js';
import * as vBuscar from './views/buscar.js';
import * as vLocacion from './views/locacion.js';
import * as vInspeccion from './views/inspeccion.js';
import * as vHallazgo from './views/hallazgo.js';
import * as vHistorial from './views/historial.js';
import * as vDatos from './views/datos.js';

const UUID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
const RUTAS = [
  [/^#?\/?(inicio)?$/, (m) => vInicio.render(m)],
  [/^#\/buscar(?:\?q=(.*))?$/, (m, q) => vBuscar.render(m, decodeURIComponent(q || ''))],
  [/^#\/locacion\/(INS-\d{3})$/, (m, id) => vLocacion.render(m, id)],
  [/^#\/inspeccion\/nueva\/(INS-\d{3})$/, (m, id) => vInspeccion.render(m, { nueva: id })],
  [new RegExp(`^#/inspeccion/${UUID}$`), (m, u) => vInspeccion.render(m, { uuid: u })],
  [new RegExp(`^#/hallazgo/nuevo/${UUID}(?:\\?item=([A-F]\\d))?$`), (m, u, item) => vHallazgo.render(m, { nuevoEn: u, item })],
  [new RegExp(`^#/hallazgo/${UUID}$`), (m, u) => vHallazgo.render(m, { uuid: u })],
  [/^#\/historial(?:\?t=(\w+))?$/, (m, t) => vHistorial.render(m, t)],
  [/^#\/datos$/, (m) => vDatos.render(m)],
];

let ignorarSiguiente = false;

async function enrutar() {
  if (ignorarSiguiente) { ignorarSiguiente = false; return; }
  if (app.sucio) {
    const salir = await dialogo({ titulo: 'Cambios sin guardar', mensaje: 'Hay cambios en el formulario que todavía no se guardaron. ¿Salir sin guardarlos?', aceptar: 'Salir sin guardar', cancelar: 'Seguir editando', peligro: true });
    if (!salir) { ignorarSiguiente = true; location.hash = app.hashActual; return; }
    app.sucio = false;
  }
  app.hashActual = location.hash;
  try { app.alSalir?.(); } catch { /* limpieza de la vista anterior */ }
  app.alSalir = null;
  // Cada pantalla se dibuja en un <main> nuevo: así no sobreviven manejadores de eventos de la pantalla
  // anterior (defecto E3-01: un clic en una inspección ejecutaba también el manejador de otra ya cerrada).
  const anterior = $('#principal');
  const main = anterior.cloneNode(false);
  anterior.replaceWith(main);
  const h = location.hash || '#/inicio';
  for (const [re, fn] of RUTAS) {
    const m = h.match(re);
    if (m) {
      main.innerHTML = '<p class="cargando">Cargando…</p>';
      try { await fn(main, ...m.slice(1)); } catch (e) { mostrarError(e, 'Error al mostrar la pantalla'); main.innerHTML = `<div class="tarjeta"><h2>Error</h2><p>${esc(e.message)}</p><p><a href="#/inicio">Volver al inicio</a></p></div>`; }
      marcarNav(h);
      main.focus({ preventScroll: true });
      window.scrollTo(0, 0);
      return;
    }
  }
  main.innerHTML = '<div class="tarjeta"><h2>Página no encontrada</h2><p><a href="#/inicio">Volver al inicio</a></p></div>';
}

function marcarNav(h) {
  for (const a of document.querySelectorAll('.nav a')) {
    const r = a.getAttribute('href');
    a.classList.toggle('activo', h === r || (r !== '#/inicio' && h.startsWith(r)));
  }
}

export async function refrescarCabecera() {
  try {
    const r = await resumenCola();
    const pend = r.pendiente + r.enviando + r.error;
    $('#estado-sync').innerHTML = pend
      ? `<span class="chip sync-pendiente">${pend} pendiente${pend === 1 ? '' : 's'} de envío${r.error ? ` · ${r.error} con error` : ''}</span>`
      : '<span class="chip sync-sincronizado">Nada pendiente</span>';
  } catch { /* base no abierta aún */ }
  $('#estado-red').innerHTML = navigator.onLine
    ? '<span class="chip red-si">En línea</span>'
    : '<span class="chip red-no">Sin conexión</span>';
}

async function iniciar() {
  document.body.classList.toggle('modo-demo', app.esDemo);
  $('#franja-demo').hidden = !app.esDemo;
  if (app.modo === 'piloto') $('#franja-demo').textContent = 'MODO PRUEBA PILOTO · datos de prueba · no oficiales';
  $('#modo').textContent = app.etiquetaModo;
  try {
    await abrir(app.nombreBase);
  } catch (e) {
    $('#principal').innerHTML = `<div class="tarjeta"><h2>No se pudo abrir la base local</h2><p>${esc(e.message)}</p><p>Verifique que el navegador permita el almacenamiento de datos para este sitio (no use ventanas privadas).</p></div>`;
    return;
  }
  let disp = await getMeta('dispositivo_id');
  if (!disp) { disp = uuid(); await setMeta('dispositivo_id', disp); }
  app.dispositivo_id = disp;
  app.perfil = (await getMeta('perfil')) || { nombre: '', cuadrilla: '' };
  app.syncConfig = (await getMeta('sync_config')) || app.configSyncPorDefecto();
  setContexto({ usuario: app.perfil.nombre || '(sin perfil)', dispositivo_id: disp });
  const recuperadas = await recuperarColgadas();
  if (recuperadas) aviso(`Se recuperaron ${recuperadas} operaciones interrumpidas; quedan pendientes de envío.`, 'info');

  window.addEventListener('hashchange', enrutar);
  window.addEventListener('online', () => { refrescarCabecera(); aviso('Conexión restablecida.', 'ok'); });
  window.addEventListener('offline', () => { refrescarCabecera(); aviso('Sin conexión: los registros se siguen guardando en el dispositivo.', 'info'); });
  document.addEventListener('pavc:cambios', refrescarCabecera);
  window.addEventListener('beforeunload', (e) => { if (app.sucio) { e.preventDefault(); e.returnValue = ''; } });
  if ('BroadcastChannel' in window) {
    const canal = new BroadcastChannel(`pavc-${app.nombreBase}`);
    document.addEventListener('pavc:cambios', () => canal.postMessage('cambios'));
    canal.onmessage = () => { refrescarCabecera(); if (!app.sucio) aviso('Hay cambios guardados desde otra pestaña. Recargue la pantalla para verlos.', 'info'); };
  }
  refrescarCabecera();
  await enrutar();
  // En segundo plano: algunos navegadores preguntan al usuario o tardan en responder; no debe bloquear el arranque.
  if (navigator.storage?.persist) {
    navigator.storage.persist().then(p => setMeta('persistencia', p)).catch(() => { /* no disponible */ });
  }
  registrarSW();
}

function registrarSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const ofrecer = (w) => {
      const b = $('#actualizar');
      b.hidden = false;
      b.onclick = () => { if (app.sucio) { aviso('Guarde el formulario antes de actualizar.', 'error'); return; } w.postMessage('activar'); };
    };
    if (reg.waiting) ofrecer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) ofrecer(w); });
    });
  }).catch((e) => console.warn('Service Worker no registrado:', e));
  let recargando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!recargando) { recargando = true; location.reload(); } });
}

iniciar();
