# Informe de progreso del proyecto

## 1. Resumen del ciclo de trabajo

Se implementó el patch de sesiones compuestas para Atlas. La sesión deja de ser solo un registro aislado en `customer_sessions` y pasa a funcionar como un caso de uso de seguridad, dispositivo, GPS, permisos, red, SIM, actividad y auditoría.

## 2. Avance realizado

- Se agregaron endpoints compuestos de sesión:
  - `POST /api/v1/customers/:customerId/sessions/start`
  - `POST /api/v1/customers/:customerId/sessions/:sessionId/heartbeat`
  - `POST /api/v1/customers/:customerId/sessions/:sessionId/end`
  - `GET /api/v1/customers/:customerId/session-state`
  - `GET /api/v1/operations/sessions/:sessionId/investigation-summary`
- Se creó `SessionsService` para coordinar casos de uso transaccionales.
- Se completó `SessionsRepository` para trabajar con tablas existentes del schema.
- Se agregaron schemas Zod para validar params, body y payloads de sesión.
- Se agregó mapper y DTOs de respuesta para no exponer modelos Sequelize directamente.
- Se registran GPS de sesión en `address_gps_observations` cuando existe permiso de ubicación.
- Se asocia GPS a `customer_addresses.current_version_id` cuando existe dirección actual; si no existe dirección, el GPS se guarda con dirección nula pero ligado a cliente/sesión.
- Se registran snapshots de dispositivo, permisos, auth events, IP reputation, SIM observations, device risk events, action logs, activity summaries, observations y audit logs.
- Se actualizó `docs/endpoints/endpoints.md` con documentación detallada: método, body recomendado, respuesta, tablas afectadas, reglas y motivo de importancia.
- Se actualizó `docs/testing/smoke-tests.md` con smoke tests completos de inicio, heartbeat, estado, investigación, cierre y rechazo de heartbeat sobre sesión cerrada.
- Se actualizó `docs/postman/collection.json` con requests de sesión.

## 3. Riesgos detectados

| Riesgo | Impacto | Mitigación recomendada |
|---|---|---|
| Idempotencia fuerte aún no tiene tabla dedicada | Un reintento exacto puede no devolver la misma respuesta persistida, aunque el endpoint exige `x-idempotency-key` | Crear tabla formal de idempotencia cuando el schema lo autorice. Por ahora se registra hash en logs/auditoría y se mantiene contrato documentado. |
| No existe integración real de proveedor de IP/SIM | Los datos de IP reputation y SIM vienen del cliente o de infraestructura cercana | Encapsular proveedores externos cuando se defina integración. |
| Script `yarn test` disponible | El proyecto usa Node test runner nativo, no Jest | Mantener pruebas unitarias ligeras con Node test runner y smoke tests por flujo. |
| GPS depende del permiso enviado por la app | Si la app no envía permiso correcto, no se guarda observación GPS | Mantener validación explícita: solo se guarda GPS con `locationPermissionGranted=true` o permiso `location` concedido. |

## 4. Decisiones clave tomadas

| Decisión | Justificación | Impacto |
|---|---|---|
| Mantener endpoints de sesión como `POST` | Son comandos de negocio que crean eventos, observaciones y auditoría, no updates CRUD simples | Evita fragmentar la API y mantiene trazabilidad append-only. |
| Guardar GPS en `address_gps_observations` | La tabla existe y admite `session_id`; permite comparar ubicación real vs dirección declarada | Mejora riesgo/fraude sin crear entidades nuevas. |
| No crear tablas nuevas | El usuario pidió temperatura 0 y no inventar entidades | El patch solo usa modelos/tablas existentes. |
| Separar `sessions/heartbeat` de `telemetry/batch` | Heartbeat es liveness y seguridad de sesión; telemetry batch es comportamiento masivo | Evita convertir `telemetry/batch` en un endpoint demasiado ambiguo. |

## 5. Desviaciones de lo esperado

| Desviación | Motivo | Acción recomendada |
|---|---|---|
| `yarn test` ejecutable | Node test runner nativo configurado | No usar `--runInBand` porque es opción propia de Jest, no del runner actual. |
| Idempotencia fuerte no se persistió en tabla propia | No existe tabla aprobada de idempotencia y no se deben crear entidades nuevas | Diseñar tabla de idempotencia en una migración futura si se aprueba. |

## 6. Fase actual del proyecto

Fase API compuesta — sesiones, dispositivo, GPS, seguridad y auditoría.

## 7. Próxima fase recomendada

- Agregar Jest para services de sesiones.
- Integrar `customer-onboarding/start` con la lógica común de `SessionsService` si se decide reducir duplicación interna.
- Diseñar idempotencia persistida formal.
- Validar endpoints contra PostgreSQL local con `db:migration:up` y `db:seed:up`.

## 8. Estado general del entregable

Pendiente de validación con PostgreSQL real. El código fue validado con:

