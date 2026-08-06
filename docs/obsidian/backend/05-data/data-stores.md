---
title: "Almacenes de datos"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - data
  - stores
aliases: []
related: []
---
# Almacenes de datos

| Almacén | Motor | Rol | Datos | Consistencia | Criticidad |
|---|---|---|---|---|---|
| Principal | PostgreSQL | Fuente de verdad transaccional | 130 tablas en 12 esquemas | Fuerte (ACID) | **Crítica** |
| Lectura | PostgreSQL (réplica) | Consultas de listado | 7 vistas `read_api` | Eventual | Media |
| Caché / coordinación | Redis | Rate limiting, caché, liderazgo de jobs | Efímero | Sin durabilidad | Alta en producción |
| Logs | MongoDB | Consulta de logs de aplicación | Documentos de log | Eventual | Media |
| Objetos | S3 | Documentos de evidencia | Archivos | Eventual | Media |

## PostgreSQL — principal

| Aspecto | Configuración |
|---|---|
| Pool | `DB_POOL_MAX` 20, `DB_POOL_MIN` 2 |
| Adquisición / inactividad | `DB_POOL_ACQUIRE_MS` 30 s, `DB_POOL_IDLE_MS` 10 s |
| TLS | `DB_SSL`, `DB_SSL_REJECT_UNAUTHORIZED` |
| Identidades | Runtime (`DB_USER`) sin DDL; migración (`DB_MIGRATION_USER`) con DDL |

> [!warning] El pool se dimensiona contra el límite del rol
> El comentario del esquema lo dice: **(instancias × `DB_POOL_MAX`) no debe superar el `CONNECTION LIMIT` del rol `atlas_app_rw`**. Escalar réplicas sin revisar ese producto agota las conexiones del servidor, y el síntoma —errores de adquisición— aparece lejos de la causa. Verificable con `yarn check:db-privileges`.

Decide el readiness: si no responde, la instancia devuelve 503 y sale del balanceador.

## PostgreSQL — lectura

`DB_READ_ENABLED` + `DB_READ_POOL_MAX` (10). Si está apagado, el token de lectura apunta al pool de escritura y el health check lo reporta como `not_configured` en vez de fingir dos dependencias sanas.

**No decide el readiness**, a propósito: es una dependencia compartida y marcarla obligatoria convertiría una degradación parcial en caída total. Ver [[02-architecture/critical-sequences]].

## Redis

Opcional en desarrollo (el cliente es `null`), **obligatorio en producción** por validación cruzada de Zod.

| Uso | Consecuencia si falta |
|---|---|
| Almacén del throttler | El límite se cuenta por instancia — se multiplica por el número de réplicas |
| Liderazgo de jobs | Riesgo de ejecución duplicada entre workers |
| Caché | Más carga sobre PostgreSQL |

Cuenta para el readiness **solo si está configurado**: `redis !== 'unreachable'`.

## MongoDB

Destino de la sincronía de logs (`log-sync`), consultable por `mongo-logs.controller.ts`. Las consultas escapan la entrada con `escapeRegex` para evitar inyección de operadores.

Ver [[02-architecture/adr/0003-mongo-log-sync|ADR-0003]].

## S3

Documentos de evidencia, con firma propia (`s3-signature.util.ts`) y análisis antimalware **antes** de almacenar.

## Ausencias

Sin broker de mensajería (lo cubre el outbox), sin motor de búsqueda, sin almacén vectorial.

## Relaciones

- [[05-data/data-architecture]] · [[10-operations/environments]] · [[05-data/backups-and-restore]]
