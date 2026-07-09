# Auditoría — Módulo `catalog-management`

**Alcance revisado:** `catalog-management.controller.ts`, `.service.ts` (facade), `.repository.ts`,
`.mapper.ts`, `.schemas.ts`, `.module.ts`; los 6 servicios de aplicación
(`catalog-query.service.ts`, `catalog-version-workflow.service.ts`,
`catalog-ingestion.service.ts`, `catalog-definitions.service.ts`, `catalog-risk-policy.service.ts`,
`catalog-data-governance.service.ts`), `catalog-management.shared.ts`. Tests: los 6 archivos en
`test/unit/catalog-management/`.

**Resultado:** 1 hallazgo Medio (corregido: contaminación cruzada de catálogos en
`decideStagingItems`) y 1 observación Alto de gobernanza (documentada, **no corregida** —
requiere una decisión de producto sobre el modelo de roles, no es un bug de una línea). Suite
verde tras el cambio (68/68, incluye 1 test nuevo).

---

## Hallazgo (Medio) — `decideStagingItems` podía fusionar items de un catálogo en la versión de otro catálogo

**Dónde:** `catalog-ingestion.service.ts::decideStagingItems`.

**Qué encontré:** el método recibe `targetCatalogVersionId` y una lista de decisiones, cada una
con un `stagingItemId`. Resolvía la versión destino y cada staging item **por separado**, sin
verificar que `staging.catalogId` coincidiera con `targetVersion.catalogId` — ambos existen como
columna (`context_staging_items.catalog_id`, `context_catalog_versions.catalog_id`) pero nunca se
comparaban. Un operador que confundiera un `stagingItemId` de la ingesta del catálogo "merchants"
con una versión destino del catálogo "geographic_zones" habría fusionado silenciosamente datos de
un dominio en otro — sin error, sin rollback, con el item ya creado como si perteneciera al
catálogo correcto.

**Por qué importa:** los catálogos de este módulo alimentan directamente
`riskDimension`/`riskBand`/`scorePointsSuggested` (mapeos de riesgo por ítem) que consume el motor
de riesgo. Una contaminación cruzada silenciosa entre catálogos no es solo un error de datos —
puede introducir mapeos de riesgo con semántica equivocada en un catálogo que se cree curado y
aislado.

**Corrección aplicada:** `decideStagingItems` ahora verifica `String(staging.catalogId) ===
String(targetVersion.catalogId)` antes de procesar cada decisión; si no coincide, lanza
`UnprocessableEntityException` con el id del staging item ofensivo, sin tocar ninguna tabla. Test
nuevo que cubre el caso (`catalogId` distinto → rechazo, `createContextItem` nunca invocado).

---

## Observación (Alto, sin corregir — decisión de producto) — sin separación de funciones ("maker-checker") para acciones que controlan el motor de riesgo en vivo

**Dónde:** `catalog-management.controller.ts` (rol único a nivel de controller para los 12
endpoints) + `catalog-version-workflow.service.ts::decideCatalogVersion` +
`catalog-risk-policy.service.ts::activateRiskRulesetVersion`.

