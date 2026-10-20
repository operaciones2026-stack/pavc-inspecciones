// Reglas de validación (propuesta §5). Por D6 todas son ALERTAS: no impiden guardar.
// Las reglas estructurales (que sí impiden crear un registro) están en repo.js.

import { normalizarPersona } from './ids.js';
import { LEVANTADO, CERRADO_ADM, ESTADOS_CERRADOS } from './states.js';

export const UMBRAL_GPS_M = 10; // FI Instructivo B4 / ítem A1

// D-10 (aprobada: condicionales según categoría). Categorías del catálogo FI para las que
// no se exigen dimensiones L×A. Propuesta ajustable; no proviene de los Excel.
export const CATEGORIAS_SIN_DIMENSIONES = [
  'Emisión de gases / fuga en cabezal', 'Condición insegura', 'Identificación / ubicación',
];
// Categoría en la que se espera la lectura del instrumento en la condición observada (ítem B2 de la ficha).
export const CATEGORIA_GASES = 'Emisión de gases / fuga en cabezal';

export const DESCRIPCION_ALERTAS = {
  'AL-01': 'Diferencia GPS > 10 m y A1 no está como "No conforme"',
  'AL-02': 'Visita finalizada con ítems sin respuesta',
  'AL-03': 'Ítem No conforme o No verificable sin observación',
  'AL-04': 'Ítem No conforme sin hallazgo vinculado',
  'AL-05': 'Hallazgo con datos incompletos',
  'AL-06': 'Visita inspeccionada sin foto general (GEN)',
  'AL-07': 'Hallazgo con menos de 2 fotos "Inicial (antes)"',
  'AL-08': 'Foto antes/después sin orientación o punto de referencia fijo',
  'AL-09': 'Cierre sin sustento completo',
  'AL-10': 'Verificador igual al responsable',
  'AL-11': 'Cerrado administrativamente sin sustento',
  'AL-12': 'Fecha de compromiso vencida',
  'AL-13': 'Locación con coordenada pendiente de validación crítica: registrar GPS',
  'AL-14': 'GPS no registrado o con precisión > 10 m',
  'AL-15': 'Fechas u horas inconsistentes',
  'AL-16': 'Posible foto duplicada',
  'AL-17': 'Ítem B2 sin lectura de PID/explosímetro',
  'AL-18': 'Datos de cierre de la visita incompletos',
};

const vacio = (v) => v === null || v === undefined || String(v).trim() === '';
const al = (codigo, detalle, reg, entidad) => ({
  codigo, mensaje: DESCRIPCION_ALERTAS[codigo] + (detalle ? `: ${detalle}` : ''),
  entidad, uuid: reg.uuid, codigo_registro: reg.cod_inspeccion || reg.cod_hallazgo || reg.codigo_foto || '',
});

export function alertasInspeccion(insp, { loc, hallazgos = [], evidencias = [], items = [], hoy }) {
  const out = [];
  const A = (c, d) => out.push(al(c, d, insp, 'inspeccion'));
  const resp = insp.respuestas || {};
  const noAccesible = insp.acceso === 'No accesible';
  const finalizada = insp.estado_registro === 'Finalizada';

  if (!noAccesible && insp.dif_m !== null && insp.dif_m !== undefined && insp.dif_m > UMBRAL_GPS_M
    && resp.A1?.resultado !== 'No conforme') A('AL-01', `${insp.dif_m} m`);

  if (!noAccesible) {
    const sin = items.filter(it => vacio(resp[it.codigo]?.resultado)).map(it => it.codigo);
    if (finalizada && sin.length) A('AL-02', sin.join(', '));
    for (const it of items) {
      const r = resp[it.codigo];
      if (!r) continue;
      if ((r.resultado === 'No conforme' || r.resultado === 'No verificable') && vacio(r.observacion)) A('AL-03', it.codigo);
      if (r.resultado === 'No conforme'
        && !hallazgos.some(h => !h.anulado && h.inspeccion_uuid === insp.uuid && h.item_checklist === it.codigo)) A('AL-04', it.codigo);
      if (it.codigo === 'B2' && r.resultado && r.resultado !== 'No aplica' && vacio(r.lectura_instrumento)) A('AL-17');
    }
    if (finalizada && !evidencias.some(e => !e.anulado && e.inspeccion_uuid === insp.uuid && !e.hallazgo_uuid)) A('AL-06');
    if (vacio(insp.gps_este) || vacio(insp.gps_norte)) {
      A('AL-14', 'sin coordenada GPS');
      if (loc?.estado_inicial === 'Requiere validación de ubicación') A('AL-13');
    } else if (!vacio(insp.gps_precision_m) && Number(insp.gps_precision_m) > UMBRAL_GPS_M) {
      A('AL-14', `precisión ${insp.gps_precision_m} m`);
    }
  }
  if (noAccesible && vacio(insp.motivo_no_acceso)) A('AL-18', 'falta el motivo de "No accesible"');
  if (insp.fecha && hoy && insp.fecha > hoy) A('AL-15', 'fecha de inspección futura');
  if (insp.hora_inicio && insp.hora_fin && insp.hora_fin < insp.hora_inicio) A('AL-15', 'hora fin anterior a hora inicio');
  if (finalizada && vacio(insp.inspector)) A('AL-18', 'falta el inspector');
  if (finalizada && !noAccesible && vacio(insp.conclusion)) A('AL-18', 'falta la conclusión');
  return out;
}

