/**
 * @file Servicio de aplicación: entrega un mensaje de notificación por su canal y registra el desenlace.
 * @business Garantiza que cada aviso salga una sola vez por el proveedor del canal y que un fallo quede visible.
 * @system toma el mensaje, arma el payload, reclama el envío, invoca al adaptador y persiste la entrega.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { TracingService } from '../../common/observability/tracing.service.js';
import { APP_ATTRIBUTES, SPAN_NAMES } from '../../observability/telemetry.constants.js';
import { NotificationMessageModel } from '../../database/models/index.js';
import { NotificationChannelRegistry } from './notification-channel-registry.service.js';
import { NotificationDeliveriesRepository } from './notification-deliveries.repository.js';
import { NotificationDeliveryPayloadBuilder } from './notification-delivery-payload.builder.js';
import { NotificationMessagesRepository } from './notification-messages.repository.js';
import { NotificationChannel } from './notification-types.js';

@Injectable()
export class NotificationDispatchService {
  private readonly logger = new Logger(NotificationDispatchService.name);

  constructor(
    private readonly messages: NotificationMessagesRepository,
    private readonly deliveries: NotificationDeliveriesRepository,
    private readonly channels: NotificationChannelRegistry,
    private readonly payloads: NotificationDeliveryPayloadBuilder,
    @Optional() private readonly tracing: TracingService = new TracingService(),
  ) {}

  /**
   * `notification.dispatch` es un span de negocio de pleno derecho y no un tramo redundante: esta
   * entrega se invoca desde el despacho del outbox y desde las tandas de campaña, es decir DENTRO
   * de operaciones mayores y nunca 1:1 con una petición HTTP. Sin él, una campaña aparece en la
   * traza como un único bloque opaco y no se puede ver qué canal se atascó.
   *
   * Lo que se publica es el CANAL y el PROVEEDOR —dos catálogos cerrados— y el desenlace. Nunca el
   * destinatario, el asunto ni el cuerpo: son, literalmente, el mensaje que se envía a una persona.
   */
  async deliverMessage(messageOrId: string | NotificationMessageModel): Promise<void> {
    return this.tracing.runInSpan(
      SPAN_NAMES.notificationDispatch,
      { [APP_ATTRIBUTES.module]: 'notifications', [APP_ATTRIBUTES.operation]: 'dispatch' },
      () => this.dispatchMessage(messageOrId),
    );
  }

  private async dispatchMessage(messageOrId: string | NotificationMessageModel): Promise<void> {
    const message = typeof messageOrId === 'string' ? await this.messages.getMessageForDelivery(messageOrId) : messageOrId;
    if (['sent', 'delivered', 'read', 'cancelled'].includes(message.status)) return;
    const channel = message.channel as NotificationChannel;
    const adapter = this.channels.resolve(channel);
    if (!adapter) throw new Error(`NO_ADAPTER_FOR_CHANNEL_${channel}`);

    const payload = await this.payloads.build(message, channel);
    if (!adapter.validatePayload(payload)) throw new Error(`INVALID_PAYLOAD_FOR_CHANNEL_${channel}`);
    this.tracing.setAttributes({ 'notification.channel': channel, 'notification.provider': adapter.getProviderName() });
    // Otra tanda lo reclamó entre la lectura y aquí: es suyo, no se envía dos veces.
    if (!(await this.messages.markMessageSending(message))) return;
    try {
      const result = await adapter.send(payload);
      await this.deliveries.recordDelivery(message, payload, result);
      this.tracing.setAttribute('notification.outcome', result.status);
    } catch (error: unknown) {
      // El error se ABSORBE para no tumbar la tanda, pero el span sí queda marcado: una entrega
      // que falla en silencio es exactamente el fallo que nadie ve hasta que alguien reclama.
      this.tracing.setAttribute('notification.outcome', 'failed');
      this.tracing.recordException(error);
      // Antes el fallo de entrega solo quedaba como fila en notification_deliveries (status='failed'),
      // sin log ni métrica: para saber si las notificaciones estaban cayendo había que consultar la
      // tabla. Se registra con contexto (canal, proveedor) para que sea alertable.
      this.logger.warn(
        `Entrega FALLIDA del mensaje ${payload.id} por ${channel}/${adapter.getProviderName()}: ` +
          `${error instanceof Error ? error.message : 'error desconocido'}`,
      );
      await this.deliveries.recordDelivery(message, payload, {
        status: 'failed',
        provider: adapter.getProviderName(),
        providerMessageId: null,
        response: null,
        errorCode: error instanceof Error ? error.message.slice(0, 120) : 'ADAPTER_SEND_FAILED',
        errorMessage: error instanceof Error ? error.message : 'Fallo no identificado en adapter de notificación.',
      });
    }
  }
}
