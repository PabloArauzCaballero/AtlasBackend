/**
 * @file Verifica que los avisos de pago (inicial y de cuota) respetan `x-idempotency-key` de punta a punta.
 * @business Un doble toque o un reintento por mala red no puede crear dos avisos ni devolver un 409 engañoso;
 *   y la misma clave con OTRO importe no puede colarse como si fuera el reintento del primero.
 * @system Interceptor global + `RuntimeHardeningService` + `IdempotencyClaimStore` REALES sobre una tabla en memoria;
 *   sólo el handler (el servicio de dominio) es un doble que cuenta cuántas veces se ejecutó.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { firstValueFrom, defer } from 'rxjs';
import { IdempotencyInterceptor } from '../../../src/modules/runtime-hardening/idempotency.interceptor.js';
import { IdempotencyClaimStore } from '../../../src/modules/runtime-hardening/infrastructure/idempotency-claim.store.js';
import { RuntimeHardeningService } from '../../../src/modules/runtime-hardening/runtime-hardening.service.js';

type Fila = Record<string, unknown> & { id: string };

/** `idempotency_keys` en memoria: lo justo que usan el servicio y el almacén de concesiones en el camino feliz. */
function tablaEnMemoria() {
  const filas: Fila[] = [];
  const casa = (fila: Fila, where: Record<string, unknown>) => Object.entries(where).every(([k, v]) => fila[k] === v);
  return {
    filas,
    findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) => filas.find((f) => casa(f, where)) ?? null),
    create: jest.fn(async (values: Record<string, unknown>) => {
      const fila = { ...values, id: String(filas.length + 1) } as Fila;
      filas.push(fila);
      return fila;
    }),
    update: jest.fn(async (values: Record<string, unknown>, { where }: { where: Record<string, unknown> }) => {
      const afectadas = filas.filter((f) => casa(f, where));
      for (const f of afectadas) Object.assign(f, values);
      return [afectadas.length];
    }),
  };
}

function montar() {
  const tabla = tablaEnMemoria();
  const runtime = new RuntimeHardeningService(tabla as never, {} as never, new IdempotencyClaimStore(tabla as never));
  return { tabla, interceptor: new IdempotencyInterceptor(runtime) };
}

const CLIENTE = { sub: 'u9', role: 'customer', customerId: '9', tenantId: '1' };

function peticion(url: string, body: unknown, clave: string | null) {
  const request = {
    method: 'POST',
    originalUrl: url,
    body,
    query: {},
    params: {},
    headers: clave ? { 'x-idempotency-key': clave } : {},
    user: CLIENTE,
  };
  const response = { statusCode: 200, status: jest.fn() };
  return {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ExecutionContext;
}

/** El handler: cada ejecución es un aviso NUEVO (otro id). Si se ejecuta dos veces, hubo dos avisos. */
function handler() {
  let n = 0;
  const handle = jest.fn(() => defer(async () => ({ claimId: String(++n), status: 'submitted' })));
  return { next: { handle } as unknown as CallHandler, handle };
}

const RUTAS = [
  {
    nombre: 'pago inicial',
    url: '/api/v1/customers/9/credit-applications/70/down-payment',
    cuerpo: { amount: '720.00', storageKey: '1/customer-9/proof-abc.jpg', contentType: 'image/jpeg' },
    otro: { amount: '1.00', storageKey: '1/customer-9/proof-abc.jpg', contentType: 'image/jpeg' },
  },
  {
    nombre: 'aviso de cuota',
    url: '/api/v1/mobile/customers/9/payment-claims',
    cuerpo: { installmentId: '31', amount: '160.00', storageKey: '1/customer-9/proof-x.jpg', contentType: 'image/jpeg' },
    otro: { installmentId: '31', amount: '16.00', storageKey: '1/customer-9/proof-x.jpg', contentType: 'image/jpeg' },
  },
] as const;

describe.each(RUTAS)('x-idempotency-key en el $nombre', ({ url, cuerpo, otro }) => {
  it('misma clave y mismo cuerpo: la MISMA respuesta y el aviso se crea una sola vez', async () => {
    const { interceptor } = montar();
    const { next, handle } = handler();

    const primera = await firstValueFrom(interceptor.intercept(peticion(url, cuerpo, 'k-1'), next));
    const segunda = await firstValueFrom(interceptor.intercept(peticion(url, { ...cuerpo }, 'k-1'), next));

    expect(segunda).toEqual(primera);
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it('misma clave y OTRO cuerpo: 409 IDEMPOTENCY_CONFLICT, sin ejecutar nada', async () => {
    const { interceptor } = montar();
    const { next, handle } = handler();

    await firstValueFrom(interceptor.intercept(peticion(url, cuerpo, 'k-2'), next));
    const error = await firstValueFrom(interceptor.intercept(peticion(url, otro, 'k-2'), next)).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).message).toBe('IDEMPOTENCY_CONFLICT');
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it('claves distintas son operaciones distintas', async () => {
    const { interceptor, tabla } = montar();
    const { next, handle } = handler();

    await firstValueFrom(interceptor.intercept(peticion(url, cuerpo, 'k-3'), next));
    await firstValueFrom(interceptor.intercept(peticion(url, cuerpo, 'k-4'), next));

    expect(handle).toHaveBeenCalledTimes(2);
    expect(tabla.filas.map((f) => f.scope)).toEqual([`POST ${url}`, `POST ${url}`]);
    expect(tabla.filas.every((f) => f.status === 'completed' && f.actorId === '9' && f.tenantScope === '1')).toBe(true);
  });
});