```bash
yarn type-check
yarn build
```

No se agregaron endpoints de seeds, CRUD por tabla, crédito, pagos, cuotas, MDR, cobranza ni entidades nuevas.

---

## Patch aplicado — Catalogación compuesta

Se agregaron endpoints internos compuestos para catalogación, definiciones técnicas, política de riesgo y gobierno de datos.

### Endpoints agregados

```txt
GET  /api/v1/operations/catalogs
GET  /api/v1/operations/catalogs/:catalogCode/versions/:versionId
POST /api/v1/operations/catalogs/:catalogCode/versions
POST /api/v1/operations/catalogs/:catalogCode/versions/:versionId/submit-for-approval
POST /api/v1/operations/catalogs/:catalogCode/versions/:versionId/decision
POST /api/v1/operations/catalog-ingestions
POST /api/v1/operations/catalog-staging-items/decision-batch
GET  /api/v1/operations/definitions
POST /api/v1/operations/definitions/package
GET  /api/v1/operations/risk-policy/current
POST /api/v1/operations/risk-policy/ruleset-versions
POST /api/v1/operations/risk-policy/ruleset-versions/:rulesetVersionId/activate
GET  /api/v1/operations/data-governance/policies
POST /api/v1/operations/data-governance/policy-package
```

### Decisiones técnicas

```txt
- No se crearon tablas nuevas.
- No se agregaron endpoints CRUD por tabla.
- Los endpoints de escritura usan X-Idempotency-Key.
- Las escrituras compuestas usan transacciones Sequelize.
- Se agregó auditoría operativa y data_change_logs en operaciones críticas.
- Se documentó body recomendado, respuesta, tablas afectadas y motivo de cada endpoint.
- Se agregaron smoke tests en docs/testing/smoke-tests.md.
```

### Validación

```txt
yarn type-check: OK
yarn build: OK
yarn test: OK con Node test runner nativo.
```

---

# Patch QA + Runtime Hardening

## Implementado

- Tabla y modelo `idempotency_keys`.
- Interceptor global de idempotencia para `POST|PUT|PATCH|DELETE` cuando existe `X-Idempotency-Key`.
- Tabla y modelo `outbox_events`.
- Interceptor global de outbox técnico para comandos API completados.
- Tabla y modelo `system_job_runs`.
- Módulo `runtime-jobs` con jobs internos seguros:
  - `POST /api/v1/operations/jobs/process-outbox`
  - `POST /api/v1/operations/jobs/expire-stale-sessions`
  - `POST /api/v1/operations/jobs/apply-retention-policies`
  - `POST /api/v1/operations/jobs/recalculate-data-quality`
- Scripts smoke ejecutables:
  - `yarn smoke`
  - `yarn smoke:sessions`
  - `yarn smoke:catalog`
  - `yarn smoke:runtime`
- Script de test formal con Node test runner:
  - `yarn test`
  - `yarn test:unit`
- Utilidad de redacción de datos sensibles para hashes/idempotencia/outbox.

## Decisión técnica

No se implementaron integraciones con proveedores reales. Outbox y jobs quedan preparados para conectar luego SMS, WhatsApp, email, push, KYC, IP intelligence o device intelligence sin acoplar esas llamadas a las transacciones principales.

## Validaciones ejecutadas en este patch

```bash
yarn type-check
yarn build
yarn test
```

## Pendiente de validar localmente con PostgreSQL

```bash
yarn db:migration:up
yarn db:seed:up
yarn start:dev
yarn smoke
```

No se ejecutó PostgreSQL real dentro de este entorno de generación del ZIP.

## Patch 2.0 — Event-driven messaging core

Implementado:

- Extensión incremental de `outbox_events`.
- `EventsModule` con catálogo, publicación, retry, cancel y procesamiento.
- `NotificationsModule` con templates, mensajes, deliveries, preferencias y device tokens.
- Adapter pattern para canales internos/externos.
- Adapters configurables reales para `in_app`, `email`, `push`, `sms`, `whatsapp` con providers desactivados por defecto para evitar envíos accidentales.
- Endpoints de operaciones y endpoints de cliente.
- Job `POST /operations/jobs/process-events`.
- Smoke tests `smoke:events` y `smoke:notifications`.

Pendiente para otro patch:

- Adapter real de Firebase Cloud Messaging.
- Adapter real de email transaccional.
- Adapter real de WhatsApp/SMS.
- Worker Redis/BullMQ si el volumen lo justifica.

## Segunda revisión Patch 2.1 — ajustes de calidad

Se realizó una segunda revisión de arquitectura sobre el Patch 2.0 de eventos y notificaciones. Ajustes aplicados:

