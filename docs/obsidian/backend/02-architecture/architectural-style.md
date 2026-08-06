---
title: "Estilo arquitectónico"
type: "architecture"
status: "verified"
owner: "unknown"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - architecture
aliases: []
related: []
---

# Estilo arquitectónico

## La etiqueta honesta

**Monolito modular en capas, con separación de roles de ejecución y mensajería interna por outbox.**

No es DDD táctico puro, ni arquitectura hexagonal completa, ni microservicios. Documentar la arquitectura real importa más que forzar una etiqueta.

## Qué hay de cada estilo

| Estilo | Presente | Evidencia |
|---|---|---|
| **Monolito modular** | Sí, dominante | Un artefacto, un `AppModule`, 28 módulos con dependencias declaradas y grafo acíclico |
| **Arquitectura en capas** | Sí, uniforme | `controller → service → repository → mapper → DTO` en los 28 módulos |
| **Separación por dominios** | Parcial | 12 esquemas físicos separados, pero 153 FK los cruzan |
| **Hexagonal / puertos y adaptadores** | Solo en `external-data` | Es el único módulo con `domain/` (interfaz `ExternalProviderAdapter`), `application/` e `infrastructure/adapters/` |
| **Transactional outbox** | Sí | `platform_ops.outbox_events` + job `process_outbox` |
| **CQRS** | Parcial, solo lectura | Modelo de lectura separado (`read_api`, 7 vistas `v_*_v1`) y pool de lectura propio; **no** hay handlers de comando/consulta separados |
| **Event sourcing** | No | Los eventos notifican; no reconstruyen estado. Las tablas `*_events` son bitácoras, no la fuente de verdad |
| **Microservicios** | No | Un despliegue, una base de datos transaccional |

## Inconsistencias reales

> [!warning] La hexagonalidad no es uniforme
> `external-data` separa dominio, aplicación e infraestructura con una interfaz de adaptador explícita. Los otros 27 módulos usan el patrón plano de NestJS (`service` + `repository` en la misma carpeta). No es un defecto —el módulo que habla con 9 proveedores externos gana más con esa separación que un CRUD—, pero significa que **no existe un único patrón interno de módulo**: al abrir uno hay que mirar si tiene subcarpetas.

> [!warning] `platform_ops` es un cajón de sastre
> Con **25 tablas** es el esquema más grande, y mezcla responsabilidades que no comparten ciclo de vida: infraestructura de ejecución (`idempotency_keys`, `outbox_events`, `system_job_runs`), catálogos autodescriptivos del sistema (`system_endpoint_catalog`, `system_data_field_catalog`, …), motor de flujos de trabajo (`workflow_*`) y versionado de esquema (`schema_*`).
>
> Cuatro subdominios en un esquema. Ver [[14-audits/risks-register|ARCH-002]].

## Lo que sí es consistente

`VERIFICADO` — se cumple sin excepciones detectadas:

- **Grafo de módulos acíclico.** Cero `forwardRef` en `src/`.
- **Una sola librería de validación.** Zod, desde el entorno hasta el contrato OpenAPI.
- **Ningún modelo Sequelize sale al transporte.** Siempre pasa por mapper a DTO.
- **Una sola fuente de verdad por concepto transversal.** El vocabulario de roles, el mapa tabla→esquema y el catálogo de jobs existen una vez cada uno, y el código documenta que antes estaban duplicados.
- **Configuración validada al arrancar**, no leída *ad hoc* con `process.env` por ahí.

## Dirección de dependencias

Permitida y respetada:

```
modules/*  →  common/*  →  config/*
modules/*  →  database/models
common/*   ↛  modules/*        (lo transversal no conoce dominios)
```

`VERIFICADO` — `src/common/` no importa de `src/modules/`. Es lo que hace que "transversal" signifique algo.

## Evolución previsible

Si el sistema necesitara separarse, los módulos hoja (`Audit`, `CatalogManagement`, `DataQuality`, `LogSync`, `SchemaManagement`) son los candidatos: no dependen de otros módulos de negocio. El obstáculo no es el código sino las FK cruzadas, que habría que sustituir por validación en aplicación.

## Relaciones

- [[02-architecture/architecture-overview]] · [[02-architecture/module-boundaries]] · [[02-architecture/architecture-risks]]
