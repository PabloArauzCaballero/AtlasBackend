# Datos y credenciales de desarrollo local

## Usuario interno principal

Esta cuenta (`iam.internal_users._id = 1`) **no la crea ningún seeder del repositorio**: llega con el
conjunto que publica la base de semillas de **desarrollo** al traerlo con `yarn db:seed:pull` (o al
arrancar con `DATABASE_SEED_ON_STARTUP=true`), junto con el catálogo de roles y permisos. La base de
semillas de producción no la publica. Ver [Semillas](seeds.md).

| Campo          | Valor                                                                                                                               |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Email          | `DEV_ADMIN_EMAIL` si está definida; si no, `admin@atlas.local`                                                                      |
| Password local | `DEV_ADMIN_PASSWORD` si está definida; si no, una **aleatoria generada en tu máquina** que `yarn db:seed:pull` imprime una sola vez |
| Roles          | `SUPER_ADMIN`, `SYSTEMS_ADMIN`, `DATA_GOVERNANCE_MANAGER`                                                                           |
| Tenant         | `1`                                                                                                                                 |

Justo después de copiar las filas (y sólo entonces: si `--if-empty` se salta la carga, no se toca
nada), `applyLocalIdentityOverrides` (`src/database/seed-local-identities.ts`) fija **siempre** el
correo y la contraseña de esta cuenta. Lo hace siempre porque el hash que trae la base de semillas es
el mismo para todos y, por tanto, conocido: no hay hash por defecto que valga. La contraseña se
hashea **en tu máquina**, así que ni ella ni su hash entran al repo — la lección de ATLAS-P0-002
aplicada al hash. Sólo fuera de producción.

Si no definiste `DEV_ADMIN_PASSWORD`, la siembra genera una contraseña y la guarda en un archivo nuevo con
permisos 600 en el directorio temporal; la salida sólo dice dónde (el valor nunca va a la consola ni a los
logs). Si lo pierdes, define la variable y vuelve a traer las semillas:

```text
Administrador de desarrollo: admin@atlas.local
Contraseña generada en esta máquina: en /tmp/atlas-dev-admin-<pid>-<instante>.txt (permisos 600)
```

### Apuntar la cuenta a tu correo real

`atlas.local` no es un dominio que exista, así que con el defecto **el PIN del segundo factor y el
correo de reset no se pueden probar contra un buzón de verdad**: el envío se descarta. Para
recibirlos, define ambas variables en tu `.env` (que está en `.gitignore`) y vuelve a traer las
semillas (`yarn db:seed:pull`):

```env
DEV_ADMIN_EMAIL=tu.correo@ejemplo.com
DEV_ADMIN_PASSWORD=tu-contraseña-local
```

Los smokes de contrato leen la misma identidad por `INTERNAL_SMOKE_EMAIL` / `INTERNAL_SMOKE_PASSWORD`;
si cambias el admin, cámbialas también o fallarán al autenticar.

Esta credencial existe para desarrollo local y pruebas iniciales. No debe usarse como secreto de producción.

> **ATLAS-P0-002 (histórico):** la contraseña de la cuenta de desarrollo anterior estuvo documentada en
> texto plano en este archivo y sigue en el historial público; por eso esa cuenta ya no existe en TEST
> ni en DEV, el correo por defecto pasó a ser `admin@atlas.local` (auditoría 2026-10-09) y la siembra
> deja de heredar el hash publicado. Se rotó y se retiró de aquí porque un hash o contraseña que aparece en el historial de git se
> considera comprometido permanentemente, sin importar qué tan fuerte sea. Si necesitas rotarla de nuevo,
> usa `DEV_ADMIN_PASSWORD` en tu `.env` y vuelve a traer las semillas — nunca
> vuelvas a escribir la contraseña en texto plano en un archivo versionado.

## Usuarios y registros demo

| Dato                       | Valor          |
| -------------------------- | -------------- |
| Tenant ID                  | `1`            |
| Tenant code                | `atlas-bo-dev` |
| Customer ID                | `1`            |
| Customer code              | `CUS-DEMO-001` |
| Device ID                  | `1`            |
| Session ID                 | `1`            |
| Risk assessment run ID     | `1`            |
| Manual review case         | `MR-DEMO-001`  |
| Fraud case                 | `FR-DEMO-001`  |
| Consent document ID activo | `1`            |

## Login interno de prueba

> El puerto publicado del contenedor `api` es `API_PUBLISH_PORT` (`.env`, por defecto `53005`), no
> `3000` — ese puerto puede estar ocupado por otro stack local (p. ej. `atlas-integrated-backend` /
> `atlas-decision-engine`). Verifica `docker ps` si tienes dudas de qué servicio responde en cada puerto.

```bash
curl -X POST http://localhost:53005/api/v1/internal/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@atlas.local","password":"<DEV_ADMIN_PASSWORD o la que imprimió la siembra>","tenantId":"1"}'
```

`tenantId` es obligatorio en el body (string numérico) — sin él el login falla con `VALIDATION_ERROR`
antes de llegar a validar credenciales.

La respuesta mueve `accessToken`/`refreshToken` a cookies `HttpOnly` (ver `InternalAuthController`);
no vienen en el body. Para probar con curl, usa `-c` para guardarlas y `-b` para reenviarlas:

```bash
curl -c cookies.txt -X POST http://localhost:53005/api/v1/internal/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@atlas.local","password":"<contraseña>","tenantId":"1"}'

curl -b cookies.txt http://localhost:53005/api/v1/systems/dashboard \
  -H "x-tenant-id: 1"
```

## Reset local reproducible

```bash
yarn db:migration:up
yarn db:seed:pull   # base de semillas de desarrollo (incluye el usuario admin); DESTRUCTIVO en sus tablas
```

Esto limpia datos basura de una base local/staging desechable y carga todos los datos necesarios para probar el portal.
