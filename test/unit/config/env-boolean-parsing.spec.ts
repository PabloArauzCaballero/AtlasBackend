/**
 * @file FND-CORE-01 — los booleanos que llegan como TEXTO se parsean de forma estricta.
 * @business `z.coerce.boolean()` es `Boolean(valor)`: el texto `"false"` salía `true`. En el entorno
 *   encendía el consumidor de estrés con la variable en false; en una query invertía el filtro
 *   (`?assignedToMe=false` devolvía sólo los casos del actor) sin un solo error.
 * @system Unitaria sobre los esquemas reales: el entorno completo, el primitivo de query y dos
 *   esquemas de módulo que lo usan (filtro de query y body JSON).
 */
import { describe, expect, it } from '@jest/globals';
import { queryBooleanSchema } from '../../../src/common/pipes/query-boolean.schema.js';
import { envBaseSchema } from '../../../src/config/env.schema.js';
import { listCasesQuerySchema } from '../../../src/modules/support/support-case.schemas.js';
import { queueStressRunSchema, systemsSuiteQuerySchema } from '../../../src/modules/systems-ops/systems-ops.schemas.js';

describe('booleano de entorno: RUNTIME_JOBS_STRESS_CONSUMER_ENABLED', () => {
  const parse = (value: string | undefined) => envBaseSchema.shape.RUNTIME_JOBS_STRESS_CONSUMER_ENABLED.safeParse(value);

  it.each(['false', '0', '', ' FALSE '])('%j → false: el consumidor queda apagado', (value) => {
    expect(parse(value)).toMatchObject({ success: true, data: false });
  });

  it('ausente → false (apagado por defecto)', () => {
    expect(parse(undefined)).toMatchObject({ success: true, data: false });
  });

  it.each(['true', '1'])('%j → true', (value) => {
    expect(parse(value)).toMatchObject({ success: true, data: true });
  });

  it('un valor mal escrito rompe el arranque en vez de encender la carga', () => {
    expect(parse('FALSO').success).toBe(false);
  });
});

describe('booleano de query: queryBooleanSchema', () => {
  it.each([
    ['false', false],
    ['0', false],
    ['true', true],
    ['1', true],
    [' True ', true],
  ])('%j → %s', (value, expected) => {
    expect(queryBooleanSchema.safeParse(value)).toMatchObject({ success: true, data: expected });
  });

  it.each(['yes', '', 'no', 'FALSO', '2'])('%j → error de validación (400), nunca un valor adivinado', (value) => {
    expect(queryBooleanSchema.safeParse(value).success).toBe(false);
  });

  it('un parámetro repetido (?x=true&x=false llega como arreglo) se rechaza', () => {
    expect(queryBooleanSchema.safeParse(['true', 'false']).success).toBe(false);
  });

  it('respeta .optional() y .default(): ausente no es false', () => {
    expect(queryBooleanSchema.optional().parse(undefined)).toBeUndefined();
    expect(queryBooleanSchema.default(true).parse(undefined)).toBe(true);
  });
});

describe('esquemas de módulo', () => {
  it('?assignedToMe=false filtra como false, no como true', () => {
    expect(listCasesQuerySchema.parse({ assignedToMe: 'false' }).assignedToMe).toBe(false);
    expect(listCasesQuerySchema.parse({ assignedToMe: 'true' }).assignedToMe).toBe(true);
    expect(listCasesQuerySchema.parse({}).assignedToMe).toBeUndefined();
  });

  it('?enabled=0 en el listado de suites se lee como false', () => {
    expect(systemsSuiteQuerySchema.parse({ enabled: '0' }).enabled).toBe(false);
  });

  it('en un body JSON el booleano llega tipado: el texto "false" se rechaza en vez de leerse true', () => {
    expect(queueStressRunSchema.shape.dryRun.parse(false)).toBe(false);
    expect(queueStressRunSchema.shape.dryRun.parse(undefined)).toBe(true);
    expect(queueStressRunSchema.shape.dryRun.safeParse('false').success).toBe(false);
  });
});
