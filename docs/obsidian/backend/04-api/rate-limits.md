---
title: "Rate limiting"
type: "api"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - api
  - security
source_files:
  - "src/app.module.ts"
  - "src/common/throttler/redis-throttler-storage.ts"
aliases: []
related: []
---
# Rate limiting

## Límite global

`ThrottlerGuard` registrado como `APP_GUARD`: aplica a **toda** ruta salvo las marcadas con `@SkipThrottle`.

| Variable | Significado |
|---|---|
| `API_RATE_LIMIT_TTL_MS` | Ventana de tiempo |
| `API_RATE_LIMIT_MAX` | Peticiones permitidas por ventana |

## El almacén decide si el límite es real

```ts
storage: redisClient ? new RedisThrottlerStorage(redisClient) : undefined
```

> [!warning] Sin Redis, el límite se multiplica por el número de instancias
> Con almacén en memoria, **cada instancia cuenta por su lado**: con 4 réplicas y un límite de 100, el límite efectivo es 400. En producción `env.ts` ya exige `REDIS_URL`, así que el contador es compartido; en desarrollo no, y eso explica por qué un límite que "no salta" en local sí salta desplegado.

## Límites estrictos en autenticación

Los endpoints públicos de auth (`login`, `login/pin`, `password-reset/*`, `refresh`) llevan `@Throttle` propio, más restrictivo que el global: son la superficie de fuerza bruta. Ver el detalle por ruta en [[15-reference/permissions-matrix]].

Complementos en la misma capa: bloqueo tras `AUTH_MAX_FAILED_LOGIN_ATTEMPTS` durante `AUTH_LOCKOUT_MINUTES`, y cooldown por destino en el envío de correos y códigos.

## Respuesta

`429 Too Many Requests`.

## `/metrics`

Debe llevar `@SkipThrottle` —el *scrape* de Prometheus es periódico y legítimo— y quedar tras red aislada, según la regla del proyecto. Ver [[14-audits/risks-register|SEC-004]].

## Relaciones

- [[04-api/conventions]] · [[08-security/security-overview]]
