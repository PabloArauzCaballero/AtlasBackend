---
title: "Gestión de secretos"
type: "security"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - security
  - secrets
aliases: []
related: []
---
# Gestión de secretos

## Regla base

**Ningún secreto vive en el repositorio.** Todos entran por variables de entorno.

## Defensas

| Defensa | Mecanismo |
|---|---|
| `.env` versionado | `yarn check:no-env-file` — falla en CI |
| Escaneo de secretos | `.gitleaks.toml` |
| Secretos de ejemplo en producción | Zod los **rechaza**: no arranca |
| Ejemplo desincronizado | `yarn check:env-example` |
| Diagnóstico local | `yarn env:doctor` |

## Secretos en uso

| Secreto | Variable | Uso |
|---|---|---|
| Firma de JWT | `JWT_ACCESS_TOKEN_SECRET` | HS256 |
| Contraseña de BD | `DB_PASSWORD` | Runtime |
| Contraseña de migración | Identidad `DB_MIGRATION_USER` | DDL |
| Conexión Redis | `REDIS_URL` | Puede incluir credenciales |
| Conexión Mongo | `MONGO_*` | Sincronía de logs |
| Cifrado de tokens de dispositivo | `NOTIFICATION_TOKEN_ENCRYPTION_KEY` | Push |
| Clave maestra de PII | `KMS_KEY_ID` + `AWS_REGION`, o derivada | Envelope encryption |
| Credenciales de proveedores | Por adaptador | Llamadas externas |

Los valores nunca se documentan: esta bóveda solo lista nombres, propósitos y si son obligatorios. Ver [[15-reference/environment-variables]].

## Simetría HS256

> [!warning] HS256 es simétrico
> La misma clave firma y verifica. Quien pueda leer `JWT_ACCESS_TOKEN_SECRET` puede **emitir tokens válidos para cualquier rol**, incluido `platform_admin`.
>
> Consecuencias: no compartir el secreto con servicios que solo necesitan *verificar*; rotarlo obliga a invalidar los tokens vigentes (`tokenVersion` ya permite hacerlo). Con RS256 el verificador solo necesitaría la clave pública, pero eso es un cambio de diseño, no de configuración.

## Contraseñas de usuario

`argon2`. Utilidad de apoyo: `yarn hash-password`.

## Rotación

`PENDIENTE` — no hay procedimiento de rotación documentado en el repositorio. Lo que existe:

- `tokenVersion` permite invalidar tokens sin esperar a que expiren.
- `yarn crypto:reencrypt-pii` permite migrar de proveedor de cifrado.
- La rotación de claves KMS se gestionaría en AWS, fuera de este código.

## Relaciones

- [[08-security/data-protection]] · [[10-operations/configuration]] · [[08-security/security-overview]]