**Qué encontré:** el controller completo comparte un solo `@Roles('internal_operator',
'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system')` sin
overrides por endpoint — a diferencia de `operations.controller.ts` (auditoría #12, mismo lote),
que sí restringe explícitamente por acción (`decideFraudCase` excluye
`internal_operator`/`risk_analyst`/`compliance_analyst`; `decideManualReviewCase` excluye
`compliance_analyst`/`fraud_analyst`). Aquí, el mismo conjunto amplio de roles puede tanto **crear**
como **aprobar/publicar** una versión de catálogo (`decideCatalogVersion`), y tanto **crear** como
**activar** una versión de reglas de riesgo (`activateRiskRulesetVersion`) — sin ningún chequeo de
que el actor que decide/activa sea distinto del que creó/propuso el cambio.

**Por qué importa:** `activateRiskRulesetVersion` es, literalmente, el interruptor que determina
qué conjunto de reglas gobierna el scoring de riesgo de **todo el tenant en producción** —
`retireOtherActiveRulesets` desactiva automáticamente cualquier otro ruleset activo al activar
uno nuevo. Con el modelo de roles actual, un único `fraud_analyst` (o cualquier otro rol de la
lista) puede crear un ruleset completo (`createRiskRulesetVersion`, incluyendo las reglas y
`isHardStop`) y activarlo él mismo en la siguiente llamada, sin que ningún segundo actor lo
revise. Lo mismo aplica a `decideCatalogVersion` con `decision: 'publish'` sobre los catálogos que
alimentan los mapeos de riesgo. En un sistema fintech, la ausencia de separación entre "quien
propone" y "quien aprueba/activa" para el control que define las reglas de negocio de riesgo es
exactamente el tipo de brecha que un regulador o un auditor externo señalaría primero.

**Por qué no lo corregí yo mismo:** decidir qué rol(es) específicos deberían poder aprobar/activar
(¿solo `admin`/`platform_admin`? ¿`compliance_analyst` para gobernanza de datos pero no para
reglas de riesgo?) es una decisión de política interna del equipo de riesgo/compliance, no un bug
de implementación — adivinar la matriz de roles "correcta" y aplicarla unilateralmente podría
bloquear un flujo de trabajo legítimo del equipo tanto como dejar la brecha abierta podría
permitir un abuso. A diferencia del hallazgo Medio de arriba (una comparación de ids faltante,
sin ambigüedad de negocio), esto requiere una decisión explícita del equipo.

**Recomendación concreta:** (a) separar, a nivel de `@Roles` por endpoint (mismo patrón ya usado
en `operations.controller.ts`), qué roles pueden `create`/`submit`/`ingest` de qué roles pueden
`decide`/`activate`; y (b) considerar un chequeo de "actor distinto" (comparar
`version.createdBy*`/`ruleset` creador contra el actor que decide) para las acciones más críticas
(`activateRiskRulesetVersion`, `decideCatalogVersion` con `publish`), similar a cómo
`operations.controller.ts` ya distingue roles por tipo de decisión.

---

## Qué quedó verificado como correcto (sin cambios)

- Todas las tablas de este módulo (`context_catalogs`, `context_catalog_versions`,
  `risk_ruleset_versions`, etc.) son de alcance de plataforma, no por tenant — confirmado que
  ninguna tiene columna `_tenant_id` en su modelo; la falta de scoping por `tenantId` en las
  queries es correcta por diseño, no una omisión (el `tenantId` del `RequestContext` se usa solo
  para las filas de auditoría/data-change, que sí son por tenant).
- Todas las escrituras propagan `actorInternalUserId`/`actorPlatformUserId` reales en
  `createAudit`/`createDataChange` (vía `auditBase`/`actorPlatformUserId` en
  `catalog-management.shared.ts`) — este módulo no repite el patrón de `null` fijo corregido en
  otros módulos de este lote.
- `createCatalogVersion` valida que el catálogo exista antes de crear la versión;
  `submitCatalogVersion` exige `status === 'draft'` y al menos un item
  (`CATALOG_VERSION_WITHOUT_ITEMS`); `decideCatalogVersion` valida transiciones de estado
  (`CATALOG_VERSION_NOT_READY_TO_PUBLISH`, `CATALOG_VERSION_NOT_PENDING_APPROVAL`) antes de
  escribir.
- `activateRiskRulesetVersion` solo permite activar desde `draft`/`inactive`/`approved`
  (`RULESET_VERSION_NOT_ACTIVATABLE`) y retira atómicamente cualquier otro ruleset activo del
  mismo código dentro de la misma transacción — no puede quedar más de un ruleset activo por
  `rulesetCode` en un estado intermedio inconsistente.
- Los 8 endpoints de escritura exigen `X-Idempotency-Key` (`requireIdempotencyHeader` en el
  controller + `requireIdempotency` de nuevo en cada servicio de aplicación).
- Toda la escritura de cada operación ocurre dentro de una única transacción Sequelize.
