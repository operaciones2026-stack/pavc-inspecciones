// Repositorio de datos de campo. Cada guardado es UNA transacción: registro + historial + auditoría + bandeja de salida.
// Reglas estructurales (bloqueantes, §5.1) aquí; las demás reglas son alertas (rules.js).

import { tx, req, obtener, todos, porIndice } from './db.js';
import * as ids from './ids.js';
import { diferenciaM } from './geo.js';
import { procesarFoto } from './photos.js';
import {
  transicionPermitida, SOLO_POR_VERIFICACION, admiteVerificacion, estadoTrasVerificacion,
  NO_LEVANTADO, CERRADO_ADM, TIPOS_ACCION, ESTADOS_ACCION,
} from './states.js';

export class ErrorEstructural extends Error { constructor(m) { super(m); this.name = 'ErrorEstructural'; } }
export class ErrorConflicto extends Error { constructor(m) { super(m); this.name = 'ErrorConflicto'; } }
export class ErrorDuplicado extends Error { constructor(m, existente) { super(m); this.name = 'ErrorDuplicado'; this.existente = existente; } }

export const ALMACEN = { inspeccion: 'inspecciones', hallazgo: 'hallazgos', accion: 'acciones', verificacion: 'verificaciones', evidencia: 'evidencias', historial: 'historial_estados' };
export const ORDEN_SYNC = { inspeccion: 1, hallazgo: 2, accion: 3, verificacion: 4, evidencia: 5, archivo: 6, historial: 7 };
const CAMPOS_SYNC = ['sincronizado_en', 'sync_version_servidor', 'drive_file_id', 'drive_url', 'archivo_sync_estado'];

let ctx = { usuario: '', dispositivo_id: '' };
export function setContexto(c) { ctx = { ...ctx, ...c }; }
export function contexto() { return { ...ctx }; }

const p2 = (n) => String(n).padStart(2, '0');
export function hoyISO(d = new Date()) { return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; }
export function horaActual(d = new Date()) { return `${p2(d.getHours())}:${p2(d.getMinutes())}`; }
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const vacio = (v) => v === null || v === undefined || String(v).trim() === '';

function sellar(rec, previo) {
  const ahora = new Date().toISOString();
  if (!previo) {
    Object.assign(rec, { creado_en: ahora, creado_por: ctx.usuario, dispositivo_id: ctx.dispositivo_id, anulado: false, version: 1 });
  } else {
    if ((rec.version ?? 0) !== previo.version) {
      throw new ErrorConflicto('Este registro fue modificado en otra pestaña o ventana. Recargue la página para ver la versión vigente; sus cambios no se guardaron.');
    }
    Object.assign(rec, { creado_en: previo.creado_en, creado_por: previo.creado_por, dispositivo_id: previo.dispositivo_id, version: previo.version + 1 });
    for (const c of CAMPOS_SYNC) if (c in previo) rec[c] = previo[c];
  }
  rec.actualizado_en = ahora;
  rec.actualizado_por = ctx.usuario;
  rec.sync_estado = 'pendiente';
  return rec;
}

async function encolar(t, entidad, rec, tipo = 'upsert') {
  const s = t.objectStore('outbox');
  // Compactación: una operación pendiente anterior del mismo registro y tipo queda reemplazada.
  const previas = await req(s.index('uuid').getAll(rec.uuid));
  for (const o of previas) if (o.entidad === entidad && o.tipo === tipo && o.estado === 'pendiente') s.delete(o.op_id);
  s.put({
    op_id: ids.uuid(), entidad, uuid: rec.uuid, version: rec.version, tipo, estado: 'pendiente', intentos: 0,
    orden: ORDEN_SYNC[tipo === 'subir_archivo' ? 'archivo' : entidad], creado_en: new Date().toISOString(), siguiente_intento: 0, ultimo_error: '',
  });
}

