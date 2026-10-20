// Identificadores y códigos visibles (propuesta §2 y §5.3; FI Instructivo y Registro_Fotografico).

export const uuid = () => crypto.randomUUID();

const sinTildes = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').replace(/[̀-ͯ]/g, '');

/** Normalización para búsqueda: minúsculas, sin tildes, espacios simples, sin espacios junto a paréntesis. */
export function normalizar(s) {
  return sinTildes(s).toLowerCase()
    .replace(/\(\s+/g, '(').replace(/\s+\)/g, ')')
    .replace(/\s+/g, ' ').trim();
}

/** Forma compacta: sólo letras y dígitos ("BAT-26 ( Silla)" → "bat26silla"). */
export function compactar(s) {
  return sinTildes(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Normalización para comparar personas en texto libre (D7, alerta AL-10). */
export function normalizarPersona(s) {
  return sinTildes(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export const RE_ID_INSP = /^INS-\d{3}$/;

/** Interpreta "INS-10", "ins 010" o "10" como "INS-010". Devuelve null si no aplica. */
export function interpretarIdInsp(q) {
  const m = String(q ?? '').trim().match(/^(?:ins[\s-]*)?(\d{1,3})$/i);
  return m ? `INS-${m[1].padStart(3, '0')}` : null;
}

const pad2 = (n) => String(n).padStart(2, '0');
const sinGuiones = (fechaISO) => String(fechaISO).replaceAll('-', '');

/** COD_INSPECCION = ID_INSP-yyyymmdd (FI Ficha E5); segunda visita del día: -02 (D-04). */
export function codInspeccion(idInsp, fechaISO, n = 1) {
  const base = `${idInsp}-${sinGuiones(fechaISO)}`;
  return n > 1 ? `${base}-${pad2(n)}` : base;
}

/** Número de visita del día a partir de un código existente (1 si no tiene sufijo). */
export function numeroVisitaDelDia(cod, idInsp, fechaISO) {
  const base = `${idInsp}-${sinGuiones(fechaISO)}`;
  if (cod === base) return 1;
  const m = String(cod).match(/^(.+)-(\d{2})$/);
  return m && m[1] === base ? Number(m[2]) : 0;
}

/** COD_HALLAZGO = H-<ID_INSP>-NN (FI Instructivo B5). */
export function codHallazgo(idInsp, n) { return `H-${idInsp}-${pad2(n)}`; }

export function numeroHallazgo(cod) {
  const m = String(cod).match(/-(\d{2,})$/);
  return m ? Number(m[1]) : 0;
}

/** Código corto de hallazgo para la foto: H01, H02… (FI Registro_Fotografico C). */
export function hallazgoCorto(codHall) { return codHall ? `H${pad2(numeroHallazgo(codHall))}` : 'GEN'; }

/** Lote de foto: VII → L7, VI → L6 (FI Registro_Fotografico A2). */
export function loteFoto(lote) { return lote === 'VII' ? 'L7' : lote === 'VI' ? 'L6' : ''; }

/**
 * Componente corto (≤ 12 caracteres sin espacios, FI Registro_Fotografico A2).
 * D-08 aprobada: si el componente no cabe, se usa ID_INSP sin guion (INS026) hasta que SAPET defina un alias.
 */
export function componenteCorto(loc) {
  const c = String(loc.componente ?? '').replace(/\s+/g, '');
  if (c.length > 0 && c.length <= 12 && /^[A-Za-z0-9-]+$/.test(c)) return c;
  return String(loc.id_insp).replace('-', '');
}

/** CODIGO_FOTO = LOTE_COMPONENTE_HALLAZGO_yyyymmdd_NN (FI Registro_Fotografico F). */
export function codFoto(lote, compCorto, hallCorto, fechaISO, n) {
  return `${lote}_${compCorto}_${hallCorto}_${sinGuiones(fechaISO)}_${pad2(n)}`;
}

export function prefijoFoto(codigo) { return String(codigo).replace(/_\d{2,}$/, ''); }
export function numeroFoto(codigo) { const m = String(codigo).match(/_(\d{2,})$/); return m ? Number(m[1]) : 0; }
