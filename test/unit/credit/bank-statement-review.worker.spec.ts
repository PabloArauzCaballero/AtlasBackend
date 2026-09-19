import { describe, expect, it, jest } from '@jest/globals';
import { BankStatementReviewWorker } from '../../../src/modules/credit/application/bank-statement-review.worker.js';

/**
 * El trabajo que lee los extractos que el cliente subió y decide qué hacer con cada uno.
 *
 * Lo que se fija son las cuatro decisiones que le dicen algo distinto al cliente según cómo se
 * resuelvan, y ninguna lanza un error si se invierte: rechazar un extracto por una avería NUESTRA
 * —lo que le diría que su documento era inválido—, aplicar una capacidad inelegible —que escribe
 * ceros en su línea y se lee como «no gana nada»—, atender por orden distinto al de llegada, y
 * atribuirle a un operador una revisión que hizo el sistema.
 */

const AHORA = new Date('2026-09-10T12:00:00.000Z');

/**
 * El worker ESCRIBE sobre la fila y luego la guarda, así que el doble tiene que ser un objeto
 * mutable con índice abierto: las columnas que se rellenan al rechazar o al aparcar no existen
 * hasta que el código las pone.
 */
type FilaRevision = Record<string, unknown> & { save: jest.Mock<() => Promise<undefined>> };

function revision(over: Record<string, unknown> = {}): FilaRevision {
  return {
    id: '10',
    tenantId: '1',
    customerId: '24',
    storageKey: '1/customer-24/bank_statement/x.pdf',
    save: jest.fn(async () => undefined),
    ...over,
  };
}

function corrida(over: Record<string, unknown> = {}) {
  return {
    requestId: 'req-1',
    status: 'COMPLETED',
    errorCode: null,
    reviewReason: null,
    result: {
      institution: { id: 'BNB', name: 'Banco Nacional' },
      authenticity: { verdict: 'CLEAN', suspicionScore: 0 },
      period: { from: '2026-06-01', to: '2026-08-31' },
      affordability: { eligible: true, coverage: { monthsComplete: 3 } },
    },
    ...over,
  };
}

function montar(
  opciones: { pendientes?: Record<string, unknown>[]; archivo?: Buffer | null; analisis?: Record<string, unknown>; enRiesgo?: number } = {},
) {
  const reviews = {
    findAll: jest.fn(async (..._a: unknown[]) => opciones.pendientes ?? []),
    count: jest.fn(async (..._a: unknown[]) => opciones.enRiesgo ?? 0),
  };
  const statements = { applyReview: jest.fn(async (..._a: unknown[]) => undefined) };
  const storage = { readObject: jest.fn(async () => (opciones.archivo === undefined ? Buffer.from('%PDF') : opciones.archivo)) };
  const engine = { analyze: jest.fn(async () => opciones.analisis ?? { kind: 'completed', run: corrida() }) };

  const worker = new BankStatementReviewWorker(reviews as never, statements as never, storage as never, engine as never);
  return { worker, reviews, statements, storage, engine };
}

const correr = (w: BankStatementReviewWorker) => w.processPending({ tenantId: '1', limit: 10, now: AHORA });

