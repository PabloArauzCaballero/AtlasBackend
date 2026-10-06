# Reporte — Cambiar el correo aunque ya se haya verificado un contacto

> **AVANCE: 5 / 9 — 55,6 %.**

- Fecha: 2026-10-06 · Plan: [PLAN.md](./PLAN.md) · Rama(s): `claude/great-gauss-f81hpg` en AtlasBackend y AtlasFrontend
- Peldaño de evidencia alcanzado: backend `TESTED` (unitarios dirigidos); frontend `TESTED` en la lógica pura y `RUNS` (typecheck) en las pantallas. Sin `VERIFIED`: no se ejercitó el flujo contra una base real ni se capturó la pantalla.

## Completado
| ID | Qué se logró | Comando | Resultado |
|---|---|---|---|
| H1.S1.M1 | Re-declarar el mismo correo sin verificar devuelve el mismo `contactMethodId` (retomar un cambio a medias) | `npx jest test/unit/customer-onboarding/customer-contact-methods.service.spec.ts` | PASS 5/5 con el cambio; 3/5 FALLAN sin él · `evidencia/backend-contact-methods-spec.txt` |
| H1.S1.M2 | Correo ya verificado del propio cliente → 409 `CONTACT_ALREADY_VERIFIED` (antes «está en otra cuenta») | mismo | PASS |
| H1.S1.M3 | Gates backend del área | `yarn type-check`, `yarn type-check:tests`, eslint y prettier de los archivos tocados | todos exit 0 · `evidencia/backend-gates.txt`; suite `test/unit/customer-onboarding` 312/312 · `evidencia/backend-unit-customer-onboarding.txt` |
| H1.S2.M1 | API de la app: `addContactMethod` y `contactMethodId` al pedir/confirmar | `npx tsc --noEmit` | exit 0 · `evidencia/frontend-gates.txt` |
| H1.S2.M4 | Un 401 de código incorrecto/vencido ya no refresca y reenvía (gastaba dos intentos por error) | `npx jest` (`__tests__/change-email.test.ts`, `shouldRefreshOn`) | PASS; suite completa 61/61 |

## A medias
### H1.S2.M2 — Pantalla `/(onboarding)/cambiar-correo`
- Qué anda: compila; la lógica de validación y de a qué campo va cada error del servidor tiene 14 tests en verde.
- Qué no anda / no se sabe: no se ejecutó la pantalla. Sin capturas en móvil/tablet/escritorio ni en tema oscuro.
- Qué falta exactamente: levantar backend + app web, recorrer correo → código → confirmado, comprobar que `customers.primary_email_hash` cambió y que el login con el correo nuevo funciona y con el viejo no; capturas en tres viewports y dos temas.
- Dónde quedó: `apps/consumer-app/app/(onboarding)/cambiar-correo.tsx`, rama `claude/great-gauss-f81hpg`, compila.

### H1.S2.M3 — Accesos desde Perfil y Verificar contacto
- Qué anda: compila; la fila «Correo» del Perfil y un botón en «Verifica tu contacto» (canal correo) navegan a la pantalla.
- Qué no anda / no se sabe: navegación no observada en ejecución; lint no se pudo correr (ver Evidencia).
- Qué falta exactamente: lo mismo que H1.S2.M2 y configurar ESLint en el repo.
- Dónde quedó: `app/(app)/(tabs)/perfil.tsx`, `app/(onboarding)/verificar-contacto.tsx`, compila.

## Pendiente
| ID | Estado | Qué lo destraba |
|---|---|---|
| H1.S3.M1 | TODO al escribir este reporte | PR a `main` con CI verde |
| H1.S3.M2 | TODO al escribir este reporte | PR a `main` (el repo no tiene CI) |

## Evidencia
```text
backend-contact-methods-spec.txt   Tests: 5 passed, 5 total   (sin el fix: 3 failed, 2 passed)
backend-unit-customer-onboarding   Test Suites: 32 passed · Tests: 312 passed
backend-gates.txt                  type-check exit=0 · type-check:tests exit=0 · eslint exit=0 · prettier exit=0
frontend-gates.txt                 typecheck exit=0 · lint exit=2 (sin eslint.config en el repo) · jest 61 passed
```

## No cubierto
- Persistencia real: ningún test contra Postgres; los unitarios mockean repositorios.
- La pantalla y la navegación no se ejecutaron (ver A medias).
- Volver a un correo ANTIGUO ya verificado que no es el principal: sigue respondiendo `CONTACT_ALREADY_VERIFIED` y no hay forma de promoverlo.
- Cambio de teléfono desde la app (mismo mecanismo, no pedido).

## Desvíos del plan
- Se añadió H1.S2.M4: defecto del cliente HTTP descubierto al diseñar el paso del código.
- ESLint/Prettier del front: no existen en el repo; se reemplazó por typecheck + tests.

## Riesgos residuales
- **Toma de cuenta con sesión robada**: quien tenga una sesión abierta puede cambiar el correo de ingreso (prueba controlar el correo NUEVO, no el viejo) y luego recuperar la contraseña. Falta reautenticación con contraseña antes del cambio y un aviso al correo anterior. Era ya posible por API antes de este trabajo; la pantalla lo hace accesible.
- El 409 `CONTACT_ALREADY_REGISTERED` llega al CONFIRMAR (el correo era de otra cuenta), después de gastar el código. Deliberado: avisarlo antes permitiría enumerar correos registrados.

## Decisiones y ambigüedades
- «Elevado a test» = integrar en `main` vía PR (Coolify despliega TEST desde `main`). No hay documentación que lo confirme en los repos. Confirmar con Pablo.
- La pantalla vive en `(onboarding)` porque ese grupo solo exige sesión y sirve en alta y con cuenta activa.
