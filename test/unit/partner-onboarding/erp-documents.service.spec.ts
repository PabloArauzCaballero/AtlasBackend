import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ErpDocumentsService, parseErpOwner } from '../../../src/modules/partner-onboarding/application/erp-documents.service.js';

/** El almacén de documentos del ERP: el prefijo es la frontera y el objeto se verifica antes de registrarse. */
function build(overrides: Record<string, unknown> = {}, perfil: { id: string } | null = null) {
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
  const profiles = {
    findProfilesByExternalKeys: jest.fn(async (..._args: unknown[]) => ({ rows: perfil ? [perfil] : [], count: perfil ? 1 : 0 })),
  };
  const hooks = { alRegistrarArchivoDelComercio: jest.fn(async (..._args: unknown[]) => undefined) };
  return { storage, profiles, hooks, service: new ErpDocumentsService(storage as never, profiles as never, hooks as never) };
}

const VERIFICACION = { tenantId: '1', sha256: 'a'.repeat(64), contentType: 'application/pdf' as const, sizeBytes: 5 };

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

  /*
   * El único dueño del ERP que Atlas sabe atar a un comercio es la cuenta B2B, por
   * `partner_profiles.erp_account_id`. Sus documentos se ven en la carpeta del comercio; los de un
   * caso de onboarding o de un socio de negocio del ERP no tienen expediente donde caer.
   */
  it('un documento de una cuenta B2B enlazada se anota en el expediente del comercio con la clase como nombre', async () => {
    const { service, profiles, hooks } = build({}, { id: '31' });

    await service.verify({ ...VERIFICACION, storageKey: '1/erp-b2b_account-acc-77/kyb/a.pdf' });

    expect(profiles.findProfilesByExternalKeys).toHaveBeenCalledWith('1', { erpAccountId: 'acc-77' }, { limit: 1, offset: 0 });
    expect(hooks.alRegistrarArchivoDelComercio).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: '1',
        partnerId: '31',
        documentType: 'partner_document',
        nombreBase: 'kyb',
        origen: 'portal',
        storageKey: '1/erp-b2b_account-acc-77/kyb/a.pdf',
        objeto: { sizeBytes: 5, contentType: 'application/pdf', sha256Hex: 'ab' },
      }),
    );
  });

  it('sin cuenta enlazada, o con un dueño que Atlas no conoce, se verifica igual y no se anota nada', async () => {
    const sinEnlace = build();
    await expect(sinEnlace.service.verify({ ...VERIFICACION, storageKey: '1/erp-b2b_account-acc-77/kyb/a.pdf' })).resolves.toBeDefined();
    expect(sinEnlace.hooks.alRegistrarArchivoDelComercio).not.toHaveBeenCalled();

    const caso = build({}, { id: '31' });
    await caso.service.verify({ ...VERIFICACION, storageKey: '1/erp-onboarding_case-9/nit/a.pdf' });
    expect(caso.profiles.findProfilesByExternalKeys).not.toHaveBeenCalled();
    expect(caso.hooks.alRegistrarArchivoDelComercio).not.toHaveBeenCalled();
  });

  it('un fallo al anotar en el expediente NO hace fallar la verificación: el ERP ya tiene el objeto', async () => {
    const { service, profiles } = build({}, { id: '31' });
    profiles.findProfilesByExternalKeys.mockRejectedValueOnce(new Error('base caída') as never);

    await expect(service.verify({ ...VERIFICACION, storageKey: '1/erp-b2b_account-acc-77/kyb/a.pdf' })).resolves.toMatchObject({
      sizeBytes: 5,
    });
  });

  it('parseErpOwner deshace la composición de la clave y rechaza lo que no tiene esa forma', () => {
    expect(parseErpOwner('1', '1/erp-b2b_account-9f3a-1c/adjunto/x.pdf')).toEqual({
      ownerType: 'b2b_account',
      ownerId: '9f3a-1c',
      documentKind: 'adjunto',
    });
    expect(parseErpOwner('2', '1/erp-b2b_account-9/kyb/x.pdf')).toBeNull();
    expect(parseErpOwner('1', '1/partner-7/qr-bank/x.png')).toBeNull();
    expect(parseErpOwner('1', '1/erp-sinid/kyb/x.pdf')).toBeNull();
    expect(parseErpOwner('1', '1/erp-b2b_account-/kyb/x.pdf')).toBeNull();
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
