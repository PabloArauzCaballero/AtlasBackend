# Matriz de roles de base de datos por contexto (AT-019)

Medida desde la conexión del rol real (`test/integration/architecture/context-privileges.spec.ts`), no leída del script
de GRANT. Script: `ops/postgres/context-roles.sql` (idempotente; en CI lo aplica el job de base de datos antes de la
integración).

## Roles

| Rol | Quién lo usa | DML | DDL | Ve otros schemas |
|---|---|---|---|---|
| `atlas_owner` (NOLOGIN) | dueño de objetos | — | sí | todos |
| `atlas_migrator` | `db:migration:*`, job `migrate` de Coolify | vía `atlas_owner` | sí | todos |
| `atlas_app_rw` | API y worker del monolito | todas las tablas de dominio + `read_api` | **no** | todos (search_path completo) |
| `atlas_app_ro` | lecturas (`ReadQueryService`) | SELECT | no | todos |
| `atlas_ctx_messaging` | ejecutable de Mensajería (piloto F9) | `messaging.*` + `platform_ops.{outbox_events,inbox_receipts,idempotency_keys}` | **no** | **no**: `credit`/`customer`/`iam` → `permission denied` |
| `atlas_ctx_credit` | reservado | `credit.*` + infraestructura compartida | no | no |
| `atlas_ctx_customer` | reservado | `customer.*` + infraestructura compartida | no | no |

`search_path` de cada rol de contexto: `<su schema>, platform_ops`. Una tabla sin calificar de otro contexto **no
resuelve**; una calificada, **se deniega**. Los `ALTER DEFAULT PRIVILEGES` se aplican por schema: una tabla que el
migrador cree mañana en `messaging` es del rol de mensajería; una en `credit`, no.

## Lo que se probó (2026-09-11, atlas_test)

| Prueba | Resultado |
|---|---|
| `atlas_ctx_messaging` SELECT/INSERT en `messaging.*` | permitido |
| `atlas_ctx_messaging` SELECT/UPDATE en `credit.credit_applications`, `customer.customers` | `permission denied for schema` |
| `atlas_ctx_messaging` CREATE TABLE / ALTER TABLE en `messaging` | denegado |
| `atlas_ctx_messaging` `SELECT … FROM customers` (sin schema) | no resuelve |
| `atlas_app_rw` CREATE TABLE | denegado (no se amplió) |

## Lo que falta para el piloto

- El ejecutable de Mensajería debe **conectarse** con `atlas_ctx_messaging` (hoy todo el monolito conecta con
  `atlas_app_rw`): AT-045/AT-057. La matriz existe; el cambio de credencial es del runtime aislado.
- `platform_ops` compartido es temporal: cuando Mensajería tenga base propia, outbox/inbox viajan con ella (AT-022,
  `messaging-storage.md`).
- Las vistas `read_api` no están concedidas a los roles de contexto a propósito: un contexto extraído no lee
  proyecciones del monolito por SQL.
