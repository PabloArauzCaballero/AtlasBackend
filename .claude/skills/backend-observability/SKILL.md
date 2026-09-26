---
name: backend-observability
description: Observabilidad de sistemas backend — logs estructurados con correlation/trace id sin PII, métricas RED/USE y golden signals, tracing distribuido con OpenTelemetry, SLI/SLO/error budget, alertas por síntoma, control de cardinalidad, health checks, dashboards y runbooks. Usar al instrumentar un servicio nuevo, al investigar un incidente sin suficiente visibilidad, o al definir qué alertar y qué mostrar en un dashboard.
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Observabilidad backend

Instrumentar un backend para poder responder "qué está pasando" y "por qué falló" sin
tener que adivinar. Para health checks y shutdown a nivel de arquitectura, ver
`backend-development` §11. Para seguridad de logs (qué nunca loguear), ver
`security-guardrails`.

## 1. Logs estructurados

- JSON, no texto libre: cada log es un objeto con campos consistentes
  (`timestamp`, `level`, `message`, `service`, `traceId`, campos de contexto propios del
  evento) — así se puede filtrar y agregar en la herramienta de logging, no solo leer.
- **Correlation/trace id** generado (o propagado si viene en el request) en el punto de
  entrada y presente en **todo** log de ese request/flujo, incluidos los que cruzan a
  otro servicio o a un job asíncrono — sin esto, reconstruir un flujo entre servicios es
  imposible.
- **Nunca loguear PII ni secretos**: contraseñas, tokens, números de tarjeta, datos de
  salud/identificación — ni siquiera en `debug`. Enmascará o excluí el campo antes de
  loguear el objeto completo (`JSON.stringify(user)` es una fuga esperando pasar).
- Niveles con criterio: `error` = requiere atención humana; `warn` = degradado pero
  operando; `info` = eventos de negocio relevantes (orden creada, pago procesado);
  `debug` = detalle de diagnóstico, apagado en producción salvo investigación puntual.

## 2. Métricas: RED, USE y golden signals

| Modelo | Para qué sirve | Métricas |
|---|---|---|
| **RED** | servicios orientados a request (APIs) | Rate (requests/seg), Errors (tasa de error), Duration (latencia, en percentiles) |
| **USE** | recursos (CPU, memoria, disco, conexiones de pool) | Utilization, Saturation (cola de espera), Errors |
| **Golden signals** (SRE) | vista combinada de un servicio | latencia, tráfico, errores, saturación |

- Latencia siempre en **percentiles** (p50, p95, p99), nunca solo el promedio: el
  promedio esconde la cola larga que es la que afecta a usuarios reales.
- Cada métrica de negocio relevante (órdenes creadas, pagos fallidos) además de las
  técnicas — un sistema puede estar "sano" técnicamente y roto para el negocio.

## 3. Tracing distribuido (OpenTelemetry)

- Un **trace** por flujo de negocio de punta a punta, compuesto de **spans** (una
  unidad de trabajo: un handler, una query, una llamada saliente); el contexto
  (trace id, span id) se **propaga** entre servicios vía headers (`traceparent` de
  W3C Trace Context) para que el trace no se corte al cruzar un límite de red.

```javascript
const sdk = new opentelemetry.NodeSDK({
  resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: 'orders-service' }),
  traceExporter,
  metricReader,
  instrumentations: [getNodeAutoInstrumentations()],
});
sdk.start();

process.on('SIGTERM', () => {
  sdk.shutdown().finally(() => process.exit(0));
});
```

- Paquetes reales del SDK de Node: `@opentelemetry/sdk-node`, `@opentelemetry/api`
  (para instrumentar manualmente: `trace`, `context`, `SpanKind`), y
  `@opentelemetry/semantic-conventions` para nombres de atributo estándar
  (`ATTR_HTTP_REQUEST_METHOD`, `ATTR_DB_SYSTEM_NAME`, etc.) en vez de inventar los
  propios — así los spans son legibles por cualquier backend de observabilidad.
- Instrumentación automática (`getNodeAutoInstrumentations()`) para HTTP/DB/frameworks
  conocidos primero; spans manuales solo para lógica de negocio que valga la pena ver
  en el trace (no envuelvas cada función privada en un span).
