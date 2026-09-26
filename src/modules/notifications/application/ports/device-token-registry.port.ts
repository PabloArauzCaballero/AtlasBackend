/**
 * @file Puerto para dar de baja los tokens de dispositivo que el proveedor declara muertos.
 * @business Un teléfono que desinstaló la app deja de recibir avisos; seguir intentándolo no le llega
 *   a nadie y degrada la reputación de envío de Atlas ante Apple y Google.
 * @system El adaptador de push conoce los tokens muertos pero no debe conocer la base: los recibe
 *   Apple en la respuesta y los entrega por este puerto, que Mensajería implementa sobre Sequelize.
 */

/**
 * Token de inyección. Igual que `APNS_TRANSPORT`, es un Symbol y NO el tipo: un parámetro cuyo tipo
 * es una interfaz no existe en tiempo de ejecución, así que Nest no podría resolverlo.
 */
export const DEVICE_TOKEN_REGISTRY_PORT = Symbol('DEVICE_TOKEN_REGISTRY_PORT');

export interface DeviceTokenRegistryPort {
  /**
   * Marca como inactivos los tokens indicados. Devuelve cuántas filas cambiaron.
   *
   * Recibe el token EN CLARO porque es lo que devuelve el proveedor; la implementación lo convierte
   * en huella para buscarlo, igual que hizo el registro. Nunca se registra en bitácora.
   */
  deactivate(tokens: string[]): Promise<number>;
}