function auditar(t, accion, entidad, rec, detalle = '') {
  t.objectStore('auditoria').put({
    uuid: ids.uuid(), fecha_hora: new Date().toISOString(), usuario: ctx.usuario, dispositivo: ctx.dispositivo_id,
    accion, entidad, entidad_uuid: rec.uuid, codigo: rec.cod_inspeccion || rec.cod_hallazgo || rec.codigo_foto || rec.tipo || '', version: rec.version, detalle,
  });
}

function historial(t, entidad, rec, desde, hacia, motivo = '') {
  const h = {
    uuid: ids.uuid(), entidad, entidad_uuid: rec.uuid, codigo: rec.cod_inspeccion || rec.cod_hallazgo || '',
    desde, hacia, motivo, fecha_hora: new Date().toISOString(), usuario: ctx.usuario,
    version: 1, dispositivo_id: ctx.dispositivo_id, sync_estado: 'pendiente',
  };
  t.objectStore('historial_estados').put(h);
  // El historial también se sincroniza (sólo se agrega, nunca se edita): conserva los estados intermedios y sus motivos.
  t.objectStore('outbox').put({
    op_id: ids.uuid(), entidad: 'historial', uuid: h.uuid, version: 1, tipo: 'upsert', estado: 'pendiente', intentos: 0,
    orden: ORDEN_SYNC.historial, creado_en: h.fecha_hora, siguiente_intento: 0, ultimo_error: '',
  });
}

// ---------------------------------------------------------------- consultas
export const locacion = (id) => obtener('locaciones', id);
export const locaciones = () => todos('locaciones');
export const inspeccion = (u) => obtener('inspecciones', u);
export const hallazgo = (u) => obtener('hallazgos', u);
export const inspeccionesDe = (id) => porIndice('inspecciones', 'id_insp', id);
export const hallazgosDeLocacion = (id) => porIndice('hallazgos', 'id_insp', id);
export const hallazgosDeInspeccion = (u) => porIndice('hallazgos', 'inspeccion_uuid', u);
export const accionesDe = (u) => porIndice('acciones', 'hallazgo_uuid', u);
export const verificacionesDe = (u) => porIndice('verificaciones', 'hallazgo_uuid', u);
export const evidenciasDe = (indice, valor) => porIndice('evidencias', indice, valor);
export const blob = (u) => obtener('blobs', u);
export const historialDe = (u) => porIndice('historial_estados', 'entidad_uuid', u);
export async function items() { return (await todos('items_checklist')).sort((a, b) => a.orden - b.orden); }
export async function catalogo(nombre) {
  return (await porIndice('catalogos', 'catalogo', nombre)).sort((a, b) => a.orden - b.orden).map(c => c.valor);
}
export async function todoElCampo() {
  const [inspecciones, hallazgos, acciones, verificaciones, evidencias] = await Promise.all(
    ['inspecciones', 'hallazgos', 'acciones', 'verificaciones', 'evidencias'].map(a => todos(a)));
  return { inspecciones, hallazgos, acciones, verificaciones, evidencias };
}

// ---------------------------------------------------------------- inspecciones
export function nuevaInspeccion(loc, perfil = {}) {
  return {
    uuid: ids.uuid(), version: 0, id_insp: loc.id_insp, fecha: hoyISO(), hora_inicio: horaActual(), hora_fin: '',
    inspector: perfil.nombre || '', equipo_participante: '', cuadrilla: perfil.cuadrilla || loc.cuadrilla || '',
    acceso: '', clima: '', ficha_n: '', gps_lat: null, gps_lon: null, gps_este: null, gps_norte: null, gps_precision_m: null, gps_origen: '',
    motivo_no_acceso: '', respuestas: {}, medio_atencion: '', conclusion: '', observaciones_campo: '', estado_registro: 'Borrador',
  };
}

