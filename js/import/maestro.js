// Importación del Programa Maestro (PM) y de catálogos/checklist del Formato (FI).
// D-15: del FI sólo se leen Listas!A:I y los ítems de Ficha_Inspeccion; no sus registros de ejemplo.

import { abrirXlsx, serialAFecha } from './xlsx-reader.js';
import { normalizar, compactar, RE_ID_INSP, uuid } from '../ids.js';
import { ESTADOS_HALLAZGO } from '../states.js';
import { tx, req } from '../db.js';

const HOJAS_PM = ['Base_Maestra', 'Programa', 'Cronograma', 'Sectores', 'Incidencias_QC', 'Antecedentes_Muestreo'];
const COLUMNAS_BASE = ['ID_INSP', 'FILA_EXCEL', 'COMPONENTE', 'TIPO', 'CLASE', 'LOTE', 'YACIMIENTO', 'ESTE', 'NORTE', 'LAT', 'LON',
  'ESTADO_COORD', 'VERIFICACION_UBICACION', 'PRIORIDAD_AMBIENTAL', 'PUNTAJE_AMBIENTAL', 'SECTOR', 'NOMBRE_SECTOR', 'FASE',
  'CUADRILLA', 'DIA', 'ORDEN_GLOBAL', 'JORNADA', 'TIPO_INSPECCION', 'T_INSPECCION_MIN'];
const EXTRAS_PROGRAMA = ['FECHA_PLAN', 'ORDEN_EN_JORNADA', 'DIST_DESDE_ANTERIOR_M', 'T_TRASLADO_MIN', 'ANTECEDENTES_RESUMEN', 'REQUISITOS_PREVIOS', 'ESTADO_INSPECCION'];
const CATALOGOS_FI = ['RESULTADO', 'ESTADO_HALLAZGO', 'CATEGORIA', 'PRIORIDAD', 'TIPO_EVIDENCIA', 'MEDIO_ATENCION', 'ACCESO', 'SI_NO', 'RESULTADO_VERIF'];
// Campos con los que se puede buscar una locación (propuesta §2.3).
const CAMPOS_BUSQUEDA = ['ID_INSP', 'COMPONENTE', 'PP_ID', 'PP_NOMBRE', 'KMZ_PA_COMPONENTE', 'POLIGONO_PAVC', 'YACIMIENTO', 'NOMBRE_SECTOR'];

const texto = (v) => (v === null || v === undefined ? '' : String(v));
const num = (v) => (typeof v === 'number' ? v : (v === null || v === '' || v === undefined ? null : Number(v)));

