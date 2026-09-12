---
title: "Entornos"
type: "reference"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - operations
aliases: []
related: []
---
# Entornos

`NODE_ENV` admite `development`, `test` y `production`.

## Diferencias que importan

| Aspecto | development | test | production |
|---|---|---|---|
| Redis | Opcional (cliente `null`) | Opcional | **Obligatorio** |
| Rate limit compartido entre instancias | No | No | Sí |
| Secretos de ejemplo | Permitidos | Permitidos | **Rechazados** |
| Documentación (`/docs`) | Activa | Activa | Desactivada por defecto |
| Cookie `Secure` | `false` | `false` | `true` |
| `bufferLogs` | No | Sí | Sí |
| KMS | Proveedor `local` | `local` | Debería ser KMS — solo se avisa |

> [!warning] Un límite que no salta en local sí salta desplegado
> Sin Redis, cada instancia cuenta su propio rate limit. En local con una instancia el límite efectivo es el configurado; con 4 réplicas y almacén en memoria sería 4×. En producción Redis es obligatorio, así que el contador es compartido — y el comportamiento **no** es el que se observó en desarrollo.

## Perfiles de datos

Los seeders trabajan por perfil, no por entorno:

```bash
yarn db:seed:prod    # datos maestros mínimos
yarn db:seed:dev     # + credenciales de desarrollo
yarn db:seed:demo    # + datos de demostración
yarn db:seed:test    # fixtures de prueba
```

`yarn check:seed-profiles` valida la separación y `yarn db:seed:verify-prod-idempotency` comprueba que el perfil de producción se puede re-ejecutar sin duplicar.

> [!danger] Nunca sembrar el perfil de desarrollo en producción
> `db:seed:dev` crea credenciales conocidas. El gate existe precisamente porque la confusión es fácil y el resultado es un acceso administrativo con contraseña pública.

## Perfiles de ejecución

| `APP_ROLE` | Uso |
|---|---|
| `all` | Desarrollo, tests, despliegue de una sola pieza (default) |
| `api` | Producción, contenedor de API |
| `worker` | Producción, contenedor de trabajo de fondo |

## Windows

`yarn start:dev` fuerza `NODE_ENV=development` porque un `NODE_ENV=production` global en PowerShell hacía que Zod exigiera secretos reales en local. `yarn env:doctor` diagnostica ese caso.

## Relaciones

- [[10-operations/configuration]] · [[12-development/local-setup]] · [[15-reference/environment-variables]]
