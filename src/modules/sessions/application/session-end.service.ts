import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { assertOwnCustomerResource } from '../../../common/utils/auth/ownership.util.js';
import { EndSessionResponseDto } from '../sessions.dtos.js';
import { EndSessionDto } from '../sessions.schemas.js';
import { SessionsRepository } from '../sessions.repository.js';
import { RequestContext, toDate } from './sessions.shared.js';

@Injectable()
export class SessionEndService {
  constructor(
    private readonly sessionsRepository: SessionsRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async endSession(input: {
    customerId: string;
    sessionId: string;
    body: EndSessionDto;
    currentUser: AuthenticatedUser;
    context: RequestContext;
  }): Promise<EndSessionResponseDto> {
    if (!input.context.idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    assertOwnCustomerResource(input.currentUser, input.customerId);

    const endedAt = toDate(input.body.endedAt, new Date());
    return this.sequelize.transaction(async (transaction) => {
      const session = await this.sessionsRepository.findSessionById(input.context.tenantId, input.customerId, input.sessionId, {
        transaction,
      });
      if (!session) throw new NotFoundException('Sesión no encontrada.');
      if (session.sessionStatus !== 'active') throw new UnprocessableEntityException('SESSION_NOT_ACTIVE');
      if (input.body.deviceId && session.deviceId && String(session.deviceId) !== input.body.deviceId) {
        throw new ForbiddenException('El dispositivo no corresponde a la sesión.');
      }
      const deviceId = input.body.deviceId ?? (session.deviceId ? String(session.deviceId) : null);
      const ended = await this.sessionsRepository.endSession(session, endedAt, { transaction });
      await this.sessionsRepository.createAuthEvent(
        {
          tenantId: input.context.tenantId,
          customerId: input.customerId,
          sessionId: input.sessionId,
          deviceId,
          eventType: 'session_ended',
          loginSuccessful: null,
          failureReasonCode: null,
          occurredAt: endedAt,
          ipAddress: input.context.ipAddress,
        },
        { transaction },
      );
      await this.sessionsRepository.createCustomerAction(
        {
          tenantId: input.context.tenantId,
          customerId: input.customerId,
          sessionId: input.sessionId,
          deviceId,
          eventName: 'session_ended',
          screenName: null,
          payload: { reasonCode: input.body.reasonCode },
          occurredAt: endedAt,
        },
        { transaction },
      );
      if (deviceId) {
        await this.sessionsRepository.upsertActivitySummary(
          { tenantId: input.context.tenantId, customerId: input.customerId, deviceId, now: endedAt, incrementSessionCount: false },
          { transaction },
        );
      }
      await this.sessionsRepository.createAudit(
        {
          tenantId: input.context.tenantId,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actionCode: 'customer_session.end',
          targetType: 'session',
          targetId: input.sessionId,
          ipAddress: input.context.ipAddress,
          userAgent: input.context.userAgent,
          payload: { customerId: input.customerId, reasonCode: input.body.reasonCode },
          occurredAt: endedAt,
        },
        { transaction },
      );

      return {
        sessionId: String(ended.id),
        sessionStatus: ended.sessionStatus ?? 'ended',
        endedAt: endedAt.toISOString(),
      };
    });
  }
}
