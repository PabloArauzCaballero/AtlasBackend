# atlas-integration-v1 — contratos entre Core, Motor y ERP (P-14)

Repositorio coordinador: **AtlasBackend (Core)**. Cada servicio conserva su adaptador y sus pruebas de
conformidad; este directorio es la fuente de los esquemas y fixtures. El ERP guarda una copia
versionada en `AtlasERPBackend/contracts/atlas-integration-v1/` con `ORIGIN.json` (commit de origen) y
la misma `CHECKSUMS.sha256`. `yarn contracts:check-sync <ruta-al-ERP>` (en Core) compara las dos copias.

Qué hay aquí:

| Ruta | Qué es |
| --- | --- |
| `schemas/*.schema.json` | JSON Schema 2020-12 (subconjunto: `type`, `enum`, `pattern`, `required`, `properties`, `additionalProperties`, `items`, `oneOf`, `$ref`…). |
| `topics.json` | Tópico → esquema, familia, productor, consumidor y efecto en el consumidor. |
| `fixtures/*.v1.json` | Casos **válidos**, de **frontera** e **inválidos** por tópico; `envelope.invalid.json` para el sobre. |
| `signature/vectors.json` | Vectores de la firma HMAC (el mismo esquema en los dos sentidos). |
| `build.mjs` | Genera fixtures, vectores y `CHECKSUMS.sha256` de forma determinista (`--check` para verificar). |

Reglas de los datos: importes como **texto decimal** (nunca número JSON; hasta 16 enteros y 2
decimales), relojes fijos (`2026-09-24T12:00:00.000Z`), UUID sintéticos (`00000000-0000-4000-8000-…`) e
identificadores de Core inventados (`9xxxxx`). Ningún fixture es una respuesta de un proveedor real.

## Transporte común (identidad y contexto técnico)

- `POST` HTTP con cuerpo JSON = **sobre** (`schemas/envelope.schema.json`): `spec`, `eventKey`, `topic`,
  `schemaVersion`, `aggregate {type,id,version}`, `occurredAt`, `producer`, `tenantId` (sólo Core) y
  `payload`. El sobre es estable entre reintentos.
- Cabeceras: `x-atlas-event-key`, `x-atlas-topic`, `x-atlas-delivery-attempt`, `traceparent`/`tracestate`
  (W3C, opcionales) y **`x-atlas-signature: t=<unix>,v1=<hex(HMAC-SHA256(secreto, "<t>.<cuerpo crudo>"))>`**.
  El receptor verifica sobre los bytes crudos, en tiempo constante, con ventana de 300 s.
- **Un secreto por sentido**: ERP→Core `OUTBOX_DELIVERY_SIGNING_SECRET` (ERP) = `ERP_EVENTS_SIGNING_SECRET`
  (Core); Core→ERP `ERP_EVENTS_DELIVERY_SECRET` (Core) = `CORE_EVENTS_SIGNING_SECRET` (ERP).
- **ACK** = 2xx que el receptor responde sólo después de confirmar su inbox. Un duplicado también es 2xx.
- Respuestas: 2xx ACK · 400/410/413/415/422 rechazo definitivo (el productor lo deja en DEAD/`dead`,
  visible, sin reenvío automático) · 401/403/404/408/409/429/5xx, red y timeout = transitorio (backoff
  exponencial con tope). 401/403/404 se tratan como configuración (secreto rotado, receptor sin desplegar).
- Entrega **al menos una vez**; efecto **exactamente una vez** por la inbox del consumidor (clave única
  registrada en la misma transacción que el efecto). **Orden por agregado**: el productor no entrega la
  versión N+1 mientras la N esté pendiente o muerta; el consumidor descarta versiones ≤ la aplicada donde
  el efecto es una proyección.

## Familias

