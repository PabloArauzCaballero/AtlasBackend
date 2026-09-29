# ATLAS External Data Providers

Este módulo implementa la capa general para consultar proveedores externos sin acoplar el scoring al proveedor.

## Estado real: sólo simulación

**Hoy ningún proveedor externo tiene integración real.** Los ocho adaptadores de
`src/modules/external-data/infrastructure/adapters/` sólo responden en los dos modos simulados:

| Modo (`${CODE}_MODE` o `default_mode` del proveedor) | Qué hace |
|---|---|
| `mock_local` | El propio adaptador fabrica el payload en proceso. |
| `mock_server` | Lo pide al servidor de mocks (`AtlasExternalProvidersMock`, `EXTERNAL_PROVIDERS_MOCK_BASE_URL`; ver [mock-server.md](mock-server.md)). |
| `disabled` | Falla con `*_PROVIDER_DISABLED`. |
| `sandbox` / `production` | **Falla siempre** con `*_REAL_INTEGRATION_NOT_CONFIGURED`: no hay cliente HTTP hacia el proveedor real. |

Adaptadores y la línea donde se niegan a salir del modo simulado:

| Proveedor | Adaptador |
|---|---|
| `SEGIP` (alias `CGIP`) | `segip/segip.adapter.ts:56` |
| `INFOCENTER` | `infocenter/infocenter.adapter.ts:27` |
| `QR_GENERIC` (también `QR_BCB_GENERIC`) | `qr-generic/qr-generic.adapter.ts:32` |
| `BANKING_GENERIC` | `banking-generic/banking-generic.adapter.ts:54` |
| `TELCO_GENERIC` | `telco-generic/telco-generic.adapter.ts:32` |
| `FACEBOOK_META` | `facebook-meta/facebook-meta.adapter.ts:32` |
| `WHATSAPP_GENERIC` | `whatsapp/whatsapp.adapter.ts:32` |
| `DIGITAL_TRUST_GENERIC` | `digital-trust-generic/digital-trust-generic.adapter.ts:33` |

Además, antes de llegar al adaptador, `productionIntegrationBlockers`
(`application/external-data-policy.util.ts`) bloquea la consulta con `PRODUCTION_GATE_BLOCKED`:

- con `NODE_ENV=production` y el proveedor en un modo simulado → `${CODE}_MOCK_MODE_IN_PRODUCTION`,
  salvo que se encienda a propósito `EXTERNAL_PROVIDERS_ALLOW_MOCK_IN_PRODUCTION=true` (sólo para una
  demo: la evidencia servida es inventada);
- en modo `production` → `${CODE}_REAL_INTEGRATION_NOT_IMPLEMENTED` mientras
  `${CODE}_REAL_INTEGRATION_IMPLEMENTED` no sea `true`, y `<CREDENCIAL>_MISSING` por cada variable de
  `PRODUCTION_CREDENTIAL_REQUIREMENTS` sin valor.

Poner `${CODE}_REAL_INTEGRATION_IMPLEMENTED=true` y rellenar las credenciales **no habilita nada**: el
adaptador sigue lanzando `*_REAL_INTEGRATION_NOT_CONFIGURED`. Consecuencia: en producción Atlas **no
consulta** registro civil, buró, telco, banca ni reputación digital; un despliegue productivo que
dependa de esa evidencia necesita antes un contrato con el proveedor, sus credenciales y un adaptador
real escrito y probado. Hasta entonces esa es la palanca, no un interruptor.

## Regla central

Los proveedores externos producen observaciones y features auditables. El scoring no debe llamar directamente a SEGIP, InfoCenter, QR, bancos, telefónicas, Facebook, WhatsApp ni proveedores de reputación digital.

## Fases (diseño; todas en simulación)

### Fase 1

- `SEGIP`/`CGIP`: identidad/KYC. Sólo `mock_local`/`mock_server`.
- `INFOCENTER`: buró caro, creado pero bloqueado por costo por defecto. Sólo simulación.

### Fase 2

- `QR_GENERIC`: verificación contractual/mock de pagos QR.
- `BANKING_GENERIC`: conciliación bancaria contractual/mock.
- Los bancos específicos quedan pendientes como mini-adapters.

### Fase 3

- `TELCO_GENERIC`: señales de línea, antigüedad, SIM swap (sin API ni contrato hoy).
- `FACEBOOK_META`: conexión voluntaria por OAuth/API oficial, sin scraping (sin app real hoy).
- `WHATSAPP_GENERIC`: contactabilidad/OTP, sin leer chats ni contactos.
- `DIGITAL_TRUST_GENERIC`: reputación de email, IP, dispositivo e identidad sintética.

## Tablas principales

- `data_providers`
- `external_provider_cost_policies`
- `data_provider_requests`
- `data_provider_responses`
- `customer_consents`
- `customer_observations`
- `feature_snapshots`
- `provider_health_logs`
- `external_oauth_connections`

## Endpoints principales

- `POST /api/v1/external-data/consents`
- `POST /api/v1/external-data/requests`
- `GET /api/v1/admin/external-providers`
- `GET /api/v1/admin/external-providers/health`
- `POST /api/v1/kyc/segip/verify`
- `POST /api/v1/bureau/infocenter/check`

## Seguridad

- No se guardan tokens OAuth planos.
- No se guardan chats ni contactos.
- No se inventa antigüedad si Facebook/WhatsApp no la expone oficialmente.
- InfoCenter no se ejecuta automáticamente en onboarding.
- Las respuestas se guardan redacted/sanitizadas y con hash.

## Variables mínimas

Ver `.env.example`. El modo de cada proveedor es `${CODE}_MODE` (`mock_local`, `mock_server`,
`disabled`; `sandbox` y `production` existen en el tipo pero hoy siempre fallan, ver arriba). Las
credenciales que `PRODUCTION_CREDENTIAL_REQUIREMENTS` exige están listadas en
[credenciales-requeridas.md](../config/credenciales-requeridas.md): se comprueba que existan, pero
ningún adaptador las usa todavía.

## Scripts Yarn recomendados

```bash
yarn build
yarn type-check
yarn lint
yarn format:check
yarn test
yarn mock:providers
yarn smoke:external-providers
yarn smoke:external-providers:errors
```
