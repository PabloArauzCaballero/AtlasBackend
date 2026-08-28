/**
 * @file Servicio de aplicación: escribir y leer la conversación de soporte.
 * @business Guarda lo que se dijo sin poder reescribirlo, y evita que un secreto quede legible.
 * @system DLP + cifrado del original + cadena de hash + idempotencia por `clientMessageId`.
 */
import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import {
  encryptSecretEnvelope,
  getActiveEncryptionProviderId,
} from '../../../common/utils/crypto/envelope-encryption.util.js';
import type { SupportMessageModel } from '../../../database/models/index.js';
import { inspectMessageBody } from '../domain/message-dlp.js';
import { SupportCaseTransitionService } from './support-case-transition.service.js';
import { SupportChannelRepository } from '../support-channel.repository.js';
import { SupportMessageRepository } from '../support-message.repository.js';
import { SupportAttachmentService } from './support-attachment.service.js';
import { SupportAuditService } from './support-audit.service.js';
import { SupportRealtimeService } from './support-realtime.service.js';
import { toMessageDto } from '../support.mapper.js';
import type { SupportActor } from './support-actor.service.js';
import type { SendMessageDto } from '../support-case.schemas.js';

/**
 * Tras hablar el cliente esperamos al agente, y viceversa.
 *
 * Es lo que ordena la cola: el agente ve arriba las conversaciones donde le toca a él. Función suelta
 * y no método porque no toca nada del servicio — recibe un estado y devuelve otro.
 */
function nextChannelStatus(current: string, actor: SupportActor): string {
  if (['CLOSED', 'CLOSING', 'ABANDONED'].includes(current)) return current;
  if (actor.actorType === 'AGENT' || actor.actorType === 'SUPERVISOR') return 'WAITING_USER';
  if (['OPEN', 'WAITING_USER', 'WAITING_AGENT'].includes(current)) return 'WAITING_AGENT';
  return current;
}

export interface AppendMessageCommand {
  tenantId: string;
  channelId: string;
  actor: SupportActor;
  clientMessageId: string;
  body: string;
  messageType: string;
  visibility: 'PUBLIC' | 'INTERNAL' | 'SYSTEM';
  correlationId?: string | null;
  metadata?: Record<string, unknown> | null;
}

