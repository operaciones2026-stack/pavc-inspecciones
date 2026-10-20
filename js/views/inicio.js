import { todos, getMeta } from '../db.js';
import { hoyISO, items as listarItems } from '../repo.js';
import { calcularIndicadores, calcularAlertas } from '../stats.js';
import { estadoLocacion } from '../states.js';
import { agrupar } from '../stats.js';
import { app } from '../app-ctx.js';
import { esc, fmtNum, fmtBytes, fmtFecha, fmtFechaHora, chipEstado, chipPrioridad } from '../ui.js';

const kpi = (titulo, valor, detalle = '', cls = '') =>
  `<div class="kpi ${cls}"><div class="kpi-valor">${valor}</div><div class="kpi-titulo">${esc(titulo)}</div>${detalle ? `<div class="kpi-detalle">${detalle}</div>` : ''}</div>`;

export async function render(main) {
  const [locs, inspecciones, hallazgos, acciones, verificaciones, evidencias, outbox, maestro] = await Promise.all([
    todos('locaciones'), todos('inspecciones'), todos('hallazgos'), todos('acciones'), todos('verificaciones'), todos('evidencias'), todos('outbox'), getMeta('maestro'),
  ]);
  const hoy = hoyISO();
  if (!locs.length) {
    main.innerHTML = `<section class="tarjeta destacada"><h2>Bienvenido</h2>
      <p>Esta base (${app.esDemo ? 'demostración' : 'campo'}) todavía no tiene el programa maestro importado. Importe el
      <b>Programa Maestro V02</b> y el <b>Formato de Inspección V02</b> para cargar las locaciones, catálogos y la lista de verificación.</p>
      <p><a class="btn btn-primario" href="#/datos">Importar archivos</a></p></section>`;
    return;
  }
  const items = await listarItems();
  const alertas = calcularAlertas({ locs, inspecciones, hallazgos, acciones, verificaciones, evidencias, items, hoy });
  const ind = calcularIndicadores({ locs, inspecciones, hallazgos, acciones, evidencias, outbox, hoy, alertas });
  let almac = '';
  try {
    const est = await navigator.storage?.estimate?.();
    const pers = await getMeta('persistencia');
    if (est) almac = `${fmtBytes(est.usage)} usados de ${fmtBytes(est.quota)} disponibles · almacenamiento persistente: ${pers === true ? 'concedido' : pers === false ? 'no concedido' : 'sin dato'}`;
  } catch { /* sin estimación */ }

  const porLoc = agrupar(inspecciones.filter(i => !i.anulado), 'id_insp');
  const deHoy = locs.filter(l => l.fecha_plan === hoy).sort((a, b) => (a.orden_global ?? 0) - (b.orden_global ?? 0));
  const est = ind.estados_locacion;
  const recientes = [...inspecciones].filter(i => !i.anulado).sort((a, b) => b.actualizado_en.localeCompare(a.actualizado_en)).slice(0, 6);
  const locPorId = new Map(locs.map(l => [l.id_insp, l]));

  main.innerHTML = `
  ${app.perfil.nombre ? '' : '<p class="tarjeta aviso-texto">Configure su nombre en <a href="#/datos">Datos → Perfil del dispositivo</a>: se usa como autor en la auditoría y en las fotos.</p>'}
  <section class="kpis">
    ${kpi('Locaciones del programa', fmtNum(ind.locaciones), `${fmtNum(ind.con_fecha_plan)} con fecha planificada`)}
    ${kpi('Programadas para hoy', fmtNum(ind.programadas_hoy), fmtFecha(hoy))}
    ${kpi('Locaciones inspeccionadas', fmtNum(ind.inspeccionadas), `${fmtNum(ind.avance_pct, 1)} % de avance`, 'kpi-ok')}
    ${kpi('No accesibles', fmtNum(est['No accesible'] || 0), `En ejecución: ${fmtNum(est['En ejecución'] || 0)}`)}
    ${kpi('Visitas registradas', fmtNum(ind.visitas_finalizadas), `${fmtNum(ind.borradores)} borrador(es)`)}
    ${kpi('Hallazgos pendientes', fmtNum(ind.hallazgos_abiertos), `de ${fmtNum(ind.hallazgos)} · vencidos: ${fmtNum(ind.hallazgos_vencidos)}`, ind.hallazgos_abiertos ? 'kpi-alerta' : '')}
    ${kpi('% levantamiento verificado', `${fmtNum(ind.levantamiento_pct, 1)} %`, 'Levantados / (total − cerrados adm.)')}
    ${kpi('Sincronización', fmtNum(ind.cola.pendiente + ind.cola.error + ind.cola.enviando), `pendientes · ${fmtNum(ind.cola.sincronizado)} sincronizadas${ind.cola.error ? ` · ${ind.cola.error} con error` : ''}`, ind.cola.pendiente + ind.cola.error ? 'kpi-alerta' : 'kpi-ok')}
    ${kpi('Fotografías', fmtNum(ind.fotos), fmtBytes(ind.fotos_bytes))}
    ${kpi('Alertas vigentes', fmtNum(ind.alertas), 'Se guardó igual (D6)', ind.alertas ? 'kpi-alerta' : '')}
  </section>
  <p class="nota">${{ ninguno: 'Sin destino de sincronización: lo pendiente sigue guardado en este dispositivo. ', simulado: 'Sincroniza con el servidor simulado local. ', google: 'Sincroniza con Google (Apps Script) al pulsar Datos → Sincronizar. ' }[(app.syncConfig || app.configSyncPorDefecto()).destino] || ''}${esc(almac)}</p>
  <section class="tarjeta">
    <div class="tarjeta-cab"><h2>Buscar locación</h2></div>
    <form id="f-buscar" class="fila-buscar" role="search">
      <input type="search" name="q" placeholder="Número de pozo, instalación, INS-NNN, código PERUPETRO…" aria-label="Buscar locación" autocomplete="off">
      <button class="btn btn-primario" type="submit">Buscar</button>
    </form>
  </section>
  <section class="tarjeta">
    <div class="tarjeta-cab"><h2>Programadas para hoy (${deHoy.length})</h2></div>
    ${deHoy.length ? `<ul class="lista">${deHoy.map(l => `<li><a href="#/locacion/${l.id_insp}"><b>${esc(l.id_insp)}</b> · ${esc(l.componente)}
      <span class="sub">${esc(l.lote)} · ${esc(l.yacimiento)} · Jornada ${esc(l.jornada)} · ${esc(l.cuadrilla)}</span></a>
      ${chipPrioridad(l.prioridad_ambiental)} ${chipEstado(estadoLocacion(l, porLoc.get(l.id_insp) || []))}</li>`).join('')}</ul>`
      : '<p>No hay locaciones con fecha planificada para hoy en el programa importado.</p>'}
  </section>
  <section class="tarjeta">
    <div class="tarjeta-cab"><h2>Últimos registros en este dispositivo</h2><a href="#/historial">Ver historial</a></div>
    ${recientes.length ? `<ul class="lista">${recientes.map(i => `<li><a href="#/inspeccion/${i.uuid}"><b>${esc(i.cod_inspeccion)}</b>${i.codigo_provisional ? ' <small>(prov.)</small>' : ''} · ${esc(locPorId.get(i.id_insp)?.componente || '')}
      <span class="sub">${esc(i.estado_registro)}${i.resultado_visita ? ` · ${esc(i.resultado_visita)}` : ''} · ${fmtFechaHora(i.actualizado_en)}</span></a></li>`).join('')}</ul>`
      : '<p>Aún no hay inspecciones registradas.</p>'}
  </section>
  <p class="nota">Maestro: ${esc(maestro?.archivoPM || '—')} · importado ${fmtFechaHora(maestro?.importado_en)}</p>`;
  main.querySelector('#f-buscar').addEventListener('submit', (e) => {
    e.preventDefault();
    location.hash = `#/buscar?q=${encodeURIComponent(new FormData(e.target).get('q'))}`;
  });
}
