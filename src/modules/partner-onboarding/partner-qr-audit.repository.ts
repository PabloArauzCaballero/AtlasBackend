/**
 * @file Puerto de persistencia: la huella de auditoría de cada cambio de QR del comercio.
 * @business Cambiar el QR bancario cambia a qué cuenta pagan los clientes: queda quién, cuándo, desde dónde y de qué cuenta a cuál (enmascaradas).
 * @system escribe en `operational_audit_logs` (la misma auditoría operativa que usan crédito y operaciones), dentro de la transacción del cambio.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { OperationalAuditLogModel } from '../../database/models/index.js';

export const PARTNER_QR_CHANGED_ACTION = 'partner.qr.changed';

/** Quién hizo el cambio: lo que dice el token, nunca el cuerpo. */
export type PartnerQrChangeActor = {
  actorType: string;
  merchantUserId: string | null;
  internalUserId: string | null;
  /** Si el cambio llegó con la contraseña repetida (`x-reauth-token`). */
  reauthenticated: boolean;
  ip: string | null;
  userAgent: string | null;
};

/** Lo que se registra de cada QR: nunca la imagen ni el contenido decodificado (en el bancario es la cuenta). */
export type PartnerQrAuditSnapshot = {
  qrId: string;
  bankInstitutionCode: string | null;
  accountNumberMasked: string | null;
  fingerprint: string;
};

/**
 * Enmascara de nuevo, por si acaso. El campo se llama `accountNumberMasked` pero el esquema sólo
 * exige 4-40 caracteres: un cliente que mande el número entero no puede dejarlo legible en la
 * auditoría. Sólo sobreviven los cuatro últimos dígitos.
 */
export function maskAccountForAudit(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  return digits.length ? `****${digits.slice(-4)}` : '****';
}

export function snapshotQrForAudit(qr: {
  id: string;
  bankInstitutionCode: string | null;
  accountNumberMasked: string | null;
  sha256: string | null | undefined;
}): PartnerQrAuditSnapshot {
  return {
    qrId: String(qr.id),
    bankInstitutionCode: qr.bankInstitutionCode,
    accountNumberMasked: maskAccountForAudit(qr.accountNumberMasked),
    // Prefijo, como en la API: identifica el archivo sin publicar la huella entera.
    fingerprint: (qr.sha256 ?? '').slice(0, 12),
  };
}

@Injectable()
export class PartnerQrAuditRepository {
  constructor(@InjectModel(OperationalAuditLogModel) private readonly auditModel: typeof OperationalAuditLogModel) {}

  recordQrChange(
    values: {
      tenantId: string;
      partnerId: string;
      qrKind: string;
      branchId: string | null;
      previous: PartnerQrAuditSnapshot | null;
      next: PartnerQrAuditSnapshot;
      actor: PartnerQrChangeActor;
      occurredAt: Date;
    },
    options: { transaction: Transaction },
  ): Promise<OperationalAuditLogModel> {
    return this.auditModel.create(
      {
        tenantId: values.tenantId,
        actorType: values.actor.actorType,
        actorInternalUserId: values.actor.internalUserId,
        actorPlatformUserId: null,
        actionCode: PARTNER_QR_CHANGED_ACTION,
        targetType: 'partner_profile',
        targetId: values.partnerId,
        ipAddress: values.actor.ip,
        userAgent: values.actor.userAgent,
        payloadJson: {
          qrKind: values.qrKind,
          branchId: values.branchId,
          // La tabla no tiene columna para el usuario de comercio: va en el cuerpo.
          actorMerchantUserId: values.actor.merchantUserId,
          reauthenticated: values.actor.reauthenticated,
          previous: values.previous,
          next: values.next,
        },
        occurredAt: values.occurredAt,
        createdAtValue: values.occurredAt,
      },
      { transaction: options.transaction },
    );
  }
}
