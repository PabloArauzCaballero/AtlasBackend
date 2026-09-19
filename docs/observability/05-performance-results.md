# Fase 22 — Coste de la instrumentación

**Estado: MEDIDO bajo carga el 2026-09-19.** Se midió la latencia y —porque la latencia sola no
alcanzaba en la máquina disponible— el **tiempo de CPU del proceso**, que es la cifra que mejor
responde a «cuánto cuesta esto». Lo que sigue sin medirse está en la última sección, con su
nombre.

## Condiciones de la medición

| | |
| --- | --- |
| Código medido | Árbol de `7014406` con el parche de `tracing.ts` de `68330b0` aplicado (verificado por `diff`) |
| Escenario | `baseline`: 10 req/s, 120 s de ventana, 30 s de warm-up, mezcla de LECTURA de `load-flows.ts` |
| Configuraciones | 4: telemetría apagada · Jaeger con muestreo 1.0 · Jaeger con muestreo 0.10 · muestreo 1.0 con el **destino cerrado** |
| Rondas | 4 por configuración, **intercaladas** (apagada → 100 % → 10 % → sin destino, y vuelta a empezar) |
| Corridas válidas | 16 de 17; una descartada y repetida |
| Entorno | macOS arm64, 10 núcleos, 16 GiB; PostgreSQL y Redis en Docker; Jaeger `all-in-one:1.62.0` en local |
| Base de datos | Migraciones completas + siembra de desarrollo. **Volumen mínimo** |

Las rondas van **intercaladas y no agrupadas** a propósito: agrupar las cuatro corridas de una
configuración le carga entera cualquier deriva de la máquina —temperatura, un vecino, la caché
del sistema de ficheros— y eso se lee después como si fuera el efecto de la telemetría.

## La máquina mentía, y cómo se le puso freno

Esta medición se tiró entera **tres veces** antes de servir. No es anecdótico: los tres modos de
fallo producían números que parecían buenos, y el arnés —hoy versionado en
[`scripts/perf/overhead-telemetria.sh`](../../scripts/perf/overhead-telemetria.sh)— acabó con
una guarda por cada uno.

| Lo que pasó | Cómo se veía | Qué lo detecta ahora |
| --- | --- | --- |
| Otra sesión compilando al 271 % de un núcleo | p95 de 21 ms → **7.696 ms** | CPU del mayor proceso ajeno, muestreada cada 5 s durante toda la corrida |
| **El equipo se durmió** a mitad de la corrida | `Ventana medida: 0,07 s`, **1 petición**, y un p50 = p95 = p99 = 71,42 ms | La corrida debe durar ≥ 115 s y completar ≥ 1.100 peticiones; y se sostiene un `caffeinate` mientras dura |
| Contención sin suspensión | Retraso del generador de 48 a 763 ms | Retraso del generador p95 ≤ 5 ms |

Ninguna señal sola bastaba, y se comprobó contra las corridas corrompidas que se conservan:
**el retraso del generador delata tres de las cuatro** (48, 82 y 763 ms frente a 0 ms en las
limpias) y no la cuarta, que tuvo retraso 0 ms y aun así un p95 de 86 ms. **El throughput no
delata ninguna**: 10,01 req/s en la peor de todas. De ahí que la validez exija las tres cosas a
la vez.

El umbral de CPU ajena está puesto donde lo pone el dato —120 % de un núcleo—: por encima están
las corridas que se corrompieron (152–271 %) y por debajo una que salió idéntica a la línea base
con un vecino puntual al 89 %.

## Resultado 1 — coste en CPU del proceso

Es el resultado principal, y conviene entender por qué: **la latencia de pared se la roba
cualquier vecino, el tiempo de CPU del proceso no.** En esta misma máquina el p95 de la MISMA
configuración osciló entre 21 y 228 ms según quién más estuviera compilando. Los ciclos que
consume el backend, en cambio, son suyos.

| Configuración | CPU media | desv | Δ vs apagada | Rondas con signo positivo |
| --- | --- | --- | --- | --- |
| apagada | 20,46 s | 0,80 | — | — |
| Jaeger, muestreo 1.0 | 25,46 s | 1,47 | **+4,99 s (+24,4 %)** | 4/4 |
| Jaeger, muestreo 0.10 | 22,89 s | 1,25 | **+2,42 s (+11,8 %)** | 4/4 |
| Destino cerrado, muestreo 1.0 | 23,62 s | 1,57 | **+3,15 s (+15,4 %)** | 4/4 |

Dispersión de la propia línea base: 1,88 s (9,2 %). El efecto de la telemetría al 100 % es 2,7
veces esa dispersión y tiene el mismo signo en las cuatro rondas, así que es un resultado y no
ruido.

Por petición, dividiendo entre las 1.201 de la ventana más las 300 del warm-up:

| Configuración | CPU por petición | Δ |
| --- | --- | --- |
| apagada | 13,64 ms | — |
| muestreo 0.10 | 15,25 ms | +1,61 ms |
| destino cerrado | 15,73 ms | +2,10 ms |
| muestreo 1.0 | 16,96 ms | **+3,32 ms** |

## Resultado 2 — el muestreo NO es la palanca que se creía

Esta sección **corrige** lo que afirmaba la versión anterior de este documento, que decía que
«el coste crece con el número de spans exportados, no con el de parches instalados» y de ahí
recomendaba el ratio de muestreo como única palanca. Los datos no lo sostienen.

