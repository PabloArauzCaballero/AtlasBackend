---
title: "Diccionario de datos"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - "backend"
  - "data"
  - "dictionary"
---
# Diccionario de datos

**2040 atributos** en **130 tablas** y **953 nombres de campo distintos**.

El detalle por entidad vive en su nota: [[15-reference/entity-catalog|catálogo de entidades]]. Esta nota documenta las **convenciones transversales**, que es lo que no se puede leer tabla por tabla.

## Convenciones de nombres

> [!info] Verificado
> El prefijo `_` marca columnas **de plataforma**, no de negocio. Aparecen en casi todas las tablas y tienen el mismo significado en todas:

| Campo | Presente en | Tipo | Significado |
|---|---:|---|---|
| `_id` | 129 tablas | BIGINT | Clave primaria sustituta, `BIGINT` autoincremental. No se expone como identificador público. |
| `_tenant_id` | 78 tablas | BIGINT | Discriminador de tenant. Toda consulta multi-tenant debe filtrarlo. |
| `_created_at` | 128 tablas | DATE | Marca de creación. Mapeado a `createdAtValue` (los modelos usan `timestamps: false`). |
| `_updated_at` | 66 tablas | DATE | Marca de última modificación. |
| `_deleted` | 22 tablas | BOOLEAN | Borrado lógico. Las lecturas deben excluir `true`. |

`timestamps: false` en todos los `@Table`: Atlas gestiona las marcas de tiempo con sus propias columnas `_created_at`/`_updated_at` en vez de las `createdAt`/`updatedAt` de Sequelize.

## Sufijos con significado de seguridad

| Sufijo | Ocurrencias | Significado |
|---|---:|---|
| `*_encrypted` | 7 | Valor de PII cifrado con *envelope encryption* (`BLOB`). Ver [[08-security/data-protection]]. |
| `*_hash` | 34 | Hash determinista para búsqueda por igualdad sin descifrar. |
| `*_last_4` / `*_last4` | 8 | Fragmento mostrable para que un operador identifique el dato sin verlo entero. |
| `*_domain` | 3 | Parte no identificatoria extraída para análisis (p. ej. dominio de email). |

> [!info] Patrón hash + cifrado + fragmento
> `customer.customers` lo aplica al teléfono y al email: `primary_phone_hash` (búsqueda), `primary_phone_encrypted` (valor real), `primary_phone_last_4` (visualización). Permite buscar y mostrar sin descifrar en masa. Ver [[customers]].

## Campos compartidos entre muchas tablas

Un cambio de forma en estos campos impacta a decenas de tablas a la vez:

| Campo | Tablas | Tipo predominante |
|---|---:|---|
| `_id` | 129 | BIGINT |
| `_created_at` | 128 | DATE |
| `_tenant_id` | 78 | BIGINT |
| `_updated_at` | 66 | DATE |
| `customer_id` | 41 | BIGINT |
| `status` | 33 | STRING(40) |
| `_deleted` | 22 | BOOLEAN |
| `session_id` | 18 | BIGINT |
| `device_id` | 17 | BIGINT |
| `is_active` | 16 | BOOLEAN |
| `notes` | 16 | TEXT |
| `description` | 16 | TEXT |
| `review_status` | 14 | STRING(40) |
| `source_type` | 11 | STRING(60) |
| `actor_type` | 10 | STRING(40) |
| `confidence_score` | 10 | DECIMAL(5, 2) |
| `onboarding_flow_id` | 10 | BIGINT |
| `reason_code` | 9 | STRING(100) |
| `risk_dimension` | 8 | STRING(60) |
| `owner_team` | 8 | STRING(80) |
| `event_type` | 8 | STRING(60) |
| `ip_address` | 8 | INET |
| `valid_from` | 8 | DATEONLY |
| `valid_until` | 8 | DATEONLY |
| `started_at` | 8 | DATE |

## Tipos físicos en uso

| Tipo | Columnas |
|---|---:|
| `STRING` | 668 |
| `BIGINT` | 471 |
| `DATE` | 340 |
| `BOOLEAN` | 172 |
| `TEXT` | 119 |
| `JSONB` | 113 |
| `INTEGER` | 68 |
| `DECIMAL` | 60 |
| `DATEONLY` | 13 |
| `INET` | 8 |
| `BLOB` | 6 |
| `UUID` | 1 |
| `FLOAT` | 1 |

> [!info] `BIGINT` como identificador en JavaScript
> Todas las PK y FK son `BIGINT`, y los modelos las declaran como `string` en TypeScript (`declare id: string`), no como `number`. Es deliberado: `BIGINT` excede `Number.MAX_SAFE_INTEGER` y pasarlo por `number` perdería precisión silenciosamente. Cualquier código nuevo debe tratar los ids como cadenas.

## Relaciones

- [[05-data/sensitive-data]] · [[05-data/logical-data-model]] · [[05-data/physical-data-model]]
