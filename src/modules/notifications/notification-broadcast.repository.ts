/**
 * @file Puerto de persistencia: alta masiva de mensajes in_app de un broadcast, troceada en lotes.
 * @business Esta pieza entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
 * @system orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { NotificationMessageModel } from '../../database/models/index.js';
import { RecipientType } from './notification-types.js';

// Tamaño de lote para insertar mensajes de broadcast. Un único bulkCreate con decenas de miles de
// filas produce una sentencia SQL gigante; trocear acota memoria del driver/servidor por INSERT.
const BROADCAST_INSERT_CHUNK_SIZE = 1_000;

@Injectable()
export class NotificationBroadcastRepository {
  constructor(@InjectModel(NotificationMessageModel) private readonly messageModel: typeof NotificationMessageModel) {}

  /**
   * Batch de `createMessage` para el caso de broadcast (uno-a-muchos): todos los mensajes son
   * `channel: 'in_app'` con el mismo título/cuerpo/prioridad/categoría, solo cambia el
   * destinatario. `in_app` no tiene delivery targets que cifrar (`buildEncryptedDeliveryTargets`
   * devuelve `[]` para ese canal), así que es seguro insertarlos todos con un solo `bulkCreate`
   * en vez de N `create()` secuenciales.
   */
  async createBroadcastMessages(
    recipients: Array<{ recipientType: RecipientType; recipientId: string }>,
    content: {
      tenantId: string | null;
      title: string;
      body: string;
      priority: number;
      category: string | null;
      icon: string | null;
      correlationId: string | null;
    },
  ): Promise<NotificationMessageModel[]> {
    if (recipients.length === 0) return [];
    const now = new Date();
    const rows = recipients.map(
      (recipient) =>
        ({
          tenantId: content.tenantId,
          outboxEventId: null,
          recipientType: recipient.recipientType,
          recipientId: recipient.recipientId,
          channel: 'in_app',
          templateCode: null,
          subject: null,
          title: content.title,
          body: content.body,
          payloadJson: {},
          deliveryTargetsJson: [],
          status: 'pending',
          priority: content.priority,
          category: content.category,
          icon: content.icon,
          scheduledAt: now,
          queuedAt: null,
          sentAt: null,
          deliveredAt: null,
          readAt: null,
          failedAt: null,
          cancelledAt: null,
          idempotencyKey: null,
          correlationId: content.correlationId,
          causationId: null,
          createdAtValue: now,
          updatedAtValue: now,
        }) as Record<string, unknown>,
    );

    // Se trocea en lotes para no emitir un único INSERT gigante (una sentencia con decenas de miles
    // de filas satura memoria del driver y del servidor). El orden de retorno se preserva.
    const created: NotificationMessageModel[] = [];
    for (let start = 0; start < rows.length; start += BROADCAST_INSERT_CHUNK_SIZE) {
      const chunk = rows.slice(start, start + BROADCAST_INSERT_CHUNK_SIZE);
      created.push(...(await this.messageModel.bulkCreate(chunk as never[])));
    }
    return created;
  }
}
