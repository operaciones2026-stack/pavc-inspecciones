// Configuración de despliegue (no contiene secretos: el ID de cliente OAuth y la URL /exec son públicos por diseño;
// la seguridad la dan el token de Google, la lista de Usuarios del servidor y la auditoría).
// La base CAMPO arranca ya apuntando al servidor de producción, para que el inspector no tenga que escribirlo.
export const CONFIG_CAMPO = {
  url: 'https://script.google.com/macros/s/AKfycbyUsVLtbnnefhzU0rs12rdNQYOTRCd_vKb9uN_Z3R84Uwln_br8a-gowWogPuKmzt1tjA/exec',
  clientId: '270941510744-qadmcsf80fhfhcng7du3e674iefsrks2.apps.googleusercontent.com',
};
