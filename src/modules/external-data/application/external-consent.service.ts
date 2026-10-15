/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
 * @system aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.
 */
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ExternalConsentRepository } from '../infrastructure/external-consent.repository.js';
import { ExternalConsentDto } from '../external-data.schemas.js';
import { toProviderCode } from './external-data-policy.util.js';

/** Consentimiento del cliente para que Atlas consulte proveedores externos: alta, listado y revocación. */
@Injectable()
export class ExternalConsentService {
  constructor(private readonly consentRepository: ExternalConsentRepository) {}

  async createConsent(input: {
    tenantId: string;
    body: ExternalConsentDto;
    ipAddress?: string;
    userAgent?: string;
    assistedByUserId?: string;
  }) {
    const providerCode = input.body.providerCode ? toProviderCode(input.body.providerCode) : 'GENERAL';
    const purposeCode =
      providerCode === 'GENERAL' ? input.body.purpose : `${providerCode.toLowerCase()}_${input.body.purpose.toLowerCase()}`;
    const consent = await this.consentRepository.createCustomerConsent({
      tenantId: input.tenantId,
      customerId: input.body.customerId,
      purposeCode,
      // Alta asistida: el canal del cuerpo se ignora y el actor queda en user_agent (no hay columna propia).
      channel: input.assistedByUserId ? 'staff_assisted' : input.body.channel,
      sessionId: input.body.sessionId,
      ipAddress: input.ipAddress,
      userAgent: input.assistedByUserId ? `staff:${input.assistedByUserId} ${input.userAgent ?? ''}`.trim() : input.userAgent,
      deviceFingerprintSnapshot: input.body.deviceFingerprintSnapshot,
      now: new Date(),
    });
    return {
      id: String(consent.id),
      customerId: input.body.customerId,
      providerCode,
      purposeCode,
      accepted: true,
      grantedAt: consent.grantedAt,
    };
  }

  async listCustomerConsents(input: { tenantId: string; customerId: string }) {
    const consents = await this.consentRepository.listCustomerConsents(input.tenantId, input.customerId);
    return consents.map((consent) => ({
      id: String(consent.id),
      customerId: String(consent.customerId),
      purposeCode: consent.purposeCode,
      granted: consent.granted,
      grantedAt: consent.grantedAt,
      revokedAt: consent.revokedAt,
      channel: consent.channel,
    }));
  }

  async revokeConsent(input: { tenantId: string; consentId: string; customerId?: string }) {
    const existing = await this.consentRepository.findCustomerConsentByIdAndTenant(input.tenantId, input.consentId);
    if (!existing) throw new NotFoundException('Consentimiento no encontrado.');
    if (input.customerId && String(existing.customerId) !== input.customerId) {
      throw new ForbiddenException('El consentimiento no corresponde al cliente autenticado.');
    }
    const consent = await this.consentRepository.revokeCustomerConsent(input.tenantId, input.consentId, new Date());
    if (!consent) throw new NotFoundException('Consentimiento no encontrado.');
    return { id: String(consent.id), customerId: String(consent.customerId), revoked: true, revokedAt: consent.revokedAt };
  }
}
