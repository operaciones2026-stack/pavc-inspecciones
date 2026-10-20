import * as repo from '../repo.js';
import { ErrorConflicto } from '../repo.js';
import { diferenciaM, posicionActual } from '../geo.js';
import { alertasInspeccion, UMBRAL_GPS_M } from '../rules.js';
import { app } from '../app-ctx.js';
import { montarFotos } from './fotos-widget.js';
import { esc, opciones, aviso, dialogo, mostrarError, chipSync, chipEstado, chipPrioridad, fmtFecha, fmtNum, listaAlertas } from '../ui.js';

export async function render(main, { nueva, uuid }) {
  let rec, loc;
  if (nueva) {
    loc = await repo.locacion(nueva);
    if (!loc) { main.innerHTML = '<div class="tarjeta"><p>Locación no encontrada.</p></div>'; return; }
    const borr = (await repo.inspeccionesDe(nueva)).find(i => !i.anulado && i.estado_registro === 'Borrador');
    if (borr) { aviso(`Ya hay un borrador abierto (${borr.cod_inspeccion}); se continúa ese registro.`, 'info'); history.replaceState(null, '', `#/inspeccion/${borr.uuid}`); app.hashActual = location.hash; rec = borr; }
    else {
      // Obs. 3 (prueba real): sin perfil, los registros quedaban como "(sin perfil)". Se exige antes de crear.
      if (!String(app.perfil?.nombre || '').trim()) {
        main.innerHTML = `<div class="tarjeta"><h2>Complete su perfil</h2>
          <p>Antes de registrar una inspección, escriba su <strong>nombre</strong> y <strong>cuadrilla</strong> en
          <strong>Datos → Perfil del dispositivo</strong> y pulse <strong>Guardar perfil</strong>.
          Ese nombre queda como autor de las inspecciones, hallazgos y fotos.</p>
          <p><a class="btn btn-primario" href="#/datos">Ir a Datos</a></p></div>`;
        return;
      }
      rec = repo.nuevaInspeccion(loc, app.perfil);
    }
  } else {
    rec = await repo.inspeccion(uuid);
    if (!rec) { main.innerHTML = '<div class="tarjeta"><p>Inspección no encontrada en este dispositivo.</p></div>'; return; }
    loc = await repo.locacion(rec.id_insp);
  }
  const [items, accesos, resultados, medios] = await Promise.all([repo.items(), repo.catalogo('ACCESO'), repo.catalogo('RESULTADO'), repo.catalogo('MEDIO_ATENCION')]);
  let cola = Promise.resolve(), temporizador = null;
  const guardado = () => rec.version > 0;
  app.alSalir = () => clearTimeout(temporizador); // un autoguardado pendiente no se ejecuta tras salir

  // Los guardados se encolan: un autoguardado en curso nunca reemplaza a "Guardar" o "Finalizar".
  function guardar(opciones = {}) {
    clearTimeout(temporizador);
    const p = cola.then(() => guardarAhora(opciones));
    cola = p.catch(() => false);
    return p;
  }

  async function guardarAhora({ finalizar = false, silencioso = false } = {}) {
    clearTimeout(temporizador);
    return (async () => {
      // El autoguardado (silencioso) no bloquea los botones: Guardar/Finalizar quedan en cola detrás de él.
      if (!silencioso) main.querySelectorAll('[data-accion]').forEach(b => { b.disabled = true; });
      try {
        const nuevoRec = await repo.guardarInspeccion(rec, { finalizar });
        const eraNuevo = !guardado();
        rec = nuevoRec;
        app.sucio = false;
        if (eraNuevo) { history.replaceState(null, '', `#/inspeccion/${rec.uuid}`); app.hashActual = location.hash; }
        main.querySelector('#estado-guardado').textContent = `Guardado v${rec.version} · ${new Date().toLocaleTimeString('es-PE')}`;
        app.avisarCambios();
        if (!silencioso) aviso(finalizar ? `Inspección ${rec.cod_inspeccion} finalizada y guardada en el dispositivo.` : `Guardado en el dispositivo (${rec.cod_inspeccion}, versión ${rec.version}).`, 'ok');
        await pintarCabecera();
        await pintarAlertas();
        return true;
      } catch (e) {
        if (e instanceof ErrorConflicto) aviso(e.message, 'error', 10000);
        else mostrarError(e, 'No se guardó la inspección');
        return false;
      } finally {
        main.querySelectorAll('[data-accion]').forEach(b => { b.disabled = false; });
      }
    })();
  }

  function cambio() {
    app.sucio = true;
    main.querySelector('#estado-guardado').textContent = 'Cambios sin guardar';
    // Autoguardado sólo de borradores ya creados (§7.1); una inspección finalizada se guarda con el botón.
    if (guardado() && rec.estado_registro === 'Borrador') {
      clearTimeout(temporizador);
      temporizador = setTimeout(() => guardar({ silencioso: true }).then(ok => { if (ok) main.querySelector('#estado-guardado').textContent = `Autoguardado ${new Date().toLocaleTimeString('es-PE')}`; }), 1500);
    }
  }

  const v = (k) => esc(rec[k] ?? '');
  main.innerHTML = `
  <section class="tarjeta destacada" id="cab"></section>
  <form id="form-insp" novalidate>
  <section class="tarjeta"><h3>1. Identificación de la inspección</h3>
    <div class="rejilla">
      <label class="campo"><span>Fecha *</span><input type="date" data-k="fecha" value="${v('fecha')}" required></label>
      <label class="campo"><span>Hora inicio</span><input type="time" data-k="hora_inicio" value="${v('hora_inicio')}"></label>
      <label class="campo"><span>Hora fin</span><input type="time" data-k="hora_fin" value="${v('hora_fin')}"></label>
      <label class="campo"><span>Inspector responsable</span><input data-k="inspector" value="${v('inspector')}" list="dl-personas" autocomplete="name"></label>
      <label class="campo"><span>Equipo participante</span><input data-k="equipo_participante" value="${v('equipo_participante')}"></label>
      <label class="campo"><span>Cuadrilla</span><input data-k="cuadrilla" value="${v('cuadrilla')}"></label>
      <label class="campo"><span>Condición de acceso</span><select data-k="acceso">${opciones(accesos, rec.acceso)}</select></label>
      <label class="campo"><span>Condición climática</span><input data-k="clima" value="${v('clima')}"></label>
      <label class="campo"><span>Ficha N° (opcional, D-05)</span><input data-k="ficha_n" value="${v('ficha_n')}"></label>
    </div>
    <div id="bloque-no-acceso" ${rec.acceso === 'No accesible' ? '' : 'hidden'}>
      <label class="campo"><span>Motivo de "No accesible"</span><textarea data-k="motivo_no_acceso" rows="2">${v('motivo_no_acceso')}</textarea></label>
    </div>
  </section>
  <section class="tarjeta"><h3>Ubicación GPS</h3>
    <p class="sub">Coordenada registrada (PM): E ${fmtNum(loc.este, 4)} · N ${fmtNum(loc.norte, 4)} · ${esc(loc.estado_coord)}</p>
    <div class="rejilla">
      <label class="campo"><span>GPS Este (UTM 17S)</span><input type="number" step="0.1" inputmode="decimal" data-k="gps_este" data-num value="${v('gps_este')}"></label>
      <label class="campo"><span>GPS Norte (UTM 17S)</span><input type="number" step="0.1" inputmode="decimal" data-k="gps_norte" data-num value="${v('gps_norte')}"></label>
      <label class="campo"><span>Precisión GPS (m)</span><input type="number" step="0.1" inputmode="decimal" data-k="gps_precision_m" data-num value="${v('gps_precision_m')}"></label>
      <div class="campo"><span>Diferencia con lo registrado</span><output id="dif">—</output></div>
    </div>
    <div class="acciones-fila"><button type="button" class="btn" id="btn-gps">📍 Capturar GPS del dispositivo</button><span class="sub" id="gps-info">${rec.gps_origen ? `Origen: ${esc(rec.gps_origen)}` : ''}</span></div>
  </section>
  <section class="tarjeta" id="bloque-checklist" ${rec.acceso === 'No accesible' ? 'hidden' : ''}><h3>2. Lista de verificación de campo</h3>
    <p class="nota">Resultado: ${resultados.map(esc).join(' · ')}. La observación es obligatoria si el resultado es No conforme o No verificable.</p>
    <div id="items"></div>
  </section>
  <section class="tarjeta"><h3>3. Resumen</h3>
    <div class="rejilla">
      <label class="campo"><span>Medio de atención sugerido</span><select data-k="medio_atencion">${opciones(medios, rec.medio_atencion)}</select></label>
    </div>
    <label class="campo"><span>Conclusión del inspector</span><textarea data-k="conclusion" rows="3">${v('conclusion')}</textarea></label>
    <label class="campo"><span>Observaciones de campo</span><textarea data-k="observaciones_campo" rows="2">${v('observaciones_campo')}</textarea></label>
  </section>
  </form>
  <section class="tarjeta" id="fotos-gen"></section>
  <section class="tarjeta"><div class="tarjeta-cab"><h3>Hallazgos de esta inspección</h3><button type="button" class="btn" data-accion id="btn-hallazgo">+ Nuevo hallazgo</button></div><div id="lista-hall"></div></section>
  <section class="tarjeta"><h3>Alertas (no impiden guardar)</h3><div id="alertas"></div></section>
  <div class="barra-acciones">
    <span id="estado-guardado" class="sub">${guardado() ? '' : 'Aún no guardado'}</span>
    <button type="button" class="btn btn-primario" data-accion id="btn-guardar">Guardar</button>
    <button type="button" class="btn btn-ok" data-accion id="btn-finalizar">Finalizar inspección</button>
    <button type="button" class="btn btn-peligro-sutil" data-accion id="btn-anular">Anular</button>
  </div>
  <datalist id="dl-personas"></datalist>`;

  async function pintarCabecera() {
    main.querySelector('#cab').innerHTML = `<div class="tarjeta-cab"><div>
      <h2>${guardado() ? esc(rec.cod_inspeccion) : 'Nueva inspección'}${rec.codigo_provisional ? ' <small>(código provisional)</small>' : ''}</h2>
      <p class="sub"><a href="#/locacion/${loc.id_insp}">${esc(loc.id_insp)} · ${esc(loc.componente)}</a> · ${esc(loc.tipo)} · Lote ${esc(loc.lote)} · ${esc(loc.yacimiento)} · Jornada ${esc(loc.jornada)} (${fmtFecha(loc.fecha_plan)})</p>
      <p class="sub">Alcance PA: ${esc(loc.campos?.TRABAJOS || '—')}</p></div>
      <div>${chipPrioridad(loc.prioridad_ambiental)} ${chipEstado(rec.estado_registro)} ${guardado() ? chipSync(rec.sync_estado) : '<span class="chip">Sin guardar</span>'} ${guardado() ? `<span class="chip">v${rec.version}</span>` : ''}</div></div>
      ${rec.anulado ? `<p class="aviso-texto">Inspección ANULADA: ${esc(rec.motivo_anulacion)}</p>` : ''}`;
    main.querySelector('#btn-finalizar').hidden = rec.estado_registro === 'Finalizada' || rec.anulado;
    main.querySelector('#btn-guardar').textContent = rec.estado_registro === 'Finalizada' ? 'Guardar cambios' : 'Guardar borrador';
    main.querySelector('#btn-anular').hidden = !guardado() || rec.anulado;
    for (const b of main.querySelectorAll('#btn-guardar, #btn-hallazgo')) b.hidden = !!rec.anulado;
  }

  function pintarItems() {
    let seccion = '';
    main.querySelector('#items').innerHTML = items.map(it => {
      const r = rec.respuestas?.[it.codigo] || {};
      const cab = it.seccion !== seccion ? `<h4 class="seccion">${esc(seccion = it.seccion)}</h4>` : '';
      const requiereObs = r.resultado === 'No conforme' || r.resultado === 'No verificable';
      return `${cab}<div class="item ${r.resultado ? 'res-' + esc(r.resultado.replace(/\s+/g, '-').toLowerCase()) : ''}" data-item="${esc(it.codigo)}">
        <div class="item-cab"><b>${esc(it.codigo)}</b> ${esc(it.texto)}</div>
        <div class="segmentos" role="radiogroup" aria-label="Resultado ${esc(it.codigo)}">${resultados.map(x => `
          <label><input type="radio" name="r-${esc(it.codigo)}" value="${esc(x)}" ${r.resultado === x ? 'checked' : ''}><span>${esc(x)}</span></label>`).join('')}</div>
        <label class="campo"><span>Observación / justificación${requiereObs ? ' (obligatoria)' : ''}</span><textarea rows="1" data-obs="${esc(it.codigo)}" class="${requiereObs && !r.observacion ? 'falta' : ''}">${esc(r.observacion || '')}</textarea></label>
        ${it.codigo === 'B2' ? `<label class="campo"><span>Lectura PID / explosímetro</span><input data-lect="B2" value="${esc(r.lectura_instrumento || '')}" placeholder="Ej.: 2 ppm"></label>` : ''}
        ${r.resultado === 'No conforme' ? `<div class="item-hall" data-hall-item="${esc(it.codigo)}"></div><button type="button" class="btn btn-sm" data-accion data-nuevo-hall="${esc(it.codigo)}">+ Registrar hallazgo de ${esc(it.codigo)}</button>` : ''}
      </div>`;
    }).join('');
    pintarHallazgosItems();
  }

  async function hallazgosActuales() { return guardado() ? (await repo.hallazgosDeInspeccion(rec.uuid)).filter(h => !h.anulado) : []; }

  async function pintarHallazgosItems() {
    const hs = await hallazgosActuales();
    for (const el of main.querySelectorAll('[data-hall-item]')) {
      const del = hs.filter(h => h.item_checklist === el.dataset.hallItem);
      el.innerHTML = del.length ? del.map(h => `<a href="#/hallazgo/${h.uuid}">${esc(h.cod_hallazgo)}</a> ${chipEstado(h.estado)}`).join(' ') : '<span class="aviso-texto">Sin hallazgo vinculado</span>';
    }
    main.querySelector('#lista-hall').innerHTML = hs.length ? `<ul class="lista">${hs.map(h => `<li><a href="#/hallazgo/${h.uuid}"><b>${esc(h.cod_hallazgo)}</b>${h.codigo_provisional ? ' <small>(prov.)</small>' : ''} · ${esc(h.categoria || 'sin categoría')} ${h.item_checklist ? `· ítem ${esc(h.item_checklist)}` : ''}
      <span class="sub">${esc(h.descripcion_objetiva || '')}</span></a> ${chipPrioridad(h.prioridad)} ${chipEstado(h.estado)} ${chipSync(h.sync_estado)}</li>`).join('')}</ul>` : '<p>Sin hallazgos.</p>';
  }

  async function pintarAlertas() {
    const ev = guardado() ? await repo.evidenciasDe('inspeccion_uuid', rec.uuid) : [];
    const hs = await hallazgosActuales();
    const r = { ...rec, dif_m: diferenciaM(rec.gps_este, rec.gps_norte, loc.este, loc.norte) };
    main.querySelector('#alertas').innerHTML = listaAlertas(alertasInspeccion(r, { loc, hallazgos: hs, evidencias: ev, items, hoy: repo.hoyISO() }));
  }

  function pintarDif() {
    const d = diferenciaM(rec.gps_este, rec.gps_norte, loc.este, loc.norte);
    const o = main.querySelector('#dif');
    o.textContent = d === null ? '—' : `${fmtNum(d, 1)} m`;
    o.className = d !== null && d > UMBRAL_GPS_M ? 'falta' : '';
  }

  // ---- eventos
  const form = main.querySelector('#form-insp');
  form.addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    if (k) {
      rec[k] = e.target.dataset.num !== undefined ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value;
      if (k === 'gps_este' || k === 'gps_norte') { rec.gps_origen = 'Manual'; rec.gps_lat = null; rec.gps_lon = null; main.querySelector('#gps-info').textContent = 'Origen: Manual'; pintarDif(); }
      if (k === 'acceso') {
        main.querySelector('#bloque-no-acceso').hidden = rec.acceso !== 'No accesible';
        main.querySelector('#bloque-checklist').hidden = rec.acceso === 'No accesible';
      }
    }
    const obs = e.target.dataset.obs, lect = e.target.dataset.lect;
    if (obs) { rec.respuestas[obs] = { ...(rec.respuestas[obs] || {}), observacion: e.target.value }; e.target.classList.remove('falta'); }
    if (lect) rec.respuestas[lect] = { ...(rec.respuestas[lect] || {}), lectura_instrumento: e.target.value };
    if (e.target.type === 'radio') {
      const cod = e.target.name.slice(2);
      rec.respuestas[cod] = { ...(rec.respuestas[cod] || {}), resultado: e.target.value };
      pintarItems();
    }
    cambio();
    pintarAlertas();
  });

  main.querySelector('#btn-gps').addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true; b.textContent = 'Obteniendo GPS…';
    try {
      const p = await posicionActual();
      Object.assign(rec, { gps_lat: p.lat, gps_lon: p.lon, gps_este: p.este, gps_norte: p.norte, gps_precision_m: p.precision, gps_origen: 'Dispositivo' });
      main.querySelector('[data-k=gps_este]').value = p.este;
      main.querySelector('[data-k=gps_norte]').value = p.norte;
      main.querySelector('[data-k=gps_precision_m]').value = p.precision;
      main.querySelector('#gps-info').textContent = `Origen: Dispositivo · lat ${p.lat.toFixed(6)}, lon ${p.lon.toFixed(6)}`;
      pintarDif(); cambio(); pintarAlertas();
      aviso(`GPS capturado (precisión ${p.precision} m).`, p.precision > UMBRAL_GPS_M ? 'info' : 'ok');
    } catch (er) {
      aviso(`${er.message} Puede ingresar la coordenada manualmente (por ejemplo, del GPS submétrico).`, 'error', 8000);
    } finally { b.disabled = false; b.textContent = '📍 Capturar GPS del dispositivo'; }
  });

  main.addEventListener('click', async (e) => {
    const item = e.target.closest('[data-nuevo-hall]')?.dataset.nuevoHall;
    if (item !== undefined || e.target.id === 'btn-hallazgo') {
      if (!(await guardar({ silencioso: true }))) return;
      location.hash = `#/hallazgo/nuevo/${rec.uuid}${item ? `?item=${item}` : ''}`;
    }
  });
  main.querySelector('#btn-guardar').addEventListener('click', () => guardar());
  main.querySelector('#btn-finalizar').addEventListener('click', async () => {
    const ev = guardado() ? await repo.evidenciasDe('inspeccion_uuid', rec.uuid) : [];
    const al = alertasInspeccion({ ...rec, estado_registro: 'Finalizada', dif_m: diferenciaM(rec.gps_este, rec.gps_norte, loc.este, loc.norte) },
      { loc, hallazgos: await hallazgosActuales(), evidencias: ev, items, hoy: repo.hoyISO() });
    if (!rec.acceso) { aviso('Indique la condición de acceso antes de finalizar.', 'error'); return; }
    if (al.length && !(await dialogo({ titulo: `Finalizar con ${al.length} alerta(s)`, mensaje: al.map(a => `${a.codigo}: ${a.mensaje}`).join('\n'), aceptar: 'Finalizar igual', cancelar: 'Revisar' }))) return;
    if (!rec.hora_fin) { rec.hora_fin = repo.horaActual(); main.querySelector('[data-k=hora_fin]').value = rec.hora_fin; }
    if (await guardar({ finalizar: true })) pintarAlertas();
  });
  main.querySelector('#btn-anular').addEventListener('click', async () => {
    const motivo = await dialogo({ titulo: 'Anular inspección', mensaje: 'La inspección no se borra: queda anulada con su motivo. Sus hallazgos se mantienen y deben revisarse.', pide: true, etiqueta: 'Motivo de la anulación', aceptar: 'Anular', peligro: true });
    if (!motivo) return;
    try { rec = await repo.anular('inspeccion', rec.uuid, motivo, rec.version); app.sucio = false; app.avisarCambios(); aviso('Inspección anulada.', 'ok'); await pintarCabecera(); } catch (er) { mostrarError(er); }
  });

  // personas usadas antes (D7: texto libre con autocompletado)
  const previas = new Set();
  for (const i of await repo.inspeccionesDe(loc.id_insp)) if (i.inspector) previas.add(i.inspector);
  if (app.perfil.nombre) previas.add(app.perfil.nombre);
  main.querySelector('#dl-personas').innerHTML = [...previas].map(p => `<option value="${esc(p)}">`).join('');

  await pintarCabecera();
  pintarItems();
  pintarDif();
  await pintarAlertas();
  await montarFotos(main.querySelector('#fotos-gen'), {
    titulo: 'Fotografías generales (GEN) de la locación',
    contexto: () => ({ id_insp: loc.id_insp, inspeccion_uuid: guardado() ? rec.uuid : null, este: rec.gps_este, norte: rec.gps_norte }),
    filtro: (e) => !e.hallazgo_uuid,
    etapaPorDefecto: 'Inicial (antes)',
    antesDeAgregar: async () => (guardado() && !app.sucio) || guardar({ silencioso: true }),
    alCambiar: pintarAlertas,
  });
  if (!guardado()) app.sucio = false;
}
