---
title: "Puesta en marcha local"
type: "reference"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - development
aliases: []
related: []
---
# Puesta en marcha local

## Prerrequisitos

| Requisito | Versión |
|---|---|
| Node.js | ≥ 22 (`.nvmrc`) |
| Yarn | según `.yarnrc` |
| PostgreSQL | vía Docker o local |
| Redis | opcional en dev |
| MongoDB | opcional (logs) |

## Pasos

```bash
# 1
yarn install

# 2 — entorno
cp .env.example .env
# Editar: credenciales de PostgreSQL, JWT_ACCESS_TOKEN_SECRET.
# NUNCA commitear .env — `yarn check:no-env-file` falla en CI.

# 3 — infraestructura
docker compose up -d postgres redis mongo

# 4 — roles de base de datos (una vez)
yarn db:provision:dev      # bootstrap de roles + verificación de privilegios

# 5 — esquema y datos
yarn db:migration:up
yarn db:seed:dev

# 6 — validar configuración
yarn env:doctor

# 7 — arrancar
yarn start:dev
```

La API queda en `http://localhost:3005/api/v1`, la documentación en `/api/v1/docs` y las métricas en `/metrics`.

## Arrancar el worker aparte

```bash
yarn build
APP_ROLE=worker node dist/src/worker.js     # sonda en 3006
```

Con `APP_ROLE=all` (el default) un solo proceso hace ambas cosas — suficiente para desarrollo.

## Modos de arranque

| Comando | Qué hace |
|---|---|
| `yarn start:dev` | Compila y arranca forzando `NODE_ENV=development` |
| `yarn start:dev:tsx` | `tsx watch` sobre `src/main.ts`, sin compilar |
| `yarn start:watch:build` | `tsc -w` en paralelo |
| `yarn start:prod` | Compila y arranca con configuración de producción |

## Utilidades

| Comando | Para qué |
|---|---|
| `yarn dev:jwt --role=admin` | JWT local sin pasar por el login |
| `yarn hash-password` | Hash argon2 de una contraseña |
| `yarn env:doctor` | Diagnóstico de la configuración |
| `yarn db:migration:status` | Qué migraciones están aplicadas |
| `yarn db:seed:reseed:dev` | Rehacer los datos de desarrollo |

## Datos de desarrollo

Las credenciales sembradas están en `docs/database/dev-credentials.md`. **Solo** para el perfil `development`: sembrarlas en producción crearía accesos con contraseña conocida — el gate `check:seed-profiles` existe por eso.

## Problemas frecuentes

Ver [[12-development/troubleshooting]].

## Relaciones

- [[00-home/quick-start]] · [[12-development/coding-conventions]] · [[10-operations/environments]]