describe('BankStatementReviewWorker', () => {
  it('aplica el extracto legible cuya capacidad es utilizable', async () => {
    const { worker, statements } = montar({ pendientes: [revision()] });

    const resultado = await correr(worker);

    expect(resultado).toMatchObject({ picked: 1, applied: 1, unreadable: 0, inReview: 0, failed: 0 });
    /* Sin usuario interno: lo revisó el sistema. Atribuírselo a alguien falsearía la trazabilidad. */
    expect(statements.applyReview.mock.calls[0][0]).toMatchObject({ reviewedByInternalUserId: null, customerId: '24' });
  });

  /*
   * Si el objeto no está o el almacén no responde, el problema es NUESTRO. Rechazar le diría al
   * cliente que su extracto era inválido; se deja en cola y la pasada siguiente lo reintenta.
   */
  it('no rechaza por una avería de infraestructura: lo deja en cola', async () => {
    const fila = revision();
    const { worker, statements } = montar({ pendientes: [fila], archivo: null });

    const resultado = await correr(worker);

    expect(resultado).toMatchObject({ failed: 1, unreadable: 0 });
    expect(fila.save).not.toHaveBeenCalled();
    expect(statements.applyReview).not.toHaveBeenCalled();
  });

  it('tampoco rechaza si el motor no respondió', async () => {
    const fila = revision();
    const { worker } = montar({ pendientes: [fila], analisis: { kind: 'engineUnavailable', reason: 'ECONNREFUSED' } });

    expect(await correr(worker)).toMatchObject({ failed: 1, unreadable: 0 });
    expect(fila.save).not.toHaveBeenCalled();
  });

  /* Sin objeto declarado no hay nada que leer, y eso sí es del documento: se cierra como ilegible. */
  it('cierra como ilegible la revisión que no tiene objeto', async () => {
    const fila = revision({ storageKey: null });
    const { worker } = montar({ pendientes: [fila] });

    expect(await correr(worker)).toMatchObject({ unreadable: 1 });
    expect(fila.status).toBe('rejected');
    expect(fila.rejectionMessage).toBeTruthy();
    expect(fila.rejectionCategory).toBeTruthy();
  });

  it('el rechazo del motor guarda código, categoría y la frase que lee el cliente', async () => {
    const fila = revision();
    const { worker } = montar({
      pendientes: [fila],
      analisis: { kind: 'rejected', run: corrida({ errorCode: 'STATEMENT_PERIOD_TOO_SHORT', status: 'REJECTED' }) },
    });

    await correr(worker);

    expect(fila.status).toBe('rejected');
    expect(fila.rejectionCategory).toBeTruthy();
    expect(fila.rejectionMessage).toBeTruthy();
    expect(fila.engineRequestId).toBe('req-1');
  });

  /*
   * Un análisis aceptado pero con capacidad inelegible NO se aplica: escribiría ceros en la línea
   * del cliente, y «un ingreso reconocido de cero» se lee como «no gana nada». Se aparca.
   */
  it('aparca en revisión el análisis cuya capacidad no es utilizable', async () => {
    const fila = revision();
    const { worker, statements } = montar({
      pendientes: [fila],
      analisis: { kind: 'completed', run: corrida({ result: { ...corrida().result, affordability: { eligible: false } } }) },
    });

    const resultado = await correr(worker);

    expect(resultado).toMatchObject({ inReview: 1, applied: 0 });
    expect(fila.status).toBe('processing');
    expect(statements.applyReview).not.toHaveBeenCalled();
  });

  it('aparca igual si el motor no devolvió capacidad alguna', async () => {
    const fila = revision();
    const { worker } = montar({
      pendientes: [fila],
      analisis: { kind: 'completed', run: corrida({ result: { institution: { id: 'BNB' } } }) },
    });

    expect(await correr(worker)).toMatchObject({ inReview: 1, applied: 0 });
  });

  /*
   * Lo que el motor observó se guarda también en el rechazo y en la revisión: es lo que permite
   * después preguntar «¿de qué bancos llegan los documentos que no sabemos leer?», que es con lo
   * que se decide qué analizador escribir a continuación.
   */
  it('guarda lo observado por el motor aunque el extracto no se aplique', async () => {
    const fila = revision();
    const { worker } = montar({
      pendientes: [fila],
      analisis: { kind: 'review', run: corrida({ reviewReason: 'COBERTURA_PARCIAL' }) },
    });

    await correr(worker);

    expect(fila.institutionCode).toBe('BNB');
    expect(fila.institutionName).toBe('Banco Nacional');
    expect(fila.authenticityVerdict).toBe('CLEAN');
    expect(fila.periodFrom).toBe('2026-06-01');
    expect(fila.monthsComplete).toBe(3);
    expect(fila.reviewReason).toBe('COBERTURA_PARCIAL');
  });

  /*
   * Por orden de llegada: el más antiguo tiene menos plazo restante, y es lo único que evita que un
   * pico de subidas deje a los primeros esperando indefinidamente.
   */
  it('atiende el más antiguo primero y respeta el límite del lote', async () => {
    const { worker, reviews } = montar({ pendientes: [] });

    await worker.processPending({ tenantId: '1', limit: 5, now: AHORA });

    const consulta = reviews.findAll.mock.calls[0][0] as unknown as { order: unknown; limit: number; where: Record<string, unknown> };
    expect(consulta.order).toEqual([['_created_at', 'ASC']]);
    expect(consulta.limit).toBe(5);
    expect(consulta.where.status).toBe('received');
  });

  /* Un extracto que revienta no puede llevarse por delante los demás del lote. */
  it('un fallo en uno no detiene el lote', async () => {
    const bueno = revision({ id: '11' });
    const malo = revision({ id: '12' });
    const { worker, storage } = montar({ pendientes: [malo, bueno] });
    storage.readObject.mockRejectedValueOnce(new Error('almacén caído') as never);

    const resultado = await correr(worker);

    expect(resultado).toMatchObject({ picked: 2, failed: 1, applied: 1 });
  });

  /* Un compromiso que se incumple en silencio es indistinguible de uno que nunca se hizo. */
  it('cuenta los compromisos que van a vencer, sin resolverlos', async () => {
    const { worker, reviews } = montar({ pendientes: [], enRiesgo: 4 });

    const resultado = await correr(worker);

    expect(resultado.breachingSoon).toBe(4);
    const consulta = reviews.count.mock.calls[0][0] as unknown as { where: { status: string[] } };
    expect(consulta.where.status).toEqual(['received', 'processing']);
  });
});
