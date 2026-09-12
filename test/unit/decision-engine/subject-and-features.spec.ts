import { describe, expect, it, jest } from '@jest/globals';
import { env } from '../../../src/config/env.js';
import { FeatureProjectionService } from '../../../src/modules/decision-engine/feature-projection.service.js';
import { SubjectReferenceService } from '../../../src/modules/decision-engine/subject-reference.service.js';

/**
 * El puente entre el cliente del core y el sujeto opaco que ve el motor.
 *
 * Dos propiedades que no se pueden perder: la referencia es ESTABLE (si cambia, la historia del
 * cliente en el motor se parte y no se puede recomponer) y es DISTINTA por tenant y por propósito
 * (si no, resolver referencias de crédito entregaría de paso las de otro uso).
 */
describe('SubjectReferenceService', () => {
  function build() {
    const rows: Record<string, unknown>[] = [];
    const linkModel = {
      findOne: jest.fn(async (..._args: unknown[]) => rows[0] ?? null),
      create: jest.fn(async (values: unknown) => {
        rows.push(values as Record<string, unknown>);
        return values;
      }),
    };
    return { service: new SubjectReferenceService(linkModel as never), linkModel, rows };
  }

  /*
   * La sal se fija AQUÍ y no se lee del entorno de la máquina. Estas pruebas comprueban las dos
   * propiedades de las que depende que exista historia en el motor; saltarlas cuando falta una
   * variable de entorno dejaría la batería en verde sin haber comprobado nada, que es peor que no
   * tenerlas.
   */
  const mutableEnv = env as { DECISION_ENGINE_SUBJECT_SALT?: string };
  const originalSalt = mutableEnv.DECISION_ENGINE_SUBJECT_SALT;

  beforeEach(() => {
    mutableEnv.DECISION_ENGINE_SUBJECT_SALT = 'sal-de-prueba-larga-y-unica';
  });

  afterAll(() => {
    mutableEnv.DECISION_ENGINE_SUBJECT_SALT = originalSalt;
  });

  it('deriva la misma referencia para el mismo cliente, siempre', () => {
    const { service } = build();
    expect(service.derive('1', 'c1')).toBe(service.derive('1', 'c1'));
  });

  it('separa por tenant y por propósito', () => {
    const { service } = build();
    expect(service.derive('1', 'c1')).not.toBe(service.derive('2', 'c1'));
    expect(service.derive('1', 'c1', 'fraud_screening')).not.toBe(service.derive('1', 'c1', 'credit_underwriting'));
  });

  it('no filtra el identificador del cliente en claro', () => {
    const { service } = build();
    const reference = service.derive('1', '987654');
    expect(reference).not.toContain('987654');
    expect(reference).toMatch(/^[0-9a-f]{64}$/);
  });

  it('cuenta las decisiones de un sujeto que vuelve', async () => {
    const { service, rows } = build();
    await service.register({ tenantId: '1', customerId: 'c1' });
    expect(rows[0].decisionCount).toBe(1);

    rows[0].save = jest.fn();
    await service.register({ tenantId: '1', customerId: 'c1' });
    expect(rows[0].decisionCount).toBe(2);
  });

  it('se niega a derivar sin sal configurada', () => {
    const { service } = build();
    mutableEnv.DECISION_ENGINE_SUBJECT_SALT = undefined;
    // Derivar sin sal produciría referencias distintas en cada despliegue: mejor fallar que partir
    // la historia del cliente en trozos que ya no se pueden volver a unir.
    expect(() => service.derive('1', 'c1')).toThrow(/SUBJECT_SALT/);
  });
});

/**
 * Proyección del feature store como variables del motor.
 *
 * Lo que se comprueba es que el GOBIERNO del catálogo se respeta entero: las variables que la
 * normativa de crédito justo prohíbe usar al decidir no pueden llegar al motor, y las que se
 * excluyen tienen que informarse — un filtro silencioso se lee como «no había dato».
 */
