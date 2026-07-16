# Módulo: schema-management (Fase 4B)

## Responsabilidad

Gestión gobernada del catálogo de schema: propuestas de cambios DDL con workflow
de aprobación humana y auditoría exhaustiva. Este módulo **no ejecuta DDL físico**
en el MVP (ver "Alcance y pendientes"); registra propuestas y decisiones sobre el
catálogo versionado creado en la Fase 4A.

## Entidades / tablas involucradas

| Tabla | Rol |
|---|---|
| `schema_versions` | Versiones del schema (append-only: v1.0, v1.1...) |
| `schema_tables` | Inventario de tablas por versión |
| `schema_columns` | Metadatos de columnas (`is_immutable`, `is_pii`, `is_indexed`) |
| `schema_relationships` | FK del catálogo — **siempre `is_immutable = true`** |
| `schema_change_log` | Auditoría de cada propuesta: quién, qué, cuándo, decisión, resultado |

## Endpoints

| Método | Ruta | Roles | Descripción |
|---|---|---|---|
| GET | `/operations/schema/versions` | internos + `readonly_auditor` | Lista versiones con conteos |
| GET | `/operations/schema/versions/:versionId` | internos + auditor | Detalle de versión |
| GET | `/operations/schema/tables?versionId=` | internos + auditor | Tablas de una versión |
| GET | `/operations/schema/tables/:tableId` | internos + auditor | Tabla + columnas + FK |
| POST | `/operations/schema/tables` | `internal_operator`, `admin`, `platform_admin` | Proponer tabla (queda `pending`) |
| GET | `/operations/schema/change-log` | internos + auditor | Auditoría filtrable |
| PATCH | `/operations/schema/change-log/:changeId/approve` | `platform_admin` | Aprobar o rechazar |

## Reglas de negocio

1. **FK inmutables**: `validateRelationshipEdit` rechaza toda edición. Cambios de FK = nueva versión de schema.
2. **Columnas críticas inmutables**: `_id`, `_tenant_id`, `_created_at`, `_updated_at` no se editan nunca.
3. **Catálogos congelados en uso**: si `usage_count > 0` y `is_immutable_after_use`, se exige crear versión nueva (`*_v2`).
4. **Principio de 4 ojos**: el proponente de un cambio **no puede** aprobarlo (segregación de funciones).
5. **Rechazo auditable**: rechazar exige `approvalNotes` (validado en Zod).
6. **Sin doble aprobación concurrente**: `SELECT ... FOR UPDATE` dentro de transacción al resolver.
7. **Solo `pending` se resuelve**: aprobar/rechazar un cambio ya resuelto → `409 Conflict`.

## Permisos y errores

- Rol insuficiente → `403 ForbiddenException` (401 se reserva para autenticación en `JwtAuthGuard`).
- Token sin `platformUserId` → `403` (no hay actor auditable).
- Entrada inválida → `400` con issues de Zod.
- Recurso inexistente → `404`.
- Cambio ya resuelto → `409`.

## Seguridad de datos

- SQL 100% parametrizado (`replacements`); columnas explícitas en INSERT/UPDATE.
- Nunca se construye SQL desde keys de objetos del request.
- Identificadores SQL validados en dos capas: Zod (regex estricta) + `SchemaManagementValidationService`.
- IDs expuestos como `string` (BIGINT de Postgres) — evita pérdida de precisión.

## Alcance y pendientes

- **ATLAS-TECH-007** — La ejecución de DDL físico vía API está
  intencionalmente fuera del MVP. Aprobar un cambio registra la decisión en
  `schema_change_log`; el `CREATE TABLE` real sigue saliendo por migraciones
  Sequelize revisadas en PR (Opción C aprobada por el usuario). Ver
  `docs/pending/pending-items.md`.

## Pruebas

```bash
yarn test test/unit/schema-management/
# 65 tests: validador (26), servicio (17), schemas Zod (22)
```

Los tests prueban el código real (validador puro sin mocks; servicio con repositorio mockeado; schemas Zod directos).
