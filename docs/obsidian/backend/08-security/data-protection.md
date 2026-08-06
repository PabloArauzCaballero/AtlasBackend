---
title: "Protección de datos"
type: "security"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - security
  - pii
aliases: []
related: []
---
# Protección de datos

Cómo se protege la PII en reposo, en tránsito y en los caminos laterales. El inventario de qué es sensible está en [[05-data/sensitive-data]].

## En reposo

**Envelope encryption.** Una *data key* cifra el valor; la clave maestra cifra la data key.

| Proveedor | Activación | Clave maestra |
|---|---|---|
| `KmsKeyProvider` | `KMS_KEY_ID` **y** `AWS_REGION` | AWS KMS |
| `local` | Por defecto | SHA-256 de una variable de entorno |

El proveedor se fija una vez en el bootstrap de `main.ts` y `worker.ts` — **los dos**, porque el worker también escribe PII (entrega de notificaciones, retención). Si solo se activara en la API, los valores nuevos del worker saldrían cifrados con `local` mientras los de la API salen con KMS.

> [!info] La migración a KMS no rompe lo existente
> El `providerId` va embebido en cada valor cifrado, así que los valores `local` previos se siguen descifrando. `yarn crypto:reencrypt-pii` (con `--dry-run`) migra los existentes. Activar KMS no toca ningún *call site*.

> [!danger] SEC-002
> En producción sin KMS, la clave maestra se deriva de una variable de entorno. El código **avisa pero no bloquea**. Ver [[14-audits/risks-register]].

## En tránsito

| Tramo | Protección |
|---|---|
| Cliente ↔ API | TLS en el borde; `helmet()` con HSTS |
| API ↔ PostgreSQL | `DB_SSL` + `DB_SSL_REJECT_UNAUTHORIZED` |
| API ↔ proveedores | HTTPS por adaptador |
| Cookies | `Secure` en producción; `SameSite` configurable con validación cruzada |

## En los caminos laterales

Donde la PII se escapa sin querer:

| Camino | Control |
|---|---|
| Logs | `redactSensitiveText` |
| Payloads persistidos | `redactSensitiveObject` |
| **SQL en logs** | **Prohibido** — Sequelize inlinea valores |
| Respuestas HTTP | Mapper a DTO; ningún modelo Sequelize sale al transporte |
| Sobrelectura | Gate `yarn check:overfetching` |
| Subidas | Antimalware antes de almacenar |

## Minimización grabada en el esquema

`CHECK ck_on_device_no_raw_contacts_or_sms` sobre `on_device_computation_runs` exige `raw_contacts_stored IS FALSE AND raw_sms_stored IS FALSE`.

Convierte una política de privacidad —"no exfiltramos la agenda ni los mensajes"— en algo que la base de datos **rechaza**. No depende de revisiones de código ni de que nadie se acuerde.

## Búsqueda sin descifrar

El patrón hash + cifrado + fragmento permite buscar por igualdad y mostrar listados sin descifrar nada. Ver [[05-data/sensitive-data]].

## Relaciones

- [[05-data/sensitive-data]] · [[08-security/secrets-management]] · [[05-data/retention-and-deletion]]
