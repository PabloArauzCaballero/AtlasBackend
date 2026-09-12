/**
 * @file Entrada pública de Mensajería (AT-017). Otros módulos importan de aquí y de ningún otro sitio.
 * @business Lo que Mensajería promete al resto de Atlas: pedir un aviso y saber qué pasó con él.
 * @system Reexporta contratos y el puerto con su token. Las exportaciones de repositorio y adaptadores
 *   del módulo Nest son legado hasta que sus consumidores migren a este puerto (AT-039, AT-041).
 */
export type {
  NotificationChannelCode,
  NotificationRecipientType,
  NotificationRequestContext,
  NotificationRequestInput,
  NotificationRequestResult,
} from './notification.contracts.js';
export { NOTIFICATION_CHANNELS, NOTIFICATION_RECIPIENT_TYPES } from './notification.contracts.js';
export { NOTIFICATION_REQUEST_PORT, type NotificationRequestPort } from '../application/ports/notification-request.port.js';
