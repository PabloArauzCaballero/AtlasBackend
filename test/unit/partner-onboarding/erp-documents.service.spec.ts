import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ErpDocumentsService } from '../../../src/modules/partner-onboarding/application/erp-documents.service.js';

/** El almacén de documentos del ERP: el prefijo es la frontera y el objeto se verifica antes de registrarse. */
function build(overrides: Record<string, unknown> = {}) {
  const storage = {
    isConfigured: jest.fn(() => true),
    createUploadTicket: jest.fn((input: Record<string, unknown>) => ({
      storageKey: `${input.tenantId}/${input.subjectId}/${input.documentType}/x.pdf`,
      uploadUrl: 'https://almacen/x',
      method: 'PUT',
      requiredHeaders: {},
      expiresAt: 'z',
    })),
    verifyDeclaredObject: jest.fn(async (..._args: unknown[]) => ({
      ok: true,
      metadata: { sizeBytes: 5, contentType: 'application/pdf', sha256Hex: 'ab' },
    })),
    headObject: jest.fn(async (..._args: unknown[]) => ({ sizeBytes: 5, contentType: 'application/pdf', etag: null })),
    readObject: jest.fn(async (..._args: unknown[]) => Buffer.from('%PDF')),
    ...overrides,
  };
  return { storage, service: new ErpDocumentsService(storage as never) };
}

describe('ErpDocumentsService', () => {
  it('la clave del permiso vive bajo <tenant>/erp-<dueño>/ y con el dueño saneado', () => {
    const { service } = build();
    const ticket = service.createUploadTicket({
      tenantId: '1',
      ownerType: 'BUSINESS_PARTNER',
      ownerId: 'AB12/../x',
      documentKind: 'KYB',
      contentType: 'application/pdf',
      sizeBytes: 10,
    });
    expect(ticket.storageKey).toBe('1/erp-business_partner-ab12-x/kyb/x.pdf');
  });

  it('verificar y leer rechazan una clave fuera del prefijo del ERP (el carnet de un cliente, por ejemplo)', async () => {
    const { service, storage } = build();
    await expect(
      service.verify({
        tenantId: '1',
        storageKey: '1/10/identity_front/a.jpg',
        sha256: 'a'.repeat(64),
        contentType: 'image/jpeg',
        sizeBytes: null,
      }),
    ).rejects.toThrow('ERP_DOCUMENT_KEY_NOT_OWNED');
    await expect(service.read('1', '1/partner-7/qr-bank/a.png')).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(service.read('2', '1/erp-b2b_account-x/kyb/a.pdf')).rejects.toThrow('ERP_DOCUMENT_KEY_NOT_OWNED');
    expect(storage.verifyDeclaredObject).not.toHaveBeenCalled();
    expect(storage.readObject).not.toHaveBeenCalled();
  });

  it('un objeto que no pasa la verificación del almacén se rechaza con su motivo', async () => {
    const { service } = build({ verifyDeclaredObject: jest.fn(async () => ({ ok: false, reason: 'EVIDENCE_HASH_MISMATCH' })) });
    await expect(
      service.verify({
        tenantId: '1',
        storageKey: '1/erp-b2b_account-x/kyb/a.pdf',
        sha256: 'a'.repeat(64),
        contentType: 'application/pdf',
        sizeBytes: 5,
      }),
    ).rejects.toThrow('EVIDENCE_HASH_MISMATCH');
  });

  it('leer devuelve los bytes con el tipo real, y 404 si el objeto ya no está', async () => {
    const { service } = build();
    await expect(service.read('1', '1/erp-b2b_account-x/kyb/a.pdf')).resolves.toMatchObject({ contentType: 'application/pdf' });
    const ausente = build({ headObject: jest.fn(async () => null) });
    await expect(ausente.service.read('1', '1/erp-b2b_account-x/kyb/a.pdf')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sin almacén configurado todo es 503', () => {
    const { service } = build({ isConfigured: jest.fn(() => false) });
    expect(() =>
      service.createUploadTicket({
        tenantId: '1',
        ownerType: 'a',
        ownerId: 'b',
        documentKind: 'c',
        contentType: 'application/pdf',
        sizeBytes: 1,
      }),
    ).toThrow('DOCUMENT_STORAGE_NOT_CONFIGURED');
  });
});