| Familia | Tópico / operación | Productor → Consumidor | Autenticación | Idempotencia | Reintentos | Orden | Versión | Dueño de la evolución |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Identidad / contexto técnico | Sobre + cabeceras (arriba) | ambos | HMAC por sentido | `eventKey` | ver transporte | por agregado | `spec` `…/1` | Integración (I) |
| Pago / cobertura | `payment.reported` · `payment.confirmed` · `payment.rejected` (`schemas/payment.*.v1`) | Core → ERP (`POST /api/v1/integration/core/events`) | HMAC `ERP_EVENTS_DELIVERY_SECRET` | `eventKey` = `event_id` del outbox de Core; el ERP guarda `(core_tenant_id, core_claim_id)` único | Core `outbound_event_deliveries`: 12 intentos, 5 s·2^(n−1), tope 1 h | cuota de Core (`installment`, versión MAX+1 bajo el cerrojo del préstamo) | `schemaVersion` 1 | C + E |
| Pago / cobertura | `b2b.coverage.settled` · `b2b.recovery.payment_applied` · `b2b.recovery.payment_reversed` (`schemas/b2b.*.v1`) | ERP → Core (`POST /api/v1/internal/integration/erp/events`) | HMAC `OUTBOX_DELIVERY_SIGNING_SECRET` | `eventKey` del outbox del ERP; Core `external_event_inbox (producer, event_key)` único | ERP outbox: 12 intentos, 5 s·2^(n−1), tope 1 h | `merchant_payable` / `consumer_recovery` | 1 | E + C |
| Asiento / conciliación | `accounting.document.*` · `accounting.period.*` (`schemas/accounting.event.v1`) | ERP → (Core acusa sin efecto, IGNORED) | igual que arriba | igual | igual | `accounting_document` / período | 1 | E |
| Compra–cuota | `coreLoanRef` + `installments[].coreInstallmentId` en `POST /api/v1/b2b/bnpl/purchases` del ERP (`schemas/purchase-installment-link.v1`) | quien registra la compra → ERP (`core_installment_links`) | JWT del ERP (roles del alta de compra) | índice único por cuota de Core y por cuota del ERP (409) | lo decide quien llama | — | 1 | E + C |
| Decisión | Motor: `POST /v1/decisions/…` (referencia: `AtlasDecisionEngine/openapi/openapi.json`; cliente Core `src/modules/decision-engine/decision-engine.client.ts`) | Core → Motor | API key por plano | `requestId`/`executionId` del Motor | adaptador de Core (timeout, reintentos, 422 = negocio) | — | OpenAPI del Motor | M |
| Facility / outcome | Motor: `POST /v1/outcomes/facilities`, `POST /v1/outcomes/batch` (referencia al OpenAPI del Motor) | Core → Motor | `DECISION_ENGINE_OUTCOME_API_KEY` | `facilityId` / ventana de observación | trabajos `register_engine_facilities` / `dispatch_loan_outcomes` | por crédito | OpenAPI del Motor | M + C |
| Consentimiento / base habilitante | Motor (referencia al OpenAPI del Motor; réplica `sync_engine_consents` de Core) | Core → Motor | API key del Motor | último estado por sujeto y finalidad | trabajo `sync_engine_consents` | por sujeto | OpenAPI del Motor | M + J |
| Comercio / contrato | Alta de comercio por cola (ERP pide → Motor decide → Core concede → ERP acusa) | ERP ↔ Core | token de servicio / credencial de un propósito | caso de alta | colas existentes | por caso | **sin congelar aquí**: pendiente de P-14 fase 2 | E + C |

Las filas de Decisión, Facility/outcome y Consentimiento **referencian** el contrato del Motor, que es su
fuente (`openapi/openapi.json` en AtlasDecisionEngine); no se duplican aquí para no tener dos verdades.

## Qué hace cada consumidor

- **ERP con `payment.*`** (`CorePaymentEventsService`, inbox `core-payments`): `reported` crea el aviso
  REPORTED de la cuota mapeada; `confirmed` lo confirma con la **misma transición** que la cola de
  revisión (`applyNoticeDecision`); si la cuota tiene cobertura viva NO confirma y abre
  `LATE_PAYMENT_WITH_COVERAGE`; `rejected` lo rechaza. El estado sólo avanza (REPORTED → CONFIRMED |
  REJECTED); una decisión contraria o una cuota sin mapeo quedan en `core_event_exceptions` (ACK).
- **Core con `b2b.*`** (`ErpEventInboxService`): proyección `installment_coverage_projections` (cuánto
  cubrió ATLAS, cuándo, cuánto se recuperó). Core **no** cambia la cuota ni su saldo. `coreRef` que no
  resuelve a una cuota existente de Core → `UNLINKED` (sin atribuirlo a otra cuota).

## Cómo cambiar el contrato

1. Editar `schemas/`, `topics.json` o los casos de `build.mjs`; `node contracts/atlas-integration-v1/build.mjs`.
2. Pruebas de Core: `yarn test:contracts` (conformidad de productor y consumidor).
3. Copiar el directorio al ERP, actualizar `ORIGIN.json` con el commit de Core y correr allí
   `yarn test test/contracts`. `yarn contracts:check-sync <ruta-al-ERP>` debe salir 0.
4. Un cambio incompatible sube `schemaVersion` (el consumidor que no la entiende responde 422) o `spec`.
