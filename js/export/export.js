// Exportación (D1/D2): Excel nuevo, CSV por tabla y ZIP con Excel + fotos. Los Excel V02 no se modifican.

import { todos, getMeta, nombreBase } from '../db.js';
import { crearXlsx, crearCsv } from './xlsx-writer.js';
import { crearZip } from './zip-write.js';
import { estadoLocacion, ESTADOS_CERRADOS, LEVANTADO } from '../states.js';
import { calcularAlertas, calcularIndicadores, agrupar } from '../stats.js';
import { hoyISO } from '../repo.js';

const v = (x) => (x === null || x === undefined ? '' : x);
const si = (b) => (b ? 'Sí' : 'No');

export async function reunirDatos() {
  const nombres = ['locaciones', 'inspecciones', 'hallazgos', 'acciones', 'verificaciones', 'evidencias', 'historial_estados', 'outbox', 'items_checklist', 'auditoria'];
  const [locs, inspecciones, hallazgos, acciones, verificaciones, evidencias, historial, outbox, items, auditoria] = await Promise.all(nombres.map(n => todos(n)));
  items.sort((a, b) => a.orden - b.orden);
  locs.sort((a, b) => a.id_insp.localeCompare(b.id_insp));
  inspecciones.sort((a, b) => a.cod_inspeccion.localeCompare(b.cod_inspeccion));
  hallazgos.sort((a, b) => a.cod_hallazgo.localeCompare(b.cod_hallazgo));
  evidencias.sort((a, b) => a.codigo_foto.localeCompare(b.codigo_foto));
  acciones.sort((a, b) => a.creado_en.localeCompare(b.creado_en));
  verificaciones.sort((a, b) => a.creado_en.localeCompare(b.creado_en));
  return { locs, inspecciones, hallazgos, acciones, verificaciones, evidencias, historial, outbox, items, auditoria, maestro: await getMeta('maestro'), hoy: hoyISO() };
}

