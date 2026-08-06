---
title: "Esquemas físicos"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - data
  - schemas
source_files:
  - "src/database/domain-schemas.ts"
aliases: []
related: []
---

# Esquemas físicos

PostgreSQL organiza las 130 tablas en **12 esquemas de dominio**, más `read_api` (modelo de lectura) y `public` (reservado a infraestructura).

## Una sola fuente de verdad

> [!info] Verificado
> `ATLAS_DOMAIN_TABLES` en [`src/database/domain-schemas.ts`](../../../src/database/domain-schemas.ts) mapea cada tabla a su esquema. Los modelos no lo declaran a mano: escriben `schema: atlasSchemaFor('customers')`.
>
> `atlasSchemaFor()` **lanza** si la tabla no está registrada. Es imposible que un modelo nuevo resuelva a un esquema por accidente o quede en `public` sin que alguien lo note. La misma constante la comparten los decoradores de modelo y la migración que movió las instalaciones existentes: no hay dos fuentes que puedan divergir.

## Los 12 esquemas

| Esquema | Tablas | Dominio | Nota |
|---|---:|---|---|
| `platform_ops` | 25 | Operación de plataforma | [[platform_ops-schema]] |
| `telemetry` | 18 | Telemetría, dispositivos y sesiones | [[telemetry-schema]] |
| `catalog` | 15 | Catálogo y contexto | [[catalog-schema]] |
| `risk` | 14 | Riesgo y *features* | [[risk-schema]] |
| `customer` | 12 | Clientes e identidad | [[customer-schema]] |
| `privacy` | 11 | Privacidad y consentimiento | [[privacy-schema]] |
| `iam` | 10 | Identidad y acceso | [[iam-schema]] |
| `case_management` | 6 | Casos y fraude | [[case_management-schema]] |
| `integrations` | 6 | Integraciones externas | [[integrations-schema]] |
| `audit` | 5 | Auditoría y calidad | [[audit-schema]] |
| `messaging` | 5 | Mensajería | [[messaging-schema]] |
| `credit` | 3 | Crédito | [[credit-schema]] |

## `public` está reservado

Ningún modelo de negocio resuelve a `public`. Queda para el tracking de migraciones de Umzug y la compatibilidad de infraestructura. Es lo que permite distinguir *"tabla del sistema"* de *"tabla de negocio"* sin depender del nombre.

## `read_api` — el modelo de lectura

7 vistas versionadas que aíslan a los consumidores de la forma física de las tablas:

`v_customer_overview_v1` · `v_risk_assessment_summary_v1` · `v_operations_work_queue_v1` · `v_provider_health_latest_v1` · `v_notification_delivery_summary_v1` · `v_system_endpoint_coverage_v1` · `v_audit_event_feed_v1`

El sufijo `_v1` permite publicar una `_v2` y migrar consumidores sin romper a nadie. Gate asociado: `yarn check:read-api-views`.

## Dos `search_path`, no uno

```
ATLAS_RUNTIME_SEARCH_PATH   = [12 dominios] + read_api + public
ATLAS_MIGRATION_SEARCH_PATH = public + [12 dominios] + read_api
```

La inversión es deliberada: las migraciones necesitan resolver primero el tracking de Umzug en `public`; el runtime necesita resolver primero sus tablas de dominio.

## Separación de identidades PostgreSQL

| Identidad | Variable | Privilegios |
|---|---|---|
| Runtime | `DB_USER` / `DB_PASSWORD` | DML sobre las tablas de dominio |
| Migración | `DB_MIGRATION_USER` | DDL |

El proceso que atiende tráfico **no tiene privilegios de DDL**. Verificable con `yarn check:db-privileges`; se aprovisiona con `yarn db:roles:bootstrap`. Detalle en `docs/database/postgres-roles.md`.

## Lo que la separación NO da

> [!warning] El límite es lógico
> Los 12 esquemas viven en la **misma base de datos**, comparten transacciones y **153 de 244 FK los cruzan**. Separar un dominio en su propia base exigiría sustituir esas FK por validación en aplicación. Ver [[14-audits/risks-register|ARCH-001]].

## Relaciones

- [[05-data/data-architecture]] · [[05-data/physical-data-model]] · [[15-reference/entity-catalog]] · [[05-data/relationship-catalog]]
