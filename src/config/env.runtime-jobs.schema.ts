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

  // Recuperación de eventos VARADOS. `claimPending` marca el evento como `processing` y le pone
  // `locked_by`; si el proceso muere entre esa marca y el `save()` final, el evento queda en
  // `processing` para siempre — ninguna consulta de reclamo vuelve a mirarlo, porque todas filtran
  // por `status='pending'`. Este job devuelve a la cola los que llevan demasiado tiempo bloqueados.
  //
  // El umbral debe superar la duración normal de una entrega (un `handleEvent` con fan-out de
  // notificaciones puede tardar): reclamar demasiado pronto crearía la duplicidad que se quiere
  // evitar. 15 minutos es holgado frente a esa duración y corto frente a un SLA de notificación.
  RUNTIME_JOBS_STUCK_EVENTS_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),
  RUNTIME_JOBS_STUCK_EVENT_MINUTES: z.coerce.number().int().positive().max(1_440).default(15),

  // Techo de duración de UNA tanda del planificador (todos los tenants de un job). Sin él, un job
  // colgado en una consulta que no vuelve deja su hueco de ejecución ocupado indefinidamente: el
  // guard de reentrada impide que el siguiente tick arranque, así que ese job deja de correr para
  // siempre sin que nada lo reporte. Al vencer, la tanda se abandona (se registra como fallo) y el
  // siguiente tick vuelve a intentarlo. `0` lo desactiva.
  RUNTIME_JOBS_TICK_TIMEOUT_MS: z.coerce.number().int().min(0).max(3_600_000).default(300_000),

  // Dispersión aleatoria del PRIMER tick de cada job. Con N réplicas arrancando a la vez tras un
  // despliegue, todas piden el mismo lock de liderazgo en el mismo milisegundo y todas consultan la
  // lista de tenants: un pico sincronizado sobre Redis y Postgres justo cuando el servicio está más
  // frágil. Un desfase aleatorio dentro de esta ventana lo aplana. `0` lo desactiva.
  RUNTIME_JOBS_START_JITTER_MS: z.coerce.number().int().min(0).max(300_000).default(15_000),

  // Barrido de mensajes de notificación que quedaron a medio entregar tras un reinicio, y purga de
  // claves de idempotencia ya resueltas (ambas colas crecían sin que nada las recogiera).
  RUNTIME_JOBS_NOTIFICATION_RETRY_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),
  RUNTIME_JOBS_NOTIFICATION_STUCK_MINUTES: z.coerce.number().int().positive().max(1_440).default(15),
  // Cierre de los onboardings abandonados. Diario porque el umbral se mide en DÍAS de inactividad:
  // una cadencia más corta no cambiaría el resultado y solo repetiría el barrido. El default de días
  // acompaña a `ONBOARDING_ABANDONMENT_DAYS`; se separa en env para poder acortarlo en los
  // ambientes donde el embudo se mide en una ventana más corta.
  RUNTIME_JOBS_ONBOARDING_ABANDONMENT_INTERVAL_MS: z.coerce.number().int().positive().default(86_400_000),
  RUNTIME_JOBS_ONBOARDING_ABANDONMENT_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  // Barrido de mora de la cartera. Estaba escrito y sólo colgaba de un endpoint HTTP que nadie
  // llamaba: `days_past_due` se quedaba congelado en el valor del día del desembolso, así que un
  // préstamo vencido seguía figurando al corriente y la línea de crédito nunca se enteraba. Cada
  // hora porque la unidad del atraso es el día: una cadencia mayor retrasaría hasta un día entero el
  // momento en que la mora se ve, y una menor recorrería la misma cartera sin que nada haya cambiado.
  RUNTIME_JOBS_DELINQUENCY_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(3_600_000),

  // Recálculo de la capacidad de pago para quien todavía no tiene línea (recién dado de alta) y para
  // quien la tiene vieja. Sin esto la línea sólo se movía a mano desde operaciones.
  RUNTIME_JOBS_CREDIT_LINE_REFRESH_INTERVAL_MS: z.coerce.number().int().positive().default(3_600_000),
  // A partir de cuántos días una línea vigente se considera vieja y se vuelve a preguntar. El
  // expediente cambia por fuera del crédito —ingresos, contactos, verificaciones— y una línea que
  // nadie recalcula acaba respondiendo a datos que ya no son los de la persona.
  RUNTIME_JOBS_CREDIT_LINE_MAX_AGE_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  // Cuántos clientes recalcula como mucho cada pasada. Cada uno es una llamada al motor, así que el
  // tope es lo que impide que un alta masiva convierta el job en una tormenta de peticiones.
  RUNTIME_JOBS_CREDIT_LINE_REFRESH_LIMIT: z.coerce.number().int().min(1).max(1_000).default(50),

  // Vigilancia del compromiso de 24 horas del extracto bancario. Cada 15 minutos: el compromiso se
  // mide en horas, y la ventana define con cuánta antelación se puede avisar de que uno va a
  // incumplirse todavía a tiempo de evitarlo.
  RUNTIME_JOBS_BANK_STATEMENT_INTERVAL_MS: z.coerce.number().int().positive().default(900_000),
  // Cuánto antes del vencimiento del compromiso se escala la revisión pendiente.
  RUNTIME_JOBS_BANK_STATEMENT_ESCALATE_BEFORE_MINUTES: z.coerce.number().int().min(5).max(1_440).default(240),

  // Vigilancia de los compromisos de atención del soporte (`support_sla_clocks`). Mismo defecto que
  // tuvo la mora: `sweepBreaches` estaba completo y colgaba EXCLUSIVAMENTE de
  // `POST internal/support/desk/sla/sweep`, que no llamaba nadie. Auditoría del 2026-09-05 sobre el
  // VPS: 13 relojes en marcha, los 13 con el plazo pasado —el peor, un P1 de toma de cuenta, 190 h
  // tarde sobre un objetivo de 5 minutos— y ni una sola marca de incumplimiento. El indicador de
  // cumplimiento no salía malo: salía PERFECTO, que es peor, porque nadie audita un cero.
  //
  // Un minuto porque el objetivo más corto del catálogo es el acuse de P1, de 5 minutos: con una
  // cadencia mayor el aviso previo al incumplimiento llegaría después del incumplimiento y no
  // serviría para evitar nada. El barrido es una consulta por índice sobre relojes en marcha.
  RUNTIME_JOBS_SUPPORT_SLA_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),

  RUNTIME_JOBS_IDEMPOTENCY_PURGE_INTERVAL_MS: z.coerce.number().int().positive().default(86_400_000),
  RUNTIME_JOBS_IDEMPOTENCY_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  // Retención de los eventos de outbox ya procesados (ATLAS-DATA-003). El default coincide con el de
  // idempotencia porque responden al mismo criterio: cuánta evidencia operativa reciente se conserva
  // para diagnosticar un incidente. Piso de 1 día — los eventos de hoy son justo los que se miran.
  RUNTIME_JOBS_OUTBOX_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),

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
