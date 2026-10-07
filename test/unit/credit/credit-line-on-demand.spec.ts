/**
 * @file C1 — un cliente activo sin línea la pide al motor en el momento en que abre la app.
 * @business Antes sólo la calculaba una tarea programada y la persona leía «Todavía estamos calculando tu línea»
 *   durante horas o para siempre. Ahora se decide la primera vez que se mira; si el motor falla se dice.
 * @system `CreditLineService.currentOrRequest` con el modelo y el recálculo dobles.
 */
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, jest } from '@jest/globals';
import { CreditLineService } from '../../../src/modules/credit/application/credit-line.service.js';

function build(opciones: { vigente?: unknown; estado?: string | null; motor?: (_entrada?: unknown) => Promise<unknown> }) {
  const creditLines = { findOne: jest.fn(async () => opciones.vigente ?? null) };
  const customers = {
    findOne: jest.fn(async () => (opciones.estado === null ? null : { id: '42', lifecycleStatus: opciones.estado ?? 'active' })),
  };
  const recalculo = { recalculate: jest.fn(opciones.motor ?? (async (_entrada?: unknown) => ({ id: 'line-1', approvedLimit: '900.00' }))) };
  const service = new CreditLineService(creditLines as never, recalculo as never, customers as never);
  return { service, recalculo };
}

describe('currentOrRequest', () => {
  it('correcto: si ya tiene línea la devuelve y no llama al motor', async () => {
    const { service, recalculo } = build({ vigente: { id: 'line-0' } });
    await expect(service.currentOrRequest('1', '42')).resolves.toEqual({ id: 'line-0' });
    expect(recalculo.recalculate).not.toHaveBeenCalled();
  });

  it('correcto: cliente activo sin línea → se la pide al motor y devuelve el monto que decidió', async () => {
    const { service, recalculo } = build({});
    await expect(service.currentOrRequest('1', '42')).resolves.toMatchObject({ approvedLimit: '900.00' });
    expect(recalculo.recalculate).toHaveBeenCalledWith({ tenantId: '1', customerId: '42', trigger: 'onboarding' });
  });

  it('límite: dos aperturas a la vez comparten UNA sola llamada al motor', async () => {
    let soltar: (v: unknown) => void = () => undefined;
    const { service, recalculo } = build({ motor: () => new Promise((resolve) => (soltar = resolve)) });
    const a = service.currentOrRequest('1', '42');
    const b = service.currentOrRequest('1', '42');
    await Promise.resolve();
    await Promise.resolve();
    soltar({ id: 'line-1' });
    await expect(Promise.all([a, b])).resolves.toEqual([{ id: 'line-1' }, { id: 'line-1' }]);
    expect(recalculo.recalculate).toHaveBeenCalledTimes(1);
  });

  it('límite: tras un fallo del motor no se insiste en cada apertura durante la pausa', async () => {
    const { service, recalculo } = build({ motor: async () => null });
    await expect(service.currentOrRequest('1', '42')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service.currentOrRequest('1', '42')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(recalculo.recalculate).toHaveBeenCalledTimes(1);
  });

  it('inválido: motor caído (lanza) → 503 CREDIT_LINE_ENGINE_UNAVAILABLE, nunca un 500', async () => {
    const { service } = build({ motor: async () => Promise.reject(new Error('timeout')) });
    await expect(service.currentOrRequest('1', '42')).rejects.toThrow('CREDIT_LINE_ENGINE_UNAVAILABLE');
  });

  it.each([['onboarding'], ['blocked'], [null]])(
    'inválido: cliente %p (no activo o inexistente) → 404 y no se llama al motor',
    async (estado) => {
      const { service, recalculo } = build({ estado });
      await expect(service.currentOrRequest('1', '42')).rejects.toBeInstanceOf(NotFoundException);
      expect(recalculo.recalculate).not.toHaveBeenCalled();
    },
  );
});