export async function guardarInspeccion(datos, { finalizar = false } = {}) {
  if (!ids.RE_ID_INSP.test(datos.id_insp || '')) throw new ErrorEstructural('Seleccione una locación válida (ID_INSP).');
  if (!RE_FECHA.test(datos.fecha || '')) throw new ErrorEstructural('La fecha de inspección es obligatoria.');
  return tx(['locaciones', 'items_checklist', 'inspecciones', 'outbox', 'auditoria', 'historial_estados'], 'readwrite', async (t) => {
    const loc = await req(t.objectStore('locaciones').get(datos.id_insp));
    if (!loc) throw new ErrorEstructural(`La locación ${datos.id_insp} no existe en el maestro importado.`);
    const previo = datos.uuid ? await req(t.objectStore('inspecciones').get(datos.uuid)) : null;
    if (previo?.anulado) throw new ErrorEstructural('La inspección está anulada y no se puede modificar.');
    const rec = structuredClone(datos);
    if (!rec.uuid) rec.uuid = ids.uuid();
    if (!previo || previo.fecha !== rec.fecha) {
      const otras = (await req(t.objectStore('inspecciones').index('id_insp').getAll(rec.id_insp))).filter(i => i.uuid !== rec.uuid);
      const n = Math.max(0, ...otras.map(i => ids.numeroVisitaDelDia(i.cod_inspeccion, rec.id_insp, rec.fecha))) + 1;
      rec.cod_inspeccion = ids.codInspeccion(rec.id_insp, rec.fecha, n);
      rec.codigo_provisional = true; // D-22: se confirma al sincronizar
    } else {
      rec.cod_inspeccion = previo.cod_inspeccion;
      rec.codigo_provisional = previo.codigo_provisional;
    }
    rec.dif_m = diferenciaM(rec.gps_este, rec.gps_norte, loc.este, loc.norte);
    const listaItems = await req(t.objectStore('items_checklist').getAll());
    const r = rec.respuestas || {};
    rec.n_no_conforme = listaItems.filter(i => r[i.codigo]?.resultado === 'No conforme').length;
    rec.n_no_verificable = listaItems.filter(i => r[i.codigo]?.resultado === 'No verificable').length;
    rec.n_sin_respuesta = listaItems.filter(i => vacio(r[i.codigo]?.resultado)).length;
    const estadoPrevio = previo?.estado_registro ?? null;
    rec.estado_registro = finalizar ? 'Finalizada' : (previo?.estado_registro || 'Borrador');
    rec.resultado_visita = rec.estado_registro === 'Finalizada' ? (rec.acceso === 'No accesible' ? 'No accesible' : 'Inspeccionada') : '';
    sellar(rec, previo);
    t.objectStore('inspecciones').put(rec);
    if (estadoPrevio !== rec.estado_registro) {
      const motivo = rec.estado_registro === 'Finalizada'
        ? (rec.acceso === 'No accesible'
          ? `Finalizada por el inspector: locación no accesible${vacio(rec.motivo_no_acceso) ? '' : ' (' + rec.motivo_no_acceso + ')'}`
          : 'Finalizada por el inspector: inspección completada')
        : (estadoPrevio === null ? 'Registro de la inspección (borrador)' : `Cambio de estado a ${rec.estado_registro}`);
      historial(t, 'inspeccion', rec, estadoPrevio, rec.estado_registro, motivo);
    }
    await encolar(t, 'inspeccion', rec);
    auditar(t, previo ? 'editar' : 'crear', 'inspeccion', rec, finalizar ? 'finalizar' : '');
    return rec;
  });
}

// ---------------------------------------------------------------- hallazgos y acciones
export function nuevoHallazgo(insp, item = '') {
  return {
    uuid: ids.uuid(), version: 0, id_insp: insp.id_insp, inspeccion_uuid: insp.uuid, cod_inspeccion: insp.cod_inspeccion,
    item_checklist: item, fecha_identificacion: insp.fecha, categoria: '', descripcion_objetiva: '',
    este: insp.gps_este ?? null, norte: insp.gps_norte ?? null, largo_m: null, ancho_m: null, area_m2: null,
    condicion_observada: '', riesgo_consecuencia: '', prioridad: '', sustento_cierre_adm: '', observaciones: '',
  };
}

