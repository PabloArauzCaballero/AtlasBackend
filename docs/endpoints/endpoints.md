# Endpoints Atlas — Fase API 1

## Alcance

Esta entrega implementa los primeros endpoints de negocio sobre entidades existentes del `SYSTEM INFO` y del schema ya migrado.

No se crearon endpoints para seeders. No se crearon entidades nuevas. No se implementaron compras, crédito, cuotas, pagos, MDR, cobranza ni generación de scoring automático.

## Autenticación

Los endpoints protegidos usan JWT Bearer con algoritmo HS256.

Header requerido:

```http
Authorization: Bearer <token>
x-tenant-id: 1
```

Durante desarrollo se puede generar un token de prueba con:

```bash
npm run dev:jwt -- --role=customer --tenant-id=1 --customer-id=1
npm run dev:jwt -- --role=admin --tenant-id=1 --internal-user-id=1
```

No existe endpoint de login porque el schema actual no define tabla de password hash ni módulo Auth completo. Crear login sin una entidad persistente aprobada rompería la regla de no inventar entidades.

## Endpoints públicos

### POST `/api/v1/customers/register`

Registra un cliente inicial.

Headers:

```http
x-tenant-id: 1
```

Body:

```json
{
  "phone": "+59170000000",
  "email": "cliente.demo@atlas.bo",
  "firstName": "Cliente",
  "lastName": "Demo",
  "birthDate": "1998-01-10",
  "preferredLanguage": "es",
  "marketingOptIn": false,
  "sourceType": "mobile_app"
}
```

Reglas:

- Requiere al menos teléfono o email.
- No guarda teléfono ni email en claro.
- Crea `customers`.
- Crea `customer_profile_versions`.
- Crea `customer_contact_methods`.
- Crea `customer_status_events`.
- Usa transacción.

### GET `/api/v1/consent-documents/active`

Lista documentos de consentimiento activos y publicados.

Headers:

```http
x-tenant-id: 1
```

Query params:

| Parámetro | Tipo | Default | Descripción |
|---|---:|---:|---|
| `language` | string | `es` | Idioma del documento. |
| `documentCode` | string | — | Filtro opcional por código de documento. |

## Endpoints protegidos de cliente

### GET `/api/v1/customers/:customerId/summary`

Devuelve resumen seguro del cliente.

No expone hashes, valores cifrados ni datos sensibles completos.

Roles permitidos:

- `customer`, solo si `customerId` del token coincide.
- Roles internos, según futuras políticas de permisos.

### POST `/api/v1/customers/:customerId/consents`

Registra otorgamiento o revocación de consentimiento.

Body:

```json
{
  "consentDocumentId": "1",
  "purposeCode": "risk_evaluation",
  "granted": true,
  "channel": "mobile_app",
  "sessionId": "1",
  "deviceFingerprintSnapshot": "hash-del-device-fingerprint",
  "userAgent": "AtlasMobile/1.0",
  "notes": "Consentimiento otorgado desde onboarding"
}
```

Reglas:

- Valida que exista el cliente.
- Valida que exista el documento de consentimiento.
- Crea `customer_consents`.
- Crea `consent_events`.
- Usa transacción.

### POST `/api/v1/customers/:customerId/sessions`

Registra una sesión y dispositivo hasheado.

Body:

```json
{
  "deviceFingerprintHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "fingerprintVersion": "v1",
  "channel": "mobile_app",
  "authMethod": "jwt",
  "userAgent": "AtlasMobile/1.0",
  "gpsLat": -17.7833,
  "gpsLng": -63.1821,
  "gpsAccuracyMeters": 15,
  "deviceSnapshot": {
    "brand": "Apple",
    "model": "iPhone",
    "osFamily": "iOS",
    "osVersion": "18",
    "appVersion": "0.1.0",
    "isRooted": false,
    "isEmulator": false,
    "vpnDetected": false
  }
}
```

Reglas:

- No recibe fingerprint crudo; recibe hash.
- Crea o actualiza `global_device_fingerprints`.
- Crea o actualiza `devices`.
- Crea o actualiza `customer_device_links`.
- Crea `customer_sessions`.
- Crea `device_snapshots` si se envía snapshot.
- Usa transacción.

### GET `/api/v1/customers/:customerId/sessions`

Lista sesiones del cliente con paginación.

Query params:

| Parámetro | Tipo | Default | Máximo |
|---|---:|---:|---:|
| `page` | number | 1 | — |
| `limit` | number | 20 | 100 |

### GET `/api/v1/customers/:customerId/risk/latest`

Devuelve el último resultado de riesgo existente del cliente.

No ejecuta scoring, no aprueba, no rechaza y no calcula cutoff.

## Endpoints protegidos internos

### GET `/api/v1/operations/manual-review-cases`

Lista casos de revisión manual con paginación.

Roles:

- `internal_operator`
- `risk_analyst`
- `compliance_analyst`
- `admin`
- `platform_admin`

Query params:

| Parámetro | Tipo | Default |
|---|---:|---:|
| `page` | number | 1 |
| `limit` | number | 20 |
| `status` | string | — |
| `customerId` | string | — |

### GET `/api/v1/operations/fraud-cases`

Lista casos de fraude con paginación.

Mismos roles y filtros que revisión manual.

## Exclusiones explícitas

No se implementó:

- Login.
- Password hash.
- Refresh tokens.
- Endpoints de seeds.
- Compra BNPL.
- Línea de crédito.
- Cuotas.
- Pagos.
- MDR.
- Cobranza.
- Reglas de default.
- Cambios de estado de revisión manual.
- Scoring automático.
