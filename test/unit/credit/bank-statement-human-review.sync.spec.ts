import { describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { BankStatementHumanReviewSync } from '../../../src/modules/credit/application/bank-statement-human-review.sync.js';

/**
 * A6 · El extracto que el motor mandó a revisión humana.
 *
 * Antes la revisión se quedaba `processing` para siempre: nada releía lo que decidía la persona del
 * motor, y por el índice de una sola revisión abierta el cliente no podía subir otro extracto
 * (`409 BANK_STATEMENT_REVIEW_ALREADY_OPEN`). Lo que se fija aquí es cómo se cierra al releer la
 * ejecución: aplicada si hay capacidad, rechazada con un motivo que la persona puede resolver si no,
 * y SIN tocar nada mientras el motor siga con el caso o no conteste.
 */

const AHORA = new Date('2026-09-27T12:00:00.000Z');

type Fila = Record<string, unknown> & { save: jest.Mock<() => Promise<undefined>> };

function revision(over: Record<string, unknown> = {}): Fila {
  return {
    id: '10',
    tenantId: '1',
    customerId: '24',
    status: 'processing',
    engineRequestId: 'bs-1',
    save: jest.fn(async () => undefined),
    ...over,
  };
}

function corrida(over: Record<string, unknown> = {}) {
  return {
    requestId: 'bs-1',
    status: 'SUCCEEDED',
    errorCode: null,
    errorMessage: null,
    rejectionReason: null,
    reviewReason: 'UNKNOWN_BANK',
    result: {
      institution: { id: 'BNB', name: 'Banco Nacional' },
      affordability: { eligible: true, coverage: { monthsComplete: 3, minimumMonthsRequired: 3 } },
    },
    ...over,
  };
}

function montar(opciones: { aparcadas?: Fila[]; una?: Fila | null; lectura?: unknown } = {}) {
  const reviews = {
    findAll: jest.fn(async (..._a: unknown[]) => opciones.aparcadas ?? []),
    findOne: jest.fn(async (..._a: unknown[]) => (opciones.una === undefined ? revision() : opciones.una)),
  };
  const statements = { applyReview: jest.fn(async (..._a: unknown[]) => undefined) };
  const engine = { readRun: jest.fn(async (..._a: unknown[]) => opciones.lectura ?? { kind: 'run', run: corrida() }) };
  const sync = new BankStatementHumanReviewSync(reviews as never, statements as never, engine as never);
  return { sync, reviews, statements, engine };
}

const porAviso = (sync: BankStatementHumanReviewSync, resolvedByInternalUserId: string | null = null) =>
  sync.syncByEngineRequest({ tenantId: '1', requestId: 'bs-1', resolvedByInternalUserId, now: AHORA });

describe('BankStatementHumanReviewSync', () => {
  it('la persona lo aprobó y hay capacidad: se aplica, atribuido a quien revisó si es de esta base', async () => {
    const fila = revision();
    const { sync, statements, engine } = montar({ una: fila });

    await expect(porAviso(sync, '7')).resolves.toEqual({ applied: true, outcome: 'applied' });

    expect(engine.readRun).toHaveBeenCalledWith('bs-1');
    expect(statements.applyReview).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: '1', customerId: '24', reviewId: '10', reviewedByInternalUserId: '7', now: AHORA }),
    );
  });

  it('aprobado pero sin tres meses completos: se cierra pidiendo el periodo, no se aplica', async () => {
    const fila = revision();
    const { sync, statements } = montar({
      una: fila,
      lectura: {
        kind: 'run',
        run: corrida({ result: { affordability: { eligible: false, coverage: { monthsComplete: 1, minimumMonthsRequired: 3 } } } }),
      },
    });

    await expect(porAviso(sync)).resolves.toEqual({ applied: true, outcome: 'rejected' });

    expect(statements.applyReview).not.toHaveBeenCalled();
    expect(fila.status).toBe('rejected');
    expect(fila.rejectionCategory).toBe('PERIODO_INSUFICIENTE');
    expect(fila.rejectionMessage).toContain('3 meses');
    expect(fila.save).toHaveBeenCalled();
  });

  /*
   * La persona marca «no es un extracto» y el motor guarda SU motivo en `rejectionReason`, con
   * `errorCode` vacío. Sin traducirlo, todo lo que decidiera una persona se diría con la frase más
   * débil aunque hubiera dicho con claridad que era una factura.
   */
  it('marcado como no válido por la persona: se cierra con SU motivo', async () => {
    const fila = revision();
    const { sync } = montar({
      una: fila,
      lectura: { kind: 'run', run: corrida({ status: 'PDF_INVALID', rejectionReason: 'NOT_BANK_STATEMENT', result: null }) },
    });

    await porAviso(sync);

    expect(fila.status).toBe('rejected');
    expect(fila.rejectionCategory).toBe('NO_ES_EXTRACTO');
    expect(fila.engineStatus).toBe('PDF_INVALID');
    expect(fila.engineErrorCode).toBe('NOT_BANK_STATEMENT');
  });

  it('cerrado sin resultado (FAILED) o cancelado: se cierra con la frase débil y el cliente puede subir otro', async () => {
    for (const status of ['FAILED', 'CANCELLED']) {
      const fila = revision();
      const { sync } = montar({ una: fila, lectura: { kind: 'run', run: corrida({ status, result: null }) } });

      await porAviso(sync);

      expect(fila.status).toBe('rejected');
      expect(fila.rejectionCategory).toBe('LECTURA_INSUFICIENTE');
    }
  });

  it('mientras el motor siga con el caso no se toca nada', async () => {
    for (const status of ['PENDING_REVIEW', 'IN_REVIEW', 'QUEUED', 'RUNNING']) {
      const fila = revision();
      const { sync, statements } = montar({ una: fila, lectura: { kind: 'run', run: corrida({ status }) } });

      await expect(porAviso(sync)).resolves.toEqual({ applied: false, outcome: 'waiting' });

      expect(fila.save).not.toHaveBeenCalled();
      expect(statements.applyReview).not.toHaveBeenCalled();
    }
  });

  /* Un motor caído no es un extracto inválido: la revisión sigue abierta y se vuelve a mirar. */
  it('si el motor no contesta, la revisión sigue como estaba', async () => {
    const fila = revision();
    const { sync } = montar({ una: fila, lectura: { kind: 'engineUnavailable', reason: 'ECONNREFUSED' } });

    await expect(porAviso(sync)).resolves.toEqual({ applied: false, outcome: 'engineUnavailable' });
    expect(fila.save).not.toHaveBeenCalled();
  });

  /*
   * El aviso de un extracto que Atlas no subió (el portal del motor, una prueba) o que ya cerró el
   * barrido no es un error: no hay nada que aplicar.
   */
  it('un aviso sin revisión abierta no hace nada y no pregunta al motor', async () => {
    const { sync, engine, reviews } = montar({ una: null });

    await expect(porAviso(sync)).resolves.toEqual({ applied: false, reason: 'SIN_REVISION_ABIERTA' });

    expect(engine.readRun).not.toHaveBeenCalled();
    const consulta = reviews.findOne.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(consulta.where).toMatchObject({ tenantId: '1', engineRequestId: 'bs-1', status: 'processing', deleted: false });
  });

  describe('barrido', () => {
    it('relee sólo las revisiones `processing` con ejecución del motor, las menos tocadas primero y con límite', async () => {
      const { sync, reviews } = montar();

      await sync.syncParked({ tenantId: '1', limit: 5, now: AHORA });

      const consulta = reviews.findAll.mock.calls[0]?.[0] as { where: Record<string, unknown>; order: unknown; limit: number };
      expect(consulta.where).toMatchObject({ tenantId: '1', status: 'processing', deleted: false });
      expect(consulta.where.engineRequestId).toEqual({ [Op.ne]: null });
      expect(consulta.order).toEqual([['_updated_at', 'ASC']]);
      expect(consulta.limit).toBe(5);
    });

    it('cuenta cada desenlace, sin atribuir la revisión a nadie, y un fallo no detiene el lote', async () => {
      const aplicable = revision({ id: '1', engineRequestId: 'a' });
      const pendiente = revision({ id: '2', engineRequestId: 'b' });
      const revienta = revision({ id: '3', engineRequestId: 'c' });
      const invalida = revision({ id: '4', engineRequestId: 'd' });
      const { sync, engine, statements } = montar({ aparcadas: [aplicable, pendiente, revienta, invalida] });
      engine.readRun
        .mockResolvedValueOnce({ kind: 'run', run: corrida() } as never)
        .mockResolvedValueOnce({ kind: 'run', run: corrida({ status: 'IN_REVIEW' }) } as never)
        .mockRejectedValueOnce(new Error('inesperado') as never)
        .mockResolvedValueOnce({ kind: 'run', run: corrida({ status: 'PDF_INVALID', errorCode: 'TAMPERED_DOCUMENT' }) } as never);

      const cuentas = await sync.syncParked({ tenantId: '1', limit: 10, now: AHORA });

      expect(cuentas).toEqual({ applied: 1, rejected: 1, waiting: 1, engineUnavailable: 1 });
      expect(statements.applyReview.mock.calls[0]?.[0]).toMatchObject({ reviewId: '1', reviewedByInternalUserId: null });
      expect(invalida.rejectionCategory).toBe('DOCUMENTO_MANIPULADO');
      expect(pendiente.save).not.toHaveBeenCalled();
    });
  });
});
