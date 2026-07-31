# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
Este proyecto es privado (`UNLICENSED`); el versionado sigue `package.json`.

## [No publicado]

### Auditoría integral 2026-07-30

Ocho fases de endurecimiento derivadas de
[`docs/audit/auditoria-integral-2026-07-30.md`](docs/audit/auditoria-integral-2026-07-30.md). Los
gates existentes estaban todos en verde y aun así el sistema no era desplegable desde cero: ese es el
hilo del que tira esta auditoría.

#### Corregido — bloqueaban producción

- **Provisionar un entorno nuevo era imposible** (A-01, regresión de ATLAS-TECH-001): la migración
  monolítica `20260626154044-create-atlas-user-intelligence-fraud-schema-v5-2-1.ts` seguía en el
  repositorio creando las mismas 86 tablas que `schema-part-0..9`, y ganaba el orden alfabético de
  Umzug. Eliminada tras verificar la equivalencia (86/86 tablas, 244/244 FKs, 5/5 checks, 385/385
  índices).
- **En producción los proveedores externos servían datos fabricados** (A-02): los nueve se siembran
  con `default_mode = 'mock_local'` y `toMode()` caía ahí, así que un despliegue que no fijara
  `${CODE}_MODE` verificaba identidades y calculaba riesgo sobre payloads inventados, persistidos
  como features del cliente. Ahora falla cerrado salvo escape hatch explícito.
- **Ningún trabajo de fondo se ejecutaba solo** (A-03): sin planificador, el outbox no se despachaba,
  las sesiones caducadas no expiraban y las políticas de retención de datos personales no se
  aplicaban nunca.
- **La PII se redactaba en el archivo de log pero no en stdout** (A-04) — el canal que recoge el
  agregador en un contenedor. Y stdout no era parseable ni correlacionable.

#### Añadido

- `yarn check:migrations`: gate estático (sin base de datos) que bloquea colisiones de tabla no
  idempotentes, prefijos de timestamp repetidos sin excepción documentada, migraciones sin `down` y
  nombres fuera de patrón.
- `yarn check:tenant-header`: trinquete que congela la duplicación de `@Headers('x-tenant-id')`
  (ATLAS-SEC-002) en 26 controllers / 129 usos.
- Dos jobs de saneamiento que faltaban: `retry-stuck-notifications` (los mensajes de un broadcast
  interrumpido se quedaban en `pending` para siempre, porque la entrega corre fuera del request) y
  `purge-idempotency-keys` (`idempotency_keys` solo crecía; nunca se borran las `processing`).
- `RuntimeJobsSchedulerService`: ejecuta los siete jobs por su cuenta, opt-in
  (`RUNTIME_JOBS_SCHEDULER_ENABLED`), con elección de líder por Redis `SET NX PX` y fail-closed en
  producción sin lock. Sin dependencia nueva.
- `LOG_FORMAT=json` (default en producción): stdout emite una línea JSON por evento, con
  `correlationId`/`traceId` y la misma redacción de PII que el archivo.
- `/health` reporta `version`, `commit` y `builtAt` reales (`src/config/build-info.ts`).
- Métricas `atlas_db_pool_connections`, `atlas_auth_attempts_total` y
  `atlas_scheduled_job_runs_total`, con 8 reglas de alerta nuevas (16 en total).
- Drenado ordenado en `SIGTERM` (`SHUTDOWN_DRAIN_MS`: readiness a 503 antes de cerrar), cierre
  ordenado de Redis y techo de duración por petición (`REQUEST_TIMEOUT_MS`).
- `Dockerfile` multi-stage con `tini`, usuario sin privilegios y `HEALTHCHECK` contra readiness;
  `.dockerignore`; `docker-compose.yml` con las versiones de Postgres/Redis/Mongo de CI; job
  `docker-image` en el workflow.

#### Seguridad

- El token de acceso lleva y exige `iss`/`aud` (`JWT_ISSUER`/`JWT_AUDIENCE`), centralizados en
  `jwt-claims.util.ts`. **Al desplegar, los tokens de acceso emitidos antes se rechazan durante como
  mucho `JWT_ACCESS_TOKEN_EXPIRES_IN`; los refresh tokens son opacos y los clientes renuevan solos.**
- `sanitizeUrlForLog`: el filtro de excepciones ya no registra los valores de la query string.
- Eliminada la dependencia `joi`, sin usar en todo el repositorio.

### Añadido

- **Gate de cobertura por trinquete** (`jest.config.cjs`): umbrales fijados en el nivel real medido,
  con umbrales propios para `auth`, `risk`, `fraud` y `crypto`. Un PR que baje la cobertura falla.
  Ver `docs/testing/coverage-ratchet.md`.
