/**
 * @file Puerto de solicitud de notificación (AT-017).
 * @business Es la única forma sancionada de que otro contexto pida un aviso: un contrato pequeño que
 *   Mensajería puede servir hoy en proceso y mañana por red sin que el consumidor cambie.
 * @system Interfaz + token. La implementación local vive en `infrastructure/`; los consumidores la
 *   reciben por inyección con `@Inject(NOTIFICATION_REQUEST_PORT)`.
 */
import type {
  NotificationRequestContext,
  NotificationRequestInput,
  NotificationRequestResult,
} from '../../public/notification.contracts.js';

export interface NotificationRequestPort {
  request(input: NotificationRequestInput, context: NotificationRequestContext): Promise<NotificationRequestResult>;
}

export const NOTIFICATION_REQUEST_PORT = 'atlas.notifications.request-port';
