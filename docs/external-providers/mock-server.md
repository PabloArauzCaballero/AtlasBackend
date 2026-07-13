# External Providers Mock Server

Servidor independiente para simular proveedores externos.

> **Nuevo servidor canónico:** la implementación modular y con health por proveedor vive
> ahora en `AtlasAdminPortal/mock-server` (fuera de este repo, sin dependencias de
> `AtlasBackend`, pensada para migrar tal cual a un servicio externo). Ver su
> [README](../../../AtlasAdminPortal/mock-server/README.md). El script `mock:providers`
> de este repo se mantiene funcionando para desarrollo local rápido, pero para health
> checks por módulo (`/mock/health/segip`, `/mock/health/qr`, etc.) usá el servidor nuevo.

## Levantar (legacy, embebido en este repo)

```bash
npm run mock:providers
```

Por defecto escucha en:

```txt
http://localhost:4010
```

## Health

```bash
curl http://localhost:4010/mock/health
```

## Escenarios

Puede usarse header:

```txt
x-mock-scenario: partial_match
```

O body:

```json
{ "scenario": "timeout", "input": {} }
```

Escenarios soportados:

- `happy_path`
- `provider_down`
- `timeout`
- `slow_response`
- `invalid_payload`
- `unauthorized`
- `rate_limited`
- `not_found`
- `partial_match`
- `data_not_available`
- `manual_review_required`
- `cost_blocked`
- `provider_internal_error`
- `fraud_signal_high`

## Proveedores mock

- `/mock/segip/identity/verify`
- `/mock/infocenter/credit-report`
- `/mock/qr/payment/verify`
- `/mock/banking/transfer/verify`
- `/mock/telco/phone-trust/check`
- `/mock/facebook/me`
- `/mock/whatsapp/verification/confirm`
- `/mock/digital-trust/check`
