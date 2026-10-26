# Reporte — Pedir el PIN antes de cambiar el correo

> **AVANCE: 6 / 8 — 75,0 %.** El cambio está escrito y probado en los dos repos; NO está en `test`: el CI del backend lo bloquean dos rojos ajenos al código de este cambio que piden una decisión.

- Fecha: 2026-10-26 · Plan: [PLAN.md](./PLAN.md) · Rama: `claude/great-gauss-f81hpg` (base `test`) · PRs: AtlasBackend#282, AtlasFrontend#147
- Peldaño de evidencia: `TESTED` en los dos repos. Sin `VERIFIED`: no se ejercitó contra un backend real ni se capturó la pantalla.

## Completado
| ID | Qué se logró | Comando | Resultado |
|---|---|---|---|
| H1.S1.M1 | `POST /auth/reauthenticate` para clientes (PIN → prueba de un solo uso, 300 s) | `npx jest test/unit/auth/auth-reauthentication.controller.spec.ts` | PASS 2/2 |
| H1.S1.M2 | Declarar un correo como cliente exige y gasta la prueba; sin ella 403 `REAUTH_REQUIRED` | `npx jest test/unit/customer-onboarding/customer-contact-methods.service.spec.ts` | PASS 11/11; SIN el cambio fallan 9 · `evidencia/backend-rojo-sin-cambio.txt` |
| H1.S1.M3 | La cabecera `x-reauth-token` llega del controlador al servicio; OpenAPI, golden y docs al día | spec del controlador de perfil · contratos · `check:docs-drift` | PASS 13/13 · 262/262 · ✅ |
| H1.S2.M1 | Cliente HTTP con cabeceras por operación; `reauthenticate()`; prueba en `addContactMethod` | `npx jest __tests__/cambiar-correo-pin.test.ts` | PASS 4/4 |
| H1.S2.M2 | La pantalla abre la hoja de PIN antes de declarar el correo; reabre si la prueba venció | `npm run typecheck` + tests | exit 0 |
| H1.S2.M3 | Gates de la app | `npm run verify` + `expo export --platform web` | exit 0; 1594/1594 · `evidencia/frontend-verify.txt` |

## A medias
### H1.S1.M4 — Gates del backend en CI
- Qué anda: en local, type-check, type-check:tests, lint, format, file-size, check:openapi, check:architecture (0 nuevas) y check:docs-drift, todos en verde; 707 tests de auth y onboarding (`evidencia/backend-gates.txt`, `evidencia/backend-unit-auth-onboarding.txt`).
- Qué no anda: en CI, `yarn audit` (avisos nuevos de body-parser/multer/zod, también en `test`) y CodeQL (alerta alta, falso positivo rastreado en el PR).
- Qué falta exactamente: decidir (a) aplicar el parche de dependencias, que está validado y descrito en AtlasBackend#282, y (b) descartar la alerta de CodeQL como falso positivo o reescribir el chequeo compartido.
- Dónde quedó: AtlasBackend#282, rama `claude/great-gauss-f81hpg`; el código compila.

## Pendiente
| ID | Estado | Qué lo destraba |
|---|---|---|
| H1.S3.M1 | BLOQUEADO (DECISION_REQUIRED) | Las dos decisiones de arriba. Orden: primero el backend (#282) y después la app (#147); al revés, el cambio de correo fallaría porque `/auth/reauthenticate` no existe. |

## Evidencia
```text
backend-rojo-sin-cambio.txt    SIN el cambio: 9 failed, 2 passed · CON el cambio: 11 passed
backend-unit-auth-onboarding   Test Suites: 73 passed · Tests: 707 passed
backend-gates.txt              type-check 0 · lint 0 · format 0 · file-size ✅ · openapi ✅ · fronteras 0 nuevas · audit 12 (ajeno)
frontend-verify.txt            verify exit=0 · Tests: 1594 passed · export exit=0
```

## No cubierto
- No se probó contra Postgres real que la prueba sea de un solo uso; lo cubre `consumeOneTimeCode`, que ya existía.
- La pantalla no se ejecutó (sin capturas ni recorrido real).
- Cambiar el teléfono sigue sin pedir el PIN.

## Desvíos del plan
- Era «contraseña» y es PIN: el cliente no tiene otra credencial.
- El endpoint va en un controlador propio porque `auth.controller.ts` está en la deuda de tamaño congelada.

## Riesgos residuales
- Cada PIN errado en la hoja cuenta en el bloqueo del ingreso. Con una sesión abierta se puede bloquear el ingreso unos minutos, algo que también permite el login público. Es la misma decisión que ya tomó el comercio.
- No se avisa al correo anterior cuando se cambia.

## Decisiones y ambigüedades
- «Contraseña» se interpretó como el PIN de 4 dígitos (es la credencial del cliente). Confirmar con Pablo.
- La prueba se gasta al declarar el correo y no al confirmar el código, porque confirmar puede tardar más que los 300 s que vive la prueba.