export async function leerMaestro(bufferPM, bufferFI, { archivoPM = '', archivoFI = '' } = {}) {
  const errores = [], avisos = [];
  const pm = await abrirXlsx(bufferPM);
  const faltan = HOJAS_PM.filter(h => !pm.nombresHojas.includes(h));
  if (faltan.length) throw new Error(`El Programa Maestro no tiene las hojas: ${faltan.join(', ')}.`);

  // ---- Base_Maestra (encabezado en fila 4)
  const base = (await pm.hoja('Base_Maestra')).tabla(4);
  const faltanCols = COLUMNAS_BASE.filter(c => !base.encabezados.includes(c));
  if (faltanCols.length) throw new Error(`Base_Maestra no tiene las columnas: ${faltanCols.join(', ')}.`);

  const hojaProg = await pm.hoja('Programa');
  const prog = hojaProg.tabla(4);
  const porIdProg = new Map(prog.filas.map(f => [f.ID_INSP, f]));

  const ids = new Map(), comps = new Map();
  const locaciones = [];
  for (const f of base.filas) {
    const id = texto(f.ID_INSP).trim();
    if (!RE_ID_INSP.test(id)) { errores.push(`Fila ${f.__fila}: ID_INSP con formato inválido ("${id}").`); continue; }
    if (ids.has(id)) { errores.push(`ID_INSP duplicado: ${id} (filas ${ids.get(id)} y ${f.__fila}).`); continue; }
    ids.set(id, f.__fila);
    const comp = texto(f.COMPONENTE).trim();
    if (!comp) errores.push(`${id}: COMPONENTE vacío.`);
    else if (comps.has(comp)) errores.push(`COMPONENTE duplicado "${comp}": ${comps.get(comp)} y ${id}.`);
    else comps.set(comp, id);
    const p = porIdProg.get(id);
    if (!p) errores.push(`${id} no está en la hoja Programa.`);
    const campos = {};
    for (const c of base.encabezados) campos[c] = f[c];
    const programa = {};
    for (const c of EXTRAS_PROGRAMA) programa[c] = p ? p[c] : null;
    const fechaPlan = p ? serialAFecha(p.FECHA_PLAN) : null;
    if (p && !fechaPlan) avisos.push(`${id}: FECHA_PLAN sin valor calculado en el archivo.`);
    if (num(f.ESTE) === null || num(f.NORTE) === null) avisos.push(`${id}: sin coordenadas ESTE/NORTE.`);
    const terminos = CAMPOS_BUSQUEDA.filter(c => texto(f[c]).trim()).map(c => ({
      campo: c, valor: texto(f[c]).trim(), norm: normalizar(f[c]), compacto: compactar(f[c]),
    }));
    locaciones.push({
      id_insp: id, fila_excel: num(f.FILA_EXCEL), componente: comp,
      componente_norm: normalizar(comp), componente_compacto: compactar(comp),
      tipo: texto(f.TIPO), clase: texto(f.CLASE), lote: texto(f.LOTE), yacimiento: texto(f.YACIMIENTO),
      este: num(f.ESTE), norte: num(f.NORTE), lat: num(f.LAT), lon: num(f.LON),
      estado_coord: texto(f.ESTADO_COORD), verificacion_ubicacion: texto(f.VERIFICACION_UBICACION),
      prioridad_ambiental: texto(f.PRIORIDAD_AMBIENTAL), puntaje_ambiental: num(f.PUNTAJE_AMBIENTAL),
      sector: texto(f.SECTOR), nombre_sector: texto(f.NOMBRE_SECTOR), fase: texto(f.FASE), cuadrilla: texto(f.CUADRILLA),
      dia: num(f.DIA), orden_global: num(f.ORDEN_GLOBAL), jornada: num(f.JORNADA),
      orden_en_jornada: p ? num(p.ORDEN_EN_JORNADA) : null, fecha_plan: fechaPlan,
      tipo_inspeccion: texto(f.TIPO_INSPECCION), t_inspeccion_min: num(f.T_INSPECCION_MIN),
      estado_inicial: p ? texto(p.ESTADO_INSPECCION) || 'Pendiente' : 'Pendiente',
      terminos, campos, programa,
      maestro_archivo: archivoPM,
    });
  }
  if (!locaciones.length) errores.push('Base_Maestra no contiene locaciones.');

  // ---- Catálogos de PM (validaciones de datos de los Excel)
  const catalogos = [];
  const estadosInsp = hojaProg.listaEn('AD5');
  if (!estadosInsp) errores.push('No se encontró la lista de ESTADO_INSPECCION (Programa!AD).');
  else estadosInsp.forEach((v, i) => catalogos.push({ catalogo: 'ESTADO_INSPECCION', valor: v, orden: i, origen: 'PM Programa!AD' }));

  const hojaInc = await pm.hoja('Incidencias_QC');
  const estadosQC = hojaInc.listaEn('J5');
  if (estadosQC) estadosQC.forEach((v, i) => catalogos.push({ catalogo: 'ESTADO_INCIDENCIA', valor: v, orden: i, origen: 'PM Incidencias_QC!J' }));
  const incidencias = hojaInc.tabla(4).filas.map(r => ({
    id_incidencia: texto(r.ID_INCIDENCIA), id_insp: texto(r.ID_INSP), componente: texto(r.COMPONENTE), lote: texto(r.LOTE),
    severidad: texto(r.SEVERIDAD), categoria: texto(r.CATEGORIA), descripcion: texto(r.DESCRIPCION), accion: texto(r.ACCION),
    responsable: texto(r.RESPONSABLE), estado: texto(r.ESTADO), resolucion: texto(r.RESOLUCION),
  }));
  for (const i of incidencias) if (!ids.has(i.id_insp)) avisos.push(`Incidencia ${i.id_incidencia}: ID_INSP desconocido (${i.id_insp}).`);

  const antecedentes = (await pm.hoja('Antecedentes_Muestreo')).tabla(4).filas.map((r, i) => {
    const m = texto(r.LOCACION_VINCULADA).match(/INS-\d{3}/);
    return {
      uuid: `ant-${String(i + 1).padStart(4, '0')}`, id_insp: m ? m[0] : '', locacion_vinculada: texto(r.LOCACION_VINCULADA),
      campana: texto(r['CAMPAÑA']), codigo: texto(r.CODIGO), este: num(r.ESTE), norte: num(r.NORTE),
      profundidad: texto(r.PROFUNDIDAD), fecha: typeof r.FECHA === 'number' ? serialAFecha(r.FECHA) : texto(r.FECHA), fuente: texto(r.FUENTE),
    };
  });

  const jornadas = (await pm.hoja('Cronograma')).tabla(4).filas.filter(r => typeof r.JORNADA === 'number').map(r => ({
    jornada: r.JORNADA, dia: num(r.DIA), fecha_plan: serialAFecha(r.FECHA_PLAN), cuadrilla: texto(r.CUADRILLA), fase: texto(r.FASE),
    lote: texto(r.LOTE), sectores: texto(r.SECTOR), yacimientos: texto(r.YACIMIENTOS), requisitos: texto(r.REQUISITOS), locaciones: texto(r.LOCACIONES),
  }));
  const sectores = (await pm.hoja('Sectores')).tabla(4).filas.map(r => ({
    sector: texto(r.SECTOR), orden: num(r.ORDEN_SECTOR), nombre: texto(r.NOMBRE_SECTOR), lote: texto(r.LOTE), cuadrilla: texto(r.CUADRILLA),
    n: num(r.N), yacimientos: texto(r.YACIMIENTOS),
  }));

  // ---- FI: catálogos (Listas!A:I) e ítems del checklist (Ficha_Inspeccion)
  const fi = await abrirXlsx(bufferFI);
  for (const h of ['Listas', 'Ficha_Inspeccion']) if (!fi.nombresHojas.includes(h)) throw new Error(`El Formato no tiene la hoja "${h}".`);
  const listas = await fi.hoja('Listas');
  const enc = listas.fila(1);
  for (let col = 1; col <= 9; col++) {
    const nombre = enc.get(col);
    if (!CATALOGOS_FI.includes(nombre)) { errores.push(`Listas: columna ${col} no es un catálogo esperado ("${nombre ?? ''}").`); continue; }
    for (let f = 2, orden = 0; f <= listas.maxFila; f++) {
      const v = listas.fila(f).get(col);
      if (v === undefined) break;
      catalogos.push({ catalogo: nombre, valor: texto(v), orden: orden++, origen: 'FI Listas' });
    }
  }
  const estadosFI = catalogos.filter(c => c.catalogo === 'ESTADO_HALLAZGO').map(c => c.valor);
  const faltanEstados = ESTADOS_HALLAZGO.filter(e => !estadosFI.includes(e));
  if (faltanEstados.length) errores.push(`El catálogo ESTADO_HALLAZGO del Formato no contiene: ${faltanEstados.join(', ')}.`);

  const ficha = await fi.hoja('Ficha_Inspeccion');
  const items = [];
  let seccion = '';
  for (let f = 1; f <= ficha.maxFila; f++) {
    const a = texto(ficha.fila(f).get(1)).trim();
    if (/^[A-F]\.\s/.test(a)) seccion = a;
    else if (/^[A-F]\d$/.test(a)) items.push({ codigo: a, seccion, texto: texto(ficha.fila(f).get(2)), orden: items.length + 1 });
  }
  if (!items.length) errores.push('No se encontraron ítems de verificación en Ficha_Inspeccion.');

  const conteos = {
    locaciones: locaciones.length, pozos: locaciones.filter(l => l.clase === 'Pozo').length,
    instalaciones: locaciones.filter(l => l.clase !== 'Pozo').length,
    lote_VI: locaciones.filter(l => l.lote === 'VI').length, lote_VII: locaciones.filter(l => l.lote === 'VII').length,
    items: items.length, catalogos: new Set(catalogos.map(c => c.catalogo)).size,
    incidencias: incidencias.length, antecedentes: antecedentes.length, jornadas: jornadas.length, sectores: sectores.length,
  };
  return { ok: errores.length === 0, errores, avisos, conteos, datos: { locaciones, catalogos, items, incidencias, antecedentes, jornadas, sectores }, archivoPM, archivoFI };
}

