// Utilidades de interfaz: escape, avisos, diálogos, formato.

import { ESTADOS_SYNC } from './states.js';

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function opciones(valores, seleccionado, vacioTexto = '— Seleccione —') {
  return (vacioTexto !== null ? `<option value="">${esc(vacioTexto)}</option>` : '')
    + valores.map(v => `<option value="${esc(v)}"${v === seleccionado ? ' selected' : ''}>${esc(v)}</option>`).join('');
}

export function aviso(mensaje, tipo = 'info', ms = 4500) {
  const zona = $('#avisos');
  const el = document.createElement('div');
  el.className = `aviso aviso-${tipo}`;
  el.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
  el.textContent = mensaje;
  zona.appendChild(el);
  setTimeout(() => el.classList.add('saliendo'), ms);
  setTimeout(() => el.remove(), ms + 400);
}

/** Diálogo propio (no se usan alert/confirm del navegador). Devuelve true/false, o el texto si pide = true. */
export function dialogo({ titulo, mensaje = '', aceptar = 'Aceptar', cancelar = 'Cancelar', pide = false, peligro = false, etiqueta = '' }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'dialogo';
    d.innerHTML = `<form method="dialog">
      <h3>${esc(titulo)}</h3>${mensaje ? `<p>${esc(mensaje)}</p>` : ''}
      ${pide ? `<label class="campo"><span>${esc(etiqueta)}</span><textarea name="t" rows="3" required></textarea></label>` : ''}
      <div class="botones">${cancelar ? `<button value="no" type="submit" class="btn">${esc(cancelar)}</button>` : ''}
      <button value="si" type="submit" class="btn ${peligro ? 'btn-peligro' : 'btn-primario'}">${esc(aceptar)}</button></div></form>`;
    document.body.appendChild(d);
    const ta = d.querySelector('textarea');
    let resuelto = false;
    const terminar = (ok) => {
      if (resuelto) return;
      resuelto = true;
      resolve(pide ? (ok ? ta.value.trim() : null) : ok);
      if (d.open) d.close();
      d.remove();
    };
    // Se resuelve en el envío del formulario (no se depende del evento "close", que puede demorarse).
    d.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const si = e.submitter?.value === 'si';
      if (pide && si && !ta.value.trim()) { ta.focus(); return; }
      terminar(si);
    });
    d.addEventListener('cancel', (e) => { e.preventDefault(); terminar(false); });
    d.addEventListener('close', () => terminar(d.returnValue === 'si'));
    d.showModal();
  });
}

export function fmtFecha(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return d ? `${d}/${m}/${y}` : iso;
}
export function fmtFechaHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' });
}
export function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}
export const fmtNum = (n, dec = 0) => (n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('es-PE', { maximumFractionDigits: dec, minimumFractionDigits: 0 }));

export function chipSync(estado) {
  const e = estado || 'local';
  return `<span class="chip sync-${esc(e)}" title="${esc(ESTADOS_SYNC[e] || e)}">${esc(ESTADOS_SYNC[e] || e)}</span>`;
}
export function chipPrioridad(p) { return p ? `<span class="chip prio-${esc(String(p).toLowerCase())}">${esc(p)}</span>` : ''; }
export function chipEstado(e) {
  const cls = String(e || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z]+/g, '-');
  return `<span class="chip est-${cls}">${esc(e || '—')}</span>`;
}

export function descargar(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** Muestra un error al usuario con un mensaje claro; registra el detalle en consola. */
export function mostrarError(e, prefijo = 'No se pudo completar la operación') {
  console.error(e);
  const msg = e?.name === 'QuotaExceededError'
    ? 'No hay espacio suficiente en el dispositivo. Exporte y libere espacio antes de continuar.'
    : (e?.message || String(e));
  aviso(`${prefijo}: ${msg}`, 'error', 8000);
}

export function urlObjeto(blob) { return blob ? URL.createObjectURL(blob) : ''; }

export function listaAlertas(alertas) {
  if (!alertas.length) return '<p class="ok-texto">Sin alertas.</p>';
  return `<ul class="alertas">${alertas.map(a => `<li><b>${esc(a.codigo)}</b> ${esc(a.mensaje)}</li>`).join('')}</ul>`;
}
