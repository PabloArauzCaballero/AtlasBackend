# Propiedad de casos y fraude y su efecto sobre otras decisiones (AT-029)

Contrato: `src/modules/fraud/public/fraud-status.contracts.ts` (`FraudStatus`, `checkResolution`,
`FRAUD_RESOLVE_PERMISSION`). Prueba: `test/contracts/fraud/case-decision-boundary.spec.ts`.

## Dueño

`fraud` escribe `case_management.fraud_cases`, `fraud_case_events`, `watchlist_entries`; `operations` escribe
`manual_review_cases`. Hoy `fraud_cases` la registran **5** módulos y `manual_review_cases` **4**: son lectores que
deben pasar a `FraudStatusPort` (línea base de fronteras).

## Lectura: `FraudStatus`

`{ openCases, highestSeverity, revision, readAt }`. Sin identificadores de dispositivos ni vínculos: quien necesite el
caso entero es un operador con permiso en el módulo dueño, no otro contexto.

## Comando: resolución con permiso, motivo y revisión

`checkResolution` es la regla pura que `FraudService.decideFraudCase` aplica (y que hoy aplica en parte: motivo
obligatorio para `confirmed_fraud`/`blocked`, caso cerrado → `CASE_ALREADY_CLOSED`). Lo que el contrato añade:

- **permiso explícito** (`fraud.cases.resolve`) en el comando; el guard HTTP lo comprueba, el caso de uso lo vuelve a
  comprobar;
- **revisión esperada**: dos operadores que deciden sobre la misma revisión → el primero gana, el segundo recibe
  `FRAUD_CASE_REVISION_CONFLICT`. La revisión se implementa con el bloqueo de fila del caso dentro de la transacción de
  `decideFraudCase` (misma técnica que AT-007) — pendiente de cablear en el servicio (F5 con eventos).

## Efecto sobre la admisión de crédito (garantía de AT-007)

La admisión lee `openFraudCaseCount` en `loadFacts` **dentro de su transacción** con la fila del cliente bloqueada.
Un caso que se abre mientras la admisión corre:

- si el cierre/apertura toma el bloqueo del cliente (hoy `createStatusEvent` en `decideFraudCase` sí lo toma cuando
  cambia el estado): se ordena antes o después;
- si sólo escribe `fraud_cases` sin tocar al cliente: **no se ordena** (residual declarado en
  `admission-consistency.md`). Decisión: `decideFraudCase` con `applyWatchlist` o cambio de estado ya bloquea al cliente;
  la apertura automática de casos (motor de riesgo) pasará por el mismo bloqueo en AT-036.

## Historial inmutable

`fraud_case_events` sólo se inserta; una resolución nueva no reescribe la anterior. El contrato lo conserva: el
comando produce un evento, nunca un `UPDATE` sobre el historial.
