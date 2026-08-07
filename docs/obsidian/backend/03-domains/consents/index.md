---
title: "consents"
type: "domain"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "670e9b2"
domain: "consents"
module: "ConsentsModule"
tags:
  - "backend"
  - "domain"
  - "module/consents"
source_files:
  - "src/modules/consents/consents.module.ts"
  - "src/modules/consents/consents.controller.ts"
endpoints:
  - "GET /consent-documents/active"
dependencies:
  - "CustomersModule"
---
# Módulo `consents`

Esta pieza demuestra qué tratamiento de datos aceptó o rechazó cada cliente y bajo qué versión legal.

**Papel técnico:** registra decisiones y eventos de consentimiento con separación entre DTO, reglas y persistencia.

| | |
|---|---|
| Clase | `ConsentsModule` |
| Archivos | 7 |
| Controllers | 1 |
| Rutas HTTP | 1 (**1 públicas**) |
| Modelos usados | 3 |
| Esquemas de datos | [[privacy-schema\|privacy]] |

## Entradas

1 rutas HTTP. Contrato completo en [[04-api/rest/consents\|consents]].

| Método | Ruta | Auth | Roles |
|---|---|---|---|
| `GET` | `/consent-documents/active` | 🔓 | — |

## Salidas y efectos

Persiste en 3 tabla(s):

- [[consent_documents]] (`privacy`)
- [[consent_events]] (`privacy`)
- [[customer_consents]] (`privacy`)

## Dependencias

**Depende de:** [[03-domains/customers/index\|customers]]

**Del que dependen:** [[03-domains/customer-onboarding/index\|customer-onboarding]], [[03-domains/customer-privacy/index\|customer-privacy]]

**Exporta:** `ConsentsRepository`

> [!warning] Exporta un repositorio
> Otros módulos pueden llegar a la persistencia de este dominio sin pasar por su servicio, saltándose las reglas que vivan ahí. La regla del proyecto solo lo admite con necesidad transaccional real y documentada.

## Estructura interna

| Capa | Archivos |
|---|---|
| Controllers | `consents.controller.ts` |
| Services | `consents.service.ts` |
| Repositories | `consents.repository.ts` |
| Esquemas Zod | `consents.schemas.ts` |
| Mappers | `consents.mapper.ts` |

## Autorización

Sin rutas HTTP: no aplica autorización de transporte.

> [!danger] Superficie pública
> 1 ruta(s) sin JWT: `GET /consent-documents/active`.

## Pruebas

3 archivo(s) de test:

- `test/unit/consents/consents.controller.spec.ts`
- `test/unit/consents/consents.repository.spec.ts`
- `test/unit/consents/consents.service.spec.ts`

## Referencias al código

- Módulo: [`src/modules/consents/consents.module.ts`](../../../../../src/modules/consents/consents.module.ts)
- Controller `ConsentsController`: [`src/modules/consents/consents.controller.ts`](../../../../../src/modules/consents/consents.controller.ts)

## Relaciones

- [[03-domains/index]] · [[02-architecture/dependency-map]] · [[13-change-impact/dependency-impact-map]]
