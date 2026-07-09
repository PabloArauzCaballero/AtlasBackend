# Auditoría — Módulo `external-data`

**Alcance revisado:** `external-data.controller.ts` (8 sub-controllers: `ExternalDataController`,
`AdminExternalProvidersController`, `KycExternalDataController`, `BureauExternalDataController`,
`PaymentsExternalDataController`, `TelcoExternalDataController`, `FacebookExternalDataController`,
`WhatsappExternalDataController`, `DigitalTrustExternalDataController`), `.service.ts` (facade),
`.repository.ts`, `.schemas.ts`; los 6 servicios de aplicación (`external-data-execution`,
`external-data-governance`, `external-data-evidence`, `external-provider-registry`,
`external-provider-convenience`, `external-data-policy.util`); los 8 adaptadores de proveedor
(`segip`, `infocenter`, `qr-generic`, `banking-generic`, `telco-generic`, `facebook-meta`,
`whatsapp`, `digital-trust-generic`) y `mock-http.util.ts`; `common/utils/privacy/redaction.util.ts`.
Tests: los 6 archivos en `test/unit/external-data/` + 1 nuevo.

Es el módulo más grande auditado hasta ahora (~40 endpoints, ~20 archivos). Maneja
integraciones reales con proveedores externos de identidad (SEGIP), buró de crédito
(Infocenter), pagos (QR/banca), telco, redes sociales y verificación de confianza digital.

**Resultado:** 1 hallazgo alto, corregido. Se agregaron 4 tests de regresión nuevos. Suite
verde (136/136). `tsc --noEmit` limpio.

---

## Hallazgo 1 — ALTO: endpoints administrativos/financieros compartían rol con endpoints de solo lectura

**Dónde:** `AdminExternalProvidersController` (`@Controller('admin/external-providers')`).

**Qué pasaba:** toda la clase declara un único `@Roles('admin', 'platform_admin',
'risk_analyst', 'compliance_analyst')`, razonable para los endpoints de **solo lectura**
(`health`, `readiness`, `usage`, `sla`, `quality-audit`, etc. — dar visibilidad a
risk/compliance sobre el estado de los proveedores es correcto). El problema es que 3
endpoints de **escritura con impacto real** heredaban el mismo rol sin ninguna
restricción adicional:

1. **`PATCH :providerCode/runtime`** — puede cambiar el `defaultMode` de un proveedor a
   `production` (activando integraciones reales de KYC/crédito/pagos), cambiar
   `providerStatus` y `isActive`. Reconfiguración de plataforma, no investigación.
2. **`PATCH :providerCode/cost-policy/:queryType`** — edita la política de costo de un
   proveedor, incluyendo poder desactivar `requiresManualApproval`/`blockByDefault` en
   una query marcada como costo `HIGH`/`CRITICAL` — exactamente la condición que
   `auditExternalProvidersQuality()` marca como hallazgo `CRITICAL`
   (`HIGH_COST_NOT_BLOCKED`) si no está bloqueada.
3. **`POST requests/:requestId/approve`** — aprueba una solicitud pendiente de revisión
   manual/costo alto para ejecución real. Este es precisamente el control que existe
   para que una persona *distinta* de quien pide el dato costoso lo autorice. Con el rol
   compartido, un `risk_analyst`/`compliance_analyst` (el mismo perfil que típicamente
   dispara estas consultas) podía aprobar sus propias solicitudes.

**Impacto:** el diseño del propio módulo (visible en `productionIntegrationBlockers`,
`requiresManualApproval`, `blockByDefault`, el kill-switch, y el auto-chequeo de calidad)
deja claro que el equipo SÍ pensó cuidadosamente en control de costos y gating de
producción — pero la capa de autorización HTTP no reflejaba esa intención para estos 3
endpoints específicos. Sin el fix, un rol pensado para investigar (no para administrar
la plataforma ni aprobar gasto) podía activar un proveedor real en producción, relajar
un control de costo crítico, o autoaprobar sus propias consultas costosas.

