---
title: "Plantilla — entidad de datos"
type: "reference"
status: "draft"
owner: "@PabloArauzCaballero"
criticality: "low"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - template
aliases: []
related: []
---
# Plantilla — entidad de datos

Las 130 notas de `05-data/entities/` siguen esta estructura y se **generan**; editarlas a mano se perdería en la próxima regeneración. Usar las secciones manuales para añadir contexto:

```markdown
<!-- MANUAL:START -->
Notas del equipo que sobreviven a la regeneración.
<!-- MANUAL:END -->
```

## Estructura

```markdown
# \`<esquema>.<tabla>\`

## Identidad
## Definición de negocio
## Multi-tenancy
## Borrado lógico
## Atributos

| Propiedad | Campo físico | Tipo TS | Tipo físico | Requerido | Clave | Sensibilidad |
|---|---|---|---|---|---|---|

## Relaciones salientes
## Relaciones entrantes
## Índices y patrones de consulta
## Restricciones CHECK
## Evidencia y referencias
```
