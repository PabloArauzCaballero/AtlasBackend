# Atlas Backend — API (NestJS + Sequelize + PostgreSQL)

> **Estado real del proyecto:** este backend implementa el núcleo de Atlas: identidad y autenticación
> (clientes, comercios y personal interno), onboarding KYC, crédito, préstamos y cobros, riesgo y fraude,
> comercios y expedientes, notificaciones y eventos, soporte, proveedores externos, delegación de decisiones
> en el Motor, operaciones y herramientas internas. La documentación del repositorio se mantiene enfocada
> en operación, contratos técnicos y mantenimiento de producción.

Este README es el punto de entrada operativo del repositorio. Las cifras (módulos, rutas, jobs) viven
en `docs/` entre marcas `fig:` que `yarn check:docs-figures` vigila; aquí no se copian a mano.

## Qué es Atlas

Atlas es una fintech BNPL (Buy Now Pay Later) para Bolivia. Este repositorio contiene exclusivamente el backend y su documentación técnica.

## Stack

- Node.js 22+ (`engines.node >=22.0.0`), TypeScript strict, NestJS.
- Sequelize (`sequelize-typescript`) + PostgreSQL.
- Zod para validación de entrada (`ZodValidationPipe`). **No es universal**: hay parámetros de ruta
  (`:id` numéricos) que llegan sin validar y un id no numérico acaba en un 500 de PostgreSQL; al
  tocar un controlador, valida también sus `@Param`.
- JWT (`jsonwebtoken`) con refresh tokens propios (tabla `auth_refresh_tokens`).
- Redis (`ioredis`): rate limiting distribuido **y elección de líder del planificador de jobs**
  (ver «Procesos»). Obligatorio en producción (`REDIS_URL`, salvo el perfil `messaging`).
- Jest para pruebas (`jest.config.cjs` unitarias/e2e/arquitectura/contratos; `jest.integration.config.cjs` contra Postgres real).
- OpenAPI con `@nestjs/swagger`; el contrato versionado es `docs/endpoints/openapi.yaml`.
- ESLint + Prettier.

## Estructura

```txt
src/
├── main.ts                  # proceso API: Helmet, CORS, compresión, OpenAPI/Swagger
├── worker.ts                # proceso worker (APP_ROLE=worker): jobs, relay de eventos, entregas
├── messaging-worker.ts      # worker de mensajería (ATLAS_CAPABILITY_PROFILE=messaging)
├── app.module.ts            # módulo raíz de la API; registra los guards globales
├── bootstrap/               # composición de cada proceso (worker.module, messaging-worker.module, relay)
├── worker/                  # sonda HTTP del worker (WORKER_PROBE_PORT)
├── platform/                # outbox, relay, inbox, cola durable, leases, reloj, contratos
├── observability/           # trazas OpenTelemetry (no-op salvo OTEL_ENABLED=true)
├── config/                  # env.ts + esquemas Zod por área (env.*.schema.ts), swagger/openapi
├── common/                  # guards, decoradores, utilidades, Redis, archivos, auth compartido
├── database/                # modelos Sequelize, migraciones, seeders, migrate.ts, seed.ts
└── modules/                 # módulos de negocio (abajo)
```

### Módulos de `src/modules/`

Hoy son <!-- fig:code.modules -->44<!-- /fig --> módulos (lista autoritativa: `ls src/modules`).

