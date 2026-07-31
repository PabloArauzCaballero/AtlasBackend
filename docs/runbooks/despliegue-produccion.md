# Runbook: checklist de despliegue a producción

Pasos para llevar AtlasBackend a producción de forma segura. Derivado de las validaciones que el
propio `src/config/env.ts` hace al arrancar (el proceso **se niega a iniciar** si faltan) y de las
features añadidas en las Fases 3.3/3.4/4.2 del plan 10/10.

> Inventario completo de credenciales —qué falta, quién la provee y qué se apaga sin ella— en
> [docs/config/credenciales-requeridas.md](../config/credenciales-requeridas.md).

## 1. Variables de entorno obligatorias en producción

El arranque **falla con un mensaje claro** si alguna de estas no está bien configurada
(`NODE_ENV=production`):

- [ ] `JWT_ACCESS_TOKEN_SECRET` — un secreto real (≥32 chars), **no** el valor por defecto.
- [ ] `NOTIFICATION_TOKEN_ENCRYPTION_KEY` — real, **distinto** del de ejemplo y **distinto** de
      `JWT_ACCESS_TOKEN_SECRET`.
- [ ] `REDIS_URL` — **requerido**: sin Redis el rate limiting solo protege por instancia
      (ver [ADR-0002](../adr/0002-redis-solo-en-produccion.md)).
- [ ] `DB_SSL=true` con `DB_SSL_REJECT_UNAUTHORIZED=true` (validación de certificado de PostgreSQL).
- [ ] `CORS_ORIGINS` / `INTERNAL_FRONTEND_ORIGIN` apuntando a los orígenes reales del frontend.

## 2. Base de datos: migraciones

- [ ] Correr `yarn db:migration:up` con la identidad de migración (`DB_MIGRATION_USER`, sin que el
      runtime `atlas_app_rw` tenga DDL).
- [ ] Incluye la migración **`mfa_enabled` en `auth_credentials`** (Fase 4.2, columna booleana con
      default `false` — no afecta a credenciales existentes).
- [ ] Bootstrap de roles de mínimo privilegio: `ops/postgres/bootstrap-roles.sql` + `grants.sql`,
      verificado con `yarn check:db-privileges`.

## 3. Cifrado de PII con KMS (Fase 3.3)

Opcional pero **recomendado en producción** (el proveedor `local` protege con una master key local,
no con un HSM):

- [ ] Instalar `@aws-sdk/client-kms` en la imagen final (el proveedor lo importa dinámicamente; sin
      él, con KMS configurado, las escrituras de PII fallan).
- [ ] Configurar `KMS_KEY_ID` (ARN/alias de la CMK) + `AWS_REGION`.
- [ ] Probar la rotación en staging con el [runbook de rotación](rotacion-de-claves.md) antes del
      corte. Los valores previos cifrados con `local` se siguen descifrando.

## 4. Segundo factor (Fase 4.2)

- [ ] Configurar **MailSender** (`MAILSENDER_BASE_URL` + credenciales): sin correo, el 2FA interno
      cae a login de un paso y los clientes no pueden activar MFA.
- [ ] `AUTH_LOGIN_PIN_ENABLED=true` (default) para exigir 2FA a los actores internos.
- [ ] Nota: el OTP de cliente se entrega por correo; SMS y códigos de recuperación son seguimiento.

## 4-bis. Proveedores externos: prohibido servir datos simulados

Hallazgo A-02 de [la auditoría integral 2026-07-30](../audit/auditoria-integral-2026-07-30.md): los
nueve proveedores se siembran con `default_mode = 'mock_local'`, así que un despliegue que no fije
el modo explícitamente aprobaría identidades y calcularía riesgo sobre payloads inventados.

- [ ] `EXTERNAL_PROVIDERS_ALLOW_MOCK_IN_PRODUCTION=false` (default). Con `true`, la API sirve
      evidencia KYC/buró **inventada** y la persiste como features del cliente.
- [ ] Para cada proveedor que deba operar: `${CODE}_MODE=production|sandbox` + sus credenciales
      (`PRODUCTION_CREDENTIAL_REQUIREMENTS` en `external-data-policy.util.ts`). Sin ellas, el proceso
      **no arranca**.
- [ ] Los proveedores que aún no tengan integración real se dejan en `${CODE}_MODE=disabled`, no en
      modo simulado: `disabled` responde un error explícito; simulado respondía un dato falso.
