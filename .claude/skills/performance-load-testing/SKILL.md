---
name: performance-load-testing
description: Pruebas de carga y rendimiento de backend con k6 — tipos de prueba (smoke, load, stress, soak, spike), modelo de carga derivado del uso real, umbrales como código, percentiles en lugar de promedios, entorno y volumen de datos representativos, y cómo localizar el cuello de botella (base de datos, pool de conexiones, N+1, event loop). Usar antes de lanzar un endpoint o flujo de alto tráfico, al fijar un SLO de latencia, tras un incidente de lentitud, o para comprobar que una optimización realmente mejoró algo.
effort: high
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Pruebas de carga y rendimiento

Responden una pregunta concreta con un número: *¿aguanta X carga cumpliendo Y latencia?* Sin
pregunta y sin umbral, es generar tráfico. Optimizar el código es `code-efficiency`; leer las
métricas del sistema bajo prueba es `backend-observability`; performance del navegador es
`frontend-performance`.

## 1. Qué tipo de prueba

| Tipo | Forma de la carga | Responde |
|---|---|---|
| **Smoke** | Mínima, corta | ¿El script y el sistema funcionan? Corre siempre antes que las demás |
| **Load** | Subida → meseta en carga esperada → bajada | ¿Cumple los umbrales con el tráfico normal y el pico previsto? |
| **Stress** | Por encima de lo esperado | ¿Cómo se degrada? ¿Se recupera solo? |
| **Breakpoint** | Rampa creciente hasta que falla | ¿Dónde está el límite y qué rompe primero? |
| **Soak** | Carga normal durante horas | Fugas de memoria, conexiones, disco, degradación lenta |
| **Spike** | Salto brusco | Ráfagas: apertura de agenda, envío masivo de notificaciones |

Orden: smoke → load. Las demás según el riesgo. No corras stress sin haber pasado load.

## 2. Modelo de carga desde el uso real

1. Partí de datos: requests por endpoint, usuarios concurrentes en hora pico, mezcla
   lectura/escritura (de `backend-observability` o analytics). Si el sistema es nuevo, estimá y
   **escribí las hipótesis**.
2. Modelá **flujos**, no endpoints sueltos: login → listar agenda → abrir cita → guardar. Con
   tiempos de pensamiento (`sleep`) entre pasos.
3. Mezcla proporcional al uso real: si el 90 % son lecturas, el script también.
4. Elegí el modelo del ejecutor:

| Modelo | Executor k6 | Cuándo |
|---|---|---|
| Cerrado (usuarios virtuales) | `ramping-vus`, `constant-vus` | Simular N usuarios con sesión; la tasa baja si el sistema se pone lento |
| Abierto (tasa de llegada) | `constant-arrival-rate`, `ramping-arrival-rate` | Fijar requests/seg independientemente de la latencia. Es el honesto para APIs públicas: no "perdona" al sistema lento |

5. Parametrizá con datos variados (usuarios, ids, términos de búsqueda distintos). Pegarle siempre
   al mismo registro mide la caché, no el sistema.

## 3. Umbrales como código

```js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    agenda: { executor: 'ramping-vus', stages: [
      { duration: '2m', target: 50 }, { duration: '10m', target: 50 }, { duration: '1m', target: 0 },
    ] },
  },
  thresholds: {
    http_req_failed: [{ threshold: 'rate<0.01', abortOnFail: true }],
    http_req_duration: ['p(95)<400', 'p(99)<1000'],
  },
};

export default function () {
  const res = http.get(`${__ENV.BASE_URL}/appointments?limit=20`, { headers: { Authorization: `Bearer ${__ENV.TOKEN}` } });
  check(res, { 'status 200': r => r.status === 200, 'trae items': r => r.json('items').length > 0 });
  sleep(1);
}
```

- Los números del ejemplo son ilustrativos: los umbrales salen del **SLO del servicio**
  (`backend-observability`), no de la skill.
- Si un umbral no se cumple, k6 termina con código de salida distinto de cero: la prueba **falla
  sola**, nadie interpreta un gráfico.
