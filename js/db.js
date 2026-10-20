// Acceso a IndexedDB. Dos bases separadas (propuesta §3.1): pavc_campo y pavc_demo.
// Las pruebas automáticas usan una tercera base, pavc_test.

export const ESQUEMA_VERSION = 1;

// [almacén, opciones, índices[[nombre, ruta, opciones]]]
const ALMACENES = [
  ['meta', { keyPath: 'key' }, []],
  ['locaciones', { keyPath: 'id_insp' }, [['componente_compacto', 'componente_compacto'], ['lote', 'lote']]],
  ['catalogos', { keyPath: ['catalogo', 'valor'] }, [['catalogo', 'catalogo']]],
  ['items_checklist', { keyPath: 'codigo' }, []],
  ['incidencias_qc', { keyPath: 'id_incidencia' }, [['id_insp', 'id_insp']]],
  ['antecedentes_muestreo', { keyPath: 'uuid' }, [['id_insp', 'id_insp']]],
  ['jornadas', { keyPath: 'jornada' }, []],
  ['sectores', { keyPath: 'sector' }, []],
  ['inspecciones', { keyPath: 'uuid' }, [['id_insp', 'id_insp'], ['sync_estado', 'sync_estado']]],
  ['hallazgos', { keyPath: 'uuid' }, [['id_insp', 'id_insp'], ['inspeccion_uuid', 'inspeccion_uuid']]],
  ['acciones', { keyPath: 'uuid' }, [['hallazgo_uuid', 'hallazgo_uuid']]],
  ['verificaciones', { keyPath: 'uuid' }, [['hallazgo_uuid', 'hallazgo_uuid']]],
  ['evidencias', { keyPath: 'uuid' }, [['id_insp', 'id_insp'], ['inspeccion_uuid', 'inspeccion_uuid'], ['hallazgo_uuid', 'hallazgo_uuid']]],
  ['blobs', { keyPath: 'uuid' }, []],
  ['historial_estados', { keyPath: 'uuid' }, [['entidad_uuid', 'entidad_uuid']]],
  ['auditoria', { keyPath: 'uuid' }, [['fecha_hora', 'fecha_hora']]],
  ['outbox', { keyPath: 'op_id' }, [['estado', 'estado'], ['uuid', 'uuid']]],
  ['sim_servidor', { keyPath: 'key' }, []],
];

export const NOMBRES_BASE = { campo: 'pavc_campo', demo: 'pavc_demo', piloto: 'pavc_piloto', test: 'pavc_test' };

let _db = null;
let _nombre = null;

export function nombreBase() { return _nombre; }

export function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function abrir(nombre) {
  if (_db && _nombre === nombre) return _db;
  if (_db) { _db.close(); _db = null; }
  _db = await new Promise((resolve, reject) => {
    const r = indexedDB.open(nombre, ESQUEMA_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const [nombreAlm, opts, indices] of ALMACENES) {
        const alm = db.objectStoreNames.contains(nombreAlm)
          ? r.transaction.objectStore(nombreAlm)
          : db.createObjectStore(nombreAlm, opts);
        for (const [n, ruta, o] of indices) if (!alm.indexNames.contains(n)) alm.createIndex(n, ruta, o || {});
      }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('La base local está abierta en otra pestaña con una versión anterior. Cierre las demás pestañas de la aplicación.'));
  });
  _db.onversionchange = () => { _db.close(); _db = null; };
  _nombre = nombre;
  return _db;
}

export function cerrar() { if (_db) _db.close(); _db = null; _nombre = null; }

export async function eliminarBase(nombre) {
  if (_nombre === nombre) cerrar();
  await new Promise((resolve, reject) => {
    const r = indexedDB.deleteDatabase(nombre);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
    r.onblocked = () => resolve();
  });
}

function db() {
  if (!_db) throw new Error('Base local no abierta');
  return _db;
}

// Ejecuta fn(t) dentro de una transacción. Dentro de fn sólo deben esperarse
// solicitudes de IndexedDB (req(...)); cualquier otra espera cerraría la transacción.
export async function tx(almacenes, modo, fn) {
  const t = db().transaction(almacenes, modo);
  const fin = new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transacción cancelada'));
  });
  let resultado;
  try {
    resultado = await fn(t);
  } catch (e) {
    try { t.abort(); } catch { /* ya terminada */ }
    await fin.catch(() => {});
    throw e;
  }
  await fin;
  return resultado;
}

export const obtener = (alm, clave) => tx([alm], 'readonly', t => req(t.objectStore(alm).get(clave)));
export const todos = (alm) => tx([alm], 'readonly', t => req(t.objectStore(alm).getAll()));
export const porIndice = (alm, indice, valor) =>
  tx([alm], 'readonly', t => req(t.objectStore(alm).index(indice).getAll(IDBKeyRange.only(valor))));
export const contar = (alm) => tx([alm], 'readonly', t => req(t.objectStore(alm).count()));
export const guardar = (alm, valor) => tx([alm], 'readwrite', t => req(t.objectStore(alm).put(valor)));

export async function getMeta(clave) {
  const r = await obtener('meta', clave);
  return r ? r.valor : undefined;
}
export const setMeta = (clave, valor) => guardar('meta', { key: clave, valor });
