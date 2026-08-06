---
title: "Configuración"
type: "reference"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - operations
  - configuration
source_files:
  - "src/config/env.ts"
  - "src/config/env.schema.ts"
  - "src/config/env-cross-checks.ts"
aliases: []
related: []
---
# Configuración

## Un solo mecanismo

159 variables de entorno validadas con Zod. No hay archivos de configuración por entorno ni configuración dinámica en base de datos.

```
process.env → envBaseSchema → applyEnvCrossChecks → env (tipado)
```

## Falla al arrancar, no en runtime

> [!info] Verificado
> `parseEnv()` hace `safeParse` y, si falla, **lanza** con el detalle campo por campo:
>
> ```
> Configuración de entorno inválida para ATLAS.
> - VARIABLE: mensaje
> ```
>
> Un fallo de configuración aparece en el despliegue, no como un 500 intermitente tres horas después.

## Validaciones cruzadas

`env-cross-checks.ts` comprueba combinaciones que ningún campo puede validar por su cuenta:

| Regla | Consecuencia |
|---|---|
| `AUTH_COOKIE_SAMESITE=none` exige `AUTH_COOKIE_SECURE=true` | **No arranca** — los navegadores descartarían la cookie en silencio y el login quedaría roto sin error de servidor |
| Producción exige `REDIS_URL` | **No arranca** — sin él el rate limit se cuenta por instancia |
| Producción rechaza los secretos de ejemplo | **No arranca** |
| Producción sin `KMS_KEY_ID`+`AWS_REGION` | **Avisa pero arranca** — ver [[14-audits/risks-register\|SEC-002]] |

## Defaults derivados

| Variable | Default |
|---|---|
| `API_DOCS_ENABLED` | `NODE_ENV !== 'production'` |
| `AUTH_COOKIE_SECURE` | `NODE_ENV === 'production'` |

Ambos hacen lo seguro por defecto sin obligar a configurarlo.

## Grupos

| Grupo | Prefijo |
|---|---|
| Aplicación | `APP_`, `API_`, `NODE_ENV`, `CORS_` |
| Base de datos | `DB_` |
| Autenticación | `AUTH_`, `JWT_` |
| Trabajo de fondo | `RUNTIME_JOBS_` |
| Notificaciones | `NOTIFICATIONS_`, `NOTIFICATION_` |
| Observabilidad | `OTEL_`, `METRICS_`, `HEALTH_` |
| Cifrado | `KMS_`, `AWS_` |
| Almacenes | `REDIS_`, `MONGO_` |

Catálogo completo en [[15-reference/environment-variables]].

## Secretos

Nunca en el repositorio. `yarn check:no-env-file` falla en CI si aparece un `.env`. `yarn check:env-example` contrasta el ejemplo con el esquema. `yarn env:doctor` diagnostica la configuración local.

## Relaciones

- [[15-reference/environment-variables]] · [[10-operations/environments]] · [[08-security/secrets-management]]