- **Job `coverage` en CI**: corre la suite completa (110 suites / 1006 tests) sin límite artificial de
  proceso y publica el reporte HTML como artefacto `atlas-coverage`.
- **Tests del rate limit distribuido** (`RedisThrottlerStorage`) y del **interceptor de idempotencia**:
  eran columna vertebral de seguridad y no tenían prueba directa (solo existía el test del hash de
  idempotencia). Cubren ventana fija, bloqueo, namespacing por throttler, degradación sin Redis,
  replay, persistencia previa a la respuesta y aislamiento por tenant/actor.
- **Orden aleatorizado en CI** (`yarn test:unit:randomized`): una dependencia de orden entre tests
  falla el PR en vez de volverse flakiness. Verificado sin acoplamiento (suite completa aleatorizada).
- **Gate de tamaño de archivos runtime** (`yarn check:file-size`): congela la deuda actual (35
  archivos > 300 líneas) en `.file-size-baseline.json`; falla ante archivos nuevos grandes o
  crecimiento de los existentes.
- **Reglas de complejidad en ESLint** (`complexity`, `max-depth`, `max-params`,
  `max-lines-per-function`) como `warn`, para subir a `error` conforme avance el refactor.
- **Escáneres de seguridad en CI**: CodeQL (SAST), gitleaks (secretos, con excepciones verificadas en
  `.gitleaks.toml`) y SBOM CycloneDX por build.
- **Dependabot** (`.github/dependabot.yml`) para dependencias npm y GitHub Actions.
- **Schema `read_api`** con la primera ola de 7 vistas de lectura versionadas, y `ReadQueryService` +
  pool read-only opcional (`DB_READ_ENABLED`). Ver `docs/database/read-models.md`.
- **Perfiles de seeds** (`production` / `development` / `demo` / `test`) con runner por perfil,
  tracking separado y guards de producción. Ver `docs/database/seeds.md`.
- **Roles PostgreSQL de privilegio mínimo** (`ops/postgres/*.sql`) + verificación automatizada
  (`yarn check:db-privileges`). Ver `docs/database/postgres-roles.md`.
- `yarn hash-password` para rotar credenciales de desarrollo sin versionar texto plano.
- **Gobernanza y seguridad documentadas** (Fases 6.1/4.3/3.1): 5 ADRs en `docs/adr/` (outbox en
  PostgreSQL, Redis prod-only, Mongo/log-sync, KMS envelope encryption, paginación por cursor),
  runbooks operativos (`docs/runbooks/`: rotación de claves, respuesta a incidentes,
  expiración/revocación de sesiones), `SECURITY.md`, threat model STRIDE (`docs/security/`) y
  `CONTRIBUTING.md` con el flujo de gates.
- **Cifrado de PII con KMS real** (Fase 3.3): envelope encryption con proveedor de cifrado ACTIVO;
  si `KMS_KEY_ID`+`AWS_REGION` están presentes, `main.ts` activa AWS KMS y las escrituras nuevas de
  PII usan data keys de KMS sin cambiar los call sites (los valores previos en `local` siguen
  descifrándose). Requiere `@aws-sdk/client-kms` en la imagen de producción. Ver `docs/adr/0004`.
- **Observabilidad** (Fase 3.4): métricas Prometheus en `GET /metrics` (`http_requests_total` +
  `http_request_duration_seconds` para SLO p50/p95/p99 e índice de error, más métricas de proceso) y
  bootstrap de trazas OpenTelemetry **opt-in** (`OTEL_ENABLED`, no-op por defecto). Config por
  `process.env` (`METRICS_ENABLED`, `OTEL_*`).
- **Métricas de negocio** (Fase 3.4): `atlas_circuit_breaker_state{provider}` y
  `atlas_provider_calls_total{provider,outcome}` instrumentadas en `ResilientAdapterExecutorService`
  (el punto de entrada único de toda llamada saliente; `circuit_open` se distingue de `failure`
  porque no incurre costo), y `atlas_outbox_pending_events{tenant_id}` publicada por
  `RuntimeJobsService.processOutbox` reutilizando el conteo que ya calculaba (sin query extra).
- **Dashboards y alertas de SLO** (`ops/observability/`): reglas Prometheus (error 5xx, p95/p99,
  target down, breaker abierto, backlog de outbox, tasa de fallo por proveedor) y dashboard Grafana
  importable con los SLOs HTTP.
- **Segundo factor** (Fase 4.2): 2FA obligatorio para actores internos (`internal_user`/
  `platform_user`) y MFA opt-in para clientes vía `POST /auth/mfa`, ambos con OTP de un solo uso por
  correo (reutilizan el flujo de PIN existente). Nueva columna `auth_credentials.mfa_enabled`.