export function construirTablas(d) {
  const alertas = calcularAlertas(d);
  const ind = calcularIndicadores({ ...d, alertas });
  const inspPorLoc = agrupar(d.inspecciones.filter(i => !i.anulado), 'id_insp');
  const hallPorLoc = agrupar(d.hallazgos.filter(h => !h.anulado), 'id_insp');
  const accPorHall = agrupar(d.acciones.filter(a => !a.anulado), 'hallazgo_uuid');
  const verPorHall = agrupar(d.verificaciones.filter(x => !x.anulado), 'hallazgo_uuid');
  const evPorHall = agrupar(d.evidencias.filter(e => !e.anulado), 'hallazgo_uuid');
  const alPorUuid = agrupar(alertas, 'uuid');
  const inspPorUuid = new Map(d.inspecciones.map(i => [i.uuid, i]));
  const hallPorUuid = new Map(d.hallazgos.map(h => [h.uuid, h]));
  const alTxt = (u) => (alPorUuid.get(u) || []).map(a => a.codigo).join(', ');
  const comunes = ['UUID', 'VERSION', 'ANULADO', 'MOTIVO_ANULACION', 'CREADO_EN', 'CREADO_POR', 'ACTUALIZADO_EN', 'ACTUALIZADO_POR', 'DISPOSITIVO_ID', 'SYNC_ESTADO'];
  const vc = (r) => [r.uuid, r.version, si(r.anulado), v(r.motivo_anulacion), v(r.creado_en), v(r.creado_por), v(r.actualizado_en), v(r.actualizado_por), v(r.dispositivo_id), v(r.sync_estado)];

  const locaciones = [['ID_INSP', 'COMPONENTE', 'TIPO', 'CLASE', 'LOTE', 'YACIMIENTO', 'SECTOR', 'JORNADA', 'FECHA_PLAN', 'CUADRILLA', 'PRIORIDAD_AMBIENTAL',
    'ESTADO_INSPECCION', 'N_VISITAS', 'ULTIMA_VISITA', 'ULTIMO_RESULTADO', 'N_HALLAZGOS', 'N_HALLAZGOS_ABIERTOS', 'N_LEVANTADOS_VERIFICADOS', 'N_ALERTAS']];
  for (const l of d.locs) {
    const ins = (inspPorLoc.get(l.id_insp) || []).filter(i => i.estado_registro === 'Finalizada').sort((a, b) => `${a.fecha}${a.hora_inicio}`.localeCompare(`${b.fecha}${b.hora_inicio}`));
    const hs = hallPorLoc.get(l.id_insp) || [];
    const ult = ins[ins.length - 1];
    const nAl = [...(inspPorLoc.get(l.id_insp) || []), ...hs].reduce((s, r) => s + (alPorUuid.get(r.uuid)?.length || 0), 0);
    locaciones.push([l.id_insp, l.componente, l.tipo, l.clase, l.lote, l.yacimiento, l.sector, v(l.jornada), v(l.fecha_plan), l.cuadrilla, l.prioridad_ambiental,
      estadoLocacion(l, inspPorLoc.get(l.id_insp) || []), (inspPorLoc.get(l.id_insp) || []).length, ult ? ult.fecha : '', ult ? ult.resultado_visita : '',
      hs.length, hs.filter(h => !ESTADOS_CERRADOS.includes(h.estado)).length, hs.filter(h => h.estado === LEVANTADO).length, nAl]);
  }

  const inspecciones = [['COD_INSPECCION', 'CODIGO_PROVISIONAL', 'ID_INSP', 'COMPONENTE', 'LOTE', 'YACIMIENTO', 'FECHA', 'HORA_INICIO', 'HORA_FIN', 'INSPECTOR', 'EQUIPO_PARTICIPANTE',
    'CUADRILLA', 'ACCESO', 'CLIMA', 'FICHA_N', 'GPS_LAT', 'GPS_LON', 'GPS_ESTE', 'GPS_NORTE', 'GPS_PRECISION_M', 'GPS_ORIGEN', 'DIF_M', 'ESTADO_REGISTRO', 'RESULTADO_VISITA',
    'MOTIVO_NO_ACCESO', 'N_NO_CONFORME', 'N_NO_VERIFICABLE', 'N_SIN_RESPUESTA', 'N_HALLAZGOS', 'MEDIO_ATENCION', 'CONCLUSION', 'OBSERVACIONES_CAMPO', 'ALERTAS', ...comunes]];
  const locPorId = new Map(d.locs.map(l => [l.id_insp, l]));
  const hallPorInsp = agrupar(d.hallazgos.filter(h => !h.anulado), 'inspeccion_uuid');
  for (const i of d.inspecciones) {
    const l = locPorId.get(i.id_insp) || {};
    inspecciones.push([i.cod_inspeccion, si(i.codigo_provisional), i.id_insp, v(l.componente), v(l.lote), v(l.yacimiento), i.fecha, v(i.hora_inicio), v(i.hora_fin), v(i.inspector), v(i.equipo_participante),
      v(i.cuadrilla), v(i.acceso), v(i.clima), v(i.ficha_n), v(i.gps_lat), v(i.gps_lon), v(i.gps_este), v(i.gps_norte), v(i.gps_precision_m), v(i.gps_origen), v(i.dif_m), i.estado_registro, v(i.resultado_visita),
      v(i.motivo_no_acceso), v(i.n_no_conforme), v(i.n_no_verificable), v(i.n_sin_respuesta), (hallPorInsp.get(i.uuid) || []).length, v(i.medio_atencion), v(i.conclusion), v(i.observaciones_campo), alTxt(i.uuid), ...vc(i)]);
  }

  const checklist = [['COD_INSPECCION', 'INSPECCION_UUID', 'ITEM', 'SECCION', 'TEXTO', 'RESULTADO', 'OBSERVACION', 'LECTURA_INSTRUMENTO', 'HALLAZGOS']];
  for (const i of d.inspecciones.filter(x => !x.anulado)) {
    for (const it of d.items) {
      const r = i.respuestas?.[it.codigo] || {};
      const hs = (hallPorInsp.get(i.uuid) || []).filter(h => h.item_checklist === it.codigo).map(h => h.cod_hallazgo).join('; ');
      checklist.push([i.cod_inspeccion, i.uuid, it.codigo, it.seccion, it.texto, v(r.resultado), v(r.observacion), v(r.lectura_instrumento), hs]);
    }
  }

  const hallazgos = [['COD_HALLAZGO', 'CODIGO_PROVISIONAL', 'ID_INSP', 'COD_INSPECCION', 'ITEM_CHECKLIST', 'COMPONENTE', 'LOTE', 'YACIMIENTO', 'FECHA_IDENTIFICACION', 'CATEGORIA',
    'DESCRIPCION_OBJETIVA', 'ESTE', 'NORTE', 'DIMENSIONES_L_x_A_m', 'LARGO_M', 'ANCHO_M', 'AREA_m2', 'CONDICION_OBSERVADA', 'FOTOS_ANTES', 'RIESGO_CONSECUENCIA', 'PRIORIDAD',
    'ACCION_INMEDIATA', 'ACCION_CORRECTIVA', 'MEDIO_ATENCION', 'RESPONSABLE', 'FECHA_COMPROMISO', 'ESTADO', 'EVIDENCIA_LEVANTAMIENTO', 'FOTOS_DESPUES', 'FECHA_VERIFICACION',
    'VERIFICADOR', 'RESULTADO_VERIFICACION', 'SUSTENTO_CIERRE_ADM', 'OBSERVACIONES', 'DIAS_PARA_VENCER', 'VENCIDO', 'ALERTAS', ...comunes]];
  const dia = 86400000;
  for (const h of d.hallazgos) {
    const acc = accPorHall.get(h.uuid) || [];
    const corr = acc.filter(a => a.tipo !== 'Inmediata');
    const vig = corr.filter(a => a.estado !== 'Ejecutada' && a.fecha_compromiso).sort((a, b) => a.fecha_compromiso.localeCompare(b.fecha_compromiso))[0] || corr[0];
    const ver = (verPorHall.get(h.uuid) || []).sort((a, b) => `${a.fecha_verificacion}${a.creado_en}`.localeCompare(`${b.fecha_verificacion}${b.creado_en}`));
    const uv = ver[ver.length - 1];
    const ev = evPorHall.get(h.uuid) || [];
    const abierto = !ESTADOS_CERRADOS.includes(h.estado);
    const dias = abierto && vig?.fecha_compromiso ? Math.round((Date.parse(vig.fecha_compromiso) - Date.parse(d.hoy)) / dia) : '';
    hallazgos.push([h.cod_hallazgo, si(h.codigo_provisional), h.id_insp, h.cod_inspeccion, v(h.item_checklist), v(h.componente), v(h.lote), v(h.yacimiento), v(h.fecha_identificacion), v(h.categoria),
      v(h.descripcion_objetiva), v(h.este), v(h.norte), h.largo_m != null && h.ancho_m != null ? `${h.largo_m} x ${h.ancho_m}` : '', v(h.largo_m), v(h.ancho_m), v(h.area_m2), v(h.condicion_observada),
      ev.filter(e => e.etapa === 'Inicial (antes)').map(e => e.codigo_foto).join('; '), v(h.riesgo_consecuencia), v(h.prioridad),
      acc.filter(a => a.tipo === 'Inmediata').map(a => a.descripcion).join(' | '), corr.map(a => `[${a.tipo}] ${a.descripcion}`).join(' | '),
      v(vig?.medio_atencion), v(vig?.responsable), v(vig?.fecha_compromiso), h.estado,
      acc.map(a => a.evidencia_levantamiento).filter(Boolean).join(' | '),
      ev.filter(e => e.etapa === 'Posterior (después)' || e.etapa === 'Verificación de cierre').map(e => e.codigo_foto).join('; '),
      v(uv?.fecha_verificacion), v(uv?.verificador), v(uv?.resultado), v(h.sustento_cierre_adm), v(h.observaciones), dias, dias === '' ? '' : si(dias < 0), alTxt(h.uuid), ...vc(h)]);
  }

  const acciones = [['HALLAZGO', 'TIPO', 'DESCRIPCION', 'MEDIO_ATENCION', 'RESPONSABLE', 'FECHA_COMPROMISO', 'ESTADO', 'FECHA_EJECUCION', 'EVIDENCIA_LEVANTAMIENTO', 'HALLAZGO_UUID', ...comunes]];
  for (const a of d.acciones) acciones.push([v(hallPorUuid.get(a.hallazgo_uuid)?.cod_hallazgo), a.tipo, a.descripcion, v(a.medio_atencion), v(a.responsable), v(a.fecha_compromiso), a.estado, v(a.fecha_ejecucion), v(a.evidencia_levantamiento), a.hallazgo_uuid, ...vc(a)]);

  const verificaciones = [['HALLAZGO', 'FECHA_VERIFICACION', 'VERIFICADOR', 'RESULTADO', 'OBSERVACIONES', 'INSPECCION', 'HALLAZGO_UUID', ...comunes]];
  for (const x of d.verificaciones) verificaciones.push([v(hallPorUuid.get(x.hallazgo_uuid)?.cod_hallazgo), x.fecha_verificacion, v(x.verificador), x.resultado, v(x.observaciones), v(inspPorUuid.get(x.inspeccion_uuid)?.cod_inspeccion), x.hallazgo_uuid, ...vc(x)]);

  const evidencias = [['CODIGO_FOTO', 'CODIGO_PROVISIONAL', 'ARCHIVO_EN_ZIP', 'LOTE', 'COMPONENTE_CORTO', 'COD_HALLAZGO_CORTO', 'FECHA', 'NUMERO', 'ID_INSP', 'COD_INSPECCION', 'COD_HALLAZGO',
    'ACCION_UUID', 'VERIFICACION_UUID', 'ITEM_CHECKLIST', 'HORA', 'ESTE', 'NORTE', 'GPS_PRECISION_M', 'TIPO_EVIDENCIA', 'DESCRIPCION', 'ORIENTACION_DE_TOMA', 'PUNTO_REFERENCIA_FIJO',
    'AUTOR', 'ORIGEN_ARCHIVO', 'NOMBRE_ORIGINAL', 'BYTES', 'ANCHO_PX', 'ALTO_PX', 'HASH_SHA256', 'CONSERVA_ORIGINAL', 'ALERTAS', ...comunes]];
  for (const e of d.evidencias) {
    evidencias.push([e.codigo_foto, si(e.codigo_provisional), `fotos/${e.codigo_foto}.jpg`, e.lote_foto, e.componente_corto, e.cod_hallazgo_corto, e.fecha, e.numero, e.id_insp,
      v(inspPorUuid.get(e.inspeccion_uuid)?.cod_inspeccion), v(hallPorUuid.get(e.hallazgo_uuid)?.cod_hallazgo), v(e.accion_uuid), v(e.verificacion_uuid), v(e.item_checklist), v(e.hora),
      v(e.este), v(e.norte), v(e.gps_precision_m), v(e.etapa), v(e.descripcion), v(e.orientacion_toma), v(e.punto_referencia_fijo), v(e.autor), v(e.origen_archivo), v(e.nombre_original),
      v(e.bytes), v(e.ancho_px), v(e.alto_px), v(e.hash_sha256), si(e.conserva_original), alTxt(e.uuid), ...vc(e)]);
  }

  const historial = [['ENTIDAD', 'CODIGO', 'DESDE', 'HACIA', 'MOTIVO', 'FECHA_HORA', 'USUARIO', 'ENTIDAD_UUID']];
  for (const x of [...d.historial].sort((a, b) => a.fecha_hora.localeCompare(b.fecha_hora))) historial.push([x.entidad, v(x.codigo), v(x.desde), v(x.hacia), v(x.motivo), x.fecha_hora, v(x.usuario), x.entidad_uuid]);

  const tAlertas = [['CODIGO_ALERTA', 'ENTIDAD', 'REGISTRO', 'MENSAJE', 'UUID']];
  for (const a of alertas) tAlertas.push([a.codigo, a.entidad, a.codigo_registro, a.mensaje, a.uuid]);

  const resumen = [['INDICADOR', 'VALOR', 'NOTA'],
    ['Locaciones en el programa', ind.locaciones, ''],
    ['Locaciones inspeccionadas', ind.inspeccionadas, 'Última visita finalizada con resultado "Inspeccionada"'],
    ['% avance de inspección', Math.round(ind.avance_pct * 10) / 10, 'Inspeccionadas / locaciones (no cuenta "No accesible")'],
    ...Object.entries(ind.estados_locacion).map(([k, n]) => [`Locaciones: ${k}`, n, '']),
    ['Visitas finalizadas', ind.visitas_finalizadas, ''], ['Borradores', ind.borradores, ''],
    ['Hallazgos registrados', ind.hallazgos, ''], ['Hallazgos abiertos', ind.hallazgos_abiertos, ''], ['Hallazgos vencidos', ind.hallazgos_vencidos, ''],
    ...Object.entries(ind.hallazgos_estados).map(([k, n]) => [`Hallazgos: ${k}`, n, '']),
    ['% levantamiento verificado', Math.round(ind.levantamiento_pct * 10) / 10, 'Levantados y verificados / (total − cerrados administrativamente), FI Seguimiento'],
    ['Fotografías', ind.fotos, ''], ['Alertas vigentes', ind.alertas, 'D6: se guardó igual y se avisa'],
    ['Operaciones pendientes de sincronizar', ind.cola.pendiente + ind.cola.error, '']];

  const info = [['CAMPO', 'VALOR'],
    ['Base local', nombreBase()], ['Tipo de datos', { pavc_demo: 'DEMOSTRACIÓN (datos ficticios, no oficiales)', pavc_piloto: 'PRUEBA PILOTO (datos de prueba, no oficiales)' }[nombreBase()] || 'Campo'],
    ['Exportado en', new Date().toISOString()], ['Maestro importado', v(d.maestro?.archivoPM)], ['Formato importado', v(d.maestro?.archivoFI)], ['Maestro importado en', v(d.maestro?.importado_en)],
    ['Nota', 'Archivo generado por la PWA de inspecciones PAVC. Los Excel V02 originales no se modifican (D2).']];

  return {
    alertas, indicadores: ind,
    hojas: [
      { nombre: 'Info', filas: info }, { nombre: 'Resumen', filas: resumen }, { nombre: 'Locaciones_Avance', filas: locaciones },
      { nombre: 'Inspecciones', filas: inspecciones }, { nombre: 'Checklist_Respuestas', filas: checklist }, { nombre: 'Hallazgos', filas: hallazgos },
      { nombre: 'Acciones', filas: acciones }, { nombre: 'Verificaciones', filas: verificaciones }, { nombre: 'Evidencias', filas: evidencias },
      { nombre: 'Historial_Estados', filas: historial }, { nombre: 'Alertas', filas: tAlertas },
    ],
  };
}

