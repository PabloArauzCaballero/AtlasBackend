---
title: "Modelo físico de datos"
type: "data"
status: "verified"
owner: "unknown"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - data
  - model
aliases: []
related: []
---
# Modelo físico de datos

La implementación real en PostgreSQL: 130 tablas, 2 040 columnas, 244 FK, 290 índices, 12 esquemas.

## Tipos en uso

| Tipo | Uso típico |
|---|---|
| `BIGINT` | PK, FK, `_tenant_id` — declarados `string` en TypeScript |
| `STRING(n)` | Códigos, estados, hashes (128), fragmentos (4) |
| `TEXT` | Texto libre, notas |
| `JSONB` | Payloads de evento, respuestas de proveedor, configuración |
| `BLOB` | PII cifrada |
| `DATE` | Marcas de tiempo |
| `BOOLEAN` | Banderas, incluido `_deleted` |
| `UUID` | Identificadores públicos |
| `INET` | Direcciones IP |
| `DECIMAL(p,s)` | Importes y puntuaciones |

Distribución completa en [[05-data/data-dictionary]].

> [!warning] `BIGINT` y precisión en JavaScript
> Todas las PK/FK son `BIGINT` y los modelos las declaran `declare id: string`. `BIGINT` excede `Number.MAX_SAFE_INTEGER`: tratarlas como `number` perdería precisión **en silencio**, sin error, produciendo ids que no corresponden a ninguna fila. Cualquier código nuevo debe tratarlas como cadenas.

## Convenciones de columna

| Columna | Tipo | Presente en | Significado |
|---|---|---|---|
| `_id` | `BIGINT` PK autoincremental | todas | Clave sustituta |
| `_tenant_id` | `BIGINT` FK → `iam.tenants` | 59 tablas la referencian | Discriminador de tenant |
| `_created_at` | `DATE NOT NULL` | casi todas | Creación |
| `_updated_at` | `DATE` | casi todas | Última modificación |
| `_deleted` | `BOOLEAN` | mayoría | Borrado lógico; `NOT NULL` desde `20260721120000` |

`timestamps: false` en todos los `@Table`: Atlas gestiona sus propias marcas en vez de las `createdAt`/`updatedAt` de Sequelize.

## Índices

290 declarados. Estrategia observada:

1. `_tenant_id` en casi toda tabla — el filtro presente en cualquier consulta multi-tenant.
2. Índices parciales `WHERE _deleted = false` donde hay borrado lógico: no se indexa lo que nunca se consulta.
3. Compuestos para listados paginados: `(_tenant_id, happened_at DESC, _id DESC)`.
4. `GIN` para columnas `JSONB` consultadas por contenido.
5. Únicos, a veces parciales, para claves naturales.

> [!warning] PERF-001 — 168 FK sin índice en el lado hijo
> La estrategia cubre el tenant y los listados, pero **no** las columnas FK de negocio. PostgreSQL no las indexa solo. Riesgo estático, sin medición. Ver [[14-audits/risks-register]].

## Restricciones CHECK

Declaradas vía `addChecks`:

| Tabla | Restricción | Regla |
|---|---|---|
| `evidence_documents` | `ck_evidence_document_not_orphan` | `customer_id IS NOT NULL OR uploaded_from_session_id IS NOT NULL` |
| `on_device_computation_runs` | `ck_on_device_no_raw_contacts_or_sms` | `raw_contacts_stored IS FALSE AND raw_sms_stored IS FALSE` |
| `risk_assessment_runs` | `ck_risk_assessment_subject_present` | La evaluación debe tener sujeto |

Más los CHECK creados con SQL crudo en migraciones posteriores (lifecycle de cliente, `_deleted NOT NULL`).

## Vistas

7 en `read_api`, versionadas en el nombre, más `audit_event_feed`. Ver [[05-data/schemas]].

## Idempotencia del DDL

`constraintExists()` antes de cada FK/CHECK e `IF NOT EXISTS` en cada índice: re-ejecutar una migración sobre un esquema ya migrado no falla. Ver [[05-data/migrations]].

## Relaciones

- [[05-data/schemas]] · [[05-data/logical-data-model]] · [[05-data/migrations]] · [[15-reference/entity-catalog]]
