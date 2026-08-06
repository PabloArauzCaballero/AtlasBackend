---
title: "Visión general del proyecto"
type: "overview"
status: "verified"
owner: "unknown"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - overview
source_files:
  - "src/main.ts"
  - "src/worker.ts"
  - "src/app.module.ts"
aliases: []
related: []
---

# Visión general del proyecto

## Propósito

Atlas es el backend de una plataforma de **originación de crédito al consumo**. Cubre el recorrido desde el registro de una persona hasta la decisión de crédito, dejando evidencia auditable de cada paso.

`INFERIDO` — el propósito no está declarado en un documento de producto dentro del repositorio; se deduce de los dominios persistidos, los módulos y los endpoints. Los comentarios `@business` de cada archivo lo respaldan de forma consistente.

## Capacidades

| Capacidad | Módulos | Esquema de datos |
|---|---|---|
| Identidad y autenticación | `auth`, `internal-users`, `sessions` | `iam` |
| Onboarding y verificación de identidad | `customer-onboarding`, `customers` | `customer` |
| Consentimientos y privacidad | `consents`, `customer-privacy` | `privacy` |
| Dispositivos, sesiones y comportamiento | `sessions`, `customer-telemetry` | `telemetry` |
| Catálogo de contexto y atributos | `catalog-management` | `catalog` |
| *Features* y motor de riesgo | `risk` | `risk` |
| Fraude y revisión manual | `fraud` | `case_management` |
| Crédito (productos y solicitudes) | `credit` | `credit` |
| Datos externos (KYC, bureau, telco, social) | `external-data` | `integrations` |
| Notificaciones multicanal | `notifications`, `mail-sender` | `messaging` |
| Auditoría y calidad de datos | `audit`, `data-quality` | `audit` |
| Operación de plataforma | `operations`, `systems-ops`, `runtime-jobs`, `internal-portal`, `workflow-catalog`, `schema-management` | `platform_ops` |

## Actores

| Actor | Rol de token | Vía de acceso |
|---|---|---|
| Cliente final | `customer` | App móvil/web → endpoints públicos de auth + endpoints por `customerId` |
| Operador interno | `internal_operator` y especializaciones (`risk_analyst`, `compliance_analyst`, `fraud_analyst`) | Portal interno |
| Administrador | `admin`, `platform_admin`, `system_admin` | Portal interno + operaciones de sistema |
| Sistemas automáticos | `system` | Planificador de jobs (`SCHEDULER_ACTOR`), llamadas máquina-a-máquina |
| Auditoría / QA / DevOps | `readonly_auditor`, `qa_engineer`, `devops` | Vistas de solo lectura y utilidades de operación |
| Comercio | `merchant` | `RIESGO` — el rol existe en el vocabulario, pero **no hay tablas de comercios**. Ver [[14-audits/contradictions]]. |

## Límites del sistema

**Dentro:** la API HTTP, el worker de fondo, el esquema PostgreSQL, la caché y el rate limiting en Redis, la sincronía de logs a MongoDB, el almacenamiento de documentos en S3 y los adaptadores hacia proveedores externos.

**Fuera:** los frontends (app de cliente y portal interno), los proveedores externos (SEGIP, InfoCenter, Meta/WhatsApp, telco, bancos), el proveedor de KMS, y toda la infraestructura de despliegue.

## Los dos procesos

> [!info] Verificado
> El mismo artefacto se despliega con dos entrypoints y una variable, `APP_ROLE`:
>
> | Rol | Entrypoint | Qué hace |
> |---|---|---|
> | `api` | `dist/src/main.js` | Atiende HTTP; **no** arranca trabajo de fondo |
> | `worker` | `dist/src/worker.js` | Instancia todos los providers **sin registrar rutas** (`createApplicationContext`); ejecuta los jobs y expone solo sonda y métricas |
> | `all` | cualquiera | Ambas cosas — el default, para dev, tests y despliegues de una sola pieza |
>
> Cada entrypoint verifica su rol y **sale con código 1** si no le corresponde. El worker levanta una sonda HTTP mínima en `WORKER_PROBE_PORT` (3006) para que el orquestador y Prometheus puedan interrogarlo. Ver [[02-architecture/runtime-topology]].

## Convenciones que atraviesan todo el código

`VERIFICADO` — se cumplen de forma consistente en los 686 archivos de `src/`:

- **Cabecera semántica.** Cada archivo abre con un bloque `@file` / `@business` / `@system` que declara su papel técnico y de negocio. Es la fuente de la que sale buena parte de esta bóveda.
- **Capas.** `controller → service → repository → mapper → DTO`. Los controladores validan con `ZodValidationPipe` y delegan; nunca devuelven modelos Sequelize al transporte.
- **Identificadores como `string`.** Todas las PK/FK son `BIGINT` y se declaran `string` en TypeScript: pasar por `number` perdería precisión en silencio.
- **Marcas de plataforma.** El prefijo `_` (`_id`, `_tenant_id`, `_created_at`, `_deleted`) distingue columnas de plataforma de columnas de negocio.
- **Comentarios que explican el *porqué*.** El código documenta decisiones y sus alternativas descartadas, no lo que ya dice la línea siguiente.

## Relaciones

- [[01-overview/technology-stack]] · [[01-overview/repository-map]] · [[01-overview/glossary]]
- [[02-architecture/architecture-overview]] · [[03-domains/index]]