**Corrección aplicada:** se agregó `@Roles('admin', 'platform_admin')` a nivel de método
en los 3 endpoints, sobrescribiendo el rol de clase (Nest usa
`getAllAndOverride`, así que el decorador de método gana sobre el de clase). El resto de
la clase (todos los `GET`, `policy/preview` que es dry-run, `kill-switch` que solo hace
más conservador el sistema, `test`/`retry`/`rebuild-features`) se dejó sin cambios —
deliberadamente no se restringió de más sin evidencia clara de que también debieran ser
admin-only.

**Archivos:** `src/modules/external-data/external-data.controller.ts`.
**Tests de regresión (nuevos):** `test/unit/external-data/external-data-admin-roles.spec.ts`
(archivo nuevo, 4 tests) — verifica vía `Reflect.getMetadata(ROLES_KEY, ...)` que los 3
métodos exigen exactamente `admin`/`platform_admin` (y explícitamente NO
`risk_analyst`/`compliance_analyst`), y que los endpoints de solo lectura (`health`) siguen
heredando el rol de clase sin restringirse de más.

**Nota de alcance:** no revisé con el mismo detalle `testProvider`
(`POST :providerCode/test`) ni `retryProviderRequest` — ambos ejecutan una llamada real al
proveedor y podrían merecer la misma restricción; `testProvider` además auto-asigna
`approvedByAdminId: actorId(currentUser)` sin verificar que el actor sea realmente admin.
Decidí no tocarlos en este patch para mantener el fix acotado a los 3 casos inequívocos
(cambio de estado de producción, política de costo, aprobación) — quedan señalados para
revisión de producto sobre si ameritan la misma restricción.

---

## Qué quedó verificado como correcto (sin cambios)

- **Ownership por cliente**: los 8 endpoints con `:customerId` en el path
  (`features`, `scoring-input`, `decision-package`, `observations`, `phone-trust/:id`,
  `status/:id` en Facebook/WhatsApp, `profile/:id` en digital-trust) llaman a
  `assertCustomerAccess`/`assertOwnCustomerResource` en el controller, antes de tocar el
  servicio.
- **`revokeConsent`** verifica explícitamente que el consentimiento pertenezca al
  `customerId` del token cuando el actor es `customer` (`customerScopeForConsentMutation`),
  y no aplica esa restricción para roles internos (comportamiento operativo correcto).
- **`scenario` (forzar un escenario de mock)** es un campo aceptado en varios schemas de
  request, pero **no tiene ningún efecto salvo que el modo del proveedor ya esté en
  `mock_server`**, y ese modo se resuelve exclusivamente desde variables de entorno del
  servidor (`${PROVIDER}_MODE`) — nunca desde el request del cliente. No es un bypass como
  el hallado en `customer-onboarding` (OTP `123456` aceptado incondicionalmente); aquí el
  atajo de desarrollo ya está correctamente aislado de la entrada del cliente.
- **Gate de producción real**: `productionIntegrationBlockers()` bloquea activamente
  (`PROVIDER_UNAVAILABLE` / `PRODUCTION_GATE_BLOCKED`) cualquier ejecución en modo
  `production` si falta el flag `${CODE}_REAL_INTEGRATION_IMPLEMENTED`, credenciales
  requeridas, o si `${CODE}_ALLOW_MOCK_IN_PROD` está activo — verificado que se **llama e
  impone** en `external-data-execution.service.ts`, no solo se calcula y se ignora.
- **Redacción de payloads**: `redactSensitiveObject` (regex amplia sobre nombres de
  campo: password/token/secret/otp/phone/email/gps/address/etc.) se aplica al payload
  crudo del proveedor **antes** de persistirlo (`redactedPayloadJson`); el endpoint
  `sanitization-audit` es una capa de auto-chequeo adicional sobre el dato ya redactado,
  no la única defensa.
- **`updateProviderRuntimePolicy`** exige `confirmProductionReady: true` explícito en el
  body además de pasar los blockers de producción antes de aceptar `defaultMode:
  'production'` — doble candado incluso para quien sí tiene el rol correcto.
- El watchlist de este módulo no se toca aquí — es un dominio separado (`fraud`), ya
  auditado (ver `docs/audit/fraud.md`).
