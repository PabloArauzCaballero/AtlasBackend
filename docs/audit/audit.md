# Auditoría — Módulo `audit`

**Alcance revisado:** `audit.controller.ts`, `.service.ts`, `.repository.ts`, `.schemas.ts`,
`.module.ts`, `http-action-log.service.ts`. Tests: `test/unit/audit/audit-cursor.spec.ts`
(existente) y `audit-repository-event-types.spec.ts` (nuevo).

**Resultado:** 1 hallazgo Alto (3 de los 9 tipos de evento del enum público nunca se
consultaban, siempre devolvían vacío en silencio), corregido. Como efecto secundario directo de
este hallazgo, se corrigió el mismo patrón de trazabilidad (`actorInternalUserId` no
propagado) en `risk.repository.ts` — ver addendum en [risk.md](./risk.md). Suite verde tras el
cambio (12/12 en `audit`, 16/16 en `risk` sin regresiones).

---

## Hallazgo (Alto) — `eventType=consent|manual_review|fraud` devolvía siempre `[]`, y `eventType=all` no incluía esas 3 fuentes

**Dónde:** `audit.repository.ts::findCustomerAuditEvents`.

**Qué encontré:** `auditQuerySchema.eventType` es un enum de 9 valores: `all`, `status`, `auth`,
`consent`, `risk`, `manual_review`, `fraud`, `data_change`, `customer_action`. La validación Zod
acepta los 9 sin error. Pero `findCustomerAuditEvents` solo tenía ramas `if` para `status`,
`auth`, `data_change`, `customer_action` (más el catch-all de `operational_audit_logs` bajo
`all`) — **no existía ninguna rama** para `consent`, `manual_review`, ni `fraud`, pese a que
`ConsentEventModel`, `ManualReviewEventModel` y `FraudCaseEventModel` estaban inyectados en el
constructor del repositorio desde el principio (importados, con `@InjectModel`, pero nunca
usados en ningún método del archivo — confirmado por búsqueda exacta de sus referencias).

**Impacto:** este es el endpoint que usa el equipo de operaciones/compliance
(`internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`,
`platform_admin`) para reconstruir el historial completo de un cliente — el caso de uso
canónico es una disputa regulatoria o una investigación de fraude, donde precisamente el
historial de consentimientos y las decisiones de revisión manual/fraude son la evidencia más
relevante. Con el bug:
- `GET .../customer/:id?eventType=consent` (o `manual_review`, o `fraud`) devolvía `{ events:
  [], meta: { total: 0 } }` — sin error, indistinguible de "este cliente no tiene eventos de
  este tipo", cuando en realidad el filtro simplemente no estaba implementado.
- `GET .../customer/:id` (sin filtro, `eventType=all` por default) tampoco incluía estos 3 tipos
  de evento en el feed combinado — un investigador que pidiera "todo" sobre un cliente se perdía
  sistemáticamente sus consentimientos, decisiones de revisión manual y decisiones de fraude,
  sin ninguna señal de que faltaban.

**Corrección aplicada:**
- 3 ramas nuevas en `findCustomerAuditEvents`, activas tanto para su tipo específico como para
  `all`:
  - `consent`: resuelve primero los `id` de `customer_consents` para `(tenantId, customerId)`
    (`ConsentEventModel` no tiene `customerId` propio, se vincula vía `customerConsentId`),
    luego filtra `ConsentEventModel` por esos ids.
  - `manual_review`: mismo patrón vía `ManualReviewCaseModel` → `manualReviewCaseId`.
  - `fraud`: mismo patrón vía `FraudCaseModel` → `fraudCaseId`.
  - Las 3 evitan la consulta al evento cuando el padre no tiene ninguna fila para el cliente
    (retorno temprano, sin `IN ()` vacío).
- `audit.module.ts`: registra `CustomerConsentModel`, `ManualReviewCaseModel`, `FraudCaseModel`
  en el `forFeature` (necesarios para resolver los ids padre).
- Tests nuevos (`audit-repository-event-types.spec.ts`, 5 casos): cada rama resuelve ids padre
  antes de consultar el evento; `consent` devuelve `[]` sin tocar `consent_events` cuando el
  cliente no tiene ningún consentimiento; `all` mezcla las 3 fuentes nuevas con las 5 ya
  existentes.

**Nota de alcance — `eventType=risk` queda sin corregir:** a diferencia de los otros 3, los
eventos de riesgo no tienen una tabla de eventos dedicada con un id de "caso padre" limpio —
`RiskService.createRiskAssessment` escribe directamente a `operational_audit_logs` con
`targetType: 'customer'` (por eso SÍ aparece mezclado dentro de `eventType=all`, solo que
etiquetado `operational_audit` en vez de `risk`). Filtrar específicamente por `eventType=risk`
requeriría o bien un campo distintivo confiable (hoy solo existe `actionCode:
'risk_assessment.created'`, un match por substring de código de acción, no una columna
dedicada) o un cambio de esquema. Documentado como el mismo tipo de decisión de diseño que
la paginación por cursor — no es un bug de una línea, es una decisión de modelado.

---

## Qué quedó verificado como correcto (sin cambios)

- Todo el controller está detrás de roles internos — sin acceso de cliente al historial de
  auditoría de otro (ni del propio, este endpoint no es de autoservicio).
- El cursor real (`getCustomerAuditFeed`, vista `audit_event_feed`) usa SQL parametrizado
  (`replacements`, nunca interpolación de string) — sin superficie de inyección SQL pese a ser
  la única query cruda del módulo.
- La paginación por página profunda pide `offset + limit` filas por fuente y sigue acotada por
  `MAX_DEPTH`; la limitación restante para offsets muy profundos ya está documentada como
  pendiente de diseño, no se reabre aquí.
- `http-action-log.service.ts` sanitiza (`sanitizeForSystemsOps`) y redacta (`redactSensitiveObject`)
  el payload antes de persistirlo tanto en `operational_audit_logs` como en `system_action_logs`,
  y ya propaga `actorInternalUserId`/`actorPlatformUserId` reales (no `null` fijo) — no repite el
  patrón corregido en otros módulos de este lote.