| Dominio | Módulos |
| --- | --- |
| Acceso | `auth` (login/refresh/logout/2FA/recuperación/cambio de contraseña/PIN/MFA del cliente), `internal-users` (RBAC interno y `/internal/auth`, `/internal/users`), `merchant-identity` (`/merchant/auth/*`, `/merchant/users`), `sessions`, `consents` |
| Cliente | `customer-onboarding` (alta, OTP, identidad, compliance), `mobile-identity` (verificación desde el móvil + reconciliador con el Motor), `customers`, `customer-privacy`, `customer-telemetry`, `customer-device-signals` |
| Crédito | `credit` (productos, solicitudes, decisión, extractos), `loans` (libro de préstamos, cobros, reversos, mora), `loan-payment-claims` (avisos de pago), `credit-rating` (calificación regulatoria), `risk` (evaluación con ruleset versionado y callback de revisión manual), `fraud` |
| Comercios | `partner-onboarding` (expediente KYB, red comercial, QR de cobro, POS), `expedientes` (archivos por sujeto), `erp-integration` (puente firmado con el ERP) |
| Motor y terceros | `decision-engine` (cliente del Motor: crédito, riesgo, identidad, partner, privacidad), `external-data` (proveedores externos, hoy todos simulados), `assist` (proxy a AtlasAIService), `mobile-welcome-audio` |
| Comunicación | `notifications` (bandeja, plantillas, campañas, push, webhooks de Twilio/SendGrid/Brevo, correo del ERP), `mail-sender`, `events` (outbox de dominio), `app-content` (CMS público de la app) |
| Soporte y operación | `support` (mesa de ayuda, chat SSE, adjuntos; usa capas `application/` y `domain/`), `operations` (colas de revisión, decisiones manuales), `audit`, `data-quality`, `catalog-management` (rulesets y catálogos que `risk` usa para decidir) |
| Plataforma interna | `internal-portal` (`/internal/*`, `/internal/views/*`), `systems-ops` (catálogo, QA, monitor, flujos), `qa-orchestration` (corridas QA de N personas, `/systems/qa`), `workflow-catalog` (fuente única de los procesos, `/internal/processes`), `runtime-jobs`, `runtime-hardening`, `log-sync`, `health` |
| Datos | `sql-console`, `data-notebook`, `schema-management` |

Cada módulo sigue, en general, el patrón `controller → service → repository → model`, con `*.schemas.ts`
(Zod) y mappers/DTOs para no exponer modelos Sequelize. Excepciones reales: `support` y
`qa-orchestration` usan `application/` + `domain/`; y los repositorios que crecieron se dividen en
`repositories/*.ts` (existe en `sessions`, `customer-onboarding`, `customers`, `risk`, `expedientes` y
`customer-device-signals`; **`systems-ops` no la tiene**, sus repositorios son archivos planos).

## Autorización: deniega por defecto

`AppModule` registra guards globales en este orden: `ThrottlerGuard` (límite de peticiones),
`JwtAuthGuard` (sesión) y `RolesGuard` (`@Roles`). Una ruta nueva **nace cerrada**; abrirla exige
`@Public()`, que sale en el OpenAPI como `security: []` y la vigila `yarn check:auth-coverage`.

Encima de los roles existe el RBAC interno con permisos finos (`@InternalPermissions`, catálogo en
`src/modules/internal-users/internal-rbac.catalog*.ts`). **No todas las rutas lo usan**: varias solo
exigen un rol de aplicación (p. ej. el portal interno `/internal/*` y `/internal/views/*` se
autorizan por rol, no por el catálogo). Matriz generada: `docs/security/admin-rbac-matrix.md`
(`yarn docs:rbac-matrix`). Un permiso nuevo del catálogo necesita además una migración que repita el
volcado a base; si no, responde `403` en todos los entornos.

## Requisitos previos

- Node.js ≥ 22 (`.nvmrc` fija 22.16.0).
- Yarn (`packageManager` fija `yarn@1.22.22`).
- PostgreSQL accesible (local, Docker, o RDS de desarrollo).
- El runtime se conecta como el rol `atlas_app_rw` (no como propietario): créalo con
  `yarn db:roles:bootstrap` o, en una base de desarrollo nueva, `yarn db:provision:dev`.
- Redis accesible si vas a probar rate limiting distribuido o a ejecutar en más de una instancia
  (opcional en desarrollo local con una sola instancia — ver `.env.example`).

## Puesta en marcha local

