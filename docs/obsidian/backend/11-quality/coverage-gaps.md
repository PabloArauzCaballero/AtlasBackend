---
title: "Vacíos de cobertura"
type: "audit"
status: "verified"
owner: "unknown"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - quality
aliases: []
related: []
---
# Vacíos de cobertura

> [!warning] Método
> Esta nota **no** reporta porcentaje de líneas cubiertas: `yarn test:coverage` no se ejecutó en esta revisión. Lo que sigue es un cruce entre los 304 archivos de test y los 28 módulos, por nombre y ruta. Es un indicador de **presencia**, no de calidad ni de profundidad.

## Método

Un módulo cuenta como "con pruebas" si existe algún archivo bajo `test/` cuya ruta menciona su nombre. Eso sobreestima: un archivo puede existir y cubrir un solo caso.

## Cobertura por módulo

El detalle está en la sección **Pruebas** de cada nota de módulo en [[03-domains/index]]. Los módulos sin coincidencia aparecen marcados con `RIESGO` en su propia nota.

## Vacíos estructurales

Independientes del recuento:

| Vacío | Consecuencia |
|---|---|
| **Sin porcentaje de cobertura publicado** | No se puede afirmar dónde falta profundidad. El trinquete existe (`docs/testing/coverage-ratchet.md`) pero su valor actual no está en esta bóveda |
| **Sin pruebas de carga con umbral** | `stress:notifications` existe, pero no hay criterio de aprobado/fallo |
| **Sin verificación de las 168 FK sin índice** | El impacto de PERF-001 no está medido |
| **Smokes exigen backend levantado** | No corren en CI sin infraestructura; su ejecución depende del entorno |
| **Contratos externos sin validar contra sandbox** | Los adaptadores se prueban contra un mock propio |
| **Sin pruebas del camino de apagado** | El drenado y el orden de cierre no tienen cobertura automatizada detectada |

## Áreas de mayor riesgo si fallan sin cobertura

Por criticidad, no por ausencia comprobada:

1. **Cifrado de PII** — un fallo silencioso deja datos en claro o ilegibles.
2. **Guards** — un fallo abre acceso indebido.
3. **Idempotencia** — un fallo duplica comandos de negocio.
4. **Rescate de eventos atascados** — un fallo devuelve la pérdida silenciosa que el diseño cerró.
5. **Retención** — un fallo incumple obligaciones de privacidad.

## Cómo cerrar el vacío principal

```bash
yarn test:coverage
```

y registrar el resultado aquí, con fecha y revisión.

## Relaciones

- [[11-quality/testing-strategy]] · [[14-audits/technical-debt]] · [[01-overview/assumptions-and-gaps]]
