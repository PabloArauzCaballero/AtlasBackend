# External Providers Mock Server

Los proveedores externos (SEGIP, INFOCENTER, QR, banca, telco, Facebook, WhatsApp,
digital trust) se simulan con un **backend independiente** que vive en su propio
repositorio: `../AtlasExternalProvidersMock` (sin dependencias de este repo, solo
Node ≥ 18.17). El servidor legacy embebido en `tools/external-providers-mock-server/`
fue eliminado; la copia intermedia `AtlasAdminPortal/mock-server` quedó deprecada.

## Levantar

Desde este repo (atajo, requiere el repo hermano clonado al lado):

```bash
yarn mock:providers
```

O directamente en el repo del mock:

```bash
cd ../AtlasExternalProvidersMock
npm start        # npm run dev para reinicio automático
```

Por defecto escucha en `http://localhost:4010`. El valor que espera
`EXTERNAL_PROVIDERS_MOCK_BASE_URL` en `.env` lleva el **sufijo `/mock`**:

```
EXTERNAL_PROVIDERS_MOCK_BASE_URL=http://localhost:4010/mock
```

El sufijo no es opcional: `mockBaseUrlFor()` le concatena el path del proveedor
(`/segip`, `/infocenter`, …). Sin él la llamada sale a `…:4010/segip/identity/verify`
y el emulador devuelve un 404 que el adapter reporta como falla del PROVEEDOR, no
como una URL mal armada. En el VPS, donde el emulador se alcanza por el alias de la
red de Coolify, es `http://external-providers-mock:4010/mock`.

## Contrato

Este backend arma la URL de cada proveedor con `mockBaseUrlFor()`
(`src/modules/external-data/application/external-data-policy.util.ts`, base
`/mock/<slug>`) más el path de operación que fija cada adapter vía
`callMockServer()` (`.../adapters/shared/mock-http.util.ts`). El health check usa
`GET /mock/health/<slug>` — **por módulo**, no el global: antes preguntaba por
`/mock/health` y los nueve proveedores compartían veredicto, así que con un solo
módulo caído se pintaban todos igual.

Si acá se cambia `mockBaseUrlFor`, un path de adapter o un campo consumido en
`normalize()`, hay que actualizar el emulador correspondiente en
`AtlasExternalProvidersMock/src/providers/`. **No hay `npm test` ni
`test/contract.test.mjs` en el repo del mock** — este documento los describía y nunca
existieron.

## Endpoints de negocio

- `POST /mock/segip/identity/verify`
- `POST /mock/infocenter/credit-report`
- `POST /mock/qr/payment/verify`
- `POST /mock/banking/qr/generate` y `POST /mock/banking/transfer/verify`
- `POST /mock/telco/phone-trust/check`
- `POST /mock/facebook/me`
- `POST /mock/whatsapp/verification/confirm`
- `POST /mock/digital-trust/check`

## Health y catálogo

```bash
curl http://localhost:4010/mock/health          # global
curl http://localhost:4010/mock/health/segip    # por módulo
curl http://localhost:4010/mock/providers       # catálogo: dominio, endpoint, rango de latencia
```

## Latencia

Cada emulador responde con latencia aleatoria dentro de un rango realista para su
tipo de servicio: INFOCENTER 900–2500 ms (el más lento, es la consulta facturada),
SEGIP 600–1400, BANKING 400–1200, DIGITAL_TRUST 300–900, TELCO 300–800, QR 250–700,
WHATSAPP 200–600, FACEBOOK_META 150–500. Todos por debajo del abort de 8 s de
`callMockServer`.

Se fuerza por request con el header `x-mock-latency-ms`.
`MOCK_PROVIDERS_DEFAULT_LATENCY_MS` sólo actúa como red para un módulo que no declare
rango propio. (`MOCK_PROVIDERS_LATENCY_MODE=fixed`, que este documento describía, no
existe.)

`MOCK_PROVIDERS_ERROR_RATE` (0 por defecto) hace fallar sola una fracción de las
llamadas, para que una demo del tablero no sea una línea plana. No afecta a las
llamadas que piden un escenario explícito.

## Escenarios

Por request — header `x-mock-scenario: partial_match` o body
`{ "scenario": "timeout", "input": {} }`. Global — `POST /mock/scenarios/active`
y `POST /mock/reset`.

Soportados: `happy_path`, `provider_down`, `timeout`, `slow_response`,
`invalid_payload`, `unauthorized`, `rate_limited`, `not_found`, `partial_match`,
`data_not_available`, `manual_review_required`, `cost_blocked`, `duplicate_request`,
`provider_internal_error`, `fraud_signal_high`, `low_confidence`, `expired_token`,
`revoked_consent`.

Ver el README de `AtlasExternalProvidersMock` para la estructura interna y cómo
agregar un proveedor nuevo.
