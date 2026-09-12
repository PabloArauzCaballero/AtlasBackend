/**
 * @file AT-046/AT-057 — perfil de capacidad `messaging`: el worker del piloto no exige los secretos del monolito que no usa.
 * @business En producción, el worker de Mensajería arranca sin secreto de sesiones de usuario ni Redis; la API,
 *   nunca con ese perfil. Lo que Mensajería sí usa (clave de tokens de dispositivo, mail) sigue exigido.
 * @system Validaciones cruzadas puras sobre el esquema de entorno.
 */
import { describe, expect, it } from '@jest/globals';
import { applyEnvCrossChecks } from '../../../src/config/env-cross-checks.js';
import { DEFAULT_JWT_SECRET, DEFAULT_NOTIFICATION_TOKEN_ENCRYPTION_KEY, envBaseSchema } from '../../../src/config/env.schema.js';

const schema = envBaseSchema.superRefine(applyEnvCrossChecks);
const production = {
  NODE_ENV: 'production',
  APP_ROLE: 'worker',
  RUNTIME_JOBS_SCHEDULER_ENABLED: 'true',
  NOTIFICATION_TOKEN_ENCRYPTION_KEY: 'otra-clave-distinta-y-tambien-larga-de-verdad',
  MAILSENDER_BASE_URL: 'https://mail.interno',
  MAILSENDER_EXTERNAL_API_KEY: 'mailsender-api-key',
  MAILSENDER_ADMIN_USERNAME: 'atlas-ops',
  MAILSENDER_ADMIN_PASSWORD: 'mailsender-admin-password',
  PII_ENCRYPTION_ALLOW_ENV_MASTER_KEY: 'true',
} as Record<string, unknown>;
const failedPaths = (input: Record<string, unknown>): string[] => {
  const result = schema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
};

describe('perfil de capacidad messaging', () => {
  it('sin perfil, producción exige el secreto de usuarios y Redis (comportamiento anterior intacto)', () => {
    const paths = failedPaths({ ...production, JWT_ACCESS_TOKEN_SECRET: DEFAULT_JWT_SECRET });
    expect(paths).toEqual(expect.arrayContaining(['JWT_ACCESS_TOKEN_SECRET', 'REDIS_URL']));
  });

  const pilot = { ...production, ATLAS_CAPABILITY_PROFILE: 'messaging', MESSAGING_DB_USER: 'atlas_ctx_messaging' };

  it('con perfil messaging, APP_ROLE=worker e identidad propia, arranca sin JWT de usuarios ni Redis', () => {
    expect(failedPaths({ ...pilot, JWT_ACCESS_TOKEN_SECRET: DEFAULT_JWT_SECRET })).toEqual([]);
  });

  it('el perfil messaging exige su identidad de base: sin ella caería a la del monolito, que sí lee Crédito', () => {
    const paths = failedPaths({ ...production, ATLAS_CAPABILITY_PROFILE: 'messaging', JWT_ACCESS_TOKEN_SECRET: DEFAULT_JWT_SECRET });
    expect(paths).toContain('MESSAGING_DB_USER');
  });

  it('lo que Mensajería sí usa sigue exigido: la clave de tokens de dispositivo no puede ser la de ejemplo', () => {
    const paths = failedPaths({ ...pilot, NOTIFICATION_TOKEN_ENCRYPTION_KEY: DEFAULT_NOTIFICATION_TOKEN_ENCRYPTION_KEY });
    expect(paths).toContain('NOTIFICATION_TOKEN_ENCRYPTION_KEY');
  });

  it('la API no puede arrancar con el perfil messaging', () => {
    const paths = failedPaths({
      ...pilot,
      APP_ROLE: 'api',
      RUNTIME_JOBS_SCHEDULER_ENABLED: 'false',
      REDIS_URL: 'redis://cache:6379',
      JWT_ACCESS_TOKEN_SECRET: 'un-secreto-de-produccion-suficientemente-largo',
    });
    expect(paths).toContain('ATLAS_CAPABILITY_PROFILE');
  });

  it('en producción, la URL del directorio entre contextos no puede ser http:// hacia un host público', () => {
    const paths = failedPaths({ ...pilot, CUSTOMERS_DIRECTORY_URL: 'http://directorio.publico.example.com/api/v1' });
    expect(paths).toContain('CUSTOMERS_DIRECTORY_URL');
    expect(failedPaths({ ...pilot, CUSTOMERS_DIRECTORY_URL: 'https://directorio.publico.example.com/api/v1' })).toEqual([]);
    // Un nombre de servicio de la red interna (sin punto) sí puede ir por http.
    expect(failedPaths({ ...pilot, CUSTOMERS_DIRECTORY_URL: 'http://api:3005/api/v1' })).toEqual([]);
  });
});
