# Línea base del backend — 2026-07-31

> Fase 0 del plan maestro de documentación. Estado medido **antes** de tocar nada en esta
> intervención, con los comandos reales del repositorio y su resultado.
>
> No es un resumen de intenciones: cada fila de abajo salió de ejecutar el comando en esta máquina.

---

## 1. Identificación del sistema

| Dimensión | Valor real | Dónde se comprueba |
|---|---|---|
| Framework | NestJS 11 (`@nestjs/core` ^11.1.6) sobre Express 5 | [package.json](../../package.json) |
| Lenguaje | TypeScript 5.9, `module: NodeNext`, `strict: true` | [tsconfig.json](../../tsconfig.json) |
| Gestor de paquetes | Yarn 1.22.22 (`packageManager`) | [package.json](../../package.json) |
| Runtime | Node ≥ 22 (`engines`), imagen fijada a 22.16.0 | [.nvmrc](../../.nvmrc), [Dockerfile](../../Dockerfile) |
| ORM | Sequelize 6 + `sequelize-typescript`, migraciones con Umzug 3 | [src/database/](../../src/database/) |
| Motor de datos | PostgreSQL 16 (primario), MongoDB 7 (sólo visor de logs), Redis 7 (throttling, locks, caché) | [docker-compose.yml](../../docker-compose.yml) |
| Colas / eventos | Outbox transaccional en PostgreSQL + tabla de eventos de dominio. Sin broker externo | [src/modules/events/](../../src/modules/events/), [src/modules/runtime-hardening/](../../src/modules/runtime-hardening/) |
| Autenticación | JWT propio HS256 con `iss`/`aud`, refresh tokens opacos, Argon2 para contraseñas | [src/modules/auth/](../../src/modules/auth/) |
| Observabilidad | Prometheus (`prom-client`), OpenTelemetry opcional, logs JSON redactados | [src/common/observability/](../../src/common/observability/) |
| Validación | Zod 4 en todo endpoint público | `.claude/rules/10-typescript-backend.md` |
| Integraciones externas | 9 proveedores (KYC, buró, telco, banca, confianza digital) + MailSender | [src/modules/external-data/](../../src/modules/external-data/) |

### Inventario cuantitativo

| Elemento | Cantidad |
|---|---:|
| Módulos de dominio (`src/modules/*`) | 27 |
| Controllers (`@Controller`) | 46 |
| Archivos TypeScript en `src/` | 664 |
| Scripts operativos (`scripts/*.ts`) | 48 |
| Migraciones (`src/database/migrations/*.ts`) | 61 |
| Modelos Sequelize (`src/database/models/*.ts`) | 132 |
| Ficheros de prueba (`*.spec.ts` / `*.test.ts`) | 290 |
| Rutas en el contrato OpenAPI publicado | 251 |
| Variables de entorno tipadas | 148 |

---

## 2. Resultado de los gates

Ejecutados el 2026-07-31 sobre la rama `dev`, en Windows 11 con Node 26.2.0 y Yarn 1.22.22.

| Comando | Resultado | Detalle |
|---|---|---|
| `yarn type-check` | ✅ | Sin errores |
| `yarn type-check:tests` | ✅ | Sin errores |
| `yarn lint` | ✅ | 0 errores, 151 avisos (complejidad ciclomática en `systems-ops`, deuda congelada y documentada) |
| `yarn format:check` | ✅ | Sin diferencias |
| `yarn test` | ✅ | **284 suites / 2425 pruebas**, 306,8 s |
| `yarn build` | ✅ | `dist/` generado |
| `yarn check:migrations` | ✅ | 61 migraciones: sin colisiones de tabla, sin timestamps repetidos, todas reversibles |
| `yarn check:file-size` | ✅ | 34 archivos runtime sobre 300 líneas (deuda congelada con trinquete) |
| `yarn check:env-example` | ✅ | 148 variables cubiertas, sin duplicados |
| `yarn check:tenant-header` | ✅ | Baseline congelado en 26 controllers / 129 usos |
| `docker compose config` | ✅ | Manifiestos resueltos sin error |
| `docker compose build` | ✅ | Imagen construida (ver §4) |

### Lo que NO se pudo ejecutar en esta máquina

| Gate | Motivo | Dónde sí corre |
|---|---|---|
| `yarn db:migration:up` desde cero | No hay una base PostgreSQL vacía dedicada; la local tiene datos | Job `db-and-cache-integration` de CI |
| `yarn smoke*` | Exigen la API levantada con base sembrada | Job de integración de CI |
| `yarn check:db-privileges --strict` | Exige los roles `atlas_app_rw` / `atlas_migrator` creados | Job de integración de CI |

Estas tres ausencias están declaradas, no ocultas: el criterio del proyecto es no declarar "listo para
producción" con un gate crítico sin ejecutar, y por eso quedan aquí con su responsable.

---

## 3. Riesgos identificados en la línea base

| # | Riesgo | Severidad | Estado |
|---|---|---|---|
| B-01 | El job de migraciones no podía correr desde la imagen: `migrate.ts` globaba `src/database/migrations/*.ts` y `tsx` es una devDependency que no viaja en la imagen de producción | Alta | **Resuelto** en esta intervención (glob resuelto desde `__dirname`, con `.js` en el build compilado) |
| B-02 | Todo el trabajo de fondo corría dentro del proceso que atiende HTTP, compitiendo por el pool de conexiones y el event loop | Media | **Resuelto** — ver [background-processing.md](../architecture/background-processing.md) |
| B-03 | Un broadcast interrumpido por un despliegue dejaba mensajes en `pending` hasta 20 minutos | Media | **Resuelto** (`NOTIFICATIONS_DELIVERY_MODE=deferred` + job dedicado) |
| B-04 | No existía manifiesto de producción: el compose sólo levantaba infraestructura y la aplicación quedaba fuera de contenedor | Media | **Resuelto** ([docker-compose.prod.yml](../../docker-compose.prod.yml)) |
| B-05 | 151 avisos de ESLint por complejidad ciclomática en `systems-ops` | Baja | Congelado a propósito: reescribir esos métodos durante un endurecimiento añade riesgo sin cerrar ningún hallazgo |
| B-06 | 34 archivos runtime por encima de 300 líneas | Baja | Congelado con trinquete `yarn check:file-size`: no puede empeorar |

---

## 4. Evidencia del artefacto de despliegue

La imagen se construye desde una sola definición para los tres roles de proceso (`api`, `worker` y el
job one-shot de migraciones). Ver [Dockerfile](../../Dockerfile) y §5 de
[background-processing.md](../architecture/background-processing.md).

Lo que CI verifica sobre la imagen construida, en cada PR
([ci.yml](../../.github/workflows/ci.yml), job `docker-image`):

- Los tres entrypoints existen (`dist/src/main.js`, `dist/src/worker.js`, `dist/src/database/migrate.js`).
- Las migraciones **compiladas** viajan en la imagen (sin ellas, migrar en el despliegue es imposible).
- No hay devDependencies dentro (`node_modules/typescript` no existe).
- El proceso no corre como root.
- Los dos manifiestos de compose resuelven, y el de producción **aborta** si le faltan sus secretos.

---

## 5. Próximas fases

Este informe cierra la Fase 0. La secuencia sigue en:

- [graphify-audit.md](graphify-audit.md) — Fase 1, descubrimiento sobre el grafo real.
- [documentation-gap-analysis.md](documentation-gap-analysis.md) — Fase 2, brechas convertidas en tareas.
