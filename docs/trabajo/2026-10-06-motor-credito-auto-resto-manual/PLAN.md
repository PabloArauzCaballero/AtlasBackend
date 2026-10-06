# Plan — Todo llega al Motor; sólo el crédito se aplica solo; nada se pierde

- Fecha: 2026-10-06 · Repos afectados: AtlasBackend · Predecesor: `2026-10-06-credito-puntaje-calificacion-app`
- Resultado observable: toda solicitud (crédito, riesgo, identidad, comercio) se ejecuta en el Motor; sólo la
  decisión crediticia y el monto de la línea se aplican solos; el resto —y toda solicitud de crédito que no se
  pudo decidir— queda en la bandeja de operaciones con su caso.
- Kill-test: una solicitud de crédito diferida (base habilitante no replicada) sin fila en `manual_review_cases`.

## Alcance
- IN: retención de veredictos por tipo (`DECISION_ENGINE_AUTO_APPLY`), crédito de producto manual que ahora
  consulta al Motor, caso en bandeja para la solicitud diferida, configuración y pruebas.
- OUT: diagnóstico en el servidor (sin acceso de red desde la sesión), cambios en el Motor y en los frontales.
- Ambigüedades registradas:
  - «Todo debería caer manual a excepción de la decisión crediticia y la cantidad de crédito aprobado»: se
    interpretó como *todas las solicitudes llegan al Motor, pero sólo crédito se aplica solo*. Confirmar con Pablo.
  - El producto con `requires_manual_review = true` sigue siendo manual (decisión de negocio); ahora consulta al
    Motor y deja su propuesta. Si el producto del front tiene esa marca, la decisión no será automática.

## H1 — Ninguna solicitud se pierde y sólo crédito se aplica solo
**CA:** Dado el despliegue por omisión, cuando el Motor aprueba un alta de riesgo, una identidad o un comercio,
entonces el caso queda en revisión humana con la propuesta del Motor; y cuando una solicitud de crédito se
difiere o es de un producto manual, entonces tiene caso abierto en la bandeja.
**DoD:** type-check, lint, formato, tamaño, arquitectura, unitarios, integración de crédito contra Postgres real,
arranque real de la API.
**Estado:** HECHO

| ID | Microtarea | CA (binario) | DoD | Estado |
|---|---|---|---|---|
| H1.S1.M1 | `DECISION_ENGINE_AUTO_APPLY` (config compartida, compose, ejemplos) | Por omisión sólo `credit` | `yarn type-check` + `yarn check:env-example` | HECHO |
| H1.S1.M2 | Riesgo retenido | Aprobación/bloqueo del Motor → `manual_review_required` con propuesta | `jest test/unit/risk/risk-policy-decision.service.spec.ts` | HECHO |
| H1.S1.M3 | Comercio retenido | APROBADO/RECHAZADO → `REVISION_MANUAL` con propuesta | `jest test/unit/partner-onboarding/partner-kyb-decision.service.spec.ts` | HECHO |
| H1.S1.M4 | Identidad retenida también por `DECISION_ENGINE_AUTO_APPLY` | VERIFICADO → `IN_REVIEW` aunque `IDENTITY_REQUIRE_HUMAN_REVIEW=false` | `jest test/unit/mobile-identity test/unit/customers` | HECHO |
| H1.S2.M1 | Producto manual consulta al Motor y abre caso | Ejecución atada, `under_review`, `manual`, caso Atlas | `jest test/unit/decision-engine/credit-underwriting.service.spec.ts` | HECHO |
| H1.S2.M2 | Diferida con caso en bandeja; se cierra al resolverse | Caso `open` al diferir, `closed` al aprobar | `yarn test:integration test/integration/credit` (Postgres real) | HECHO |
| H1.S3.M1 | Gates y arranque | Todos en verde salvo fallo preexistente documentado | gates + `node dist/src/main.js` → `/health` 200 | HECHO |
