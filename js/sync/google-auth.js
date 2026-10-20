// Inicio de sesión con Google Identity Services (sólo identidad: openid, email, profile).
// El token de identidad dura alrededor de 1 h y se guarda sólo en la sesión del navegador (sessionStorage).
// La biblioteca de Google se carga únicamente cuando el usuario configura o usa la sincronización (requiere conexión).

const CLAVE = 'pavc_token_identidad';
const URL_GIS = 'https://accounts.google.com/gsi/client';

function decodificar(token) {
  try {
    const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(atob(p).split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')));
  } catch { return null; }
}

export function sesionActual() {
  try {
    const token = sessionStorage.getItem(CLAVE);
    if (!token) return null;
    const d = decodificar(token);
    if (!d || d.exp * 1000 < Date.now() + 60000) { sessionStorage.removeItem(CLAVE); return null; }
    return { token, correo: d.email, nombre: d.name || '', vence: new Date(d.exp * 1000) };
  } catch { return null; }
}

export function cerrarSesion() { try { sessionStorage.removeItem(CLAVE); } catch { /* sin almacenamiento */ } }

function cargarGIS() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) { resolve(); return; }
    const s = document.createElement('script');
    s.src = URL_GIS; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('No se pudo cargar el inicio de sesión de Google (¿sin conexión?).'));
    document.head.appendChild(s);
  });
}

/** Dibuja el botón "Iniciar sesión con Google" en `contenedor`; llama a alIniciar(sesion) al terminar. */
export async function mostrarBotonGoogle(clientId, contenedor, alIniciar) {
  if (!clientId) throw new Error('Falta el ID de cliente OAuth.');
  await cargarGIS();
  window.google.accounts.id.initialize({
    client_id: clientId,
    auto_select: false,
    callback: (r) => {
      try { sessionStorage.setItem(CLAVE, r.credential); } catch { /* sin almacenamiento */ }
      alIniciar(sesionActual());
    },
  });
  window.google.accounts.id.renderButton(contenedor, { theme: 'outline', size: 'large', text: 'signin_with', locale: 'es' });
}
