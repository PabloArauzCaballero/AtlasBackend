import { describe, expect, it } from '@jest/globals';
import { envBaseSchema } from '../../../src/config/env.schema.js';

describe('configuración del consumidor de stress', () => {
  it('mantiene el consumidor apagado cuando el entorno contiene false', () => {
    const env = envBaseSchema.parse({ RUNTIME_JOBS_STRESS_CONSUMER_ENABLED: 'false' });
    expect(env.RUNTIME_JOBS_STRESS_CONSUMER_ENABLED).toBe(false);
  });

  it('permite activarlo explícitamente con true', () => {
    const env = envBaseSchema.parse({ RUNTIME_JOBS_STRESS_CONSUMER_ENABLED: 'true' });
    expect(env.RUNTIME_JOBS_STRESS_CONSUMER_ENABLED).toBe(true);
  });

  it('rechaza valores desconocidos para no activar una carga por error de escritura', () => {
    const result = envBaseSchema.safeParse({ RUNTIME_JOBS_STRESS_CONSUMER_ENABLED: 'falso' });
    expect(result.success).toBe(false);
  });
});
