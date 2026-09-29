import { describe, expect, it } from '@jest/globals';
import { Op } from 'sequelize';
import { buildStressRunWhere, stressConsumerCapabilities } from '../../../src/modules/systems-ops/systems-stress-run.where.util.js';

/**
 * El historial de corridas de estrés aceptaba `environment` y `suiteId` y los IGNORABA: elegir
 * «STAGING» devolvía también las LOCAL. Estas pruebas fijan que cada filtro declarado llega al `where`.
 */
describe('buildStressRunWhere', () => {
  const base = { page: 1, limit: 20 };
  const orOf = (where: unknown) => (where as Record<symbol, unknown>)[Op.or] as Record<string, unknown>[];

  it('sin filtros sólo acota a corridas de estrés (y al tenant si lo hay)', () => {
    expect(buildStressRunWhere(base, null)).toEqual({ jobCode: 'systems_stress_run' });
    expect(buildStressRunWhere(base, 't1')).toEqual({ jobCode: 'systems_stress_run', tenantId: 't1' });
  });

  it('ambiente y perfil se buscan dentro de input_json', () => {
    expect(buildStressRunWhere({ ...base, environment: 'STAGING', profileId: '7' }, null)).toMatchObject({
      inputJson: { environment: 'STAGING', profileId: '7' },
    });
  });

  it('suiteId es el alias obsoleto de profileId; profileId gana si vienen los dos', () => {
    expect(buildStressRunWhere({ ...base, suiteId: '3' }, null)).toMatchObject({ inputJson: { profileId: '3' } });
    expect(buildStressRunWhere({ ...base, suiteId: '3', profileId: '4' }, null)).toMatchObject({ inputJson: { profileId: '4' } });
  });

  it('los estados del portal se traducen a los de la cola durable (PASSED = completed)', () => {
    expect(buildStressRunWhere({ ...base, status: 'PASSED' }, null)).toMatchObject({ status: 'completed' });
    expect(buildStressRunWhere({ ...base, status: 'COMPLETED' }, null)).toMatchObject({ status: 'completed' });
    expect(buildStressRunWhere({ ...base, status: 'FAILED' }, null)).toMatchObject({ status: 'failed' });
  });

  it('la búsqueda mira el código del perfil (escapando comodines) y, si es un número, el n.º de corrida', () => {
    const text = orOf(buildStressRunWhere({ ...base, q: 'PAY_50%' }, null));
    expect(text).toEqual([{ inputJson: { profileCode: { [Op.iLike]: '%PAY\\_50\\%%' } } }]);
    const numeric = orOf(buildStressRunWhere({ ...base, q: '42' }, null));
    expect(numeric).toContainEqual({ id: '42' });
  });
});

describe('stressConsumerCapabilities', () => {
  it('apagado: explica por qué no se ejecutaría', () => {
    const off = stressConsumerCapabilities(false);
    expect(off.consumerEnabled).toBe(false);
    expect(off.disabledReason).toMatch(/apagado/);
  });

  it('encendido: sin motivo', () => {
    expect(stressConsumerCapabilities(true)).toEqual({ consumerEnabled: true, disabledReason: null });
  });
});
