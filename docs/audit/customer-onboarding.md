# Auditoría — Módulo `customer-onboarding`

**Alcance revisado:** `customer-onboarding.controller.ts`, `.service.ts` (facade),
`.mapper.ts`, `.dtos.ts`, `.schemas.ts`, `.repository.ts` (facade); los 4 servicios de
aplicación (`customer-onboarding-start.service.ts`,
`customer-contact-verification.service.ts`, `customer-identity-package.service.ts`,
`customer-address-package.service.ts`); `customer-onboarding-access.util.ts` y los 4
repositorios especializados. Tests: los 7 archivos en `test/unit/customer-onboarding/`.

**Resultado:** 2 hallazgos (1 crítico, 1 medio), ambos corregidos. Se agregó 1 test de
regresión nuevo. Suite verde (73/73, antes 72/72). `tsc --noEmit` limpio.

---

## Hallazgo 1 — CRÍTICO: bypass de verificación de contacto con código fijo en producción

**Dónde:** `CustomerContactVerificationService.submitContactVerification()`.

**Qué pasaba:** el propio código ya documentaba esto como un placeholder ("el proveedor
real de OTP todavía está pendiente... para smoke tests locales, se acepta 123456"), pero
esa aceptación **no estaba condicionada a ningún ambiente**. `POST
/customer-onboarding/:customerId/contact-verification/submit` con `verificationCode:
"123456"` verificaba el contacto de cualquier cliente en **cualquier** despliegue,
incluida producción, sin que el destinatario real del teléfono/email hubiera recibido
jamás un código.

**Impacto:** este paso existe específicamente para probar que el cliente controla el
teléfono/email que declaró — es una pieza central de la cadena KYC/anti-fraude del
onboarding. Con el bypass activo en producción, cualquiera con un `customerId` (numérico
secuencial, fácil de enumerar) y un token válido de rol `customer`/interno podía marcar
como verificado el contacto de un cliente ajeno, sin controlar ese teléfono/email,
avanzando el flujo de onboarding (`nextStep: 'identity_capture'`) en su nombre.

**Corrección aplicada:** se agregó un chequeo explícito `if (env.NODE_ENV ===
'production') throw new UnprocessableEntityException('CONTACT_VERIFICATION_OTP_PROVIDER_NOT_CONFIGURED')`
**antes** de comparar contra el código fijo. En producción, todo intento de verificación
falla ahora de forma clara y explícita (en vez de aceptar en silencio un código conocido)
hasta que exista una integración real de envío/validación de OTP. El atajo se conserva
sin cambios en `development`/`test` para smoke tests locales — mismo comportamiento que
antes en esos ambientes.

**Nota importante:** este fix **no implementa** el envío/validación real de OTP — eso
requiere decidir proveedor (SMS/WhatsApp/email), plantillas y wiring con
`external-data`/`notifications` (fuera del alcance de una auditoría). Lo que este fix
garantiza es que producción **nunca** acepte silenciosamente el código de desarrollo; el
endpoint quedará bloqueado en producción hasta que esa integración real se implemente —
preferible a un agujero de seguridad invisible.

**Archivos:** `src/modules/customer-onboarding/application/customer-contact-verification.service.ts`.
**Test de regresión (nuevo):** `customer-contact-verification.service.spec.ts` →
`rejects the dev placeholder "123456" in production, even though it is a syntactically
correct code (regression)` — fija `env.NODE_ENV = 'production'` temporalmente y verifica
que el código correcto sea rechazado y que `markContactMethodVerified` nunca se llame.

---

## Hallazgo 2 — MEDIO: `POST /customer-onboarding/start` siempre devolvía `onboardingFlowId: null`

**Dónde:** `customer-onboarding.mapper.ts` → `toStartOnboardingResponse()`.

**Qué pasaba:** el mapper hardcodeaba `onboardingFlowId: null` con un comentario
("BLOCKED: onboarding_flows table not present in current models") que ya no reflejaba la
realidad del código: `CustomerOnboardingStartService.startOnboarding()` sí crea una fila
en `onboarding_flows` en la misma transacción (`createOnboardingFlowAndFirstEvent`), y el
resto de los servicios de este módulo (`requestContactVerification`,
`submitIdentityPackage`, `submitAddressPackage`) consultan activamente esa tabla vía
`findLatestOnboardingFlow`. El comentario quedó desactualizado de una fase anterior del
proyecto y nadie volvió a conectar el dato real con la respuesta.

**Impacto:** no es una falla de seguridad — ningún endpoint posterior de este módulo
necesita que el cliente le devuelva el `onboardingFlowId` (todos lo resuelven
server-side por `tenantId`+`customerId`). Pero cualquier consumidor (portal interno,
futura pantalla de "reanudar registro", debugging de soporte) que confiara en este campo
de la respuesta documentada recibía siempre `null`, un dato incorrecto en el contrato de
API.

**Corrección aplicada:** `toStartOnboardingResponse` ahora recibe también el
`onboardingFlow` creado en la transacción y devuelve `String(onboardingFlow.id)`.

**Archivos:** `src/modules/customer-onboarding/customer-onboarding.mapper.ts`,
`src/modules/customer-onboarding/application/customer-onboarding-start.service.ts`.
**Nota relacionada:** `customers.mapper.ts` (`toCustomerMeResponse`,
módulo `customers`, ya auditado) devuelve
`onboarding: null` siempre en `GET /customers/:customerId/me`. Corregirlo requeriría que
`CustomersService` consulte también `CustomerOnboardingRepository` — un cambio de mayor
alcance que cruza módulos. Queda anotado para
una iteración futura.

---

## Qué quedó verificado como correcto (sin cambios)

- Los 4 endpoints de escritura además de `start` exigen `X-Idempotency-Key` explícito
  (`requireIdempotencyKey` en el controller, más un chequeo redundante dentro de cada
  servicio de aplicación — defensa en profundidad).
- `assertCustomerOnboardingScope` (ownership) se llama al inicio de los 4 servicios,
  antes de tocar la base de datos.
- `startOnboarding` combina un chequeo de duplicados rápido (`assertNoDuplicateCustomer`)
  con un índice único a nivel de base de datos + captura de `UniqueConstraintError` — no
  depende únicamente del chequeo aplicativo bajo condiciones de carrera (ya cubierto por
  `onboarding-race-condition.spec.ts`).
- El hashing de contraseña (`hashPassword`, Argon2id) ocurre **antes** de abrir la
  transacción de base de datos — evita mantener locks abiertos durante una operación de
  CPU intencionalmente costosa.
- Ningún dato de contacto crudo (teléfono/email en texto plano) se persiste sin hash o
  sin cifrado de sobre (`encryptSecretEnvelope`); solo se derivan `last4`/`domain` para
  uso en UI.
- El paquete de identidad (`submitIdentityPackage`) nunca autoaprueba: todo evidencia
  entra como `pending_review`, y el estado del cliente pasa a
  `pending_identity_review` — no hay bypass equivalente al del hallazgo 1 en este flujo.
- `CustomerOnboardingRepository` es una fachada delgada ya refactorizada (de 751 líneas a
  4 repositorios especializados) sin cambio de comportamiento — buena estructura previa,
  no requirió cambios.