```bash
# 1. Instalar dependencias
yarn install

# 2. Configurar variables de entorno
cp .env.example .env
# Editar .env: credenciales de PostgreSQL, JWT_ACCESS_TOKEN_SECRET, etc.
# ⚠️ Nunca commitear el .env real — .gitignore ya lo excluye y CI falla si aparece
#    (ver `yarn check:no-env-file`).

# 3. Migrar y sembrar
yarn db:migration:up
# Trae el conjunto publicado por la base de semillas (SEED_SOURCE_*; ver docs/database/seeds.md).
# DESTRUCTIVO sobre las tablas del manifiesto; con --if-empty no toca una base que ya tenga carga.
yarn db:seed:pull --if-empty
# Sin base de semillas: la siembra demostrativa del repositorio (upserts en el bloque 900000+).
yarn db:seed:demo

# 4. (Opcional) generar un JWT de desarrollo para probar endpoints internos sin pasar por login
yarn dev:jwt --role=admin

# 5. Validar configuración local
# Útil si Windows/PowerShell tiene NODE_ENV=production a nivel global.
yarn env:doctor

# 6. Levantar el servidor local
# Este comando fuerza NODE_ENV=development antes de cargar dist/src/main.js.
yarn start:dev
# La API queda en http://localhost:3005/api/v1  (APP_PORT por defecto: 3005)
# Swagger UI (si API_DOCS_ENABLED=true, por defecto fuera de producción): /api/v1/docs
```

### Error común: `Nest can't resolve dependencies of … (…, ?, +, +)` al arrancar

Si el arranque muere con un mensaje así:

```txt
Nest can't resolve dependencies of the RuntimeMaintenanceJobsService (IdempotencyKeyModelRepository, ?, +, +, +, OutboxEventModelRepository).
Please make sure that the argument at index [1] is available in the current module.
```

**no busques el ciclo de imports: no existe.** El módulo señalado exporta lo que debe. Lo que falta
es la metadata de decoradores (`design:paramtypes`), que NestJS necesita para resolver dependencias
por tipo y que sólo emite TypeScript con `emitDecoratorMetadata`.

La causa es el runtime: `tsx`, `esbuild-register` y `swc` sin `decoratorMetadata: true` borran los
tipos y arrancan igual. Este repositorio llegó a publicar un `start:dev:tsx` que por eso no podía
funcionar nunca; ya no existe, y `yarn check:nest-entrypoints` impide reintroducirlo. Desde el
arranque, el guard de `src/common/bootstrap/decorator-metadata.guard.ts` corta antes con un mensaje
que dice esto mismo.

Arranca siempre con el código compilado: `yarn start:dev` en local, `yarn start` / `yarn start:prod`
en despliegue. `tsx` sigue siendo correcto para scripts que no construyen un contexto Nest
(migraciones, seeds, gates).

El gate corre en CI (`Check Nest entrypoints keep decorator metadata`).

### Error común: Zod pide REDIS_URL o secretos de producción al usar `yarn start:dev`

Si ves un error como:

```txt
NOTIFICATION_TOKEN_ENCRYPTION_KEY no puede ser el valor de ejemplo en producción
REDIS_URL es requerido en producción
```

significa que tu proceso está arrancando con `NODE_ENV=production`. Para desarrollo local, usa
siempre:

```bash
yarn start:dev
```

`start:dev` fuerza `NODE_ENV=development` de forma compatible con Windows, Linux y macOS.
Producción debe arrancarse con:

```bash
yarn start:prod
# o, si ya existe dist/:
yarn start
```

En producción sí debes configurar secretos reales y Redis:

```bash
NODE_ENV=production
REDIS_URL=redis://usuario:password@host:6379
JWT_ACCESS_TOKEN_SECRET=<secreto-largo-y-unico>
NOTIFICATION_TOKEN_ENCRYPTION_KEY=<otro-secreto-largo-distinto>
```

## Comandos principales

