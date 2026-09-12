---
title: "Modelo lógico de datos"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
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
# Modelo lógico de datos

Estructura independiente de detalles físicos: entidades, atributos, claves, cardinalidades e integridad.

## Identidad

| Aspecto | Decisión |
|---|---|
| Clave primaria | Sustituta: `_id`, entero grande autoincremental |
| Clave natural | Cuando existe, va aparte: `customer_code`, `customer_uuid` |
| Identificador público | `*_uuid` o `*_code` — **nunca** el `_id` |

> [!info] Por qué la PK no se expone
> Un `_id` secuencial revela volumen y permite enumerar (`/customers/1`, `/2`, …). Exponer un UUID o un código rompe esa correlación. La PK sigue siendo un entero porque es más compacta y rápida para índices y FK; simplemente no sale al exterior.

## Tipos de entidad

| Tipo | Ejemplos |
|---|---|
| **Raíz de agregado** | [[customers]], [[credit_applications]], [[risk_assessment_runs]], [[fraud_cases]] |
| **Dependiente** | [[customer_addresses]], [[customer_contact_methods]] |
| **Evento / bitácora** | [[customer_status_events]], [[auth_events]], [[consent_events]], [[credit_application_events]] |
| **Versión / histórico** | [[customer_profile_versions]], [[customer_address_versions]], [[context_catalog_versions]] |
| **Catálogo / dato maestro** | [[credit_products]], [[internal_roles]], [[feature_definitions]], [[event_definitions]] |
| **Asociativa** | [[internal_user_roles]], [[internal_role_permissions]], [[customer_device_links]] |
| **Proyección de lectura** | Las 7 vistas `read_api.v_*_v1` |
| **Infraestructura** | [[outbox_events]], [[idempotency_keys]], [[system_job_runs]] |

## Versionado explícito

Varias entidades separan *el estado actual* de *su historia*: `customers.current_profile_version_id` apunta a la versión vigente en `customer_profile_versions`, y cada versión declara a cuál sustituye (`supersedes_version_id`, autorrelación).

Permite responder "¿qué sabíamos de este cliente cuando se tomó la decisión?" — imprescindible cuando una decisión de crédito debe poder auditarse a posteriori.

## Cardinalidad y opcionalidad

Se derivan de la nulabilidad de la FK, sin excepción:

| FK | Cardinalidad | Al borrar el padre |
|---|---|---|
| `allowNull: false` | 1..N → 1..1 | `RESTRICT` |
| `allowNull: true` | 0..N → 0..1 | `SET NULL` |

## Integridad

| Nivel | Mecanismo |
|---|---|
| Entidad | PK sustituta; `NOT NULL` en atributos obligatorios |
| Referencial | 244 FK; `onUpdate: CASCADE` |
| Dominio | `CHECK` (lifecycle, evidencia no huérfana, sujeto de evaluación, no-raw-contacts) |
| Unicidad | Índices únicos, algunos parciales (`WHERE _deleted = false`) |
| Aplicación | Esquemas Zod en el borde |

> [!info] Unicidad parcial y borrado lógico
> Índices como `UNIQUE … WHERE _deleted = false` permiten reutilizar un valor único después de un borrado lógico. Sin el filtro parcial, una fila borrada seguiría bloqueando su código o identificador para siempre.

## Normalización

Predominantemente normalizado. Desnormalizaciones deliberadas y documentadas:

- `customers.credit_eligibility_status` — caché del estado derivado; el modelo declara que **la fuente de verdad es el cálculo del servicio**, no la columna.
- `customers.current_profile_version_id` — puntero a la versión vigente para evitar un `MAX()` por consulta.
- `customer_activity_summaries`, `onboarding_behavior_summaries` — agregados precalculados.

Cada una intercambia consistencia por latencia de lectura, y ninguna es la fuente de verdad.

## Relaciones

- [[05-data/conceptual-data-model]] · [[05-data/physical-data-model]] · [[05-data/relationship-catalog]]
