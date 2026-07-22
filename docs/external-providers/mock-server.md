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

Por defecto escucha en `http://localhost:4010` — el valor que espera
`EXTERNAL_PROVIDERS_MOCK_BASE_URL` en `.env` cuando un proveedor está en modo
`mock_server`.

## Contrato

Este backend arma la URL de cada proveedor con `mockBaseUrlFor()`
(`src/modules/external-data/application/external-data-policy.util.ts`, base
`/mock/<slug>`) más el path de operación que fija cada adapter vía
`callMockServer()` (`.../adapters/shared/mock-http.util.ts`). El health check usa
`GET /mock/health`.

Ese contrato (paths, escenarios, status HTTP de fallas de transporte y campos que
normaliza cada adapter) está fijado por `test/contract.test.mjs` en el repo del mock:
correr `npm test` allá tras cualquier cambio. Si acá se cambia `mockBaseUrlFor`, un
path de adapter o un campo consumido en `normalize()`, hay que actualizar ese test y
el emulador correspondiente en `AtlasExternalProvidersMock/src/providers/`.

## Endpoints de negocio

- `POST /mock/segip/identity/verify`
- `POST /mock/infocenter/credit-report`
- `POST /mock/qr/payment/verify`
- `POST /mock/banking/transfer/verify`
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

Por defecto cada emulador responde con latencia aleatoria dentro de un rango
realista para su tipo de servicio (p. ej. bureau de crédito 600–2400 ms, graph API
120–700 ms), siempre con techo de 3000 ms — lejos del abort de 8 s de
`callMockServer`. Se puede forzar por request con el header `x-mock-latency-ms`, o
fijar `MOCK_PROVIDERS_LATENCY_MODE=fixed` para usar siempre
`MOCK_PROVIDERS_DEFAULT_LATENCY_MS`.

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
