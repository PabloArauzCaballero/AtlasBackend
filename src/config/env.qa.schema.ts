/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza decide DÓNDE se pueden ejecutar corridas QA de N personas y con qué topes.
 * @system identidad del entorno de negocio separada de `NODE_ENV`, destino QA administrado en el
 *   servidor y límites publicados; todo apagado por defecto.
 *
 * Por qué `ATLAS_DEPLOYMENT_ENVIRONMENT` y no `NODE_ENV` (hallazgo H17): `NODE_ENV=production` es
 * una optimización de runtime que la imagen de TEST también lleva. Usarla como identidad de negocio
 * hacía que TEST descartara el contexto QA como si fuera PROD, y el «arreglo» fácil —poner
 * `NODE_ENV=development` en la API— debilita todo lo demás. Aquí la identidad la declara el
 * despliegue, y PROD bloquea QA aunque un cliente mande el `environmentId` de TEST.
 */
import { z } from 'zod';
import { booleanEnvSchema, optionalLongSecretEnvSchema, optionalUrlEnvSchema } from './env.primitives.js';

export const qaEnvShape = {
  // LOCAL | TEST | STAGING | PROD. Sin valor, se deduce de NODE_ENV como antes (production ⇒ PROD),
  // así que un despliegue que no lo declara conserva el comportamiento más restrictivo.
  ATLAS_DEPLOYMENT_ENVIRONMENT: z.enum(['LOCAL', 'TEST', 'STAGING', 'PROD']).optional(),
  // Interruptor de las rutas de ejecución QA. En PROD se ignora: allí nunca se ejecuta.
  QA_EXECUTION_ENABLED: booleanEnvSchema,
  // Firma HS256 de la credencial QA de vida corta que el worker añade a cada petición. Sin secreto
  // no se emite contexto QA y las corridas integradas quedan bloqueadas en preflight.
  QA_EXECUTION_SECRET: optionalLongSecretEnvSchema,
  // Destino QA administrado en servidor. La UI elige un `environmentId`, nunca un host.
  QA_TARGET_ENVIRONMENT_ID: z.string().trim().min(2).max(80).default('qa-local'),
  QA_TARGET_LABEL: z.string().trim().min(2).max(120).default('QA local'),
  QA_TARGET_BASE_URL: optionalUrlEnvSchema,
  // El worker comparte base con el destino: habilita fixtures resueltas por consulta directa.
  QA_TARGET_SHARES_DATABASE: booleanEnvSchema,
  // Capacidad PUBLICADA del entorno. Por encima se rechaza con mensaje, sin clamp silencioso.
  QA_MAX_PERSONS: z.coerce.number().int().positive().max(10_000).default(100),
  QA_MAX_CONCURRENCY: z.coerce.number().int().positive().max(200).default(10),
  QA_MAX_REQUESTS: z.coerce.number().int().positive().max(1_000_000).default(3_000),
  QA_MAX_DURATION_MS: z.coerce.number().int().positive().max(86_400_000).default(1_800_000),
  QA_MAX_IN_FLIGHT_REQUESTS: z.coerce.number().int().positive().max(500).default(10),
  // Plano de control del emulador de proveedores (repo AtlasExternalProvidersMock).
  MOCK_PROVIDERS_CONTROL_URL: optionalUrlEnvSchema,
  MOCK_PROVIDERS_CONTROL_TOKEN: optionalLongSecretEnvSchema,
  // Consumidor de la cola QA (`systems_qa_journey_run`). Genera tráfico HTTP: apagado por defecto.
  RUNTIME_JOBS_QA_CONSUMER_ENABLED: booleanEnvSchema,
  RUNTIME_JOBS_QA_CONSUMER_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
} as const;
