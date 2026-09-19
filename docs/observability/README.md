# Observabilidad de AtlasBackend

Dos ejes que responden preguntas distintas y no se sustituyen:

| Eje | Responde | Dónde |
| --- | --- | --- |
| **Métricas** (Prometheus) | «¿cuántos, con qué frecuencia, a qué latencia?», agregado | `GET /metrics` |
| **Trazas** (OpenTelemetry → Jaeger) | «¿qué pasó en ESTA petición?», caso por caso | UI de Jaeger |
| **Logs** (`AppFileLogger`) | «¿qué dijo el código mientras pasaba?» | stdout y `Archivo.log` |

Los tres se cruzan por el `trace_id`. Este documento es sobre el segundo y el tercero.

## Conceptos, en una frase cada uno

- **Traza**: todo lo que ocurrió a raíz de un mismo disparo —una petición, una tanda de un job—,
  aunque cruce procesos.
- **Span**: un tramo con principio y fin dentro de esa traza. Tiene nombre, duración, atributos
  y eventos.
- **Contexto**: lo que permite que un span sepa de quién cuelga. Viaja solo dentro de un proceso
  y hay que **propagarlo a mano** cuando el trabajo salta a otro (ver «Workers»).
- **`trace_id`**: 32 caracteres hexadecimales que identifican la traza entera. Es lo que se pide
  al usuario que reporta un fallo.
- **`span_id`**: 16 hexadecimales que identifican UN tramo dentro de ella.

## Arrancar

```bash
yarn jaeger:up        # Jaeger en 127.0.0.1:16686, OTLP en 4318
yarn jaeger:logs      # sus logs
yarn jaeger:down      # pararlo
yarn jaeger:verify    # comprobar de punta a punta que una traza llega
```

Después, en tu `.env`:

```env
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:4318/v1/traces
OTEL_TRACES_SAMPLER_ARG=1.0
```

Dentro de Docker el destino es `http://jaeger:4318/v1/traces` (nombre de servicio; el archivo
de Jaeger es una capa sobre `docker-compose.yml`, así que comparten red).

**Con `OTEL_ENABLED=false` —el valor por defecto— el backend arranca igual y no paga nada.**

## Buscar una traza

1. Un usuario reporta un fallo → pídele la cabecera **`x-trace-id`** de la respuesta.
2. Ábrela directamente: `http://localhost:16686/trace/<trace-id>`.
3. Sin ese identificador: busca por servicio (`atlas-api`, `atlas-worker`,
   `atlas-worker-messaging`), operación (`POST /api/v1/...`, `credit.evaluate`) o etiqueta
   (`app.entity.id=CRA-1`).

Y al revés: cualquier línea de log lleva `trace_id` y `span_id`, así que de un log se salta a su
traza y de una traza se filtran sus logs.

## Qué se ve en una traza real

Medido sobre `POST /api/v1/auth/login` el 2026-09-18:

```
POST /api/v1/auth/login                    49,6 ms
  request handler - /api/v1/auth/login     36,8 ms
    pttl / pexpire / incr                   2,5 ms   (límite de tasa en Redis)
    pg.connect                             15,4 ms
    pg.query:SELECT atlas                   5,0 ms
    pg.query:INSERT atlas                   4,7 ms
    …
```

Quince spans, todos con significado. **No hay spans de middleware**: se apagaron a propósito
(siete por petición, cinco de ellos de 0,0 ms). El coste del parseo del cuerpo sigue viéndose
como el hueco entre el inicio del span del servidor y el del manejador.

## Crear un span de negocio

Inyecta `TracingService` — es la única dependencia que necesita un servicio de dominio, y no
arrastra ningún paquete de Jaeger:

```ts
constructor(private readonly tracing: TracingService) {}

async decide(request: CreditDecisionRequest): Promise<CreditDecisionResult> {
  return this.tracing.runInSpan(
    SPAN_NAMES.creditEvaluate,
    {
      [APP_ATTRIBUTES.module]: 'credit',
      [APP_ATTRIBUTES.operation]: 'evaluate',
      [APP_ATTRIBUTES.entityId]: request.applicationId,
    },
    async (span) => {
      const result = await this.evaluate(request);
      span.setAttribute(DECISION_ATTRIBUTES.outcome, result.outcome.kind);
      return result;
    },
  );
}
```

Ese ejemplo es real: `src/modules/decision-engine/credit-decision-engine.service.ts`.

**Antes de añadir uno, comprueba que se lo merece:**

1. ¿Es 1:1 con un endpoint? Entonces **no**: el span del servidor ya lo delimita. Lo que falta
   no es el tramo, es el desenlace → `this.tracing.setAttribute('auth.outcome', …)`.
2. ¿Responde algo que `pg`, `ioredis` o `http` no responden ya? Si no, tampoco.