function prepararAccion(datos, hallazgoUuid) {
  if (!TIPOS_ACCION.includes(datos.tipo)) throw new ErrorEstructural('Tipo de acción no válido.');
  if (vacio(datos.descripcion)) throw new ErrorEstructural('La acción necesita una descripción.');
  const rec = structuredClone(datos);
  rec.uuid = rec.uuid || ids.uuid();
  rec.hallazgo_uuid = hallazgoUuid;
  rec.estado = ESTADOS_ACCION.includes(rec.estado) ? rec.estado : 'Pendiente';
  if (rec.estado === 'Ejecutada' && vacio(rec.fecha_ejecucion)) rec.fecha_ejecucion = hoyISO();
  return rec;
}

/** accionesIniciales: [{tipo:'Inmediata'|'Correctiva', descripcion, medio_atencion, responsable, fecha_compromiso}] (sólo al crear). */
export async function guardarHallazgo(datos, { accionesIniciales = [] } = {}) {
  if (!datos.inspeccion_uuid) throw new ErrorEstructural('El hallazgo debe pertenecer a una inspección guardada.');
  return tx(['locaciones', 'inspecciones', 'hallazgos', 'acciones', 'outbox', 'auditoria', 'historial_estados'], 'readwrite', async (t) => {
    const insp = await req(t.objectStore('inspecciones').get(datos.inspeccion_uuid));
    if (!insp || insp.anulado) throw new ErrorEstructural('La inspección de origen no existe o está anulada.');
    const loc = await req(t.objectStore('locaciones').get(insp.id_insp));
    const previo = datos.uuid ? await req(t.objectStore('hallazgos').get(datos.uuid)) : null;
    if (previo?.anulado) throw new ErrorEstructural('El hallazgo está anulado y no se puede modificar.');
    const rec = structuredClone(datos);
    rec.uuid = rec.uuid || ids.uuid();
    rec.id_insp = insp.id_insp;
    rec.cod_inspeccion = insp.cod_inspeccion;
    if (!previo) {
      const todosLoc = await req(t.objectStore('hallazgos').index('id_insp').getAll(insp.id_insp));
      const n = Math.max(0, ...todosLoc.map(h => ids.numeroHallazgo(h.cod_hallazgo))) + 1;
      rec.cod_hallazgo = ids.codHallazgo(insp.id_insp, n);
      rec.codigo_provisional = true;
      rec.estado = 'Nuevo'; // FI Instructivo B6
      rec.componente = loc?.componente ?? ''; rec.lote = loc?.lote ?? ''; rec.yacimiento = loc?.yacimiento ?? '';
    } else {
      for (const c of ['cod_hallazgo', 'codigo_provisional', 'estado', 'componente', 'lote', 'yacimiento']) rec[c] = previo[c];
    }
    for (const c of ['este', 'norte', 'largo_m', 'ancho_m', 'area_m2']) rec[c] = vacio(rec[c]) ? null : Number(rec[c]);
    sellar(rec, previo);
    t.objectStore('hallazgos').put(rec);
    if (!previo) historial(t, 'hallazgo', rec, null, rec.estado, 'Registro del hallazgo');
    await encolar(t, 'hallazgo', rec);
    auditar(t, previo ? 'editar' : 'crear', 'hallazgo', rec);
    if (!previo) {
      for (const a of accionesIniciales.filter(x => !vacio(x.descripcion))) {
        const ar = sellar(prepararAccion(a, rec.uuid), null);
        t.objectStore('acciones').put(ar);
        await encolar(t, 'accion', ar);
        auditar(t, 'crear', 'accion', ar);
      }
    }
    return rec;
  });
}

async function cambiarEstadoEnTx(t, h, hacia, motivo) {
  const rec = { ...h, estado: hacia };
  sellar(rec, h);
  t.objectStore('hallazgos').put(rec);
  historial(t, 'hallazgo', rec, h.estado, hacia, motivo);
  await encolar(t, 'hallazgo', rec);
  auditar(t, 'cambiar_estado', 'hallazgo', rec, `${h.estado} → ${hacia}`);
  return rec;
}