- [ ] Verificar tras el arranque: el log lista cada proveedor bloqueado, y
      `GET /external-data/providers/readiness` los reporta con el blocker `*_MOCK_MODE_IN_PRODUCTION`.

## 4-ter. Trabajos de fondo

Hallazgo A-03: sin planificador, el outbox no se despacha, las sesiones caducadas no expiran y las
**políticas de retención de datos personales no se aplican nunca**.

- [ ] `RUNTIME_JOBS_SCHEDULER_ENABLED=true`.
- [ ] `REDIS_URL` configurado (ya obligatorio): sirve además para la elección de líder, de modo que
      con N instancias solo una ejecute cada tanda. `RUNTIME_JOBS_ALLOW_WITHOUT_LOCK` debe quedar en
      `false`.
- [ ] Verificar tras el despliegue que `atlas_scheduled_job_runs_total{outcome="success"}` avanza
      para los **siete** jobs, y que `AtlasRetentionJobNotRunning`,
      `AtlasNotificationRetryJobNotRunning` y `AtlasIdempotencyPurgeNotRunning` no están disparadas.
- [ ] Los dos jobs de saneamiento tienen su propia razón de ser: `retry_stuck_notifications` recoge
      los mensajes que quedaron en `pending`/`sending` cuando un proceso murió a mitad de un
      broadcast (la entrega corre fuera del request), y `purge_idempotency_keys` impide que
      `idempotency_keys` crezca sin techo. Revisar `RUNTIME_JOBS_IDEMPOTENCY_RETENTION_DAYS` (30 por
      defecto) contra la ventana de reintento real de los clientes antes del corte.

## 4-quater. Separación de roles: API y worker

Ver [background-processing.md](../architecture/background-processing.md). La MISMA imagen se
despliega con dos comandos y dos valores de `APP_ROLE`; lo que cambia es qué arranca cada proceso.

| | Réplicas de API | Worker |
|---|---|---|
| `APP_ROLE` | `api` | `worker` |
| Comando | `node dist/src/main.js` | `node dist/src/worker.js` |
| `RUNTIME_JOBS_SCHEDULER_ENABLED` | `false` | `true` |
| `SYSTEM_HEALTH_MONITOR_ENABLED` | `false` | `true` |
| Puerto | `APP_PORT` (público, tras el balanceador) | `WORKER_PROBE_PORT` (**red interna**) |
| Readiness | `/{API_PREFIX}/health/readiness` | `/health/readiness` |
| Escalado | por tráfico | 1 réplica basta; más sólo por tolerancia a fallos |

- [ ] Las dos combinaciones incoherentes las rechaza `env.ts` al arrancar (`APP_ROLE=worker` sin
      planificador, `APP_ROLE=api` con planificador). No hace falta vigilarlas a mano: el proceso no
      arranca.
- [ ] `NOTIFICATIONS_DELIVERY_MODE=deferred` **sólo** con un worker desplegado. Con `all` y sin
      worker, dejarlo en `inline`: en `deferred` nadie entregaría los mensajes.
- [ ] Publicar `WORKER_PROBE_PORT` únicamente en la red interna: expone `/metrics` sin autenticación.
- [ ] Verificar tras el despliegue que **existen las dos series**: `atlas_app_info{role="api"}` y
      `atlas_app_info{role="worker"}`. Las alertas `AtlasApiRoleAbsent` / `AtlasWorkerRoleAbsent`
      cubren el caso contrario, que de otro modo es un fallo silencioso.
- [ ] `stop_grace_period` (o `terminationGracePeriodSeconds`) del worker **mayor** que el de la API:
      una tanda de jobs en curso tarda más en cerrar limpiamente que una petición HTTP.

## 5. Observabilidad (Fase 3.4)

- [ ] `METRICS_ENABLED=true` (default). **Restringir `GET /metrics` a la red interna de scrape** —
      no exponerlo a internet (no lleva auth de aplicación).
- [ ] Trazas OpenTelemetry (opcional): `OTEL_ENABLED=true` + `OTEL_EXPORTER_OTLP_ENDPOINT` apuntando
      al collector. Apagado por defecto (cero coste).
