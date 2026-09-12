---
title: "Quick start"
type: "overview"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - documentation
  - onboarding
aliases: []
related: []
---

# Quick start

Camino más corto para tener Atlas corriendo en local. El detalle está en [[12-development/local-setup]].

## Requisitos

| Requisito | Versión | Evidencia |
|---|---|---|
| Node.js | ≥ 22 | `engines` en `package.json`, `.nvmrc` |
| Yarn | — | `.yarnrc`, `yarn.lock` |
| PostgreSQL | — | `docker-compose.yml` servicio `postgres` |
| Redis | Opcional en dev, **obligatorio en producción** | `REDIS_URL`; sin él el cliente es `null` |
| MongoDB | Opcional (sincronía de logs) | `docker-compose.yml` servicio `mongo` |
| Docker | Opcional, para las dependencias | `docker-compose.yml` |

## Ruta rápida

```bash
# 1. Dependencias
yarn install

# 2. Entorno — copiar el ejemplo y editar
cp .env.example .env
#    Nunca se commitea: el gate `yarn check:no-env-file` falla en CI si aparece.

# 3. Dependencias de infraestructura (si usas Docker)
docker compose up -d postgres redis mongo

# 4. Esquema y datos mínimos
yarn db:migration:up
yarn db:seed:up

# 5. Validar la configuración antes de arrancar
yarn env:doctor

# 6. Arrancar
yarn start:dev
```

`yarn start:dev` fuerza `NODE_ENV=development` antes de cargar `dist/src/main.js` — existe porque en Windows/PowerShell un `NODE_ENV=production` global hacía que Zod exigiera secretos reales y `REDIS_URL` en local.

## Dónde queda

| Recurso | URL |
|---|---|
| API | `http://localhost:3005/api/v1` |
| Documentación interactiva (Scalar/Swagger) | `http://localhost:3005/api/v1/docs` — solo si `API_DOCS_ENABLED` (por defecto, fuera de producción) |
| Métricas Prometheus | `http://localhost:3005/metrics` — fuera del prefijo, a propósito |
| Sonda del worker | `http://localhost:3006/health/readiness` |

> [!warning] Contradicción documental — puerto
> `README.md:104` dice que la API queda en `http://localhost:3000/api/v1`. El valor real es **3005**: `APP_PORT` tiene `default(3005)` en `src/config/env.schema.ts`, y tanto `docker-compose.yml` como los `servers` del contrato OpenAPI usan 3005. Registrado como [[14-audits/contradictions|C-002]].

## Probar sin pasar por el login

```bash
yarn dev:jwt --role=admin      # emite un JWT de desarrollo
```

## Antes de abrir un PR

```bash
yarn type-check && yarn type-check:tests && yarn lint && yarn format:check && yarn test
```

La lista completa de gates está en [[11-quality/quality-gates]].

## Arrancar el worker

El worker es **el mismo artefacto** con otro entrypoint:

```bash
APP_ROLE=worker node dist/src/worker.js
```

Arrancar el entrypoint equivocado para el rol configurado **falla de inmediato** (`process.exit(1)`), a propósito: un rol mal puesto debe doler al desplegar, no en la primera auditoría. Ver [[02-architecture/runtime-topology]].

## Relaciones

- [[12-development/local-setup]] · [[12-development/troubleshooting]] · [[15-reference/commands]]
