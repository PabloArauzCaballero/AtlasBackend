# Contratos públicos congelados (AT-005)

**Estado:** contrato OpenAPI congelado y verificado; caracterización de flujos críticos cubierta a nivel de servicio
con PostgreSQL real; los _golden tests_ HTTP contra la API levantada **no se hicieron** (ver «Lo que falta»). Base:
dev@5650b95, 2026-09-11.

## 1. El contrato OpenAPI, congelado

| Dato                   | Valor                                                                                                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Archivo versionado     | `docs/endpoints/openapi.yaml`                                                                                                                                         |
| SHA-256 al congelar    | `4ce905c33fbeb0a57a52e448898572cd59b4e6bf78fc55f30004385337f795e2`                                                                                                    |
| Rutas (`paths`)        | 469                                                                                                                                                                   |
| Gates que lo custodian | `yarn docs:openapi` (regenera arrancando Nest de verdad), `yarn check:openapi` (sincronía con las rutas montadas, reglas propias), `yarn docs:openapi:lint` (Redocly) |

Los tres pasaron **antes y después** de los cambios de F1 (rc=0), y el archivo versionado no cambió: el refactor de
admisión e idempotencia no tocó ninguna ruta, código de respuesta ni esquema. `RecordedEligibility.evaluationId` es
interno: `toEligibilityResponse` lo retira antes de responder, y `check:openapi` lo confirmaría si se filtrara.

Cualquier cambio intencional de contrato a partir de aquí debe: regenerar con `docs:openapi`, pasar `check:openapi`, y
declarar el cambio en el reporte de la tarea. Un diff en `openapi.yaml` sin tarea que lo explique es una regresión.

## 2. Flujos críticos: qué queda caracterizado y con qué prueba

| Flujo                                                 | Contrato que se preserva                                                                                                                                                                | Prueba                                                                                                                                                                | Nivel                                        |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Solicitud de crédito: admisión                        | `422 CUSTOMER_NOT_ELIGIBLE: <códigos>` con el mismo texto; `409 CREDIT_APPLICATION_ALREADY_OPEN`; `404 CREDIT_PRODUCT_NOT_FOUND`; `422 CREDIT_PRODUCT_NOT_AVAILABLE`                    | `test/unit/credit/credit-application.service.spec.ts` (9), `test/integration/credit/*.spec.ts` (10)                                                                   | Servicio + PostgreSQL                        |
| Elegibilidad (`GET …/eligibility`)                    | Mismo cuerpo que antes (sin `evaluationId`)                                                                                                                                             | `test/unit/customers/customer-eligibility.service.spec.ts`; `check:openapi`                                                                                           | Servicio + contrato                          |
| Idempotencia (`X-Idempotency-Key`)                    | `409 IDEMPOTENCY_CONFLICT`, `409 IDEMPOTENCY_REQUEST_IN_PROGRESS`; replay con status y cuerpo guardados; **nuevo** `409 IDEMPOTENCY_REPLAY_NOT_AVAILABLE` sólo en rutas de credenciales | `test/unit/runtime-hardening/*.spec.ts` (30), `test/integration/runtime/idempotency-lease-race.spec.ts` (5), `test/contracts/runtime/idempotency-replay.spec.ts` (16) | Servicio + PostgreSQL + contrato de política |
| Alta, login/refresh internos, eventos, notificaciones | Sin cambios de código en F0/F1                                                                                                                                                          | Suites e2e existentes (366 pruebas, rc=0)                                                                                                                             | HTTP con dobles de servicio                  |

### Cambios de comportamiento declarados (no son regresiones, son decisiones de F1)

1. **Denegación de crédito deja evidencia** (AT-008): antes el rollback la borraba. Código y mensaje HTTP idénticos.
2. **Huella de idempotencia semántica** (AT-010): dos cuerpos que difieren sólo en un campo sensible ya no colapsan en la
   misma huella (antes sí: `test/unit/idempotency-hash.test.ts` documenta el comportamiento de la utilidad de redacción,
   que sigue igual; lo que cambió es que el servicio ya no la usa para decidir igualdad). Las claves vivas escritas con la
   huella anterior se siguen reconociendo (`fingerprintMatches` compara con el algoritmo con que se escribieron).
3. **Replay sólo para el mismo actor** (AT-010): otra persona con la misma clave recibe `IDEMPOTENCY_CONFLICT`, no la
   respuesta ajena.
4. **Rutas de credenciales no reproducen su respuesta** (AT-010): un reintento de login/OTP/refresh con la misma clave
   recibe `409 IDEMPOTENCY_REPLAY_NOT_AVAILABLE` y debe repetir la petición con clave nueva.

### Cambio de comportamiento declarado a posteriori (revisión independiente B, hallazgo 4)

Con el directorio de destinatarios por puerto (AT-039, commit `aa083ce`), la entrega transaccional a clientes
(`purpose='transactional'`: SMS, WhatsApp, correo) exige que el contacto esté **verificado**. Antes servía cualquier
contacto no borrado con valor cifrado, verificado o no. Efecto: un cliente cuyo teléfono o correo sigue `unverified`
deja de recibir avisos transaccionales por ese canal; `otp` sigue aceptando el contacto no verificado (es cómo se
verifica) y las notificaciones in-app/push no dependen del directorio. Es una decisión de política de datos —no
entregar a una dirección que nadie confirmó—, no un efecto colateral, y por eso se declara aquí.

## 3. Golden contracts (AT-005, ejecutados desde F9)

- `test/contracts/http/public-compatibility.spec.ts`: proyección de la superficie pública (rutas, métodos, códigos,
  cabeceras obligatorias, parámetros, seguridad) comparada con `__golden__/public-surface.json`; rutas sin esquema de
  seguridad fuera de los prefijos públicos congeladas en `__golden__/unprotected-routes.json`: **5**. Tres son públicas de
  verdad (`GET /app-content`, `GET /consent-documents/active`, `POST /customer-onboarding/start`); las **dos** de
  `internal/contexts/customers/recipient-directory` figuran ahí porque llevan `@Public()` —el guard de sesión no entiende
  tokens de servicio, que son de otra audiencia— pero las protege `ServiceTokenGuard`, y lo que lo vigila es
  `test/contracts/security/service-boundary-routes.spec.ts` (si alguien quita el guard, falla ese gate, no la golden).
  Sin valores sensibles. Regenerar a propósito con `UPDATE_GOLDEN=1` y revisar el diff.
- `test/contracts/http/auth-cookie-compatibility.spec.ts`: login interno contra el controlador real (guards reales,
  servicio doble): dos cookies `HttpOnly`, `Path=/`, `SameSite`/`Secure` por configuración, acceso de sesión y refresh
  persistente, body sin tokens; reto de PIN sin cookies; logout borra con los mismos atributos.

**Límite declarado:** los servicios son dobles; la aplicación completa no se arranca en jest (necesita Redis, MinIO y
proveedores). El contrato de datos lo cubren las pruebas de integración por dueño y los recorridos de AT-052.
