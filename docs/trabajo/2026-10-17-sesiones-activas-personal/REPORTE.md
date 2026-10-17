# Reporte — Sesiones activas del personal interno (backend)

> **AVANCE: 4 / 9 — 44,4 %.** (backend H1.S1 hecho; portal H1.S2 y entrega H1.S3 se cierran en sus PR)

- Fecha: 2026-10-17 · Plan: [PLAN.md](./PLAN.md) · Rama: `feat/sesiones-activas-personal`
- Peldaño de evidencia alcanzado (backend): `TESTED` + SQL `VERIFIED` contra PostgreSQL real.

## Completado

| ID       | Qué se logró                                                                                                                                                                                                                              | Comando                                                                                                | Resultado |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------- |
| H1.S1.M1 | `internal.sessions.read` en el catálogo, concedido a INTERNAL_IDENTITY_ADMIN (y por regla a SUPER_ADMIN, SYSTEMS_ADMIN y AUDITOR_READONLY); migración `20261017120000-sync-internal-rbac-catalog-8`; candado RBAC de procesos actualizado | `yarn check:migrations && yarn check:rbac-matrix && yarn check:process-sync`                           | PASS      |
| H1.S1.M2 | `GET /internal/sessions` paginado, por tenant, sólo `internal_user` vivos, con `summary` y `activeNow`                                                                                                                                    | `npx jest test/unit/internal-users/internal-sessions` + [SQL real](./evidencia/sql-contra-postgres.md) | 12 PASS   |
| H1.S1.M3 | `POST /internal/users/:id/sessions/revoke` con motivo: revoca tokens, sube `token_version`, audita `internal_users.sessions.revoke`; 404 / 403 sobre sí mismo / 403 cuenta privilegiada sin SUPER_ADMIN                                   | idem                                                                                                   | PASS      |
| H1.S1.M4 | OpenAPI, golden, cifras de docs, matriz RBAC                                                                                                                                                                                              | `yarn docs:openapi`, `UPDATE_GOLDEN=1 …`, `yarn docs:figures`, `yarn docs:rbac-matrix`; batería §2     | PASS      |

## A medias

ninguna

## Pendiente

| ID          | Estado | Qué lo destraba                                         |
| ----------- | ------ | ------------------------------------------------------- |
| H1.S2.M1–M3 | TODO   | PR del portal admin (rama homónima en AtlasAdminPortal) |
| H1.S3.M1–M2 | TODO   | fusión, promoción a `test` y despliegue en Contabo      |

## Evidencia

```text
type-check => 0 · type-check:tests => 0 · lint => 0 · format:check => 0
check:file-size / architecture / auth-coverage / migrations / openapi / docs-figures / rbac-matrix / process-sync => 0
Tests: 110 passed (test/unit/internal-users)
```

SQL: [evidencia/sql-contra-postgres.md](./evidencia/sql-contra-postgres.md).

## No cubierto

- Los seis `check:*` que piden PostgreSQL (`db-privileges`, `domain-schema-layout`, `retention-coverage`,
  `read-api-views`, `read-api-honesty`, `seed-references`): sin base local de Atlas; los corre la CI.
- La migración no se corrió contra una copia de TEST: es el mismo volcado idempotente que ya corrió ocho veces
  y no escribe en columnas con CHECK.
- El efecto de `token_version` sobre `JwtAuthGuard` se toma del comportamiento existente (lo usa la suspensión);
  se verifica en TEST tras desplegar.

## Desvíos del plan

- Ruta de lectura `GET /internal/sessions` en vez de `/internal/users/sessions`: la segunda la captura
  `GET /internal/users/:internalUserId` y respondería 400.

## Riesgos residuales

- IP y agente de usuario del personal son datos personales: sólo con permiso dedicado, nunca en logs.
- «Activa ahora» es una aproximación (renovada en la última hora); una pestaña cerrada sigue contando como sesión
  abierta hasta que vence su token de refresco.

## Decisiones y ambigüedades

- «Activo» = sesión abierta; «activa ahora» = renovada en la última hora. Confirmar con Pablo.
- Cerrar sesiones reutiliza `internal.users.manage` (la misma clase de acción que suspender). Confirmar con Pablo.
