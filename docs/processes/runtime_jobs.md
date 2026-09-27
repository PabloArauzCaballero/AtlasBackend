<!-- Generado por scripts/processes/generate-process-docs.ts desde src/modules/workflow-catalog/definitions. No editar a mano. -->

# P-33 · Trabajos programados (20) y sus corridas

`runtime_jobs` · v1 · prioridad **P2** · tipo `system_job` · dueño `SYSTEMS_ADMIN` · bloques `ATLAS_BACKEND`

Los veinte trabajos de fondo que el planificador corre solo, cada uno con su intervalo, con un único líder por lock de Redis, guarda contra solapamiento y registro de cada corrida en system_job_runs; el administrador puede dispararlos a mano (por defecto en simulación) y consultar las corridas.

## Por qué existe

La auditoría del 2026-07-30 encontró que los jobs sólo existían como rutas HTTP que nadie llamaba: el outbox no se despachaba, las sesiones no expiraban y la retención de datos personales nunca se aplicaba. La mora, el SLA de soporte y el KYB tuvieron el mismo defecto. El planificador hace que corran solos.

## Quién lo inicia y quién lo cierra

Lo inicia el planificador del contenedor worker (APP_ROLE=worker exige RUNTIME_JOBS_SCHEDULER_ENABLED=true) con el actor runtime-jobs-scheduler; un administrador puede dispararlo a mano desde «Trabajos de fondo». Lo cierra el propio job al registrar su corrida como completed o failed.

## Cuándo empieza y cuándo termina

Cada tick empieza al vencer el intervalo del job, si esa instancia gana el lock de liderazgo y la tanda anterior terminó; termina con una fila en system_job_runs en completed con su resultado, o en failed con el error. El disparo manual llega en simulación salvo que se pida lo contrario.

## Qué pasa cuando falla

Una corrida que falla queda en failed con su mensaje y se reintenta en el siguiente tick; una tanda más lenta que RUNTIME_JOBS_TICK_TIMEOUT_MS se marca ATASCADA en métricas y log y no se repite hasta terminar. Sin Redis en producción el planificador no corre salvo RUNTIME_JOBS_ALLOW_WITHOUT_LOCK.

## Qué indicador dice que va bien

Última corrida completed por job dentro de su intervalo, corridas en failed y jobs atascados en las métricas del planificador; lo consulta el administrador en «Corridas de jobs» y la preparación de salida cuenta las corridas registradas.

## Resultado

- **Éxito:** Cada job corre con su cadencia y su corrida queda registrada como completed.
- **Fracaso:** Un job no corre, se atasca o falla repetidamente y la promesa de negocio que sostiene deja de cumplirse sin aviso.

## Dónde vive cada instancia

`ATLAS_BACKEND` · `platform_ops.system_job_runs` · estado en `status` · abiertas: `running`

## Etapas

```mermaid
flowchart LR
  jobs_scheduler_tick["Tick del planificador"]
  jobs_manual_trigger["Disparo manual"]
  jobs_run_history["Corridas registradas"]
  jobs_scheduler_tick --> jobs_manual_trigger
  jobs_manual_trigger --> jobs_run_history
```

| Etapa | Nombre | Actor | Cliente | Pantalla | Pasos |
|---|---|---|---|---|---|
| `jobs_scheduler_tick` | Tick del planificador | system | BLOCK | — | 20 |
| `jobs_manual_trigger` | Disparo manual | internal_user | ADMIN_PORTAL | `/internal/operations/runtime-jobs` | 8 |
| `jobs_run_history` | Corridas registradas | internal_user | ADMIN_PORTAL | `/internal/jobs` | 2 |

### Tick del planificador (`jobs_scheduler_tick`)

El planificador del worker corre cada job de scheduled-jobs.catalog.ts con su intervalo; los opcionales (optional-jobs.catalog.ts) sólo con su bandera.

