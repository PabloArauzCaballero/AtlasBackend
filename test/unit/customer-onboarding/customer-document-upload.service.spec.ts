import { describe, expect, it, jest } from '@jest/globals';
import { UnprocessableEntityException } from '@nestjs/common';
import { CustomerDocumentUploadService } from '../../../src/modules/customer-onboarding/application/customer-document-upload.service.js';

/**
 * Gate de estado del permiso de subida. La evidencia del alta (identidad, domicilio) sólo se sube
 * mientras el cliente está en onboarding; el EXTRACTO BANCARIO, en cambio, alimenta la línea de
 * crédito y lo sube un cliente YA ACTIVO desde la app. Gatear todo documento tras el onboarding
 * dejaba al cliente activo sin poder pedir crédito — el mismo patrón que el QR de cobro del comercio
 * aprobado.
 */
describe('CustomerDocumentUploadService.createUploadUrl (gate de estado)', () => {
  const ticket = { storageKey: 'k', uploadUrl: 'https://s3/k', method: 'PUT', requiredHeaders: {}, expiresAt: 'z' };
  function build(lifecycleStatus: string) {
    const customersRepository = { findById: jest.fn(async () => ({ lifecycleStatus })) };
    const onboardingRepository = { createOperationalAuditLog: jest.fn() };
    const storageService = { isConfigured: jest.fn(() => true), createUploadTicket: jest.fn(() => ticket) };
    const service = new CustomerDocumentUploadService(customersRepository as never, onboardingRepository as never, storageService as never);
    return { service, storageService };
  }
  const run = (service: CustomerDocumentUploadService, documentType: string) =>
    service.createUploadUrl({
      tenantId: '1',
      customerId: '24',
      body: { documentType, contentType: 'application/pdf', sizeBytes: 1000 } as never,
      currentUser: { role: 'customer', customerId: '24', internalUserId: null } as never,
      ipAddress: null,
    });

  it('un cliente ACTIVO puede subir su extracto bancario (crédito)', async () => {
    const { service } = build('active');
    await expect(run(service, 'bank_statement')).resolves.toEqual(ticket);
  });

  it('un cliente ACTIVO NO puede subir evidencia de identidad (es del alta)', async () => {
    const { service } = build('active');
    await expect(run(service, 'identity_front')).rejects.toThrow(UnprocessableEntityException);
  });

  it('durante el onboarding se admite cualquier documento, incluido el extracto', async () => {
    const { service } = build('onboarding_in_progress');
    await expect(run(service, 'identity_front')).resolves.toEqual(ticket);
    await expect(run(service, 'bank_statement')).resolves.toEqual(ticket);
  });

  it('un cliente cerrado no puede subir ni siquiera el extracto', async () => {
    const { service } = build('closed');
    await expect(run(service, 'bank_statement')).rejects.toThrow(/PROFILE_NOT_EDITABLE_IN_STATUS/);
  });
});
