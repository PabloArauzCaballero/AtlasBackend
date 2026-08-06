# Baseline de rendimiento

## Estado actual: NO EXISTE baseline medido

No hay cifras en este documento porque no se pudo medir. El entorno de trabajo no tenía Postgres
ni Redis en ejecución, ni Docker disponible, así que el backend nunca llegó a arrancar. Rellenar
esta página con números de otro sitio la convertiría en la peor clase de documento: uno que parece
un baseline.

Lo que sí existe es **el arnés para producirlo**, verificado de extremo a extremo. Esta página
explica cómo usarlo y qué hay que registrar.

## Inventario del sistema

| Dimensión | Valor |
|---|---|
| Runtime | Node.js ≥ 22 (`package.json` → `engines`) |
| Framework | NestJS 11 sobre Express 5 |
| ORM | Sequelize 6 + `sequelize-typescript` |
| Base de datos | PostgreSQL (`pg` 8), pool escritura y pool lectura separados |
| Caché / rate limiting | Redis (`ioredis` 5), con degradación a memoria en dev |
| Almacén secundario | MongoDB 7 (sincronización de logs) |
| Roles del proceso | `api` y `worker`, entrypoints separados (`src/main.ts`, `src/worker.ts`) |
| Observabilidad | OpenTelemetry (OTLP/HTTP) + `prom-client` en `/metrics` |
| Dominios | 28 módulos bajo `src/modules/` |

## Cómo producir el baseline

```bash
# 1. Entorno limpio y verificado (obligatorio: sin esto, la medición no es reproducible)
yarn start:clean

# 2. Con el backend arriba, en otra terminal:
yarn perf:load --scenario=smoke        # confirma que el arnés y el entorno funcionan
yarn perf:load --scenario=baseline     # la medición de referencia
```

Repetir el escenario `baseline` **al menos tres veces** y comparar. Si los percentiles bailan más de
un 15 % entre corridas, el entorno no es lo bastante estable para servir de referencia: hay que
estabilizarlo antes, no promediar el ruido.

## Qué registrar junto a las cifras

Una medición sin sus condiciones no es un baseline, es una anécdota. El informe JSON que escribe
`yarn perf:load` en `artifacts/performance/backend/reports/load-*.json` ya captura casi todo:

- commit evaluado;
- escenario (ritmo de llegadas, duración, warm-up, `maxInFlight`);
- mezcla de flujos con sus pesos;
- host: memoria total y disponible, núcleos, carga, disco;
- ventana medida real, throughput, tasa de error, p50/p75/p95/p99 global y por flujo;
- lectura de `/metrics` al inicio y al final: heap, RSS, event-loop lag, ocupación del pool;
- retraso del propio generador de carga.

Lo que hay que añadir a mano, porque el script no puede saberlo:

- **tamaño y forma del dataset** (número de filas de las tablas que tocan los flujos);
- **límites del contenedor** si se mide en Docker/Kubernetes, no del host;
- **estado de los proveedores externos**: reales, simulados o desconectados.

## Modelo de carga: por qué llegadas a ritmo fijo

El arnés usa un **modelo abierto**: las peticiones salen a un ritmo constante, independientemente de
lo que tarde el backend en contestar.

La alternativa —N trabajadores en bucle cerrado, que es lo que hace `scripts/stress/`— tiene un
defecto que invalida la medición de latencia: si el servidor se ralentiza, los trabajadores mandan
menos peticiones, la carga baja sola y el sistema nunca se satura. Sale un p95 optimista que no se
parece al tráfico real, donde los usuarios siguen llegando aunque el backend vaya lento.

`scripts/stress/notifications.stress.ts` se queda como está: el modelo cerrado es el correcto para
verificar que un pipeline de trabajo procesa todo lo que se le encola, que es lo que ese script
comprueba.

## Mezcla de tráfico

Definida en `scripts/perf/lib/load-flows.ts`, todas las rutas verificadas contra controladores
reales. Es deliberadamente de **lectura**: una prueba de carga que escribe contra un entorno
compartido deja datos que contaminan la siguiente corrida, y el baseline se degrada solo, por
acumulación, sin que nadie haya tocado el código.

| Flujo | Peso | Qué ejercita |
|---|---:|---|
| `health` | 1 | Piso de latencia del transporte, sin tocar la base |
| `catalogos-listado` | 4 | Listado paginado con guard JWT + tenant + repositorio + DTO |
| `definiciones` | 2 | Lectura de configuración, candidata a caché |
| `politica-riesgo-vigente` | 2 | Resolución de «versión vigente» de un único registro |
| `eventos-operaciones` | 3 | Listado sobre el outbox, tabla de crecimiento monótono |
| `glosario-negocio` | 1 | Portal interno con su propia cadena RBAC |

Cambiar la mezcla invalida cualquier comparación antes/después. Si hay que cambiarla, se cambia
aquí y en el archivo, y se anota la fecha: las corridas anteriores dejan de ser comparables.

## Interpretar el retraso del generador

El informe incluye `schedulerLagMs`. Si el p95 supera 100 ms, el generador de carga no consiguió
mantener el ritmo y **parte de la latencia medida es de este proceso, no del backend**. El arnés lo
avisa por consola. La solución es bajar el ritmo o generar la carga desde otra máquina, nunca
ignorar el aviso.
