/**
 * @file AT-037 — el evento técnico HTTP y el evento de dominio son cosas distintas, y así se comportan.
 * @business Un replay de idempotencia no emite un segundo evento de negocio; un rollback no deja evento de
 *   éxito; el evento técnico lleva su marca y no se confunde con un hecho.
 * @system Cadena de interceptores real (idempotencia → outbox técnico) con dobles del runtime, y el
 *   escritor de outbox de dominio con un doble del modelo.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';
import { IdempotencyInterceptor } from '../../../src/modules/runtime-hardening/idempotency.interceptor.js';
import { ApiCommandOutboxInterceptor } from '../../../src/modules/runtime-hardening/outbox.interceptor.js';
import { SequelizeOutboxWriter } from '../../../src/platform/events/sequelize-outbox-writer.js';
import { categoryOf } from '../../../src/platform/events/integration-event.js';

function context(request: Record<string, unknown>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ statusCode: 201 }) }) } as unknown as ExecutionContext;
}

const request = {
  method: 'POST',
  originalUrl: '/api/v1/customers/1/credit-applications',
  headers: { 'x-idempotency-key': 'k1' },
  user: { tenantId: '1', role: 'customer' },
  params: { customerId: '1' },
};

describe('auditoría HTTP vs outbox de dominio (AT-037)', () => {
  it('replay de idempotencia: el interceptor de outbox técnico NO corre y el caso de uso NO se ejecuta', async () => {
    const runtime = {
      claimIdempotency: jest.fn(async () => ({ mode: 'replay', responseBody: { replayed: true }, responseStatus: 201 })),
      emitApiCommandCompleted: jest.fn(async () => undefined),
    };
    const idempotency = new IdempotencyInterceptor(runtime as never);
    const outbox = new ApiCommandOutboxInterceptor(runtime as never);
    const useCase = jest.fn(() => of({ ok: true }));
    // Orden real de app.module: idempotencia envuelve a outbox técnico, que envuelve al handler.
    const inner: CallHandler = { handle: () => outbox.intercept(context(request), { handle: useCase } as never) };
    const body = await firstValueFrom(idempotency.intercept(context(request), inner));
    expect(body).toEqual({ replayed: true });
    expect(useCase).not.toHaveBeenCalled();
    expect(runtime.emitApiCommandCompleted).not.toHaveBeenCalled();
  });

  it('rollback de negocio: no existe evento técnico de éxito', async () => {
    const runtime = { emitApiCommandCompleted: jest.fn(async () => undefined) };
    const outbox = new ApiCommandOutboxInterceptor(runtime as never);
    await expect(
      firstValueFrom(outbox.intercept(context(request), { handle: () => throwError(() => new Error('CUSTOMER_NOT_ELIGIBLE')) } as never)),
    ).rejects.toThrow('CUSTOMER_NOT_ELIGIBLE');
    expect(runtime.emitApiCommandCompleted).not.toHaveBeenCalled();
  });

  it('mutación confirmada + fallo del log técnico: la respuesta es el error (política previa) y no hay duplicación por reintento', async () => {
    const runtime = {
      emitApiCommandCompleted: jest.fn(async () => {
        throw new Error('outbox caído');
      }),
    };
    const outbox = new ApiCommandOutboxInterceptor(runtime as never);
    await expect(firstValueFrom(outbox.intercept(context(request), { handle: () => of({ ok: true }) } as never))).rejects.toThrow(
      'outbox caído',
    );
    // El reintento del cliente con la misma clave recupera por idempotencia (replay), no reejecuta: probado arriba.
  });

  it('el evento técnico se clasifica como technical; el de dominio lo escribe el caso de uso con su agregado', async () => {
    expect(categoryOf({ aggregateType: 'api_command', eventCode: 'post_api_v1_customers_1_credit_applications_completed' })).toBe(
      'technical',
    );
    const created: Record<string, unknown>[] = [];
    const model = {
      create: async (values: Record<string, unknown>) => {
        created.push(values);
        return { id: 5, eventId: 'e-1' };
      },
    };
    const writer = new SequelizeOutboxWriter(model as never, {} as never, () => new Date('2026-09-11T00:00:00.000Z'));
    const appended = await writer.append({
      type: 'credit.application.submitted',
      scope: { kind: 'tenant', tenantId: '1' },
      aggregate: { type: 'credit_application', id: '42', version: 1 },
      payload: { applicationCode: 'CRA-1' },
      producer: 'credit',
    });
    expect(appended).toEqual({ eventId: 'e-1', outboxRowId: '5' });
    expect(created[0]).toMatchObject({ aggregateType: 'credit_application', producer: 'credit', eventFamily: 'domain', schemaVersion: 1 });
    expect(categoryOf(created[0] as never)).toBe('domain');
  });
});
