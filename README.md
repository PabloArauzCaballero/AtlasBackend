# Atlas Backend — API (NestJS + Sequelize + PostgreSQL)

> **Estado real del proyecto:** este backend implementa la base de Atlas para identidad,
> autenticación, sesiones, consentimientos, privacidad, telemetría, riesgo, fraude, operaciones,
> catálogo de datos, auditoría, notificaciones, eventos y proveedores externos. La documentación
> del repositorio se mantiene enfocada en operación, contratos técnicos y mantenimiento de
> producción.

Este README es el punto de entrada operativo del repositorio.

## Qué es Atlas

Atlas es una fintech BNPL (Buy Now Pay Later) para Bolivia. Este repositorio contiene exclusivamente el backend y su documentación técnica mínima.

## Stack

- Node.js 20+, TypeScript strict, NestJS.
- Sequelize (`sequelize-typescript`) + PostgreSQL.
- Zod para validación de entrada en todos los controladores.
- JWT (`jsonwebtoken`) para auth, con refresh tokens propios (tabla `auth_refresh_tokens`).
- Redis (`ioredis`) para rate limiting distribuido — obligatorio en producción, opcional en
  desarrollo con una sola instancia (ver `src/config/env.ts`).
- Jest para pruebas.
- Swagger/OpenAPI (`@nestjs/swagger`) para documentación de API.
- ESLint + Prettier.

## Estructura

```txt
src/
├── main.ts                  # bootstrap, Helmet, CORS, Swagger
├── app.module.ts            # módulo raíz
├── config/                  # env.ts (validación Zod de variables de entorno), swagger.ts
├── common/                  # guards, decoradores, utilidades compartidas, Redis, auth compartido
├── database/                # modelos Sequelize, migraciones, seeders
└── modules/
    ├── auth/                  # login, refresh, logout, provisión de credenciales internas
    ├── customers/             # perfil "me" del cliente
    ├── customer-onboarding/   # registro (= alta de cliente), KYC básico, verificación de contacto
    ├── customer-privacy/      # consentimientos, solicitudes de datos personales
    ├── customer-telemetry/    # señales de dispositivo/comportamiento (privacidad estricta)
    ├── consents/              # documentos de consentimiento
    ├── sessions/              # sesiones de cliente, heartbeats, señales de riesgo por sesión
    │                          # (repositorio dividido en src/modules/sessions/repositories/*)
    ├── risk/                  # scoring/evaluación de riesgo (base de Fase 2)
    ├── fraud/                 # casos de fraude, decisión y watchlist
    ├── catalog-management/    # catálogos de contexto/reglas versionadas (base de Fase 2)
    ├── external-data/         # adapters a proveedores externos (burós de crédito, KYC)
    ├── operations/            # panel interno de operaciones (base de Fase 2)
    ├── data-quality/          # reglas e incidencias de calidad de datos
    ├── audit/                 # auditoría consolidada por cliente (feed unificado por cursor
    │                          # sobre la vista `audit_event_feed`, además del listado por página)
    ├── notifications/         # plantillas, mensajes, canales (SMS/push/email/WhatsApp)
    ├── events/                # outbox de eventos de negocio
    ├── runtime-hardening/     # idempotencia, interceptors de comando
    ├── runtime-jobs/          # jobs operativos (outbox técnico, retención, expiración de sesión)
    ├── systems-ops/           # catálogo de endpoints/herramientas, suites de QA, cola de revisión
    ├── log-sync/              # sincroniza Archivo.log a MongoDB y expone su lectura (GET /systems/logs/mongo)
    └── health/                # healthcheck
```

Cada módulo sigue el patrón `controller → service → repository → model`, con `*.schemas.ts` (Zod)
y `*.mapper.ts` para no exponer modelos Sequelize directamente en las respuestas. Los repositorios
que crecieron más allá de una sola responsabilidad clara (`sessions`, `customer-onboarding`,
`systems-ops`) se dividen en `repositories/*.ts` por dominio, con una fachada delgada
(`<módulo>.repository.ts`) que mantiene la misma API pública.

## Requisitos previos

- Node.js ≥ 20. Recomendado para desarrollo: Node.js 22 LTS (`.nvmrc`).
- Yarn (`packageManager` fija `yarn@1.22.22`).
- PostgreSQL accesible (local, Docker, o RDS de desarrollo).
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

# 3. Migrar y sembrar datos mínimos de desarrollo
yarn db:migration:up
yarn db:seed:up

