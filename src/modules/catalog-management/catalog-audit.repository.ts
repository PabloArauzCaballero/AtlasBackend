/**
 * @file Puerto de persistencia de la auditoría de catálogos: bitácora operativa y bitácora de cambios de datos.
 * @business Cada cambio de catálogo deja constancia de quién, qué y por qué; este repositorio escribe esa constancia.
 * @system implementa las dos escrituras de auditoría que acompañan a toda mutación del módulo.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { DataChangeLogModel, OperationalAuditLogModel } from '../../database/models/index.js';
import { sha256Hex } from '../../common/utils/crypto/hash.util.js';
import { RepositoryOptions } from './catalog-repository.helpers.js';

export type AuditValues = {
  tenantId: string;
  actorType: string;
  actorInternalUserId: string | null;
  actorPlatformUserId: string | null;
  actionCode: string;
  targetType: string;
  targetId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  payload: Record<string, unknown>;
  occurredAt: Date;
};

export type DataChangeValues = {
  tenantId: string;
  tableName: string;
  recordId: string | null;
  changeType: string;
  actorType: string;
  actorInternalUserId: string | null;
  actorPlatformUserId: string | null;
  reason: string;
  newValues?: Record<string, unknown>;
  happenedAt: Date;
};

function hashPayload(value: Record<string, unknown> | undefined): string | null {
  if (!value) return null;
  return sha256Hex(JSON.stringify(value));
}

@Injectable()
export class CatalogAuditRepository {
  constructor(
    @InjectModel(OperationalAuditLogModel) private readonly auditModel: typeof OperationalAuditLogModel,
    @InjectModel(DataChangeLogModel) private readonly dataChangeLogModel: typeof DataChangeLogModel,
  ) {}

  createAudit(values: AuditValues, options: RepositoryOptions): Promise<OperationalAuditLogModel> {
    return this.auditModel.create(
      {
        tenantId: values.tenantId,
        actorType: values.actorType,
        actorInternalUserId: values.actorInternalUserId,
        actorPlatformUserId: values.actorPlatformUserId,
        actionCode: values.actionCode,
        targetType: values.targetType,
        targetId: values.targetId,
        ipAddress: values.ipAddress,
        userAgent: values.userAgent,
        payloadJson: values.payload,
        occurredAt: values.occurredAt,
        createdAtValue: values.occurredAt,
      } as any,
      { transaction: options.transaction },
    );
  }

  createDataChange(values: DataChangeValues, options: RepositoryOptions): Promise<DataChangeLogModel> {
    return this.dataChangeLogModel.create(
      {
        tenantId: values.tenantId,
        tableName: values.tableName,
        recordId: values.recordId,
        changeType: values.changeType,
        changedByType: values.actorType,
        changedByInternalUserId: values.actorInternalUserId,
        changedByPlatformUserId: values.actorPlatformUserId,
        oldValuesHash: null,
        newValuesHash: hashPayload(values.newValues),
        changeReason: values.reason,
        changedAt: values.happenedAt,
        createdAtValue: values.happenedAt,
      } as any,
      { transaction: options.transaction },
    );
  }
}
