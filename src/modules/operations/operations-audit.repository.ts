/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Deja trazabilidad de cada decisión de operaciones en la auditoría y en el registro de cambios de datos.
 * @system escribe operational_audit_logs y data_change_logs dentro de la transacción de la decisión.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { DataChangeLogModel, OperationalAuditLogModel } from '../../database/models/index.js';

@Injectable()
export class OperationsAuditRepository {
  constructor(
    @InjectModel(OperationalAuditLogModel) private readonly operationalAuditLogModel: typeof OperationalAuditLogModel,
    @InjectModel(DataChangeLogModel) private readonly dataChangeLogModel: typeof DataChangeLogModel,
  ) {}

  createOperationalAudit(
    values: {
      tenantId: string;
      actorType: string;
      actorInternalUserId: string | null;
      actionCode: string;
      targetType: string;
      targetId: string;
      payload: Record<string, unknown>;
      happenedAt: Date;
    },
    options: { transaction?: Transaction },
  ): Promise<OperationalAuditLogModel> {
    return this.operationalAuditLogModel.create(
      {
        tenantId: values.tenantId,
        actorType: values.actorType,
        actorInternalUserId: values.actorInternalUserId,
        actorPlatformUserId: null,
        actionCode: values.actionCode,
        targetType: values.targetType,
        targetId: values.targetId,
        ipAddress: null,
        userAgent: null,
        payloadJson: values.payload,
        occurredAt: values.happenedAt,
        createdAtValue: values.happenedAt,
      },
      { transaction: options.transaction },
    );
  }

  createDataChange(
    values: {
      tenantId: string;
      tableName: string;
      recordId: string;
      changeType: string;
      actorType: string;
      actorInternalUserId: string | null;
      reason: string;
      happenedAt: Date;
    },
    options: { transaction?: Transaction },
  ): Promise<DataChangeLogModel> {
    return this.dataChangeLogModel.create(
      {
        tenantId: values.tenantId,
        tableName: values.tableName,
        recordId: values.recordId,
        changeType: values.changeType,
        changedByType: values.actorType,
        changedByInternalUserId: values.actorInternalUserId,
        changedByPlatformUserId: null,
        oldValuesHash: null,
        newValuesHash: null,
        changeReason: values.reason,
        changedAt: values.happenedAt,
        createdAtValue: values.happenedAt,
      },
      { transaction: options.transaction },
    );
  }
}
