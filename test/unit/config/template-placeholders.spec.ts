/**
 * @file Producción no arranca con un valor de plantilla sin rellenar.
 * @business Un despliegue hecho copiando `.env.production.example` y rellenando sólo la mitad
 *   quedaba en pie y se declaraba sano, firmando sesiones con un secreto escrito en un archivo
 *   público del repositorio. Nada avisaba: el valor de ejemplo mide más de 32 caracteres y no es la
 *   constante por defecto que el esquema ya prohibía.
 * @system Validaciones cruzadas puras sobre el esquema de entorno. Se comprueba además que la regla
 *   sea INEQUÍVOCA: un dominio de ejemplo no se rechaza, porque hay dominios reales parecidos y un
 *   falso positivo aquí impide un despliegue legítimo.
 */
import { describe, expect, it } from '@jest/globals';
import { applyEnvCrossChecks } from '../../../src/config/env-cross-checks.js';
import { envBaseSchema } from '../../../src/config/env.schema.js';

const schema = envBaseSchema.superRefine(applyEnvCrossChecks);

const produccion = {
  NODE_ENV: 'production',
  APP_ROLE: 'api',
  RUNTIME_JOBS_SCHEDULER_ENABLED: 'false',
  REDIS_URL: 'redis://cache:6379',
  JWT_ACCESS_TOKEN_SECRET: 'un-secreto-de-produccion-suficientemente-largo',
  NOTIFICATION_TOKEN_ENCRYPTION_KEY: 'otra-clave-distinta-y-tambien-larga-de-verdad',
  MAILSENDER_BASE_URL: 'https://mail.interno',
  MAILSENDER_EXTERNAL_API_KEY: 'mailsender-api-key',
  MAILSENDER_ADMIN_USERNAME: 'atlas-ops',
  MAILSENDER_ADMIN_PASSWORD: 'mailsender-admin-password',
  PII_ENCRYPTION_ALLOW_ENV_MASTER_KEY: 'true',
} as Record<string, unknown>;

const fallos = (input: Record<string, unknown>): string[] => {
  const result = schema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
};

describe('valores de plantilla en producción', () => {
  it('la base de comparación arranca: sin marcas de plantilla no hay hallazgos', () => {
    expect(fallos(produccion)).toEqual([]);
  });

  it('rechaza el secreto de sesiones tal cual viene en la plantilla', () => {
    // Mide 43 caracteres: pasaba el mínimo de 32 y no es la constante por defecto.
    expect(fallos({ ...produccion, JWT_ACCESS_TOKEN_SECRET: '<minimo-32-caracteres-aleatorio-unico>' })).toContain(
      'JWT_ACCESS_TOKEN_SECRET',
    );
  });

  it('rechaza la marca en CUALQUIER variable, no en una lista escrita a mano', () => {
    expect(fallos({ ...produccion, DB_PASSWORD: '<postgres-password>' })).toContain('DB_PASSWORD');
    expect(fallos({ ...produccion, DECISION_ENGINE_API_KEY: 'change-me' })).toContain('DECISION_ENGINE_API_KEY');
    expect(fallos({ ...produccion, ERP_BACKEND_CATALOG_API_KEY: 'REEMPLAZAR' })).toContain('ERP_BACKEND_CATALOG_API_KEY');
  });

  it('fuera de producción no estorba: un entorno de desarrollo puede tener marcas', () => {
    // Con la longitud mínima cubierta, para que el único motivo posible de fallo sea esta regla.
    const desarrollo = { ...produccion, NODE_ENV: 'development', JWT_ACCESS_TOKEN_SECRET: '<minimo-32-caracteres-aleatorio-unico>' };
    expect(fallos(desarrollo)).not.toContain('JWT_ACCESS_TOKEN_SECRET');
  });

  it('no confunde un valor real con una marca: la regla es inequívoca', () => {
    // Dominios de ejemplo, rutas y textos que CONTIENEN la palabra no se rechazan: sólo la forma
    // completa `<algo>` o la palabra suelta. Un falso positivo aquí bloquea un despliegue legítimo.
    expect(fallos({ ...produccion, CORS_ORIGINS: 'https://admin.tudominio.com' })).toEqual([]);
    expect(fallos({ ...produccion, GMAIL_FROM_NAME: 'Atlas (todo el equipo)' })).toEqual([]);
    expect(fallos({ ...produccion, JWT_ISSUER: 'atlas-todo-produccion' })).toEqual([]);
  });
});
