# Auditoría — Módulo `customers`

**Alcance revisado:** `customers.controller.ts`, `.service.ts`, `.repository.ts`,
`.mapper.ts`, `.schemas.ts`, `.dtos.ts`, `.module.ts`; `common/utils/auth/ownership.util.ts`
(`assertOwnCustomerResource`). Tests: `test/unit/customers/customers.service.spec.ts`.

Módulo pequeño (un solo endpoint, `GET /customers/:customerId/me`) pero de alto tráfico:
es el endpoint "perfil 360" que consulta cada pantalla del cliente.

**Resultado:** 1 hallazgo crítico, corregido. Se agregó 1 test de regresión (antes 0
cobertura sobre este ángulo). Suite verde (5/5). `tsc --noEmit` limpio.

---

## Hallazgo 1 — CRÍTICO: el endpoint de perfil de cliente no restringía roles

**Dónde:** `CustomersController.getCustomerMe` (`GET /customers/:customerId/me`).

**Qué pasaba:** el controller aplica `@UseGuards(JwtAuthGuard, RolesGuard)`, pero el
método **no tenía `@Roles(...)`**. `RolesGuard` deja pasar cualquier request cuando no hay
roles requeridos (`if (!requiredRoles || requiredRoles.length === 0) return true`), así que
literalmente cualquier rol autenticado llegaba al servicio.

La única barrera real era `assertOwnCustomerResource(currentUser, customerId)`, que **solo**
bloquea cuando `currentUser.role === 'customer'` y el `customerId` no coincide con el suyo.
Para cualquier otro rol (`merchant`, `system`, o cualquier rol futuro que se agregue a
`AtlasUserRole`), esa función no hace nada — no exige que el rol sea siquiera de soporte
interno.

Comparé contra los módulos hermanos que exponen el mismo patrón `:customerId` (todos
documentados en `ownership.util.ts`): `customer-privacy`,
`customer-telemetry`, `sessions`, `risk` y `customer-onboarding` **sí** declaran
`@Roles('customer', 'internal_operator', ...)` explícito en cada endpoint. `customers`
era el único módulo de este grupo sin esa lista — un decorador faltante, no una decisión
de diseño.

**Impacto:** un actor autenticado con rol `merchant` o `system` (pensados para flujos
muy distintos: comercios afiliados, integraciones máquina-a-máquina) podía leer el
perfil completo (nombre, fecha de nacimiento, últimos 4 dígitos de teléfono/email,
consentimientos otorgados/rechazados, último resultado de riesgo) de **cualquier**
cliente del tenant, sin ninguna relación con ese cliente. Dado que `assertOwnCustomerResource`
ya había sido creada específicamente para cerrar este tipo de brecha en otros módulos
este endpoint quedó fuera de la cobertura de ownership compartida.

**Corrección aplicada:** se agregó `@Roles('customer', 'internal_operator', 'risk_analyst',
'compliance_analyst', 'admin', 'platform_admin')` al método — el mismo patrón (cliente +
roles de soporte/riesgo/cumplimiento/administración) usado en `customer-privacy` y `risk`,
los módulos que exponen el subconjunto de datos más parecido (consentimientos + riesgo).

**Archivos:** `src/modules/customers/customers.controller.ts`.
**Test de regresión (nuevo):** `test/unit/customers/customers.service.spec.ts` →
`CustomersController.getCustomerMe — role restriction (regression) › keeps an explicit
@Roles(...) restriction on GET :customerId/me`. Verifica vía `Reflect.getMetadata` sobre
`ROLES_KEY` que el decorador siga presente y que roles como `merchant`/`system` no estén
incluidos — no dependía de infraestructura e2e nueva, solo de la metadata que Nest ya
adjunta al método en tiempo de carga del módulo.

---

## Qué quedó verificado como correcto (sin cambios)

- `CustomersService.getCustomerMe` sigue llamando a `assertOwnCustomerResource` primero
  (antes de tocar la base de datos) — el fix de roles es una capa adicional, no un
  reemplazo de esa verificación de ownership.
- `CustomersRepository` escopa **todas** sus queries por `tenantId` además de `customerId`
  — no hay forma de cruzar tenants aunque se conociera un `customerId` de otro tenant.
- `findById`/`findContactMethods` filtran explícitamente `deleted: { [Op.ne]: true }` —
  un registro borrado lógicamente no resucita a través de este endpoint.
- `customers.mapper.ts` nunca expone hashes ni valores cifrados de contacto — solo
  `phoneLast4`/`emailDomain`, consistente con el resto del sistema (ningún dato de
  contacto crudo se devuelve nunca vía API, ver `docs/endpoints/api-contract.md`).
- Las 4 consultas de `getCustomerMe` (perfil, contactos, consentimientos, riesgo) corren
  en paralelo (`Promise.all`), no secuencialmente — ya cubierto por un test existente.
