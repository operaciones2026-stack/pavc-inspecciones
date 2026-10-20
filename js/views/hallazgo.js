import * as repo from '../repo.js';
import { ErrorConflicto } from '../repo.js';
import { posicionActual } from '../geo.js';
import { alertasHallazgo } from '../rules.js';
import { TRANSICIONES_MANUALES, CERRADO_ADM, admiteVerificacion, ESTADOS_ACCION } from '../states.js';
import { app } from '../app-ctx.js';
import { montarFotos } from './fotos-widget.js';
import { esc, opciones, aviso, dialogo, mostrarError, chipSync, chipEstado, chipPrioridad, fmtFecha, fmtFechaHora, listaAlertas } from '../ui.js';

const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

export async function render(main, { nuevoEn, item, uuid }) {
  let h, insp;
  if (nuevoEn) {
    insp = await repo.inspeccion(nuevoEn);
    if (!insp || insp.anulado) { main.innerHTML = '<div class="tarjeta"><p>La inspección no existe o está anulada.</p></div>'; return; }
    h = repo.nuevoHallazgo(insp, item || '');
  } else {
    h = await repo.hallazgo(uuid);
    if (!h) { main.innerHTML = '<div class="tarjeta"><p>Hallazgo no encontrado en este dispositivo.</p></div>'; return; }
    insp = await repo.inspeccion(h.inspeccion_uuid);
  }
  const loc = await repo.locacion(h.id_insp);
  const [categorias, prioridades, medios, items] = await Promise.all([repo.catalogo('CATEGORIA'), repo.catalogo('PRIORIDAD'), repo.catalogo('MEDIO_ATENCION'), repo.items()]);
  const esNuevo = () => !(h.version > 0);
  const v = (k) => esc(h[k] ?? '');
  let areaManual = h.area_m2 !== null && h.area_m2 !== undefined && !(h.largo_m && h.ancho_m && Math.abs(h.largo_m * h.ancho_m - h.area_m2) < 0.01);

  main.innerHTML = `
  <section class="tarjeta destacada" id="cab"></section>
  <form id="form-h" novalidate>
  <section class="tarjeta"><h3>Datos del hallazgo</h3>
    <div class="rejilla">
      <label class="campo"><span>Ítem de la ficha que lo origina</span><select data-k="item_checklist">${opciones(items.map(i => i.codigo), h.item_checklist, '— Ninguno —')}</select></label>
      <label class="campo"><span>Fecha de identificación</span><input type="date" data-k="fecha_identificacion" value="${v('fecha_identificacion')}"></label>
      <label class="campo"><span>Categoría</span><select data-k="categoria">${opciones(categorias, h.categoria)}</select></label>
      <label class="campo"><span>Prioridad</span><select data-k="prioridad">${opciones(prioridades, h.prioridad)}</select></label>
    </div>
    <label class="campo"><span>Descripción objetiva (qué, dónde, cuánto)</span><textarea data-k="descripcion_objetiva" rows="3">${v('descripcion_objetiva')}</textarea></label>
    <div class="rejilla">
      <label class="campo"><span>Este (UTM 17S)</span><input type="number" step="0.1" inputmode="decimal" data-k="este" data-num value="${v('este')}"></label>
      <label class="campo"><span>Norte (UTM 17S)</span><input type="number" step="0.1" inputmode="decimal" data-k="norte" data-num value="${v('norte')}"></label>
      <div class="campo"><span>&nbsp;</span><button type="button" class="btn" id="btn-gps">📍 GPS actual</button></div>
      <label class="campo"><span>Largo (m)</span><input type="number" step="0.01" min="0" inputmode="decimal" data-k="largo_m" data-num value="${v('largo_m')}"></label>
      <label class="campo"><span>Ancho (m)</span><input type="number" step="0.01" min="0" inputmode="decimal" data-k="ancho_m" data-num value="${v('ancho_m')}"></label>
      <label class="campo"><span>Área (m²)</span><input type="number" step="0.01" min="0" inputmode="decimal" data-k="area_m2" data-num value="${v('area_m2')}"></label>
    </div>
    <label class="campo"><span>Condición observada</span><textarea data-k="condicion_observada" rows="2" placeholder="Ej.: suelo seco, mancha visible; lectura PID">${v('condicion_observada')}</textarea></label>
    <label class="campo"><span>Riesgo / consecuencia</span><textarea data-k="riesgo_consecuencia" rows="2">${v('riesgo_consecuencia')}</textarea></label>
    <label class="campo"><span>Observaciones</span><textarea data-k="observaciones" rows="2">${v('observaciones')}</textarea></label>
  </section>
  <section class="tarjeta" id="acc-iniciales" ${esNuevo() ? '' : 'hidden'}><h3>Acciones</h3>
    <label class="campo"><span>Acción inmediata</span><textarea name="inm" rows="2" placeholder="Ej.: señalizar y delimitar el área"></textarea></label>
    <label class="campo"><span>Acción correctiva</span><textarea name="corr" rows="2"></textarea></label>
    <div class="rejilla">
      <label class="campo"><span>Medio de atención</span><select name="medio">${opciones(medios, '')}</select></label>
      <label class="campo"><span>Responsable (texto libre)</span><input name="resp"></label>
      <label class="campo"><span>Fecha de compromiso</span><input type="date" name="fcomp"></label>
    </div>
  </section>
  </form>
  <div id="detalle"></div>
  <div class="barra-acciones"><span class="sub" id="estado-guardado"></span>
    <button type="button" class="btn btn-primario" data-accion id="btn-guardar">${esNuevo() ? 'Guardar hallazgo' : 'Guardar cambios'}</button>
    <button type="button" class="btn btn-peligro-sutil" data-accion id="btn-anular" ${esNuevo() ? 'hidden' : ''}>Anular</button></div>`;

  async function datosRelacionados() {
    if (esNuevo()) return { acciones: [], verificaciones: [], evidencias: [], historial: [] };
    const [acciones, verificaciones, evidencias, historial] = await Promise.all([repo.accionesDe(h.uuid), repo.verificacionesDe(h.uuid), repo.evidenciasDe('hallazgo_uuid', h.uuid), repo.historialDe(h.uuid)]);
    return { acciones, verificaciones, evidencias, historial };
  }

  async function pintarCabecera() {
    main.querySelector('#cab').innerHTML = `<div class="tarjeta-cab"><div>
      <h2>${esNuevo() ? 'Nuevo hallazgo' : esc(h.cod_hallazgo)}${h.codigo_provisional ? ' <small>(código provisional)</small>' : ''}</h2>
      <p class="sub"><a href="#/locacion/${loc.id_insp}">${esc(loc.id_insp)} · ${esc(loc.componente)}</a> · Lote ${esc(loc.lote)} · ${esc(loc.yacimiento)} ·
      Inspección <a href="#/inspeccion/${insp.uuid}">${esc(insp.cod_inspeccion)}</a> (${fmtFecha(insp.fecha)})</p></div>
      <div>${chipPrioridad(h.prioridad)} ${esNuevo() ? '' : `${chipEstado(h.estado)} ${chipSync(h.sync_estado)} <span class="chip">v${h.version}</span>`}</div></div>
      ${h.anulado ? `<p class="aviso-texto">Hallazgo ANULADO: ${esc(h.motivo_anulacion)}</p>` : ''}`;
    main.querySelector('#btn-guardar').hidden = !!h.anulado;
    main.querySelector('#btn-anular').hidden = esNuevo() || !!h.anulado;
  }

  async function pintarDetalle() {
    const det = main.querySelector('#detalle');
    if (esNuevo()) { det.innerHTML = '<p class="nota">Guarde el hallazgo para agregar fotos, gestionar acciones y registrar verificaciones.</p>'; return; }
    const d = await datosRelacionados();
    const acc = d.acciones.filter(a => !a.anulado).sort((a, b) => a.creado_en.localeCompare(b.creado_en));
    const ver = d.verificaciones.filter(x => !x.anulado).sort((a, b) => a.creado_en.localeCompare(b.creado_en));
    const trans = h.anulado ? [] : (TRANSICIONES_MANUALES[h.estado] || []);
    det.innerHTML = `
    <section class="tarjeta"><h3>Estado: ${chipEstado(h.estado)}</h3>
      ${trans.length ? `<div class="acciones-fila">${trans.map(t => `<button type="button" class="btn" data-estado="${esc(t)}">Pasar a “${esc(t)}”</button>`).join('')}</div>` : '<p class="nota">No hay cambios manuales disponibles desde este estado.</p>'}
      <p class="nota">“Levantado y verificado” y “No levantado” sólo se asignan registrando una verificación (D-24).</p>
      ${h.estado === CERRADO_ADM ? `<p><b>Sustento del cierre administrativo:</b> ${esc(h.sustento_cierre_adm || '—')}</p>` : ''}
    </section>
    <section class="tarjeta" id="fotos-h"></section>
    <section class="tarjeta"><div class="tarjeta-cab"><h3>Acciones (${acc.length})</h3></div>
      ${acc.map(a => `<form class="accion" data-acc="${a.uuid}">
        <div class="tarjeta-cab"><b>${esc(a.tipo)}</b> ${chipEstado(a.estado)} ${chipSync(a.sync_estado)}</div>
        <label class="campo"><span>Descripción</span><textarea name="descripcion" rows="2">${esc(a.descripcion)}</textarea></label>
        <div class="rejilla">
          <label class="campo"><span>Estado</span><select name="estado">${opciones(ESTADOS_ACCION, a.estado, null)}</select></label>
          <label class="campo"><span>Medio de atención</span><select name="medio_atencion">${opciones(medios, a.medio_atencion || '')}</select></label>
          <label class="campo"><span>Responsable</span><input name="responsable" value="${esc(a.responsable || '')}"></label>
          <label class="campo"><span>Fecha de compromiso</span><input type="date" name="fecha_compromiso" value="${esc(a.fecha_compromiso || '')}"></label>
          <label class="campo"><span>Fecha de ejecución</span><input type="date" name="fecha_ejecucion" value="${esc(a.fecha_ejecucion || '')}"></label>
        </div>
        <label class="campo"><span>Evidencia de levantamiento (descripción del sustento)</span><textarea name="evidencia_levantamiento" rows="2">${esc(a.evidencia_levantamiento || '')}</textarea></label>
        <div class="acciones-fila"><button class="btn btn-primario btn-sm" data-accion>Guardar acción</button><button type="button" class="btn-link peligro" data-anular-acc="${a.uuid}">Anular acción</button></div>
        <div class="fotos-acc" data-fotos-acc="${a.uuid}"></div>
      </form>`).join('') || '<p>Sin acciones registradas.</p>'}
      <details><summary>+ Agregar acción</summary><form id="f-acc-nueva">
        <div class="rejilla"><label class="campo"><span>Tipo</span><select name="tipo">${opciones(['Correctiva', 'Adicional', 'Inmediata'], h.estado === 'No levantado / requiere acciones adicionales' ? 'Adicional' : 'Correctiva', null)}</select></label>
        <label class="campo"><span>Medio de atención</span><select name="medio_atencion">${opciones(medios, '')}</select></label>
        <label class="campo"><span>Responsable</span><input name="responsable"></label>
        <label class="campo"><span>Fecha de compromiso</span><input type="date" name="fecha_compromiso"></label></div>
        <label class="campo"><span>Descripción</span><textarea name="descripcion" rows="2" required></textarea></label>
        <button class="btn btn-primario btn-sm" data-accion>Agregar acción</button></form></details>
    </section>
    <section class="tarjeta"><h3>Verificaciones (${ver.length})</h3>
      ${ver.length ? `<ul class="lista">${ver.map(x => `<li><b>${fmtFecha(x.fecha_verificacion)}</b> · ${esc(x.verificador || 'sin verificador')} · ${esc(x.resultado)} ${chipSync(x.sync_estado)}<span class="sub">${esc(x.observaciones || '')}</span><div data-fotos-ver="${x.uuid}"></div></li>`).join('')}</ul>` : '<p>Sin verificaciones.</p>'}
      ${!h.anulado && admiteVerificacion(h.estado) ? `<details ${h.estado === 'Pendiente de verificación' ? 'open' : ''}><summary>+ Registrar verificación</summary><form id="f-ver">
        <div class="rejilla"><label class="campo"><span>Fecha de verificación</span><input type="date" name="fecha_verificacion" value="${repo.hoyISO()}"></label>
        <label class="campo"><span>Verificador (distinto del responsable)</span><input name="verificador" value="${esc(app.perfil.nombre)}"></label>
        <label class="campo"><span>Resultado</span><select name="resultado">${opciones(await repo.catalogo('RESULTADO_VERIF'), '')}</select></label></div>
        <label class="campo"><span>Observaciones</span><textarea name="observaciones" rows="2"></textarea></label>
        <div class="rejilla"><label class="campo"><span>Etapa de las fotos</span><select name="etapa">${opciones(['Verificación de cierre', 'Posterior (después)'], 'Verificación de cierre', null)}</select></label>
        <label class="campo"><span>Orientación de toma</span><input name="orientacion_toma"></label><label class="campo"><span>Punto de referencia fijo</span><input name="punto_referencia_fijo"></label></div>
        <label class="btn">Adjuntar fotos de la verificación<input type="file" accept="image/*" multiple hidden name="fotos"></label> <span class="sub" id="ver-fotos-n">0 foto(s)</span>
        <div class="acciones-fila"><button class="btn btn-primario" data-accion>Registrar verificación</button></div></form></details>` : ''}
    </section>
    <section class="tarjeta"><h3>Alertas (no impiden guardar)</h3><div id="alertas"></div></section>
    <section class="tarjeta"><h3>Historial de estados</h3>
      <ul class="lista">${d.historial.sort((a, b) => a.fecha_hora.localeCompare(b.fecha_hora)).map(x => `<li>${fmtFechaHora(x.fecha_hora)} · ${esc(x.desde || '—')} → <b>${esc(x.hacia)}</b> <span class="sub">${esc(x.motivo || '')} · ${esc(x.usuario || '')}</span></li>`).join('')}</ul>
    </section>`;
    await montarFotos(det.querySelector('#fotos-h'), {
      titulo: 'Fotografías del hallazgo',
      contexto: () => ({ id_insp: h.id_insp, inspeccion_uuid: h.inspeccion_uuid, hallazgo_uuid: h.uuid, item_checklist: h.item_checklist, este: h.este, norte: h.norte }),
      filtro: (e) => !e.accion_uuid && !e.verificacion_uuid, etapaPorDefecto: 'Inicial (antes)', alCambiar: pintarAlertas,
    });
    for (const a of acc) {
      await montarFotos(det.querySelector(`[data-fotos-acc="${a.uuid}"]`), {
        titulo: `Fotos de la acción ${a.tipo.toLowerCase()}`,
        contexto: () => ({ id_insp: h.id_insp, inspeccion_uuid: h.inspeccion_uuid, hallazgo_uuid: h.uuid, accion_uuid: a.uuid, este: h.este, norte: h.norte }),
        filtro: (e) => e.accion_uuid === a.uuid, etapas: ['Durante la intervención', 'Posterior (después)'], etapaPorDefecto: 'Durante la intervención', alCambiar: pintarAlertas,
      });
    }
    const evs = d.evidencias.filter(e => !e.anulado);
    for (const x of ver) {
      const del = evs.filter(e => e.verificacion_uuid === x.uuid);
      det.querySelector(`[data-fotos-ver="${x.uuid}"]`).innerHTML = del.length ? `<span class="sub">Fotos: ${del.map(e => esc(e.codigo_foto)).join(', ')}</span>` : '<span class="sub aviso-texto">Sin fotos</span>';
    }
    enlazarDetalle(det, acc);
    await pintarAlertas();
  }

  async function pintarAlertas() {
    const el = main.querySelector('#alertas');
    if (!el) return;
    const d = await datosRelacionados();
    el.innerHTML = listaAlertas(alertasHallazgo(h, { ...d, inspeccion: insp, hoy: repo.hoyISO() }));
  }

  async function recargar() { h = await repo.hallazgo(h.uuid); await pintarCabecera(); await pintarDetalle(); app.avisarCambios(); }

  function enlazarDetalle(det, acc) {
    det.querySelectorAll('[data-estado]').forEach(b => b.addEventListener('click', async () => {
      const hacia = b.dataset.estado;
      let sustento;
      if (hacia === CERRADO_ADM) {
        sustento = await dialogo({ titulo: 'Cierre administrativo', mensaje: 'Sólo con sustento documentado (p. ej., duplicado o fuera de alcance). Se excluye del % de levantamiento.', pide: true, etiqueta: 'Sustento', aceptar: 'Cerrar administrativamente' });
        if (!sustento) return;
      } else if (!(await dialogo({ titulo: 'Cambiar estado', mensaje: `¿Pasar de “${h.estado}” a “${hacia}”?`, aceptar: 'Cambiar' }))) return;
      try { await repo.cambiarEstadoHallazgo(h.uuid, hacia, { motivo: 'Cambio manual', sustento }); aviso(`Estado cambiado a “${hacia}”.`, 'ok'); await recargar(); } catch (e) { mostrarError(e, 'No se cambió el estado'); }
    }));
    det.querySelectorAll('form[data-acc]').forEach(f => f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const a = acc.find(x => x.uuid === f.dataset.acc);
      const fd = Object.fromEntries(new FormData(f));
      try { await repo.guardarAccion({ ...a, ...fd }); aviso('Acción guardada.', 'ok'); await recargar(); } catch (er) { mostrarError(er, 'No se guardó la acción'); }
    }));
    det.querySelectorAll('[data-anular-acc]').forEach(b => b.addEventListener('click', async () => {
      const motivo = await dialogo({ titulo: 'Anular acción', pide: true, etiqueta: 'Motivo', aceptar: 'Anular', peligro: true });
      if (!motivo) return;
      try { await repo.anular('accion', b.dataset.anularAcc, motivo); aviso('Acción anulada.', 'ok'); await recargar(); } catch (er) { mostrarError(er); }
    }));
    det.querySelector('#f-acc-nueva')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target));
      try { await repo.guardarAccion({ ...fd, hallazgo_uuid: h.uuid, version: 0 }); aviso('Acción agregada.', 'ok'); await recargar(); } catch (er) { mostrarError(er, 'No se agregó la acción'); }
    });
    const fv = det.querySelector('#f-ver');
    if (fv) {
      const inp = fv.querySelector('input[type=file]');
      inp.addEventListener('change', () => { fv.querySelector('#ver-fotos-n').textContent = `${inp.files.length} foto(s)`; });
      let enCurso = false;
      fv.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (enCurso) return;
        enCurso = true;
        const fd = new FormData(fv);
        const archivos = [...inp.files];
        try {
          const vr = await repo.guardarVerificacion({ hallazgo_uuid: h.uuid, inspeccion_uuid: null, fecha_verificacion: fd.get('fecha_verificacion'), verificador: fd.get('verificador'), resultado: fd.get('resultado'), observaciones: fd.get('observaciones') });
          let ok = 0;
          for (const f of archivos) {
            try {
              await repo.agregarEvidencia(f, { id_insp: h.id_insp, inspeccion_uuid: h.inspeccion_uuid, hallazgo_uuid: h.uuid, verificacion_uuid: vr.uuid, etapa: fd.get('etapa'), descripcion: `Verificación ${vr.fecha_verificacion}`, orientacion_toma: fd.get('orientacion_toma'), punto_referencia_fijo: fd.get('punto_referencia_fijo'), autor: app.perfil.nombre, este: h.este, norte: h.norte, origen_archivo: 'Archivo seleccionado' }, { permitirDuplicado: false });
              ok++;
            } catch (er) { mostrarError(er, `No se guardó la foto ${f.name}`); }
          }
          aviso(`Verificación registrada (${vr.resultado})${archivos.length ? `, ${ok} de ${archivos.length} foto(s)` : ''}.`, 'ok');
          await recargar();
        } catch (er) { mostrarError(er, 'No se registró la verificación'); } finally { enCurso = false; }
      });
    }
  }

  // ---- formulario principal
  const form = main.querySelector('#form-h');
  form.addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    if (!k) { app.sucio = true; return; }
    h[k] = e.target.dataset.num !== undefined ? num(e.target.value) : e.target.value;
    if (k === 'area_m2') areaManual = e.target.value !== '';
    if ((k === 'largo_m' || k === 'ancho_m') && !areaManual && h.largo_m !== null && h.ancho_m !== null) {
      h.area_m2 = Math.round(h.largo_m * h.ancho_m * 100) / 100;
      main.querySelector('[data-k=area_m2]').value = h.area_m2;
    }
    app.sucio = true;
    main.querySelector('#estado-guardado').textContent = 'Cambios sin guardar';
  });
  main.querySelector('#btn-gps').addEventListener('click', async () => {
    try {
      const p = await posicionActual();
      h.este = p.este; h.norte = p.norte;
      main.querySelector('[data-k=este]').value = p.este; main.querySelector('[data-k=norte]').value = p.norte;
      app.sucio = true; aviso(`GPS capturado (precisión ${p.precision} m).`, 'ok');
    } catch (e) { aviso(e.message, 'error'); }
  });
  let guardando = false;
  main.querySelector('#btn-guardar').addEventListener('click', async (e) => {
    if (guardando) return;
    guardando = true; e.currentTarget.disabled = true;
    try {
      const eraNuevo = esNuevo();
      let iniciales = [];
      if (eraNuevo) {
        const f = new FormData(form);
        iniciales = [
          { tipo: 'Inmediata', descripcion: f.get('inm'), medio_atencion: f.get('medio'), responsable: f.get('resp'), fecha_compromiso: '' },
          { tipo: 'Correctiva', descripcion: f.get('corr'), medio_atencion: f.get('medio'), responsable: f.get('resp'), fecha_compromiso: f.get('fcomp') },
        ];
      }
      h = await repo.guardarHallazgo(h, { accionesIniciales: iniciales });
      app.sucio = false;
      app.avisarCambios();
      aviso(`Hallazgo ${h.cod_hallazgo} guardado en el dispositivo.`, 'ok');
      if (eraNuevo) { location.replace(`#/hallazgo/${h.uuid}`); return; } // dispara el enrutador (app.sucio ya es false)
      main.querySelector('#estado-guardado').textContent = `Guardado (v${h.version})`;
      await pintarCabecera(); await pintarAlertas();
    } catch (er) {
      if (er instanceof ErrorConflicto) aviso(er.message, 'error', 10000); else mostrarError(er, 'No se guardó el hallazgo');
    } finally { guardando = false; const b = main.querySelector('#btn-guardar'); if (b) b.disabled = false; }
  });
  main.querySelector('#btn-anular').addEventListener('click', async () => {
    const motivo = await dialogo({ titulo: 'Anular hallazgo', mensaje: 'El hallazgo no se borra: queda anulado con su motivo y fuera de los indicadores.', pide: true, etiqueta: 'Motivo', aceptar: 'Anular', peligro: true });
    if (!motivo) return;
    try { await repo.anular('hallazgo', h.uuid, motivo, h.version); app.sucio = false; aviso('Hallazgo anulado.', 'ok'); await recargar(); } catch (er) { mostrarError(er); }
  });

  await pintarCabecera();
  await pintarDetalle();
}
