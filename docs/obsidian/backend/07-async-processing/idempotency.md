---
title: "Idempotencia"
type: "architecture"
status: "verified"
owner: "unknown"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - async
source_files:
  - "src/modules/runtime-hardening/idempotency.interceptor.ts"
aliases: []
related: []
---
# Idempotencia

## En la API

`IdempotencyInterceptor` actúa sobre `POST`, `PUT`, `PATCH` y `DELETE`, **solo si** llega `x-idempotency-key`.

| Componente de la clave | Valor |
|---|---|
| Clave | Header `x-idempotency-key` |
| Ámbito de tenant | `user.tenantId` → header `x-tenant-id` → `'global'` |
| Ámbito de operación | `MÉTODO + URL` |
| Huella del contenido | `requestHash(body, query, params)` |

> [!info] Por qué se guarda el hash del contenido
> Sin él, repetir la misma clave con un cuerpo distinto devolvería la respuesta del primero: el cliente creería que su segunda operación se aplicó cuando no fue así.
>
> Con el hash, misma clave + mismo cuerpo = *replay* legítimo; misma clave + cuerpo distinto = error del cliente, detectable.

Persistencia en `platform_ops.idempotency_keys`, purgada por `purge_idempotency_keys` según `RUNTIME_JOBS_IDEMPOTENCY_RETENTION_DAYS`.

## Sin header no hay protección

El interceptor no hace nada si la cabecera falta. Los endpoints que **exigen** la clave la validan a mano:

```ts
if (!idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
```

Es un contrato por endpoint, no una garantía global. Al añadir un comando nuevo hay que decidir explícitamente si la exige.

## Orden respecto al log de auditoría

`HttpActionLogInterceptor` va **antes** que el de idempotencia, a propósito: así un *replay* también queda registrado. Si no, un cliente que reintenta N veces aparecería una sola vez en la auditoría y se perdería la señal de que algo iba mal en su lado.

## En el trabajo de fondo

| Mecanismo | Dónde |
|---|---|
| Entrega al menos una vez | El consumidor debe tolerar duplicados |
| Seeds idempotentes | `yarn db:seed:verify-prod-idempotency` |
| Migraciones idempotentes | `constraintExists()` + `IF NOT EXISTS` |
| Reclamo de lote | `pending → processing` evita que dos workers tomen el mismo evento |

## Relaciones

- [[02-architecture/critical-sequences]] · [[idempotency_keys]] · [[07-async-processing/retry-and-dead-letter]]
