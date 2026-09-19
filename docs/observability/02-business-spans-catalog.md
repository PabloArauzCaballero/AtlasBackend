# Fase 8 — Catálogo de spans de negocio

Los spans que este backend abre a mano, por qué existen y qué NO llevan.

## Criterio de admisión

Un span de negocio entra sólo si cumple las dos condiciones:

1. **No es coextensivo con una petición HTTP.** Si la operación es 1:1 con su endpoint, el span
   del servidor ya la delimita y uno propio sería un duplicado sin información. La regla
   descartó `auth.authenticate` y la fachada de alta, y en ambos casos lo que faltaba no era el
   tramo sino el **desenlace** — que se añade como atributo del span activo.
2. **Responde una pregunta que la instrumentación automática no responde.** «Cuánto tardó la
   consulta» lo contesta `pg`. «De qué escalón salió esta decisión» no lo contesta nadie.

## Spans

### `credit.evaluate`

| | |
| --- | --- |
| Archivo | `src/modules/decision-engine/credit-decision-engine.service.ts` |
| Tipo | INTERNAL |
| Módulo | `credit` |
| Atributos | `app.module`, `app.operation`, `app.entity.type=credit-application`, `app.entity.id`, `app.tenant.id`, `decision.outcome` |
| Eventos | `engine.unavailable` (con `decision.reason`) |

**Motivo de negocio.** Agrupa en un solo tramo legible la proyección de variables, la resolución
del artefacto vigente y la llamada al Motor. Tiene tres llamadores, uno de ellos dentro del
proceso de suscripción, así que no duplica ningún span de servidor.

**Decisión de diseño.** Un motor inalcanzable **no** marca el span como error: es una degradación
prevista que el dominio traduce a revisión humana. Marcarla confundiría «la política dijo que no»
con «no llegué a preguntar», que es justo la distinción que ese servicio existe para preservar.
Queda como evento, visible sin contaminar la tasa de error.

**Privacidad.** No lleva importe, plazo, moneda, producto ni identidad del solicitante. El
desenlace pertenece a una lista cerrada de cuatro valores.

### `risk.assess`

| | |
| --- | --- |
| Archivo | `src/modules/risk/application/risk-policy-decision.service.ts` |
| Tipo | INTERNAL |
| Módulo | `risk` |
| Atributos | `app.module`, `app.operation`, `app.entity.type=customer`, `app.entity.id`, `app.tenant.id`, `risk.assessment.type`, `decision.outcome`, `risk.decision.source` |

**Motivo de negocio.** `risk.decision.source` dice de qué escalón salió el veredicto —motor
gobernado, ruleset local o heurística de arranque—, que es la primera pregunta ante un resultado
raro y hoy sólo consta en una fila de la base.

**Por qué aquí y no en `RiskService.createRiskAssessment`.** Ese método es 1:1 con
`POST …/risk-assessments`. Este no: se invoca también desde el recorrido de onboarding, donde
aparece anidado y muestra qué parte del alta costó el tiempo.

**Privacidad.** Los puntajes **no** se publican: son la salida de un modelo sobre datos
personales. Sólo el tipo de evaluación y el desenlace, ambos de cardinalidad cerrada.

### `customer.register`

| | |
| --- | --- |
| Archivo | `src/modules/customer-onboarding/application/use-cases/start-onboarding.use-case.ts` |
| Tipo | INTERNAL |
| Módulo | `customer-onboarding` |
| Atributos | `app.module`, `app.operation`, `app.entity.type=customer`, `app.tenant.id`, `onboarding.source.type` |
| Eventos | `guards.passed`, `password.hashed` |

**Motivo de negocio.** Reparte el alta en tres tramos que hoy no se distinguen: comprobaciones
previas, hash de contraseña y escritura atómica. El segundo es Argon2, que es CPU cara y suele
ser el grueso del tiempo de un alta sin que nada lo delate.

**Decisión de diseño.** Los hitos van como **eventos** y no como spans hijos: marcan instantes
dentro de una misma operación, no llamadas a otro componente.

**Privacidad.** Ningún atributo lleva teléfono, correo, contraseña ni sus hashes.

### `notification.dispatch`

| | |
| --- | --- |
| Archivo | `src/modules/notifications/notification-orchestrator.service.ts` |
| Tipo | INTERNAL |
| Módulo | `notifications` |
| Atributos | `app.module`, `app.operation`, `notification.channel`, `notification.provider`, `notification.outcome` |

**Motivo de negocio.** Se invoca desde el despacho del outbox y desde las tandas de campaña, es
decir **dentro** de operaciones mayores. Sin él, una campaña aparece en la traza como un único
bloque opaco y no se puede ver qué canal se atascó.

