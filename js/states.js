// Estados (propuesta §6). Los nombres de estado provienen de los catálogos de FI/PM;
// el importador verifica que existan exactamente en los Excel (ver import/maestro.js).

export const ESTADOS_HALLAZGO = [
  'Nuevo', 'En evaluación', 'Pendiente de atención', 'En ejecución', 'Pendiente de verificación',
  'Levantado y verificado', 'No levantado / requiere acciones adicionales', 'Cerrado administrativamente',
];
export const LEVANTADO = 'Levantado y verificado';
export const NO_LEVANTADO = 'No levantado / requiere acciones adicionales';
export const CERRADO_ADM = 'Cerrado administrativamente';
export const ESTADOS_CERRADOS = [LEVANTADO, CERRADO_ADM];

/** Estados que sólo se alcanzan registrando una Verificación (D-24). */
export const SOLO_POR_VERIFICACION = [LEVANTADO, NO_LEVANTADO];

/** Transiciones manuales permitidas (diagrama §6.3). */
export const TRANSICIONES_MANUALES = {
  'Nuevo': ['En evaluación', 'Pendiente de atención', CERRADO_ADM],
  'En evaluación': ['Pendiente de atención', CERRADO_ADM],
  'Pendiente de atención': ['En ejecución', CERRADO_ADM],
  'En ejecución': ['Pendiente de verificación'],
  'Pendiente de verificación': [],
  [NO_LEVANTADO]: ['Pendiente de atención'],
  [LEVANTADO]: [],
  [CERRADO_ADM]: [],
};

export function transicionPermitida(desde, hacia) {
  return (TRANSICIONES_MANUALES[desde] || []).includes(hacia);
}

/** Desde qué estados se puede registrar una Verificación. */
export function admiteVerificacion(estado) {
  return !ESTADOS_CERRADOS.includes(estado);
}

export const estadoTrasVerificacion = (resultado) =>
  resultado === 'Conforme – cerrar' ? LEVANTADO : NO_LEVANTADO;

export const ESTADOS_ACCION = ['Pendiente', 'En ejecución', 'Ejecutada'];
export const TIPOS_ACCION = ['Inmediata', 'Correctiva', 'Adicional'];

// ---- Locación (estado derivado, §6.1). D-14 y D-23 no aprobadas: no se derivan
// "Programada" ni "Reprogramada"; sin visitas se conserva el estado inicial del PM.
export function estadoLocacion(loc, inspecciones) {
  const vigentes = (inspecciones || []).filter(i => !i.anulado && i.id_insp === loc.id_insp);
  if (vigentes.some(i => i.estado_registro === 'Borrador')) return 'En ejecución';
  const fin = vigentes.filter(i => i.estado_registro === 'Finalizada')
    .sort((a, b) => `${a.fecha}T${a.hora_inicio || ''}|${a.creado_en}`.localeCompare(`${b.fecha}T${b.hora_inicio || ''}|${b.creado_en}`));
  if (fin.length) return fin[fin.length - 1].resultado_visita;
  return loc.estado_inicial || 'Pendiente';
}

export const ESTADOS_SYNC = {
  local: 'Guardado en el dispositivo',
  pendiente: 'Pendiente de envío',
  enviando: 'Enviando',
  sincronizado: 'Sincronizado',
  error: 'Error (reintentará)',
  conflicto: 'Conflicto',
};