- Se agregaron eventos de pago (`payment.reported`, `payment.confirmed`, `payment.rejected`) al catálogo central.
- Se agregaron reglas de notificación para pagos.
- `process-outbox` queda como compatibilidad para eventos técnicos y ya no debe consumir eventos de negocio registrados; esos deben procesarse con `process-events`.
- El onboarding ahora guarda email/teléfono del cliente cifrados en `customer_contact_methods.contact_value_encrypted`, manteniendo hashes para deduplicación.
- El orquestador puede resolver destinos reales de email/SMS/WhatsApp desde contactos cifrados del cliente, no solo desde payloads.
- Se deduplican tokens FCM activos antes de enviar push.

Validaciones ejecutadas en esta revisión:

```bash
yarn type-check
yarn build
```

Ambas pasaron correctamente. Los tests con `tsx` siguen dependiendo de reinstalar `node_modules` en la plataforma local correcta por el binario nativo de `esbuild`.

## Patch 2.2 — stress harness para eventos y notificaciones

Agregado:

- Script `scripts/stress/notifications.stress.ts` para crear eventos concurrentes, procesarlos por batches y verificar notificaciones `in_app`.
- Script `yarn stress:notifications`.
- Configuración de rate limit por variables `API_RATE_LIMIT_TTL_MS` y `API_RATE_LIMIT_MAX`.
- Documentación `docs/testing/stress-notifications.md` con comandos para PowerShell, Bash, local y ambiente objetivo.

Objetivo:

Validar que el core `outbox_events → process-events → notification_messages → notification_deliveries` soporte carga razonable antes de introducir BullMQ/Redis o SQS.

Observación arquitectónica:

Las pruebas locales sirven para detectar errores de flujo, idempotencia, throttling, latencia básica y fallos de procesamiento. La prueba de capacidad real debe ejecutarse en un ambiente similar al de despliegue, con PostgreSQL, CPU, memoria, red y configuración equivalentes.

## Patch 2.3 — auditoría de calidad del stress harness

Se auditó el Patch 2.2 como si fuera una herramienta que se ejecutará en staging o ambiente objetivo.

Deficiencias detectadas y corregidas:

- La verificación por fecha podía mezclar resultados de pruebas simultáneas del mismo customer.
- El script no permitía usar JWT reales del ambiente objetivo y dependía del secreto local.
- No había timeout HTTP; una request colgada podía dejar la prueba bloqueada.
- No había retries controlados para errores transitorios de red o throttling.
- No existía filtro `correlationId` en listados de eventos y mensajes.
- El reporte no verificaba de forma exacta los mensajes generados por el `runId`.
- No había umbral opcional de p95 para creación.
- No se fallaba explícitamente si quedaban eventos `failed` del run.

Correcciones aplicadas:

- `GET /operations/events` ahora soporta filtro `correlationId`.
- `GET /operations/notifications/messages` ahora soporta filtro `correlationId`.
- `scripts/stress/notifications.stress.ts` verifica eventos y mensajes exactos por `correlationId/runId`.
- Se agregaron `STRESS_ADMIN_TOKEN`, `STRESS_CUSTOMER_TOKEN`, timeout HTTP y retries.
- Se agregó `STRESS_MAX_PROCESS_FAILED`, por defecto `0`.
- Se agregó `STRESS_MAX_P95_CREATE_MS`, opcional.
- Se actualizó documentación de stress y endpoints.

Validaciones ejecutadas:

```bash
yarn type-check
yarn build
yarn test
```

Resultado: OK.


## Patch 2.4 — segunda auditoría de stress y uso con Yarn

Se repitió la revisión de calidad sobre el stress harness y el flujo DB-backed de eventos.

Deficiencias encontradas y corregidas:

- `process-events` todavía podía tener carrera si dos ejecuciones reclamaban el mismo evento al mismo tiempo. Se corrigió con claim atómico en PostgreSQL usando `FOR UPDATE SKIP LOCKED`.
- `process-events` podía seleccionar eventos técnicos si quedaban pendientes en `outbox_events`. Ahora solo procesa eventos registrados en `EVENT_REGISTRY`.
- `process-outbox` no estaba filtrando por tenant en la consulta de eventos técnicos. Ahora respeta `_tenant_id`.
- El stress script aceptaba `STRESS_PROCESS_BATCH` mayor al máximo del endpoint. Ahora falla temprano si supera `500`.
- La documentación todavía tenía comandos heredados con `npm`. Se corrigió a `yarn` y se dejó `packageManager: yarn@1.22.22`.

Validaciones ejecutadas en este entorno:

```bash
yarn type-check # equivalente ejecutado vía script de package.json por limitación de Corepack en el contenedor
yarn build      # equivalente ejecutado vía script de package.json por limitación de Corepack en el contenedor
yarn test       # equivalente ejecutado vía script de package.json por limitación de Corepack en el contenedor
```

Resultado lógico de scripts: OK. El contenedor no pudo descargar Yarn por restricción DNS/Corepack, pero los mismos scripts definidos para Yarn (`type-check`, `build`, `test`) pasaron correctamente.
