# Expediente de preparación y decisión de salida (AT-062)

- **SHA integrado evaluado:** `37316f5` (rama `dev`, no empujada). Toda la evidencia de este expediente se reejecutó contra ese
  SHA en el árbol integrado, no contra ramas aisladas. Máquina: `batería local (regresion8 + reejecución de integración): 19 pasos en verde`.
- **Fecha:** 2026-09-12. **Revisiones independientes:** ninguna — todo el trabajo F0–F9 se hizo en una sola sesión; el gate de
  AT-062 exige dos revisiones independientes, así que **este expediente NO está aprobado**: está listo para revisión.
- **Datos:** `readiness.json` (por contexto), `pilot-readiness.json` (piloto).

## 1. Decisión

| Pregunta                                                          | Respuesta                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ¿Está preparado el piloto de Mensajería para el corte en staging? | **NO (NOT_READY)**: cuatro bloqueos abiertos (directorio de destinatarios por HTTP, configuración por capacidad, difusión interna sobre `iam`, autorización de despliegue no acordada). El mecanismo de corte y de reversión está ensayado contra PostgreSQL. |
| ¿Autoriza este expediente producción?                             | **No.** Ni lo pretende: la autorización productiva es un acto separado y registrado.                                                                                                                                                                          |
| ¿Algún otro contexto queda «extraído» por arrastre?               | **No.** Cada contexto tiene su estado propio en `readiness.json`; ninguno está `extractable` ni `extracted`.                                                                                                                                                  |

## 2. Estado por contexto (resumen de `readiness.json`)

| Contexto                                                                                                     | Estado                     | Lo que lo sostiene                                                                                                                | Lo que lo bloquea                                                              |
| ------------------------------------------------------------------------------------------------------------ | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Mensajería                                                                                                   | modular · piloto NOT_READY | entrada pública, puertos de directorio/OTP, rol propio, worker aislado que arranca solo y cercado, corte/rollback/copia ensayados | directorio HTTP, config por capacidad, difusión interna, autorización          |
| Crédito y admisión                                                                                           | modular                    | caso de uso por puertos, UoW con outbox transaccional, tres bugs de admisión corregidos, rol propio                               | AT-025 parcial (tipos derivados del repositorio), `credit_applications` sin FK |
| Clientes                                                                                                     | modular                    | contratos públicos, puerto de estado, directorio de destinatarios                                                                 | sin contrato remoto de escritura del ciclo de vida                             |
| Onboarding                                                                                                   | **no extraíble**           | puente atómico declarado y probado                                                                                                | alta atómica con auth/consents/sessions                                        |
| Riesgo, Consentimiento, Casos/Fraude, Proveedores externos, Plataforma                                       | modular                    | puertos y contratos públicos con pruebas                                                                                          | ver `readiness.json`                                                           |
| Identidad y acceso, Cartera, Comercios, Soporte, Expedientes, Telemetría, Motor, Gobierno de datos, Lectores | no iniciado                | inventarios y documentos de frontera                                                                                              | —                                                                              |

## 3. Matriz de evidencia (todas ejecutadas contra el SHA integrado)

| Dimensión     | Evidencia                                                                                             | Resultado                                         |
| ------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Contratos     | `test/contracts/**` (puertos con doble y adaptador real, seguridad entre límites)                     | 43 verdes                                         |
| Arquitectura  | `check:architecture` (línea base 111, cero nuevas) + `test/architecture/**` (fugas, mapa, extracción) | 125 verdes; línea base 111, 0 nuevas              |
| Datos         | roles por contexto probados desde la conexión; down×2→up; grants reaplicados; `context_ownership`     | integración                                       |
| Transacciones | UoW local, outbox transaccional, puente atómico                                                       | integración                                       |
| Eventos       | relay v2 (lease/fencing/inbox/DLQ), propagación de correlación, matriz de fallos                      | integración                                       |
| Seguridad     | tenant del token, audiencia, cookies/CSRF, plano de control, logs con rol                             | contratos                                         |
| Operación     | runbooks: events-recovery-v2, transition-migration-recovery, cutover, shadow-read, rollback           | documentados; ensayados en pruebas, no en staging |
| Pruebas       | unit 4.987 aleatorizado · e2e 373 · integración 104 · OpenAPI regenerado sin cambios                  | verde                                             |
| Cutover       | `single-writer-cutover.spec.ts`                                                                       | verde                                             |
| Rollback      | `rollback-after-writes.spec.ts`                                                                       | verde                                             |

## 4. Cambios de comportamiento declarados en F0–F9 (no regresiones)

Evidencia de denegación conservada; `FOR UPDATE` del cliente en la admisión; huella HMAC de idempotencia; replay por actor;
credenciales sin replay; evento `credit.application.submitted` en el outbox; eventos técnicos marcados; hechos de riesgo por
puerto; OTP y directorio por puertos; `GET /systems/logs/mongo` con rol interno; reaper anula `owner_token`; migración
`20260911190000` reaplica grants; relay v2 consulta `context_ownership` (sólo con `EVENTS_RELAY_V2_ENABLED=true`).

## 5. Bloqueos y pendientes que impiden el «apto»

1. Pruebas requeridas NOT_RUN: protocolo de carga (AT-054), golden tests HTTP completos (AT-005), pipeline en PR y branch
   protection (AT-055), ensayo en staging del corte.
2. Excepciones críticas abiertas del piloto: `remaining-exceptions.md`.
3. Revisiones independientes: 0 de 2.

Si cambia cualquiera de estas precondiciones, este expediente se reemite; no se edita el histórico.