export async function cambiarEstadoHallazgo(uuidHall, hacia, { motivo = '', sustento } = {}) {
  return tx(['hallazgos', 'outbox', 'auditoria', 'historial_estados'], 'readwrite', async (t) => {
    const h = await req(t.objectStore('hallazgos').get(uuidHall));
    if (!h || h.anulado) throw new ErrorEstructural('Hallazgo no encontrado o anulado.');
    if (SOLO_POR_VERIFICACION.includes(hacia)) throw new ErrorEstructural(`"${hacia}" sólo se asigna registrando una verificación (D-24).`);
    if (!transicionPermitida(h.estado, hacia)) throw new ErrorEstructural(`No se permite pasar de "${h.estado}" a "${hacia}".`);
    const base = hacia === CERRADO_ADM && sustento !== undefined ? { ...h, sustento_cierre_adm: sustento } : h;
    const rec = { ...base, estado: hacia, version: h.version };
    sellar(rec, h);
    t.objectStore('hallazgos').put(rec);
    historial(t, 'hallazgo', rec, h.estado, hacia, motivo);
    await encolar(t, 'hallazgo', rec);
    auditar(t, 'cambiar_estado', 'hallazgo', rec, `${h.estado} → ${hacia}`);
    return rec;
  });
}

export async function guardarAccion(datos) {
  return tx(['hallazgos', 'acciones', 'outbox', 'auditoria', 'historial_estados'], 'readwrite', async (t) => {
    const h = await req(t.objectStore('hallazgos').get(datos.hallazgo_uuid));
    if (!h || h.anulado) throw new ErrorEstructural('El hallazgo de la acción no existe o está anulado.');
    const previo = datos.uuid ? await req(t.objectStore('acciones').get(datos.uuid)) : null;
    if (previo?.anulado) throw new ErrorEstructural('La acción está anulada.');
    const rec = prepararAccion(datos, h.uuid);
    if (previo) rec.tipo = previo.tipo;
    sellar(rec, previo);
    t.objectStore('acciones').put(rec);
    await encolar(t, 'accion', rec);
    auditar(t, previo ? 'editar' : 'crear', 'accion', rec);
    // Transiciones automáticas del diagrama §6.3
    if (!previo && rec.tipo === 'Adicional' && h.estado === NO_LEVANTADO) {
      await cambiarEstadoEnTx(t, h, 'Pendiente de atención', 'Nueva acción adicional');
    } else if (rec.estado === 'Ejecutada' && previo?.estado !== 'Ejecutada' && h.estado === 'En ejecución') {
      await cambiarEstadoEnTx(t, h, 'Pendiente de verificación', 'Acción ejecutada');
    }
    return rec;
  });
}

export async function guardarVerificacion(datos) {
  if (!RE_FECHA.test(datos.fecha_verificacion || '')) throw new ErrorEstructural('La fecha de verificación es obligatoria.');
  if (!['Conforme – cerrar', 'No conforme – reabrir'].includes(datos.resultado)) throw new ErrorEstructural('Seleccione el resultado de la verificación.');
  return tx(['hallazgos', 'verificaciones', 'outbox', 'auditoria', 'historial_estados'], 'readwrite', async (t) => {
    const h = await req(t.objectStore('hallazgos').get(datos.hallazgo_uuid));
    if (!h || h.anulado) throw new ErrorEstructural('El hallazgo no existe o está anulado.');
    if (datos.uuid && await req(t.objectStore('verificaciones').get(datos.uuid))) {
      throw new ErrorEstructural('Las verificaciones no se editan: anule la existente y registre una nueva.');
    }
    if (!admiteVerificacion(h.estado)) throw new ErrorEstructural(`Un hallazgo en estado "${h.estado}" no admite nuevas verificaciones.`);
    const rec = structuredClone(datos);
    rec.uuid = rec.uuid || ids.uuid();
    sellar(rec, null);
    t.objectStore('verificaciones').put(rec);
    await encolar(t, 'verificacion', rec);
    auditar(t, 'crear', 'verificacion', rec, rec.resultado);
    await cambiarEstadoEnTx(t, h, estadoTrasVerificacion(rec.resultado), `Verificación: ${rec.resultado}`);
    return rec;
  });
}

