import { porIndice } from '../db.js';
import * as repo from '../repo.js';
import { estadoLocacion } from '../states.js';
import { esc, fmtFecha, fmtNum, chipPrioridad, chipEstado, chipSync } from '../ui.js';

// Grupos de columnas de PM Base_Maestra, tal como vienen en el Excel (diagnóstico §1.1).
const GRUPOS = [
  ['Identificación (Matriz original)', ['FILA_EXCEL', 'BLOQUE', 'BLOQUE_DESC', 'ITEM_ORIG', 'YACIMIENTO_ORIG']],
  ['Contraste KMZ / polígono PAVC', ['KMZ_PA_COMPONENTE', 'KMZ_PA_DIST_M', 'KMZ_PA_ESTADO', 'POLIGONO_PAVC', 'DENTRO_POLIGONO_PAVC', 'DIST_POLIGONO_PAVC_M', 'AREA_POLIGONO_PAVC_M2', 'ACCESO_PAVC_CERCANO']],
  ['Contraste PERUPETRO', ['PP_ID', 'PP_NOMBRE', 'PP_YACIMIENTO', 'PP_ESTADO', 'PP_DIST_M', 'PP_RESULTADO', 'PP_NOTA']],
  ['Antecedentes OEFA', ['OEFA_SITIO_CONTAM_N_AREAS', 'OEFA_SITIO_CONTAM_AREA_M2', 'OEFA_SITIO_CONTAM_VINCULO', 'AREAS_IMPACTADAS_ACTA_2023', 'MUESTRAS_ACTA_2023', 'REF_ACTA_2023', 'FECHA_OEFA_2026', 'MUESTRAS_OEFA_2026', 'PASH_OEFA_50M', 'PASH_DETALLE', 'EN_LISTA_140_POZOS', 'LISTA_140_ESTADO']],
  ['Entorno', ['POZOS_ACTIVOS_SAPET_100M', 'POZO_ACTIVO_MAS_CERCANO', 'VECINO_MAS_CERCANO', 'DIST_VECINO_M']],
  ['Alcance PA (Matriz)', ['TRABAJOS', 'N_ACTIVIDADES', 'ACTIVIDADES', 'COMENT_MATRIZ']],
  ['Priorización', ['PUNTAJE_AMBIENTAL', 'PRIORIDAD_AMBIENTAL', 'SUSTENTO_PRIORIDAD', 'VERIFICACION_UBICACION']],
];
const tieneValor = (v) => v !== null && v !== undefined && String(v).trim() !== '';
const dl = (pares) => `<dl class="datos">${pares.filter(([, v]) => tieneValor(v)).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;

export async function render(main, id) {
  const loc = await repo.locacion(id);
  if (!loc) { main.innerHTML = `<div class="tarjeta"><h2>${esc(id)}</h2><p>La locación no existe en el maestro importado.</p></div>`; return; }
  const [insp, halls, incid, muestras] = await Promise.all([
    repo.inspeccionesDe(id), repo.hallazgosDeLocacion(id), porIndice('incidencias_qc', 'id_insp', id), porIndice('antecedentes_muestreo', 'id_insp', id),
  ]);
  const vig = insp.filter(i => !i.anulado).sort((a, b) => `${b.fecha}${b.hora_inicio}`.localeCompare(`${a.fecha}${a.hora_inicio}`));
  const borrador = vig.find(i => i.estado_registro === 'Borrador');
  const estado = estadoLocacion(loc, vig);
  const p = loc.programa || {};
  main.innerHTML = `
  <section class="tarjeta destacada">
    <div class="tarjeta-cab"><div><h2>${esc(loc.id_insp)} · ${esc(loc.componente)}</h2>
      <p class="sub">${esc(loc.tipo)} (${esc(loc.clase)}) · Lote ${esc(loc.lote)} · Yacimiento ${esc(loc.yacimiento)} · Sector ${esc(loc.sector)} – ${esc(loc.nombre_sector)}</p></div>
      <div>${chipPrioridad(loc.prioridad_ambiental)} ${chipEstado(estado)}</div></div>
    ${loc.ausente_en_maestro ? '<p class="aviso-texto">Esta locación ya no figura en el último maestro importado; se conserva porque tiene registros.</p>' : ''}
    <div class="acciones-fila">
      ${borrador ? `<a class="btn btn-primario" href="#/inspeccion/${borrador.uuid}">Continuar borrador ${esc(borrador.cod_inspeccion)}</a>`
        : `<a class="btn btn-primario" href="#/inspeccion/nueva/${loc.id_insp}">Nueva inspección</a>`}
    </div>
  </section>
  <div class="columnas">
  <section class="tarjeta"><h3>Ubicación registrada</h3>
    ${dl([['ESTE (UTM 17S)', fmtNum(loc.este, 4)], ['NORTE (UTM 17S)', fmtNum(loc.norte, 4)], ['LAT', loc.lat], ['LON', loc.lon], ['Sistema', loc.campos?.CRS],
      ['Estado de la coordenada', loc.estado_coord], ['Verificación de ubicación', loc.verificacion_ubicacion]])}
    ${loc.estado_inicial === 'Requiere validación de ubicación' ? '<p class="aviso-texto">Requiere validación de ubicación antes de inspeccionar (PM Leeme, Fase 3).</p>' : ''}
  </section>
  <section class="tarjeta"><h3>Programa</h3>
    ${dl([['Fase', loc.fase], ['Jornada', loc.jornada], ['Fecha planificada', fmtFecha(loc.fecha_plan)], ['Día', loc.dia], ['Cuadrilla', loc.cuadrilla],
      ['Orden global / en jornada', `${loc.orden_global ?? '—'} / ${loc.orden_en_jornada ?? '—'}`], ['Tipo de inspección', loc.tipo_inspeccion],
      ['Tiempo de inspección (min)', loc.t_inspeccion_min], ['Requisitos previos', p.REQUISITOS_PREVIOS], ['Antecedentes (resumen)', p.ANTECEDENTES_RESUMEN],
      ['Estado inicial en el PM', loc.estado_inicial]])}
  </section></div>
  <section class="tarjeta"><h3>Inspecciones en este dispositivo (${vig.length})</h3>
    ${vig.length ? `<ul class="lista">${vig.map(i => `<li><a href="#/inspeccion/${i.uuid}"><b>${esc(i.cod_inspeccion)}</b>${i.codigo_provisional ? ' <small>(prov.)</small>' : ''}
      <span class="sub">${fmtFecha(i.fecha)} ${esc(i.hora_inicio || '')} · ${esc(i.inspector || 'sin inspector')} · ${esc(i.estado_registro)}${i.resultado_visita ? ` · ${esc(i.resultado_visita)}` : ''}</span></a> ${chipSync(i.sync_estado)}</li>`).join('')}</ul>`
      : '<p>Sin inspecciones registradas.</p>'}
    ${insp.some(i => i.anulado) ? `<p class="nota">${insp.filter(i => i.anulado).length} inspección(es) anulada(s) visibles en Historial.</p>` : ''}
  </section>
  <section class="tarjeta"><h3>Hallazgos (${halls.filter(h => !h.anulado).length})</h3>
    ${halls.filter(h => !h.anulado).length ? `<ul class="lista">${halls.filter(h => !h.anulado).map(h => `<li><a href="#/hallazgo/${h.uuid}"><b>${esc(h.cod_hallazgo)}</b>${h.codigo_provisional ? ' <small>(prov.)</small>' : ''} · ${esc(h.categoria || 'sin categoría')}
      <span class="sub">${esc(h.descripcion_objetiva || '')}</span></a> ${chipPrioridad(h.prioridad)} ${chipEstado(h.estado)}</li>`).join('')}</ul>` : '<p>Sin hallazgos registrados.</p>'}
  </section>
  <section class="tarjeta"><h3>Incidencias de calidad de datos (PM Incidencias_QC: ${incid.length})</h3>
    ${incid.length ? `<ul class="lista">${incid.map(q => `<li><b>${esc(q.id_incidencia)}</b> · ${esc(q.severidad)} · ${esc(q.categoria)} · ${esc(q.estado)}
      <span class="sub">${esc(q.descripcion)}</span><span class="sub">Acción: ${esc(q.accion)}</span></li>`).join('')}</ul>` : '<p>Sin incidencias registradas en el PM.</p>'}
  </section>
  ${muestras.length ? `<section class="tarjeta"><h3>Puntos de muestreo OEFA (PM Antecedentes_Muestreo: ${muestras.length})</h3>
    <div class="tabla-scroll"><table><thead><tr><th>Campaña</th><th>Código</th><th>Este</th><th>Norte</th><th>Profundidad</th><th>Fuente</th></tr></thead><tbody>
    ${muestras.map(m => `<tr><td>${esc(m.campana)}</td><td>${esc(m.codigo)}</td><td>${fmtNum(m.este, 2)}</td><td>${fmtNum(m.norte, 2)}</td><td>${esc(m.profundidad)}</td><td>${esc(m.fuente)}</td></tr>`).join('')}
    </tbody></table></div></section>` : ''}
  ${GRUPOS.map(([titulo, cols]) => {
    const pares = cols.map(c => [c, loc.campos?.[c]]).filter(([, v]) => tieneValor(v));
    return pares.length ? `<details class="tarjeta"><summary><h3>${esc(titulo)}</h3></summary>${dl(pares)}</details>` : '';
  }).join('')}
  <p class="nota">Datos de PM Base_Maestra / Programa (${esc(loc.maestro_archivo || '')}). No se editan en campo (D-12).</p>`;
}