@Injectable()
export class SupportMessageService {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly messages: SupportMessageRepository,
    private readonly channels: SupportChannelRepository,
    private readonly transitions: SupportCaseTransitionService,
    private readonly realtime: SupportRealtimeService,
    private readonly attachments: SupportAttachmentService,
    private readonly audit: SupportAuditService,
  ) {}

  /**
   * Escribe un mensaje. Es el único camino: no existe edición ni borrado.
   *
   * ## Qué pasa cuando alguien pega un secreto
   *
   * La vista guarda el texto redactado y el ORIGINAL se cifra en `bodyCiphertext`. No se descarta,
   * porque a veces hay que probar qué se envió —un reclamo por un OTP compartido depende de ello— y
   * no se deja en claro, porque un secreto legible en una transcripción que dura años es una fuga
   * esperando a ocurrir. El `contentHash` se calcula sobre el original, así que la cadena sigue
   * probando lo que realmente se escribió.
   *
   * ## Por qué el mensaje se escribe dentro de una transacción
   *
   * Porque reservar la secuencia, escribir el mensaje y actualizar el hash del canal son una sola
   * cosa: si el proceso muere en medio, el canal quedaría diciendo que el último mensaje es uno que
   * no existe, y la verificación de integridad reportaría manipulación donde sólo hubo un fallo.
   */
  async append(command: AppendMessageCommand, existingTransaction?: Transaction): Promise<SupportMessageModel> {
    const run = async (transaction: Transaction): Promise<SupportMessageModel> => {
      const channel = await this.channels.requireById(command.tenantId, command.channelId, { transaction });
      if (['CLOSED', 'ABANDONED'].includes(channel.status)) {
        throw new ForbiddenException({ code: 'SUPPORT_CHANNEL_CLOSED', channelId: command.channelId });
      }

      const inspection = inspectMessageBody(command.body);
      const ciphertext = inspection.hasSecrets ? await encryptSecretEnvelope(command.body) : null;

      const { message, created } = await this.messages.append(
        {
          tenantId: command.tenantId,
          channelId: command.channelId,
          clientMessageId: command.clientMessageId,
          senderActorType: command.actor.actorType,
          senderActorId: command.actor.actorId,
          senderAgentProfileId: command.actor.agentProfileId,
          messageType: command.messageType,
          visibility: command.visibility,
          bodyText: inspection.redactedText,
          bodyCiphertext: ciphertext,
          keyVersion: ciphertext ? getActiveEncryptionProviderId() : null,
          classification: inspection.hasSecrets ? 'RESTRICTED' : 'NORMAL',
          originalBody: command.body,
          redactionReason: inspection.reason,
          correlationId: command.correlationId ?? null,
          metadata: command.metadata ?? null,
        },
        transaction,
      );

      if (created) {
        await this.channels.update(
          command.tenantId,
          command.channelId,
          { lastActivityAt: new Date(), status: nextChannelStatus(channel.status, command.actor) },
          { transaction },
        );
        this.announce(command, message);
      }

      return message;
    };

    return existingTransaction ? run(existingTransaction) : this.sequelize.transaction(run);
  }

  /**
   * Avisa por el hilo en vivo de que hay un mensaje nuevo.
   *
   * Va DENTRO del `if (created)`: un reintento por mala red no debe hacer sonar el chat otra vez.
   * Y el aviso viaja con el cuerpo ya redactado, nunca con el original cifrado — el bus efímero no
   * es lugar para un secreto que la base guarda bajo llave.
   *
   * Una nota interna también se anuncia, pero marcada: el cliente no está suscrito a su propia
   * conversación con `visibility=INTERNAL`, y el filtro de entrega vive en el endpoint SSE.
   */
  private announce(command: AppendMessageCommand, message: SupportMessageModel): void {
    this.realtime.emit({
      type: 'message.created',
      tenantId: command.tenantId,
      channelId: command.channelId,
      payload: {
        messageId: String(message.id),
        sequence: String(message.serverSequence),
        senderActorType: message.senderActorType,
        messageType: message.messageType,
        visibility: message.visibility,
        body: message.bodyText,
        redacted: Boolean(message.redactedAt),
        createdAt: new Date(message.createdAtValue).toISOString(),
      },
    });
  }

  /** Camino público: comprueba que el actor está DENTRO del canal antes de dejarle escribir. */
  async send(input: {
    tenantId: string;
    actor: SupportActor;
    channelId: string;
    dto: SendMessageDto;
    correlationId?: string | null;
  }) {
    await this.assertParticipates(input.tenantId, input.channelId, input.actor);
    // El archivo se comprueba ANTES de escribir nada: un mensaje inmutable no debe quedar
    // prometiendo un comprobante que resultó inválido.
    const verified = input.dto.attachment ? await this.attachments.verify(input.dto.attachment) : null;

    const message = await this.append({
      tenantId: input.tenantId,
      channelId: input.channelId,
      actor: input.actor,
      clientMessageId: input.dto.clientMessageId,
      body: input.dto.body,
      messageType: input.dto.messageType,
      visibility: 'PUBLIC',
      correlationId: input.correlationId ?? null,
      metadata: input.dto.replyToMessageId ? { replyToMessageId: input.dto.replyToMessageId } : null,
    });

    if (input.dto.replyToMessageId) {
      await this.messages
        .createRelation({
          tenantId: input.tenantId,
          messageId: String(message.id),
          relatedMessageId: input.dto.replyToMessageId,
          relationType: 'REPLIES_TO',
          createdByActorId: input.actor.actorId,
        })
        .catch(() => undefined);
    }

    await this.markFirstResponseIfAgent(input.tenantId, input.channelId, input.actor);

    const channel = await this.channels.findById(input.tenantId, input.channelId);
    const saved = input.dto.attachment && verified
      ? await this.attachments.persist({
          tenantId: input.tenantId,
          actor: input.actor,
          messageId: String(message.id),
          caseId: channel?.caseId ? String(channel.caseId) : null,
          attachment: input.dto.attachment,
          verified,
        })
      : null;

    // El aviso al móvil sale por outbox y sólo cuando habla el equipo: notificar al cliente de su
    // propio mensaje sería avisarle de algo que acaba de hacer.
    if (input.actor.actorType !== 'CUSTOMER' && input.actor.actorType !== 'PARTNER_USER') {
      await this.audit.publish({
        tenantId: input.tenantId,
        eventCode: 'support.message.created',
        aggregateType: 'support_message',
        aggregateId: String(message.id),
        payload: { channelId: input.channelId, caseId: channel?.caseId ? String(channel.caseId) : null },
        idempotencyKey: `support-message-${message.id}`,
      });
    }

    // El adjunto viaja en la respuesta: sin él, quien acaba de mandar la foto no sabe con qué
    // identificador pedirla y tendría que recargar la conversación para ver lo que él mismo envió.
    return toMessageDto(message, saved ? [saved] : []);
  }

  /**
   * Marca la primera respuesta HUMANA cuando el que escribe es un agente.
   *
   * Va aquí y no en el flujo de asignación porque el indicador mide cuánto tarda una persona en
   * contestarle a otra, no cuánto tarda el sistema en repartir trabajo. Tomar el caso no es haber
   * respondido: el cliente sigue esperando exactamente igual.
   *
   * Faltaba por completo hasta que se probó de punta a punta: `first_response_at` quedaba nulo para
   * siempre y los relojes de acuse y primera respuesta no se satisfacían nunca, así que todo caso
   * atendido a tiempo terminaba figurando incumplido.
   */
  private async markFirstResponseIfAgent(tenantId: string, channelId: string, actor: SupportActor): Promise<void> {
    if (actor.actorType !== 'AGENT' && actor.actorType !== 'SUPERVISOR') return;

    const channel = await this.channels.findById(tenantId, channelId);
    if (!channel?.caseId) return;

    const now = new Date();
    await this.sequelize.transaction((transaction) =>
      this.transitions.recordFirstResponse({ tenantId, caseId: String(channel.caseId), at: now, actor, transaction }),
    );
    await this.channels.update(tenantId, channelId, { firstResponseAt: channel.firstResponseAt ?? now });
  }

  /**
   * Estar dentro del canal es lo que autoriza a leerlo y escribir en él.
   *
   * Es público porque lo comparten todas las operaciones sobre la conversación —enviar, corregir,
   * leer, marcar visto—: tener una sola comprobación evita que la próxima operación que se añada
   * se olvide de hacerla, que es como se abren estos agujeros.
   *
   * Se comprueba la participación viva y no el rol: un agente con permiso de soporte no debe poder
   * abrir cualquier conversación por el hecho de serlo. Un supervisor sí puede entrar —lo hace
   * uniéndose como participante, que queda registrado—, y ese registro es justamente el control.
   */
  async assertParticipates(tenantId: string, channelId: string, actor: SupportActor): Promise<void> {
    const participant = await this.channels.findLiveParticipant(channelId, actor.actorType, actor.actorId);
    if (participant) return;
    throw new ForbiddenException({
      code: 'SUPPORT_CHANNEL_NOT_PARTICIPANT',
      message: 'Este canal no está abierto para este usuario.',
    });
  }

  /** Verificación de integridad de una conversación. La usa la exportación y el barrido periódico. */
  verifyIntegrity(channelId: string) {
    return this.messages.verifyChannelChain(channelId);
  }
}
