# Auditoría — Módulo `schema-management`

**Alcance revisado:** `schema-management.controller.ts`, `.dtos.ts`, `.module.ts`,
`.repository.ts`, `.schemas.ts`, `services/schema-management.service.ts`,
`services/schema-management-validation.service.ts`. Tests existentes:
`test/unit/schema-management/schema-management.service.spec.ts`,
`schema-management-validation.service.spec.ts`, `schema-management.schemas.spec.ts` (los tres en
verde); no se agregaron tests nuevos porque no se aplicó ningún cambio de código.

**Resultado:** sin hallazgos críticos/altos/medios. No se modificó código. Módulo de gobernanza
de propuestas DDL ("Fase 4B") ya construido con los patrones
correctos.

---

## Por qué no hay hallazgos que corregir

- **Separación de funciones (4 ojos) ya implementada correctamente**: `PROPOSER_ROLES`
  (`internal_operator`, `admin`, `platform_admin`) y `APPROVER_ROLES` (`platform_admin`
  únicamente) están separados, y `approveSchemaChange` verifica explícitamente `String(entry.
  requester_platform_user_id) === String(approverId) → ForbiddenException` — quien propone no
  puede aprobar su propio cambio. Este es exactamente el control cuya ausencia señalé como
  hallazgo Alto en `catalog-management` (auditoría #15, mismo lote); confirma que el patrón
  correcto existe en el codebase y hace más nítido ese hallazgo por comparación.
- **Lock pesimista real**: `approveSchemaChange` usa `getChangeLogEntryForUpdate` (`SELECT ... FOR
  UPDATE` dentro de una transacción) antes de resolver, evitando que dos aprobaciones concurrentes
  del mismo cambio produzcan una doble resolución.
- **Todo el SQL crudo del repositorio usa `replacements` parametrizados** (`QueryTypes.SELECT` +
  `:namedParam`) — confirmé cada uno de los ~15 queries en `schema-management.repository.ts`, sin
  excepción. Los fragmentos de SQL construidos dinámicamente (`activeFilter`, `typeFilter`,
  `whereClause` en `listChangeLog`) solo intercalan texto SQL **estático** elegido por condición
  booleana (p. ej. `'WHERE is_active = true'` o `''`) — nunca concatenan valores de entrada; los
  valores siempre viajan como `replacements`. Sin superficie de inyección SQL.
- **`requirePlatformUserId` está alineado con una restricción real de esquema, no es un bug**:
  investigué si exigir `platformUserId` (en vez de aceptar también `internalUserId`, como hacen
  otros módulos, p. ej. `systems-test-runner.service.ts::actorIdentifier`) podría bloquear
  indebidamente a actores legítimos. Confirmé en la migración
  `20260706070000-phase-4a-create-schema-change-log.ts` que
  `requester_platform_user_id`/`approved_by_platform_user_id` tienen `NOT NULL REFERENCES
  platform_users(_id)` — una restricción de integridad referencial real y deliberada (la
  gobernanza de DDL es explícitamente un concern de nivel plataforma, no de staff interno por
  tenant). El código exige correctamente `platformUserId` y falla con `403` en vez de intentar
  insertar un id incompatible con esa FK — es el comportamiento correcto dado el diseño del
  esquema, no una inconsistencia.
- **Nunca se ejecuta DDL físico desde este módulo** (documentado explícitamente en el código):
  aprobar un cambio solo registra la decisión en `schema_change_log`; el DDL real sigue saliendo
  por migraciones Sequelize revisadas en PR. Esto elimina la clase de riesgo más obvia de un
  "gestor de cambios de schema" (ejecución de DDL arbitrario construido desde input del cliente).
- `SchemaManagementValidationService` valida nombres de tabla/columna con regex estrictas
  (`^[a-z][a-z0-9_]*$`), rechaza nombres de tabla reservados (incluye `information_schema`,
  `pg_catalog`, `public`), y protege explícitamente las 4 columnas de sistema
  (`_id`/`_tenant_id`/`_created_at`/`_updated_at`) contra ediciones — aunque esta validación no
  alimenta ejecución de DDL real hoy, es una defensa en profundidad coherente para cuando esa
  ejecución se habilite.
- Los endpoints de lectura (`versions`, `tables`, `change-log`) incluyen `readonly_auditor` en sus
  roles; los dos endpoints de escritura (`proposeTable`, `approveChange`) correctamente lo
  excluyen — sin el problema de rol "de solo lectura con permiso de escritura" señalado en
  `systems-ops` (auditoría #16, mismo lote).
