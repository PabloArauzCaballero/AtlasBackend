/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Deja constancia de quién creó una evaluación de riesgo y cuándo.
 * @system escribe una fila de auditoría operativa dentro de la transacción dada.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { OperationalAuditLogModel } from '../../../database/models/index.js';

type RepositoryOptions = { transaction?: Transaction };

@Injectable()
export class RiskAuditRepository {
  constructor(@InjectModel(OperationalAuditLogModel) private readonly operationalAuditLogModel: typeof OperationalAuditLogModel) {}

  createAudit(
    values: {
      tenantId: string;
      actorType: string;
      actorInternalUserId: string | null;
      actionCode: string;
      targetId: string;
      payload: Record<string, unknown>;
      now: Date;
    },
    options: RepositoryOptions,
  ): Promise<OperationalAuditLogModel> {
    return this.operationalAuditLogModel.create(
      {
        tenantId: values.tenantId,
        actorType: values.actorType,
        actorInternalUserId: values.actorInternalUserId,
        actorPlatformUserId: null,
        actionCode: values.actionCode,
        targetType: 'customer',
        targetId: values.targetId,
        ipAddress: null,
        userAgent: null,
        payloadJson: values.payload,
        occurredAt: values.now,
        createdAtValue: values.now,
      },
      { transaction: options.transaction },
    );
  }
}
