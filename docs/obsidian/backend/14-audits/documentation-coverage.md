---
title: "Cobertura documental"
type: "audit"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - audit
aliases: []
related: []
---
# Cobertura documental

## Método

Cobertura = **elementos con nota propia ÷ elementos detectados por análisis estático**. Mide *presencia*, no calidad ni profundidad. Los porcentajes de las áreas narrativas son un **juicio**, no una medición: se marcan como tal.

## Cobertura medible

| Área | Documentado | Detectado | Cobertura | Método |
|---|---:|---:|---:|---|
| Entidades de datos | 130 | 130 | **100 %** | Una nota por tabla, con atributos, relaciones e índices |
| Módulos de negocio | 27 | 27 | **100 %** | Una nota por módulo |
| Grupos de API | 35 | 35 | **100 %** | Una nota por etiqueta OpenAPI |
| Endpoints en catálogo | 266 | 266 | **100 %** | Tabla completa; **no** hay una nota por endpoint |
| Variables de entorno | 159 | 159 | **100 %** | Catálogo con tipo, obligatoriedad y default |
| Tipos de evento | 92 | 92 | **100 %** | Catálogo por familia |
| Migraciones | 61 | 61 | **100 %** | Listado con propósito y reversibilidad |
| Relaciones (FK) | 244 | 244 | **100 %** | Catálogo con cardinalidad y política de borrado |
| ADR | 7 | 7 | **100 %** | Resumen + enlace al canónico |

> [!info] Cobertura ≠ profundidad
> Los endpoints están al 100 % **en catálogo** (método, ruta, auth, roles, códigos), no con una nota por endpoint con ejemplos de petición y respuesta. Fue deliberado: 266 notas de endpoint duplicarían el contrato OpenAPI, que ya es generado y verificado por gate. La documentación por capas está en [[04-api/index]].

## Cobertura por juicio

Estas cifras son estimaciones basadas en si el área tiene nota propia, con evidencia citada y modos de fallo descritos:

| Área | Estimación | Qué falta |
|---|---|---|
| Arquitectura | **Alta** | ADR de la separación en esquemas y del patrón de PII |
| Datos | **Alta** | Volumetría; medición de rendimiento |
| Seguridad | **Alta** | Verificación en entorno; `yarn audit` (SSRF ya resuelto) |
| API | **Buena** | Ejemplos de petición/respuesta por endpoint |
| Asíncrono | **Alta** | — (orden y dead-letter resueltos en la segunda pasada) |
| Integraciones | **Media** | Una nota por proveedor; contratos reales |
| Observabilidad | **Media** | SLO, alertas y dashboards no existen en el repositorio |
| Operación | **Media** | Backup, recuperación, RPO/RTO no definidos |
| Calidad | **Media** | Sin porcentaje de cobertura de código |
| Desarrollo | **Alta** | — |

## Volumen

| | |
|---|---|
| Notas | 330 |
| Palabras aproximadas | ~177 000 |
| Tamaño | ~1,3 MB |
| Enlaces internos distintos | 331 |
| Enlaces rotos | **0** |
| Notas huérfanas | **0** |
| Notas sin frontmatter | **0** |

El detalle vivo está en [[_meta/link-audit]], que se regenera recorriendo la bóveda.

## Lo que sigue sin cubrirse

Por naturaleza del método (análisis estático, sin ejecución):

1. Cobertura de código real
2. Rendimiento medido
3. Volumetría
4. Estado del esquema desplegado
5. SLO acordados
6. Si la protección de rama que exige revisión del propietario está activa en GitHub

Ver [[01-overview/assumptions-and-gaps]].

## Relaciones

- [[14-audits/risks-register]] · [[14-audits/contradictions]] · [[_meta/link-audit]]
