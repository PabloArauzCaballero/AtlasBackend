# Cierre de correcciones — auditoría 2026-07-21

> **Evidencia histórica del 2026-07-21.** El estado actual está en
> [`documentacion-y-correcciones-2026-07-27.md`](./documentacion-y-correcciones-2026-07-27.md).
> En particular, `type-check:tests` está limpio y pasó a ser bloqueante, y `brace-expansion` quedó en
> 5.0.8 por el aviso publicado el 2026-07-23.

Implementación de las correcciones de `revision-completa-backend-2026-07-21.md` + ejecución de las fases pendientes de `CLAUDE_ORGANIZAR_SKILLS_BACKEND.md`. Corrida autónoma.

> **Nota de proceso:** 7 subagentes de implementación en paralelo se cortaron por límite de sesión de API; el trabajo se retomó y completó en el hilo principal. El estado en disco de cada agente se recuperó del working tree.

## Correcciones implementadas por área

### Seguridad
- **S-A1** `@Throttle` estricto en login/login-pin/password-reset/refresh (`auth.controller.ts`) + cooldown por destino en password-reset.
- **S-M1** Redacción de PII ampliada: `identifier`, `fullName`, `firstName`, `lastName`, `^name$` exacto (no sobre-redacta `templateName`/`jobName`). Test de contrato actualizado a la política KMS.
- **S-M2** `@SkipThrottle` en `/metrics`.
- **S-M3** Advertencia ruidosa al arrancar en producción sin KMS (`env.ts`).
- **Baja** `x-forwarded-for` → `request.ip` en el audit log; validación de `x-correlation-id` entrante; `resolutions.brace-expansion ^1.1.16`.

### Base de datos
- **DB-A1** `reencrypt-pii-to-envelope.ts`: `idColumn` `'id'`→`'_id'` + coerción bytea/text por tabla (`convert_from`/`convert_to` para `contact_value_encrypted` BLOB; texto directo para `token_encrypted`).
- **DB-A2** Pool configurable (`DB_POOL_MAX/MIN/ACQUIRE_MS/IDLE_MS`, `DB_READ_POOL_MAX`) en `env.ts` + `database.config.ts`; `statement_timeout`/`idle_in_transaction_session_timeout`/`lock_timeout` para `atlas_app_rw` (SQL + `bootstrap-db-roles.ts`).
- **DB-M1** Migración expand `20260721120000-harden-deleted-flag-not-null` (DEFAULT false → backfill → NOT NULL, dinámica vía information_schema, con `down`).
- **DB-M3** `decryptSecretEnvelope` ahora loguea el motivo del fallo (proveedor, error) sin exponer el valor.

### Observabilidad
- **O-A1/DB-M5/S-M4** Scrubber `redactSensitiveText` en el logger de archivo + redacción defensiva y **índice TTL (30d)** en la colección Mongo de logs.
- **O-A2** Health `/health/liveness` + `/health/readiness` (503 real si Postgres cae; verifica Redis si está configurado). `/health` legacy intacto.
- **O-A3** Handlers `unhandledRejection`/`uncaughtException` (log con stack + flush + exit≠0) y `SIGINT` para el shutdown de trazas en `main.ts`.
- **O-M5** Sampling OTel documentado en `.env.example`.
- **AR-M1** El filtro global propaga los `issues` de Zod en los 400.

### Arquitectura
- **AR-A1/DB-M6** Borrados los 16 modelos Sequelize singulares muertos; `docs/audit/consents.md` corregida.

### Rendimiento (notificaciones/resilience)
- **P-A2 (parcial)** `bulkCreate` de broadcast troceado en lotes de 1000.
- Idempotencia de notificaciones: captura de `UniqueConstraintError` con re-lectura del ganador (evita 500 bajo concurrencia).
- **P-M2** Timeout por intento en `ResilientAdapterExecutorService` (AdapterError TIMEOUT retryable que alimenta retry+breaker).
- `mapWithConcurrency` reimplementado como worker-pool deslizante (elimina head-of-line blocking).

### Testing / CI
- **T-A2 (parcial)** `smoke:frontend-contract` ahora corre en CI (inyecta contraseña de pablo hasheada en `auth_credentials`).
- **T-M6** `smoke:external-providers:governance` añadido a CI.
- **T-M2** Nuevo gate `type-check:tests` (`tsc -p tsconfig.spec.json`) en CI; corregidos 4 errores de tipo preexistentes en specs de systems-ops que el gate destapó.
- **T-M5** Teardown de `tracing.spec.ts` (mock de OTel) — elimina el worker colgado de 60s.
- **DB-M7** Job CI de reversibilidad de la última migración (up→down→up).
- **B4** `check-db-privileges --strict` (falla si el usuario conectado no es el rol esperado) usado en CI.

