# Datos sembrados para desarrollo local

**ATLAS-AUDIT-013 (cerrado en este patch):** la versión anterior de este archivo listaba
contraseñas "reservadas" en texto plano, incluso aclarando que no se insertaban en la base de
datos. Escribir contraseñas (aunque sean ficticias/futuras) en un archivo versionado en Markdown
es un antipatrón que puede filtrarse a producción por copy-paste — ver `CONTRIBUTING.md` §7
("Prohibido: Passwords/tokens/keys"). Se reemplaza por instrucciones de generación.

Ahora que existe el módulo `auth` (ver `src/modules/auth/`), las credenciales reales se
provisionan con `POST /auth/provision-credentials` (actores internos) o con el campo `password`
opcional de `POST /customer-onboarding/start` (clientes) — nunca se declaran en un archivo
versionado.

## Usuarios sembrados (sin contraseña — se provisiona aparte)

| Tipo | Usuario | Email | Rol |
|---|---|---|---|
| Plataforma | `pablo.platform` | `pablo.platform@atlas.test` | `platform_super_admin` |
| Interno tenant | `pablo.admin` | `pablo.admin@atlas.test` | `tenant_admin` |
| Operaciones riesgo | `risk.ops` | `risk.ops@atlas.test` | `risk_analyst` |
| Cliente demo | `cliente.demo` | `cliente.demo@atlas.test` | `customer_demo` |

## Cómo provisionar una contraseña local para estos usuarios

```bash
# 1. Levantar el servidor con la base de datos sembrada (ver más abajo).
# 2. Obtener un JWT de admin para desarrollo (bypassa login solo para uso local):
yarn dev:jwt --role=admin --tenant-id=1 --internal-user-id=1

# 3. Usar ese JWT para provisionar una contraseña real para el usuario que necesites probar.
#    Reemplaza <ACCESS_TOKEN> y elige tu propia contraseña (no la commitees en ningún archivo):
curl -X POST http://localhost:3000/api/v1/auth/provision-credentials \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "x-tenant-id: 1" \
  -H "Content-Type: application/json" \
  -d '{"actorType":"internal_user","actorId":"1","password":"TU-CONTRASENA-LOCAL-AQUI"}'

# 4. A partir de ahí, iniciar sesión normalmente:
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "x-tenant-id: 1" \
  -H "Content-Type: application/json" \
  -d '{"actorType":"internal_user","identifier":"pablo.admin@atlas.test","password":"TU-CONTRASENA-LOCAL-AQUI"}'
```

Para el cliente demo, la forma más simple es registrar uno nuevo con contraseña directamente
(no reutilizar el `cliente.demo` sembrado, que no tiene `auth_credentials`):

```bash
curl -X POST http://localhost:3000/api/v1/customer-onboarding/start \
  -H "x-idempotency-key: dev-$(date +%s)" \
  -H "Content-Type: application/json" \
  -d '{
        "customer": {"phone": "+59170000001", "email": "dev-local@atlas.test", "firstName": "Dev", "lastName": "Local"},
        "password": "TU-CONTRASENA-LOCAL-AQUI",
        "consents": [{"consentDocumentId": "1", "purposeCode": "onboarding", "granted": true}],
        "device": {"deviceFingerprintHash": "dev-local-fingerprint-000000000000", "fingerprintVersion": "v1", "channel": "mobile_app"}
      }'
```

## Datos técnicos del seed

| Dato | Valor |
|---|---|
| Tenant ID | `1` |
| Tenant code | `atlas-bo-dev` |
| Customer ID | `1` |
| Customer code | `CUS-DEMO-001` |
| Device ID | `1` |
| Session ID | `1` |
| Risk assessment run ID | `1` |
| Manual review case | `MR-DEMO-001` |
| Fraud case | `FR-DEMO-001` |
| Consent document ID (activo, usable en onboarding) | `1` |

## Cómo cargar los datos

```bash
yarn db:migration:up
yarn db:seed:up
```

## Cómo revertirlos

```bash
yarn db:seed:down
```

## Nota de seguridad

Estos datos son solo para entorno local o base de pruebas. Ninguna contraseña real debe
escribirse en este archivo, en ningún otro archivo versionado, ni loggearse — solo debe existir
en la cabeza de quien la eligió y en el hash Argon2id almacenado en `auth_credentials`.
