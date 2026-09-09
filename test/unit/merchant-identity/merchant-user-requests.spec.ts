import { describe, expect, it, jest } from '@jest/globals';

import { MerchantUserRequestsService } from '../../../src/modules/merchant-identity/merchant-user-requests.service.js';

/**
 * La cola de altas de identidad de comercio.
 *
 * Lo que este spec protege no es «que se pueda aprobar», sino las tres afirmaciones de las que
 * depende que el portal interno haya dejado de ser el origen del usuario de comercio:
 *
 * 1. Encolar es idempotente por la referencia del ERP —el reintento es el caso normal, no el raro—.
 * 2. Aprobar crea la identidad con los datos de LA PETICIÓN, no con los que mande quien aprueba.
 * 3. Una petición ya decidida no se vuelve a decidir.
 */
describe('Cola de altas de identidad de comercio', () => {
  function buildService(existente: Record<string, unknown> | null = null) {
    const actualizada: Record<string, unknown>[] = [];
    /*
     * La fila se declara ANTES del `update` que la muta: escribir el `Object.assign` dentro del
     * mismo literal deja a `fila` con el tipo `... | null` de la rama vacía y no compila.
     */
    const fila: Record<string, unknown> | null = existente ? { ...existente } : null;
    if (fila) {
      fila.update = jest.fn(async (valores: never) => {
        actualizada.push(valores as Record<string, unknown>);
        Object.assign(fila, valores as object);
        return fila;
      });
    }

    const requestModel = {
      findOne: jest.fn(async (..._args: unknown[]) => fila),
      findAndCountAll: jest.fn(async (..._args: unknown[]) => ({ rows: [], count: 0 })),
      create: jest.fn(async (valores: never) => ({ ...(valores as object), id: 'r1', update: jest.fn() })),
    };

    const merchantUsersService = {
      createIdentity: jest.fn(async (..._args: unknown[]) => ({
        id: 'm7',
        email: 'encargada@ferreteria.test',
        fullName: 'Marisol Quiroga',
        status: 'invited',
      })),
      connection: { transaction: jest.fn(async (work: never) => (work as (t: unknown) => unknown)({ LOCK: { UPDATE: 'UPDATE' } })) },
    };

    const service = new MerchantUserRequestsService(requestModel as never, merchantUsersService as never);
    return { service, requestModel, merchantUsersService, fila, actualizada };
  }

  const peticionPendiente = {
    id: 'r1',
    tenantId: 't1',
    source: 'erp',
    externalReference: 'erp-77',
    email: 'encargada@ferreteria.test',
    fullName: 'Marisol Quiroga',
    phone: null,
    status: 'pending',
    requestedAt: new Date('2026-09-06T10:00:00.000Z'),
    accountReference: null,
    accountName: 'Ferretería Central',
    branchName: null,
    roleCode: 'MERCHANT_ADMIN',
    requestedBy: 'ejecutivo@atlas.bo',
    merchantUserId: null,
    decidedAt: null,
    rejectionReason: null,
  };

  it('reencolar la misma referencia del ERP actualiza la petición, no crea una segunda', async () => {
    const { service, requestModel } = buildService(peticionPendiente);

    await service.enqueue(
      { externalReference: 'erp-77', email: 'Corregida@Ferreteria.test', fullName: 'Marisol Quiroga Vargas' },
      { tenantId: 't1', requestedBy: 'i1' },
    );

    expect(requestModel.create).not.toHaveBeenCalled();
  });

  it('una petición ya concedida no se reabre al reencolar', async () => {
    const { service, fila } = buildService({ ...peticionPendiente, status: 'provisioned', merchantUserId: 'm7' });

    const resultado = await service.enqueue(
      { externalReference: 'erp-77', email: 'otro@ferreteria.test', fullName: 'Otra Persona' },
      { tenantId: 't1', requestedBy: 'i1' },
    );

    // Reabrirla pediría una SEGUNDA identidad para quien ya la tiene, y el alta moriría contra el
    // índice único del correo con un 409 que no explica nada.
    expect(fila?.update).not.toHaveBeenCalled();
    expect(resultado.status).toBe('provisioned');
    expect(resultado.merchantUserId).toBe('m7');
  });

  it('aprobar crea la identidad con el correo de la petición y cierra la petición', async () => {
    const { service, merchantUsersService, actualizada } = buildService(peticionPendiente);

    const resultado = await service.approve('t1', 'r1', {}, { internalUserId: 'i1' });

    expect((merchantUsersService.createIdentity as jest.Mock).mock.calls[0]?.[0]).toMatchObject({
      email: 'encargada@ferreteria.test',
      fullName: 'Marisol Quiroga',
    });
    // La contraseña la genera el servicio: ni el ERP ni quien aprueba la eligen.
    expect(resultado.temporaryPassword).toEqual(expect.any(String));
    expect(resultado.temporaryPassword.length).toBeGreaterThanOrEqual(10);
    expect(actualizada[0]).toMatchObject({ status: 'provisioned', merchantUserId: 'm7' });
  });

  it('no se decide dos veces sobre la misma petición', async () => {
    const { service } = buildService({ ...peticionPendiente, status: 'rejected', rejectionReason: 'motivo' });

    await expect(service.approve('t1', 'r1', {}, { internalUserId: 'i1' })).rejects.toThrow(
      'MERCHANT_PROVISIONING_REQUEST_ALREADY_DECIDED',
    );
    await expect(service.reject('t1', 'r1', { reason: 'otro motivo distinto' }, { internalUserId: 'i1' })).rejects.toThrow(
      'MERCHANT_PROVISIONING_REQUEST_ALREADY_DECIDED',
    );
  });

  it('una petición inexistente no se puede decidir', async () => {
    const { service } = buildService(null);
    await expect(service.get('t1', 'r9')).rejects.toThrow('MERCHANT_PROVISIONING_REQUEST_NOT_FOUND');
  });
});
