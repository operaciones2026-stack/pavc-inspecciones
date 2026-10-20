// Bandeja de salida y motor de sincronización (propuesta §7.3). Los datos locales nunca se borran al sincronizar.

import { tx, req, todos } from '../db.js';
import { ALMACEN } from '../repo.js';

export const ESPERAS_MS = [30e3, 60e3, 120e3, 300e3, 900e3, 1800e3];
/** Campos que el servidor puede fijar en el registro local al confirmar una operación. */
const CAMPOS_DEL_SERVIDOR = ['cod_inspeccion', 'cod_hallazgo', 'codigo_foto', 'cod_hallazgo_corto', 'numero', 'codigo_provisional', 'drive_file_id', 'drive_url'];
/** Errores que detienen la ronda (no tiene sentido seguir enviando): sin red, sin sesión, servidor sin configurar u ocupado. */
const DETIENEN = ['red', 'auth', 'config', 'ocupado'];

export class ErrorRed extends Error { constructor(m) { super(m); this.name = 'ErrorRed'; this.tipo = 'red'; } }

/** Al abrir la aplicación: operaciones que quedaron "enviando" (cierre o corte) vuelven a "pendiente". */
export async function recuperarColgadas() {
  return tx(['outbox'], 'readwrite', async (t) => {
    const s = t.objectStore('outbox');
    const colgadas = await req(s.index('estado').getAll('enviando'));
    for (const o of colgadas) s.put({ ...o, estado: 'pendiente', ultimo_error: 'Recuperada tras interrupción' });
    return colgadas.length;
  });
}

export async function resumenCola() {
  const ops = await todos('outbox');
  const r = { pendiente: 0, enviando: 0, error: 0, sincronizado: 0, total: ops.length };
  for (const o of ops) r[o.estado] = (r[o.estado] || 0) + 1;
  return r;
}

async function marcarEntidad(op, estado, ack) {
  const alm = ALMACEN[op.entidad];
  await tx([alm, 'outbox'], 'readwrite', async (t) => {
    const rec = await req(t.objectStore(alm).get(op.uuid));
    if (!rec) return;
    const pendientesMismo = (await req(t.objectStore('outbox').index('uuid').getAll(op.uuid)))
      .filter(o => o.op_id !== op.op_id && o.estado !== 'sincronizado');
    // Datos que confirma el servidor (D-22: códigos definitivos; enlaces de Drive). No es una edición del usuario.
    if (estado === 'sincronizado' && ack?.actualizar) {
      for (const [k, v] of Object.entries(ack.actualizar)) if (CAMPOS_DEL_SERVIDOR.includes(k) && v !== undefined && v !== '') rec[k] = v;
    }
    if (op.tipo === 'subir_archivo') {
      rec.archivo_sync_estado = estado;
    } else if (estado === 'sincronizado' && ack?.conflicto) {
      rec.sync_estado = 'conflicto';
    } else if (estado === 'sincronizado') {
      if (rec.version === op.version && !pendientesMismo.some(o => o.tipo !== 'subir_archivo')) {
        rec.sync_estado = 'sincronizado';
        rec.sincronizado_en = new Date().toISOString();
        if (ack?.version_servidor !== undefined) rec.sync_version_servidor = ack.version_servidor;
      }
    } else {
      rec.sync_estado = estado;
    }
    // Sin cambiar "version": no es una edición del usuario.
    t.objectStore(alm).put(rec);
  });
}

/**
 * Procesa la cola con un adaptador {configurado, mensaje, enviar(op, registro, archivo)}.
 * Devuelve {enviadas, errores, total, mensaje}.
 */
export async function procesarCola(adaptador, { ahora = Date.now(), forzar = false } = {}) {
  if (!adaptador?.configurado) {
    const r = await resumenCola();
    return { enviadas: 0, errores: 0, total: r.pendiente + r.error, mensaje: adaptador?.mensaje || 'Sin adaptador de sincronización.' };
  }
  await recuperarColgadas();
  const ops = (await todos('outbox'))
    .filter(o => o.estado === 'pendiente' || (o.estado === 'error' && (forzar || o.siguiente_intento <= ahora)))
    .sort((a, b) => a.orden - b.orden || a.creado_en.localeCompare(b.creado_en));
  let enviadas = 0, errores = 0, mensaje = '';
  for (const op of ops) {
    const alm = ALMACEN[op.entidad];
    const enviando = await tx(['outbox', alm, 'blobs'], 'readwrite', async (t) => {
      const actual = await req(t.objectStore('outbox').get(op.op_id));
      if (!actual || actual.estado === 'sincronizado') return null; // ya confirmada por otra pestaña
      t.objectStore('outbox').put({ ...actual, estado: 'enviando' });
      const registro = await req(t.objectStore(alm).get(op.uuid));
      const archivo = op.tipo === 'subir_archivo' ? await req(t.objectStore('blobs').get(op.uuid)) : null;
      return { op: actual, registro, archivo };
    });
    if (!enviando) continue;
    try {
      if (!enviando.registro) throw new Error('El registro local de esta operación no existe.');
      const ack = await adaptador.enviar(enviando.op, enviando.registro, enviando.archivo);
      await tx(['outbox'], 'readwrite', t => req(t.objectStore('outbox').put({ ...enviando.op, estado: 'sincronizado', confirmado_en: new Date().toISOString(), ack, ultimo_error: '' })));
      await marcarEntidad(enviando.op, 'sincronizado', ack);
      enviadas++;
    } catch (e) {
      errores++;
      const intentos = (enviando.op.intentos || 0) + 1;
      await tx(['outbox'], 'readwrite', t => req(t.objectStore('outbox').put({
        ...enviando.op, estado: 'error', intentos, ultimo_error: String(e?.message || e),
        siguiente_intento: Date.now() + ESPERAS_MS[Math.min(intentos - 1, ESPERAS_MS.length - 1)],
      })));
      await marcarEntidad(enviando.op, 'error');
      if (DETIENEN.includes(e?.tipo)) {
        mensaje = e.tipo === 'red' ? `Conexión interrumpida: ${e.message}. Se reintentará.` : `${e.message}`;
        break;
      }
      if (!mensaje) mensaje = `Algunas operaciones no se aplicaron: ${e.message}`;
    }
  }
  return { enviadas, errores, total: ops.length, mensaje };
}
