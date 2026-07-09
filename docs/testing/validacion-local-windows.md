# Validación local Windows — Atlas Backend

Este checklist parte del caso real donde `yarn start:dev` fallaba porque el proceso arrancaba con `NODE_ENV=production`.

## 1. Usar Node recomendado

Recomendado para desarrollo estable: Node.js 22 LTS. Node 26 puede funcionar, pero puede traer incompatibilidades tempranas con dependencias nativas.

```powershell
node -v
corepack enable
corepack prepare yarn@1.22.22 --activate
yarn -v
```

## 2. Regenerar dependencias y lockfile

El `yarn.lock` debe quedar sincronizado con `package.json` antes de confiar en CI.

```powershell
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
yarn install
```

Si `git diff -- yarn.lock` muestra cambios, commitearlos.

## 3. Configurar entorno local

```powershell
Copy-Item .env.example .env
notepad .env
```

Para local debe quedar:

```env
NODE_ENV=development
REDIS_URL=
```

Redis vacío es aceptable solo para una instancia local. Producción exige Redis.

## 4. Diagnóstico de variables

```powershell
yarn env:doctor
```

## 5. Migraciones, seeds y arranque

```powershell
yarn db:migration:up
yarn db:seed:up
yarn start:dev
```

`yarn start:dev` fuerza `NODE_ENV=development` aunque Windows tenga `NODE_ENV=production` como variable global.

## 6. Gates de calidad

```powershell
yarn check:no-env-file
yarn lint
yarn format:check
yarn type-check
yarn test:coverage
yarn build
```

## 7. Smokes mínimos

Con el servidor levantado en otra terminal:

```powershell
yarn smoke:core
yarn smoke:auth
yarn smoke:catalog
yarn smoke:runtime
yarn smoke:sessions
yarn smoke:risk-telemetry
yarn smoke:events
yarn smoke:notifications
```

## 8. Última corrida real (2026-07-08)

Ejecutada de punta a punta contra PostgreSQL real (instancia local `postgresql-x64-18`, puerto
5433), cerrando P0-01 del reporte de auditoría del backend admin.

| Paso | Resultado |
|---|---|
| `yarn db:migration:status` / `up` | ✅ 1 migración pendiente aplicada limpio sobre base ya existente |
| `yarn db:seed:up` | ✅ sin pendientes |
| `yarn start:dev` | ✅ `Nest application successfully started`, puerto 3005 |
| `yarn smoke` (suite completa) | ✅ 69 llamadas, 100% OK — auth, internal-rbac, onboarding, sesiones, telemetría, riesgo, eventos, notificaciones, proveedores externos, KYC, buró. Ningún 403 inesperado de `TenantGuard` en ningún endpoint con `x-tenant-id`. |
| `yarn test:coverage` | ✅ 82 test suites / 773 tests, 0 fallos |
| `yarn build` / `yarn type-check` | ✅ sin errores |
| `yarn check:no-env-file` | Solo marca `.env` (correcto — es el real de esta máquina, gitignored) |
| `yarn lint` | 2 errores preexistentes en `internal-portal.controller.ts`/`internal-portal.service.ts` (vars sin usar), sin relación con este trabajo |
| `yarn format:check` | 30 archivos marcados por CRLF/LF mixto (checkout en Windows) — cosmético, preexistente; no se corrió `--write` para no generar un diff masivo de saltos de línea |

**Bug encontrado y corregido en esta corrida:** `scripts/check-no-env-file.ts` solo permitía
`.env.example` en el allowlist, por lo que `.env.production.example` (template con placeholders,
sin secretos reales) fallaba el check igual que un `.env` real. Corregido para permitir cualquier
archivo terminado en `.example`.
