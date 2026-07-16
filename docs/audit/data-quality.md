# Auditoría — Módulo `data-quality`

**Alcance revisado:** `data-quality.controller.ts`, `.service.ts`, `.repository.ts`,
`.schemas.ts`, `.module.ts`; modelos `DataQualityIssueModel`, `DataQualityRuleModel`. Tests:
`test/unit/data-quality/data-quality.repository.spec.ts` (existente) y
`data-quality.service.spec.ts`.

**Resultado:** 1 hallazgo Alto (parámetro de filtro `severity` completamente inerte + campos de
respuesta incorrectos), corregido. Suite verde tras el cambio (8/8, incluye 4 tests nuevos).

---

## Hallazgo (Alto) — el filtro `severity` de `GET /operations/data-quality/issues` no filtraba nada, y la respuesta exponía campos equivocados

**Dónde:** `data-quality.repository.ts::findIssues`/`findIssuesWithCursor`,
`data-quality.service.ts::listIssues`.

**Qué encontré:** `dataQualityQuerySchema` acepta y documenta `severity` como parámetro de
filtro válido, y el endpoint lo recibe sin error. Pero `severity` no es una columna de
`data_quality_issues` — vive en `data_quality_rules.severity`, relacionada vía
`data_quality_issues.quality_rule_id`. El `where` de `findIssues` nunca incluía `query.severity`
en ninguna condición: el parámetro se aceptaba, no fallaba, y **no hacía nada** — un analista
que filtrara por `severity=critical` recibía la lista completa sin filtrar, sin ningún error que
lo alertara.

Además, `listIssues` mapeaba la respuesta con dos defectos relacionados:
- `severity: null` — hardcodeado siempre, nunca resuelto contra la regla.
- `issueCode: issue.issueStatus` — duplicaba literalmente el mismo valor que ya se devuelve en
  el campo `status`, en vez de exponer `rule.ruleCode` (el código real de la regla incumplida,
  p. ej. `missing_identity_document`), que es el dato que en realidad identifica *qué* problema
  de calidad es.

**Por qué importa:** para un panel operativo de calidad de datos, "severidad" y "qué regla se
incumplió" son las dos columnas que un analista usa para priorizar su cola de trabajo. Con este
bug, ambas estaban efectivamente inutilizables: el filtro daba una falsa sensación de estar
acotando la vista (sin error, sin aviso) y la respuesta no traía ni la severidad real ni el
código de la regla, solo el status duplicado dos veces.

**Corrección aplicada:**
- `data-quality.repository.ts`: nuevo método privado `severityRuleIds(severity)` que resuelve
  los `id` de `data_quality_rules` con esa severidad antes de tocar `data_quality_issues`; si no
  hay ninguna regla con esa severidad, devuelve resultado vacío sin consultar issues (evita un
  `IN ()` vacío, que en Postgres/Sequelize no siempre se comporta como "ningún resultado" de
  forma consistente). Aplicado tanto en `findIssues` (OFFSET) como en `findIssuesWithCursor`
  (cursor, hoy sin endpoint propio pero ya usado por otros módulos como referencia de patrón —
  ver `operations.md`). Nuevo método público `findRulesByIds(ruleIds)` para el join manual desde
  el service (el proyecto no usa asociaciones de sequelize-typescript en ningún modelo, patrón
  consistente con el resto del código — ver p. ej. `risk.service.ts` resolviendo relaciones con
  queries separadas).
- `data-quality.service.ts::listIssues`: junta los `qualityRuleId` únicos de la página actual,
  resuelve las reglas correspondientes en una sola consulta adicional, y mapea
  `severity`/`issueCode` desde la regla real (`null` solo si el issue no tiene
  `qualityRuleId` o la regla no se encontró).
- `data-quality.module.ts`: registra `DataQualityRuleModel` en el `forFeature`.
- Tests nuevos: 2 en el repositorio (resuelve severity contra las reglas; devuelve vacío sin
  tocar `issueModel` cuando ninguna regla coincide) + 2 en el service, nuevo archivo (mapea
  severity/issueCode desde la regla joinada; devuelve `null` en ambos campos sin lanzar cuando no
  hay regla vinculada).

---

## Qué quedó verificado como correcto (sin cambios)

- El controller completo está detrás de roles internos (`internal_operator`, `risk_analyst`,
  `compliance_analyst`, `admin`, `platform_admin`) — sin acceso de cliente.
- `resolveIssue` exige `X-Idempotency-Key`, rechaza issues inexistentes
  (`DATA_QUALITY_ISSUE_NOT_FOUND`) y ya resueltos (`DATA_QUALITY_ISSUE_ALREADY_RESOLVED`), y
  registra `actorInternalUserId` real (no `null` fijo) tanto en `createAudit` como en
  `createDataChange` — este módulo ya tenía el patrón correcto aplicado, a diferencia de
  `customer-privacy`/`customer-telemetry` (auditorías #10/#11 de este mismo lote).
- `findIssueById` y todas las queries de listado están scopeadas por `tenantId`.
- Toda la escritura de `resolveIssue` ocurre en una única transacción.
