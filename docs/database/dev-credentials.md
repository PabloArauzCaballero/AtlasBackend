# Datos y credenciales de desarrollo local

## Usuario interno principal

El seeder `20260704121000-seed-internal-rbac-and-pablo` crea/actualiza el usuario administrador del portal interno **solo en entornos no productivos** (falla explícitamente si `NODE_ENV=production`, ver ATLAS-P0-001 en `docs/progress/remediation-register.md`):

| Campo | Valor |
|---|---|
| Email | `pablo@atlas.internal` |
| Password local | *(no versionada — pedir al dueño de la cuenta o consultar el gestor de contraseñas del equipo)* |
| Roles | `SUPER_ADMIN`, `SYSTEMS_ADMIN`, `DATA_GOVERNANCE_MANAGER` |
| Tenant | `1` |

Esta credencial existe para desarrollo local y pruebas iniciales. No debe usarse como secreto de producción.

> **ATLAS-P0-002 (histórico):** la contraseña de esta cuenta estuvo documentada en texto plano en este
> archivo. Se rotó y se retiró de aquí porque un hash o contraseña que aparece en el historial de git se
> considera comprometido permanentemente, sin importar qué tan fuerte sea. Si necesitas rotarla de nuevo,
> genera un hash nuevo con `hashPassword()` (`src/common/utils/crypto/password.util.ts`) y actualiza el
> seeder — nunca vuelvas a escribir la contraseña en texto plano en un archivo versionado.

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
  -d '{"email":"pablo@atlas.internal","password":"<pedir la contraseña actual — no está versionada>"}'
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
