import { getMeta, setMeta, eliminarBase, NOMBRES_BASE } from '../db.js';
import { leerMaestro, guardarMaestro } from '../import/maestro.js';
import { exportarExcel, exportarCsvZip, exportarZipCompleto } from '../export/export.js';
import { procesarCola, resumenCola } from '../sync/outbox.js';
import { estadoServidorSimulado } from '../sync/adapter-sim.js';
import { sesionActual, mostrarBotonGoogle, cerrarSesion } from '../sync/google-auth.js';
import { setContexto } from '../repo.js';
import { app } from '../app-ctx.js';
import { esc, aviso, dialogo, mostrarError, descargar, fmtFechaHora, fmtBytes } from '../ui.js';

export async function render(main) {
  const maestro = await getMeta('maestro');
  const conservar = !!(await getMeta('conservar_original'));
  const cola = await resumenCola();
  const sc = app.syncConfig || app.configSyncPorDefecto();
  const admin = app.esAdmin;
  main.classList.toggle('modo-inspector', !admin);
  main.innerHTML = `
  <section class="tarjeta"><h2>Perfil del dispositivo</h2>
    <form id="f-perfil" class="rejilla">
      <label class="campo"><span>Nombre del inspector / usuario</span><input name="nombre" value="${esc(app.perfil.nombre)}" autocomplete="name"></label>
      <label class="campo"><span>Cuadrilla</span><input name="cuadrilla" value="${esc(app.perfil.cuadrilla)}" placeholder="Ej.: Cuadrilla 1"></label>
      <div class="campo"><span>&nbsp;</span><button class="btn btn-primario">Guardar perfil</button></div>
    </form>
    <p class="nota solo-admin">Etapas 2–3: perfil local sin contraseña. Dispositivo: ${esc(app.dispositivo_id)}.</p>
  </section>
  <section class="tarjeta solo-admin"><h2>Base de datos en uso: ${{ campo: 'CAMPO', demo: 'DEMOSTRACIÓN', piloto: 'PRUEBA PILOTO' }[app.modo]}</h2>
    <p>Las bases <b>campo</b>, <b>demostración</b> y <b>prueba piloto</b> están separadas: los datos de una nunca aparecen en las otras. La demostración y el piloto usan datos de prueba, no oficiales.</p>
    <div class="acciones-fila">
      <button class="btn" id="btn-modo">Cambiar a ${app.esDemo ? 'CAMPO' : 'DEMOSTRACIÓN'}</button>
      ${app.modo === 'demo' ? '<button class="btn" id="btn-demo">Cargar datos ficticios de demostración</button>' : ''}
      ${app.esDemo ? `<button class="btn btn-peligro-sutil" id="btn-borrar-demo">Vaciar base de ${app.modo === 'piloto' ? 'prueba piloto' : 'demostración'}</button>` : ''}
    </div>
  </section>
  <section class="tarjeta${maestro ? ' solo-admin' : ''}"><h2>Importar programa maestro</h2>
    ${admin ? '' : '<p><b>Primer uso en este equipo:</b> seleccione los 2 archivos Excel que le entregó la coordinación y pulse <b>Leer y validar</b> y luego <b>Confirmar importación</b>.</p>'}
    <p class="solo-admin">Seleccione el <b>Programa Maestro</b> (hojas Base_Maestra, Programa, Cronograma, Sectores, Incidencias_QC, Antecedentes_Muestreo) y el <b>Formato de Inspección</b> (hojas Listas y Ficha_Inspeccion). Los archivos sólo se leen; no se modifican.</p>
    <form id="f-imp" class="rejilla">
      <label class="campo"><span>Programa Maestro (.xlsx)</span><input type="file" name="pm" accept=".xlsx" required></label>
      <label class="campo"><span>Formato de Inspección (.xlsx)</span><input type="file" name="fi" accept=".xlsx" required></label>
      <div class="campo"><span>&nbsp;</span><button class="btn btn-primario">Leer y validar</button></div>
    </form>
    <div id="rep-imp"></div>
    <p class="nota">Maestro actual: ${maestro ? `${esc(maestro.archivoPM)} + ${esc(maestro.archivoFI)} · ${fmtFechaHora(maestro.importado_en)} · ${esc(maestro.conteos?.locaciones)} locaciones` : 'ninguno'}</p>
  </section>
  <section class="tarjeta"><h2>${admin ? 'Exportar (respaldo y entrega)' : 'Respaldo del dispositivo'}</h2>
    ${admin ? '' : '<p>Guarda en este equipo una copia de todo lo registrado (Excel + fotos). Úsela si se lo pide la coordinación.</p>'}
    <p class="solo-admin">Genera un <b>Excel nuevo</b> (D2) con las hojas Info, Resumen, Locaciones_Avance, Inspecciones, Checklist_Respuestas, Hallazgos, Acciones, Verificaciones, Evidencias, Historial_Estados y Alertas.${app.esDemo ? ' <b>Base de demostración: el archivo se marca como DEMO.</b>' : ''}</p>
    <div class="acciones-fila">
      <button class="btn btn-primario solo-admin" data-exp="xlsx">Excel (.xlsx)</button>
      <button class="btn solo-admin" data-exp="csv">CSV por tabla (.zip)</button>
      <button class="btn" data-exp="zip">Respaldo completo: Excel + fotos (.zip)</button>
    </div>
    <div id="rep-exp"></div>
  </section>
  <section class="tarjeta"><h2>Sincronización</h2>
    <p class="solo-admin">Operaciones: ${cola.pendiente} pendientes · ${cola.error} con error · ${cola.sincronizado} sincronizadas. Los datos del dispositivo nunca se borran al sincronizar.</p>
    ${admin ? '' : '<p>1) Inicie sesión con su cuenta Google autorizada. 2) Cuando tenga señal, pulse <b>Sincronizar ahora</b>. Si no hay señal, todo queda guardado en el equipo y se envía después.</p>'}
    <form id="f-sync" class="rejilla solo-admin">
      <label class="campo"><span>Destino de esta base (${esc(app.nombreBase)})</span><select name="destino">
        ${app.esDemo ? '' : `<option value="ninguno"${sc.destino === 'ninguno' ? ' selected' : ''}>Ninguno (sólo en el dispositivo)</option>`}
        ${app.esDemo ? `<option value="simulado"${sc.destino === 'simulado' ? ' selected' : ''}>Servidor simulado (local)</option>` : ''}
        <option value="google"${sc.destino === 'google' ? ' selected' : ''}>Google (Apps Script)</option></select></label>
      <label class="campo" data-google><span>URL de la aplicación web de Apps Script</span><input name="url" value="${esc(sc.url)}" placeholder="https://script.google.com/macros/s/…/exec"></label>
      <label class="campo" data-google><span>ID de cliente OAuth</span><input name="clientId" value="${esc(sc.clientId)}" placeholder="…apps.googleusercontent.com"></label>
      <div class="campo"><span>&nbsp;</span><button class="btn">Guardar destino</button></div>
    </form>
    <div data-google>
      <p id="sesion-google" class="nota"></p>
      <div class="acciones-fila"><div id="boton-google"></div><button class="btn solo-admin" id="btn-ping" type="button">Probar conexión</button><button class="btn-link" id="btn-salir" type="button">Cerrar sesión de Google</button></div>
      <p class="nota solo-admin">Sólo identidad (correo): la aplicación no recibe permisos sobre Drive ni Sheets. El servidor acepta sólo usuarios autorizados y las bases permitidas.</p>
    </div>
    <div data-simulado>
      <label class="chk"><input type="checkbox" id="sim-sinred"> Simular sin conexión</label>
      <label class="chk"><input type="checkbox" id="sim-perder"> Simular respuesta perdida (la próxima operación se aplica pero no se confirma)</label>
      <div id="sim-estado" class="nota"></div>
    </div>
    <div class="acciones-fila"><button class="btn btn-primario" id="btn-sync">Sincronizar ahora</button></div>
    <div id="rep-sync"></div>
  </section>
  <section class="tarjeta solo-admin"><h2>Fotografías y almacenamiento</h2>
    <label class="chk"><input type="checkbox" id="chk-original" ${conservar ? 'checked' : ''}> Conservar también la foto original (duplica el espacio; D-09: desactivado por defecto)</label>
    <p id="almac" class="nota"></p>
  </section>`;

  try {
    const est = await navigator.storage?.estimate?.();
    const pers = await getMeta('persistencia');
    main.querySelector('#almac').textContent = est ? `Uso: ${fmtBytes(est.usage)} de ${fmtBytes(est.quota)}. Almacenamiento persistente: ${pers === true ? 'concedido' : 'no concedido (instale la aplicación para reducir el riesgo de borrado)'}.` : 'El navegador no informa el espacio disponible.';
  } catch { /* sin datos */ }

  main.querySelector('#f-perfil').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    app.perfil = { nombre: fd.nombre.trim(), cuadrilla: fd.cuadrilla.trim() };
    await setMeta('perfil', app.perfil);
    setContexto({ usuario: app.perfil.nombre || '(sin perfil)' });
    aviso('Perfil guardado.', 'ok');
  });
  main.querySelector('#btn-modo').addEventListener('click', async () => {
    if (await dialogo({ titulo: 'Cambiar de base', mensaje: `Se abrirá la base ${app.esDemo ? 'de CAMPO' : 'de DEMOSTRACIÓN'}. Los datos de la base actual se conservan.`, aceptar: 'Cambiar' })) app.cambiarModo(app.esDemo ? 'campo' : 'demo');
  });
  main.querySelector('#btn-demo')?.addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try {
      const { cargarDemo } = await import('../../demo/demo-seed.js');
      const r = await cargarDemo();
      aviso(`Datos ficticios cargados: ${r.inspecciones} inspecciones, ${r.hallazgos} hallazgo(s), ${r.fotos} fotos sintéticas.`, 'ok');
      app.avisarCambios();
    } catch (er) { mostrarError(er, 'No se cargaron los datos de demostración'); } finally { b.disabled = false; }
  });
  main.querySelector('#btn-borrar-demo')?.addEventListener('click', async () => {
    if (!(await dialogo({ titulo: 'Vaciar base de prueba', mensaje: `Se eliminará por completo la base ${app.nombreBase}. La base de campo no se toca.`, aceptar: 'Vaciar', peligro: true }))) return;
    if (app.nombreBase === NOMBRES_BASE.campo) return; // nunca se vacía la base de campo desde aquí
    await eliminarBase(app.nombreBase);
    location.reload();
  });

  let lectura = null;
  main.querySelector('#f-imp').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const pm = fd.get('pm'), fi = fd.get('fi');
    const rep = main.querySelector('#rep-imp');
    if (!pm?.size || !fi?.size) { aviso('Seleccione ambos archivos.', 'error'); return; }
    rep.innerHTML = '<p class="cargando">Leyendo archivos…</p>';
    try {
      lectura = await leerMaestro(await pm.arrayBuffer(), await fi.arrayBuffer(), { archivoPM: pm.name, archivoFI: fi.name });
      rep.innerHTML = reporte(lectura) + (lectura.ok ? '<div class="acciones-fila"><button class="btn btn-ok" id="btn-confirmar-imp">Confirmar importación</button></div>' : '<p class="aviso-texto">La importación tiene errores y no se puede guardar.</p>');
      rep.querySelector('#btn-confirmar-imp')?.addEventListener('click', async (ev) => {
        ev.currentTarget.disabled = true;
        try {
          const r = await guardarMaestro(lectura, { usuario: app.perfil.nombre, dispositivo: app.dispositivo_id });
          aviso(`Maestro importado: ${r.nuevas} nuevas, ${r.actualizadas} actualizadas${r.conservadas ? `, ${r.conservadas} conservadas por tener registros` : ''}.`, 'ok', 7000);
          location.hash = '#/inicio';
        } catch (er) { mostrarError(er, 'No se guardó la importación'); }
      });
    } catch (er) { rep.innerHTML = `<p class="aviso-texto">${esc(er.message)}</p>`; mostrarError(er, 'No se pudo leer el archivo'); }
  });

  main.querySelectorAll('[data-exp]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    const rep = main.querySelector('#rep-exp');
    rep.innerHTML = '<p class="cargando">Generando…</p>';
    try {
      const fn = { xlsx: exportarExcel, csv: exportarCsvZip, zip: exportarZipCompleto }[b.dataset.exp];
      const r = await fn();
      descargar(r.blob, r.nombre);
      rep.innerHTML = `<p class="ok-texto">Generado ${esc(r.nombre)} (${fmtBytes(r.blob.size)}): ${r.tablas.hojas.map(h => `${esc(h.nombre)} ${h.filas.length - 1}`).join(' · ')}${r.fotos !== undefined ? ` · ${r.fotos} foto(s)${r.faltantes ? `, ${r.faltantes} sin archivo` : ''}` : ''}.</p>`;
      await setMeta('ultima_exportacion', { nombre: r.nombre, fecha: new Date().toISOString() });
    } catch (er) { rep.innerHTML = ''; mostrarError(er, 'No se generó la exportación'); } finally { b.disabled = false; }
  }));

  const pintarSim = async () => {
    const el = main.querySelector('#sim-estado');
    if (!el || el.closest('[hidden]')) return;
    const s = await estadoServidorSimulado();
    el.textContent = `Servidor simulado: ${s.registros} registros, ${s.archivos} archivos, ${s.operaciones} operaciones aplicadas, ${s.duplicadas_descartadas} reenvíos duplicados descartados.`;
  };
  const adaptadorActual = app.adaptador();
  const sim = adaptadorActual.nombre === 'simulado' ? adaptadorActual : null;
  main.querySelector('#sim-sinred')?.addEventListener('change', (e) => { if (sim) sim.opciones.sinRed = e.target.checked; });
  main.querySelector('#sim-perder')?.addEventListener('change', (e) => { if (sim) sim.opciones.perderRespuestas = e.target.checked ? 1 : 0; });

  // ---- destino de sincronización y sesión de Google
  const mostrarSegunDestino = (destino) => {
    main.querySelectorAll('[data-google]').forEach(el => { el.hidden = destino !== 'google'; });
    main.querySelectorAll('[data-simulado]').forEach(el => { el.hidden = destino !== 'simulado'; });
  };
  mostrarSegunDestino(sc.destino);
  const fs = main.querySelector('#f-sync');
  fs.destino.addEventListener('change', () => mostrarSegunDestino(fs.destino.value));
  fs.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nuevo = { destino: fs.destino.value, url: fs.url.value.trim(), clientId: fs.clientId.value.trim() };
    if (nuevo.destino === 'google') {
      if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(nuevo.url)) { aviso('La URL debe ser la de la aplicación web: https://script.google.com/macros/s/…/exec', 'error', 8000); return; }
      if (!/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(nuevo.clientId)) { aviso('El ID de cliente OAuth no tiene el formato …apps.googleusercontent.com', 'error', 8000); return; }
    }
    await setMeta('sync_config', nuevo);
    app.syncConfig = nuevo;
    aviso('Destino de sincronización guardado.', 'ok');
    location.reload();
  });
  const pintarSesion = () => {
    const s = sesionActual();
    main.querySelector('#sesion-google').textContent = s
      ? `Sesión de Google: ${s.correo} (vence ${s.vence.toLocaleTimeString('es-PE')})`
      : 'Sin sesión de Google iniciada en esta pestaña.';
  };
  if (sc.destino === 'google') {
    pintarSesion();
    if (sc.clientId && !sesionActual()) {
      mostrarBotonGoogle(sc.clientId, main.querySelector('#boton-google'), () => { pintarSesion(); aviso('Sesión de Google iniciada.', 'ok'); })
        .catch(er => { main.querySelector('#sesion-google').textContent = er.message; });
    }
  }
  main.querySelector('#btn-salir').addEventListener('click', () => { cerrarSesion(); location.reload(); });
  main.querySelector('#btn-ping').addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try {
      const r = await app.adaptador().ping();
      aviso(`Conexión correcta: servidor ${r.version}, entorno ${r.entorno}, usuario ${r.usuario}.`, 'ok', 8000);
    } catch (er) { mostrarError(er, 'Prueba de conexión'); } finally { b.disabled = false; }
  });
  main.querySelector('#btn-sync').addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true;
    const rep = main.querySelector('#rep-sync');
    try {
      const r = await procesarCola(app.adaptador(), { forzar: true });
      const c = await resumenCola();
      rep.innerHTML = `<p class="${r.errores ? 'aviso-texto' : 'ok-texto'}">${esc(r.mensaje || `Enviadas ${r.enviadas} de ${r.total}; errores ${r.errores}.`)} Ahora: ${c.pendiente} pendientes · ${c.error} con error · ${c.sincronizado} sincronizadas.</p>`;
      if (sim) { const p = main.querySelector('#sim-perder'); if (p) p.checked = sim.opciones.perderRespuestas > 0; }
      app.avisarCambios();
      await pintarSim();
    } catch (er) { mostrarError(er, 'Error al sincronizar'); } finally { b.disabled = false; }
  });
  main.querySelector('#chk-original').addEventListener('change', async (e) => { await setMeta('conservar_original', e.target.checked); aviso('Preferencia de fotos guardada.', 'ok'); });
  await pintarSim();
}

function reporte(l) {
  const c = l.conteos || {};
  return `<div class="reporte">
    <p><b>${l.ok ? 'Archivos válidos' : 'Archivos con errores'}</b>: ${c.locaciones ?? 0} locaciones (${c.pozos ?? 0} pozos, ${c.instalaciones ?? 0} instalaciones; Lote VI ${c.lote_VI ?? 0}, Lote VII ${c.lote_VII ?? 0}) ·
    ${c.items ?? 0} ítems de verificación · ${c.catalogos ?? 0} catálogos · ${c.incidencias ?? 0} incidencias QC · ${c.antecedentes ?? 0} puntos de muestreo · ${c.jornadas ?? 0} jornadas · ${c.sectores ?? 0} sectores.</p>
    ${l.errores.length ? `<p class="aviso-texto">Errores (${l.errores.length}):</p><ul>${l.errores.slice(0, 50).map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
    ${l.avisos.length ? `<details><summary>Avisos (${l.avisos.length})</summary><ul>${l.avisos.slice(0, 100).map(e => `<li>${esc(e)}</li>`).join('')}</ul></details>` : ''}</div>`;
}
