# Informe antes/después

## Estado: sin optimizaciones aceptadas, y ahora se sabe por qué

Ya existe baseline ([01-baseline.md](01-baseline.md)), así que la razón cambió. No es que no se
pudiera comparar: es que **la medición no encontró nada que optimizar en la ruta medida**.

A 10 req/s el p95 es de 15 ms; a 150 req/s baja a 7.4 ms, con 0 % de error, el pool en
`using=0 waiting=0 size=4` y el event-loop lag en 12 ms. No hay saturación de pool, ni de CPU, ni
crecimiento de memoria. Aplicar cualquiera de las correcciones previstas ahora mismo produciría una
tabla antes/después con ruido en las dos columnas.

El resultado más útil de la medición fue **refutar la prioridad 1** del análisis estático: R-01
(fan-out contra tamaño del pool) no se manifiesta en la ruta de lectura. Sin baseline se habría
«optimizado» algo que no era el problema, y la tabla de abajo habría mostrado una mejora inventada
por la varianza.

A cambio apareció un hallazgo que sólo se ve midiendo: **R-06**, el logging de SQL en
`development` — 8 MB de log por corrida y PII en claro en stdout. Su corrección es de seguridad y
configuración, no de latencia, y requiere un ADR; por eso tampoco entra aquí.

Lo que falta para poder llenar este documento está en la Fase A' de
[03-optimization-plan.md](03-optimization-plan.md): un dataset representativo y una mezcla que
recorra la ruta de escritura y el broadcast.

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
