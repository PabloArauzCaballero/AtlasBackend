# Reporte — Auditoría DDD: Registro y reversión de cobros de préstamo

- Fecha: 2026-09-22 · Plan: [PLAN.md](./PLAN.md) · Rama: dev
- Estado H2: **HECHO** · Avance: 3/3 microtareas HECHO.

## Completado en H1

| ID | Qué se logró | Comando | Resultado |
|---|---|---|---|
| H1.S1.M1 | Entrada `src/modules/loans/loan-payments.controller.ts` y propietario `src/modules/loans/application/loan-payment.service.ts` localizados | inspección de rutas y símbolos | rutas presentes |
| H1.S1.M2 | Referencia del flujo | `yarn test --runInBand test/unit/loans/loan-allocation.spec.ts` | 1 suite; 8/8 pruebas pasan |

## Ejecución H2

La misma clave con importe o préstamo distinto ahora produce 409 antes de bloquear cuotas o escribir el pago.

**Evidencia:** `yarn test --runInBand test/unit/loans/loan-payment.service.spec.ts`: 10/10; `yarn test:unit --runInBand --silent` fuera del sandbox: 539/539 suites y 5518/5518 pruebas; `yarn type-check`: 0; `yarn lint`: 0 con 109 advertencias existentes; Prettier dirigido: 0. Dentro del sandbox 2 suites fallaron por restricciones de entorno; la repetición autorizada pasó completa.

## Límites y resultado del gate

No se ejecutó una prueba de concurrencia con PostgreSQL. Para filas históricas, `receivedAt` ausente se compara con los campos persistidos disponibles; una huella exacta del payload requeriría migración.

## Decisión

Se conserva el contrato observado y se evita introducir reglas de negocio sin respaldo. Los cambios de producto y las pruebas de esta pasada se describen arriba; las limitaciones pendientes permanecen explícitas.
