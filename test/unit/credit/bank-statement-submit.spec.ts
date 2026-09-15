import { describe, expect, it, jest } from '@jest/globals';
import { ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { BankStatementService } from '../../../src/modules/credit/application/bank-statement.service.js';

/**
 * `POST /customers/:id/bank-statements` aceptaba cualquier `storageKey` (medido el 2026-09-14): un
 * cliente podía colgar de su expediente el extracto de otro, o una clave inexistente que el worker
 * reintentaba sin fin. Ahora el objeto tiene que ser suyo, existir y ser un PDF.
 */
function build(
  head: { sizeBytes: number; contentType: string | null } | null = { sizeBytes: 1200, contentType: 'application/pdf' },
  configured = true,
) {
  const reviews = {
    findOne: jest.fn(async (..._args: unknown[]) => null),
    create: jest.fn(async (values: Record<string, unknown>) => ({ id: 'rev-1', ...values })),
  };
  const storage = { isConfigured: jest.fn(() => configured), headObject: jest.fn(async (..._args: unknown[]) => head) };
  const hooks = { alRegistrarEvidencia: jest.fn(async (..._args: unknown[]) => undefined) };
  const service = new BankStatementService(reviews as never, {} as never, hooks as never, storage as never);
  return { service, reviews, storage, hooks };
}

const entrada = { tenantId: '1', customerId: '10', storageKey: '1/10/bank_statement/abc.pdf' };

describe('BankStatementService.submit · el objeto declarado', () => {
  it('registra la revisión cuando el PDF es del cliente y existe, con su tamaño real', async () => {
    const { service, reviews, hooks, storage } = build();
    await expect(service.submit(entrada)).resolves.toMatchObject({ status: 'received' });
    expect(storage.headObject).toHaveBeenCalledWith(entrada.storageKey);
    expect(reviews.create).toHaveBeenCalledTimes(1);
    expect(hooks.alRegistrarEvidencia).toHaveBeenCalledWith(expect.objectContaining({ sizeBytes: '1200', mimeType: 'application/pdf' }));
  });

  it('rechaza una clave que no cuelga del prefijo del cliente, sin consultar el almacén', async () => {
    const { service, storage, reviews } = build();
    await expect(service.submit({ ...entrada, storageKey: '1/99/bank_statement/ajeno.pdf' })).rejects.toThrow(
      'BANK_STATEMENT_STORAGE_KEY_NOT_OWNED',
    );
    expect(storage.headObject).not.toHaveBeenCalled();
    expect(reviews.create).not.toHaveBeenCalled();
  });

  it('rechaza un objeto que no existe', async () => {
    const { service, reviews } = build(null);
    await expect(service.submit(entrada)).rejects.toThrow('BANK_STATEMENT_OBJECT_NOT_FOUND');
    expect(reviews.create).not.toHaveBeenCalled();
  });

  it('rechaza un objeto que no es PDF aunque exista', async () => {
    const { service } = build({ sizeBytes: 90, contentType: 'image/png' });
    await expect(service.submit(entrada)).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(service.submit(entrada)).rejects.toThrow(/BANK_STATEMENT_NOT_PDF/);
  });

  it('sin almacén configurado es 503, no un registro a ciegas', async () => {
    const { service, reviews } = build(undefined, false);
    await expect(service.submit(entrada)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(reviews.create).not.toHaveBeenCalled();
  });
});
