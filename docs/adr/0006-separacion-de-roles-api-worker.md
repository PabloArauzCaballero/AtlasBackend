# ADR-0006: Separación de roles de proceso (API / worker) sobre una sola imagen

- **Estado:** Aceptado
- **Fecha:** 2026-07-31
- **Decisores:** equipo backend
- **Relacionado:** [background-processing.md](../architecture/background-processing.md), [ADR-0001](0001-outbox-en-postgresql.md), hallazgo A-03 de [auditoria-integral-2026-07-30.md](../audit/auditoria-integral-2026-07-30.md)

## Contexto

Todo el trabajo de fondo del backend corría dentro del mismo proceso que atiende HTTP:

- `RuntimeJobsSchedulerService` con siete jobs (outbox, eventos, sesiones, retención de datos
  personales, reintento de notificaciones, purga de idempotencia, calidad de dato).
- `SystemsHealthMonitorService`, que sondea las herramientas críticas y avisa al staff.
- `StartupSeedService`, que aplica seeders al arrancar.
- La entrega de broadcasts de notificación, *fire-and-forget* dentro del request.

Tres consecuencias medibles de esa disposición:

1. `apply_retention_policies` y `recalculate_data_quality` recorren tablas completas por tenant desde
   **el mismo pool de conexiones** (`DB_POOL_MAX`) que atiende a los clientes. Un job que retiene
   conexiones deja al handler HTTP esperando en la cola del pool.
2. Escalar la API por tráfico multiplicaba los `setInterval` de trabajo de fondo. La elección de
   líder por Redis evitaba la ejecución simultánea, pero seguía atando dos decisiones sin relación:
   cuánto tráfico atender y cuánto trabajo de fondo procesar.
3. Un despliegue a mitad de un broadcast dejaba mensajes en `pending` que sólo recogía
   `retry_stuck_notifications`, con umbral de 15 minutos e intervalo de 5: hasta 20 minutos de
   retraso para un aviso in-app.

## Decisión

Usamos **un solo artefacto con tres roles de proceso**, seleccionados por la variable `APP_ROLE`:

| `APP_ROLE` | HTTP de negocio | Trabajo de fondo | Entrypoint |
|---|---|---|---|
| `api` | Sí | No | `dist/src/main.js` |
| `worker` | No | Sí | `dist/src/worker.js` |
| `all` | Sí | Sí | `dist/src/main.js` |

`all` es el **valor por defecto**: sin configurar nada, el comportamiento es exactamente el anterior.
Ningún test, script ni `yarn start:dev` cambia de conducta por esta decisión.

El worker arranca con `NestFactory.createApplicationContext()` —que instancia todos los providers sin
registrar **ninguna ruta**— más un servidor `node:http` mínimo con exactamente tres rutas:
`/health/liveness`, `/health/readiness` y `/metrics`.

## Alternativas consideradas

- **Dos imágenes distintas** — descartada. API y worker comparten el 100 % del árbol de dependencias:
  serían dos builds, dos escaneos de vulnerabilidades y dos oportunidades de que las versiones
  diverjan, a cambio de nada. Un `command` distinto sobre la misma imagen no tiene ninguna de esas
  desventajas.
- **El worker monta la API completa y no se publica su puerto** — descartada. "Confío en no publicar
  el puerto" es una decisión que se revierte sola en cuanto alguien edita un manifiesto. Con
  `createApplicationContext()` los controllers de negocio **no existen** en ese proceso.
- **Introducir una cola dedicada (BullMQ, RabbitMQ)** — descartada, por la misma razón que
  [ADR-0001](0001-outbox-en-postgresql.md): el trabajo de fondo ya es durable en PostgreSQL (outbox,
  `notification_messages`, `system_job_runs`, `idempotency_keys`). Una cola externa añadiría un
  almacén de estado paralelo que habría que reconciliar con el que ya existe.
- **`@nestjs/schedule` para el planificador** — descartada previamente y se mantiene: los jobs son
  "cada N milisegundos", no expresiones cron.

## Consecuencias

- **Positivas:**
  - El trabajo de fondo deja de competir por el pool de conexiones y el event loop del proceso que
    atiende clientes.
  - API y worker escalan por señales independientes.
  - Las dos combinaciones incoherentes (`worker` sin planificador, `api` con planificador) las
    **rechaza `env.ts` al arrancar**: no hay que vigilarlas, el proceso no arranca.
  - `atlas_app_info{role}` convierte "el worker no está corriendo" —hasta ahora un fallo silencioso—
    en una alerta.

- **Negativas / costos asumidos:**
  - Un rol más que operar, con su propio manifiesto, su sonda y su alerta.
  - `log-sync` **no** se mueve al worker: tail-ea el archivo que escribe su propio proceso, así que
    corre en todos los roles. Es una excepción que hay que recordar al leer el inventario.
  - Con `NOTIFICATIONS_DELIVERY_MODE=deferred` y **sin** worker desplegado, nadie entregaría los
    mensajes. Por eso el default sigue siendo `inline`, y el runbook lo marca explícitamente.

- **Condición de revisión (trigger):** si el worker pasa de forma sostenida del 70 % de su límite de
  CPU con una sola réplica, o si aparece un job que necesite expresiones cron reales en vez de
  intervalos, hay que reabrir la decisión sobre la cola dedicada.
