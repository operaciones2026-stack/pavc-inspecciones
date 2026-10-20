// Servidor SIMULADO, sólo para la base DEMO y las pruebas: guarda lo "recibido" en el almacén sim_servidor
// de la misma base local. Sirve para comprobar idempotencia y reintentos sin servicios externos.

import { tx, req, todos } from '../db.js';
import { ErrorRed } from './outbox.js';

export function crearAdaptadorSimulado(opciones = {}) {
  const op = { sinRed: false, perderRespuestas: 0, fallarTrasEnvios: null, ...opciones };
  let enviados = 0;
  return {
    nombre: 'simulado',
    configurado: true,
    opciones: op,
    async enviar(operacion, registro, archivo) {
      if (op.sinRed) throw new ErrorRed('sin conexión (simulado)');
      if (op.fallarTrasEnvios !== null && enviados >= op.fallarTrasEnvios) throw new ErrorRed('corte de conexión (simulado)');
      const ack = await tx(['sim_servidor'], 'readwrite', async (t) => {
        const s = t.objectStore('sim_servidor');
        const previo = await req(s.get(`op:${operacion.op_id}`));
        if (previo) {
          const st = (await req(s.get('stat:duplicadas'))) || { key: 'stat:duplicadas', n: 0 };
          s.put({ ...st, n: st.n + 1 });
          return previo.ack; // idempotente: la misma operación no se aplica dos veces
        }
        const clave = `${operacion.tipo === 'subir_archivo' ? 'archivo' : 'reg'}:${operacion.entidad}:${operacion.uuid}`;
        const existente = await req(s.get(clave));
        let version = existente?.version ?? 0;
        if (operacion.tipo === 'subir_archivo') {
          if (!existente) { s.put({ key: clave, version: 1, bytes: archivo?.reducida?.size ?? 0, hash: registro.hash_sha256 }); version = 1; }
        } else if (!existente || existente.version < operacion.version) {
          s.put({ key: clave, version: operacion.version, datos: structuredClone(registro), anulado: !!registro.anulado });
          version = operacion.version;
        }
        const respuesta = { version_servidor: version, recibido_en: new Date().toISOString(), servidor: 'simulado' };
        s.put({ key: `op:${operacion.op_id}`, ack: respuesta });
        return respuesta;
      });
      enviados++;
      if (op.perderRespuestas > 0) { op.perderRespuestas--; throw new ErrorRed('respuesta perdida tras aplicar la operación (simulado)'); }
      return ack;
    },
  };
}

export async function estadoServidorSimulado() {
  const filas = await todos('sim_servidor');
  return {
    registros: filas.filter(f => f.key.startsWith('reg:')).length,
    archivos: filas.filter(f => f.key.startsWith('archivo:')).length,
    operaciones: filas.filter(f => f.key.startsWith('op:')).length,
    duplicadas_descartadas: filas.find(f => f.key === 'stat:duplicadas')?.n ?? 0,
    porEntidad: filas.filter(f => f.key.startsWith('reg:')).reduce((m, f) => { const e = f.key.split(':')[1]; m[e] = (m[e] || 0) + 1; return m; }, {}),
  };
}