- [ ] Cargar `ops/observability/prometheus-alerts.yml` (16 reglas) y `grafana-dashboard.json`.
- [ ] Inyectar `APP_VERSION`, `APP_COMMIT_SHA` y `APP_BUILT_AT` al construir la imagen: `GET /health`
      los reporta y son la única forma fiable de saber qué build está corriendo (hallazgo A-05).

## 6. Logs

- [ ] `LOG_FORMAT=json` (default en producción): stdout emite una línea JSON por evento, con
      `correlationId`/`traceId` y **PII redactada**. Con `pretty`, stdout sale sin redactar
      (hallazgo A-04) — usar solo en desarrollo.
- [ ] Definir retención en el destino de logs y, si se usa el visor Mongo, acotar su retención
      (`MONGO_DB_URL_CONNECTION`; ver [ADR-0003](../adr/0003-mongo-log-sync.md)). Sin PII en logs.

## 6-bis. Artefacto e imagen

- [ ] Construir con el `Dockerfile` del repositorio:
      `docker build --build-arg NODE_VERSION=$(cat .nvmrc) --build-arg APP_VERSION=... -t atlas-backend:<tag> .`
- [ ] Desplegar con [docker-compose.prod.yml](../../docker-compose.prod.yml), que orquesta los tres
      roles: `migrate` (one-shot, con la identidad DDL `DB_MIGRATION_USER`) → `api` → `worker`.
      `depends_on: migrate: condition: service_completed_successfully` impide que la API sirva contra
      un esquema a medio migrar.
      ```
      export ATLAS_IMAGE=registry.example.com/atlas-backend:<tag>
      docker compose -f docker-compose.prod.yml up -d --scale api=4 --scale worker=1
      ```
      El manifiesto **aborta** si falta cualquier secreto obligatorio: no hay ningún valor por
      defecto que permita un despliegue a medias.
- [ ] El `HEALTHCHECK` de la imagen elige puerto y ruta según `APP_ROLE`, así que la misma imagen se
      sonda correctamente siendo API o siendo worker (`ops/docker/healthcheck.mjs`).
- [ ] El `ENTRYPOINT` usa `tini` para que `SIGTERM` llegue al proceso Node: sin eso, el drenado
      ordenado no se ejecuta.
- [ ] `SHUTDOWN_DRAIN_MS` **mayor** que el intervalo del readiness probe del orquestador (15 s con un
      probe de 10 s es razonable). Durante el drenado, `/health/readiness` responde 503 y el
      balanceador retira la instancia antes de que se cierre (hallazgo A-07).
- [ ] `REQUEST_TIMEOUT_MS` (30 s por defecto) menor que el timeout del proxy/balanceador, para que
      quien corte la petición sea el backend —con su 503 medido— y no el proxy.
- [ ] `terminationGracePeriodSeconds` del orquestador mayor que `SHUTDOWN_DRAIN_MS` + el tiempo de
      cierre, o el drenado se corta a la mitad.

## 7. Gates que deben estar verdes antes de desplegar

`lint`, `format:check`, `type-check`, `type-check:tests`, `test:unit`, `test:coverage` (gate por
trinquete), `build`, `check:file-size`, **`check:migrations`**, `check:env-example`,
`check:domain-schemas`, `check:overfetching`, `codeql`, `secret-scan`, `yarn audit --level high`,
**el build de la imagen** y el job de integración (migraciones + seeders + smoke contra
Postgres/Redis reales). Ver `.github/workflows/ci.yml`.

## 8. Post-despliegue

- [ ] Smoke de salud: `GET /api/v1/health`.
- [ ] Smoke de auth (login, refresh) y un envío de notificación de prueba.
- [ ] Verificar que `GET /metrics` responde formato Prometheus desde la red de scrape.
- [ ] Confirmar que la traza end-to-end aparece en el collector (si `OTEL_ENABLED`).
- [ ] `GET /api/v1/health` devuelve el `version`/`commit` **del release que se acaba de desplegar**.
- [ ] `GET /external-data/providers/readiness`: ningún proveedor con `*_MOCK_MODE_IN_PRODUCTION`.
- [ ] A los pocos minutos, `atlas_scheduled_job_runs_total` avanza y
      `atlas_db_pool_connections{state="waiting"}` se mantiene en 0.
- [ ] Los logs recolectados llegan como JSON parseable, con `correlationId`, y sin PII en claro.
