# Plan — Cambiar el correo aunque ya se haya verificado un contacto

- Fecha: 2026-10-06 · Repos afectados: AtlasBackend, AtlasFrontend (consumer-app) · Predecesor: N6 (alta/corrección de contacto)
- Resultado observable: una persona que escribió mal su correo —en el alta o ya con la cuenta activa, y con su teléfono o correo ya verificado— puede, desde la app, escribir el correo correcto, recibir un código EN ESE correo, confirmarlo, y desde ese momento ingresar con el correo nuevo.
- Kill-test: con un cliente cuyo contacto ya está `verified`, `POST /contact-methods` con el correo nuevo → pedir código con `contactMethodId` → confirmar → `customers.primary_email_hash` debe ser el hash del correo nuevo. Si la app no ofrece ningún camino a esto, no está hecho.

## Hallazgos (fase 1)
- HECHO: `POST /customer-onboarding/:id/contact-methods` existe y admite estados de alta y `active` (`customer-contact-methods.service.ts`). El contacto nace `unverified`.
- HECHO: pedir/confirmar código aceptan `contactMethodId` (`contact-method-resolution.service.ts`); al verificar se promueve a principal y se sincroniza `customers.primary_email_hash`.
- HECHO: el login del cliente resuelve por `customers.primary_email_hash` (`auth-actor-resolver.service.ts:51`), así que promover cambia el correo de ingreso.
- HECHO (defecto backend): volver a dar de alta el MISMO correo aún sin verificar responde 409 `CONTACT_ALREADY_REGISTERED` («ya está registrado en otra cuenta»). Si la app se cierra entre «agregar» y «confirmar», la persona no puede retomar: no tiene el id, y pedir código sin id elige el primario sin verificar —el mal escrito—.
- HECHO (defecto backend): el mismo 409 se usa para «ese valor es de OTRA cuenta» y para «ya lo tienes tú verificado»: la app no puede distinguir.
- HECHO (defecto frontend): la app no llama a `contact-methods`, `requestContactVerification`/`submit` no envían `contactMethodId`, y no hay pantalla para cambiar el correo (perfil solo lo muestra; editar-perfil solo preferencias).
- HECHO: el grupo `(onboarding)` solo exige sesión, así que una pantalla ahí sirve en el alta y con cuenta activa.

## Alcance
- IN: backend `addContactMethod` idempotente para el mismo valor no verificado + código distinto para «ya verificado por ti»; tests unitarios; doc OpenAPI. Frontend: endpoint `addContactMethod`, `contactMethodId` en pedir/confirmar, pantalla `cambiar-correo`, accesos desde Perfil y desde Verificar contacto.
- OUT: cambio de teléfono en la app (mismo mecanismo, otro pedido); aviso al correo anterior; reautenticación con contraseña antes del cambio (ver riesgos); volver a un correo antiguo ya verificado no principal.
- «Elevado a test»: flujo real `dev` → `test` (`main` está abandonado). Corregido el 2026-10-06 tras abrir primero contra `main`.

## H1 — Cambiar el correo de la cuenta
**CA:** Dado un cliente con contacto verificado, cuando escribe un correo nuevo en la app y confirma el código que llegó a ese correo, entonces su correo principal y de ingreso pasa a ser el nuevo.
**DoD:** `yarn type-check`, `yarn lint`, tests unitarios backend; `typecheck`, `lint`, `test` del consumer-app; CI verde en ambos PR; integrado en `main` (TEST).
**Estado:** EN CURSO

### H1.S1 — Backend: retomar el cambio
| ID | Microtarea | CA (binario) | DoD | Estado |
|---|---|---|---|---|
| H1.S1.M1 | Re-alta del mismo valor sin verificar devuelve el contacto existente | Mismo correo `unverified` del mismo cliente → 201 con el mismo `contactMethodId`, sin crear fila | `yarn test test/unit/customer-onboarding` verde con caso nuevo | HECHO |
| H1.S1.M2 | Valor ya verificado del propio cliente → 409 `CONTACT_ALREADY_VERIFIED` | Respuesta distinta de la de «otra cuenta» | mismo comando, caso nuevo | HECHO |
| H1.S1.M3 | Gates backend | sin errores | `yarn type-check && yarn lint && yarn format:check` exit 0 | HECHO |

### H1.S2 — Frontend: pantalla de cambio de correo
| ID | Microtarea | CA (binario) | DoD | Estado |
|---|---|---|---|---|
| H1.S2.M1 | API: `addContactMethod` + `contactMethodId` en pedir/confirmar | tipos alineados al backend | `npm run typecheck` exit 0 | HECHO |
| H1.S2.M2 | Pantalla `(onboarding)/cambiar-correo` (escribir → código → confirmado) con estados de carga/error y errores por campo | flujo completo contra el contrato | test unitario de la lógica de pasos + typecheck | A MEDIAS |
| H1.S2.M4 | Cliente HTTP: no refrescar/reenviar ante 401 de código incorrecto o vencido (añadida: defecto descubierto) | un código mal escrito gasta UN intento | `npx jest __tests__/change-email.test.ts` (shouldRefreshOn) | HECHO |
| H1.S2.M3 | Accesos: fila «Correo» del Perfil y enlace en Verificar contacto | se navega a la pantalla | typecheck + lint exit 0 | A MEDIAS |

### H1.S3 — Elevar a TEST
| ID | Microtarea | CA | DoD | Estado |
|---|---|---|---|---|
| H1.S3.M1 | PR backend (#201) → `dev` con CI verde e integrado | merge hecho | estado del PR | EN CURSO |
| H1.S3.M2 | PR frontend (AtlasFrontend#52) → `dev` con CI verde e integrado | merge hecho | estado del PR | EN CURSO |
| H1.S3.M3 | Adelantar `test` a `dev` en ambos repos (así se eleva a TEST) | `test` == `dev` | `git rev-parse origin/test origin/dev` | TODO |

## Riesgos y bloqueos previstos
| Riesgo | Impacto | Mitigación |
|---|---|---|
| Sesión robada cambia el correo de ingreso y luego recupera la contraseña | Toma de cuenta | El código exige controlar el correo NUEVO, no el viejo. Falta reautenticación/aviso al anterior: queda como riesgo residual registrado |
| Sin Postgres para test de integración | Persistencia no ejercitada de punta a punta | Unitarios + CI de integración del repo |
