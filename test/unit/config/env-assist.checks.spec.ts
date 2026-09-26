import { describe, expect, it } from '@jest/globals';
import { applyEnvCrossChecks } from '../../../src/config/env-cross-checks.js';
import { envBaseSchema } from '../../../src/config/env.schema.js';

/**
 * Atlas Assist encendido a medias no puede arrancar.
 *
 * `ASSIST_ENABLED=true` sin URL o sin clave produciría el peor fallo de esta integración: el
 * despliegue se declara sano y el error aparece en el teléfono de un cliente, como un asistente
 * que contesta «no está disponible» a todo. Estas pruebas fijan que eso se corta en el arranque,
 * y que apagado (el defecto) no exige nada — desplegar Core antes que el servicio de IA es
 * exactamente el orden previsto.
 *
 * Se ejercita a través del esquema completo por la misma razón que `env-cross-checks.spec.ts`:
 * es el mismo camino que corre `parseEnv` al arrancar.
 */
describe('checkAssist', () => {
  const schema = envBaseSchema.superRefine(applyEnvCrossChecks);

  const base = {
    NODE_ENV: 'development',
  } as Record<string, unknown>;

  const failedPaths = (input: Record<string, unknown>): string[] => {
    const result = schema.safeParse(input);
    return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
  };

  it('apagado (el defecto) no exige nada: Core puede desplegarse antes que el servicio de IA', () => {
    expect(failedPaths(base)).toEqual([]);
  });

  it('encendido sin URL ni clave señala exactamente las dos variables que faltan', () => {
    const paths = failedPaths({ ...base, ASSIST_ENABLED: 'true' });
    expect(paths).toContain('ATLAS_AI_SERVICE_URL');
    expect(paths).toContain('ATLAS_AI_SERVICE_KEY');
  });

  it('encendido con URL pero sin clave sigue sin arrancar', () => {
    const paths = failedPaths({ ...base, ASSIST_ENABLED: 'true', ATLAS_AI_SERVICE_URL: 'http://ai.interno:3105' });
    expect(paths).toEqual(expect.arrayContaining(['ATLAS_AI_SERVICE_KEY']));
    expect(paths).not.toContain('ATLAS_AI_SERVICE_URL');
  });

  it('una clave corta no vale: el servicio de IA exige 32 caracteres y aquí se descubre antes', () => {
    const paths = failedPaths({
      ...base,
      ASSIST_ENABLED: 'true',
      ATLAS_AI_SERVICE_URL: 'http://ai.interno:3105',
      ATLAS_AI_SERVICE_KEY: 'corta',
    });
    expect(paths).toContain('ATLAS_AI_SERVICE_KEY');
  });

  it('encendido y completo arranca', () => {
    const clave = ['clave-de-servicio', 'de-programa-de-pruebas', 'larga-de-verdad'].join('-');
    expect(
      failedPaths({
        ...base,
        ASSIST_ENABLED: 'true',
        ATLAS_AI_SERVICE_URL: 'http://ai.interno:3105',
        ATLAS_AI_SERVICE_KEY: clave,
      }),
    ).toEqual([]);
  });
});
