# Fase 24 — Runbook operativo

Qué hacer cuando la observabilidad falla. **La regla que gobierna todo este documento: ningún
fallo de trazas justifica tocar el camino de una petición de negocio.** Si la disyuntiva es
perder trazas o degradar el servicio, se pierden las trazas.

## Comprobación rápida

```bash
yarn jaeger:verify      # ¿la cadena completa proceso → OTLP → Jaeger funciona?
```

Recorre cinco pasos y dice en cuál falla. Si pasa, el problema no está en la cadena.

---

## 1. Jaeger no recibe trazas

Por orden, del más frecuente al menos:

| # | Comprobar | Cómo | Si falla |
| --- | --- | --- | --- |
| 1 | ¿Está encendido? | `OTEL_ENABLED` en el entorno del proceso | Es opt-in: sin `true` no exporta |
| 2 | ¿El destino es el correcto? | `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | Dentro de Docker `http://jaeger:4318/v1/traces`; fuera, `localhost` |
| 3 | ¿Se resuelve el nombre? | `getent hosts jaeger` desde el contenedor | Red equivocada en el compose |
| 4 | ¿El puerto responde? | `curl -v telnet://jaeger:4318` | Puerto o cortafuegos |
| 5 | ¿El muestreo lo descartó? | `OTEL_TRACES_SAMPLER_ARG` | Con 0.05 se pierden 19 de cada 20 |
| 6 | ¿El Collector está vivo? | `curl <collector>:13133` | Ver §5 |
| 7 | ¿Qué dice el propio SDK? | `OTEL_DIAG_LOG_LEVEL=DEBUG` y reiniciar | El exportador registra sus fallos ahí |

### Caso especial: la traza existe pero está VACÍA por dentro

Sólo aparece el span del servidor, sin consultas ni llamadas. **Causa: el SDK arrancó tarde.**
Las instrumentaciones parchean `http`, `express`, `pg` e `ioredis` en el instante en que esos
módulos se requieren; arrancar después no produce error, produce silencio.

El arranque lo avisa por el canal de diagnóstico: *«El SDK arrancó DESPUÉS de cargar …»*. Con
`OTEL_DIAG_LOG_LEVEL=WARN` se ve.

Arreglo: `startTracing(...)` tiene que ser lo primero del entrypoint, antes de cualquier
`import` de Nest.

### Caso especial: falta UNA biblioteca entera

Todas las consultas están pero no hay un solo span de Redis, o al revés. **Causa habitual: la
versión de la biblioteca está fuera del rango que soporta su instrumentación.** Ocurrió en esta
misma puesta en marcha: `ioredis@6.0.0` con `instrumentation-ioredis@0.68` (soporta `<6`) →
**cero spans y cero errores**.

```bash
# rango que soporta la instrumentación instalada
grep -o "'ioredis', \['[^']*'\]" node_modules/@opentelemetry/instrumentation-ioredis/build/src/instrumentation.js
node -e "console.log(require('ioredis/package.json').version)"
```

Se repite igual para `pg`, `express` y `undici`. **Al subir cualquiera de esas cuatro
dependencias hay que volver a comprobar esto**, porque el síntoma es la ausencia, no un error.

---

## 2. El backend se ha vuelto lento

Primero: **descarta que sea la telemetría** antes de tocarla. Pon `OTEL_ENABLED=false` en UNA
instancia y compara. Si la latencia no cambia, el problema está en otro sitio.

Si sí cambia, por orden de impacto:

| Palanca | Cómo | Efecto |
| --- | --- | --- |
| Bajar el muestreo | `OTEL_TRACES_SAMPLER_ARG=0.05` | El mayor, y el primero que hay que probar |
| Revisar el lote del Collector | `send_batch_size`, `timeout` | Lotes pequeños = muchas peticiones de red |
| Revisar la cola | `sending_queue.queue_size` | Una cola llena descarta, no bloquea |
| Buscar cardinalidad | Atributos con un valor por petición | Engordan cada span |
| Buscar spans de más | Un span por registro en algún bucle | Ver §6 |

Lo que **no** se hace: retirar instrumentaciones. El coste crece con el número de spans
exportados, no con el de parches instalados.

---

## 3. Los logs no llevan `trace_id`

| Comprobar | Detalle |
| --- | --- |
| ¿Hay traza activa? | Fuera de una petición —arranque, jobs sin span raíz— es `null` **a propósito** |
| ¿La ruta está excluida? | `/health`, `/metrics` y compañía no generan traza, luego tampoco `trace_id` |
| ¿Es un worker? | Sólo tiene traza dentro de `runAsConsumer` o de una tanda de job |
| ¿La telemetría está encendida? | Sin SDK no hay span y el campo va a `null` |