export function alertasHallazgo(h, { acciones = [], verificaciones = [], evidencias = [], inspeccion, hoy }) {
  const out = [];
  const A = (c, d) => out.push(al(c, d, h, 'hallazgo'));
  const acc = acciones.filter(a => !a.anulado && a.hallazgo_uuid === h.uuid);
  const ver = verificaciones.filter(v => !v.anulado && v.hallazgo_uuid === h.uuid)
    .sort((a, b) => `${a.fecha_verificacion}|${a.creado_en}`.localeCompare(`${b.fecha_verificacion}|${b.creado_en}`));
  const ev = evidencias.filter(e => !e.anulado && e.hallazgo_uuid === h.uuid);

  const faltan = [];
  for (const [campo, etiqueta] of [['categoria', 'categoría'], ['descripcion_objetiva', 'descripción'], ['este', 'este'], ['norte', 'norte'], ['prioridad', 'prioridad'], ['riesgo_consecuencia', 'riesgo']]) {
    if (vacio(h[campo])) faltan.push(etiqueta);
  }
  if (!CATEGORIAS_SIN_DIMENSIONES.includes(h.categoria) && (vacio(h.largo_m) || vacio(h.ancho_m))) faltan.push('dimensiones L×A');
  if (h.categoria === CATEGORIA_GASES && vacio(h.condicion_observada)) faltan.push('condición observada (lectura PID)');
  if (!acc.some(a => a.tipo === 'Inmediata')) faltan.push('acción inmediata');
  const corr = acc.filter(a => a.tipo !== 'Inmediata');
  if (!corr.length) faltan.push('acción correctiva');
  for (const a of corr) {
    if (vacio(a.responsable)) faltan.push(`responsable (${a.tipo})`);
    if (vacio(a.fecha_compromiso)) faltan.push(`fecha compromiso (${a.tipo})`);
  }
  if (faltan.length) A('AL-05', faltan.join(', '));

  if (ev.filter(e => e.etapa === 'Inicial (antes)').length < 2) A('AL-07');

  if (h.estado === LEVANTADO) {
    const ult = ver[ver.length - 1];
    const f = [];
    if (!acc.some(a => !vacio(a.evidencia_levantamiento))) f.push('evidencia de levantamiento');
    if (!ev.some(e => e.etapa === 'Posterior (después)' || e.etapa === 'Verificación de cierre')) f.push('foto después/cierre');
    if (!ult || vacio(ult.fecha_verificacion)) f.push('fecha de verificación');
    if (!ult || vacio(ult.verificador)) f.push('verificador');
    if (!ult || ult.resultado !== 'Conforme – cerrar') f.push('resultado "Conforme – cerrar"');
    if (f.length) A('AL-09', f.join(', '));
  }
  const ult = ver[ver.length - 1];
  if (ult && !vacio(ult.verificador)) {
    const v = normalizarPersona(ult.verificador);
    if (acc.some(a => !vacio(a.responsable) && normalizarPersona(a.responsable) === v)) A('AL-10', ult.verificador);
  }
  if (h.estado === CERRADO_ADM && vacio(h.sustento_cierre_adm)) A('AL-11');

  if (!ESTADOS_CERRADOS.includes(h.estado) && hoy) {
    const vencidas = acc.filter(a => a.estado !== 'Ejecutada' && !vacio(a.fecha_compromiso) && a.fecha_compromiso < hoy);
    if (vencidas.length) A('AL-12', vencidas.map(a => a.fecha_compromiso).sort()[0]);
  }
  if (inspeccion && h.fecha_identificacion && h.fecha_identificacion < inspeccion.fecha) A('AL-15', 'identificación anterior a la inspección');
  for (const a of acc) {
    if (a.fecha_compromiso && h.fecha_identificacion && a.fecha_compromiso < h.fecha_identificacion) A('AL-15', `compromiso anterior a la identificación (${a.tipo})`);
  }
  for (const v of ver) {
    const ejec = acc.map(a => a.fecha_ejecucion).filter(Boolean).sort().pop();
    if (ejec && v.fecha_verificacion && v.fecha_verificacion < ejec) A('AL-15', 'verificación anterior a la ejecución');
  }
  return out;
}

export function alertasEvidencia(ev, { evidenciasLocacion = [] }) {
  const out = [];
  if (ev.anulado) return out;
  if ((ev.etapa === 'Inicial (antes)' || ev.etapa === 'Posterior (después)')
    && (vacio(ev.orientacion_toma) || vacio(ev.punto_referencia_fijo))) out.push(al('AL-08', ev.codigo_foto, ev, 'evidencia'));
  if (evidenciasLocacion.some(o => o.uuid !== ev.uuid && !o.anulado && o.hash_sha256 && o.hash_sha256 === ev.hash_sha256)) {
    out.push(al('AL-16', ev.codigo_foto, ev, 'evidencia'));
  }
  return out;
}
