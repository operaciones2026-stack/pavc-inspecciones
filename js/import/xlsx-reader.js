// Lector XLSX mínimo (D-21: sin dependencias). Lee los valores guardados en el archivo
// (incluidos los resultados en caché de las fórmulas) y las validaciones de datos.

import { leerZip } from './zip-read.js';

const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export function columnaAIndice(col) {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
export function indiceAColumna(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
export function separarRef(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  return m ? { col: columnaAIndice(m[1]), fila: Number(m[2]) } : null;
}

/** Número de serie de Excel (sistema 1900) → "YYYY-MM-DD". */
export function serialAFecha(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const d = new Date(Math.round((v - 25569) * 86400000));
  return d.toISOString().slice(0, 10);
}

const hijos = (el, nombre) => [...el.childNodes].filter(n => n.nodeType === 1 && n.localName === nombre);
const hijo = (el, nombre) => hijos(el, nombre)[0];

export async function abrirXlsx(buffer) {
  const zip = await leerZip(buffer);
  const parser = new DOMParser();
  const xml = async (n) => {
    const doc = parser.parseFromString(await zip.texto(n), 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error(`XML dañado en ${n}.`);
    return doc;
  };
  if (!zip.tiene('xl/workbook.xml')) throw new Error('El archivo no es un libro de Excel (.xlsx).');
  const wb = await xml('xl/workbook.xml');
  const rels = await xml('xl/_rels/workbook.xml.rels');
  const destino = {};
  for (const r of rels.getElementsByTagName('Relationship')) destino[r.getAttribute('Id')] = r.getAttribute('Target');
  const hojas = {};
  for (const s of wb.getElementsByTagName('sheet')) {
    const rid = s.getAttributeNS(NS_R, 'id') || s.getAttribute('r:id');
    let t = destino[rid] || '';
    t = t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`;
    hojas[s.getAttribute('name')] = t;
  }
  let compartidas = [];
  if (zip.tiene('xl/sharedStrings.xml')) {
    const ss = await xml('xl/sharedStrings.xml');
    compartidas = [...ss.getElementsByTagName('si')].map(si =>
      [...si.getElementsByTagName('t')].filter(t => t.parentNode.localName !== 'rPh').map(t => t.textContent).join(''));
  }

  async function hoja(nombre) {
    if (!(nombre in hojas)) throw new Error(`No se encontró la hoja "${nombre}".`);
    const doc = await xml(hojas[nombre]);
    const filas = new Map();
    let maxFila = 0;
    for (const c of doc.getElementsByTagName('c')) {
      const ref = separarRef(c.getAttribute('r'));
      if (!ref) continue;
      const t = c.getAttribute('t');
      const v = hijo(c, 'v');
      let valor = null;
      if (t === 's') valor = v ? compartidas[Number(v.textContent)] ?? null : null;
      else if (t === 'inlineStr') { const is = hijo(c, 'is'); valor = is ? [...is.getElementsByTagName('t')].map(x => x.textContent).join('') : null; }
      else if (t === 'str') valor = v ? v.textContent : null;
      else if (t === 'b') valor = v ? v.textContent === '1' : null;
      else if (t === 'e') valor = null;
      else valor = v && v.textContent !== '' ? Number(v.textContent) : null;
      if (valor === null || valor === '') continue;
      if (!filas.has(ref.fila)) filas.set(ref.fila, new Map());
      filas.get(ref.fila).set(ref.col, valor);
      if (ref.fila > maxFila) maxFila = ref.fila;
    }
    const validaciones = [...doc.getElementsByTagName('dataValidation')].map(dv => ({
      tipo: dv.getAttribute('type'),
      sqref: dv.getAttribute('sqref') || '',
      formula1: hijo(dv, 'formula1')?.textContent ?? null,
    }));
    return {
      nombre, maxFila, validaciones,
      valor(ref) { const r = separarRef(ref); return r ? filas.get(r.fila)?.get(r.col) ?? null : null; },
      fila(n) { return filas.get(n) || new Map(); },
      /** Tabla con encabezados en `filaEnc`; termina en la primera fila sin valor en la columna clave. */
      tabla(filaEnc, { desde = filaEnc + 1, columnaClave = 1 } = {}) {
        const enc = filas.get(filaEnc) || new Map();
        const cols = [...enc.entries()].sort((a, b) => a[0] - b[0]);
        const out = [];
        for (let f = desde; f <= maxFila; f++) {
          const fila = filas.get(f);
          if (!fila || fila.get(columnaClave) === undefined) break;
          const obj = {};
          for (const [ci, nombreCol] of cols) obj[nombreCol] = fila.get(ci) ?? null;
          obj.__fila = f;
          out.push(obj);
        }
        return { encabezados: cols.map(c => c[1]), filas: out };
      },
      /** Lista de una validación de tipo lista con valores literales ("a,b,c") que cubre la celda. */
      listaEn(ref) {
        const r = separarRef(ref);
        for (const dv of validaciones) {
          if (dv.tipo !== 'list' || !dv.formula1 || !dv.formula1.startsWith('"')) continue;
          for (const rango of dv.sqref.split(/\s+/)) {
            const [a, b = a] = rango.split(':').map(separarRef);
            if (a && b && r.col >= a.col && r.col <= b.col && r.fila >= a.fila && r.fila <= b.fila) {
              return dv.formula1.slice(1, -1).split(',');
            }
          }
        }
        return null;
      },
    };
  }
  return { nombresHojas: Object.keys(hojas), hoja };
}
