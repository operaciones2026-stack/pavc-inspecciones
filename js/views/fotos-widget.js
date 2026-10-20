// Componente de fotografías reutilizado en inspección (GEN), hallazgo, acción y verificación.

import * as repo from '../repo.js';
import { ErrorDuplicado } from '../repo.js';
import { posicionActual } from '../geo.js';
import { getMeta } from '../db.js';
import { app } from '../app-ctx.js';
import { esc, opciones, aviso, dialogo, mostrarError, chipSync } from '../ui.js';

/**
 * opciones: {
 *   titulo, contexto(): {id_insp, inspeccion_uuid?, hallazgo_uuid?, accion_uuid?, verificacion_uuid?, item_checklist?, este?, norte?},
 *   filtro(ev): bool, etapas: [..], etapaPorDefecto, antesDeAgregar?: async () => bool, alCambiar?: () => void
 * }
 */
export async function montarFotos(cont, op) {
  const etapas = op.etapas || await repo.catalogo('TIPO_EVIDENCIA');
  const urls = [];
  async function pintar() {
    urls.splice(0).forEach(u => URL.revokeObjectURL(u));
    const c = op.contexto();
    const lista = c.hallazgo_uuid ? await repo.evidenciasDe('hallazgo_uuid', c.hallazgo_uuid)
      : c.inspeccion_uuid ? await repo.evidenciasDe('inspeccion_uuid', c.inspeccion_uuid) : [];
    const ev = lista.filter(e => !e.anulado && (!op.filtro || op.filtro(e))).sort((a, b) => a.codigo_foto.localeCompare(b.codigo_foto));
    const miniaturas = await Promise.all(ev.map(async e => {
      const b = await repo.blob(e.uuid);
      const u = b?.miniatura ? URL.createObjectURL(b.miniatura) : '';
      if (u) urls.push(u);
      return u;
    }));
    cont.innerHTML = `
      <div class="fotos-cab"><h4>${esc(op.titulo || 'Fotografías')} (${ev.length})</h4></div>
      <div class="fotos-form">
        <label class="campo"><span>Etapa (tipo de evidencia)</span><select data-f="etapa">${opciones(etapas, op.etapaPorDefecto || etapas[0], null)}</select></label>
        <label class="campo"><span>Descripción</span><input data-f="descripcion" placeholder="Qué muestra la foto (incluya escala si aplica)"></label>
        <label class="campo"><span>Orientación de toma</span><input data-f="orientacion_toma" placeholder="Ej.: N→S"></label>
        <label class="campo"><span>Punto de referencia fijo</span><input data-f="punto_referencia_fijo" placeholder="Ej.: cabezal del pozo"></label>
        <div class="acciones-fila">
          <label class="btn btn-primario">📷 Tomar foto<input type="file" accept="image/*" capture="environment" hidden data-in="camara"></label>
          <label class="btn">Seleccionar archivo(s)<input type="file" accept="image/*" multiple hidden data-in="archivo"></label>
          <span class="sub" data-progreso role="status"></span>
        </div>
      </div>
      <div class="fotos-grid">${ev.map((e, i) => `
        <figure class="foto" data-uuid="${e.uuid}">
          ${miniaturas[i] ? `<button type="button" class="foto-ver" data-ver="${e.uuid}" aria-label="Ver ${esc(e.codigo_foto)}"><img src="${miniaturas[i]}" alt="${esc(e.descripcion || e.codigo_foto)}"></button>` : '<div class="foto-falta">Archivo no disponible</div>'}
          <figcaption><b>${esc(e.codigo_foto)}</b>${e.codigo_provisional ? ' <small>(prov.)</small>' : ''}<br><span class="sub">${esc(e.etapa)} · ${esc(e.hora || '')}</span>
          <span class="sub">${esc(e.descripcion || '')}</span>${chipSync(e.sync_estado)}
          <span class="foto-botones"><button type="button" class="btn-link" data-editar="${e.uuid}">Editar</button><button type="button" class="btn-link peligro" data-anular="${e.uuid}">Anular</button></span></figcaption>
        </figure>`).join('') || '<p class="nota">Sin fotos.</p>'}</div>`;
    for (const inp of cont.querySelectorAll('input[type=file]')) inp.addEventListener('change', () => agregar(inp));
  }

  async function agregar(inp) {
    const archivos = [...inp.files];
    inp.value = '';
    if (!archivos.length) return;
    if (op.antesDeAgregar && !(await op.antesDeAgregar())) return;
    const c = op.contexto();
    const campo = (n) => cont.querySelector(`[data-f="${n}"]`).value;
    const progreso = (t) => { const el = cont.querySelector('[data-progreso]'); if (el) el.textContent = t; };
    cont.querySelectorAll('input[type=file]').forEach(i => { i.disabled = true; });
    progreso('Obteniendo ubicación GPS…');
    let gps = { este: c.este ?? null, norte: c.norte ?? null, gps_precision_m: null };
    try { const p = await posicionActual({ timeout: 6000, maximaAntiguedadMs: 120000 }); gps = { este: p.este, norte: p.norte, gps_precision_m: p.precision }; } catch { progreso('GPS no disponible: se usa la coordenada del registro.'); }
    const conservarOriginal = !!(await getMeta('conservar_original'));
    let ok = 0;
    for (const [n, f] of archivos.entries()) {
      progreso(`Procesando y guardando foto ${n + 1} de ${archivos.length}…`);
      const ctxEv = { ...c, ...gps, etapa: campo('etapa'), descripcion: campo('descripcion'), orientacion_toma: campo('orientacion_toma'),
        punto_referencia_fijo: campo('punto_referencia_fijo'), autor: app.perfil.nombre, origen_archivo: inp.dataset.in === 'camara' ? 'Cámara' : 'Archivo seleccionado' };
      try {
        await repo.agregarEvidencia(f, ctxEv, { conservarOriginal });
        ok++;
      } catch (e) {
        if (e instanceof ErrorDuplicado) {
          if (await dialogo({ titulo: 'Posible foto duplicada', mensaje: `${e.message} ¿Registrarla de todos modos?`, aceptar: 'Registrar igual', cancelar: 'Descartar' })) {
            try { await repo.agregarEvidencia(f, ctxEv, { conservarOriginal, permitirDuplicado: true }); ok++; } catch (e2) { mostrarError(e2, 'No se guardó la foto'); }
          }
        } else mostrarError(e, `No se guardó la foto ${f.name || ''}`);
      }
    }
    if (ok) aviso(`${ok} foto(s) guardada(s) en el dispositivo.`, 'ok');
    app.avisarCambios();
    await pintar();
    op.alCambiar?.();
  }

  cont.addEventListener('click', async (e) => {
    const ver = e.target.closest('[data-ver]')?.dataset.ver;
    const ed = e.target.closest('[data-editar]')?.dataset.editar;
    const an = e.target.closest('[data-anular]')?.dataset.anular;
    if (ver) {
      const b = await repo.blob(ver);
      if (!b?.reducida) { aviso('El archivo de la foto no está disponible.', 'error'); return; }
      const u = URL.createObjectURL(b.reducida);
      const d = document.createElement('dialog');
      d.className = 'dialogo dialogo-foto';
      d.innerHTML = `<form method="dialog"><img src="${u}" alt="Foto"><div class="botones"><button class="btn">Cerrar</button></div></form>`;
      document.body.appendChild(d);
      const cerrarFoto = (evt) => { evt?.preventDefault?.(); URL.revokeObjectURL(u); if (d.open) d.close(); d.remove(); };
      d.querySelector('form').addEventListener('submit', cerrarFoto);
      d.addEventListener('cancel', cerrarFoto);
      d.showModal();
    } else if (ed) {
      const ev = (await repo.evidenciasDe('id_insp', op.contexto().id_insp)).find(x => x.uuid === ed);
      const d = document.createElement('dialog');
      d.className = 'dialogo';
      d.innerHTML = `<form method="dialog"><h3>Datos de ${esc(ev.codigo_foto)}</h3>
        <label class="campo"><span>Etapa</span><select name="etapa">${opciones(etapas, ev.etapa, null)}</select></label>
        <label class="campo"><span>Descripción</span><input name="descripcion" value="${esc(ev.descripcion)}"></label>
        <label class="campo"><span>Orientación de toma</span><input name="orientacion_toma" value="${esc(ev.orientacion_toma)}"></label>
        <label class="campo"><span>Punto de referencia fijo</span><input name="punto_referencia_fijo" value="${esc(ev.punto_referencia_fijo)}"></label>
        <div class="botones"><button value="no" class="btn">Cancelar</button><button value="si" class="btn btn-primario">Guardar</button></div></form>`;
      document.body.appendChild(d);
      d.querySelector('form').addEventListener('submit', async (evt) => {
        evt.preventDefault();
        const si = evt.submitter?.value === 'si';
        const fd = new FormData(d.querySelector('form'));
        d.close(); d.remove();
        if (!si) return;
        try { await repo.guardarEvidenciaMeta({ uuid: ev.uuid, version: ev.version, ...Object.fromEntries(fd) }); aviso('Datos de la foto guardados.', 'ok'); app.avisarCambios(); await pintar(); op.alCambiar?.(); } catch (er) { mostrarError(er); }
      });
      d.addEventListener('cancel', () => d.remove());
      d.showModal();
    } else if (an) {
      const motivo = await dialogo({ titulo: 'Anular foto', mensaje: 'La foto no se borra: queda anulada con su motivo y fuera de los indicadores.', pide: true, etiqueta: 'Motivo', aceptar: 'Anular', peligro: true });
      if (!motivo) return;
      try { await repo.anular('evidencia', an, motivo); aviso('Foto anulada.', 'ok'); app.avisarCambios(); await pintar(); op.alCambiar?.(); } catch (er) { mostrarError(er); }
    }
  });
  await pintar();
  return { refrescar: pintar };
}
