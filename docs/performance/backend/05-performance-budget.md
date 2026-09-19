# Presupuesto de rendimiento

Fuente de verdad: [`config/performance-budget.json`](../../../config/performance-budget.json). Lo
consume `scripts/perf/load.ts` y decide si una corrida pasa o falla. Esta página explica el diseño;
los valores viven en el JSON.

## Los umbrales están partidos en dos, y la distinción es el punto

### `enforced` — correctitud bajo carga

Bloquean desde el primer día porque **no dependen de ningún objetivo comercial**. «No devolver 5xx»
y «no colgar peticiones» son ciertos con cualquier SLO.

| Umbral | Valor | Por qué no necesita calibración |
|---|---:|---|
| `maxErrorRatePercent` | 1 | Una API que falla el 1 % de las peticiones está rota, se llame como se llame el SLO |
| `maxServerErrorCount` | 0 | Un 5xx es un defecto, no una medida de rendimiento |
| `maxTimeoutCount` | 0 | Un timeout de cliente es una petición perdida |
| `maxHeapGrowthPercentSoak` | 25 | Sólo en `soak`: en corridas cortas el ruido del GC lo hace inservible |

### `provisional` — latencia

**No fallan la corrida mientras `calibratedFrom` sea `null`.**

Un p95 sólo significa algo frente al SLO del producto o frente a un baseline medido en hardware
representativo. Los valores actuales (500 ms de p95, 1500 ms de p99) son marcadores de posición: no
salieron de ninguna medición ni de ninguna decisión de negocio, y el arnés lo dice en voz alta cada
vez que corre.

La razón de reportar sin bloquear: un umbral inventado que rompe el build enseña al equipo a ignorar
el gate, que es peor que no tenerlo; y un umbral inventado que pasa da una falsa sensación de
cumplimiento. Reportar sin bloquear es lo único honesto hasta que alguien mida.

## Cómo calibrar

1. Producir el baseline según [01-baseline.md](01-baseline.md) (tres corridas de `baseline`).
2. Tomar los percentiles medidos y decidir el margen **con el dueño del producto**. El margen es una
   decisión de negocio, no técnica.
3. Escribir los valores en `config/performance-budget.json` → `thresholds.provisional`.
4. Rellenar `calibratedFrom` con el commit y la fecha del baseline.

Desde ese momento los umbrales de latencia fallan la corrida igual que los de correctitud, y el
aviso de «provisional» desaparece de la salida.

## Escenarios

| Escenario | Ritmo | Duración | Warm-up | Para qué |
|---|---:|---:|---:|---|
| `smoke` | 2/s | 20 s | 5 s | Confirmar que el arnés y el entorno funcionan |
| `baseline` | 10/s | 120 s | 30 s | La medición de referencia |
| `load` | 40/s | 300 s | 30 s | Tráfico esperado sostenido |
| `stress` | 150/s | 180 s | 15 s | Encontrar el punto de degradación |
| `spike` | 200/s | 60 s | 5 s | Subida brusca |
| `soak` | 15/s | 3600 s | 60 s | Fugas y degradación en ejecución prolongada |

Los ritmos son puntos de partida sin calibrar, igual que los umbrales de latencia. Se ajustan cuando
se conozca el volumen real esperado.

### Excepciones por escenario

`stress` y `spike` buscan a propósito el punto de degradación. Exigirles la misma tasa de error que
a la carga normal haría fallar la prueba por hacer su trabajo, así que se relajan a 25 % y 40 % y no
se les exige cero 5xx. Lo que sigue siendo inaceptable ahí es que el proceso muera o que las
peticiones se cuelguen sin techo.

## Peticiones descartadas por saturación

`maxInFlight` corta el crecimiento sin techo de peticiones en vuelo. Al alcanzarlo, la petición se
cuenta como `dropped` y no se envía.

**`dropped > 0` no es un fallo del script.** Es la constatación de que el backend dejó de absorber
el ritmo ofrecido. Se reporta siempre y nunca falla la corrida por sí solo: en `stress` es
justamente el dato que se busca.

## Warm-up

Las muestras del warm-up se descartan del cálculo. El primer tramo mide compilación JIT, llenado del
pool de conexiones y cachés frías, no el estado estacionario. Se siguen enviando porque calentar es
su propósito.