const sello = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`; };
export const prefijoArchivo = () => `PAVC_Export_${{ pavc_demo: 'DEMO', pavc_piloto: 'PILOTO' }[nombreBase()] || 'Campo'}_${sello()}`;

export async function exportarExcel() {
  const t = construirTablas(await reunirDatos());
  return { blob: await crearXlsx(t.hojas), nombre: `${prefijoArchivo()}.xlsx`, tablas: t };
}

export async function exportarCsvZip() {
  const t = construirTablas(await reunirDatos());
  const blob = await crearZip(t.hojas.map(h => ({ nombre: `${h.nombre}.csv`, datos: crearCsv(h.filas) })));
  return { blob, nombre: `${prefijoArchivo()}_CSV.zip`, tablas: t };
}

export async function exportarZipCompleto() {
  const d = await reunirDatos();
  const t = construirTablas(d);
  const prefijo = prefijoArchivo();
  const archivos = [{ nombre: `${prefijo}.xlsx`, datos: await crearXlsx(t.hojas) }];
  const blobs = new Map((await todos('blobs')).map(b => [b.uuid, b]));
  let faltantes = 0;
  for (const e of d.evidencias) {
    const b = blobs.get(e.uuid);
    if (!b?.reducida) { faltantes++; continue; }
    archivos.push({ nombre: `fotos/${e.codigo_foto}.jpg`, datos: b.reducida });
    if (b.original) archivos.push({ nombre: `originales/${e.codigo_foto}_${e.nombre_original || 'original'}`, datos: b.original });
  }
  return { blob: await crearZip(archivos), nombre: `${prefijo}.zip`, tablas: t, fotos: d.evidencias.length - faltantes, faltantes };
}
