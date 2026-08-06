---
title: "Mapa de navegación"
type: "overview"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - navigation
aliases: []
related: []
---
# Mapa de navegación

## Por pregunta

| Pregunta | Nota |
|---|---|
| ¿Qué es Atlas y qué hace? | [[01-overview/project-overview]] |
| ¿Cómo lo levanto? | [[00-home/quick-start]] · [[12-development/local-setup]] |
| ¿Cómo está organizado el código? | [[01-overview/repository-map]] |
| ¿Cuál es la arquitectura? | [[02-architecture/architecture-overview]] |
| ¿Qué módulos hay? | [[03-domains/index]] |
| ¿Qué endpoints existen? | [[15-reference/endpoint-catalog]] |
| ¿Qué tablas hay y cómo se relacionan? | [[15-reference/entity-catalog]] · [[05-data/relationship-catalog]] |
| ¿Qué significa este campo? | [[05-data/data-dictionary]] |
| ¿Cómo se autentica y autoriza? | [[08-security/authentication]] · [[08-security/authorization]] |
| ¿Quién puede llamar a qué? | [[15-reference/permissions-matrix]] |
| ¿Qué variables de entorno hay? | [[15-reference/environment-variables]] |
| ¿Qué eventos existen? | [[15-reference/events-catalog]] |
| ¿Qué corre solo y cada cuánto? | [[07-async-processing/schedulers]] |
| ¿Cómo se despliega? | [[10-operations/deployment]] |
| Algo está roto en producción | [[10-operations/runbooks/index]] |
| Algo está roto en local | [[12-development/troubleshooting]] |
| Voy a cambiar algo, ¿qué rompo? | [[13-change-impact/dependency-impact-map]] |
| ¿Qué riesgos conocidos hay? | [[14-audits/risks-register]] |
| ¿En qué se contradice la documentación? | [[14-audits/contradictions]] |
| ¿Qué NO sabe esta bóveda? | [[01-overview/assumptions-and-gaps]] |

## Por tag de Obsidian

| Tag | Qué agrupa |
|---|---|
| `#backend/data` o `data` | Todo lo de datos |
| `#entity` | Las 130 notas de entidad |
| `#schema/<nombre>` | Entidades de un esquema concreto |
| `#module/<nombre>` | Notas de un módulo |
| `#tag/<nombre>` | Notas de API por etiqueta |
| `#security` | Seguridad |
| `#runbook` | Procedimientos operativos |
| `#adr` | Decisiones de arquitectura |
| `#audit` | Hallazgos y riesgos |

## Consultas útiles

Con el complemento Dataview, el frontmatter permite consultas como:

```dataview
TABLE criticality, schema
FROM #entity
WHERE criticality = "critical"
```

```dataview
TABLE criticality, status
FROM "03-domains"
SORT criticality DESC
```

## Relaciones

- [[00-home/index]] · [[00-home/executive-summary]]
