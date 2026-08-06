# Informe antes/después

## Estado: sin optimizaciones aceptadas

No hay ninguna fila en las tablas de abajo. No es un descuido: **no se aplicó ninguna optimización**,
porque no hay baseline contra el que comparar. Un cambio de rendimiento sin medición previa no se
puede aceptar ni rechazar, sólo creer, y eso no es lo que este documento certifica.

Los riesgos identificados están en [02-bottleneck-map.md](02-bottleneck-map.md) y el orden previsto
para atacarlos en [03-optimization-plan.md](03-optimization-plan.md).

## Plantilla por optimización

Cada cambio aceptado añade una sección con esta forma. Sin las ocho respuestas, el cambio no se
considera aceptado.

### [ID] · Título

**Riesgo que resuelve:** R-XX
**Commit:** `<sha>`

| Métrica | Antes | Después | Cambio | Condiciones |
|---|---:|---:|---:|---|
| p50 | | | | |
| p95 | | | | |
| p99 | | | | |
| Throughput | | | | |
| Tasa de error | | | | |
| CPU | | | | |
| Memoria (RSS / heap) | | | | |
| Tiempo en DB | | | | |
| Espera de pool | | | | |

**Condiciones de la medición:** escenario, dataset, host o límites del contenedor, repeticiones.

Las ocho preguntas:

1. ¿Qué problema **medido** resuelve?
2. ¿Dónde se consumía el tiempo o el recurso? (perfil o traza que lo demuestre)
3. ¿Cuál era la causa raíz?
4. ¿Qué alternativas se consideraron?
5. ¿Por qué se eligió esta?
6. ¿Cuál fue el resultado antes/después?
7. ¿Qué riesgo o compromiso introduce?
8. ¿Cómo se evita la regresión? (gate, umbral, alerta)

**Métricas que empeoraron:** listarlas siempre. Un cambio que mejora el p95 y empeora el uso de
memoria es un intercambio legítimo, pero tiene que estar escrito.

**Pruebas funcionales ejecutadas:** qué gates corrieron y con qué resultado.

## Reglas para llenar este documento

- Nunca seleccionar la corrida más favorable. Se reportan las tres y se explica la dispersión.
- Comparar condiciones equivalentes: mismo escenario, mismo dataset, mismo host, misma mezcla.
- Si la mezcla de flujos cambió entre las dos mediciones, no son comparables. Decirlo en vez de
  presentar la tabla.
- Una mejora que no se reproduce en tres corridas no es una mejora, es ruido.
