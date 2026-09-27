import { readFileSync } from 'node:fs';
import { describe, expect, it } from '@jest/globals';
import { envBaseSchema } from '../../../src/config/env.schema.js';
import { qaEnvShape } from '../../../src/config/env.qa.schema.js';

/** Los defaults del ancla `x-atlas-env` del compose de Coolify, tal como llegan al contenedor. */
function composeDefaults(): Record<string, string> {
  const compose = readFileSync('docker-compose.coolify.yml', 'utf8');
  const defaults: Record<string, string> = {};
  for (const key of Object.keys(qaEnvShape)) {
    const match = compose.match(new RegExp(`^  ${key}: '\\$\\{${key}:-([^}]*)\\}'$`, 'm'));
    if (match) defaults[key] = match[1];
  }
  return defaults;
}

describe('variables QA en el compose de Coolify', () => {
  it('nombra TODAS las variables del esquema QA: lo que no se nombra no llega al contenedor', () => {
    expect(Object.keys(composeDefaults()).sort()).toEqual(Object.keys(qaEnvShape).sort());
  });

  it('con el panel vacío el arranque no se cae y QA queda apagado', () => {
    const env = envBaseSchema.parse(composeDefaults());
    expect(env.ATLAS_DEPLOYMENT_ENVIRONMENT).toBeUndefined();
    expect(env.QA_EXECUTION_ENABLED).toBe(false);
    expect(env.QA_TARGET_BASE_URL).toBeUndefined();
    expect(env.RUNTIME_JOBS_QA_CONSUMER_ENABLED).toBe(false);
    expect(env.QA_TARGET_ENVIRONMENT_ID).toBe('qa-local');
  });

  it('un entorno declarado se respeta y uno inventado se rechaza', () => {
    expect(envBaseSchema.parse({ ATLAS_DEPLOYMENT_ENVIRONMENT: 'TEST' }).ATLAS_DEPLOYMENT_ENVIRONMENT).toBe('TEST');
    expect(envBaseSchema.safeParse({ ATLAS_DEPLOYMENT_ENVIRONMENT: 'PRUEBAS' }).success).toBe(false);
  });
});
