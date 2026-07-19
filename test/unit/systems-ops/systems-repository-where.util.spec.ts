import { describe, expect, it } from '@jest/globals';
import { Op } from 'sequelize';
import {
  buildActionLogWhere,
  buildDataEntityWhere,
  buildEndpointTextWhere,
  buildReviewWhere,
  buildStressProfileWhere,
  buildToolWhere,
} from '../../../src/modules/systems-ops/systems-repository-where.util.js';

/**
 * Constructores de `where` de systems-ops (Fase 1.2 — branch coverage): son utils puros con muchos
 * filtros opcionales por spread condicional. Cada función se ejercita con TODOS los filtros y con
 * ninguno, que es lo que cubre ambos lados de cada rama.
 */
describe('systems-repository-where.util', () => {
  it('buildEndpointTextWhere: con todos los filtros + búsqueda libre (Op.or sobre 4 columnas)', () => {
    const where = buildEndpointTextWhere({ module: 'auth', backendService: 'api', status: 'active', riskLevel: 'high', reviewStatus: 'pending', q: 'log' } as never) as Record<string, unknown>;
    expect(where).toMatchObject({ module: 'auth', backendService: 'api', status: 'active', riskLevel: 'high', reviewStatus: 'pending' });
    expect((where as Record<symbol, unknown>)[Op.or as unknown as symbol]).toHaveLength(4);
  });

  it('buildEndpointTextWhere: sin filtros devuelve un where vacío (sin Op.or)', () => {
    const where = buildEndpointTextWhere({} as never) as Record<string, unknown>;
    expect(Object.keys(where)).toHaveLength(0);
    expect(Reflect.ownKeys(where)).toHaveLength(0);
  });

  it('buildToolWhere: con status + q, y vacío sin nada', () => {
    const full = buildToolWhere({ status: 'active', q: 'redis' } as never) as Record<string, unknown>;
    expect(full).toMatchObject({ status: 'active' });
    expect((full as Record<symbol, unknown>)[Op.or as unknown as symbol]).toHaveLength(2);
    expect(Reflect.ownKeys(buildToolWhere({} as never) as object)).toHaveLength(0);
  });

  it('buildDataEntityWhere: con module/status/reviewStatus + q, y vacío sin nada', () => {
    const full = buildDataEntityWhere({ module: 'core', status: 'active', reviewStatus: 'done', q: 'customers' } as never) as Record<string, unknown>;
    expect(full).toMatchObject({ module: 'core', status: 'active', reviewStatus: 'done' });
    expect((full as Record<symbol, unknown>)[Op.or as unknown as symbol]).toHaveLength(3);
    expect(Reflect.ownKeys(buildDataEntityWhere({} as never) as object)).toHaveLength(0);
  });

  describe('buildActionLogWhere', () => {
    it('mapea los 9 filtros opcionales (incluye containsPii=false, que NO debe omitirse)', () => {
      const where = buildActionLogWhere({
        endpointId: 'e1',
        requestId: 'r1',
        correlationId: 'c1',
        method: 'GET',
        statusCode: 500,
        actorType: 'customer',
        module: 'auth',
        riskLevel: 'high',
        containsPii: false,
      } as never) as Record<string, unknown>;
      expect(where).toMatchObject({
        endpointCatalogId: 'e1',
        requestId: 'r1',
        correlationId: 'c1',
        method: 'GET',
        responseStatusCode: 500,
        actorType: 'customer',
        module: 'auth',
        riskLevel: 'high',
        containsPii: false,
      });
      expect(where.occurredAt).toBeUndefined();
    });

    it('rango de fechas: solo from, solo to, y ambos', () => {
      const from = '2026-01-01T00:00:00.000Z';
      const to = '2026-02-01T00:00:00.000Z';
      const onlyFrom = buildActionLogWhere({ from } as never) as Record<string, Record<symbol, unknown>>;
      expect(onlyFrom.occurredAt[Op.gte as unknown as symbol]).toEqual(new Date(from));
      expect(onlyFrom.occurredAt[Op.lte as unknown as symbol]).toBeUndefined();

      const onlyTo = buildActionLogWhere({ to } as never) as Record<string, Record<symbol, unknown>>;
      expect(onlyTo.occurredAt[Op.lte as unknown as symbol]).toEqual(new Date(to));

      const both = buildActionLogWhere({ from, to } as never) as Record<string, Record<symbol, unknown>>;
      expect(both.occurredAt[Op.gte as unknown as symbol]).toEqual(new Date(from));
      expect(both.occurredAt[Op.lte as unknown as symbol]).toEqual(new Date(to));
    });

    it('sin ningún filtro no arma occurredAt ni claves', () => {
      expect(Reflect.ownKeys(buildActionLogWhere({} as never) as object)).toHaveLength(0);
    });
  });

  it('buildReviewWhere: reviewStatus siempre presente; module solo si viene', () => {
    expect(buildReviewWhere({ reviewStatus: 'pending', module: 'auth' } as never)).toMatchObject({ reviewStatus: 'pending', module: 'auth' });
    const noModule = buildReviewWhere({ reviewStatus: 'pending' } as never) as Record<string, unknown>;
    expect(noModule).toMatchObject({ reviewStatus: 'pending' });
    expect(noModule.module).toBeUndefined();
  });

  it('buildStressProfileWhere: endpointId/status/enabled=false + q, y vacío sin nada', () => {
    const full = buildStressProfileWhere({ endpointId: 'e1', status: 'active', enabled: false, q: 'carga' } as never) as Record<string, unknown>;
    expect(full).toMatchObject({ endpointId: 'e1', status: 'active', isEnabled: false });
    expect((full as Record<symbol, unknown>)[Op.or as unknown as symbol]).toHaveLength(3);
    expect(Reflect.ownKeys(buildStressProfileWhere({} as never) as object)).toHaveLength(0);
  });
});
