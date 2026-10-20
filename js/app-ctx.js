// Contexto compartido de la aplicación: modo (campo/demo), perfil local, adaptador de sincronización y control de cambios sin guardar.

import { NOMBRES_BASE } from './db.js';
import { adaptadorNulo } from './sync/adapter-null.js';
import { crearAdaptadorSimulado } from './sync/adapter-sim.js';
import { crearAdaptadorGoogle } from './sync/adapter-gas.js';
import { sesionActual } from './sync/google-auth.js';
import { CONFIG_CAMPO } from './config.js';

const CLAVE_MODO = 'pavc_modo';

// campo = datos reales · demo = práctica con datos ficticios · piloto = base aislada de la prueba integral (etapa 3)
const MODOS = ['campo', 'demo', 'piloto'];
function leerModo() {
  try { const m = localStorage.getItem(CLAVE_MODO); return MODOS.includes(m) ? m : 'campo'; } catch { return 'campo'; }
}

export const app = {
  modo: leerModo(),
  perfil: { nombre: '', cuadrilla: '' },
  dispositivo_id: '',
  sucio: false,
  hashActual: location.hash,
  /** Función de limpieza que registra la vista actual (temporizadores); el enrutador la llama al cambiar de pantalla. */
  alSalir: null,
  _adaptadorSim: null,
  get nombreBase() { return NOMBRES_BASE[this.modo]; },
  /** Cualquier base que no sea la de campo (demo o piloto): datos no oficiales y servidor simulado. */
  get esDemo() { return this.modo !== 'campo'; },
  /** Vista de administración (configuración técnica). Los inspectores en CAMPO ven sólo lo necesario para registrar.
   *  Se activa abriendo la app con ?admin=1 y se desactiva con ?admin=0 (queda recordado en este navegador). */
  get esAdmin() {
    try {
      const q = new URLSearchParams(location.search).get('admin');
      if (q === '1' || q === '0') localStorage.setItem('pavc_admin', q);
      return this.modo !== 'campo' || localStorage.getItem('pavc_admin') === '1';
    } catch { return this.modo !== 'campo'; }
  },
  get etiquetaModo() { return { campo: 'CAMPO', demo: 'DEMO', piloto: 'PILOTO' }[this.modo]; },
  /** Destino de sincronización de la base abierta: { destino: 'ninguno'|'simulado'|'google', url, clientId }. */
  syncConfig: null,
  configSyncPorDefecto() {
    if (this.modo === 'campo' && /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(CONFIG_CAMPO.url)) {
      return { destino: 'google', url: CONFIG_CAMPO.url, clientId: CONFIG_CAMPO.clientId };
    }
    return { destino: this.esDemo ? 'simulado' : 'ninguno', url: '', clientId: '' };
  },
  adaptador() {
    const c = this.syncConfig || this.configSyncPorDefecto();
    if (c.destino === 'google') {
      if (!this._adaptadorGoogle || this._urlGoogle !== c.url) {
        this._adaptadorGoogle = crearAdaptadorGoogle({ url: c.url, base: this.nombreBase, obtenerToken: () => sesionActual()?.token || null });
        this._urlGoogle = c.url;
      }
      return this._adaptadorGoogle;
    }
    if (c.destino === 'simulado' && this.esDemo) {
      if (!this._adaptadorSim) this._adaptadorSim = crearAdaptadorSimulado();
      return this._adaptadorSim;
    }
    return adaptadorNulo;
  },
  cambiarModo(m) {
    try { localStorage.setItem(CLAVE_MODO, m); } catch { /* sin almacenamiento local */ }
    location.hash = '#/inicio';
    location.reload();
  },
  avisarCambios() { document.dispatchEvent(new CustomEvent('pavc:cambios')); },
};