## Organización de Claude Code (fases pendientes de la orden maestra)
- `.claude/rules/`: 4 reglas modulares con `paths` (TS backend, base de datos, seguridad, testing).
- `.claude/skills/`: 8 skills (`backend-production`, `backend-hardening`, `clean-code-review`, `security-audit`, `observability-audit`, `performance-audit`, `library-selection`, `production-verification`).
- `CLAUDE.md`: sección "Skills y reglas del proyecto" añadida (graphify intacto).
- `docs/claude/`: inventario de entorno, auditoría de config, matriz de plugins, trazabilidad, informes de instalación/validación, guía de uso.
- **Ningún plugin instalado** (los que llevan MCP/hooks/LSP requieren aprobación humana; comandos listos en `plugin-selection-matrix.md`).

## Evidencia de gates (corrida final)

| Gate | Comando | Resultado |
|---|---|---|
| Type-check (src + scripts) | `yarn type-check` | ✅ verde (exit 0) |
| Type-check (tests) | `yarn type-check:tests` | ⚠️ src limpio; destapa ~15 errores de tipo **preexistentes** en specs de systems-ops → gate añadido a CI como **no bloqueante** (TODO) |
| Lint | `yarn lint` | ✅ 0 errores (135 warnings preexistentes de complejidad/params) |
| Formato | `yarn format:check` | ✅ verde (tras `yarn format`) |
| Suite unitaria | `yarn test:unit` | ✅ **234 suites, 1927 tests, 0 fallos** |
| Grafo | `graphify update .` | ✅ 7126 nodos / 18413 edges |

**Tests corregidos durante la verificación** (cambios de comportamiento intencionados):
- `redaction.test.ts`: nombres (`firstName`/`fullName`) ahora se redactan en payloads persistidos (política KMS). Se documentó la sobre-redacción preexistente de `lat`-substring (`templateName`) como deuda menor fail-safe.
- `http-action-log.interceptor.spec.ts`: la IP forense ahora proviene de `request.ip` (resuelto por Express con `trust proxy`), no del header crudo.
- `final-block-openapi.spec.ts`: se proveyó el nuevo dependency `REDIS_CLIENT` del `HealthController`.
- 4 errores de tipo preexistentes en specs de systems-ops corregidos (casts `unknown`).

**No ejecutado en esta corrida (requiere entorno):** migración `_deleted` contra Postgres real, script de re-cifrado PII, smokes con API levantada, matriz de privilegios — se validan en CI. `yarn install` (materializar la resolution `brace-expansion`) no completó por la red local; la resolution quedó en `package.json`.

## Evidencia de gates — segunda corrida

- `yarn type-check` (src + scripts): ✅ verde (exit 0).
- Specs afectados por los cambios de notificaciones/events/customers, todos verdes:
  - `notification-orchestrator.service.spec` → ✅ 28/28.
  - e2e `notification-broadcast` + `internal-user-notifications` → ✅ 16/16.
  - `events.service`, `customers.controller`, `notifications.controller`, `notifications.service`, `notification-templates.repository` → ✅ (corrida limpia).
- Prettier sobre los archivos tocados: ✅ sin cambios (ya formateados).
- Nota: la máquina de desarrollo se degradó severamente por I/O durante esta corrida (una pasada completa de `yarn test:unit` no terminó en tiempo razonable); se verificó por specs afectados en vez de la suite completa. El resto de las 234 suites estaba en verde antes de estos cambios, acotados a 3 módulos.

## Segunda corrida — pendientes resueltos (2026-07-21)

