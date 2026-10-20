// Procesamiento de fotografías (D-09 aprobada): versión reducida a 1600 px (lado mayor), JPEG 0,8;
// miniatura de 320 px; hash SHA-256 del archivo original para detectar duplicados; original opcional.

export const LADO_MAX = 1600;
export const CALIDAD = 0.8;
export const LADO_MINIATURA = 320;

export async function sha256(blob) {
  const h = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function ajustar(w, h, max) {
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

async function aJpeg(bmp, w, h, calidad) {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(w, h);
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    return c.convertToBlob({ type: 'image/jpeg', quality: calidad });
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('No se pudo convertir la imagen.'))), 'image/jpeg', calidad));
}

export async function procesarFoto(archivo, { conservarOriginal = false } = {}) {
  if (!archivo || !archivo.type?.startsWith('image/')) throw new Error('El archivo seleccionado no es una imagen.');
  let bmp;
  try {
    bmp = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
  } catch {
    try { bmp = await createImageBitmap(archivo); } catch { throw new Error('El navegador no puede leer esta imagen (formato no compatible).'); }
  }
  const r = ajustar(bmp.width, bmp.height, LADO_MAX);
  const m = ajustar(bmp.width, bmp.height, LADO_MINIATURA);
  const reducida = await aJpeg(bmp, r.w, r.h, CALIDAD);
  const miniatura = await aJpeg(bmp, m.w, m.h, 0.7);
  bmp.close?.();
  return {
    reducida, miniatura, original: conservarOriginal ? archivo : null,
    hash_sha256: await sha256(archivo),
    ancho_px: r.w, alto_px: r.h, bytes: reducida.size + (conservarOriginal ? archivo.size : 0),
    mime: 'image/jpeg', nombre_original: archivo.name || '', bytes_original: archivo.size,
  };
}

/** Imagen sintética para pruebas y datos ficticios (no es una foto real). */
export async function imagenSintetica(texto, color = '#5a6b7a', w = 1200, h = 900) {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const g = c.getContext('2d');
  g.fillStyle = color; g.fillRect(0, 0, w, h);
  g.fillStyle = '#ffffff'; g.font = 'bold 64px sans-serif'; g.textAlign = 'center';
  g.fillText('DEMO / PRUEBA', w / 2, h / 2 - 40);
  g.font = '40px sans-serif'; g.fillText(texto, w / 2, h / 2 + 40);
  const blob = c.convertToBlob ? await c.convertToBlob({ type: 'image/png' }) : await new Promise(r => c.toBlob(r, 'image/png'));
  return new File([blob], `${texto}.png`, { type: 'image/png' });
}