**Decisión de diseño.** El error de entrega se **absorbe** para no tumbar la tanda, pero el span
sí queda marcado: una entrega que falla en silencio es exactamente el fallo que nadie ve hasta
que alguien reclama.

**Privacidad.** Nunca el destinatario, el asunto ni el cuerpo — son, literalmente, el mensaje
que se envía a una persona. Canal y proveedor son catálogos cerrados.

### `outbox.publish`

| | |
| --- | --- |
| Archivo | `src/platform/events/sequelize-outbox-writer.ts` |
| Tipo | **PRODUCER** |
| Atributos | `messaging.system=atlas-outbox`, `messaging.destination.name=outbox_events`, `messaging.operation.type=send`, `app.event.type`, `app.entity.type`, `app.module` |

**Motivo de negocio.** Marca el punto exacto en el que el trabajo deja de ser síncrono. El
portador de traza se inyecta **dentro** de este span, así que el span consumidor que abra el
relay —segundos o minutos después, en otro proceso— cuelga de aquí.

### `outbox.dispatch`

| | |
| --- | --- |
| Archivo | `src/platform/events/outbox-relay.service.ts` |
| Tipo | **CONSUMER** |
| Atributos | `messaging.*`, `app.event.type`, `app.entity.type`, `app.job.attempt`, `app.job.outcome` |

**Motivo de negocio.** Es el único punto del backend donde la traza cruza de un proceso a otro.
`app.job.attempt` responde la pregunta habitual —«¿por qué este aviso llegó tarde?»—, que casi
siempre se contesta con «era el tercer reintento» y hoy sólo consta en una columna que nadie mira.

**Decisión de diseño.** Un reintento **no** marca el span como error; la DLQ (`deadLettered`,
`quarantined`) sí, para que pueda buscarse en Jaeger sin depender de que alguien consulte la tabla.

### `job.run` y `job.tenant.run`

| | |
| --- | --- |
| Archivo | `src/modules/runtime-jobs/runtime-jobs-scheduler.service.ts` |
| Tipo | INTERNAL, **traza raíz** (`root: true`) |
| Atributos de `job.run` | `app.module`, `app.operation`, `app.job.name`, `app.job.schedule.interval.ms`, `app.job.outcome`, `app.job.processed.count` |
| Atributos de `job.tenant.run` | `app.job.name`, `app.tenant.id` |

**Motivo de negocio.** Estas tandas no nacen de ninguna petición: heredar el contexto de lo que
el proceso estuviera haciendo colgaría el trabajo de fondo de una traza ajena y arbitraria.

**Decisión de diseño 1 — dónde empieza.** El span abre **antes** de pedir el liderazgo, no
después. El `SET NX` a Redis está instrumentado y sin un span padre generaría una traza huérfana
por tick y por réplica; además «esta réplica nunca es líder» es una pregunta real de operación,
que así se responde mirando `app.job.outcome=not_leader`.

**Decisión de diseño 2 — granularidad.** Hay un span por **inquilino**, no por registro. El
número de spans no puede depender del volumen de datos. Si los inquilinos activos llegan a ser
miles, esto tiene que pasar a lotes.

**Decisión de diseño 3 — sin `app.job.execution.id`.** El briefing lo sugiere; aquí no se emite.
El `trace_id` **ya** es el identificador de la ejecución y **ya** aparece en cada línea de log
(Fase 6), de modo que el cruce log↔traza funciona sin él. Un atributo que nada más cruza es ruido.

## Atributos añadidos sin abrir span

Cuando la operación ya está delimitada por el span del servidor, lo que falta es el desenlace:

| Operación | Archivo | Atributos |
| --- | --- | --- |
| Login | `src/modules/auth/auth.service.ts` | `auth.actor.type`, `auth.outcome` |
| Fallo HTTP | `src/common/filters/http-exception.filter.ts` | `error.type`; 5xx además marca el span |

`auth.outcome` toma valores de un catálogo cerrado (`success`, `actor_not_found`,
`no_credentials`, `account_locked`, …). **Nunca** el identificador que se intentó usar.

## Riesgos de privacidad revisados

| Atributo | Riesgo evaluado | Veredicto |
| --- | --- | --- |
| `app.entity.id` | Identificador interno de solicitud o cliente | Admitido: es opaco, no reidentifica fuera de la base, y sin él una traza no se puede atar a su caso |
| `app.tenant.id` | Cardinalidad | Admitido: los inquilinos son decenas, no millones |
| `decision.outcome` | ¿Revela una decisión de crédito? | Admitido: sin importe ni identidad, no es un dato personal por sí solo |
| `notification.channel` | — | Admitido: catálogo cerrado |
| `auth.outcome` | Enumeración de cuentas | Admitido: el motivo no dice **qué** cuenta, y Jaeger no es un canal público |
