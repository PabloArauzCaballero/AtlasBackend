import { describe, expect, it } from '@jest/globals';
import { Op } from 'sequelize';
import { buildReviewFamilyWhere, type ReviewFamily } from '../../../src/modules/systems-ops/systems-review-where.util.js';
import { SystemFlowsReviewRepository } from '../../../src/modules/systems-ops/system-flows.review.repository.js';

/**
 * La cola de revisión del catálogo tenía un «buscador» que era un módulo exacto y sólo se aplicaba a
 * dos de las seis familias: en impactos, columnas y herramientas se ignoraba sin decirlo. Aquí se fija
 * que CADA familia recibe el texto y el módulo, y que el texto se busca en lo que la tabla enseña.
 */
const escape = (value: string) => `'${value.replace(/'/g, "''")}'`;
const FAMILIAS: ReviewFamily[] = [
  'endpoints',
  'data_entities',
  'data_impacts',
  'field_impacts',
  'data_column_impacts',
  'tool_requirements',
];

type Where = Record<symbol, unknown[]>;

/** Aplana un `where` a texto, con las claves símbolo (`Op.*`) y el SQL de los `literal`. */
function dump(value: unknown): string {
  if (value === null || typeof value !== 'object') return String(value);
  if ('val' in value && typeof (value as { val: unknown }).val === 'string') return (value as { val: string }).val;
  return Reflect.ownKeys(value)
    .map((key) => `${String(key)}:${dump((value as Record<string | symbol, unknown>)[key])}`)
    .join(' ');
}
const condiciones = (where: unknown) => (where as Where)[Op.and as unknown as symbol];

describe('buildReviewFamilyWhere', () => {
  it('sin filtros sólo exige el estado de revisión', () => {
    for (const familia of FAMILIAS) {
      expect(condiciones(buildReviewFamilyWhere(familia, { reviewStatus: 'NEEDS_REVIEW' } as never, escape))).toEqual([
        { reviewStatus: 'NEEDS_REVIEW' },
      ]);
    }
  });

  it('el texto y el módulo llegan a las SEIS familias, no sólo a rutas y tablas', () => {
    for (const familia of FAMILIAS) {
      const partes = condiciones(
        buildReviewFamilyWhere(familia, { reviewStatus: 'APPROVED', module: 'loans', q: 'cuota' } as never, escape),
      );
      expect(partes).toHaveLength(3);
    }
  });

  it('rutas: busca en código, ruta, nombre, módulo y método del controlador', () => {
    const [, texto] = condiciones(buildReviewFamilyWhere('endpoints', { reviewStatus: 'NEEDS_REVIEW', q: 'loan' } as never, escape));
    const ramas = (texto as Where)[Op.or as unknown as symbol] as Array<Record<string, unknown>>;
    expect(ramas.map((rama) => Object.keys(rama)[0])).toEqual(['code', 'fullPath', 'routeName', 'module', 'handlerName']);
  });

  it('impactos: busca por la ruta y la tabla a las que apuntan (subconsulta) con el patrón escapado', () => {
    const [, texto] = condiciones(buildReviewFamilyWhere('data_impacts', { reviewStatus: 'NEEDS_REVIEW', q: "o'k_1" } as never, escape));
    const sql = dump(texto);
    expect(sql).toContain('system_endpoint_catalog');
    expect(sql).toContain('system_data_entity_catalog');
    // La comilla se dobla (escape SQL) y el `_` va escapado para ILIKE.
    expect(sql).toContain("'%o''k\\_1%'");
  });

  it('herramientas: busca también en el catálogo de herramientas (código, nombre, proveedor)', () => {
    const [, texto] = condiciones(
      buildReviewFamilyWhere('tool_requirements', { reviewStatus: 'NEEDS_REVIEW', q: 'segip' } as never, escape),
    );
    expect(dump(texto)).toContain('system_tool_catalog');
    expect(dump(texto)).toContain('provider ILIKE');
  });

  it('columnas: el módulo se aplica al de la tabla a la que pertenecen', () => {
    const [, modulo] = condiciones(
      buildReviewFamilyWhere('data_column_impacts', { reviewStatus: 'NEEDS_REVIEW', module: 'loans' } as never, escape),
    );
    expect(dump(modulo)).toContain("module = 'loans'");
    expect(Object.keys(modulo as object)).toEqual(['dataEntityId']);
  });
});

describe('SystemFlowsReviewRepository.listQueue', () => {
  function repo() {
    const calls: Array<Record<string, unknown>> = [];
    const flows = { findAndCountAll: async (options: Record<string, unknown>) => (calls.push(options), { rows: [], count: 0 }) };
    return { repository: new SystemFlowsReviewRepository(flows as never, {} as never), calls };
  }

  it('el buscador llega a ruta, handler, módulo y slug', async () => {
    const { repository, calls } = repo();
    await repository.listQueue({ reviewStatus: 'NEEDS_REVIEW', q: 'loans', page: 1, limit: 20 });
    const where = calls[0]!.where as Record<string | symbol, unknown>;
    const ramas = where[Op.or as unknown as symbol] as Array<Record<string, unknown>>;
    expect(ramas.map((rama) => Object.keys(rama)[0])).toEqual(['path', 'handler', 'module', 'slug']);
    expect(where.reviewStatus).toBe('NEEDS_REVIEW');
  });

  it('sin texto no añade condición de búsqueda', async () => {
    const { repository, calls } = repo();
    await repository.listQueue({ reviewStatus: 'NEEDS_REVIEW', page: 2, limit: 20 });
    const where = calls[0]!.where as Record<string | symbol, unknown>;
    expect(where[Op.or as unknown as symbol]).toBeUndefined();
    expect(calls[0]!.offset).toBe(20);
  });
});