- `abortOnFail` en la tasa de error: si ya se rompió, no sigas martillando.
- `check` valida corrección bajo carga. Una API que responde 200 rápido con cuerpo vacío o con un
  500 disfrazado "pasa" el umbral de latencia: siempre afirmá contenido.
- Umbrales por flujo con tags o métricas `Trend` propias cuando endpoints distintos tienen
  objetivos distintos.

## 4. Percentiles, no promedios

- El promedio esconde la cola. Reportá **p50, p95, p99** y el máximo, más throughput y tasa de error.
- Mirá la latencia **a lo largo del tiempo**: plana en la meseta = sano; creciente con carga
  constante = algo se acumula (cola, memoria, conexiones).
- Compará siempre contra una **línea base** corrida en el mismo entorno, mismo dataset, mismo
  script. Un número aislado no dice nada.
- Repetí la corrida: una sola medición no distingue mejora de ruido.

## 5. Entorno y datos representativos

1. Nunca contra producción salvo ventana acordada y autorizada. Nunca contra infraestructura ajena.
2. Entorno con la **misma topología** que producción (proxy, pool, réplicas, límites de recursos);
   si es más chico, declaralo y no extrapoles linealmente.
3. **Volumen de datos realista**: tablas con el orden de magnitud de producción, generadas de forma
   determinista y sintética (`test-data-management`). Con tablas vacías todo es rápido.
4. El generador de carga corre en **otra máquina** que el sistema bajo prueba; si no, medís la
   pelea por CPU. Vigilá que el generador mismo no sature.
5. Terceros (correo, mapas, pagos): dobles en la frontera. No le hagas una prueba de carga a un
   proveedor.
6. En la máquina de desarrollo solo smoke: respetá `agent-resource-control`.

## 6. Encontrar el cuello

Mientras corre, mirá el sistema, no solo k6:

| Síntoma | Sospecha | Cómo confirmar |
|---|---|---|
| Latencia sube, CPU de la API baja | Espera por base o por pool | Conexiones activas vs tamaño del pool; tiempo de espera de adquisición |
| CPU de la base alta | Query sin índice, scan secuencial | Consultas lentas + `EXPLAIN (ANALYZE, BUFFERS)` (`postgresql-advanced`) |
| Número de queries crece con el tamaño de página | N+1 | Contar queries por request (`code-efficiency`) |
| CPU de la API al 100 % en un core | Trabajo síncrono pesado en el event loop | Profiler de CPU; lag del event loop |
| Memoria crece sin bajar en soak | Fuga, caché sin límite | Heap snapshots comparados |
| Errores 5xx en ráfaga al subir | Timeouts en cascada, sin backpressure | Trazas distribuidas; límites y colas (`backend-development`) |
| Bloqueos / deadlocks | Contención de filas | Vistas de locks de la base (`concurrency-and-locking`) |

Cambiá **una cosa por vez** y volvé a medir con el mismo script. Si no movió el percentil, revertí.

## Anti-patrones

- Prueba sin umbral: "anduvo bien".
- Reportar el promedio.
- Pegarle a un solo id con la caché caliente.
- Base vacía; generador y sistema en la misma máquina.
- Extrapolar "con 10 usuarios tarda 50 ms, entonces con 1.000…".
- Optimizar antes de localizar el cuello.
- Inventar SLOs o cifras de capacidad que nadie midió.

## Checklist

- [ ] Pregunta y umbrales escritos antes de correr; derivados del SLO.
- [ ] Smoke en verde antes de load.
- [ ] Flujos y mezcla basados en uso real o hipótesis documentadas.
- [ ] Executor elegido a conciencia (abierto vs cerrado).
- [ ] `check` de contenido además de latencia.
- [ ] Entorno y volumen de datos declarados; generador aparte.
- [ ] Línea base del mismo entorno para comparar.
- [ ] Cuello identificado con evidencia del sistema, no supuesto.

## Evidencia / DoD

Pegá literal: comando `k6 run ...`, bloque de resumen final de k6 (thresholds con su ✓/✗,
`http_req_duration` con percentiles, `http_req_failed`, iteraciones/seg) y el código de salida.
Para una optimización: el mismo bloque **antes y después**, mismo script y entorno. Declarás
entorno, volumen de datos y **No cubierto** (flujos o tipos de prueba no corridos).
