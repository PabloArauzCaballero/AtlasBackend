# Contratos públicos congelados (AT-005)

**Estado:** contrato OpenAPI congelado y verificado; caracterización de flujos críticos cubierta a nivel de servicio
con PostgreSQL real; los *golden tests* HTTP contra la API levantada **no se hicieron** (ver «Lo que falta»). Base:
dev@5650b95, 2026-09-11.

## 1. El contrato OpenAPI, congelado

| Dato | Valor |
|---|---|
| Archivo versionado | `docs/endpoints/openapi.yaml` |
| SHA-256 al congelar | `4ce905c33fbeb0a57a52e448898572cd59b4e6bf78fc55f30004385337f795e2` |
| Rutas (`paths`) | 469 |
| Gates que lo custodian | `yarn docs:openapi` (regenera arrancando Nest de verdad), `yarn check:openapi` (sincronía con las rutas montadas, reglas propias), `yarn docs:openapi:lint` (Redocly) |

Los tres pasaron **antes y después** de los cambios de F1 (rc=0), y el archivo versionado no cambió: el refactor de
admisión e idempotencia no tocó ninguna ruta, código de respuesta ni esquema. `RecordedEligibility.evaluationId` es
interno: `toEligibilityResponse` lo retira antes de responder, y `check:openapi` lo confirmaría si se filtrara.

Cualquier cambio intencional de contrato a partir de aquí debe: regenerar con `docs:openapi`, pasar `check:openapi`, y
declarar el cambio en el reporte de la tarea. Un diff en `openapi.yaml` sin tarea que lo explique es una regresión.

## 2. Flujos críticos: qué queda caracterizado y con qué prueba

| Flujo | Contrato que se preserva | Prueba | Nivel |
|---|---|---|---|
| Solicitud de crédito: admisión | `422 CUSTOMER_NOT_ELIGIBLE: <códigos>` con el mismo texto; `409 CREDIT_APPLICATION_ALREADY_OPEN`; `404 CREDIT_PRODUCT_NOT_FOUND`; `422 CREDIT_PRODUCT_NOT_AVAILABLE` | `test/unit/credit/credit-application.service.spec.ts` (9), `test/integration/credit/*.spec.ts` (10) | Servicio + PostgreSQL |
| Elegibilidad (`GET …/eligibility`) | Mismo cuerpo que antes (sin `evaluationId`) | `test/unit/customers/customer-eligibility.service.spec.ts`; `check:openapi` | Servicio + contrato |
| Idempotencia (`X-Idempotency-Key`) | `409 IDEMPOTENCY_CONFLICT`, `409 IDEMPOTENCY_REQUEST_IN_PROGRESS`; replay con status y cuerpo guardados; **nuevo** `409 IDEMPOTENCY_REPLAY_NOT_AVAILABLE` sólo en rutas de credenciales | `test/unit/runtime-hardening/*.spec.ts` (30), `test/integration/runtime/idempotency-lease-race.spec.ts` (5), `test/contracts/runtime/idempotency-replay.spec.ts` (16) | Servicio + PostgreSQL + contrato de política |
| Alta, login/refresh internos, eventos, notificaciones | Sin cambios de código en F0/F1 | Suites e2e existentes (366 pruebas, rc=0) | HTTP con dobles de servicio |

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

## 3. Lo que falta (NOT_RUN, declarado)

El plan pide `test/contracts/http/public-compatibility.spec.ts` y `auth-cookie-compatibility.spec.ts`: *golden
contracts* de rutas, cookies, errores y paginación **contra la API real de prueba**. Levantar la API completa en jest
exige Redis, MinIO y los proveedores externos en modo controlado; las suites e2e del repositorio montan controladores con
dobles de servicio, no la aplicación entera. Esa infraestructura de arranque es la que AT-045 (raíces `ApiModule`/`WorkerModule`)
y AT-052 construyen. Hasta entonces, el contrato HTTP se custodia con el OpenAPI congelado + `check:openapi` + e2e con
dobles, y los flujos críticos con las pruebas de integración de servicio. Ninguna captura ni snapshot de esta sección
contiene tokens, contraseñas ni PII.
