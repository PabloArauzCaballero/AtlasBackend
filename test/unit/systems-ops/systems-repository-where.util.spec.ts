import { describe, expect, it } from '@jest/globals';
import { Op } from 'sequelize';
import {
  buildActionLogWhere,
  buildDataEntityWhere,
  buildEndpointTextWhere,
  buildStressProfileWhere,
  buildToolWhere,
} from '../../../src/modules/systems-ops/systems-repository-where.util.js';

/**
 * Constructores de `where` de systems-ops (Fase 1.2 — branch coverage): son utils puros con muchos
 * filtros opcionales por spread condicional. Cada función se ejercita con TODOS los filtros y con
 * ninguno, que es lo que cubre ambos lados de cada rama.
 */
/** La lista `Op.or` de la condición `index` dentro de `Op.and`. */
function orDe(where: Record<string, unknown>, index: number): unknown[] {
  const condiciones = (where as Record<symbol, unknown[]>)[Op.and as unknown as symbol];
  return (condiciones[index] as Record<symbol, unknown[]>)[Op.or as unknown as symbol];
}

describe('systems-repository-where.util', () => {
  it('buildEndpointTextWhere: con todos los filtros + búsqueda libre (Op.or sobre 6 columnas, módulo y handler incluidos)', () => {
    const where = buildEndpointTextWhere({
      module: 'auth',
      backendService: 'api',
      status: 'active',
      riskLevel: 'high',
      reviewStatus: 'pending',
      q: 'log',
    } as never) as Record<string, unknown>;
    expect(where).toMatchObject({ module: 'auth', backendService: 'api', status: 'active', riskLevel: 'high', reviewStatus: 'pending' });
    const ramas = orDe(where, 0) as Array<Record<string, unknown>>;
    // El placeholder promete «ruta, módulo o propósito»: módulo y método del controlador tienen que estar.
    expect(ramas.map((rama) => Object.keys(rama)[0])).toEqual([
      'code',
      'fullPath',
      'routeName',
      'businessPurpose',
      'module',
      'handlerName',
    ]);
  });

  it('los comodines del usuario se escapan: `_` y `%` no casan con cualquier cosa', () => {
    const where = buildEndpointTextWhere({ q: 'user_id%' } as never) as Record<string, unknown>;
    expect(orDe(where, 0)[0]).toEqual({ code: { [Op.iLike]: '%user\\_id\\%%' } });
  });

  it('buildEndpointTextWhere: `personalData` suma una condición (PII o campos personales) sin pisar el buscador', () => {
    const conDatos = buildEndpointTextWhere({ q: 'x', personalData: true } as never) as Record<string, unknown>;
    const condiciones = (conDatos as Record<symbol, unknown[]>)[Op.and as unknown as symbol];
    expect(condiciones).toHaveLength(2);
    const personal = condiciones[1] as Record<symbol, unknown[]>;
    expect(personal[Op.or as unknown as symbol][0]).toEqual({ containsPii: true });
    expect(JSON.stringify(personal[Op.or as unknown as symbol][1])).toContain('jsonb_array_length');

    const sinDatos = buildEndpointTextWhere({ personalData: false } as never) as Record<string, unknown>;
    const negado = (sinDatos as Record<symbol, unknown[]>)[Op.and as unknown as symbol][0] as Record<symbol, unknown>;
    expect(Reflect.ownKeys(negado)).toEqual([Op.not]);
  });

  it('buildEndpointTextWhere: sin filtros devuelve un where vacío (sin Op.or)', () => {
    const where = buildEndpointTextWhere({} as never) as Record<string, unknown>;
    expect(Object.keys(where)).toHaveLength(0);
    expect(Reflect.ownKeys(where)).toHaveLength(0);
  });

  it('buildToolWhere: con status + q, y vacío sin nada', () => {
    const full = buildToolWhere({ status: 'active', q: 'redis' } as never) as Record<string, unknown>;
    expect(full).toMatchObject({ status: 'active' });
    const ramas = (full as Record<symbol, Array<Record<string, unknown>>>)[Op.or as unknown as symbol];
    // El placeholder de Herramientas promete «proveedor»: antes sólo se buscaba en código y nombre.
    expect(ramas.map((rama) => Object.keys(rama)[0])).toEqual(['code', 'name', 'provider', 'type']);
    expect(Reflect.ownKeys(buildToolWhere({} as never) as object)).toHaveLength(0);
  });

  it('buildDataEntityWhere: con block/module/status/reviewStatus + q, y vacío sin nada', () => {
    const full = buildDataEntityWhere({
      block: 'ERP_BACKEND',
      module: 'core',
      status: 'active',
      reviewStatus: 'done',
      q: 'customers',
    } as never) as Record<string, unknown>;
    expect(full).toMatchObject({ systemCode: 'ERP_BACKEND', module: 'core', status: 'active', reviewStatus: 'done' });
    // CUATRO ramas y no tres: el esquema entró en la búsqueda cuando el catálogo pasó a contener
    // tres bloques. Con tablas de tres bases distintas, el esquema es justo lo que distingue
    // `atlas_accounting.invoice` de una tabla homónima de otro producto.
    // Y SEIS desde que el buscador promete «módulo u owner»: se buscan también `module` y `dataOwner`.
    const columnas = orDe(full, 0).map((condicion) => Object.keys(condicion as object)[0]);
    expect(columnas).toEqual(['tableName', 'entityName', 'modelName', 'schemaName', 'module', 'dataOwner']);
    expect(Reflect.ownKeys(buildDataEntityWhere({} as never) as object)).toHaveLength(0);
  });

  it('buildDataEntityWhere: `personalData` cubre PII, legal, ubicación y dispositivo', () => {
    const where = buildDataEntityWhere({ personalData: true } as never) as Record<string, unknown>;
    expect(orDe(where, 0)).toEqual([
      { containsPii: true },
      { containsLegalData: true },
      { containsLocationData: true },
      { containsDeviceData: true },
    ]);
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

  it('buildStressProfileWhere: endpointId/status/enabled=false + q, y vacío sin nada', () => {
    const full = buildStressProfileWhere({ endpointId: 'e1', status: 'active', enabled: false, q: 'carga' } as never) as Record<
      string,
      unknown
    >;
    expect(full).toMatchObject({ endpointId: 'e1', status: 'active', isEnabled: false });
    expect((full as Record<symbol, unknown>)[Op.or as unknown as symbol]).toHaveLength(3);
    expect(Reflect.ownKeys(buildStressProfileWhere({} as never) as object)).toHaveLength(0);
  });

  it('buildStressProfileWhere: los endpoints cuya ruta casa entran como cuarta alternativa', () => {
    const where = buildStressProfileWhere({ q: '/loans' } as never, ['9', '10']) as Record<symbol, unknown[]>;
    const alternatives = where[Op.or as unknown as symbol];
    expect(alternatives).toHaveLength(4);
    expect(alternatives).toContainEqual({ endpointId: { [Op.in]: ['9', '10'] } });
  });
});
