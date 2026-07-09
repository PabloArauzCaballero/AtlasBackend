# Datos y credenciales de desarrollo local

## Usuario interno principal

El seeder `20260704121000-seed-internal-rbac-and-pablo` crea/actualiza el usuario administrador del portal interno:

| Campo | Valor |
|---|---|
| Email | `pablo@atlas.internal` |
| Password local | `Atlas_Pablo#2026!` |
| Roles | `SUPER_ADMIN`, `SYSTEMS_ADMIN`, `DATA_GOVERNANCE_MANAGER` |
| Tenant | `1` |

Esta credencial existe para desarrollo local y pruebas iniciales. No debe usarse como secreto de producción.

## Usuarios y registros demo

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
| Consent document ID activo | `1` |

## Login interno de prueba

```bash
curl -X POST http://localhost:3000/api/v1/internal/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"pablo@atlas.internal","password":"Atlas_Pablo#2026!"}'
```

Guarda el access token retornado y úsalo en endpoints internos:

```bash
curl http://localhost:3000/api/v1/systems/dashboard \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "x-tenant-id: 1"
```

## Reset local reproducible

```bash
yarn db:migration:up
DATABASE_CLEAN_BEFORE_SEED=true yarn db:seed:up
```

Esto limpia datos basura de una base local/staging desechable y carga todos los datos necesarios para probar el portal.
