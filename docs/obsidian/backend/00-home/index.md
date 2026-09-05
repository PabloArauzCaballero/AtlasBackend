---
title: "Atlas Backend — Bóveda de documentación"
type: "overview"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - documentation
  - home
aliases:
  - "Inicio"
  - "Atlas Backend"
related: []
---

# Atlas Backend — Bóveda de documentación

Base de conocimiento técnica, operativa y funcional del backend **Atlas**: una plataforma de originación de crédito con onboarding KYC, motor de riesgo, detección de fraude y gobierno de datos.

> [!info] Cómo abrir esta bóveda
> Abre **`docs/obsidian/backend/`** como bóveda en Obsidian (no `docs/obsidian/`). Los enlaces internos usan rutas relativas a esa raíz.

> [!question] Alcance y método
> Documentación reconstruida por **análisis estático** del código en la revisión `80fc741` (rama `main`), sin ejecutar el backend ni consultar ninguna base de datos. Cada afirmación relevante está etiquetada como `VERIFICADO`, `INFERIDO`, `NO_CONFIRMADO`, `RIESGO` o `PENDIENTE`. Ver [[01-overview/assumptions-and-gaps]].

## El sistema en una pantalla

| Dimensión | Valor |
|---|---|
| Stack | Node.js ≥22 · TypeScript · NestJS 11 · Sequelize + `sequelize-typescript` |
| Almacenes | PostgreSQL (12 esquemas de dominio) · Redis · MongoDB (logs) · S3 (documentos) |
| Interfaz | REST — **266 rutas** bajo `/api/v1` |
| Persistencia | **130 tablas**, 2 040 columnas, 244 claves foráneas, 61 migraciones |
| Procesos | 2 roles del mismo artefacto: **API** y **worker** (`APP_ROLE`) |
| Trabajo de fondo | 9 jobs programados + outbox transaccional (92 tipos de evento declarados) |
| Seguridad | JWT HS256 · RBAC de 13 roles de token / 20 roles internos · multi-tenant por `_tenant_id` |
| Observabilidad | Prometheus (`/metrics`) · OpenTelemetry (opcional) · logs a archivo + sincronía a Mongo |
| Configuración | **159 variables** validadas con Zod al arrancar |
| Pruebas | 304 archivos de test · 19 scripts de smoke |

## Por dónde empezar

| Si eres… | Empieza por |
|---|---|
| Desarrollador nuevo | [[00-home/quick-start]] → [[01-overview/project-overview]] → [[12-development/local-setup]] |
| Arquitecto | [[02-architecture/architecture-overview]] → [[02-architecture/views/c4-container]] → [[02-architecture/architecture-risks]] |
| Ingeniero de datos | [[05-data/data-architecture]] → [[05-data/entity-relationship-model]] → [[05-data/data-dictionary]] |
| Seguridad / cumplimiento | [[08-security/security-overview]] → [[08-security/threat-model]] → [[05-data/sensitive-data]] |
| SRE / operación | [[10-operations/deployment]] → [[10-operations/runbooks/index]] → [[09-observability/observability-overview]] |
| QA | [[11-quality/testing-strategy]] → [[11-quality/coverage-gaps]] |
| Va a cambiar código | [[13-change-impact/change-checklists]] → [[13-change-impact/high-risk-components]] |

## Mapa de la bóveda

| Sección | Contenido |
|---|---|
| [[01-overview/project-overview\|01 · Visión general]] | Propósito, stack, mapa del repositorio, glosario, supuestos |
| [[02-architecture/architecture-overview\|02 · Arquitectura]] | Estilo, contenedores, componentes, vistas C4, dependencias, ADR |
| [[03-domains/index\|03 · Dominios]] | Los 28 módulos de negocio y sus límites |
| [[04-api/index\|04 · API]] | 266 endpoints, autenticación, convenciones, modelo de error |
| [[05-data/data-architecture\|05 · Datos]] | Modelos conceptual/lógico/físico, 130 entidades, relaciones, linaje |
| [[06-integrations/index\|06 · Integraciones]] | Proveedores externos (KYC, bureau, telco, social, pagos) |
| [[07-async-processing/events\|07 · Asíncrono]] | Outbox, jobs programados, reintentos, idempotencia |
| [[08-security/security-overview\|08 · Seguridad]] | AuthN/AuthZ, cifrado de PII, modelo de amenazas, hallazgos |
| [[09-observability/observability-overview\|09 · Observabilidad]] | Logs, métricas, trazas, health checks, correlación |
| [[10-operations/deployment\|10 · Operación]] | Entornos, despliegue, escalado, recuperación, runbooks |
| [[11-quality/testing-strategy\|11 · Calidad]] | Estrategia de pruebas, gates, cobertura |
| [[12-development/local-setup\|12 · Desarrollo]] | Puesta en marcha local, convenciones, depuración |
| [[13-change-impact/dependency-impact-map\|13 · Impacto de cambios]] | Componentes de alto riesgo y listas de verificación |
| [[14-audits/risks-register\|14 · Auditorías]] | Riesgos, deuda técnica, contradicciones, cobertura documental |
| [[15-reference/index\|15 · Referencia]] | Catálogos: endpoints, entidades, eventos, permisos, variables, comandos |
| [[templates/index\|Plantillas]] | Estructuras para añadir notas nuevas |

## Hallazgos que conviene conocer antes de tocar nada

| ID | Hallazgo | Severidad |
|---|---|---|
| [[14-audits/contradictions\|C-001]] | 40 de 92 tipos de evento describen dominios (compras, cuotas, liquidaciones) que **no tienen tablas** | Media |
| [[14-audits/risks-register\|PERF-001]] | 168 de 244 columnas FK no encabezan ningún índice | Media |
| [[14-audits/risks-register\|SEC-001]] | `TenantGuard` no **exige** `x-tenant-id`: solo rechaza si contradice al token | Media |
| [[14-audits/risks-register\|SEC-002]] | Sin `KMS_KEY_ID`, en producción la PII se cifra con clave derivada de una variable de entorno | Alta |
| [[14-audits/risks-register\|DATA-003]] | `outbox_events` no tiene purga: la tabla de mayor inserción crece sin límite | Media |
| [[14-audits/risks-register\|DATA-001]] | Ninguna FK usa `ON DELETE CASCADE`: el borrado físico de un padre con hijos es imposible por diseño | Informativo |

## Relaciones

- [[00-home/executive-summary]] · [[00-home/navigation-map]] · [[_meta/generation-log]]
