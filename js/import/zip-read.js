// Lector ZIP mínimo (métodos 0 = almacenado y 8 = deflate) usando DecompressionStream del navegador.

export async function leerZip(buffer) {
  // ArrayBuffer.isView y no "instanceof ArrayBuffer": un buffer creado en otro contexto (iframe) no pasa instanceof.
  const buf = ArrayBuffer.isView(buffer) ? buffer.buffer : buffer;
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('El archivo no es un ZIP/XLSX válido.');
  const total = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const entradas = new Map();
  for (let k = 0; k < total; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Directorio del ZIP dañado.');
    const metodo = dv.getUint16(p + 10, true);
    const tamComp = dv.getUint32(p + 20, true);
    const lnNombre = dv.getUint16(p + 28, true), lnExtra = dv.getUint16(p + 30, true), lnCom = dv.getUint16(p + 32, true);
    const offset = dv.getUint32(p + 42, true);
    const nombre = dec.decode(new Uint8Array(buf, p + 46, lnNombre));
    entradas.set(nombre, { metodo, tamComp, offset });
    p += 46 + lnNombre + lnExtra + lnCom;
  }
  return {
    nombres: [...entradas.keys()],
    tiene: (n) => entradas.has(n),
    async bytes(nombre) {
      const e = entradas.get(nombre);
      if (!e) throw new Error(`No existe "${nombre}" dentro del archivo.`);
      if (dv.getUint32(e.offset, true) !== 0x04034b50) throw new Error('Cabecera local del ZIP dañada.');
      const ini = e.offset + 30 + dv.getUint16(e.offset + 26, true) + dv.getUint16(e.offset + 28, true);
      const crudo = new Uint8Array(buf, ini, e.tamComp);
      if (e.metodo === 0) return crudo.slice();
      if (e.metodo === 8) {
        const s = new Blob([crudo]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(s).arrayBuffer());
      }
      throw new Error(`Método de compresión ZIP no soportado (${e.metodo}).`);
    },
    async texto(nombre) { return dec.decode(await this.bytes(nombre)); },
  };
}