| Comando                                    | Qué hace                                                                                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `yarn lint` / `yarn lint:fix`              | ESLint sobre `src/`, `test/`, `scripts/`.                                                                                           |
| `yarn format` / `yarn format:check`        | Prettier.                                                                                                                           |
| `yarn type-check` / `yarn type-check:tests` | `tsc --noEmit` sobre `src/` y sobre `test/` (el primero no mira `test/`; jest no comprueba tipos). Ambos van en CI.                |
| `yarn test`                                | Suite de Jest. Subconjuntos: `test:unit`, `test:contracts`, `test:architecture`, `test:integration`, `test:e2e`.                    |
| `yarn test:coverage`                       | Jest con reporte de cobertura.                                                                                                      |
| `yarn build`                               | Compila a `dist/`.                                                                                                                  |
| `yarn check:nest-entrypoints`              | Verifica que ningún script arranque un punto de entrada de Nest con un transpilador que borre la metadata de decoradores.           |
| `yarn start`                               | Levanta `dist/src/main.js` como está el entorno actual (producción si `NODE_ENV=production`).                                       |
| `yarn start:dev`                           | Compila y levanta local forzando `NODE_ENV=development` incluso si Windows tiene `NODE_ENV=production` global.                      |
| `yarn start:messaging`                     | Levanta el worker de mensajería (`dist/src/messaging-worker.js`), proceso aparte de la API y del worker de jobs.                    |
| `yarn start:prod`                          | Compila y levanta respetando configuración de producción; exige `REDIS_URL` y secretos reales.                                      |
| `yarn env:doctor`                          | Diagnostica variables críticas y explica si el entorno está en modo local o producción.                                             |
| `yarn db:migration:up` / `down` / `status` | Migraciones Sequelize/Umzug.                                                                                                        |
| `yarn db:seed:pull` / `db:seed:status`    | Trae (destructivo; `--if-empty` para no pisar) o compara el conjunto de la base de semillas `SEED_SOURCE_*` (ver `docs/database/seeds.md`). |
| `yarn db:seed:demo`                        | Siembra demostrativa del repositorio: upserts idempotentes en el bloque reservado 900000+ (`--fundamental`, `--dry-run`, `--solo`). |
| `yarn docs:openapi`                        | Compila (escribe `dist/`: córrelo en un worktree, no en el árbol compartido) y genera `docs/endpoints/openapi.yaml` desde los metadatos de Nest en modo preview, sin abrir base ni Redis. |
| `yarn docs:project`                        | Actualiza los `README.md` por carpeta y completa cabeceras JSDoc faltantes sin reemplazar documentación manual.                     |
| `yarn docs:folders` / `yarn docs:inline`   | Ejecuta por separado el inventario por carpetas o la documentación inline.                                                          |
| `yarn smoke`                               | Corre la suite de smoke tests contra un servidor real ya levantado (`BASE_URL` por defecto se deriva de `APP_PORT`/`API_PREFIX`: `http://localhost:3005/api/v1`). |
| `yarn check:no-env-file`                   | Falla si Git rastrea un `.env` real; permite el `.env` local ignorado y plantillas `.example`.                                      |
| `yarn crypto:reencrypt-pii:dry-run`        | Cuenta (sin escribir) cuántos valores de PII/tokens siguen en formato legado `v1` (clave maestra única) contra una base real.       |
| `yarn crypto:reencrypt-pii`                | Re-cifra en caliente, en lotes e idempotente, los valores `v1` a `v2` (envelope encryption).                                        |

## Autenticación

`actorType` admite `customer`, `internal_user`, `platform_user` y `merchant_user`.

- `POST /auth/login` — `{ actorType, identifier, password }`. Público.
- `POST /auth/login/pin` — acceso del cliente con PIN.
- `POST /auth/refresh` — `{ refreshToken }`. Público; rota el refresh token en cada uso.
- `POST /auth/logout` — `{ refreshToken, allDevices? }`. Público (opera sobre el refresh token).
- `POST /auth/password-reset/request` y `/confirm` — recuperación de contraseña.
- `POST /auth/password/change` y `POST /auth/pin/verify` — cambio de contraseña y verificación de PIN.
- `GET /auth/me` — sesión actual. `POST /auth/mfa` — segundo factor.
- `POST /auth/provision-credentials` — fija la contraseña inicial de un actor interno ya existente
  (rol `admin`/`platform_admin`; no crea el actor).
- `/internal/auth/*` — login del portal interno con cookies HttpOnly (`atlas_internal_access`,
  `atlas_internal_refresh`). `/merchant/auth/*` — login del portal de comercio.