describe('FeatureProjectionService', () => {
  function definition(overrides: Record<string, unknown>) {
    return {
      id: 'd1',
      featureCode: 'ingresos_mensuales',
      isActive: true,
      allowedForCreditDecision: true,
      legalReviewStatus: 'approved',
      prohibitedReasonCode: null,
      ...overrides,
    };
  }

  function value(overrides: Record<string, unknown>) {
    return {
      id: 'v1',
      featureDefinitionId: 'd1',
      valueText: null,
      valueNumber: null,
      valueBoolean: null,
      valueJson: null,
      derivationVersion: 'v3',
      ...overrides,
    };
  }

  function build(definitions: unknown[], values: unknown[]) {
    const definitionModel = { findAll: jest.fn(async (..._args: unknown[]) => definitions) };
    const valueModel = { findAll: jest.fn(async (..._args: unknown[]) => values) };
    return new FeatureProjectionService(definitionModel as never, valueModel as never);
  }

  const asOf = new Date('2026-08-11T00:00:00Z');

  it('proyecta el valor en la columna de su tipo', async () => {
    const service = build(
      [
        definition({ id: 'd1', featureCode: 'ingresos' }),
        definition({ id: 'd2', featureCode: 'tiene_mora' }),
        definition({ id: 'd3', featureCode: 'segmento' }),
      ],
      [
        value({ id: 'v1', featureDefinitionId: 'd1', valueNumber: '8000.0000' }),
        value({ id: 'v2', featureDefinitionId: 'd2', valueBoolean: false }),
        value({ id: 'v3', featureDefinitionId: 'd3', valueText: 'micro' }),
      ],
    );

    const projected = await service.projectForCustomer('1', 'c1', asOf);
    expect(projected.variables).toEqual({ ingresos: 8000, tiene_mora: false, segmento: 'micro' });
  });

  it('no confunde un `false` con la ausencia de valor', async () => {
    const service = build([definition({ featureCode: 'tiene_mora' })], [value({ valueBoolean: false })]);
    const projected = await service.projectForCustomer('1', 'c1', asOf);
    expect(projected.variables.tiene_mora).toBe(false);
    expect(Object.keys(projected.variables)).toContain('tiene_mora');
  });

  it('NO envía una feature prohibida para decidir crédito, y dice por qué', async () => {
    const service = build(
      [definition({ featureCode: 'edad', allowedForCreditDecision: false, prohibitedReasonCode: 'ECOA_PROHIBITED' })],
      [value({ valueNumber: '34' })],
    );

    const projected = await service.projectForCustomer('1', 'c1', asOf);
    expect(projected.variables).toEqual({});
    expect(projected.excluded).toEqual([{ featureCode: 'edad', reason: 'ECOA_PROHIBITED' }]);
  });

  it('tampoco envía una feature sin revisión legal aprobada', async () => {
    const service = build([definition({ featureCode: 'huella_dispositivo', legalReviewStatus: 'pending' })], [value({ valueText: 'abc' })]);

    const projected = await service.projectForCustomer('1', 'c1', asOf);
    expect(projected.variables).toEqual({});
    expect(projected.excluded[0].reason).toBe('LEGAL_REVIEW_PENDING');
  });

  it('se queda con el valor vigente cuando hay varios del mismo código', async () => {
    // La consulta llega ordenada por fecha descendente: la primera aparición es la actual.
    const service = build(
      [definition({ featureCode: 'ingresos' })],
      [value({ id: 'nuevo', valueNumber: '9000' }), value({ id: 'viejo', valueNumber: '5000' })],
    );

    const projected = await service.projectForCustomer('1', 'c1', asOf);
    expect(projected.variables.ingresos).toBe(9000);
    expect(projected.lineage).toEqual([{ featureCode: 'ingresos', featureValueId: 'nuevo', derivationVersion: 'v3' }]);
  });

  it('deja constancia del linaje de lo que sí se envió', async () => {
    const service = build([definition({ featureCode: 'ingresos' })], [value({ valueNumber: '8000' })]);
    const projected = await service.projectForCustomer('1', 'c1', asOf);
    expect(projected.lineage).toHaveLength(1);
    expect(projected.lineage[0].featureValueId).toBe('v1');
  });
});
