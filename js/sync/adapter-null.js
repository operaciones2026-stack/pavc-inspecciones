// Adaptador de la base de CAMPO en las etapas 2–3: no hay servicio externo configurado.
// Las operaciones quedan "Pendiente de envío" y los registros siguen en el dispositivo.
export const adaptadorNulo = {
  nombre: 'sin_servicio',
  configurado: false,
  mensaje: 'La sincronización externa aún no está configurada (etapa 4). Los registros siguen guardados en este dispositivo; use Exportar para respaldarlos.',
};
