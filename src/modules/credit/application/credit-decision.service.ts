/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza materializa la oferta y solicitud de crédito solo para clientes habilitados y con decisiones explicables.
 * @system coordina productos, solicitudes, transiciones y eventos inmutables del ciclo de crédito.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { CreditApplicationDecisionDto } from '../credit.schemas.js';
import { CreditRepository } from '../credit.repository.js';

const DECISION_TO_STATUS: Readonly<Record<CreditApplicationDecisionDto['decision'], string>> = {
  approve: 'approved',
  reject: 'rejected',
  request_more_information: 'under_review',
};

const CLOSED_STATUSES = ['approved', 'rejected', 'cancelled', 'expired'];

/**
 * Decisión de operaciones sobre una solicitud de crédito.
 *
 * Mismo criterio que el resto de decisiones humanas del sistema: estado y evento de historial se
 * escriben en la MISMA transacción, toda decisión negativa exige una nota, y una solicitud ya
 * resuelta no se vuelve a decidir.
 */
@Injectable()
export class CreditDecisionService {
  constructor(
    private readonly creditRepository: CreditRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async decide(input: { tenantId: string; applicationId: string; body: CreditApplicationDecisionDto; currentUser: AuthenticatedUser }) {
    return this.sequelize.transaction(async (transaction) => {
      const application = await this.creditRepository.findApplicationById(input.tenantId, input.applicationId, { transaction });
      if (!application) throw new NotFoundException('CREDIT_APPLICATION_NOT_FOUND');
      if (CLOSED_STATUSES.includes(application.status)) throw new ConflictException('CREDIT_APPLICATION_ALREADY_DECIDED');

      const previousStatus = application.status;
      const newStatus = DECISION_TO_STATUS[input.body.decision];
      const now = new Date();

      await this.creditRepository.updateApplicationStatus(
        application,
        {
          status: newStatus,
          reasonCode: input.body.reasonCode,
          decidedByInternalUserId: input.currentUser.internalUserId ?? null,
          now,
        },
        { transaction },
      );

      await this.creditRepository.createApplicationEvent(
        {
          tenantId: input.tenantId,
          creditApplicationId: input.applicationId,
          eventType: 'decision_recorded',
          previousStatus,
          newStatus,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          reasonCode: input.body.reasonCode,
          payloadJson: { decision: input.body.decision },
          notes: input.body.notes ?? null,
          happenedAt: now,
        },
        { transaction },
      );

      return {
        applicationId: input.applicationId,
        decision: input.body.decision,
        previousStatus,
        status: newStatus,
      };
    });
  }

  async getApplicationDetail(tenantId: string, applicationId: string) {
    const application = await this.creditRepository.findApplicationById(tenantId, applicationId);
    if (!application) throw new NotFoundException('CREDIT_APPLICATION_NOT_FOUND');
    const events = await this.creditRepository.findApplicationEvents(tenantId, applicationId);
    return { application, events };
  }
}
