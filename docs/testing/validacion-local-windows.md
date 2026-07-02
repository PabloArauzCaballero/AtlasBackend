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
