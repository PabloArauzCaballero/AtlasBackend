import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { ConflictException } from '@nestjs/common';
import { UniqueConstraintError } from 'sequelize';
import { RuntimeHardeningService } from '../../../src/modules/runtime-hardening/runtime-hardening.service.js';

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
    findOne: jest.fn(),
    create: jest.fn(async (values: Record<string, unknown>) => ({ ...values, save: jest.fn(async () => undefined) })),
  };
}

function buildOutboxModelMock() {
  return {
    create: jest.fn(async (values: Record<string, unknown>) => ({ ...values, save: jest.fn(async () => undefined) })),
    findAll: jest.fn(async () => []),
  };
}

function buildService(idempotencyModel = buildIdempotencyModelMock(), outboxModel = buildOutboxModelMock()) {
  return { service: new RuntimeHardeningService(idempotencyModel as never, outboxModel as never), idempotencyModel, outboxModel };
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
      requestHash: 'hash-1',
      now: NOW,
    });

    expect(result.mode).toBe('execute');
    expect(idempotencyModel.create).toHaveBeenCalledTimes(1);
    const created = idempotencyModel.create.mock.calls[0][0] as Record<string, unknown>;
    expect(created.status).toBe('processing');
    expect(created.lockedUntil).toEqual(new Date(NOW.getTime() + 5 * 60_000));
  });

  it('ATLAS-AUDIT (auditoría #22, runtime-hardening): carrera bajo la misma idempotencyKey — el findOne inicial no la ve, el create choca con el índice único, se recupera como si ya existiera en vez de propagar un 500', async () => {
    const { service, idempotencyModel } = buildService();
    idempotencyModel.findOne.mockResolvedValueOnce(null);
    idempotencyModel.create.mockRejectedValueOnce(new UniqueConstraintError({}));
    const winner = { requestHash: 'hash-1', status: 'processing', lockedUntil: new Date(NOW.getTime() + 60_000), save: jest.fn(async () => undefined) };
    idempotencyModel.findOne.mockResolvedValueOnce(winner as never);

    await expect(
      service.claimIdempotency({
        tenantScope: 't1',
        actorType: 'customer',
        actorId: 'cust-1',
        idempotencyKey: 'idem-abc',
        scope: 'purchases.create',
        requestHash: 'hash-1',
        now: NOW,
      }),
    ).rejects.toThrow(/IDEMPOTENCY_REQUEST_IN_PROGRESS/);
    expect(idempotencyModel.findOne).toHaveBeenCalledTimes(2);
  });

  it('registro existente con requestHash distinto: SIEMPRE lanza IDEMPOTENCY_CONFLICT, sin importar el estado', async () => {
    const { service, idempotencyModel } = buildService();
    idempotencyModel.findOne.mockResolvedValueOnce({ requestHash: 'hash-original', status: 'completed' });

    await expect(
      service.claimIdempotency({
        tenantScope: 't1',
        actorType: 'customer',
        actorId: 'cust-1',
        idempotencyKey: 'idem-abc',
        scope: 'purchases.create',
        requestHash: 'hash-DIFERENTE',
        now: NOW,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('registro completado con mismo requestHash: devuelve mode=replay con la respuesta guardada (no reejecuta el caso de uso)', async () => {
    const { service, idempotencyModel } = buildService();
    idempotencyModel.findOne.mockResolvedValueOnce({
      requestHash: 'hash-1',
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
      requestHash: 'hash-1',
      now: NOW,
    });

    expect(result).toEqual({ mode: 'replay', responseBody: { purchaseId: 'p-1' }, responseStatus: 201 });
  });

  it('registro "processing" con lock vigente: lanza IDEMPOTENCY_REQUEST_IN_PROGRESS (evita doble ejecución concurrente)', async () => {
    const { service, idempotencyModel } = buildService();
    idempotencyModel.findOne.mockResolvedValueOnce({
      requestHash: 'hash-1',
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
        requestHash: 'hash-1',
        now: NOW,
      }),
    ).rejects.toThrow('IDEMPOTENCY_REQUEST_IN_PROGRESS');
  });

  it('registro "processing" con lock YA vencido: se reclama de nuevo (recupera de un worker/proceso caído) y devuelve mode=execute', async () => {
    const { service, idempotencyModel } = buildService();
    const save = jest.fn(async () => undefined);
    const existing = {
      requestHash: 'hash-1',
      status: 'processing',
      lockedUntil: new Date(NOW.getTime() - 60_000), // vencido
      save,
    };
    idempotencyModel.findOne.mockResolvedValueOnce(existing);

    const result = await service.claimIdempotency({
      tenantScope: 't1',
      actorType: 'customer',
      actorId: 'cust-1',
      idempotencyKey: 'idem-abc',
      scope: 'purchases.create',
      requestHash: 'hash-1',
      now: NOW,
    });

    expect(result.mode).toBe('execute');
    expect(existing.status).toBe('processing');
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe('RuntimeHardeningService.completeIdempotency / failIdempotency', () => {
  it('completeIdempotency marca completed, guarda el status HTTP y redacta el response body sensible', async () => {
    const { service } = buildService();
    const save = jest.fn(async () => undefined);
    const record = {
      status: 'processing',
      responseStatus: null,
      responseBodyJson: null,
      lockedUntil: new Date(),
      completedAt: null,
      save,
    } as never as Parameters<RuntimeHardeningService['completeIdempotency']>[0];

    await service.completeIdempotency(record, 201, { purchaseId: 'p-1', customerPhone: '77712345' });

    expect((record as unknown as { status: string }).status).toBe('completed');
    expect((record as unknown as { responseStatus: number }).responseStatus).toBe(201);
    expect((record as unknown as { lockedUntil: null }).lockedUntil).toBeNull();
    // `phone` matchea el patrón de campos sensibles de redaction.util.ts → debe quedar redactado.
    expect((record as unknown as { responseBodyJson: { customerPhone: string } }).responseBodyJson.customerPhone).toBe('[REDACTED]');
    expect((record as unknown as { responseBodyJson: { purchaseId: string } }).responseBodyJson.purchaseId).toBe('p-1');
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('failIdempotency marca failed y libera el lock (permite reintento)', async () => {
    const { service } = buildService();
    const save = jest.fn(async () => undefined);
    const record = { status: 'processing', lockedUntil: new Date(), save } as never as Parameters<
      RuntimeHardeningService['failIdempotency']
    >[0];

    await service.failIdempotency(record);

    expect((record as unknown as { status: string }).status).toBe('failed');
    expect((record as unknown as { lockedUntil: null }).lockedUntil).toBeNull();
    expect(save).toHaveBeenCalledTimes(1);
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
    const created = outboxModel.create.mock.calls[0][0] as Record<string, unknown>;
    expect(created.status).toBe('pending');
    expect(created.attempts).toBe(0);
    expect((created.eventPayloadJson as { authToken: string }).authToken).toBe('[REDACTED]');
  });

  it('listPendingOutbox consulta solo eventos pending disponibles, ordenados FIFO', async () => {
    const { service, outboxModel } = buildService();

    await service.listPendingOutbox(50);

    expect(outboxModel.findAll).toHaveBeenCalledTimes(1);
    const callArgs = outboxModel.findAll.mock.calls[0][0] as { where: { status: string }; limit: number; order: unknown[] };
    expect(callArgs.where.status).toBe('pending');
    expect(callArgs.limit).toBe(50);
    expect(callArgs.order).toEqual([
      ['availableAt', 'ASC'],
      ['id', 'ASC'],
    ]);
  });

  it('markOutboxProcessed marca processed e incrementa attempts', async () => {
    const { service } = buildService();
    const save = jest.fn(async () => undefined);
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
    const save = jest.fn(async () => undefined);
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