| Paso | Tipo | Bloque | Operación | Roles | Eventos |
|---|---|---|---|---|---|
| Drenar el outbox | job | ATLAS_BACKEND | job `process_outbox` | — | — |
| Despachar eventos registrados | job | ATLAS_BACKEND | job `process_events` | — | — |
| Expirar sesiones inactivas | job | ATLAS_BACKEND | job `expire_stale_sessions` | — | — |
| Aplicar la retención de datos | job | ATLAS_BACKEND | job `apply_retention_policies` | — | — |
| Reintentar notificaciones atascadas | job | ATLAS_BACKEND | job `retry_stuck_notifications` | — | — |
| Purgar claves de idempotencia | job | ATLAS_BACKEND | job `purge_idempotency_keys` | — | — |
| Purgar el outbox procesado | job | ATLAS_BACKEND | job `purge_processed_outbox` | — | — |
| Marcar altas abandonadas | job | ATLAS_BACKEND | job `mark_abandoned_onboardings` | — | — |
| Recalcular la calidad de datos | job | ATLAS_BACKEND | job `recalculate_data_quality` | — | — |
| Barrer el SLA de soporte | job | ATLAS_BACKEND | job `sweep_support_sla` | — | — |
| Barrer la mora | job | ATLAS_BACKEND | job `sweep_loan_delinquency` | — | — |
| Entregar desenlaces al Motor | job | ATLAS_BACKEND | job `dispatch_loan_outcomes` | — | — |
| Registrar créditos en el Motor | job | ATLAS_BACKEND | job `register_engine_facilities` | — | — |
| Replicar consentimientos al Motor | job | ATLAS_BACKEND | job `sync_engine_consents` | — | — |
| Recalificar la cartera | job | ATLAS_BACKEND | job `sweep_debt_ratings` | — | — |
| Traer las decisiones de KYB | job | ATLAS_BACKEND | job `sync_partner_kyb_reviews` | — | — |
| Refrescar líneas de crédito | job | ATLAS_BACKEND | job `refresh_credit_lines` | — | — |
| Revisar extractos bancarios | job | ATLAS_BACKEND | job `process_bank_statement_reviews` | — | — |
| Rescatar eventos atascados | job | ATLAS_BACKEND | job `reclaim_stuck_events` | — | — |
| Correr campañas de notificación | job | ATLAS_BACKEND | job `run_notification_campaigns` | — | — |

### Disparo manual (`jobs_manual_trigger`)

El administrador dispara un job desde «Trabajos de fondo»; los DTO llegan con dryRun en true por defecto para proteger el disparo manual.

| Paso | Tipo | Bloque | Operación | Roles | Eventos |
|---|---|---|---|---|---|
| Disparar el drenado del outbox | http | ATLAS_BACKEND | `POST /operations/jobs/process-outbox` | admin, platform_admin, system | — |
| Disparar el despacho de eventos | http | ATLAS_BACKEND | `POST /operations/jobs/process-events` | admin, platform_admin, system | — |
| Disparar la expiración de sesiones | http | ATLAS_BACKEND | `POST /operations/jobs/expire-stale-sessions` | admin, platform_admin, system | — |
| Disparar la retención | http | ATLAS_BACKEND | `POST /operations/jobs/apply-retention-policies` | admin, platform_admin, system | — |
| Disparar la calidad de datos | http | ATLAS_BACKEND | `POST /operations/jobs/recalculate-data-quality` | admin, platform_admin, system | — |
| Disparar el rescate de eventos | http | ATLAS_BACKEND | `POST /operations/jobs/reclaim-stuck-events` | admin, platform_admin, system | — |
| Disparar la entrega de desenlaces | http | ATLAS_BACKEND | `POST /operations/jobs/dispatch-loan-outcomes` | admin, platform_admin, system | — |
| Disparar la recalificación | http | ATLAS_BACKEND | `POST /operations/jobs/sweep-debt-ratings` | admin, platform_admin, system | — |

### Corridas registradas (`jobs_run_history`)

El administrador consulta las corridas de system_job_runs del tenant de su token.

| Paso | Tipo | Bloque | Operación | Roles | Eventos |
|---|---|---|---|---|---|
| Listar corridas | http | ATLAS_BACKEND | `GET /internal/jobs` | internal_operator, risk_analyst, compliance_analyst, admin, platform_admin, system_admin, qa_engineer, devops, readonly_auditor | — |
| Ver una corrida | http | ATLAS_BACKEND | `GET /internal/jobs/:jobRunId` | internal_operator, risk_analyst, compliance_analyst, admin, platform_admin, system_admin, qa_engineer, devops, readonly_auditor | — |

## Fuentes

- `src/modules/runtime-jobs/scheduled-jobs.catalog.ts`
- `src/modules/runtime-jobs/runtime-jobs-scheduler.service.ts`
- `src/modules/runtime-jobs/job-run-recorder.service.ts`
- `src/modules/runtime-jobs/runtime-jobs.controller.ts`
- `src/modules/runtime-jobs/runtime-decision-jobs.controller.ts`
- `src/modules/internal-portal/internal-portal.controller.ts`
- `src/config/env-cross-checks.ts`
- `_plan-documentar-procesos-y-cableado-portal-2026-09-26/datos/procesos.json (P-33)`
