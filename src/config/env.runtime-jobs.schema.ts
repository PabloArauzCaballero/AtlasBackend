/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza completa trabajo asíncrono y recuperable fuera de la latencia del request.
 * @system declara la configuración del planificador de trabajos de fondo y de la entrega diferida.
 */
import { z } from 'zod';
import { booleanEnvSchema } from './env.primitives.js';

/**
 * Configuración del trabajo de fondo: qué se ejecuta solo, cada cuánto y dónde se entrega.
 *
 * Bloque propio porque responde a una pregunta distinta del resto del entorno —no "cómo se conecta
 * el backend a sus dependencias" sino "qué hace por su cuenta cuando nadie lo llama"— y porque es el
 * bloque que consulta el proceso worker. Se compone en `envBaseSchema` con un spread, así que para
 * quien lee `env.X` no cambia nada.
 *
 * Ver `docs/architecture/background-processing.md` y el hallazgo A-03 de
 * `docs/audit/auditoria-integral-2026-07-30.md`.
 */
export const runtimeJobsEnvShape = {
  // Planificador (`RuntimeJobsSchedulerService`). Opt-in: un proceso que arranca en un test, un
  // script o una consola de mantenimiento no debe empezar a mutar datos por su cuenta. En producción
  // exige Redis para la elección de líder, salvo que se asuma lo contrario a propósito.
  RUNTIME_JOBS_SCHEDULER_ENABLED: booleanEnvSchema,
  RUNTIME_JOBS_ALLOW_WITHOUT_LOCK: booleanEnvSchema,
  RUNTIME_JOBS_BATCH_LIMIT: z.coerce.number().int().positive().max(500).default(100),
  RUNTIME_JOBS_LEADER_LOCK_TTL_MS: z.coerce.number().int().positive().max(3_600_000).default(900_000),
  RUNTIME_JOBS_OUTBOX_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  RUNTIME_JOBS_EVENTS_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  RUNTIME_JOBS_SESSIONS_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),
  RUNTIME_JOBS_SESSION_MAX_IDLE_MINUTES: z.coerce.number().int().positive().max(43_200).default(120),
  RUNTIME_JOBS_RETENTION_INTERVAL_MS: z.coerce.number().int().positive().default(86_400_000),
  RUNTIME_JOBS_DATA_QUALITY_INTERVAL_MS: z.coerce.number().int().positive().default(3_600_000),

  // Barrido de mensajes de notificación que quedaron a medio entregar tras un reinicio, y purga de
  // claves de idempotencia ya resueltas (ambas colas crecían sin que nada las recogiera).
  RUNTIME_JOBS_NOTIFICATION_RETRY_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),
  RUNTIME_JOBS_NOTIFICATION_STUCK_MINUTES: z.coerce.number().int().positive().max(1_440).default(15),
  RUNTIME_JOBS_IDEMPOTENCY_PURGE_INTERVAL_MS: z.coerce.number().int().positive().default(86_400_000),
  RUNTIME_JOBS_IDEMPOTENCY_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  // Entrega de los mensajes recién creados por un broadcast, cuando la entrega NO corre dentro del
  // proceso que atendió el request (NOTIFICATIONS_DELIVERY_MODE=deferred). Intervalo corto a
  // propósito: aquí la pregunta es "¿qué hay recién creado por entregar?", no "¿qué quedó varado?".
  RUNTIME_JOBS_NOTIFICATION_DELIVERY_INTERVAL_MS: z.coerce.number().int().positive().default(10_000),

  // Dónde se ENTREGA un broadcast de notificaciones:
  //   inline   → en el mismo proceso que atendió el POST, fuera del request (fire-and-forget). Es el
  //              comportamiento histórico y el default: sin worker desplegado, es el único que
  //              entrega algo.
  //   deferred → el request sólo persiste los mensajes en `pending`; los entrega el job
  //              `deliver_pending_notifications` del worker. Un reinicio de la API a mitad de tanda
  //              deja de varar mensajes, y la entrega no compite con la latencia del request.
  // Ver docs/architecture/background-processing.md §2.4.
  NOTIFICATIONS_DELIVERY_MODE: z.enum(['inline', 'deferred']).default('inline'),
} as const;
