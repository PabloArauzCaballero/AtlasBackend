import { ConflictException, NotFoundException } from '@nestjs/common';
import { flowRowFor } from '../../src/modules/systems-ops/system-flows.mapper.js';
import { SystemFlowsReviewService } from '../../src/modules/systems-ops/system-flows.review.service.js';
import { motivosDeRevision } from '../../src/modules/systems-ops/system-flows.review.util.js';

/**
 * `systems.flows.review` estaba sembrado y nada lo usaba: lo que el análisis deduce de un flujo no lo
 * confirmaba nadie. Lo que se protege es que la cola sea corta y cierta: sólo riesgo alto con análisis
 * incierto, una recarga nunca pisa una decisión, y una aprobación sobre código viejo no parece vigente.
 */
// Un análisis COMPLETO, con la forma que deja la importación: `mapFlow` lee la cadena para resumirla.
const analisis = (over: Record<string, unknown> = {}) => ({
  status: 'MAPPED',
  chain: [],
  reads: [],
  writes: [],
  errors: [],
  blockCalls: [],
  events: [],
  unknowns: [],
  transactional: false,
  ...over,
});

describe('motivosDeRevision', () => {
  it('fuera de riesgo alto no se pide revisión: una cola de mil flujos no la lee nadie', () => {
    expect(motivosDeRevision({ risk: 'LOW', analysisJson: analisis({ status: 'PARTIAL' }) })).toEqual([]);
    expect(motivosDeRevision({ risk: 'MEDIUM', analysisJson: {} })).toEqual([]);
  });

  it('riesgo alto con análisis incierto dice por qué', () => {
    expect(
      motivosDeRevision({ risk: 'CRITICAL', analysisJson: analisis({ status: 'PARTIAL', unknowns: [{ reason: 'MAX_DEPTH', at: 'a' }] }) }),
    ).toEqual(['ANALISIS_PARCIAL', 'HUECOS_SIN_RESOLVER']);
    expect(motivosDeRevision({ risk: 'HIGH', analysisJson: analisis({ events: [{ code: 'x.*', dynamic: true, at: 'a' }] }) })).toEqual([
      'EVENTO_DINAMICO',
    ]);
    expect(motivosDeRevision({ risk: 'HIGH', analysisJson: {} })).toEqual(['SIN_ANALISIS']);
  });

  it('riesgo alto con análisis completo no va a revisión', () => {
    expect(motivosDeRevision({ risk: 'CRITICAL', analysisJson: analisis() })).toEqual([]);
  });
});

describe('la recarga nunca escribe la revisión humana', () => {
  it('la fila que arma la importación no lleva ningún campo de revisión', () => {
    const fila = flowRowFor(
      'ATLAS_BACKEND',
      {
        method: 'GET',
        path: 'auth/me',
        module: 'auth',
        controller: 'AuthController',
        handler: 'me',
        isPublic: false,
        roles: [],
        internalPermissions: [],
        guards: [],
        callers: [],
        testStatus: 'UNTESTED',
        contractStatus: 'NO_CONTRACT',
      } as never,
      { importId: null },
    );
    expect(Object.keys(fila).filter((clave) => /^review/.test(clave))).toEqual([]);
  });
});

describe('SystemFlowsReviewService', () => {
  const fila = (over: Record<string, unknown> = {}) => ({
    flowId: 'flow_abc123def456',
    path: 'loans',
    risk: 'CRITICAL',
    analysisJson: analisis({ status: 'PARTIAL' }),
    depsHash: 'nuevo',
    reviewStatus: 'NEEDS_REVIEW',
    reviewConfidence: null,
    reviewedAt: null,
    reviewedBy: null,
    reviewedDepsHash: null,
    ...over,
  });
  const actor = { id: 'u1', role: 'internal_operator', tenantId: '1' };

  it('un flujo que no existe es 404, no una revisión en el vacío', async () => {
    const servicio = new SystemFlowsReviewService({ decide: async () => ({ outcome: 'NOT_FOUND' }) } as never);
    await expect(servicio.review('flow_nada', { reviewStatus: 'APPROVED', depsHash: 'x' }, actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('si el código cambió desde que se cargó la cola, 409 y no se decide nada', async () => {
    const servicio = new SystemFlowsReviewService({ decide: async () => ({ outcome: 'CONFLICT', currentDepsHash: 'nuevo' }) } as never);
    await expect(servicio.review('flow_abc123def456', { reviewStatus: 'APPROVED', depsHash: 'viejo' }, actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('aplica la decisión con su actor y devuelve sobre qué código se tomó', async () => {
    const decide = jest.fn(async () => ({ outcome: 'OK', row: { ...fila(), reviewStatus: 'APPROVED', reviewedDepsHash: 'nuevo' } }));
    const servicio = new SystemFlowsReviewService({ decide } as never);
    const resultado = await servicio.review('flow_abc123def456', { reviewStatus: 'APPROVED', depsHash: 'nuevo' }, actor);
    expect(decide).toHaveBeenCalledWith('flow_abc123def456', { reviewStatus: 'APPROVED', depsHash: 'nuevo' }, actor);
    expect(resultado).toMatchObject({ reviewStatus: 'APPROVED', reviewedDepsHash: 'nuevo' });
  });

  it('una decisión tomada sin huella se explica en cuanto la hay: cuenta como código cambiado', async () => {
    const servicio = new SystemFlowsReviewService({
      listQueue: async () => ({ rows: [fila({ reviewedAt: new Date(), reviewedDepsHash: null, analysisJson: analisis() })], count: 1 }),
    } as never);
    const { items } = await servicio.queue({ reviewStatus: 'NEEDS_REVIEW', page: 1, limit: 20 });
    expect(items[0]).toMatchObject({ reasons: [], codeChangedSinceReview: true });
  });

  it('la cola dice el motivo, la huella actual y si el código cambió desde que se revisó', async () => {
    const servicio = new SystemFlowsReviewService({
      listQueue: async () => ({ rows: [fila({ reviewedAt: new Date(), reviewedDepsHash: 'viejo' })], count: 1 }),
    } as never);
    const { items, meta } = await servicio.queue({ reviewStatus: 'NEEDS_REVIEW', page: 1, limit: 20 });
    expect(items[0]).toMatchObject({ reasons: ['ANALISIS_PARCIAL'], depsHash: 'nuevo', codeChangedSinceReview: true });
    expect(meta).toMatchObject({ total: 1, totalPages: 1 });
  });
});
