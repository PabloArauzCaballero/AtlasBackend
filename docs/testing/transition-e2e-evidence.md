# Evidencia E2E de la transición (AT-052)

| Capa | Prueba | Qué demuestra |
|---|---|---|
| HTTP (guards reales, dueño doble) | `test/e2e/microservices-transition/critical-journeys.spec.ts` | 201 con el cuerpo público exacto (decimales como texto, fechas ISO, sin `eligibilityEvaluationId`); 400 sin clave; 422 `CUSTOMER_NOT_ELIGIBLE` con bloqueadores; dos tenants (token≠cabecera → 403 sin llamar al dueño; actor y `customerId` llegan intactos para la propiedad); revocación a mitad (401, dueño no llamado); replay: la clave llega igual dos veces |
| Base (dueños reales) | `test/integration/journeys/credit-journey.spec.ts` | evidencia en cada dueño (1 evaluación, 1 solicitud, 1 evento `credit.application.submitted` con `producer='credit'`), relay v2 → 1 recibo de inbox; replay de la solicitud → `CREDIT_APPLICATION_ALREADY_OPEN`, sigue 1 solicitud y 1 evento; relay otra vez → 0 reclamados; cliente bloqueado → 422 con evidencia y 0 solicitudes |
| Registro → verificación → elegibilidad | `test/integration/onboarding/atomic-registration.spec.ts` (AT-016), `test/integration/notifications/*` (F6), `test/integration/credit/*` (AT-006/007/008) | los pasos previos del recorrido ya tienen su evidencia por dueño |

Lo que NO se hace: capturas de frontend con mocks, y no se versionan secretos ni PII (los cuerpos son de prueba).
Los smokes de contrato (`yarn smoke:*`) exigen API levantada y credenciales inyectadas: no corren en esta batería.
