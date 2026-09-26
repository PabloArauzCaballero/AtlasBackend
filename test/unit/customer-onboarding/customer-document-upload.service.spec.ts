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
    return { service, storageService, onboardingRepository };
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

/**
 * El origen de la captura en el permiso de subida. El permiso no crea fila (la crea el paquete de
 * identidad), así que aquí sólo se audita; y si la app no lo manda, el registro queda como antes.
 */
describe('CustomerDocumentUploadService.createUploadUrl (origen de la captura)', () => {
  const ticket = { storageKey: 'k', uploadUrl: 'https://s3/k', method: 'PUT', requiredHeaders: {}, expiresAt: 'z' };
  function build() {
    const customersRepository = { findById: jest.fn(async () => ({ lifecycleStatus: 'onboarding_in_progress' })) };
    const onboardingRepository = { createOperationalAuditLog: jest.fn() };
    const storageService = { isConfigured: jest.fn(() => true), createUploadTicket: jest.fn((..._args: unknown[]) => ticket) };
    const service = new CustomerDocumentUploadService(customersRepository as never, onboardingRepository as never, storageService as never);
    return { service, storageService, onboardingRepository };
  }
  const run = (service: CustomerDocumentUploadService, extra: Record<string, unknown>) =>
    service.createUploadUrl({
      tenantId: '1',
      customerId: '24',
      body: { documentType: 'identity_front', contentType: 'image/jpeg', sizeBytes: 1000, ...extra } as never,
      currentUser: { role: 'customer', customerId: '24', internalUserId: null } as never,
      ipAddress: null,
    });
  const auditado = (repo: { createOperationalAuditLog: jest.Mock }) =>
    (repo.createOperationalAuditLog.mock.calls[0]![0] as { payloadJson: Record<string, unknown> }).payloadJson;

  it('audita el origen cuando la app lo declara, y no lo pasa al ticket firmado', async () => {
    const { service, storageService, onboardingRepository } = build();
    await expect(run(service, { captureSource: 'system_scanner' })).resolves.toEqual(ticket);
    expect(auditado(onboardingRepository)).toEqual({
      storageKey: 'k',
      documentType: 'identity_front',
      contentType: 'image/jpeg',
      captureSource: 'system_scanner',
    });
    expect(storageService.createUploadTicket.mock.calls[0]![0]).not.toHaveProperty('captureSource');
  });

  it('sin origen, el registro de auditoría es exactamente el de antes', async () => {
    const { service, onboardingRepository } = build();
    await run(service, {});
    expect(auditado(onboardingRepository)).toEqual({ storageKey: 'k', documentType: 'identity_front', contentType: 'image/jpeg' });
  });
});
