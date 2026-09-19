import { describe, expect, it, jest } from '@jest/globals';
import { StreamableFile } from '@nestjs/common';
import { ErpDocumentsController } from '../../../src/modules/partner-onboarding/erp-documents.controller.js';

/** El controlador sólo traduce: el ticket, la verificación y los bytes los decide el servicio. */
describe('ErpDocumentsController', () => {
  function build() {
    const documents = {
      createUploadTicket: jest.fn(async (..._args: unknown[]) => ({ uploadUrl: 'https://almacen/x', storageKey: '1/erp-7/doc.pdf' })),
      verify: jest.fn(async (..._args: unknown[]) => ({ sizeBytes: 12, sha256Hex: 'abc', contentType: 'application/pdf' })),
      read: jest.fn(async (..._args: unknown[]) => ({ contentType: 'application/pdf', bytes: Buffer.from('%PDF') })),
    };
    return { documents, controller: new ErpDocumentsController(documents as never) };
  }

  it('el ticket lleva el tenant de la cabecera, no del cuerpo', async () => {
    const { controller, documents } = build();
    await controller.uploadUrl('1', { ownerType: 'partner', ownerId: '7', contentType: 'application/pdf', sizeBytes: 12 } as never);
    expect(documents.createUploadTicket).toHaveBeenCalledWith(expect.objectContaining({ tenantId: '1', ownerId: '7' }));
  });

  it('verificar devuelve los metadatos REALES del objeto, no los declarados', async () => {
    const { controller } = build();
    await expect(
      controller.verify('1', {
        storageKey: '1/erp-7/doc.pdf',
        sha256: 'abc',
        contentType: 'application/pdf',
        sizeBytes: undefined,
      } as never),
    ).resolves.toEqual({ storageKey: '1/erp-7/doc.pdf', sizeBytes: 12, sha256: 'abc', contentType: 'application/pdf' });
  });

  it('el contenido sale como bytes con su tipo real en la cabecera', async () => {
    const { controller } = build();
    const setHeader = jest.fn();
    const file = await controller.content('1', { storageKey: '1/erp-7/doc.pdf' } as never, { setHeader } as never);
    expect(file).toBeInstanceOf(StreamableFile);
    expect(setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
  });
});
