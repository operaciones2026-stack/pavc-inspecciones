// Conversión WGS84 → UTM (zona 17 Sur, EPSG:32717) y distancias.
// Mismo algoritmo (serie de Snyder) que la función toUTM del MAPA HTML V02.

export function aUTM(lat, lon, meridianoCentral = -81) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2), lon0 = meridianoCentral * Math.PI / 180;
  const phi = lat * Math.PI / 180, lam = lon * Math.PI / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2, C = ep2 * Math.cos(phi) ** 2, A = Math.cos(phi) * (lam - lon0);
  const M = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi
    - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi)
    + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi)
    - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi));
  const este = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000;
  let norte = k0 * (M + N * Math.tan(phi) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24
    + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
  if (lat < 0) norte += 10000000;
  return { este, norte };
}

/** Diferencia en metros como en FI Ficha F10: ROUND(SQRT(ΔE²+ΔN²),1). */
export function diferenciaM(e1, n1, e2, n2) {
  if ([e1, n1, e2, n2].some(v => v === null || v === undefined || v === '' || Number.isNaN(Number(v)))) return null;
  return Math.round(Math.hypot(Number(e1) - Number(e2), Number(n1) - Number(n2)) * 10) / 10;
}

/** Obtiene la posición del dispositivo. Rechaza con un mensaje en español. */
export function posicionActual({ timeout = 20000, maximaAntiguedadMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) { reject(new Error('Este dispositivo no ofrece geolocalización.')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const { latitude: lat, longitude: lon, accuracy } = p.coords;
        const { este, norte } = aUTM(lat, lon);
        resolve({ lat, lon, precision: Math.round(accuracy * 10) / 10, este: Math.round(este * 10) / 10, norte: Math.round(norte * 10) / 10 });
      },
      (e) => reject(new Error({ 1: 'Permiso de ubicación denegado.', 2: 'Ubicación no disponible.', 3: 'Tiempo de espera agotado al obtener el GPS.' }[e.code] || 'No se pudo obtener la ubicación.')),
      { enableHighAccuracy: true, timeout, maximumAge: maximaAntiguedadMs },
    );
  });
}
