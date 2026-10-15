/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
 * @system aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { CustomerConsentModel } from '../../../database/models/index.js';

/** Agregado «consentimiento del cliente» para consultas a proveedores externos. */
@Injectable()
export class ExternalConsentRepository {
  constructor(@InjectModel(CustomerConsentModel) private readonly customerConsentModel: typeof CustomerConsentModel) {}

  findCustomerConsent(tenantId: string, customerId: string, purposeCodes: string[]): Promise<CustomerConsentModel | null> {
    return this.customerConsentModel.findOne({
      where: { tenantId, customerId, granted: true, revokedAt: null, purposeCode: { [Op.in]: purposeCodes } },
      order: [['granted_at', 'DESC']],
    });
  }

  findCustomerConsentByIdAndTenant(tenantId: string, consentId: string): Promise<CustomerConsentModel | null> {
    return this.customerConsentModel.findOne({ where: { tenantId, id: consentId } });
  }

  listCustomerConsents(tenantId: string, customerId: string): Promise<CustomerConsentModel[]> {
    return this.customerConsentModel.findAll({
      where: { tenantId, customerId },
      order: [['granted_at', 'DESC']],
      limit: 100,
    });
  }

  async revokeCustomerConsent(tenantId: string, consentId: string, now: Date): Promise<CustomerConsentModel | null> {
    const consent = await this.customerConsentModel.findOne({ where: { tenantId, id: consentId } });
    if (!consent) return null;
    await consent.update({ granted: false, revokedAt: now, updatedAtValue: now } as Record<string, unknown>);
    return consent;
  }

  async createCustomerConsent(input: {
    tenantId: string;
    customerId: string;
    purposeCode: string;
    channel: string;
    sessionId?: string;
    ipAddress?: string;
    userAgent?: string;
    deviceFingerprintSnapshot?: string;
    now: Date;
  }): Promise<CustomerConsentModel> {
    return this.customerConsentModel.create({
      tenantId: input.tenantId,
      customerId: input.customerId,
      consentDocumentId: null,
      purposeCode: input.purposeCode,
      granted: true,
      grantedAt: input.now,
      revokedAt: null,
      channel: input.channel,
      sessionId: input.sessionId ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      deviceFingerprintSnapshot: input.deviceFingerprintSnapshot ?? null,
      evidenceSnapshotUrl: null,
      createdAtValue: input.now,
      updatedAtValue: input.now,
    } as Record<string, unknown>);
  }
}
