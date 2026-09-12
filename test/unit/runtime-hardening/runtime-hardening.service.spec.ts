import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { asyncMock, callArg, type CallArgRecord } from '../../support/jest-mocks.js';
import { ConflictException } from '@nestjs/common';
import { UniqueConstraintError } from 'sequelize';
import { RuntimeHardeningService } from '../../../src/modules/runtime-hardening/runtime-hardening.service.js';
import { IdempotencyClaimStore } from '../../../src/modules/runtime-hardening/infrastructure/idempotency-claim.store.js';

/**
 * ATLAS-P10-026 (cierra parcialmente RC-03 de AUDITORIA_ATLAS_BACKEND_10_10.md para
 * `runtime-hardening`): idempotencia + outbox transaccional es la pieza de infraestructura de
 * la que depende CUALQUIER endpoint de escritura del proyecto (ver `IdempotencyInterceptor` /
 * `ApiCommandOutboxInterceptor` en `app.module.ts`). No tenía ningún test propio antes de este
 * patch, pese a ser exactamente el tipo de código transaccional/financiero-adyacente que
 * `BACKEND_DEVELOPMENT_CONTEXT.md` §2 marca como "auditable e idempotente" por regla.
 */

function buildIdempotencyModelMock() {
  return {
    findOne: asyncMock(),
    create: jest.fn(async (values: Record<string, unknown>) => ({ ...values, save: jest.fn(async (..._args: unknown[]) => undefined) })),
    // Reclamo, cierre y fallo son actualizaciones CONDICIONALES (AT-009): `[filas afectadas]`.
    update: jest.fn(async (..._args: unknown[]) => [1]),
  };
}

/** La petición de referencia y su huella tal como la calcula el servicio (HMAC versionado, AT-010). */
const REQUEST = { body: { amount: '10.00' }, query: {}, params: {} };
function hashOf(service: RuntimeHardeningService): string {
  return service.requestHash(REQUEST.body, REQUEST.query, REQUEST.params);
}

function buildOutboxModelMock() {
  return {
    create: jest.fn(async (values: Record<string, unknown>) => ({ ...values, save: jest.fn(async (..._args: unknown[]) => undefined) })),
    findAll: jest.fn(async (..._args: unknown[]) => []),
  };
}

function buildService(idempotencyModel = buildIdempotencyModelMock(), outboxModel = buildOutboxModelMock()) {
  const claims = new IdempotencyClaimStore(idempotencyModel as never);
  return { service: new RuntimeHardeningService(idempotencyModel as never, outboxModel as never, claims), idempotencyModel, outboxModel };
}

const NOW = new Date('2026-07-02T10:00:00.000Z');

