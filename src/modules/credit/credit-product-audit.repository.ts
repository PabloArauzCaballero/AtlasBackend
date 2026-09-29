/**
 * @file Puerto de persistencia: la huella de auditoría de los cambios de estado de un producto crediticio.
 * @business Activar, suspender o retirar un producto cambia lo que se ofrece a los clientes: queda quién, cuándo, de qué a qué y por qué.
 * @system escribe en `operational_audit_logs` (la misma auditoría operativa que usan operaciones y privacidad), dentro de la transacción del cambio.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { OperationalAuditLogModel } from '../../database/models/index.js';

export const CREDIT_PRODUCT_STATUS_ACTION = 'credit.product.status_changed';

@Injectable()
export class CreditProductAuditRepository {
  constructor(@InjectModel(OperationalAuditLogModel) private readonly auditModel: typeof OperationalAuditLogModel) {}

  recordStatusChange(
    values: {
      tenantId: string;
      productId: string;
      productCode: string | null;
      previousStatus: string | null;
      newStatus: string;
      reasonCode: string;
      actorType: string;
      actorInternalUserId: string | null;
      occurredAt: Date;
    },
    options: { transaction: Transaction },
  ): Promise<OperationalAuditLogModel> {
    return this.auditModel.create(
      {
        tenantId: values.tenantId,
        actorType: values.actorType,
        actorInternalUserId: values.actorInternalUserId,
        actorPlatformUserId: null,
        actionCode: CREDIT_PRODUCT_STATUS_ACTION,
        targetType: 'credit_product',
        targetId: values.productId,
        ipAddress: null,
        userAgent: null,
        payloadJson: {
          productCode: values.productCode,
          fromStatus: values.previousStatus,
          toStatus: values.newStatus,
          reasonCode: values.reasonCode,
        },
        occurredAt: values.occurredAt,
        createdAtValue: values.occurredAt,
      },
      { transaction: options.transaction },
    );
  }
}
