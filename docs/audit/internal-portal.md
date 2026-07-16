# Auditoría — Módulo `internal-portal`

**Alcance revisado:** `internal-portal.controller.ts`, `.service.ts`, `.module.ts` (todo el
módulo, 3 archivos). Sin tests unitarios previos (no existía `test/unit/internal-portal/`); se
agregó `internal-portal-roles.spec.ts`.

**Resultado:** 1 hallazgo **Crítico** (el más severo de todo este lote de 15 módulos): el
controller completo carecía de `RolesGuard`/`@Roles(...)` — cualquier actor autenticado,
incluido un `customer`, tenía acceso total a los 17 endpoints del panel interno. Corregido.
Suite verde tras el cambio (3 tests nuevos).

---

## Hallazgo — CRÍTICO: el panel "interno" completo era accesible para cualquier usuario autenticado, incluidos clientes

**Dónde:** `internal-portal.controller.ts` — `@Controller('internal') @UseGuards(JwtAuthGuard)`,
sin `RolesGuard` ni un solo `@Roles(...)` en ninguno de los 17 endpoints (a nivel de clase ni de
método).

**Qué encontré:** `JwtAuthGuard` (`src/common/guards/jwt-auth.guard.ts`) valida únicamente que el
JWT sea válido, no esté expirado y no esté revocado; **no valida el rol del
actor**. La autorización por rol vive exclusivamente en `RolesGuard`, que lee la metadata que
pone `@Roles(...)`. Sin `RolesGuard` en la cadena de guards del controller, ese chequeo
simplemente nunca corre. El resultado: **cualquier token válido de cualquier rol** —
`customer`, `merchant`, o cualquier otro — pasaba `JwtAuthGuard` y llegaba directo al handler,
sin ningún segundo filtro.

Los 17 endpoints expuestos así incluían:
- Lectura de metadata de negocio interna (`GET business-metadata/glossary`, `.../terms/:termId`)
  — nombres, dueños, definiciones y relaciones de tablas internas del sistema.
- Exports del catálogo de endpoints/datos/reglas de calidad (`GET exports`, `.../:exportId`).
- Reglas de calidad de datos y su ejecución (`GET/POST data-quality/rules...`).
- **Políticas de gobierno de datos**, incluyendo `PATCH governance/policies/:policyId` — hoy no
  persiste en base de datos (ver nota abajo), pero el endpoint respondía como si el cambio se
  hubiera aplicado.
- Grafo completo de linaje de datos (`GET lineage`, `.../nodes/:nodeId`, `.../impact`) — qué
  tablas/endpoints tocan qué datos, con nivel de criticidad y PII.
- Alertas de calidad de datos, y **`POST alerts/:alertId/acknowledge`, que sí ejecuta un `UPDATE`
  real** sobre `data_quality_issues` (`issue_status = 'acknowledged'`) — un cliente podía marcar
  como reconocida una alerta interna de calidad de datos.
- Jobs operativos (`GET jobs`, `POST .../retry`, `POST .../cancel`) y estado de "release
  readiness" del sistema completo.
- Reportes ejecutivos (`GET/POST reports...`) y búsqueda global sobre el catálogo interno.

**Impacto:** exposición completa de metadata operativa/de gobierno interna (incluyendo qué
columnas contienen PII, niveles de sensibilidad y riesgo, y la topología completa de endpoints
↔ tablas) a cualquier cuenta autenticada, más al menos una vía de escritura real
(`acknowledgeAlert`) alcanzable sin ningún rol interno. Es el hallazgo más severo de los 15
módulos auditados en este lote — a diferencia del SSRF de `systems-ops` (que requería encadenar
varias llamadas y ya exigía *algún* rol operativo), aquí no hacía falta ningún privilegio en
absoluto, solo estar autenticado.

**Corrección aplicada:** se agregó `RolesGuard` a `@UseGuards(...)` y `@Roles(...)` a nivel de
clase con el conjunto de roles internos ya usado por los módulos hermanos de audiencia
equivalente (`operations`, `data-quality`, `audit`, `systems-ops`): `internal_operator`,
`risk_analyst`, `compliance_analyst`, `admin`, `platform_admin`, `system_admin`, `qa_engineer`,
`devops`, `readonly_auditor`. Esto cierra el hueco crítico (de "cualquiera" a "solo roles
internos") para los 17 endpoints de una sola vez. Test nuevo
(`internal-portal-roles.spec.ts`) fija por metadata de reflexión que (a) el controller aplica más
de un guard, (b) el rol declarado excluye explícitamente `customer`/`merchant`, y (c) incluye el
set de roles internos esperado.

**Alcance del fix, explícitamente no cerrado:** igual que en `systems-ops` (auditoría #16), este
módulo mezcla lectura (glosario, exports, lectura de reglas/políticas/linaje/alertas/jobs/reportes)
con escritura real o aparente (`runDataQualityRule`, `updateGovernancePolicy`,
`acknowledgeAlert`, `retryJob`, `cancelJob`, `runReport`) bajo el mismo rol de clase — no se
diferenció por acción (p. ej. excluir `readonly_auditor` de los endpoints de escritura, como se
hizo en `systems-ops`). Se decidió no hacerlo en esta corrección para no demorar el cierre del
hueco crítico (que no distingue rol alguno) detrás de una decisión de granularidad fina; queda
como refinamiento recomendado, con precedente ya establecido en `systems-ops.constants.ts`.

---

## Qué quedó verificado como correcto (sin cambios)

- Todo el SQL crudo del servicio (~25 queries en `internal-portal.service.ts`) usa
  `replacements` parametrizados vía `QueryTypes.SELECT`; los fragmentos de SQL ensamblados
  dinámicamente (filtros `ILIKE`, `WHERE` condicional) solo intercalan **texto SQL estático**
  elegido por rama booleana — nunca concatenan directamente valores de entrada del cliente. Sin
  superficie de inyección SQL pese al volumen de queries manuales.
- `updateGovernancePolicy` no persiste en base de datos hoy (el propio código lo documenta:
  `persisted: false`, "aplicar persistencia granular por tipo de política si se requiere gobierno
  editable") — el `PATCH` devuelve una vista fusionada en memoria, no un cambio real. El hallazgo
  Crítico sigue siendo válido igual (exposición de lectura + `acknowledgeAlert` sí persiste), pero
  este endpoint específico no representa un riesgo de integridad de datos adicional hoy.
- `retryJob`/`cancelJob` tampoco disparan una acción de control de jobs real todavía — solo
  devuelven un mensaje de estado; no hay un sistema de colas/workers conectado.
