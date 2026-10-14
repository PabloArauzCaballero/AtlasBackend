# Plan — DDD y código expresivo: Registro y reversión de cobros de préstamo

- Fecha: 2026-09-22 · Repo: AtlasBackend (backend) · Predecesor: ninguno en esta pasada
- Resultado observable de esta pasada: flujo, regla, evidencia y próxima comprobación definidos sin modificar producto.
- Kill-test: si no se puede seguir `src/modules/loans/loan-payments.controller.ts` → `src/modules/loans/application/loan-payment.service.ts`, el diagnóstico no está completo.

## Alcance

- IN: `src/modules/loans/loan-payments.controller.ts`, `src/modules/loans/application/loan-payment.service.ts`, contrato y prueba de referencia del flujo.
- OUT: migraciones, cambios de API, UX o reglas no confirmadas; resto del repo.
- Ambigüedad registrada: Dinero e idempotencia: no decidir el conflicto de claves por conveniencia.

## H1 — Diagnóstico y referencia

**CA:** Dado el flujo existente, cuando se inspeccionan entrada, decisión y resultado, entonces la regla tiene un propietario y una prueba de referencia identificables.
**DoD:** inspección de los archivos citados y `yarn test --runInBand test/unit/loans/loan-allocation.spec.ts` con el resultado literal del reporte.
**Estado:** HECHO

### H1.S1 — Rastrear y probar

**CA:** Dado el checkout actual, cuando se sigue el flujo, entonces se distingue regla de coordinación. **DoD:** rutas y símbolos reales registrados abajo. **Estado:** HECHO

| ID | Microtarea | CA (binario) | DoD (comando de verificación) | Estado |
|---|---|---|---|---|
| H1.S1.M1 | Localizar entrada y propietario | Ambas rutas existen y se identificó la regla | `test -f 'src/modules/loans/loan-payments.controller.ts' && test -f 'src/modules/loans/application/loan-payment.service.ts'` → salida 0 | HECHO |
| H1.S1.M2 | Fijar referencia | El chequeo dirigido termina con salida 0 | `yarn test --runInBand test/unit/loans/loan-allocation.spec.ts` → 1 suite; 8/8 pruebas pasan | HECHO |

**Regla observada:** Un cobro repetido con la misma clave no debe aplicarse dos veces.

## H2 — Próxima capacidad acotada

**CA:** Dado el contrato confirmado, cuando se ejerce la condición límite del flujo, entonces el resultado visible o persistido coincide con la regla y un rechazo no produce efecto parcial.
**DoD:** prueba de comportamiento dirigida, verificación de contrato y recorrido real si se modifica código; reporte con salida literal.
**Estado:** HECHO

### H2.S1 — Confirmar semántica antes de refactorizar

**CA:** La condición límite tiene resultado esperado documentado. **DoD:** prueba dirigida y revisión del contrato vigente. **Estado:** HECHO

| ID | Microtarea | CA (binario) | DoD (comando de verificación) | Estado |
|---|---|---|---|---|
| H2.S1.M1 | Aclarar y probar qué ocurre si la misma clave de idempotencia llega con importe o préstamo distinto; luego, solo si el contrato exige rechazo, protegerlo en la transacción sin alterar el reparto. | Hay un caso verificable y no cambia reglas hipotéticas | `yarn test --runInBand test/unit/loans/loan-payment.service.spec.ts` → resultado y límites registrados | HECHO |

## Riesgos y bloqueos previstos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Dinero e idempotencia: no decidir el conflicto de claves por conveniencia. | Resultado o contrato falso | Confirmar con código, contrato y prueba antes de editar producto |

## Decisión de diseño

El propietario observado es `src/modules/loans/application/loan-payment.service.ts`. No se introduce una capa DDD nueva por nombre. Una refactorización futura necesitará mostrar una llamada más clara y la misma semántica en la entrada real, con prueba roja antes de cambiar implementación. Si la comprobación H2 demuestra que el diseño actual ya protege la regla, se registra como DESCARTADO el cambio de código.
