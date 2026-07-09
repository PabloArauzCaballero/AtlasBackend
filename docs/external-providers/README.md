# ATLAS External Data Providers

Este módulo implementa la capa general para consultar proveedores externos sin acoplar el scoring al proveedor.

## Regla central

Los proveedores externos producen observaciones y features auditables. El scoring no debe llamar directamente a SEGIP, InfoCenter, QR, bancos, telefónicas, Facebook, WhatsApp ni proveedores de reputación digital.

## Fases

### Fase 1

- `SEGIP`/`CGIP`: identidad/KYC en mock local, mock server, sandbox o production.
- `INFOCENTER`: buró caro, creado pero bloqueado por costo por defecto.

### Fase 2

- `QR_GENERIC`: verificación contractual/mock de pagos QR.
- `BANKING_GENERIC`: conciliación bancaria contractual/mock.
- Los bancos específicos quedan pendientes como mini-adapters.

### Fase 3

- `TELCO_GENERIC`: señales de línea, antigüedad, SIM swap si existe API/contrato.
- `FACEBOOK_META`: conexión voluntaria por OAuth/API oficial, sin scraping.
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

Ver `.env.example` para los modos `mock_local`, `mock_server`, `sandbox`, `production` y `disabled`.

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