// ---------------------------------------------------------------- evidencias
/**
 * Procesa y guarda una foto. contextoEv: {id_insp, inspeccion_uuid?, hallazgo_uuid?, accion_uuid?, verificacion_uuid?,
 * item_checklist?, etapa, descripcion, orientacion_toma, punto_referencia_fijo, autor, este, norte, gps_precision_m, origen_archivo}
 */
export async function agregarEvidencia(archivo, contextoEv, { conservarOriginal = false, permitirDuplicado = false, procesado = null } = {}) {
  if (!archivo) throw new ErrorEstructural('No se seleccionó ningún archivo.');
  if (!ids.RE_ID_INSP.test(contextoEv.id_insp || '')) throw new ErrorEstructural('La foto debe asociarse a una locación.');
  const p = procesado || await procesarFoto(archivo, { conservarOriginal });
  return tx(['locaciones', 'inspecciones', 'hallazgos', 'acciones', 'verificaciones', 'evidencias', 'blobs', 'outbox', 'auditoria'], 'readwrite', async (t) => {
    const s = (n) => t.objectStore(n);
    const loc = await req(s('locaciones').get(contextoEv.id_insp));
    if (!loc) throw new ErrorEstructural('Locación no encontrada.');
    if (contextoEv.inspeccion_uuid) {
      const i = await req(s('inspecciones').get(contextoEv.inspeccion_uuid));
      if (!i || i.anulado || i.id_insp !== loc.id_insp) throw new ErrorEstructural('La inspección indicada no corresponde a la locación.');
    }
    let h = null;
    if (contextoEv.hallazgo_uuid) {
      h = await req(s('hallazgos').get(contextoEv.hallazgo_uuid));
      if (!h || h.anulado || h.id_insp !== loc.id_insp) throw new ErrorEstructural('El hallazgo indicado no corresponde a la locación.');
    }
    if (!contextoEv.inspeccion_uuid && !h) throw new ErrorEstructural('La foto debe asociarse a una inspección o a un hallazgo.');
    if (contextoEv.accion_uuid) {
      const a = await req(s('acciones').get(contextoEv.accion_uuid));
      if (!a || a.hallazgo_uuid !== h?.uuid) throw new ErrorEstructural('La acción indicada no corresponde al hallazgo.');
    }
    if (contextoEv.verificacion_uuid) {
      const v = await req(s('verificaciones').get(contextoEv.verificacion_uuid));
      if (!v || v.hallazgo_uuid !== h?.uuid) throw new ErrorEstructural('La verificación indicada no corresponde al hallazgo.');
    }
    const delLoc = await req(s('evidencias').index('id_insp').getAll(loc.id_insp));
    const dup = delLoc.find(e => !e.anulado && e.hash_sha256 === p.hash_sha256);
    if (dup && !permitirDuplicado) throw new ErrorDuplicado(`Esta imagen ya está registrada en ${loc.id_insp} como ${dup.codigo_foto}.`, dup);
    const fecha = contextoEv.fecha || hoyISO();
    const lote = ids.loteFoto(loc.lote), comp = ids.componenteCorto(loc), hc = ids.hallazgoCorto(h?.cod_hallazgo);
    const prefijo = ids.prefijoFoto(ids.codFoto(lote, comp, hc, fecha, 1));
    const n = Math.max(0, ...delLoc.filter(e => ids.prefijoFoto(e.codigo_foto) === prefijo).map(e => ids.numeroFoto(e.codigo_foto))) + 1;
    const rec = {
      uuid: ids.uuid(), version: 0, id_insp: loc.id_insp, inspeccion_uuid: contextoEv.inspeccion_uuid || h?.inspeccion_uuid || null,
      hallazgo_uuid: h?.uuid || null, accion_uuid: contextoEv.accion_uuid || null, verificacion_uuid: contextoEv.verificacion_uuid || null,
      item_checklist: contextoEv.item_checklist || '',
      codigo_foto: ids.codFoto(lote, comp, hc, fecha, n), codigo_provisional: true,
      lote_foto: lote, componente_corto: comp, cod_hallazgo_corto: hc, fecha, hora: contextoEv.hora || horaActual(), numero: n,
      este: vacio(contextoEv.este) ? null : Number(contextoEv.este), norte: vacio(contextoEv.norte) ? null : Number(contextoEv.norte),
      gps_precision_m: vacio(contextoEv.gps_precision_m) ? null : Number(contextoEv.gps_precision_m),
      etapa: contextoEv.etapa || '', descripcion: contextoEv.descripcion || '', orientacion_toma: contextoEv.orientacion_toma || '',
      punto_referencia_fijo: contextoEv.punto_referencia_fijo || '', autor: contextoEv.autor || ctx.usuario,
      origen_archivo: contextoEv.origen_archivo || 'Archivo seleccionado',
      nombre_original: p.nombre_original, mime: p.mime, bytes: p.bytes, ancho_px: p.ancho_px, alto_px: p.alto_px,
      hash_sha256: p.hash_sha256, conserva_original: !!p.original, archivo_sync_estado: 'pendiente',
    };
    sellar(rec, null);
    s('evidencias').put(rec);
    s('blobs').put({ uuid: rec.uuid, reducida: p.reducida, miniatura: p.miniatura, original: p.original || null });
    await encolar(t, 'evidencia', rec);
    await encolar(t, 'evidencia', rec, 'subir_archivo');
    auditar(t, 'crear', 'evidencia', rec, dup ? `duplicado permitido de ${dup.codigo_foto}` : '');
    return rec;
  });
}

