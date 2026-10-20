// Adaptador hacia la aplicación web de Apps Script (gas/Code.gs). Una operación por solicitud.
// Sin secretos: la identidad se demuestra con el token de Google del usuario; el servidor lo verifica.

import { ErrorRed } from './outbox.js';

export class ErrorServidor extends Error {
  constructor(tipo, mensaje) { super(mensaje); this.name = 'ErrorServidor'; this.tipo = tipo; }
}

function blobABase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('No se pudo leer el archivo de la foto.'));
    r.readAsDataURL(blob);
  });
}

/** Transporte real: POST en texto plano (sin cabeceras especiales, para no requerir CORS previo). */
export async function transporteFetch(url, cuerpo) {
  let resp;
  try {
    resp = await fetch(url, { method: 'POST', body: cuerpo, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow' });
  } catch (e) {
    throw new ErrorRed(`sin conexión con el servidor (${e.message})`);
  }
  if (!resp.ok) throw new ErrorRed(`el servidor respondió ${resp.status}`);
  try { return await resp.json(); } catch { throw new ErrorRed('respuesta del servidor no legible'); }
}

/**
 * opciones: { url, base, obtenerToken: () => token|null, transporte?: (url, cuerpo) => objeto }
 */
export function crearAdaptadorGoogle({ url, base, obtenerToken, transporte = transporteFetch }) {
  return {
    nombre: 'google',
    configurado: !!url,
    mensaje: url ? '' : 'Falta la URL de la aplicación web de Apps Script.',
    async ping() {
      const token = obtenerToken();
      if (!token) throw new ErrorServidor('auth', 'Inicie sesión con Google.');
      const r = await transporte(url, JSON.stringify({ v: 1, accion: 'ping', id_token: token, base }));
      if (!r.ok) throw new ErrorServidor(r.tipo || 'servidor', r.error || 'Error del servidor');
      return r;
    },
    async enviar(op, registro, archivo) {
      const token = obtenerToken();
      if (!token) throw new ErrorServidor('auth', 'La sesión de Google no está iniciada o venció. Inicie sesión en Datos → Sincronización.');
      const pet = { v: 1, base, id_token: token, op: { op_id: op.op_id, entidad: op.entidad, uuid: op.uuid, version: op.version, tipo: op.tipo }, registro };
      if (op.tipo === 'subir_archivo') {
        if (!archivo?.reducida) throw new ErrorServidor('validacion', 'El archivo de la foto no está en el dispositivo.');
        pet.archivo_b64 = await blobABase64(archivo.reducida);
        pet.mime = archivo.reducida.type || 'image/jpeg';
      }
      const r = await transporte(url, JSON.stringify(pet));
      if (!r || !r.ok) throw new ErrorServidor(r?.tipo || 'servidor', r?.error || 'Error del servidor');
      return r.ack;
    },
  };
}
