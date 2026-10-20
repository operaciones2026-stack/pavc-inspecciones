// Indicadores y alertas calculados a partir de los datos guardados (nunca valores fijos).

import { estadoLocacion, ESTADOS_CERRADOS, LEVANTADO, CERRADO_ADM } from './states.js';
import { alertasInspeccion, alertasHallazgo, alertasEvidencia } from './rules.js';

export function agrupar(lista, clave) {
  const m = new Map();
  for (const x of lista) { const k = typeof clave === 'function' ? clave(x) : x[clave]; if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return m;
}

export function calcularAlertas({ locs, inspecciones, hallazgos, acciones, verificaciones, evidencias, items, hoy }) {
  const locPorId = new Map(locs.map(l => [l.id_insp, l]));
  const inspPorUuid = new Map(inspecciones.map(i => [i.uuid, i]));
  const hallPorInsp = agrupar(hallazgos, 'inspeccion_uuid');
  const evPorInsp = agrupar(evidencias, 'inspeccion_uuid');
  const evPorHall = agrupar(evidencias, 'hallazgo_uuid');
  const evPorLoc = agrupar(evidencias, 'id_insp');
  const accPorHall = agrupar(acciones, 'hallazgo_uuid');
  const verPorHall = agrupar(verificaciones, 'hallazgo_uuid');
  const out = [];
  for (const i of inspecciones) {
    if (i.anulado) continue;
    out.push(...alertasInspeccion(i, { loc: locPorId.get(i.id_insp), hallazgos: hallPorInsp.get(i.uuid) || [], evidencias: evPorInsp.get(i.uuid) || [], items, hoy }));
  }
  for (const h of hallazgos) {
    if (h.anulado) continue;
    out.push(...alertasHallazgo(h, { acciones: accPorHall.get(h.uuid) || [], verificaciones: verPorHall.get(h.uuid) || [], evidencias: evPorHall.get(h.uuid) || [], inspeccion: inspPorUuid.get(h.inspeccion_uuid), hoy }));
  }
  for (const e of evidencias) out.push(...alertasEvidencia(e, { evidenciasLocacion: evPorLoc.get(e.id_insp) || [] }));
  return out;
}

export function calcularIndicadores({ locs, inspecciones, hallazgos, acciones, evidencias, outbox, hoy, alertas = [] }) {
  const vig = (l) => l.filter(x => !x.anulado);
  const insp = vig(inspecciones), hall = vig(hallazgos), ev = vig(evidencias);
  const porLoc = agrupar(insp, 'id_insp');
  const estados = {};
  for (const l of locs) { const e = estadoLocacion(l, porLoc.get(l.id_insp) || []); estados[e] = (estados[e] || 0) + 1; }
  const total = locs.length;
  const inspeccionadas = estados.Inspeccionada || 0;
  const hallEstados = {};
  for (const h of hall) hallEstados[h.estado] = (hallEstados[h.estado] || 0) + 1;
  const accPorHall = agrupar(vig(acciones), 'hallazgo_uuid');
  const vencidos = hall.filter(h => !ESTADOS_CERRADOS.includes(h.estado)
    && (accPorHall.get(h.uuid) || []).some(a => a.estado !== 'Ejecutada' && a.fecha_compromiso && a.fecha_compromiso < hoy)).length;
  const levantados = hallEstados[LEVANTADO] || 0, cerradosAdm = hallEstados[CERRADO_ADM] || 0;
  const cola = { pendiente: 0, enviando: 0, error: 0, sincronizado: 0 };
  for (const o of outbox) cola[o.estado] = (cola[o.estado] || 0) + 1;
  return {
    locaciones: total,
    programadas_hoy: locs.filter(l => l.fecha_plan === hoy).length,
    con_fecha_plan: locs.filter(l => l.fecha_plan).length,
    estados_locacion: estados,
    inspeccionadas,
    avance_pct: total ? (100 * inspeccionadas) / total : 0,
    visitas_finalizadas: insp.filter(i => i.estado_registro === 'Finalizada').length,
    borradores: insp.filter(i => i.estado_registro === 'Borrador').length,
    hallazgos: hall.length,
    hallazgos_abiertos: hall.filter(h => !ESTADOS_CERRADOS.includes(h.estado)).length,
    hallazgos_estados: hallEstados,
    hallazgos_vencidos: vencidos,
    // FI Seguimiento B19: levantados y verificados / (total − cerrados administrativamente)
    levantamiento_pct: hall.length - cerradosAdm > 0 ? (100 * levantados) / (hall.length - cerradosAdm) : 0,
    fotos: ev.length,
    fotos_bytes: ev.reduce((s, e) => s + (e.bytes || 0), 0),
    alertas: alertas.length,
    cola,
  };
}