describe('RuntimeHardeningService.claimIdempotency', () => {
  it('sin registro previo: crea uno nuevo en estado processing y devuelve mode=execute', async () => {
    const { service, idempotencyModel } = buildService();
    idempotencyModel.findOne.mockResolvedValueOnce(null);

    const result = await service.claimIdempotency({
      tenantScope: 't1',
      actorType: 'customer',
      actorId: 'cust-1',
      idempotencyKey: 'idem-abc',
      scope: 'purchases.create',
      request: REQUEST,
      now: NOW,
    });

    expect(result.mode).toBe('execute');
    expect(idempotencyModel.create).toHaveBeenCalledTimes(1);
    const created = callArg<CallArgRecord>(idempotencyModel.create, 0, 0);
    expect(created.status).toBe('processing');
    expect(created.lockedUntil).toEqual(new Date(NOW.getTime() + 5 * 60_000));
  });

  it('recupera la carrera bajo la misma idempotencyKey sin propagar un 500', async () => {
    const { service, idempotencyModel } = buildService();
    idempotencyModel.findOne.mockResolvedValueOnce(null);
    idempotencyModel.create.mockRejectedValueOnce(new UniqueConstraintError({}));
    const winner = {
      requestHash: hashOf(service),
      actorId: 'cust-1',
      status: 'processing',
      lockedUntil: new Date(NOW.getTime() + 60_000),
      save: jest.fn(async (..._args: unknown[]) => undefined),
    };
    idempotencyModel.findOne.mockResolvedValueOnce(winner as never);

    await expect(
      service.claimIdempotency({
        tenantScope: 't1',
        actorType: 'customer',
        actorId: 'cust-1',
        idempotencyKey: 'idem-abc',
        scope: 'purchases.create',
        request: REQUEST,
        now: NOW,
      }),
    ).rejects.toThrow(/IDEMPOTENCY_REQUEST_IN_PROGRESS/);
    expect(idempotencyModel.findOne).toHaveBeenCalledTimes(2);
  });

  it('registro existente con requestHash distinto: SIEMPRE lanza IDEMPOTENCY_CONFLICT, sin importar el estado', async () => {
    const { service, idempotencyModel } = buildService();
    idempotencyModel.findOne.mockResolvedValueOnce({
      requestHash: hashOf(service),
      actorId: 'cust-1',
      status: 'completed',
      responseBodyJson: {},
    });

    await expect(
      service.claimIdempotency({
        tenantScope: 't1',
        actorType: 'customer',
        actorId: 'cust-1',
        idempotencyKey: 'idem-abc',
        scope: 'purchases.create',
        request: { ...REQUEST, body: { amount: '99.00' } },
        now: NOW,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('registro completado con mismo requestHash: devuelve mode=replay con la respuesta guardada (no reejecuta el caso de uso)', async () => {
    const { service, idempotencyModel } = buildService();
    idempotencyModel.findOne.mockResolvedValueOnce({
      requestHash: hashOf(service),
      actorId: 'cust-1',
      status: 'completed',
      responseBodyJson: { purchaseId: 'p-1' },
      responseStatus: 201,
    });

    const result = await service.claimIdempotency({
      tenantScope: 't1',
      actorType: 'customer',
      actorId: 'cust-1',
      idempotencyKey: 'idem-abc',
      scope: 'purchases.create',
      request: REQUEST,
      now: NOW,
    });

    expect(result).toEqual({ mode: 'replay', responseBody: { purchaseId: 'p-1' }, responseStatus: 201 });
  });

  it('registro "processing" con lock vigente: lanza IDEMPOTENCY_REQUEST_IN_PROGRESS (evita doble ejecución concurrente)', async () => {
    const { service, idempotencyModel } = buildService();
    idempotencyModel.findOne.mockResolvedValueOnce({
      requestHash: hashOf(service),
      actorId: 'cust-1',
      status: 'processing',
      lockedUntil: new Date(NOW.getTime() + 60_000), // vence en el futuro respecto a `now`
    });

    await expect(
      service.claimIdempotency({
        tenantScope: 't1',
        actorType: 'customer',
        actorId: 'cust-1',
        idempotencyKey: 'idem-abc',
        scope: 'purchases.create',
        request: REQUEST,
        now: NOW,
      }),
    ).rejects.toThrow('IDEMPOTENCY_REQUEST_IN_PROGRESS');
  });

  it('registro "processing" con lock YA vencido: se reclama de nuevo (recupera de un worker/proceso caído) y devuelve mode=execute', async () => {
    const { service, idempotencyModel } = buildService();
    const existing = {
      id: '5',
      requestHash: hashOf(service),
      actorId: 'cust-1',
      status: 'processing',
      lockedUntil: new Date(NOW.getTime() - 60_000), // vencido
    };
    idempotencyModel.findOne.mockResolvedValueOnce(existing);

    const result = await service.claimIdempotency({
      tenantScope: 't1',
      actorType: 'customer',
      actorId: 'cust-1',
      idempotencyKey: 'idem-abc',
      scope: 'purchases.create',
      request: REQUEST,
      now: NOW,
    });

    expect(result.mode).toBe('execute');
    expect(existing.status).toBe('processing');
    // Reclamo ATÓMICO: una actualización condicional sobre la fila vencida, no un `save()` a ciegas.
    expect(idempotencyModel.update).toHaveBeenCalledTimes(1);
    const [values, options] = idempotencyModel.update.mock.calls[0] as [Record<string, unknown>, { where: Record<string, unknown> }];
    expect(values.status).toBe('processing');
    expect(typeof values.ownerToken).toBe('string');
    expect(options.where.id).toBe('5');
  });

  it('registro vencido que OTRO proceso recuperó un instante antes: para este llamador está en curso, no hay dos dueños', async () => {
    const { service, idempotencyModel } = buildService();
    idempotencyModel.findOne.mockResolvedValueOnce({
      id: '5',
      requestHash: hashOf(service),
      actorId: 'cust-1',
      status: 'processing',
      lockedUntil: new Date(NOW.getTime() - 60_000),
    });
    idempotencyModel.update.mockResolvedValueOnce([0] as never);

    await expect(
      service.claimIdempotency({
        tenantScope: 't1',
        actorType: 'customer',
        actorId: 'cust-1',
        idempotencyKey: 'idem-abc',
        scope: 'purchases.create',
        request: REQUEST,
        now: NOW,
      }),
    ).rejects.toThrow('IDEMPOTENCY_REQUEST_IN_PROGRESS');
  });

  it('misma clave y misma petición pero OTRO actor: conflicto, nunca la respuesta ajena (AT-010)', async () => {
    const { service, idempotencyModel } = buildService();
    idempotencyModel.findOne.mockResolvedValueOnce({
      requestHash: hashOf(service),
      actorId: 'cust-OTRO',
      status: 'completed',
      responseBodyJson: { purchaseId: 'p-1' },
      responseStatus: 201,
    });

    await expect(
      service.claimIdempotency({
        tenantScope: 't1',
        actorType: 'customer',
        actorId: 'cust-1',
        idempotencyKey: 'idem-abc',
        scope: 'purchases.create',
        request: REQUEST,
        now: NOW,
      }),
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });

  it('respuesta de autenticación completada: no se reproduce (el cuerpo no se guardó a propósito)', async () => {
    const { service, idempotencyModel } = buildService();
    idempotencyModel.findOne.mockResolvedValueOnce({
      requestHash: hashOf(service),
      actorId: null,
      status: 'completed',
      responseBodyJson: null,
      responseStatus: 200,
    });

    await expect(
      service.claimIdempotency({
        tenantScope: 't1',
        actorType: null,
        actorId: null,
        idempotencyKey: 'idem-login',
        scope: 'POST /api/v1/auth/login',
        request: REQUEST,
        now: NOW,
      }),
    ).rejects.toThrow('IDEMPOTENCY_REPLAY_NOT_AVAILABLE');
  });
});

describe('RuntimeHardeningService.completeIdempotency / failIdempotency', () => {
  const lease = { record: { id: '5', scope: 'POST /api/v1/purchases' }, ownerToken: 'tok-1' } as never as Parameters<
    RuntimeHardeningService['completeIdempotency']
  >[0];

  it('completeIdempotency marca completed, guarda el status HTTP y redacta el response body sensible', async () => {
    const { service, idempotencyModel } = buildService();

    await service.completeIdempotency(lease, 201, { purchaseId: 'p-1', customerPhone: '77712345' });

    expect(idempotencyModel.update).toHaveBeenCalledTimes(1);
    const [values, options] = idempotencyModel.update.mock.calls[0] as [Record<string, unknown>, { where: Record<string, unknown> }];
    expect(values.status).toBe('completed');
    expect(values.responseStatus).toBe(201);
    expect(values.lockedUntil).toBeNull();
    // `phone` matchea el patrón de campos sensibles de redaction.util.ts → debe quedar redactado.
    expect((values.responseBodyJson as { customerPhone: string }).customerPhone).toBe('[REDACTED]');
    expect((values.responseBodyJson as { purchaseId: string }).purchaseId).toBe('p-1');
    // Fencing: sólo cierra la fila si el testigo sigue siendo el vigente.
    expect(options.where).toMatchObject({ id: '5', ownerToken: 'tok-1', status: 'processing' });
  });

  it('completeIdempotency de un dueño ANTERIOR no pisa el resultado del vigente (0 filas afectadas, sin error)', async () => {
    const { service, idempotencyModel } = buildService();
    idempotencyModel.update.mockResolvedValueOnce([0] as never);

    await expect(service.completeIdempotency(lease, 201, { ok: true })).resolves.toBeUndefined();
  });

  it('completeIdempotency en una ruta de credenciales NO guarda el cuerpo de la respuesta', async () => {
    const { service, idempotencyModel } = buildService();
    const login = { record: { id: '6', scope: 'POST /api/v1/auth/login' }, ownerToken: 'tok-2' } as never as Parameters<
      RuntimeHardeningService['completeIdempotency']
    >[0];

    await service.completeIdempotency(login, 200, { accessToken: 'secreto' });

    const [values] = idempotencyModel.update.mock.calls[0] as [Record<string, unknown>];
    expect(values.responseBodyJson).toBeNull();
    expect(values.status).toBe('completed');
  });

  it('failIdempotency marca failed y libera el lock (permite reintento)', async () => {
    const { service, idempotencyModel } = buildService();

    await service.failIdempotency(lease);

    const [values, options] = idempotencyModel.update.mock.calls[0] as [Record<string, unknown>, { where: Record<string, unknown> }];
    expect(values.status).toBe('failed');
    expect(values.lockedUntil).toBeNull();
    expect(options.where).toMatchObject({ id: '5', ownerToken: 'tok-1' });
  });
});

describe('RuntimeHardeningService — outbox', () => {
  it('emitApiCommandCompleted crea un evento pending con el payload redactado', async () => {
    const { service, outboxModel } = buildService();

    await service.emitApiCommandCompleted({
      tenantId: 't1',
      aggregateType: 'purchase',
      aggregateId: 'p-1',
      eventCode: 'purchase.created',
      payload: { purchaseId: 'p-1', authToken: 'secret-token-value' },
      correlationId: 'corr-1',
    });

    expect(outboxModel.create).toHaveBeenCalledTimes(1);
    const created = callArg<CallArgRecord>(outboxModel.create, 0, 0);
    expect(created.status).toBe('pending');
    expect(created.attempts).toBe(0);
    expect((created.eventPayloadJson as unknown as { authToken: string }).authToken).toBe('[REDACTED]');
  });

  it('listPendingOutbox consulta solo eventos pending disponibles, ordenados FIFO', async () => {
    const { service, outboxModel } = buildService();

    await service.listPendingOutbox(50);

    expect(outboxModel.findAll).toHaveBeenCalledTimes(1);
    const callArgs = callArg<{ where: { status: string }; limit: number; order: unknown[] }>(outboxModel.findAll, 0, 0);
    expect(callArgs.where.status).toBe('pending');
    expect(callArgs.limit).toBe(50);
    expect(callArgs.order).toEqual([
      ['availableAt', 'ASC'],
      ['id', 'ASC'],
    ]);
  });

  it('markOutboxProcessed marca processed e incrementa attempts', async () => {
    const { service } = buildService();
    const save = jest.fn(async (..._args: unknown[]) => undefined);
    const event = { status: 'pending', attempts: 2, processedAt: null, save } as never as Parameters<
      RuntimeHardeningService['markOutboxProcessed']
    >[0];

    await service.markOutboxProcessed(event);

    expect((event as unknown as { status: string }).status).toBe('processed');
    expect((event as unknown as { attempts: number }).attempts).toBe(3);
    expect((event as unknown as { processedAt: Date | null }).processedAt).not.toBeNull();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('markOutboxProcessed trata attempts null/undefined como 0 antes de incrementar', async () => {
    const { service } = buildService();
    const save = jest.fn(async (..._args: unknown[]) => undefined);
    const event = { status: 'pending', attempts: null, processedAt: null, save } as never as Parameters<
      RuntimeHardeningService['markOutboxProcessed']
    >[0];

    await service.markOutboxProcessed(event);

    expect((event as unknown as { attempts: number }).attempts).toBe(1);
  });
});

describe('RuntimeHardeningService.requestHash', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('es determinístico: mismos body/query/params (en cualquier orden de claves) producen el mismo hash', () => {
    const { service } = buildService();
    const hashA = service.requestHash({ b: 2, a: 1 }, { q: 1 }, { id: 'x' });
    const hashB = service.requestHash({ a: 1, b: 2 }, { q: 1 }, { id: 'x' });

    expect(hashA).toBe(hashB);
  });

  it('cuerpos distintos producen hashes distintos (detecta conflicto real de idempotencia)', () => {
    const { service } = buildService();
    const hashA = service.requestHash({ amount: 100 }, {}, {});
    const hashB = service.requestHash({ amount: 200 }, {}, {});

    expect(hashA).not.toBe(hashB);
  });
});