`null` es la respuesta correcta cuando no hay traza. Un identificador inventado sería peor:
mandaría a soporte a buscar algo que no existe.

---

## 4. La traza se corta en el worker

El trabajo aparece, pero como traza aparte en vez de continuar la de la API.

1. **¿La fila lleva portador?**

   ```sql
   SELECT metadata_json->'otel' FROM platform_ops.outbox_events WHERE event_id = '<id>';
   ```

   `null` significa que se escribió **sin traza activa** —telemetría apagada en la API, o una
   fila anterior a esta propagación—. No es un fallo: el consumidor abre su propia traza y el
   trabajo se procesa igual.

2. **¿El `traceparent` tiene la forma W3C?** `00-<32 hex>-<16 hex>-<2 hex>`. Uno con otra forma
   se descarta en silencio, a propósito: perder la correlación es preferible a perder el trabajo.

3. **¿El worker exporta al mismo destino?** Dos destinos distintos parten la traza en dos.

4. **¿Los dos procesos tienen nombres distintos?** Si comparten `OTEL_SERVICE_NAME`, la traza
   está entera pero el grafo de servicios no se entiende.

---

## 5. El Collector

| Síntoma | Qué mirar | Acción |
| --- | --- | --- |
| Descarta spans | `otelcol_processor_dropped_spans` | Subir `queue_size`; si persiste, replicar |
| No drena la cola | `otelcol_exporter_queue_size` creciendo | El problema está **detrás**: Jaeger o el almacenamiento |
| Se reinicia solo | Memoria | `memory_limiter` está haciendo su trabajo; dale más memoria |
| Rechaza conexiones | `OTEL_COLLECTOR_BIND_HOST` | Ligado a una interfaz que los procesos no alcanzan |

Una caída del Collector **no** tiene consecuencias sobre el negocio: la exportación es
asíncrona y el proceso sigue atendiendo peticiones. Confirma eso antes de escalar el incidente.

---

## 6. Hay datos sensibles en una traza

**Es un incidente de privacidad.** Procedimiento completo en `04-data-privacy-policy.md`; en
resumen y por orden:

1. **Cortar el emisor** (desactivar la instrumentación o el atributo) y desplegar. No se empieza
   por borrar: mientras el emisor viva, el dato vuelve.
2. **Redactar en el Collector** (`attributes/redact`) como parada inmediata mientras el
   despliegue avanza.
3. **Acotar**: qué servicio, qué versión, desde cuándo, cuántas trazas.
4. **Eliminar** el almacenamiento afectado. La retención de 7 días acota el peor caso.
5. **Revisar accesos** a la UI en la ventana afectada.
6. **Documentar** y añadir la prueba que impida la reaparición.

Cómo mirarlo en una traza concreta:

```bash
curl -s "http://<jaeger>/api/traces/<trace-id>" \
  | grep -o -iE 'authorization|cookie|password|x-api-key|[a-z0-9._%+-]+@[a-z0-9.-]+' | sort -u
```

---

## 7. Apagarlo todo

```env
OTEL_ENABLED=false
```

Un reinicio y el proceso deja de exportar, de parchear y de abrir conexiones. **No hace falta
desplegar código para desactivar la observabilidad**, y esa es la propiedad que la hace segura
de encender en producción.

---

## 8. «El log se llena de `OTLPExporterError: Not Found`»

No es un fallo de las trazas: es otra señal.

`NodeSDK` arranca un proveedor de **métricas** y otro de **registros** cuando
`OTEL_METRICS_EXPORTER` y `OTEL_LOGS_EXPORTER` no están declaradas, porque su valor por defecto
es `otlp` y no `none`. Si el destino es Jaeger —que sirve `/v1/traces` pero no `/v1/metrics`—
el lector periódico falla cada minuto y deja ese error en el log de la aplicación.

`startTracing` declara ahora las dos variables en `none`, así que el síntoma no debería
aparecer. Si aparece, alguien las puso a otra cosa en el entorno del proceso: el código respeta
esa decisión a propósito (`??=`). Compruébelo con

```bash
docker exec <contenedor> sh -lc 'env | grep OTEL_'
```

**No lo trate como ruido.** Las métricas de las instrumentaciones llevan sus propios atributos y
**no** pasan por `RedactingSpanProcessor`, que sólo actúa sobre spans: un canal encendido sin
querer es un canal fuera de la política de datos de la Fase 18.
