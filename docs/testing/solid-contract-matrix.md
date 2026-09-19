# Matriz de contratos por puerto (AT-051)

Un puerto «cumple SOLID» cuando **dos** implementaciones pasan la **misma** suite, no cuando alguien lo dice.
Pruebas: `test/contracts/architecture/port-substitution.spec.ts` (doble) y
`test/integration/architecture/port-substitution-sequelize.spec.ts` (Sequelize, transacción revertida), ambas sobre
`test/contracts/architecture/transactional-outbox.contract.ts`. Fugas: `test/architecture/public-api-leaks.spec.ts`.

| Puerto | Implementaciones que pasan la suite | Precondiciones | Resultados | Errores | Idempotencia | Concurrencia | Aislamiento | Capability |
|---|---|---|---|---|---|---|---|---|
| `TransactionalOutbox` | `InMemoryOutbox` (test/support/fakes), `SequelizeOutboxWriter` | sobre válido (tipo, ámbito, sin claves prohibidas) | `{eventId uuid, outboxRowId}` | `EVENT_FORBIDDEN_PAYLOAD_KEY`, `EVENT_INVALID_SCOPE`; dedup repetido → rechazo (índice único parcial / `OUTBOX_DEDUP_KEY_TAKEN`) | por `dedupKey` dentro de (tenant, tipo) | la decide la transacción del dueño | ligado a UNA transacción | ninguna |
| `CreditUnitOfWork` | Sequelize (AT-015, integración) | — | sesión `{applications, eligibility, outbox}` | `UnitOfWorkClosedError` tras cerrar | — | `lockCustomer` (FOR UPDATE) | no expone `transaction` | — |
| `RecipientDirectoryPort` | local (Clientes), doble (contratos F6) | propósito permitido | direcciones descifradas sólo para `transactional/otp/security` | `RECIPIENT_PURPOSE_NOT_ALLOWED` | — | — | sin PII en payloads | — |
| `OtpDeliveryPort` | local (F6) | canal disponible, código vigente | `delivered`/clasificación | `OTP_*` | — | — | — | capacidades por canal |
| `ExternalEvidencePort` | 9 adaptadores por alias (F6) | alias canónico | evidencia tipada | por proveedor | — | — | — | — |
| `JobHandlerPort` + lease | `pg_try_advisory_xact_lock` (AT-038) | lease libre | `{jobCode, sessionPid, release}` | — | reintento tras release | dos procesos: uno ejecuta | — | — |

## Fugas congeladas (sólo pueden encoger)

`public-api-leaks.spec.ts` rechaza en `public/`, `application/ports/`, `src/platform/contracts` y `*.port.ts` toda
importación de `sequelize`, modelos, repositorios e infraestructura, y `@nestjs/*` salvo `application-error.ts` (que ES la
traducción HTTP). Tres fugas existen hoy y están en `LEAK_BASELINE` con la tarea que las retira:

| Fuga | Retira |
|---|---|
| `credit-unit-of-work.port.ts` deriva tipos de `CreditRepository` (modelos) | AT-025 |
| `risk-assessment-store.port.ts` deriva tipos de `RiskRepository` | AT-025 |
| `event-consumer.port.ts` recibe `Transaction` (despacho local) | AT-056 (transporte del piloto) |

## Cobertura

Los umbrales por directorio de `jest.config.cjs` (auth, risk, fraud, crypto) se comprueban contra directorios que
existen y tienen fuentes: mover un módulo sin remapear el umbral rompe la prueba, no apaga la cobertura en silencio.
`type-check:tests` sigue en CI (`ts-jest` ya no es `warnOnly`).
