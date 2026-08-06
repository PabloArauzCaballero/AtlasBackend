---
title: "Problemas frecuentes"
type: "runbook"
status: "verified"
owner: "unknown"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - development
aliases: []
related: []
---
# Problemas frecuentes

## Zod exige `REDIS_URL` o secretos de producción en local

**Causa.** `NODE_ENV=production` definido globalmente — típico en Windows/PowerShell.

**Solución.** `yarn start:dev`, que lo fuerza a `development`. Diagnóstico: `yarn env:doctor`. Ver `docs/testing/validacion-local-windows.md`.

## El proceso no arranca y lista variables

**Causa.** `parseEnv()` rechazó la configuración. Es el comportamiento correcto: falla al arrancar en vez de degradar en runtime.

**Solución.** Leer el detalle campo por campo del mensaje; cada línea nombra la variable y el motivo.

## `AUTH_COOKIE_SAMESITE=none` impide arrancar

**Causa.** Falta `AUTH_COOKIE_SECURE=true`. Los navegadores descartan esa combinación en silencio, así que el arranque se bloquea a propósito.

**Solución.** Poner ambas, o volver a `lax`.

## Un `Bearer` correcto devuelve 401

**Causa probable.** Hay una cookie de sesión antigua, y **la cookie tiene prioridad** sobre la cabecera.

**Solución.** Borrar la cookie, o comprobar cuál se está enviando.

## 404 en toda ruta

**Causa.** Falta el prefijo. Todo cuelga de `/api/v1` salvo `/metrics`.

## El puerto no es el que dice el README

`README.md` menciona 3000; el valor real es **3005**. Ver [[14-audits/contradictions|C-002]].

## El rate limit no salta en local pero sí desplegado

**Causa.** Sin Redis cada instancia cuenta por su lado. En producción Redis es obligatorio y el contador es compartido.

## `atlasSchemaFor` lanza al añadir un modelo

**Causa.** La tabla no está en `ATLAS_DOMAIN_TABLES`. Es deliberado: obliga a decidir su esquema.

**Solución.** Registrarla en `src/database/domain-schemas.ts` y verificar con `yarn check:domain-schemas`.

## Un test pasa suelto y falla en la suite

**Causa.** Dependencia del orden.

**Solución.** `yarn test:unit:randomized` para reproducirlo.

## No encuentro el SQL en los logs

**No es un fallo.** El SQL **nunca** se registra: Sequelize inlinea valores y filtraría PII. El log lleva el mensaje del driver y el SQLSTATE. Ver [[09-observability/logging]].

## El worker no ejecuta jobs

Comprobar `APP_ROLE` (`worker` o `all`), la sonda en `:3006/health/readiness`, y `system_job_runs` para la última ejecución. Ver [[10-operations/runbooks/worker-detenido]].

## Relaciones

- [[12-development/local-setup]] · [[10-operations/runbooks/index]]
