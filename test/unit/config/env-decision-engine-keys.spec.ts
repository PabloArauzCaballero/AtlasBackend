import { describe, expect, it } from '@jest/globals';
import { z } from 'zod';
import { decisionEngineEnvShape } from '../../../src/config/env.decision-engine.schema.js';

/**
 * Una clave del Motor que llega VACÍA cuenta como no configurada.
 *
 * Coolify entrega `''` cuando la variable se borra pero el compose la sigue declarando
 * (`${DECISION_ENGINE_STATEMENT_API_KEY:-}`), y los clientes caen a la de respaldo con `??`, que no salta con `''`. Medido
 * en TEST el 2026-10-04: tras quitar la clave de extractos, el worker decía «El motor de extractos no está configurado»
 * aunque la de gobierno estaba puesta, y la línea de crédito no se calculaba.
 */
const CLAVES = [
  'DECISION_ENGINE_API_KEY',
  'DECISION_ENGINE_OUTCOME_API_KEY',
  'DECISION_ENGINE_GOVERNANCE_API_KEY',
  'DECISION_ENGINE_AUDIO_API_KEY',
  'DECISION_ENGINE_STATEMENT_API_KEY',
] as const;

const esquema = z.object(Object.fromEntries(CLAVES.map((clave) => [clave, decisionEngineEnvShape[clave]])));
const parse = (valores: Record<string, string>) => esquema.parse(valores) as Record<string, unknown>;

describe('claves del Motor vacías', () => {
  it.each(CLAVES)('%s vacía o con espacios queda sin configurar', (clave) => {
    expect(parse({ [clave]: '' })[clave]).toBeUndefined();
    expect(parse({ [clave]: '   ' })[clave]).toBeUndefined();
  });

  it('una clave con valor se conserva tal cual', () => {
    expect(parse({ DECISION_ENGINE_STATEMENT_API_KEY: 'k'.repeat(48) }).DECISION_ENGINE_STATEMENT_API_KEY).toBe('k'.repeat(48));
  });

  it('la clave de extractos vacía cae a la de gobierno con el `??` del cliente', () => {
    const env = parse({ DECISION_ENGINE_STATEMENT_API_KEY: '', DECISION_ENGINE_GOVERNANCE_API_KEY: 'gobierno' });
    expect(env.DECISION_ENGINE_STATEMENT_API_KEY ?? env.DECISION_ENGINE_GOVERNANCE_API_KEY).toBe('gobierno');
  });
});
