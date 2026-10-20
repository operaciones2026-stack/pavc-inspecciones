// Búsqueda directa de locaciones (propuesta §2.3) por ID_INSP, número de pozo, nombre de instalación,
// PP_ID / PP_NOMBRE (PERUPETRO), KMZ_PA_COMPONENTE, polígono, yacimiento o sector.

import { normalizar, compactar, interpretarIdInsp } from './ids.js';

const EXACTO_PRINCIPAL = 100, ID_INTERPRETADO = 95, EXACTO_OTRO = 85, PREFIJO_PRINCIPAL = 70, PREFIJO_OTRO = 60, CONTIENE = 40;
const PRINCIPALES = ['ID_INSP', 'COMPONENTE'];

export function buscar(locs, consulta, limite = 60) {
  const qn = normalizar(consulta), qc = compactar(consulta);
  if (!qc) return [];
  const idInt = interpretarIdInsp(consulta);
  const res = [];
  for (const loc of locs) {
    let mejor = null;
    const considerar = (p, campo, valor) => { if (!mejor || p > mejor.puntaje) mejor = { puntaje: p, campo, valor }; };
    if (idInt && loc.id_insp === idInt) considerar(ID_INTERPRETADO, 'ID_INSP', loc.id_insp);
    for (const t of loc.terminos || []) {
      const principal = PRINCIPALES.includes(t.campo);
      let p = 0;
      if (t.compacto === qc || t.norm === qn) p = principal ? EXACTO_PRINCIPAL : EXACTO_OTRO;
      else if (t.compacto.startsWith(qc) || t.norm.startsWith(qn)) p = principal ? PREFIJO_PRINCIPAL : PREFIJO_OTRO;
      else if (qc.length >= 2 && (t.norm.includes(qn) || t.compacto.includes(qc))) p = CONTIENE;
      if (p) considerar(p, t.campo, t.valor);
    }
    if (mejor) {
      const pp = loc.campos?.PP_RESULTADO || '';
      const aviso = mejor.campo.startsWith('PP_') && !pp.startsWith('Confirmado')
        ? `Coincidencia por dato PERUPETRO no confirmado (${pp || 'sin resultado'})` : '';
      res.push({ loc, ...mejor, aviso });
    }
  }
  res.sort((a, b) => b.puntaje - a.puntaje || a.loc.id_insp.localeCompare(b.loc.id_insp));
  return res.slice(0, limite);
}
