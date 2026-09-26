/**
 * @file Esquema de entorno: registro y monitor de salud.
 * @business Esta pieza evita operar con parámetros inseguros o ambiguos.
 * @system valida y compone configuración tipada al arrancar.
 */
import { z } from 'zod';
import { booleanEnvSchema, optionalBooleanEnvSchema } from './env.primitives.js';

/**
 * Todo lo que decide QUÉ se registra, dónde acaba y cada cuánto se comprueba la salud.
 *
 * Sale de `env.schema.ts` por la misma razón que ya salieron la base de datos, los ficheros, los
 * jobs y el Motor: aquel archivo pasaba de las 300 líneas que admite `check:file-size`, y este
 * bloque es el que menos tiene que ver con el resto. Se compone con `...observabilityEnvShape`.
 */
export const observabilityEnvShape = {
  // Formato de la salida por CONSOLA (stdout). `json` emite una línea JSON por evento, con
  // correlationId/traceId y la MISMA redacción de PII que ya se aplicaba al archivo; `pretty`
  // mantiene el formato humano de ConsoleLogger. Sin valor explícito, producción usa `json` (stdout
  // es el pipeline de logs real en contenedores) y el resto `pretty`. Ver hallazgo A-04 de
  // docs/audit/auditoria-integral-2026-07-30.md.
  LOG_FORMAT: z.enum(['json', 'pretty']).optional(),
  LOG_SYNC_FILE_PATH: z.string().min(1).default('Archivo.log'),
  // Techo del archivo de log antes de rotar (ATLAS-OPS-012). El sincronizador a Mongo trunca el
  // archivo tras cada volcado, pero solo si Mongo está configurado; sin él, nada lo acotaba y el
  // archivo crecía hasta llenar el disco del contenedor. 64 MB deja holgura para diagnosticar un
  // incidente reciente sin comprometer un volumen pequeño.
  LOG_FILE_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1_048_576)
    .max(1_073_741_824)
    .default(64 * 1024 * 1024),
  LOG_SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
  LOG_SYNC_MAX_CHUNK_BYTES: z.coerce.number().int().positive().max(10_000_000).default(1_000_000),
  LOG_SYNC_IMPORT_EXISTING_ON_FIRST_BOOT: booleanEnvSchema,
  LOG_SYNC_MONGO_SERVER_SELECTION_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(5_000),
  LOG_SYNC_FAILURES_BEFORE_PAUSE: z.coerce.number().int().positive().max(20).default(3),
  LOG_SYNC_FAILURE_PAUSE_MS: z.coerce.number().int().positive().max(3_600_000).default(60_000),
  // Tope del archivo LOCAL, independiente de que MongoDB conteste. `maybeResetLogFileAfterFullSync`
  // sólo trunca con la confirmación de Mongo delante; si el destino remoto desaparece —el clúster
  // borrado del 2026-09-06— esa confirmación no llega nunca y el archivo crece sin freno en un
  // volumen que además sobrevive a los redespliegues. Al pasarse de aquí se conserva la mitad más
  // reciente. 64 MB deja historia de sobra sin que un destino caído se coma el disco.
  LOG_SYNC_LOCAL_MAX_BYTES: z.coerce.number().int().positive().max(1_000_000_000).default(67_108_864),

  // Monitor de salud de herramientas críticas (systems-ops): chequea periódicamente
  // SystemsHealthService.getToolsHealth() y notifica a los usuarios internos (in-app) cuando
  // una herramienta marcada `isCritical` pasa de saludable a no-saludable (y cuando se
  // recupera). Activado por defecto; se puede apagar en un entorno donde no tenga sentido
  // (p. ej. un ambiente de pruebas efímero) sin tocar código.
  SYSTEM_HEALTH_MONITOR_ENABLED: optionalBooleanEnvSchema.default(true),
  SYSTEM_HEALTH_MONITOR_INTERVAL_MS: z.coerce.number().int().positive().max(3_600_000).default(60_000),
};
