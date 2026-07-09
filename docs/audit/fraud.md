# Auditoría — Módulo `fraud`

**Alcance revisado:** `fraud.service.ts`, `.repository.ts`, `.schemas.ts`, `.module.ts`.
No expone su propio controller (la ruta HTTP `/operations/fraud-cases/:caseId/decision`
vive en `operations.controller.ts`, que delega en `FraudService` — se revisará el guard de
roles real como parte de la auditoría del módulo `operations`). Tests:
`test/unit/fraud/fraud.service.spec.ts`.

**Resultado:** 1 hallazgo crítico, corregido. Se agregaron 2 tests de regresión nuevos
(antes 6 tests, ahora 8). Suite verde. `tsc --noEmit` limpio. Verificado que
`operations` (el único consumidor de `FraudModule`) sigue funcionando sin cambios
(20/20 tests de `operations` en verde).

---

## Hallazgo 1 — CRÍTICO: el watchlist antifraude era funcionalmente inerte por diseño

**Dónde:** `FraudService.decideFraudCase()`, rama `applyWatchlist`.

**Qué pasaba:** cuando un analista de fraude marca `applyWatchlist: true` al decidir un
caso, el sistema creaba una fila en `watchlist_entries` con:
```ts
entityType: 'customer',
entityHash: fraudCase.customerId ? hashSensitiveText(String(fraudCase.customerId)) : null,
```
Es decir, hasheaba el **id interno autoincremental** del cliente (`customerId`), no un
dato de identidad real (teléfono, email). El propio schema del modelo
(`WatchlistEntryModel`: `entityType` + `entityHash` + `entityLast4`) replica
exactamente el mismo patrón que usa el resto del sistema para teléfono/email
(`primaryPhoneHash`/`primaryPhoneLast4`, `primaryEmailHash` en `CustomerModel`) — la
intención de diseño es clara: el watchlist debe reconocer a la misma persona real si
vuelve a registrarse.

Un watchlist basado en el `customerId` **no puede funcionar nunca**: si el mismo actor
fraudulento crea un nuevo registro (nuevo `customerId`, por diseño del sistema, siempre
distinto), el hash del `customerId` viejo jamás va a coincidir con nada del registro
nuevo. El control quedaba silenciosamente inerte — la API seguía devolviendo
`watchlistApplied: true` al analista, dándole una falsa sensación de que el actor
quedó marcado para detección futura, cuando en realidad la fila creada era inservible.
Además, `entityLast4` se hardcodeaba en `null` en el repositorio, perdiendo el patrón de
recuperación rápida usado en el resto del sistema.

**Impacto:** este es el mecanismo central de prevención de fraude recurrente del
sistema (un cliente confirmado como fraudulento debía quedar "marcado" para que, si
la misma persona vuelve a intentar registrarse, el sistema lo detecte). Con este bug,
esa protección nunca se activaba — cualquier actor confirmado como fraudulento podía
simplemente volver a registrarse con los mismos datos de contacto sin ningún tipo de
alerta, pese a que el equipo de fraude creía haberlo "watchlisteado".

**Corrección aplicada:**
1. `FraudService` ahora inyecta `CustomersRepository` (se agregó `CustomersModule` a los
   imports de `FraudModule` — sin dependencia circular, `CustomersModule` no importa
   `FraudModule`).
2. Al aplicar el watchlist, se busca al cliente (`customersRepository.findById`) y se
   crea una entrada por cada identificador de contacto real disponible:
   `entityType: 'phone'` con `primaryPhoneHash`/`primaryPhoneLast4`, y/o
   `entityType: 'email'` con `primaryEmailHash` (sin last4 equivalente disponible).
3. `FraudRepository.createWatchlistEntry` ahora acepta y persiste `entityLast4` en vez
   de hardcodearlo a `null`.
4. `watchlistApplied` en la respuesta ahora refleja la realidad: `true` solo si se creó
   al menos una entrada real (antes era `true` incondicionalmente con
   `applyWatchlist: true`, incluso si `fraudCase.customerId` era `null`).

**Archivos:** `src/modules/fraud/fraud.service.ts`, `src/modules/fraud/fraud.repository.ts`,
`src/modules/fraud/fraud.module.ts`.

**Tests de regresión (nuevos):** `fraud.service.spec.ts` →
- `watchlists by the customer's real phone/email hash, never by the internal customerId
  (regression)` — verifica que se creen 2 entradas (teléfono + email) con los hashes
  reales del cliente, y explícitamente que ningún `entityHash` generado sea el hash del
  `customerId`.
- `does not apply a watchlist entry when the customer has no phone/email hash on record`
  — cubre el caso borde donde el cliente no tiene ningún contacto hasheado disponible;
  `watchlistApplied` debe ser `false`, no `true`.

**Nota de alcance:** este fix no crea el lado de "consulta" del watchlist (verificar
contra `watchlist_entries` durante `RiskService.createRiskAssessment` u onboarding) —
ese matching activo no existía antes de este patch y sigue sin existir; los modelos
`WatchlistMatchModel`/`WatchlistMatchModel` están definidos y catalogados en
`systems-business-metadata.fixtures.ts` pero ningún servicio los escribe todavía. Cerrar
ese circuito completo (detectar un match real contra el watchlist en un nuevo
registro) es una funcionalidad nueva, no un bug — queda fuera del alcance de esta
auditoría, pero vale la pena señalarlo como el siguiente paso lógico: hoy, incluso con
el fix de este hallazgo, un actor marcado en el watchlist NO es bloqueado
automáticamente si vuelve a registrarse — solo queda el registro correcto disponible
para que, en el futuro, algo lo consulte.

---

## Addendum (durante la auditoría #12, `operations`) — `createStatusEvent` sin actor interno

Al auditar `operations` (que comparte deliberadamente `createStatusEvent`/
`createCustomerObservation` con este módulo, ver `ATLAS-AUDIT-014`) se encontró que la copia de
`createStatusEvent` en `fraud.repository.ts` tenía el mismo defecto que su gemela en
`operations.repository.ts`: no aceptaba ni escribía `actorInternalUserId` en
`changed_by_internal_user_id`, a diferencia de `createWatchlistEntry` (línea 88, ya corregido en
el hallazgo crítico de arriba) y del resto de la cadena de auditoría de `decideFraudCase`. Se
corrigió aquí también, junto con `operations`, para mantener ambas copias idénticas. Ver detalle
completo en [operations.md](./operations.md).

---

## Qué quedó verificado como correcto (sin cambios)

- `decideFraudCase` exige `X-Idempotency-Key` y `reasonCode` cuando la decisión es
  `confirmed_fraud`/`blocked`.
- Un caso ya cerrado (`closedAt` o `caseStatus: 'closed'`) rechaza cualquier nueva
  decisión con `ConflictException('CASE_ALREADY_CLOSED')` — no se puede re-decidir un
  caso resuelto.
- Toda la escritura (cierre de caso, evento, watchlist, cambio de estado del cliente,
  observación, auditoría operacional, log de cambio de datos) ocurre en una única
  transacción Sequelize.
- El cambio de estado del cliente (`createStatusEvent`) y su observación asociada solo
  se crean cuando el caso tiene `customerId` **y** se especificó `nextCustomerStatus` —
  no se escribe un estado a medias.
