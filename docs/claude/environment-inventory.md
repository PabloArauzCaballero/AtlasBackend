# Inventario de entorno — Claude Code (Atlas backend)

- **Fecha:** 2026-07-21
- **Generado por:** ejecución de las fases pendientes de `CLAUDE_ORGANIZAR_SKILLS_BACKEND.md`.

## Versiones verificadas

| Herramienta | Versión |
|---|---|
| Claude Code | 2.1.215 |
| Node.js | v26.2.0 (package.json exige `>=22`) |
| npm | 11.15.0 |
| Yarn | 1.22.22 (`packageManager` fijado) |
| Git | 2.54.0.windows.1 |

- **SO / shell:** Windows 11; shells disponibles PowerShell 5.1 y Git Bash (POSIX).
- **Rama actual:** `plan-10-10-docs-kms-refactors` (working tree con cambios sin commitear).

## Stack detectado (evidencia: package.json, lockfile, código)

- **Framework:** NestJS 11 (`@nestjs/*`), Express (`@nestjs/platform-express`).
- **Lenguaje/build:** TypeScript 5.9, `tsc`; ejecución dev con `tsx`.
- **ORM/DB:** Sequelize 6 + `sequelize-typescript`, PostgreSQL (`pg`), migraciones con `umzug`.
- **Otros datastores:** Redis (`ioredis`) para rate limiting / revocación / health; MongoDB (`mongodb`) para sync de logs.
- **Validación:** Zod 4 (runtime). `joi` figura en dependencias pero sin imports en `src/` (posible dependencia muerta — no confirmado).
- **Auth/crypto:** `jsonwebtoken` (HS256), `argon2` (Argon2id), envelope encryption propio con proveedor KMS opcional (AWS).
- **Seguridad HTTP:** `helmet`, `@nestjs/throttler`.
- **Observabilidad:** OpenTelemetry (`@opentelemetry/sdk-node` + auto-instrumentations + OTLP), `prom-client`.
- **OpenAPI:** `@nestjs/swagger` (`yarn docs:openapi`).
- **Testing:** Jest + ts-jest, supertest; smokes en `tsx`.
- **CI/CD:** GitHub Actions (`.github/workflows/ci.yml`), 8 jobs.
- **IaC:** no detectada (sin `terraform/`, sin toolkit AWS confirmado).
- **Observabilidad desplegada:** Prometheus/Grafana self-hosted (`ops/observability/`).

## Limitaciones / no verificado

- `claude plugin list` en modo headless puede no reflejar el marketplace real; ver `plugin-selection-matrix.md`.
- `/doctor` y `/plugin` (UI) no se ejecutan en modo no interactivo.
- No se copió ninguna variable de entorno sensible.
- Archivos fuente que la orden maestra asume (`index.md`, `programacionGeneral.md`, `programacionBackend.md`) **no existen** en el repo (registrados como faltantes).