- **Cobertura directa de `FraudRepository`** (Fase 1.2): de 25% a 100% de funciones cubiertas del
  dominio de fraude; ratchet de `auth`/`crypto`/`fraud` subido para fijar la ganancia.

### Cambiado

- **`internal-portal.service.ts` dividido: 1341 → 152 líneas** (Fase 2.2). El archivo mezclaba
  glosario, gobierno, calidad, linaje, alertas, jobs, reportes y búsqueda en una sola clase. Ahora
  cada dominio vive en `internal-portal/application/` (ninguno supera 268 líneas) y el servicio queda
  como fachada delgada que delega. La API pública, el controller, el módulo y los tests existentes
  **no cambian**: lo garantiza `internal-portal-service-contract.spec.ts` (24 métodos + aridad) y el
  test de `business-term`, que asserta el número exacto de queries antes y después.
- **`external-data.controller.ts` dividido: 966 → 627 líneas** (Fase 2.2). El archivo no era un
  controller sino **nueve clases de controller** en un mismo archivo. Los siete verticales (kyc,
  bureau, payments, telco, facebook, whatsapp, digital-trust) se movieron a `external-data/controllers/`
  (94–233 líneas cada archivo) y los helpers compartidos a `external-data-controller.util.ts`. Rutas,
  guards, roles y orden de registro **idénticos**; lo garantiza `external-data-openapi.spec.ts`
  (~40 rutas de los 9 controllers, sin colisiones). Queda pendiente separar el controller de
  administración para bajar de 300.
- **Node alineado a `.nvmrc` (22.16.0)**: CI usa `node-version-file` y `engines` pasa a `>=22.0.0`.
  Antes CI corría en Node 20 mientras `.nvmrc` pedía 22 — divergencia silenciosa.
- `maxWorkers: '50%'` en Jest: la suite completa baja de ~168 s a ~88 s.
- El `backend` job de CI corre `test:unit` (feedback rápido); la suite completa vive en el job
  `coverage`, en paralelo.
- Ruta de auditoría por offset (`GET /operations/audit/customer/:id`) marcada como **deprecada** en
  OpenAPI; usar la variante `/feed` con cursor real.
- El seeder combinado `internal-rbac-and-pablo` se dividió: catálogo RBAC → perfil `production`;
  usuario admin de desarrollo → perfil `development`.
- **`external-data-execution.service.ts` dividido: 692 → 477 líneas** (Fase 2.2). La lógica de
  decisión de costo/cuota/circuit-breaker/idempotencia salió a `ExternalDataDecisionService` (con
  acceso acotado al repositorio) y se testea aislada. La orquestación queda en el servicio original.
- **`auth.service.ts` dividido: 683 → ~490 líneas** (Fase 2.2). Se extrajeron
  `AuthActorResolverService` (resolución de actor) y `AuthPasswordResetService` (reset de contraseña);
  el servicio delega y conserva su API pública (controller y tests sin cambios de contrato).
- **Fachada `catalog-management.repository.ts` rota por agregado** (Fase 2.3): gobierno de datos
  (`CatalogDataGovernanceRepository`, 6 tablas), definiciones (`CatalogDefinitionsRepository`, 4
  tablas) y política de riesgo (`CatalogRiskPolicyRepository`, 4 tablas) viven en repos con acceso
  acotado; la fachada delega y baja de 681 a 562 líneas (inyecta 14 dependencias, eran 25).
- **Fachada `notifications.repository.ts` rota por agregado** (Fase 2.3): plantillas
  (`NotificationTemplatesRepository`) y preferencias (`NotificationPreferencesRepository`) viven en
  repos de una sola tabla; la fachada delega y baja de 628 a 542 líneas.
- **Ratchet de cobertura subido** tras los tests nuevos: `auth` 54→60, `crypto` 83→88, `fraud`
  funciones 25→95. Ver `docs/testing/coverage-ratchet.md`.

### Corregido

- **`RedisThrottlerStorage`: unidades inconsistentes en `timeToExpire`.** La rama degradada (sin
  Redis) devolvía el TTL en milisegundos crudos mientras el resto del método devuelve segundos, lo
  que producía un `Retry-After` ~1000× mayor (60 000 s ≈ 16 h para una ventana de 60 s). Detectado
  por el test nuevo de rate limit distribuido.

### Seguridad

- El ruleset/modelo de riesgo del baseline BNPL dejó de depender de un seeder demo: `db:seed:prod` es
  autosuficiente y no arrastra datos ficticios.
