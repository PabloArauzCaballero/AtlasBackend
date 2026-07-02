# External Data Providers — Endpoints v2

## Principio de diseño

Todos los endpoints cómodos llaman internamente al `ExternalDataService`, que valida consentimiento, política de costo, cuotas, modo de provider, adapter, respuesta normalizada, observaciones y snapshots de features. El scoring no llama providers externos directamente.

## Endpoints generales

| Método | Ruta | Uso |
|---|---|---|
| POST | `/api/v1/external-data/consents` | Crear consentimiento externo por cliente/proveedor/propósito. |
| GET | `/api/v1/external-data/consents/user/:customerId` | Consultar consentimientos del cliente. |
| POST | `/api/v1/external-data/consents/:consentId/revoke` | Revocar consentimiento. |
| POST | `/api/v1/external-data/requests` | Ejecutar cualquier provider mediante contrato general. |
| GET | `/api/v1/external-data/requests/:requestId` | Ver request, estado, respuesta sanitizada y payload normalizado. |
| GET | `/api/v1/external-data/users/:customerId/observations` | Ver observaciones externas normalizadas. |
| GET | `/api/v1/external-data/users/:customerId/features` | Ver snapshots de features externos. |
| GET | `/api/v1/external-data/providers/health` | Health de providers desde vista operativa. |

## Admin providers

| Método | Ruta | Uso |
|---|---|---|
| GET | `/api/v1/admin/external-providers` | Lista proveedores. |
| GET | `/api/v1/admin/external-providers/health` | Health completo. |
| POST | `/api/v1/admin/external-providers/:providerCode/test` | Ejecutar test controlado del provider. |
| GET | `/api/v1/admin/external-providers/:providerCode/cost-policy` | Consultar políticas de costo. |
| PATCH | `/api/v1/admin/external-providers/:providerCode/cost-policy/:queryType` | Ajustar costo, bloqueo, cuotas y etapas permitidas. |
| POST | `/api/v1/admin/external-providers/requests/:requestId/approve` | Aprobar manualmente una consulta bloqueada. |

## Fase 1

| Método | Ruta | Uso |
|---|---|---|
| POST | `/api/v1/kyc/segip/verify` | Verificación SEGIP/CGIP contractual. |
| POST | `/api/v1/bureau/infocenter/check` | InfoCenter con bloqueo de costo por defecto. |

## Fase 2

| Método | Ruta | Uso |
|---|---|---|
| POST | `/api/v1/payments/qr/verify` | Verificación QR mock/contractual. |
| POST | `/api/v1/payments/bank-transfer/verify` | Verificación bancaria genérica mock/contractual. |

## Fase 3

| Método | Ruta | Uso |
|---|---|---|
| POST | `/api/v1/telco/phone-trust/verify` | Señales de teléfono/telco. |
| GET | `/api/v1/telco/phone-trust/:customerId` | Features de confianza telefónica. |
| GET | `/api/v1/social/facebook/connect-url?customerId=1` | URL OAuth contractual/mock. |
| POST | `/api/v1/social/facebook/callback` | Callback contractual y generación de features sociales. |
| GET | `/api/v1/social/facebook/status/:customerId` | Estado/feature snapshots asociados. |
| POST | `/api/v1/whatsapp/verification/start` | Inicio verificación WhatsApp mock/contractual. |
| POST | `/api/v1/whatsapp/verification/confirm` | Confirmación OTP WhatsApp mock/contractual. |
| GET | `/api/v1/whatsapp/status/:customerId` | Estado/feature snapshots asociados. |
| POST | `/api/v1/digital-trust/check` | Digital trust genérico mock/contractual. |
| GET | `/api/v1/digital-trust/profile/:customerId` | Features de confianza digital. |

## Mejoras v2 aplicadas

- Se reemplazaron placeholders de features/observations por lecturas reales desde `feature_snapshots` y `customer_observations`.
- Se añadió `GET /external-data/requests/:requestId` con respuesta sanitizada y payload normalizado.
- Se añadió gestión de consentimientos: listar y revocar.
- Se añadió administración real de políticas de costo por provider/query type.
- Se añadió control de cuotas diaria/mensual/global para evitar gasto accidental.
- Se añadió protección por idempotency key para no duplicar consultas costosas.
- Se amplió Fase 2 con endpoints QR/banca general.
- Se amplió Fase 3 con endpoints telco, Facebook, WhatsApp y digital trust.

## Pendiente real

- Conectar SEGIP real con contrato/documentación.
- Conectar bancos reales uno por uno.
- Conectar QR real cuando exista documentación/sandbox.
- Conectar telcos reales solo con contrato/API oficial.
- Conectar Meta/WhatsApp real solo con OAuth/API oficial y scopes mínimos.