Si todo el coste fuera por span exportado, bajar el muestreo de 1.0 a 0.10 dejaría la sobrecarga
en ~2,4 %. Medido: **11,8 %.** Ajustando `coste(r) = F + r·V` a los dos puntos:

- **Parte fija, 10,4 de los 24,4 puntos (43 %)** — parcheo de `http`, `express`, `pg`, `ioredis`
  y `undici`, y propagación de contexto. Se paga en **toda** petición, se muestree o no.
- **Parte variable, 14,0 puntos (57 %)** — grabar los atributos del span y exportarlo. Sólo se
  paga en las trazas muestreadas.

**Consecuencia práctica:** bajar el muestreo del 100 % al 10 % quita la mitad del coste, no el
90 %. Si algún día hace falta bajar más, la palanca que queda **sí** es retirar instrumentaciones,
empezando por la que menos aporte al diagnóstico. Con dos puntos no se puede afirmar que el
modelo sea lineal; para eso harían falta medidas a 0,25 y 0,50, y no se han hecho.

## Resultado 3 — un destino caído no cuesta latencia

Es la propiedad de la que depende todo lo demás: que exportar esté **fuera** del camino de la
petición.

| Configuración | p50 | p95 | p99 |
| --- | --- | --- | --- |
| apagada | 15,31 ms | 28,27 ms | 35,22 ms |
| muestreo 1.0 | 17,05 ms (+11,3 %) | 31,70 ms (+12,1 %) | 38,51 ms (+9,3 %) |
| muestreo 0.10 | 16,37 ms (+6,9 %) | 29,21 ms (+3,3 %) | 36,11 ms (+2,5 %) |
| **destino cerrado** | 15,89 ms (+3,8 %) | **28,66 ms (+1,4 %)** | 36,41 ms (+3,4 %) |

Con el puerto del colector cerrado, el p95 queda **1,4 % por encima de la línea base, con una
dispersión de la línea base del 14 %**: no hay diferencia medible. Y con el signo repartido 2/4
entre rondas, que es lo que se espera cuando dos poblaciones son la misma. El exportador falla en
segundo plano y la petición no se entera.

Nótese además que el destino cerrado gasta **menos CPU** que el destino vivo (+15,4 % frente a
+24,4 %): sin nadie al otro lado no hay que serializar ni enviar el lote completo.

## Criterios de aceptación

| Criterio | Umbral | Medido | Veredicto |
| --- | --- | --- | --- |
| p95 con muestreo de producción (0.10) | ≤ +5 % | **+3,3 %** (por debajo de la dispersión de la base) | **Cumple** |
| p99 con muestreo de producción | ≤ +10 % | **+2,5 %** | **Cumple** |
| Latencia con destino caído frente a la línea base | Sin diferencia estadística | **+1,4 %** en p95, signo 2/4 | **Cumple** |
| Tiempo de arranque adicional | ≤ 500 ms | **−2 ms** (dispersión de la base: 33 ms) | **Cumple** |
| Tiempo de cierre adicional | — | **−2 ms** | **Cumple** |
| Spans perdidos con colector sano | 0 | **0 errores de exportador** en 75 s con más de un ciclo de exportación | **Cumple** |
| Memoria adicional en régimen | ≤ 50 MB | **NO CONCLUYENTE**, ver abajo | — |

**Con muestreo al 100 % el p95 sube un 12,1 % y NO cumpliría el criterio del 5 %.** Es
consistente: ese es el modo de depuración, no el de producción.

**La memoria no se puede afirmar.** El RSS se tomó con una sola muestra al final de cada corrida
y la línea base osciló entre 170 y 313 MB —143 MB de recorrido— frente a un delta aparente de
+20 MB. El número existe en el TSV y no significa nada; medirlo bien exige muestrear el heap a lo
largo de la corrida, y no se hizo.

## Lo que sigue sin medirse

- **Memoria en régimen**, por lo anterior.
- **Uso de red** del exportador.
- **Colector saturado** (`queue_size` reducido) y spans perdidos bajo presión.
- **Concurrencia alta**: todo esto es a 10 req/s sobre una base con volumen mínimo. Los
  escenarios `stress` y `spike` del arnés no se corrieron.
- **Linealidad del modelo de coste**, que necesitaría muestreos intermedios.
- Los otros tres backends. Llevan la misma capa con un subconjunto de las instrumentaciones
  —el ERP y tableros no usan `ioredis`— y ninguno tiene arnés de carga, así que **esta cifra es
  una cota superior razonable para ellos, no una medición suya.**

## Cómo repetirla

```bash
# Con Jaeger local levantado y un backend compilado en un worktree aparte:
yarn perf:load --scenario=baseline --base-url=http://localhost:<puerto>
```

El arnés de las cuatro configuraciones, con sus tres guardas y el porqué de cada una, está
versionado en [`scripts/perf/overhead-telemetria.sh`](../../scripts/perf/overhead-telemetria.sh):

```bash
yarn jaeger:up
git worktree add --detach /tmp/medir <sha> && cp -Rc node_modules /tmp/medir/
cd /tmp/medir && yarn build
RAIZ=/tmp/medir PUERTO=53105 zsh scripts/perf/overhead-telemetria.sh
```

Lo que **no** debe repetirse sin las guardas es la comparación: sin ellas, tres de cada cuatro
intentos de esta misma medición produjeron números plausibles y falsos.
