# El plano de control: catálogo técnico, propuestas de esquema, auditoría y logs (AT-049)

Prueba: `test/contracts/security/control-plane-isolation.spec.ts`.

| Capacidad | Módulo | Qué hace | Qué NO hace | Permiso |
|---|---|---|---|---|
| Propuestas de esquema | `schema-management` | escribe `schema_change_log`/`schema_tables`/`schema_columns` (registro de cambios propuesto y validado) | **nunca DDL**: sin `queryInterface`, sin `ALTER/CREATE/DROP` (probado por inspección); el DDL lo aplica una migración con `atlas_migrator` | `@Roles` de operación en `POST /operations/schema/tables` |
| Catálogo técnico | `systems-ops` | inventario de endpoints, tablas, flujos, pruebas | no muta negocio | roles internos |
| Auditoría | `audit` | feed de eventos operativos por cliente | no expone hashes/blobs (vistas `read_api`) | `@Roles` internos |
| Logs | `log-sync` | sincroniza logs redactados a MongoDB y los consulta | no lee tenants no autorizados; sin secretos (redacción previa) | **cambio AT-049**: `GET /systems/logs/mongo` exige rol interno explícito (antes bastaba cualquier sesión autenticada) |
| Retención/reparación | `runtime-jobs` | jobs con rol del propietario | no DDL (rol runtime sin CREATE, probado AT-023) | planificador |

## Fallo del sink de logs (MongoDB)

Política: el runtime **no** obtiene privilegios extra ni cambia de comportamiento; el archivo local sigue acumulando
(con tope) y la sincronización reintenta. Ya ocurrió (memoria: el clúster de MongoDB se borró y el archivo creció sin
tope): el tope local es el control, no un privilegio adicional.

## Cambio de comportamiento declarado

`MongoLogsController` pasa a exigir `internal_operator | admin | platform_admin | readonly_auditor`. Un actor
autenticado sin esos roles recibe 403 donde antes recibía 200. Es la única mutación de contrato de F7.