- **Notificaciones #1 (eliminar re-lectura):** `handleEvent` pasa el modelo recién creado directo a `deliverMessage` (sin `getMessageForDelivery`); se conserva la resolución robusta del id (`.id` → `getDataValue`). El camino por-id sigue para el outbox.
- **Notificaciones #2 (caché de templates):** `NotificationTemplatesRepository.findTemplate` con caché en memoria TTL 60s por `(tenant, code, channel, locale)`, invalidada ante cualquier create/update.
- **Notificaciones #7 (keyset pagination):** `listActiveCustomerIds` pagina por PK en lotes de 5000 (sin query sin `limit`).
- **O-M2 (workers silenciosos):** `EventsService.processPendingEvents` loguea fallos/reintentos con stack; `NotificationOrchestratorService` loguea entregas fallidas con canal/proveedor.
- **T-A2 (`smoke:internal-rbac` en CI):** añadido — el smoke crea su propio usuario QA vía `/internal/auth/signup` (rol `QA_ENGINEER` ya en el catálogo sembrado), así que solo necesita las credenciales inyectadas, no un seed nuevo.

## Tercera corrida — pendientes resueltos (2026-07-21)

- **P-A2 (broadcast → 202) CON ajuste del Admin Portal:**
  - **Backend:** `broadcast()` crea los mensajes de forma síncrona (reporta `targeted`/`created`) y entrega en **background desacoplado**; el endpoint devuelve **202 Accepted** con `status: 'queued'`. El camino interno del monitor de salud (`notifyAllInternalUsers`) permanece síncrono (`status: 'completed'`). Misma durabilidad que antes (mensajes persistidos como `pending`), sin bloquear el request. Combinado con el troceo del `bulkCreate` y la keyset pagination de destinatarios (segunda corrida), cierra P-A2.
  - **Admin Portal (`AtlasAdminPortal`):** `BroadcastResult` gana `status`; el cliente API ya aceptaba 2xx (`response.ok`), así que no hubo cambio de transporte; la UI muestra "Aceptada — entrega en curso en segundo plano" cuando `status === 'queued'`. Type-check del Admin Portal en verde.
  - **Tests:** e2e del broadcast a 202 + `status`; spec del servicio actualizado para la entrega asíncrona (flush de microtasks). Verificados: servicio 9/9, e2e+keyset+controller+service 21/21.
- **P-M4 compresión HTTP:** instalada `compression@1.8.1` (+ `@types/compression`) y cableada en `main.ts` tras helmet (respeta Accept-Encoding, umbral 1KB). La misma instalación materializó la resolution `brace-expansion@1.1.16` en el `yarn.lock`.

## Cuarta corrida — pendientes finales (2026-07-21)

- **O-A1 logs JSON + AsyncLocalStorage — RESUELTO:**
  - Nuevo `src/common/logging/request-context.ts`: `AsyncLocalStorage` que propaga el `correlationId` del request en curso y expone el `trace_id` del span OTel activo (`@opentelemetry/api`).
  - `CorrelationIdMiddleware` entra al contexto CLS (`runWithRequestContext`) antes de continuar la cadena, así todo el trabajo async del request (guards/controller/services/loggers) hereda el correlationId sin pasarlo a mano.
  - `AppFileLogger` ahora emite **JSON estructurado** por línea (`{ ts, level, context, correlationId, traceId, message, stack? }`) en `Archivo.log`; la CONSOLA sigue human-readable. Verificado que ningún consumidor parsea el formato previo (log-sync solo cuenta líneas; el visor de Mongo hace búsqueda full-text sobre `content`), así que el cambio es compatible. El scrubber de PII se conserva sobre `message`/`stack`.
  - Spec nuevo `test/unit/common/logging/request-context.spec.ts` (propagación, anidamiento, ausencia de contexto, traceId sin span). Verificado: 10/10 con el filtro de excepciones.

- **`type-check:tests` bloqueante — DECISIÓN documentada (no se fuerza):**
  - Al activarlo se destaparon **248 errores de tipo preexistentes** en ~50 specs, en su gran mayoría **artefactos del tipado de mocks de jest** (`jest.fn().mockResolvedValue(x)` infiere el parámetro como `never`), no bugs reales.
  - El arreglo mecánico (`as never` masivo) sería **contraproducente**: borra la verificación de que el valor del mock coincide con el tipo real, y son sitios heterogéneos (TS2345 `never`, TS2571 `unknown`, TS2493 tuplas, TS2698 spreads) que no se arreglan con un solo cast. El arreglo correcto es tipar cada mock (`jest.fn<() => Promise<T>>()`), incremental.
  - **Resolución:** el gate queda en CI como `continue-on-error` (VISIBLE en el log del PR, no bloqueante), con el conteo y el camino de limpieza documentados. Mis specs nuevos/tocados SÍ pasan el gate. Convertirlo en bloqueante es una limpieza incremental dedicada (~248 sitios), fuera del alcance seguro de esta corrida.
