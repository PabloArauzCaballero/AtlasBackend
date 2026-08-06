---
title: "Registro de generación"
type: "reference"
status: "verified"
owner: "unknown"
criticality: "low"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - meta
aliases: []
related: []
---
# Registro de generación

## 2026-08-06 — revisión 80fc741 — modo `bootstrap`

Primera construcción de la bóveda.

### Alcance

Backend Atlas completo: 686 archivos TypeScript, 28 módulos, 266 rutas, 130 tablas, 61 migraciones.

### Método

Análisis estático por patrones sobre el árbol de fuentes. **No** se ejecutó el backend, ni las pruebas, ni ninguna consulta a base de datos.

| Elemento | Extraído de |
|---|---|
| Rutas | Decoradores `@Controller`/`@Get`/`@Post`/… |
| Modelo físico | `@Table`/`@Column` + `ATLAS_DOMAIN_TABLES` |
| Relaciones, CHECK, índices | `ForeignKeySpec`/`IndexSpec`/`CheckConstraintSpec` de las migraciones |
| Variables de entorno | Esquemas Zod |
| Eventos | `event-registry.ts` |
| Grafo de módulos | Array `imports` de cada `@Module` |

### Validación cruzada

| Comprobación | Resultado |
|---|---|
| Rutas del código ↔ operaciones OpenAPI | 266 vs 265 — la diferencia es `/metrics`, excluido a propósito |
| Tablas ↔ `ATLAS_DOMAIN_TABLES` | 130/130 resuelven esquema |
| Modelos sin columnas extraídas | 0 |
| Enlaces internos rotos | 0 |

### Añadido

- 330 notas, ~177 000 palabras
- 130 notas de entidad, 27 de módulo, 35 de grupo de API, 12 de esquema de dominio
- 7 resúmenes de ADR, 6 runbooks
- Catálogos: endpoints, entidades, relaciones, eventos, permisos, variables, comandos, errores
- Manifiesto incremental (`documentation-manifest.json`) con hash por archivo fuente

### Hallazgos registrados

10 riesgos (`SEC-001..004`, `PERF-001`, `ARCH-001..002`, `DATA-001..002`, `OPS-001`), 4 contradicciones (`C-001..004`), 10 elementos de deuda técnica.

### Limitación del método encontrada y corregida

El extractor lee decoradores por patrón, así que **no atraviesa decoradores compuestos**. Los controllers de `systems-ops` y `log-sync` aplican `@SystemsOpsControllerSecurity()`, que compone `ApiTags`, `UseGuards` y `Roles` con `applyDecorators`: 46 rutas aparecieron inicialmente sin etiqueta y sin roles, como si estuvieran desprotegidas.

Se corrigió leyendo el decorador y reescribiendo la nota ([[04-api/rest/systems-ops]]). **Al regenerar la bóveda hay que repetir esa corrección**, o enseñar al extractor a resolver decoradores compuestos.

### Limitaciones

Sin medición de rendimiento, sin cobertura de código, sin volumetría, sin verificación del esquema desplegado. Todas las notas llevan `owner: unknown`: no hay `CODEOWNERS` en el repositorio.

Detalle en [[01-overview/assumptions-and-gaps]].

### Nota de proceso

`graphify` no estaba instalado en el entorno de generación, así que no se usó el grafo de conocimiento del proyecto. La documentación se construyó leyendo las fuentes directamente.

## Próxima ejecución

Usar modo `update` o `delta`: el manifiesto guarda el hash de cada archivo fuente, así que solo hay que regenerar las notas de los archivos cambiados.

## Relaciones

- [[_meta/source-inventory]] · [[_meta/unresolved-items]] · [[_meta/link-audit]]
