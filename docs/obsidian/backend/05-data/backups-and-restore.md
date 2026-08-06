---
title: "Copias de seguridad y restauración"
type: "runbook"
status: "draft"
owner: "unknown"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - data
  - operations
aliases: []
related: []
---
# Copias de seguridad y restauración

> [!question] Pendiente — fuera del repositorio
> **No existe procedimiento de backup ni de restauración en este código.** No hay scripts, ni configuración, ni documentación de RPO/RTO. La política vive —si existe— en la plataforma que opera PostgreSQL.
>
> Esta nota registra qué habría que documentar, no lo que hay.

## Qué hay que respaldar

| Almacén | Contenido | Criticidad | Si se pierde |
|---|---|---|---|
| PostgreSQL | 130 tablas: la fuente de verdad | **Crítica** | Pérdida total del negocio |
| S3 | Documentos de evidencia | Alta | Se pierde el respaldo de verificaciones |
| Redis | Efímero | Baja | Se reconstruye solo |
| MongoDB | Logs sincronizados | Media | Se pierde histórico de logs, no datos de negocio |

## Lo que sí está resuelto en el código

| Aspecto | Estado |
|---|---|
| Reconstruir el esquema desde cero | `yarn db:migration:up` — 61 migraciones |
| Datos maestros mínimos | `yarn db:seed:prod`, idempotente y verificable |
| Verificar integridad de seeds | `yarn db:seed:verify-graph` |

Es decir: **el esquema y los datos maestros son reproducibles**; los datos de negocio no.

## Qué falta definir

- [ ] Frecuencia y retención de las copias
- [ ] **RPO** — cuántos datos se acepta perder
- [ ] **RTO** — en cuánto tiempo se restaura
- [ ] Procedimiento de restauración probado (una copia no verificada no es una copia)
- [ ] Cifrado de las copias
- [ ] Backup de la clave KMS o su política de recuperación
- [ ] Restauración parcial (una tabla, un tenant)

> [!danger] La clave de cifrado es parte del backup
> Restaurar PostgreSQL **sin** poder descifrar la PII deja los datos ilegibles. Si la clave maestra se deriva de una variable de entorno (modo sin KMS), esa variable es tan crítica como la copia misma. Ver [[08-security/data-protection]].

## Relaciones

- [[05-data/data-stores]] · [[10-operations/disaster-recovery]] · [[05-data/retention-and-deletion]]
