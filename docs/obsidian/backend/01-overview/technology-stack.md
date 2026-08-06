---
title: "Stack tecnológico"
type: "overview"
status: "verified"
owner: "unknown"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - overview
  - stack
source_files:
  - "package.json"
  - "Dockerfile"
  - "tsconfig.json"
aliases: []
related: []
---

# Stack tecnológico

Todo lo de esta nota sale de `package.json`, `Dockerfile` y `tsconfig.json` en la revisión `80fc741`.

## Runtime y lenguaje

| Elemento | Versión | Nota |
|---|---|---|
| Node.js | ≥ 22 | `engines`; imagen base `node:22-bookworm-slim` |
| TypeScript | 5.x | Módulos ESM — los imports internos llevan extensión `.js` |
| Gestor de paquetes | Yarn | `yarn.lock` versionado |

## Framework y capas

| Responsabilidad | Librería |
|---|---|
| Framework HTTP | `@nestjs/common` · `@nestjs/core` · `@nestjs/platform-express` (Express) |
| ORM | `sequelize` + `sequelize-typescript` + `@nestjs/sequelize` |
| Driver PostgreSQL | `pg`, `pg-hstore` |
| Migraciones | `umzug` |
| Validación | `zod` — no `class-validator` |
| Documentación de API | `@nestjs/swagger` + `@scalar/nestjs-api-reference` + `swagger-ui-express` |
| Rate limiting | `@nestjs/throttler` con almacén Redis propio |
| Configuración | `@nestjs/config` + `dotenv` + esquemas Zod |

> [!info] Una sola librería por responsabilidad
> La validación es **solo** Zod, incluida la del entorno y la generación de esquemas OpenAPI (`zodToApiSchema`). No conviven Zod y `class-validator`, que es el solapamiento habitual en proyectos NestJS.

## Almacenes y mensajería

| Almacén | Librería | Uso |
|---|---|---|
| PostgreSQL | `pg` / Sequelize | Fuente de verdad. 12 esquemas de dominio + `read_api` |
| Redis | `ioredis` | Rate limiting distribuido, caché, elección de líder de jobs. Opcional en dev, **obligatorio en producción** |
| MongoDB | `mongodb` | Destino de la sincronía de logs de aplicación |
| S3 | `@aws-sdk` + firma propia (`s3-signature.util.ts`) | Documentos de evidencia |
| Cola de mensajes | **ninguna** | Los eventos van por outbox en PostgreSQL. Ver [[02-architecture/adr/0001-outbox-en-postgresql\|ADR-0001]] |

## Seguridad

| Elemento | Librería |
|---|---|
| Hash de contraseñas | `argon2` |
| JWT | `jsonwebtoken` — HS256 fijado al firmar y verificar |
| Cabeceras HTTP | `helmet` |
| Cifrado de PII | `@aws-sdk/client-kms` (envelope encryption) con proveedor `local` de respaldo |
| Compresión | `compression` |

## Observabilidad

| Elemento | Librería |
|---|---|
| Métricas | `prom-client` → `/metrics` |
| Trazas | `@opentelemetry/sdk-node` + auto-instrumentaciones + exportador OTLP HTTP |
| Logs | Implementación propia (`AppFileLogger`) → archivo → sincronía a MongoDB |

El bootstrap de OpenTelemetry se importa **antes que cualquier módulo instrumentable** en `main.ts` y `worker.ts`; es no-op salvo `OTEL_ENABLED=true`.

## Calidad

| Elemento | Herramienta |
|---|---|
| Tests | `jest` + `ts-jest` + `supertest` |
| Lint | `eslint` + `@typescript-eslint` + `eslint-config-prettier` |
| Formato | `prettier` |
| Ejecución TS directa | `tsx` (scripts, migraciones, smokes) |
| Contrato OpenAPI | `@redocly/cli` (`lint`, `bundle`, `stats`) |
| Documentación | MkDocs (`mkdocs.yml`, `docs/requirements.txt`) |

## Empaquetado

`Dockerfile` multi-etapa: `deps` → `build` → `runtime`.

- Imagen final `node:22-bookworm-slim`, ejecuta como **`USER node`** (sin root).
- `tini` como `ENTRYPOINT` — reaper de procesos y propagación correcta de señales, necesario para el apagado con drenado.
- Expone **3005** (API) y **3006** (sonda del worker).
- `HEALTHCHECK` propio cada 15 s con 30 s de arranque.
- `CMD` por defecto: `node dist/src/main.js`; el worker se lanza sobreescribiendo el comando.

## Ausencias deliberadas

`INFERIDO` — no aparecen en el stack y su ausencia es coherente con las decisiones documentadas:

- **Sin broker de mensajería** (Kafka/RabbitMQ/SQS): lo cubre el outbox.
- **Sin GraphQL, gRPC ni WebSocket**: la única interfaz de entrada es REST.
- **Sin planificador externo** (cron del sistema, Kubernetes CronJob): los jobs los agenda el proceso worker por intervalos.

## Relaciones

- [[01-overview/repository-map]] · [[10-operations/deployment]] · [[02-architecture/architecture-overview]]
