// Datos FICTICIOS de demostración. Sólo se cargan en la base pavc_demo (nunca en pavc_campo).
// Usan locaciones reales del maestro importado en la base demo, pero las inspecciones, hallazgos,
// personas y fotos son inventados y están marcados como DEMO.

import * as repo from '../js/repo.js';
import { nombreBase, todos } from '../js/db.js';
import { imagenSintetica } from '../js/photos.js';

export async function cargarDemo() {
  if (nombreBase() !== 'pavc_demo') throw new Error('Los datos ficticios sólo se cargan en la base de demostración.');
  const locs = (await todos('locaciones')).sort((a, b) => a.id_insp.localeCompare(b.id_insp));
  if (!locs.length) throw new Error('Importe primero el maestro en la base de demostración.');
  // Obs. 1 (prueba real): una segunda carga fallaba a medias (la inspección se guardaba y la foto no).
  // Se comprueba ANTES de escribir nada: la carga sólo procede sobre una base demo sin inspecciones.
  const previas = await todos('inspecciones');
  if (previas.length) {
    throw new Error(`La base de demostración ya tiene ${previas.length} inspección(es). Para volver a cargar los datos ficticios, pulse primero "Vaciar base de demostración". No se creó ningún registro.`);
  }
  const items = await repo.items();
  const pozo = locs.find(l => l.clase === 'Pozo' && l.lote === 'VII');
  const inst = locs.find(l => l.clase !== 'Pozo' && l.lote === 'VI') || locs.find(l => l.clase !== 'Pozo');
  const creados = { inspecciones: 0, hallazgos: 0, fotos: 0 };

  // 1) Pozo: inspección finalizada con un hallazgo y fotos sintéticas
  let i1 = repo.nuevaInspeccion(pozo, { nombre: 'Inspector DEMO 1', cuadrilla: pozo.cuadrilla });
  Object.assign(i1, { acceso: 'Accesible con camioneta', clima: 'DEMO – soleado', gps_este: pozo.este + 2, gps_norte: pozo.norte - 1.5, gps_precision_m: 3, gps_origen: 'Manual', equipo_participante: 'DEMO' });
  for (const it of items) i1.respuestas[it.codigo] = { resultado: 'Conforme', observacion: '' };
  i1.respuestas.C2 = { resultado: 'No conforme', observacion: 'DEMO – mancha en borde (dato ficticio)' };
  i1.respuestas.B2 = { resultado: 'Conforme', observacion: '', lectura_instrumento: 'DEMO 0 ppm' };
  i1 = await repo.guardarInspeccion(i1);
  creados.inspecciones++;
  await repo.agregarEvidencia(await imagenSintetica(`${pozo.id_insp} GEN`), { id_insp: pozo.id_insp, inspeccion_uuid: i1.uuid, etapa: 'Inicial (antes)', descripcion: 'DEMO – vista general (imagen sintética)', orientacion_toma: 'N→S', punto_referencia_fijo: 'DEMO', autor: 'Inspector DEMO 1' });
  creados.fotos++;
  let h = repo.nuevoHallazgo(i1, 'C2');
  Object.assign(h, { categoria: 'Suelo con indicios de hidrocarburos', descripcion_objetiva: 'DEMO – registro ficticio para probar el flujo', prioridad: 'Media', largo_m: 2, ancho_m: 1.5, area_m2: 3, riesgo_consecuencia: 'DEMO', condicion_observada: 'DEMO' });
  h = await repo.guardarHallazgo(h, { accionesIniciales: [
    { tipo: 'Inmediata', descripcion: 'DEMO – señalizar', responsable: 'Responsable DEMO' },
    { tipo: 'Correctiva', descripcion: 'DEMO – retiro de suelo', responsable: 'Responsable DEMO', medio_atencion: 'Personal con herramientas manuales', fecha_compromiso: repo.hoyISO() },
  ] });
  creados.hallazgos++;
  for (const n of [1, 2]) {
    await repo.agregarEvidencia(await imagenSintetica(`${h.cod_hallazgo} antes ${n}`, '#7a5a3a'), { id_insp: pozo.id_insp, inspeccion_uuid: i1.uuid, hallazgo_uuid: h.uuid, etapa: 'Inicial (antes)', descripcion: `DEMO – detalle ${n}`, orientacion_toma: 'O→E', punto_referencia_fijo: 'DEMO cabezal', autor: 'Inspector DEMO 1' });
    creados.fotos++;
  }
  await repo.guardarInspeccion(await repo.inspeccion(i1.uuid), { finalizar: true });

  // 2) Instalación: visita No accesible
  let i2 = repo.nuevaInspeccion(inst, { nombre: 'Inspector DEMO 2', cuadrilla: inst.cuadrilla });
  Object.assign(i2, { acceso: 'No accesible', motivo_no_acceso: 'DEMO – acceso cerrado (dato ficticio)' });
  i2 = await repo.guardarInspeccion(i2, { finalizar: true });
  creados.inspecciones++;
  return creados;
}