const EDITABLES_EVIDENCIA = ['etapa', 'descripcion', 'orientacion_toma', 'punto_referencia_fijo', 'autor'];
export async function guardarEvidenciaMeta(datos) {
  return tx(['evidencias', 'outbox', 'auditoria'], 'readwrite', async (t) => {
    const previo = await req(t.objectStore('evidencias').get(datos.uuid));
    if (!previo || previo.anulado) throw new ErrorEstructural('Foto no encontrada o anulada.');
    const rec = { ...previo, version: datos.version };
    for (const c of EDITABLES_EVIDENCIA) if (c in datos) rec[c] = datos[c];
    sellar(rec, previo);
    t.objectStore('evidencias').put(rec);
    await encolar(t, 'evidencia', rec);
    auditar(t, 'editar', 'evidencia', rec);
    return rec;
  });
}

// ---------------------------------------------------------------- anulación (borrado lógico)
export async function anular(entidad, uuidReg, motivo, version) {
  if (vacio(motivo)) throw new ErrorEstructural('Indique el motivo de la anulación.');
  const alm = ALMACEN[entidad];
  if (!alm) throw new Error(`Entidad desconocida: ${entidad}`);
  return tx([alm, 'outbox', 'auditoria', 'historial_estados'], 'readwrite', async (t) => {
    const previo = await req(t.objectStore(alm).get(uuidReg));
    if (!previo) throw new ErrorEstructural('Registro no encontrado.');
    if (previo.anulado) return previo;
    const rec = { ...previo, anulado: true, motivo_anulacion: motivo, version: version ?? previo.version };
    sellar(rec, previo);
    t.objectStore(alm).put(rec);
    historial(t, entidad, rec, 'vigente', 'anulado', motivo);
    await encolar(t, entidad, rec, 'anular');
    auditar(t, 'anular', entidad, rec, motivo);
    return rec;
  });
}
