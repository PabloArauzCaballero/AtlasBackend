# Plan — Pedir la contraseña antes de cambiar el correo

- Fecha: 2026-10-26 · Repos: AtlasBackend, AtlasFrontend (consumer-app) · Rama base: `test` · Predecesor: [2026-10-06-cambiar-correo-verificado](../2026-10-06-cambiar-correo-verificado/PLAN.md)
- Resultado observable: un cliente que quiere cambiar su correo en la app tiene que escribir su contraseña; sin ella (o con una sesión robada) el servidor no acepta el correo nuevo.
- Kill-test: `POST /customer-onboarding/:id/contact-methods` con `contactType: email`, token de cliente válido y SIN `x-reauth-token` → debe responder 403 `REAUTH_REQUIRED`. Si responde 201, no está hecho.

## Hallazgos
- HECHO: `AuthReauthenticationService` (`src/modules/auth/auth-reauthentication.service.ts`) ya implementa la prueba de reautenticación (un solo uso, 300 s, ligada al actor, cuenta en el bloqueo del login). Hoy sólo la usa el comercio (`POST /merchant/auth/reauthenticate` + `x-reauth-token` al cambiar el QR).
- HECHO: `customer-onboarding` ya importa de `auth` y `AuthModule` exporta `AuthReauthenticationService`.
- HECHO: el cliente de la app (`src/api/client.ts`) no permite cabeceras propias por petición.
- HECHO: el cliente NO tiene contraseña de texto: su credencial es el PIN de 4 dígitos (`ingresar.tsx` usa `PinField`; `AuthPinVerifyService` compara el PIN contra `credential.passwordHash`). «Pedir la contraseña» = pedir el PIN. La app ya tiene `src/ui/confirmar-pin-sheet.tsx` para eso.
- HECHO: `auth.controller.ts` está en 303 líneas (deuda congelada): el endpoint va en un controlador propio.

## Alcance
- IN: `POST /auth/reauthenticate` para clientes; `addContactMethod` exige la prueba cuando un CLIENTE declara un CORREO; app pide el PIN (hoja `ConfirmarPinSheet`) antes de declarar el correo y manda la prueba; tests; OpenAPI.
- OUT: cambio de teléfono (mismo riesgo, no pedido: anotado); aviso al correo anterior; personal interno (no lo necesita: entra con segundo factor obligatorio).
- Decisión: la prueba se GASTA al declarar el correo, no al confirmar el código: confirmar puede tardar más que los 300 s de vida de la prueba (hay que ir al correo), y sin el paso de declarar no hay a qué mandar el código.

## H1 — Contraseña antes de cambiar el correo
**CA:** Dado un cliente con sesión, cuando intenta declarar un correo nuevo sin confirmar su contraseña, entonces el servidor responde 403 `REAUTH_REQUIRED`; con la contraseña correcta, sigue el flujo de código igual que antes.
**DoD:** unitarios backend + front, type-check, lint, CI verde, integrado en `test`.
**Estado:** EN CURSO

| ID | Microtarea | CA (binario) | DoD | Estado |
|---|---|---|---|---|
| H1.S1.M1 | `POST /auth/reauthenticate` para cliente | cliente → prueba; no cliente → 403 | test unitario del controlador | TODO |
| H1.S1.M2 | `addContactMethod` exige y gasta la prueba (cliente + correo) | sin prueba → 403 sin escribir; con prueba → la gasta | `customer-contact-methods.service.spec.ts` | TODO |
| H1.S1.M3 | Cabecera `x-reauth-token` del controlador al servicio + OpenAPI | header llega al servicio | spec del controlador + `check:openapi` | TODO |
| H1.S1.M4 | Gates backend | exit 0 | type-check, type-check:tests, lint, format, file-size, openapi | TODO |
| H1.S2.M1 | Cliente HTTP: cabeceras por petición + `reauthenticate()` + header en `addContactMethod` | tipos cierran | `npm run typecheck` | TODO |
| H1.S2.M2 | Pantalla: campo contraseña, errores al campo (`REAUTH_INVALID_PASSWORD`), bloqueo (`ACCOUNT_LOCKED`) | lógica probada | `__tests__/change-email.test.ts` | TODO |
| H1.S2.M3 | Gates front | exit 0 | `npm run verify` + export web | TODO |
| H1.S3.M1 | PRs con base `test`, CI verde, integrados | merge hecho | estado del PR | TODO |
