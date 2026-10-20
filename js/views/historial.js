import { todos } from '../db.js';
import { esc, fmtFecha, fmtFechaHora, chipSync, chipEstado, chipPrioridad, fmtBytes } from '../ui.js';
import { ESTADOS_SYNC } from '../states.js';

const PESTANAS = [['insp', 'Inspecciones'], ['hall', 'Hallazgos'], ['fotos', 'Fotografías'], ['cola', 'Pendientes de envío'], ['audit', 'Auditoría']];

export async function render(main, pestana = 'insp') {
  const [locs, insp, halls, evs, outbox, audit] = await Promise.all(['locaciones', 'inspecciones', 'hallazgos', 'evidencias', 'outbox', 'auditoria'].map(n => todos(n)));
  const locPorId = new Map(locs.map(l => [l.id_insp, l]));
  const inspPorUuid = new Map(insp.map(i => [i.uuid, i]));
  const reg = new Map([...insp, ...halls, ...evs].map(r => [r.uuid, r]));
  main.innerHTML = `<section class="tarjeta"><h2>Historial en este dispositivo</h2>
    <nav class="pestanas" role="tablist">${PESTANAS.map(([k, t]) => `<a role="tab" href="#/historial?t=${k}" class="${k === pestana ? 'activo' : ''}" aria-selected="${k === pestana}">${t}</a>`).join('')}</nav>
    <div class="fila-buscar"><input id="filtro" type="search" placeholder="Filtrar por código, locación, estado…" aria-label="Filtrar"><label class="chk"><input type="checkbox" id="ver-anulados"> ${pestana === 'cola' ? 'Ver también las sincronizadas' : 'Ver anulados'}</label></div>
    <div id="tabla"></div></section>`;
  const pintar = () => {
    const f = main.querySelector('#filtro').value.trim().toLowerCase();
    const anul = main.querySelector('#ver-anulados').checked;
    const ok = (txt, r) => (anul || !r?.anulado) && (!f || txt.toLowerCase().includes(f));
    let html = '';
    if (pestana === 'insp') {
      const rows = insp.sort((a, b) => `${b.fecha}${b.hora_inicio}`.localeCompare(`${a.fecha}${a.hora_inicio}`))
        .filter(i => ok(`${i.cod_inspeccion} ${i.id_insp} ${locPorId.get(i.id_insp)?.componente} ${i.estado_registro} ${i.resultado_visita} ${i.inspector}`, i));
      html = tabla(['Código', 'Locación', 'Fecha', 'Inspector', 'Estado', 'Resultado', 'Sync'], rows.map(i => [
        `<a href="#/inspeccion/${i.uuid}">${esc(i.cod_inspeccion)}</a>${i.codigo_provisional ? ' <small>(prov.)</small>' : ''}${i.anulado ? ' <span class="chip est-anulado">Anulada</span>' : ''}`,
        `${esc(i.id_insp)} · ${esc(locPorId.get(i.id_insp)?.componente || '')}`, fmtFecha(i.fecha), esc(i.inspector || ''), chipEstado(i.estado_registro), esc(i.resultado_visita || ''), chipSync(i.sync_estado)]));
    } else if (pestana === 'hall') {
      const rows = halls.sort((a, b) => a.cod_hallazgo.localeCompare(b.cod_hallazgo))
        .filter(h => ok(`${h.cod_hallazgo} ${h.id_insp} ${h.componente} ${h.estado} ${h.categoria} ${h.prioridad}`, h));
      html = tabla(['Código', 'Locación', 'Categoría', 'Prioridad', 'Estado', 'Inspección', 'Sync'], rows.map(h => [
        `<a href="#/hallazgo/${h.uuid}">${esc(h.cod_hallazgo)}</a>${h.codigo_provisional ? ' <small>(prov.)</small>' : ''}${h.anulado ? ' <span class="chip est-anulado">Anulado</span>' : ''}`,
        `${esc(h.id_insp)} · ${esc(h.componente || '')}`, esc(h.categoria || ''), chipPrioridad(h.prioridad), chipEstado(h.estado), esc(inspPorUuid.get(h.inspeccion_uuid)?.cod_inspeccion || ''), chipSync(h.sync_estado)]));
    } else if (pestana === 'fotos') {
      const rows = evs.sort((a, b) => a.codigo_foto.localeCompare(b.codigo_foto)).filter(e => ok(`${e.codigo_foto} ${e.id_insp} ${e.etapa} ${e.descripcion}`, e));
      html = tabla(['Código de foto', 'Locación', 'Etapa', 'Vinculada a', 'Tamaño', 'Registro', 'Archivo'], rows.map(e => [
        `${esc(e.codigo_foto)}${e.anulado ? ' <span class="chip est-anulado">Anulada</span>' : ''}`, esc(e.id_insp), esc(e.etapa),
        e.hallazgo_uuid ? `<a href="#/hallazgo/${e.hallazgo_uuid}">${esc(reg.get(e.hallazgo_uuid)?.cod_hallazgo || 'hallazgo')}</a>` : e.inspeccion_uuid ? `<a href="#/inspeccion/${e.inspeccion_uuid}">${esc(inspPorUuid.get(e.inspeccion_uuid)?.cod_inspeccion || 'inspección')}</a>` : '—',
        fmtBytes(e.bytes), chipSync(e.sync_estado), chipSync(e.archivo_sync_estado)]));
    } else if (pestana === 'cola') {
      const rows = outbox.filter(o => o.estado !== 'sincronizado' || anul).sort((a, b) => a.orden - b.orden || a.creado_en.localeCompare(b.creado_en))
        .filter(o => { const r = reg.get(o.uuid); return !f || `${o.entidad} ${o.tipo} ${o.estado} ${r?.cod_inspeccion || r?.cod_hallazgo || r?.codigo_foto || ''}`.toLowerCase().includes(f); });
      html = `<p class="nota">${anul ? 'Incluye operaciones ya sincronizadas.' : 'Sólo operaciones pendientes o con error.'}</p>` + tabla(['Entidad', 'Operación', 'Registro', 'Versión', 'Estado', 'Intentos', 'Último error', 'Creada'], rows.map(o => {
        const r = reg.get(o.uuid);
        return [esc(o.entidad), esc(o.tipo), esc(r?.cod_inspeccion || r?.cod_hallazgo || r?.codigo_foto || o.uuid.slice(0, 8)), o.version, esc(ESTADOS_SYNC[o.estado] || o.estado), o.intentos, esc(o.ultimo_error || ''), fmtFechaHora(o.creado_en)];
      }));
    } else {
      const rows = audit.sort((a, b) => b.fecha_hora.localeCompare(a.fecha_hora)).filter(a => !f || `${a.accion} ${a.entidad} ${a.codigo} ${a.usuario} ${a.detalle}`.toLowerCase().includes(f)).slice(0, 500);
      html = tabla(['Fecha y hora', 'Usuario', 'Acción', 'Entidad', 'Registro', 'Versión', 'Detalle'], rows.map(a => [fmtFechaHora(a.fecha_hora), esc(a.usuario || ''), esc(a.accion), esc(a.entidad), esc(a.codigo || ''), esc(a.version ?? ''), esc(a.detalle || '')]));
    }
    main.querySelector('#tabla').innerHTML = html;
  };
  main.querySelector('#filtro').addEventListener('input', pintar);
  main.querySelector('#ver-anulados').addEventListener('change', pintar);
  pintar();
}

function tabla(cab, filas) {
  if (!filas.length) return '<p>No hay registros.</p>';
  return `<p class="nota">${filas.length} registro(s)</p><div class="tabla-scroll"><table><thead><tr>${cab.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${filas.map(f => `<tr>${f.map(c => `<td>${c ?? ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
