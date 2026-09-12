---
title: "Auditoría de enlaces"
type: "reference"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "low"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - meta
aliases: []
related: []
---
# Auditoría de enlaces

Generada automáticamente sobre el estado real de la bóveda.

## Resumen

| Métrica | Valor |
|---|---:|
| Notas | 330 |
| Enlaces internos (ocurrencias) | 3866 |
| Destinos distintos | 330 |
| **Enlaces rotos** | **0** |
| Notas sin enlaces entrantes | 0 |
| Notas sin frontmatter | 0 |
| Notas con bloques de código desbalanceados | 0 |

> [!info] Sin enlaces rotos
> Los 330 destinos distintos resuelven a una nota existente.

## Notas más enlazadas

| Nota | Enlaces entrantes |
|---|---:|
| [[05-data/data-dictionary]] | 139 |
| [[15-reference/entity-catalog]] | 137 |
| [[05-data/schemas]] | 135 |
| [[tenants]] | 128 |
| [[14-audits/risks-register]] | 126 |
| [[08-security/authorization]] | 87 |
| [[customers]] | 86 |
| [[customer_sessions]] | 58 |
| [[devices]] | 50 |
| [[05-data/sensitive-data]] | 48 |
| [[15-reference/endpoint-catalog]] | 45 |
| [[04-api/conventions]] | 44 |
| [[04-api/error-model]] | 43 |
| [[04-api/index]] | 42 |
| [[telemetry-schema]] | 41 |

## Notas sin enlaces entrantes

Ninguna: toda nota es alcanzable desde al menos otra.





## Convención de enlaces

- **Por ruta** desde la raíz de la bóveda: `[[05-data/data-architecture]]`
- **Por nombre** para entidades y esquemas, que tienen nombre único: `[[customers]]`, `[[iam-schema]]`
- **Con alias en tablas**, escapando la barra: `[[nota\|alias]]` (el ejemplo va en código para que no cuente como enlace)

> [!info] La raíz de la bóveda es `docs/obsidian/backend/`
> Abrir `docs/obsidian/` haría que los enlaces por ruta no resuelvan.

## Cómo regenerar

Esta nota se produce recorriendo la bóveda y resolviendo cada wikilink contra las notas existentes. Volver a ejecutar tras cualquier cambio estructural.

## Relaciones

- [[_meta/generation-log]] · [[14-audits/documentation-coverage]]