El catálogo completo y el porqué de cada uno: `02-business-spans-catalog.md`.

### Eventos y atributos

```ts
this.tracing.addEvent('rules.completed');            // un hito DENTRO de la operación
this.tracing.setAttribute('credit.decision', kind);  // un dato del span en curso
this.tracing.recordException(error);                 // un fallo que se gestionó sin propagarse
```

Un hito es un **evento**, no un span hijo: los spans hijos son para llamadas a otro componente.

## Qué NUNCA se registra

Contraseñas, tokens, cookies, `Authorization`, documentos de identidad, nombres, teléfonos,
correos, importes, números de cuenta, cuerpos de petición o respuesta, valores de parámetros
SQL, valores de Redis, variables de entorno, cadenas de consulta.

Lista completa y los mecanismos que lo impiden: `04-data-privacy-policy.md`. Hay tres redes:

1. La instrumentación no captura cabeceras ni parámetros.
2. `redactSqlLiterals` borra los valores que Sequelize incrusta en el texto de la consulta.
3. `RedactingSpanProcessor` quita la cadena de consulta de cualquier URL antes de exportar.

## Instrumentar un worker

Cada proceso arranca **su propio** SDK con **su propio** nombre, lo primero de todo:

```ts
import 'reflect-metadata';
import { startTracing, shutdownTracing } from './observability/tracing.js';

startTracing('atlas-worker');   // ANTES de importar Nest, Express, Sequelize, pg o ioredis
```

Compartir nombre entre API y worker haría que el grafo de dependencias de Jaeger mostrara un
solo nodo hablando consigo mismo.

### Que la traza sobreviva al salto

El contexto **no** viaja solo hasta el worker. Al publicar, se inyecta; al consumir, se extrae:

```ts
// productor (API)
metadataJson: this.messaging.withCarrier({})

// consumidor (worker)
this.messaging.runAsConsumer(SPAN_NAMES.outboxDispatch, row.metadataJson, atributos, async (span) => { … })
```

Una fila escrita antes de que esto existiera no lleva portador y abre su propia traza: se
procesa igual. La compatibilidad hacia atrás es por construcción.

## Instrumentar un trabajo programado

Traza **raíz**, porque no nace de ninguna petición:

```ts
return this.tracing.runInRootSpan(SPAN_NAMES.jobRun, { [APP_ATTRIBUTES.jobName]: job.jobCode }, (span) => …);
```

Regla: **el número de spans no puede depender del volumen de datos.** Un span por inquilino, sí;
un span por registro, no.

## Comprobar que los logs correlacionan

```bash
grep '"trace_id":"<tu-trace-id>"' Archivo.log
```

Toda línea emitida dentro de una petición trazada lleva `trace_id`, `span_id` y `trace_flags`.
Fuera de una petición —arranque, jobs sin traza— van a `null`: **nunca un identificador
inventado**, porque mandaría a soporte a buscar algo que no existe.

## Problemas frecuentes

| Síntoma | Causa más probable |
| --- | --- |
| No hay ninguna traza | `OTEL_ENABLED` no es `true` |
| El servicio no aparece en Jaeger | Destino mal: revisa `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`. `yarn jaeger:verify` lo dice |
| La traza existe pero está vacía por dentro | El SDK arrancó tarde. Tiene que ser lo PRIMERO del entrypoint; el propio arranque avisa por el canal de diagnóstico |
| Faltan los spans de una biblioteca | Versión fuera del rango que soporta su instrumentación. Pasó con ioredis 6 y `instrumentation-ioredis@0.68`: **cero spans, cero errores** |
| Los logs no llevan `trace_id` | Se está ejecutando fuera del contexto de la petición |
| El worker abre trazas sueltas | La fila no llevaba portador, o se escribió antes de esta propagación |
| Las sondas de salud llenan Jaeger | No deberían: están excluidas. Si aparecen, revisa `UNTRACED_HTTP_PATH_SUFFIXES` |
| Un 401 sale sin `x-trace-id` | No debería: los guards corren antes que los interceptores, y por eso la cabecera se emite TAMBIÉN desde el filtro de excepciones |

El diagnóstico completo, en `06-operational-runbook.md`.

## Los documentos

| Archivo | Qué contiene |
| --- | --- |
| `00-current-state-audit.md` | Qué había antes y qué huecos tenía |
| `01-architecture-design.md` | Decisiones y sus alternativas descartadas |
| `02-business-spans-catalog.md` | Cada span manual, sus atributos y su riesgo de privacidad |
| `03-production-topology.md` | Collector, Jaeger, almacenamiento, retención, seguridad |
| `04-data-privacy-policy.md` | Qué no puede registrarse y qué lo impide |
| `05-performance-results.md` | Lo medido y lo que falta medir |
| `06-operational-runbook.md` | Qué hacer cuando algo falla en producción |
