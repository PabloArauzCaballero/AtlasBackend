# Fase 22 — Coste de la instrumentación

**Estado: MEDICIÓN PENDIENTE.** Este documento describe el método y deja registrado lo que sí se
midió. No se afirma que la sobrecarga sea aceptable: eso exige medirlo en un entorno con carga
representativa, y aquí no lo hay.

## Lo que sí está medido

| Medición | Resultado | Cómo |
| --- | --- | --- |
| Arranque del SDK apagado | No construye exportador ni instrumentaciones; `activeTelemetryConfig()` es `undefined` | `test/unit/observability/tracing.spec.ts` |
| Arranque del SDK encendido sin destino | El proceso **no cae**: el exportador falla en segundo plano con `ECONNREFUSED` | Prueba manual reproducible (ver abajo) |
| Cierre | `stopTracing()` resuelve y deja la configuración en `undefined`; no lanza aunque el vaciado falle | ídem |
| Suite unitaria completa | 5386 pruebas en verde, 526 suites, ~75 s | `yarn test:unit` |
| Spans por petición HTTP real | **15** en `POST /api/v1/auth/login`, todos con significado | Traza en Jaeger, 2026-09-18 |
| Spans de middleware retirados | De 18 a 15: siete eran middleware Express, cinco de ellos de 0,0 ms | ídem |
| Sondas de salud | `/api/v1/health` **no genera traza** ni cabecera `x-trace-id` | ídem |
| Correlación log↔traza | El log del filtro de excepciones lleva el mismo `trace_id`, más `span_id` y `trace_flags` | ídem |
| Fuga de datos | Ni el correo, ni el documento, ni la cadena de consulta, ni el hash del identificador aparecen en la traza | ídem |

### Desglose de una petición real

`POST /api/v1/auth/login` con Jaeger local y muestreo al 100 %, sobre una base vacía:

```
POST /api/v1/auth/login                    49,6 ms   ← span del servidor
  request handler - /api/v1/auth/login     36,8 ms
    pttl / pexpire / incr                   2,5 ms   ← límite de tasa en Redis
    pg.connect ×2                          26,9 ms   ← apertura de conexiones, primera petición
    pg.query ×6                            20,6 ms
```

Los ~13 ms entre el inicio del span del servidor y el del manejador son el parseo del cuerpo y
los middleware, que ya no tienen span propio.

Esto **no** es una medición de sobrecarga: es una sola petición, en frío, contra una base sin
datos. Sirve para afirmar que la jerarquía es correcta y legible, no para cuantificar el coste.

Reproducción del segundo y tercer punto, sin Jaeger levantado:

```bash
# sin Jaeger levantado: el exportador falla en segundo plano y el proceso termina con normalidad
OTEL_ENABLED=true OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 \
  npx tsx scripts/emit-verification-span.ts
```

El exportador registra el fallo de conexión y el proceso termina con normalidad.

## Lo que falta medir, y cómo

El repositorio ya tiene el arnés: `yarn perf:load` con los perfiles `smoke`, `baseline`, `stress`
y `soak`. La comparación debe ser la **misma carga** en seis configuraciones:

| # | `OTEL_ENABLED` | Muestreo | Destino |
| --- | --- | --- | --- |
| 1 | `false` | — | — |
| 2 | `true` | 1.0 | Jaeger local |
| 3 | `true` | 0.10 | Jaeger local |
| 4 | `true` | 1.0 | **sin destino** (puerto cerrado) |
| 5 | `true` | 1.0 | Collector |
| 6 | `true` | 1.0 | Collector saturado (`queue_size` reducido) |

Métricas por configuración: latencia media, p50, p95, p99; CPU y memoria del proceso;
throughput; errores; tiempo de arranque; tiempo de cierre; spans perdidos
(`otelcol_exporter_send_failed_spans`); tráfico de red.

## Qué se espera, y por qué no basta con esperarlo

Las cinco instrumentaciones activas son las baratas del catálogo (`http`, `express`, `pg`,
`ioredis`, `undici`) y la exportación es asíncrona y por lotes, así que la expectativa razonable
es un coste de un dígito porcentual en p95. **Eso es una expectativa, no un resultado.** La
configuración 4 es la importante: verifica que un destino inalcanzable no añade latencia al
camino de la petición, que es la propiedad de la que depende todo lo demás.

## Criterios de aceptación cuando se ejecute

| Criterio | Umbral |
| --- | --- |
| p95 con muestreo de producción frente a telemetría apagada | ≤ +5 % |
| p99 | ≤ +10 % |
| Latencia con destino caído frente a destino disponible | Sin diferencia estadística |
| Memoria adicional en régimen | ≤ 50 MB por proceso |
| Tiempo de arranque adicional | ≤ 500 ms |
| Spans perdidos con Collector sano | 0 |

Si alguno no se cumple, la palanca es el **ratio de muestreo**, no retirar instrumentaciones: el
coste crece con el número de spans exportados, no con el de parches instalados.