- Apagá el SDK ordenadamente (`sdk.shutdown()`) en el mismo hook de graceful shutdown
  del proceso — spans en vuelo se pierden si el proceso muere sin flushear el exportador.

## 4. SLI, SLO y error budget

- **SLI** (Service Level Indicator): una métrica medible de la experiencia del usuario
  (ej. % de requests con latencia < 300ms, % de requests exitosos).
- **SLO** (Service Level Objective): el objetivo sobre ese SLI en una ventana de tiempo
  (ej. 99.9% de requests exitosos en 30 días) — negociado con el negocio, no arbitrario.
- **Error budget**: el margen que el SLO permite fallar (100% - SLO). Cuando se agota,
  la prioridad cambia a estabilidad por sobre features nuevas — es una herramienta de
  decisión, no solo un número en un dashboard.

## 5. Alertas por síntoma, no por causa

- Alertá sobre lo que el usuario percibe (tasa de error alta, latencia p99 degradada,
  SLO en riesgo), no sobre cada causa posible (CPU al 80%, una excepción puntual) — una
  causa puede no afectar al usuario; un síntoma siempre importa.
- Toda alerta que dispara debe ser **accionable**: si nadie puede hacer nada al
  recibirla, no es una alerta, es ruido que entrena a ignorar el canal (alert fatigue).
- Alertas críticas (afectan usuarios ahora) van a un canal que despierta a alguien;
  degradaciones tempranas (error budget consumiéndose rápido) a un canal de revisión,
  no la misma urgencia para ambas.

## 6. Cardinalidad

- Una métrica con una etiqueta de alta cardinalidad (`user_id`, `order_id`,
  `request_id` como label) multiplica las series de tiempo generadas y puede tumbar el
  backend de métricas o disparar el costo. Esos identificadores van en **logs o traces**
  (donde son un campo, no una serie nueva), no como label de una métrica.
- Etiquetas de métricas: valores de un conjunto acotado y estable (`status_code`,
  `method`, `route` sin interpolar el id — `/orders/:id`, no `/orders/8f14e`).

## 7. Health checks, dashboards y runbooks

- `/health` y `/ready` expuestos y consumidos por el orquestador (ver
  `backend-development` §11) — son la señal más básica y deben existir antes que
  cualquier dashboard sofisticado.
- Un dashboard por servicio con los golden signals arriba de todo, visible para
  cualquiera del equipo sin pedir acceso especial — la visibilidad es parte de la
  observabilidad, no un extra.
- Cada alerta accionable enlaza a un **runbook**: qué significa esta alerta, primeros
  pasos de diagnóstico, a quién escalar si no se resuelve — sin esto, cada incidente se
  investiga desde cero.

## Anti-patrones

- Loguear el objeto de request/usuario completo sin filtrar campos sensibles.
- Trace id que se pierde al cruzar a un job en cola o a otro servicio.
- Alertar sobre CPU/memoria sin verificar si afecta al SLO del usuario.
- Un label de métrica con `user_id`/`order_id` (cardinalidad no acotada).
- Dashboard que solo muestra promedios de latencia, nunca percentiles.
- Alerta sin runbook: cada vez que dispara, alguien reinventa el diagnóstico.

## Checklist

- [ ] Logs en JSON con `traceId` propagado a través de servicios y jobs.
- [ ] Ningún log incluye PII ni secretos, ni siquiera en nivel debug.
- [ ] Métricas RED/USE con latencia en percentiles (p50/p95/p99), no solo promedio.
- [ ] Tracing con contexto propagado entre servicios (W3C Trace Context) y shutdown ordenado del SDK.
- [ ] SLO definidos y acordados con negocio; error budget usado para priorizar.
- [ ] Alertas basadas en síntoma percibido por el usuario, todas accionables.
- [ ] Ninguna métrica usa un identificador de alta cardinalidad como label.
- [ ] `/health` y `/ready` expuestos; dashboard de golden signals accesible al equipo.
- [ ] Toda alerta crítica enlaza a un runbook.