/** Guarda una importación válida. Fusiona por ID_INSP: nunca borra locaciones con registros de campo. */
export async function guardarMaestro(resultado, { usuario = '', dispositivo = '' } = {}) {
  if (!resultado.ok) throw new Error('La importación tiene errores; no se guardó.');
  const { locaciones, catalogos, items, incidencias, antecedentes, jornadas, sectores } = resultado.datos;
  const ahora = new Date().toISOString();
  const alm = ['locaciones', 'catalogos', 'items_checklist', 'incidencias_qc', 'antecedentes_muestreo', 'jornadas', 'sectores', 'meta', 'auditoria', 'inspecciones', 'hallazgos'];
  return tx(alm, 'readwrite', async (t) => {
    const s = (n) => t.objectStore(n);
    const previas = await req(s('locaciones').getAll());
    const nuevosIds = new Set(locaciones.map(l => l.id_insp));
    const conRegistros = new Set([...(await req(s('inspecciones').getAll())), ...(await req(s('hallazgos').getAll()))].map(r => r.id_insp));
    let conservadas = 0, actualizadas = 0, nuevas = 0;
    for (const prev of previas) {
      if (!nuevosIds.has(prev.id_insp)) {
        if (conRegistros.has(prev.id_insp)) { s('locaciones').put({ ...prev, ausente_en_maestro: true }); conservadas++; }
        else s('locaciones').delete(prev.id_insp);
      }
    }
    const previasIds = new Set(previas.map(p => p.id_insp));
    for (const l of locaciones) { s('locaciones').put({ ...l, importado_en: ahora }); previasIds.has(l.id_insp) ? actualizadas++ : nuevas++; }
    for (const n of ['catalogos', 'items_checklist', 'incidencias_qc', 'antecedentes_muestreo', 'jornadas', 'sectores']) s(n).clear();
    catalogos.forEach(c => s('catalogos').put(c));
    items.forEach(i => s('items_checklist').put(i));
    incidencias.forEach(i => s('incidencias_qc').put(i));
    antecedentes.forEach(a => s('antecedentes_muestreo').put(a));
    jornadas.forEach(j => s('jornadas').put(j));
    sectores.forEach(x => s('sectores').put(x));
    const info = { archivoPM: resultado.archivoPM, archivoFI: resultado.archivoFI, importado_en: ahora, conteos: resultado.conteos, avisos: resultado.avisos.length };
    s('meta').put({ key: 'maestro', valor: info });
    s('auditoria').put({ uuid: uuid(), fecha_hora: ahora, usuario, dispositivo, accion: 'importar_maestro', entidad: 'maestro', entidad_uuid: '', codigo: resultado.archivoPM, detalle: `nuevas ${nuevas}, actualizadas ${actualizadas}, conservadas sin maestro ${conservadas}` });
    return { nuevas, actualizadas, conservadas };
  });
}
