# Datos y credenciales de desarrollo local

## Usuario interno principal

Esta cuenta (`iam.internal_users._id = 1`) **no la crea ningún seeder del repositorio**: llega con el
conjunto que publica la base de semillas de **desarrollo** al traerlo con `yarn db:seed:pull` (o al
arrancar con `DATABASE_SEED_ON_STARTUP=true`), junto con el catálogo de roles y permisos. La base de
semillas de producción no la publica. Ver [Semillas](seeds.md).

| Campo | Valor |
|---|---|
| Email | `DEV_ADMIN_EMAIL` si está definida; si no, `pablo@atlas.internal` |
| Password local | `DEV_ADMIN_PASSWORD` si está definida; si no, la del hash versionado *(no versionada — pedirla al dueño de la cuenta)* |
| Roles | `SUPER_ADMIN`, `SYSTEMS_ADMIN`, `DATA_GOVERNANCE_MANAGER` |
| Tenant | `1` |

### Apuntar la cuenta a tu correo real

`@atlas.internal` no es un dominio que exista, así que con el default **el PIN del segundo factor y el
correo de reset no se pueden probar contra un buzón de verdad**: se envían y se pierden. Para
recibirlos, define ambas variables en tu `.env` (que está en `.gitignore`) y vuelve a traer las
semillas (`yarn db:seed:pull`):

```env
DEV_ADMIN_EMAIL=tu.correo@ejemplo.com
DEV_ADMIN_PASSWORD=tu-contraseña-local
```

Después de copiar las filas, `applyLocalIdentityOverrides` (`src/database/seed-local-identities.ts`)
aplica esas variables sobre ellas y hashea `DEV_ADMIN_PASSWORD` **en tu máquina**, así que ni la
contraseña ni su hash entran al repo — la lección de ATLAS-P0-002 aplicada al hash. Sólo fuera de
producción. Sin las variables la cuenta queda exactamente como la publica la base de semillas.

Los smokes de contrato leen la misma identidad por `INTERNAL_SMOKE_EMAIL` / `INTERNAL_SMOKE_PASSWORD`;
si cambias el admin, cámbialas también o fallarán al autenticar.

Esta credencial existe para desarrollo local y pruebas iniciales. No debe usarse como secreto de producción.

> **ATLAS-P0-002 (histórico):** la contraseña de esta cuenta estuvo documentada en texto plano en este
> archivo. Se rotó y se retiró de aquí porque un hash o contraseña que aparece en el historial de git se
> considera comprometido permanentemente, sin importar qué tan fuerte sea. Si necesitas rotarla de nuevo,
> usa `DEV_ADMIN_PASSWORD` en tu `.env` o cambia la fila en la base de semillas de desarrollo — nunca
> vuelvas a escribir la contraseña en texto plano en un archivo versionado.

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

> El puerto publicado del contenedor `api` es `API_PUBLISH_PORT` (`.env`, por defecto `53005`), no
> `3000` — ese puerto puede estar ocupado por otro stack local (p. ej. `atlas-integrated-backend` /
> `atlas-decision-engine`). Verifica `docker ps` si tienes dudas de qué servicio responde en cada puerto.

```bash
curl -X POST http://localhost:53005/api/v1/internal/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"pablo@atlas.internal","password":"<pedir la contraseña actual — no está versionada>","tenantId":"1"}'
```

`tenantId` es obligatorio en el body (string numérico) — sin él el login falla con `VALIDATION_ERROR`
antes de llegar a validar credenciales.

La respuesta mueve `accessToken`/`refreshToken` a cookies `HttpOnly` (ver `InternalAuthController`);
no vienen en el body. Para probar con curl, usa `-c` para guardarlas y `-b` para reenviarlas:

```bash
curl -c cookies.txt -X POST http://localhost:53005/api/v1/internal/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"pablo@atlas.internal","password":"<contraseña actual>","tenantId":"1"}'

curl -b cookies.txt http://localhost:53005/api/v1/systems/dashboard \
  -H "x-tenant-id: 1"
```

## Reset local reproducible

```bash
yarn db:migration:up
yarn db:seed:pull   # base de semillas de desarrollo (incluye el usuario admin); DESTRUCTIVO en sus tablas
```

Esto limpia datos basura de una base local/staging desechable y carga todos los datos necesarios para probar el portal.
