# Runbook de rendimiento

Procedimientos operativos. Para el diseño y el porqué, ver los documentos numerados de esta misma
carpeta.

## Arrancar en local para medir

```bash
yarn start:clean     # diagnose → cleanup → verify → start:dev
```

Si falla, mirar el código de salida de `prestart:verify`
([tabla completa](00-prestart-resource-hygiene.md#códigos-de-salida-de-prestartverify)):

| Código | Acción |
|---|---|
| 2 | Repetir `yarn prestart:cleanup`. Si insiste, mirar el PID que reporta. |
| 3 | Un proceso ajeno ocupa el puerto. Ciérralo tú: la herramienta no mata lo que no puede demostrar que es nuestro. |
| 4 | Liberar memoria o disco. No medir bajo presión: mediría el host, no el backend. |

## Correr una prueba de carga

```bash
# El backend tiene que estar ya arriba. El arnés no lo levanta a propósito:
# un generador que también arranca el servidor mide su propio arranque.
yarn perf:load --scenario=smoke
yarn perf:load --scenario=baseline
yarn perf:load --scenario=stress --base-url=http://staging.interno:3005
```

Banderas: `--scenario`, `--base-url`, `--tenant`, `--timeout-ms`.

Informe en `artifacts/performance/backend/reports/load-<timestamp>.json`.

## Diagnóstico: «la API está lenta»

Recorrer en este orden. El orden importa: cada paso descarta una familia de causas.

**1. ¿Es el pool?**

```promql
atlas_db_pool_connections{state="waiting"}
```

`> 0` sostenido: las peticiones esperan una conexión y la latencia sube sin que ninguna query sea
lenta. Buscar qué está consumiendo el pool — el sospechoso habitual es un fan-out de fondo
(ver [R-01](02-bottleneck-map.md#r-01--el-fan-out-de-entregas-excede-por-sí-solo-el-pool-de-conexiones)).

**2. ¿Es el event loop?**

```promql
nodejs_eventloop_lag_p99_seconds > 0.1
```

Trabajo CPU-bound bloqueando el hilo. Sospechar de escaneos de fuentes, cifrado síncrono o
`JSON.parse` de cuerpos grandes.

**3. ¿Es un proveedor externo?**

```promql
atlas_circuit_breaker_state == 2
```

Un breaker abierto se ve como latencia. También revisar `atlas_provider_calls_total`.

**4. ¿Es una ruta concreta o todas?**

```promql
histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket[5m])))
```

Si `/health` también se degradó, el problema es del proceso o del host, no de las queries: `/health`
no toca la base.

**5. ¿Es memoria?**

`nodejs_heap_size_used_bytes` creciendo de forma monótona entre despliegues indica fuga. Reiniciar
la enmascara; no la arregla.

## Diagnóstico: «el trabajo de fondo dejó de correr»

```promql
increase(atlas_scheduled_job_runs_total{outcome="stalled"}[15m]) > 0   # tanda que excedió su techo
absent(atlas_app_info{role="worker"})                                  # el worker no está desplegado
atlas_outbox_pending_events                                            # backlog creciendo
```

`outcome="skipped"` dominando la serie no es un fallo: significa que el intervalo configurado es
menor que la duración real del job.

## Antes de aceptar una optimización

Lista de comprobación. Si falta cualquiera, el cambio no está listo:

- [ ] Hay baseline previo con las mismas condiciones (escenario, dataset, host, mezcla).
- [ ] Un perfil o traza demuestra dónde se iba el tiempo.
- [ ] Se midió después, con al menos tres corridas.
- [ ] La tabla antes/después está en [04-before-after-report.md](04-before-after-report.md),
      incluidas las métricas que empeoraron.
- [ ] Los gates funcionales pasan: `yarn type-check`, `yarn lint`, `yarn test:unit`, `yarn build`.
- [ ] Hay un umbral o alerta que detectaría la regresión.

## Qué NO hacer

- Correr benchmarks contra producción.
- Aceptar una mejora que sólo se reproduce en una de tres corridas.
- Subir `DB_POOL_MAX` como primera reacción a una espera de pool: traslada la contención al servidor
  de base de datos, donde es más cara de diagnosticar, y `(instancias × DB_POOL_MAX)` está acotado
  por el `CONNECTION LIMIT` del rol `atlas_app_rw`.
- Terminar procesos por nombre (`pkill node`): mata trabajo de otros proyectos. Para eso está
  `yarn stop:project`.
