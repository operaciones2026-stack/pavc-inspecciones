import { todos } from '../db.js';
import { buscar } from '../search.js';
import { estadoLocacion } from '../states.js';
import { agrupar } from '../stats.js';
import { esc, chipPrioridad, chipEstado } from '../ui.js';

const ETIQUETA = { ID_INSP: 'ID_INSP', COMPONENTE: 'Pozo / instalación', PP_ID: 'Código PERUPETRO', PP_NOMBRE: 'Nombre PERUPETRO', KMZ_PA_COMPONENTE: 'Componente KMZ', POLIGONO_PAVC: 'Polígono PAVC', YACIMIENTO: 'Yacimiento', NOMBRE_SECTOR: 'Sector' };

export async function render(main, consulta = '') {
  const [locs, insp] = await Promise.all([todos('locaciones'), todos('inspecciones')]);
  const porLoc = agrupar(insp.filter(i => !i.anulado), 'id_insp');
  main.innerHTML = `<section class="tarjeta">
    <h2>Buscar locación</h2>
    <form id="f" class="fila-buscar" role="search">
      <input id="q" type="search" value="${esc(consulta)}" placeholder="Ej.: 5114 · INS-253 · BAT-163 · J51 · SAP_VII_11_12429" aria-label="Buscar" autocomplete="off" autofocus>
      <button class="btn btn-primario" type="submit">Buscar</button>
    </form>
    <p class="nota">Busca por ID_INSP, número de pozo, nombre de instalación, código o nombre PERUPETRO, componente KMZ, polígono, yacimiento o sector. No hace falta elegir antes el lote ni el yacimiento.</p>
    <div id="res" aria-live="polite"></div></section>`;
  const q = main.querySelector('#q'), res = main.querySelector('#res');
  const pintar = () => {
    const v = q.value.trim();
    if (!locs.length) { res.innerHTML = '<p>No hay locaciones importadas. <a href="#/datos">Importar maestro</a>.</p>'; return; }
    if (!v) { res.innerHTML = `<p class="nota">${locs.length} locaciones disponibles.</p>`; return; }
    const r = buscar(locs, v);
    res.innerHTML = r.length ? `<p class="nota">${r.length}${r.length === 60 ? '+' : ''} resultado(s)</p><ul class="lista">${r.map(x => `
      <li><a href="#/locacion/${x.loc.id_insp}" data-id="${x.loc.id_insp}"><b>${esc(x.loc.id_insp)}</b> · ${esc(x.loc.componente)}
        <span class="sub">${esc(x.loc.tipo)} · Lote ${esc(x.loc.lote)} · ${esc(x.loc.yacimiento)} · coincide en ${esc(ETIQUETA[x.campo] || x.campo)}: “${esc(x.valor)}”</span>
        ${x.aviso ? `<span class="sub aviso-texto">${esc(x.aviso)}</span>` : ''}</a>
        ${chipPrioridad(x.loc.prioridad_ambiental)} ${chipEstado(estadoLocacion(x.loc, porLoc.get(x.loc.id_insp) || []))}</li>`).join('')}</ul>`
      : '<p>Sin resultados. Revise el número o pruebe con parte del nombre.</p>';
  };
  let t;
  q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(pintar, 150); });
  main.querySelector('#f').addEventListener('submit', (e) => {
    e.preventDefault();
    history.replaceState(null, '', `#/buscar?q=${encodeURIComponent(q.value.trim())}`);
    pintar();
  });
  pintar();
}
