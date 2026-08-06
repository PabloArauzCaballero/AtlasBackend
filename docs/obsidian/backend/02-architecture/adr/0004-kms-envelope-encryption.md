---
title: "ADR — Envelope encryption con KMS para PII"
type: "adr"
status: "verified"
owner: "unknown"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - architecture
  - adr
aliases: []
related: []
---
# Envelope encryption con KMS para PII

> [!info] Documento canónico
> El ADR completo vive en [`docs/adr/0004-kms-envelope-encryption.md`](../../../adr/0004-kms-envelope-encryption.md). Esta nota lo resume y lo enlaza con el resto de la bóveda; **ante discrepancia, prevalece el canónico**.

| | |
|---|---|
| Estado | Aceptado |
| Fecha | 2026-07-16 |
| Decisores | equipo backend |

## Contexto

La PII debe cifrarse en reposo con una clave que no viva junto a los datos.

## Decisión

Envelope encryption: una *data key* cifra el valor y la clave maestra cifra la data key. `KmsKeyProvider` se activa si `KMS_KEY_ID` + `AWS_REGION` están presentes; en caso contrario se usa el proveedor `local`. El `providerId` va embebido en cada valor.

## Alternativas consideradas

Cifrado directo con clave única — imposibilita rotar sin descifrar todo.

## Consecuencias

Sin KMS en producción la clave maestra se deriva de una variable de entorno — ver [[14-audits/risks-register|SEC-002]].

## Relaciones

- [[08-security/data-protection]]
- [[05-data/sensitive-data]]