El segundo factor por correo es obligatorio para `internal_user` y `platform_user`; en producción sin
canal de correo configurado responde `503`. Los clientes usan un PIN de 4 dígitos
(`isCustomerPinValid`), no una contraseña fuerte. `POST /customer-onboarding/start` crea las
credenciales e inicia el flujo de verificación de contacto, identidad, cumplimiento y elegibilidad.
Los códigos de contacto y login se almacenan hasheados, con TTL y máximo de intentos; no existe un
código fijo aceptado por runtime.

## Procesos

| Proceso            | Entrada                          | Notas                                                                              |
| ------------------ | -------------------------------- | ---------------------------------------------------------------------------------- |
| API                | `src/main.ts`                    | HTTP en `APP_PORT` (3005). `APP_ROLE` elige el rol del proceso.                    |
| Worker de jobs     | `src/worker.ts`                  | Jobs programados y colas; sonda de salud en `WORKER_PROBE_PORT`.                   |
| Worker de mensajes | `src/messaging-worker.ts`        | `yarn start:messaging`.                                                            |

Los jobs programados toman un lock de líder en Redis; sin lock no corren salvo que
`RUNTIME_JOBS_ALLOW_WITHOUT_LOCK` lo permita. En `docker-compose.prod.yml` el job `migrate` aplica las
migraciones antes de arrancar la API. Los módulos solo-HTTP se listan en `WORKER_EXCLUDED_MODULES`
(`src/bootstrap/worker.module.ts`).

## Motor de decisiones y terceros

- **Motor**: variables `DECISION_ENGINE_*` (URL, claves y artefactos). Poner el artefacto no prueba
  nada: el Motor debe haberlo publicado y desplegado.
- **Callbacks del Motor** (autenticados con `ENGINE_CALLBACK_API_KEY`):
  `/internal/credit/manual-review-callback`, `/internal/credit/bank-statement-review-callback`,
  `/internal/risk/manual-review-callback`, `/internal/identity/manual-review-callback`.
- **`external-data`**: los proveedores mock están bloqueados en producción salvo
  `EXTERNAL_PROVIDERS_ALLOW_MOCK_IN_PRODUCTION`.
- `AUTH_BROKER_*` se leen de `process.env` y no están en `.env.example`. `ERP_EVENTS_*` configura los
  eventos hacia el ERP; `EXPEDIENTES_ENABLED` activa los expedientes.
- Webhooks de notificaciones (proveedores de correo/SMS/WhatsApp), `DB_READ_ENABLED` (réplica de
  lectura) y las variables de QA están documentados en `docs/config/environment.md`.
- Las fechas se guardan y se serializan en UTC.

## CI

`.github/workflows/ci.yml` es la fuente de verdad. Antes de empujar, corre en local los mismos gates:
`type-check` y `type-check:tests`, `lint`, `format:check`, `check:file-size`, `check:architecture`,
`check:auth-coverage`, `check:migrations`, `check:openapi`, `check:docs-figures`, `check:docs-drift`,
`check:rbac-matrix` y `test:coverage` (umbral global y por módulo). Si cambias rutas: `yarn docs:openapi`
y la golden de `test/contracts/http/public-compatibility.spec.ts`.

## Documentación relacionada

- `docs/architecture/architecture.md` / `docs/architecture/flows.md` — arquitectura y flujos existentes.
- `docs/config/environment.md` — variables de entorno y reglas de configuración.
- `docs/database/migrations.md` / `docs/database/seeds.md` — operación de base de datos.
- `docs/endpoints/endpoints.md` — documentación narrativa de endpoints, complementaria al OpenAPI generado.
- `docs/testing/smoke-tests.md` — guía práctica para validar el backend levantado.
- `docs/README.md` y los `README.md` de cada carpeta — propósito de negocio, responsabilidad de sistema e inventario local.

## Seguridad — reglas no negociables

- Nunca commitear `.env` real (CI lo bloquea).
- Contraseñas siempre con Argon2id (`src/common/utils/crypto/password.util.ts`), nunca en texto plano ni loggeadas.
- Ninguna tabla financiera/de auditoría se borra o sobrescribe; se usan movimientos, reversos o eventos.
- La entrada externa se valida con Zod antes de tocar la base de datos (no todos los `@Param` pasan por Zod: valídalos al añadir rutas).
- No exponer modelos Sequelize directamente en respuestas HTTP; usar mappers.
