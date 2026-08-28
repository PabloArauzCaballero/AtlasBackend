/**
 * @file Servicio de aplicación: lo que hace que la conversación se sienta viva.
 * @business Corregir lo dicho, marcar hasta dónde se leyó, avisar «escribiendo…» y contar sin leer.
 * @system el «visto» se persiste; «escribiendo…» no: viaja por el bus efímero y muere ahí.
 */
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { SupportChannelRepository } from '../support-channel.repository.js';
import { SupportMessageRepository } from '../support-message.repository.js';
import { toMessageDto } from '../support.mapper.js';
import type { CorrectMessageDto, TranscriptQueryDto } from '../support-case.schemas.js';
import type { SupportActor } from './support-actor.service.js';
import { SupportMessageService } from './support-message.service.js';
import { SupportRealtimeService } from './support-realtime.service.js';

@Injectable()
export class SupportConversationService {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly messages: SupportMessageService,
    private readonly messageRepo: SupportMessageRepository,
    private readonly channels: SupportChannelRepository,
    private readonly realtime: SupportRealtimeService,
  ) {}

  /**
   * Corregir es enviar OTRO mensaje, enlazado al anterior.
   *
   * El original se queda: el cliente ya lo leyó y pudo actuar en consecuencia, así que borrarlo
   * dejaría la conversación contando una historia distinta de la que ocurrió. La interfaz puede
   * marcar el anterior como «corregido después» leyendo la relación `CORRECTS`.
   */
  async correct(input: { tenantId: string; actor: SupportActor; channelId: string; messageId: string; dto: CorrectMessageDto }) {
    await this.messages.assertParticipates(input.tenantId, input.channelId, input.actor);
    const original = await this.messageRepo.findById(input.tenantId, input.messageId);
    if (!original || String(original.channelId) !== input.channelId) {
      throw new NotFoundException({ code: 'SUPPORT_MESSAGE_NOT_FOUND', messageId: input.messageId });
    }
    if (original.senderActorId !== input.actor.actorId) {
      throw new ForbiddenException({ code: 'SUPPORT_MESSAGE_NOT_OWN', message: 'Sólo quien escribió un mensaje puede corregirlo.' });
    }

    return this.sequelize.transaction(async (transaction) => {
      const correction = await this.messages.append(
        {
          tenantId: input.tenantId,
          channelId: input.channelId,
          actor: input.actor,
          clientMessageId: input.dto.clientMessageId,
          body: input.dto.body,
          messageType: original.messageType,
          visibility: original.visibility as 'PUBLIC' | 'INTERNAL' | 'SYSTEM',
          metadata: { correctionReason: input.dto.reason },
        },
        transaction,
      );

      await this.messageRepo.createRelation(
        {
          tenantId: input.tenantId,
          messageId: String(correction.id),
          relatedMessageId: input.messageId,
          relationType: 'CORRECTS',
          createdByActorId: input.actor.actorId,
        },
        { transaction },
      );

      return toMessageDto(correction);
    });
  }

  /**
   * La transcripción, ya filtrada por visibilidad.
   *
   * `includeInternal` se deriva del actor y jamás de un parámetro de la petición: una nota interna
   * expuesta por un query string sería la fuga más tonta y más grave del módulo.
   */
  async transcript(input: { tenantId: string; actor: SupportActor; channelId: string; query: TranscriptQueryDto }) {
    await this.messages.assertParticipates(input.tenantId, input.channelId, input.actor);
    const includeInternal = input.actor.isInternal;

    const rows = await this.messageRepo.listMessages({
      channelId: input.channelId,
      beforeSequence: input.query.beforeSequence ?? null,
      limit: input.query.limit,
      includeInternal,
    });

    const attachments = await this.messageRepo.listAttachments(rows.map((row) => String(row.id)));
    const byMessage = new Map<string, typeof attachments>();
    for (const attachment of attachments) {
      const key = String(attachment.messageId);
      byMessage.set(key, [...(byMessage.get(key) ?? []), attachment]);
    }

    const ordered = [...rows].reverse();
    // El «visto» de la otra parte viaja con la transcripción: es lo que pinta el doble tic sin
    // obligar al cliente a una segunda llamada por cada refresco.
    const readState = await this.channels.readStateOf(input.channelId, input.actor.actorType, input.actor.actorId);
    await this.channels.touchSeen(input.channelId, input.actor.actorType, input.actor.actorId);

    return {
      messages: ordered.map((message) => toMessageDto(message, byMessage.get(String(message.id)) ?? [])),
      readState,
      nextCursor: rows.length === input.query.limit ? String(rows[rows.length - 1]?.serverSequence ?? '') : null,
    };
  }

  /**
   * Marca hasta dónde leyó quien pregunta y se lo comunica a la otra parte en vivo.
   *
   * El aviso importa tanto como el dato: sin él, el doble tic sólo aparecería la próxima vez que el
   * otro recargara, y un «visto» que llega tarde no informa de nada — el emisor ya asumió que no lo
   * leyeron.
   */
  async markRead(input: { tenantId: string; actor: SupportActor; channelId: string; upToSequence: string }) {
    await this.messages.assertParticipates(input.tenantId, input.channelId, input.actor);
    await this.channels.markRead({
      channelId: input.channelId,
      actorType: input.actor.actorType,
      actorId: input.actor.actorId,
      upToSequence: input.upToSequence,
    });

    this.realtime.emit({
      type: 'message.read',
      tenantId: input.tenantId,
      channelId: input.channelId,
      payload: { actorType: input.actor.actorType, upToSequence: input.upToSequence },
    });

    return { channelId: input.channelId, lastReadSequence: input.upToSequence };
  }

  /**
   * «Escribiendo…». No se guarda en ningún sitio, y así debe ser.
   *
   * Es información con vida útil de segundos: persistirla obligaría a limpiarla, a decidir cuándo
   * caduca y a explicar por qué la base dice que alguien lleva tres días escribiendo. Viaja por el
   * bus y desaparece; si se pierde, no se pierde nada.
   */
  async announceTyping(input: { tenantId: string; actor: SupportActor; channelId: string }) {
    await this.messages.assertParticipates(input.tenantId, input.channelId, input.actor);
    this.realtime.emit({
      type: 'agent.typing',
      tenantId: input.tenantId,
      channelId: input.channelId,
      payload: { actorType: input.actor.actorType },
    });
    return { channelId: input.channelId, notified: true };
  }

  /**
   * Cuántos mensajes sin leer tiene esta persona, conversación por conversación.
   *
   * Al cliente no se le cuentan las notas internas: no las puede ver, y un aviso que abre una
   * conversación sin novedades enseña a ignorar el aviso.
   */
  async unread(input: { tenantId: string; actor: SupportActor }) {
    const rows = await this.channels.unreadByChannel({
      tenantId: input.tenantId,
      actorType: input.actor.actorType,
      actorId: input.actor.actorId,
      publicOnly: !input.actor.isInternal,
    });
    return { channels: rows, total: rows.reduce((sum, row) => sum + row.unread, 0) };
  }
}
