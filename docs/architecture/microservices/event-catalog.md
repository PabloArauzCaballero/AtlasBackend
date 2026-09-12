# Catálogo y sobre de eventos (AT-032)

Contrato: `src/platform/events/integration-event.ts`. Prueba: `test/contracts/events/event-envelope.spec.ts`.

## Dos categorías, un solo outbox (mientras se comparte base)

| Categoría | Quién lo escribe | `aggregate_type` | Quién lo consume | Es contrato estable |
|---|---|---|---|---|
| **domain** | el caso de uso, en la transacción del agregado (AT-033) | el agregado (`credit_application`, `customer`…) | consumidores registrados por tipo/versión (AT-035) | sí, versionado |
| **technical** | `ApiCommandOutboxInterceptor` tras el handler | `api_command` | auditoría HTTP / `process_outbox` (marca procesado) | no; telemetría (AT-037) |

El relay de dominio (`OutboxRelayService`) excluye `api_command` en el reclamo; el job `process_outbox` sigue cerrando
los técnicos como hasta ahora. Ninguna ruta cambia.

## El sobre

`eventId` (UUID global, único), `type` (= `event_code`), `category`, `schemaVersion`, `producer`, `scope`
(`tenant`/`platform`: un evento de plataforma lleva ámbito explícito, no un tenant vacío), `aggregate {type, id,
version}`, `occurredAt` (ISO), `correlationId`, `causationId`, `payload` (valores planos).

**Filas heredadas** (escritas antes de la migración `20260911190000`): `fromOutboxRow` las traduce con
`producer='legacy'`, `schemaVersion=1`, `aggregate.version=null`; la identidad de deduplicación es el `event_id` que la
migración les asignó, así que un consumidor que ya las procesó por el camino viejo… no las ve dos veces: el relay v2 sólo
reclama `pending`.

## Validación antes de publicar

`validateEnvelope` rechaza: versión de esquema desconocida para el tipo (`UNKNOWN_SCHEMA_VERSION` → cuarentena,
`status='failed'`, `error_code='EVENT_QUARANTINED'`), ámbito de tenant no numérico (`INVALID_SCOPE`), y claves prohibidas
en el payload (`password|secret|token|otp|verificationCode|documentNumber|rawPayload|stack|primaryPhone|primaryEmail` →
`FORBIDDEN_PAYLOAD_KEY`). El escritor de outbox lo aplica al **insertar**: un caso de uso no puede dejar en cola un
evento que no se podrá publicar.

## Evolución compatible

- Añadir un campo opcional al payload: misma `schemaVersion`; los consumidores toleran adiciones.
- Cambiar el significado de un campo o quitarlo: `schemaVersion + 1`; los consumidores declaran las versiones que
  entienden (`subscriptions`); un consumidor suscrito que no entiende la versión → el evento se cuarentena, no se
  consume a medias.
- Renombrar un tipo: nuevo tipo + periodo de doble emisión; nunca reescribir `event_code` de filas existentes.

## Tipos de dominio hoy

| Tipo | Productor | Agregado | v |
|---|---|---|---|
| `credit.application.submitted` | `credit` (caso de uso de solicitud, AT-033) | `credit_application` | 1 |
| `customer.lifecycle.<estado>` | `customers` (`createTransitionEvent`, en la transacción de la transición) | `customer` | 1 (legacy: sin sobre) |
| catálogo `event-registry.ts` (kyc, risk, credit_line, purchase, installments, payments, merchant, support, notifications) | vía `POST /events` o servicios | según familia | 1 |

Los `customer.lifecycle.*` no están en `event-registry.ts`: `claimPending` (relay v1) no los reclama y nunca lo hizo; el
relay v2 sí los reclama, pero sólo tiene efecto si hay un consumidor suscrito. Registrarlos es parte de AT-041.