# 4. (Opcional) generar un JWT de desarrollo para probar endpoints internos sin pasar por login
yarn dev:jwt --role=admin

# 5. Validar configuración local
# Útil si Windows/PowerShell tiene NODE_ENV=production a nivel global.
yarn env:doctor

# 6. Levantar el servidor local
# Este comando fuerza NODE_ENV=development antes de cargar dist/src/main.js.
yarn start:dev
# La API queda en http://localhost:3000/api/v1
# Swagger UI (si API_DOCS_ENABLED=true, por defecto fuera de producción): /api/v1/docs
```


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

| Comando | Qué hace |
|---|---|
| `yarn lint` / `yarn lint:fix` | ESLint sobre `src/`, `test/`, `scripts/`. |
| `yarn format` / `yarn format:check` | Prettier. |
| `yarn type-check` | `tsc --noEmit`. |
| `yarn test` | Suite de Jest. |
| `yarn test:coverage` | Jest con reporte de cobertura. |
| `yarn build` | Compila a `dist/`. |
| `yarn start` | Levanta `dist/src/main.js` como está el entorno actual (producción si `NODE_ENV=production`). |
| `yarn start:dev` | Compila y levanta local forzando `NODE_ENV=development` incluso si Windows tiene `NODE_ENV=production` global. |
| `yarn start:prod` | Compila y levanta respetando configuración de producción; exige `REDIS_URL` y secretos reales. |
| `yarn env:doctor` | Diagnostica variables críticas y explica si el entorno está en modo local o producción. |
| `yarn db:migration:up` / `down` / `status` | Migraciones Sequelize/Umzug. |
| `yarn db:seed:up` / `down` / `status` | Seeders mínimos de desarrollo. |
| `yarn docs:openapi` | Genera `docs/endpoints/openapi.yaml` a partir del código (requiere una base de datos real disponible para levantar el `AppModule`). |
| `yarn smoke` | Corre la suite de smoke tests contra un servidor real ya levantado (`BASE_URL` por defecto `http://localhost:3000/api/v1`). |
| `yarn check:no-env-file` | Falla si hay un `.env` real en el repo (lo corre CI). |
| `yarn crypto:reencrypt-pii:dry-run` | Cuenta (sin escribir) cuántos valores de PII/tokens siguen en formato legado `v1` (clave maestra única) contra una base real. |
| `yarn crypto:reencrypt-pii` | Re-cifra en caliente, en lotes e idempotente, los valores `v1` a `v2` (envelope encryption). |

## Autenticación (módulo `auth`)

- `POST /auth/login` — body: `{ actorType: 'customer'|'internal_user'|'platform_user', identifier, password }`. Público.
- `POST /auth/refresh` — body: `{ refreshToken }`. Público. Rota el refresh token en cada uso.
- `POST /auth/logout` — body: `{ refreshToken, allDevices? }`. Público (opera sobre el refresh token, no sobre el access token).
- `POST /auth/provision-credentials` — body: `{ actorType: 'internal_user'|'platform_user', actorId, password }`. Requiere rol `admin`/`platform_admin`. Fija la contraseña inicial de un actor interno ya existente (no crea el actor).

Para clientes (`customer`), el registro **es** el onboarding: `POST /customer-onboarding/start`
acepta un campo `password` opcional. El mecanismo final para consumidores puede evolucionar a OTP u otro flujo, pero el backend ya soporta contraseña cuando el cliente se crea desde onboarding.

## Documentación relacionada

- `docs/architecture/architecture.md` / `docs/architecture/flows.md` — arquitectura y flujos existentes.
- `docs/config/environment.md` — variables de entorno y reglas de configuración.
- `docs/database/migrations.md` / `docs/database/seeds.md` — operación de base de datos.
- `docs/endpoints/endpoints.md` — documentación narrativa de endpoints, complementaria al OpenAPI generado.
- `docs/testing/smoke-tests.md` — guía práctica para validar el backend levantado.

## Seguridad — reglas no negociables

- Nunca commitear `.env` real (CI lo bloquea).
- Contraseñas siempre con Argon2id (`src/common/utils/crypto/password.util.ts`), nunca en texto plano ni loggeadas.
- Ninguna tabla financiera/de auditoría se borra o sobrescribe; se usan movimientos, reversos o eventos.
- Toda entrada externa se valida con Zod antes de tocar la base de datos.
- No exponer modelos Sequelize directamente en respuestas HTTP; usar mappers.
