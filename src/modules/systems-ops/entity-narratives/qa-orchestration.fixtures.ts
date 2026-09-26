/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import type { EntityBusinessNarrative } from './entity-narrative.types.js';

/** Corridas QA de N personas sintéticas: plan, corrida, personas, pasos, eventos, recursos, secretos y workers (schema `platform_ops`). */
export const QA_ORCHESTRATION_NARRATIVES: EntityBusinessNarrative[] = [
  {
    tableName: 'qa_run_plans',
    whyExists:
      'Guarda lo que la preparación (preflight) calculó antes de lanzar una corrida: la plantilla y su versión, el recorte contra la política del entorno, los bloqueos encontrados y el presupuesto de solicitudes y duración. Es la promesa que después se puede comparar con lo que ocurrió.',
    whyNotDelete:
      'El lanzamiento exige un plan vigente con su hash: sin la fila, cualquier cambio en la receta o en la política entre preparar y lanzar pasaría sin que nadie lo note (PLAN_CHANGED deja de poder detectarse). También es lo que explica por qué una corrida se bloqueó y con qué motivo humano.',
    decisionContribution:
      'Permite al operador decidir si lanza o no con lo que el sistema le dice que va a pasar: cuántas solicitudes, cuánto tiempo, qué actores hacen falta y qué proveedores externos se van a tocar. Un plan BLOQUEADO con causa evita lanzar corridas que fallarían a medio camino.',
    usageExample:
      'Un operador prepara el alta completa de 20 comercios; el plan sale BLOCKED con PLATFORM_SERVICE_UNAVAILABLE porque el Motor no responde. No se lanza nada, nadie gasta cuota de proveedores y el motivo queda escrito.',
    systemsExplanation:
      'Tabla en `platform_ops` con `_tenant_id`, `plan_hash`, `recipe_hash`, `status` (READY|BLOCKED), `blockers_json`, `plan_json` y `expires_at` (15 min). El lanzamiento compara `plan_hash` y la caducidad antes de crear la corrida. Sólo la escribe el módulo qa-orchestration; es de bajo volumen y puede purgarse por antigüedad una vez que la corrida asociada terminó.',
  },
  {
    tableName: 'qa_runs',
    whyExists:
      'Es la corrida en sí: quién la lanzó, con qué plan, cuántas personas, en qué estado va y con qué veredicto terminó. Es la unidad que el portal enseña y sobre la que se cancela, se reanuda y se concilia con el simulador de proveedores.',
    whyNotDelete:
      'Sin ella no hay evidencia de que un flujo fue probado, ni con qué versión de receta ni con qué resultado. Los contadores y el veredicto (PASSED, FAILED, INCONCLUSIVE) son lo que un release usa para decidir si un flujo sigue funcionando después de un cambio; borrarla borra esa prueba.',
    decisionContribution:
      'El veredicto y la tasa de pasos aprobados sostienen la decisión de promover o frenar un despliegue, y la idempotencia por clave impide lanzar dos veces la misma corrida por un doble clic. Una corrida activa por tenant evita que dos operadores compitan por los mismos cupos.',
    usageExample:
      'Tras un cambio en la verificación de identidad, el operador lanza 20 personas del ciclo completo. La corrida termina FAILED con 20 fallos en el mismo paso: el cambio rompió el flujo y se revierte antes de llegar a TEST.',
    systemsExplanation:
      'Tabla en `platform_ops` con `_tenant_id`, FK al plan, `status` (QUEUED…COMPLETED|CANCELLED|TIMED_OUT|FAILED_INFRASTRUCTURE), `verdict`, `counters_json`, `idempotency_key` (única por tenant), `seed`, `namespace` del simulador, `deadline_at` y `job_id` del trabajo durable. La escribe el worker con cerco por `lease_epoch`: un worker que perdió el arriendo no puede pisar el estado.',
  },
  {
    tableName: 'qa_persona_runs',
    whyExists:
      'Cada persona sintética de la corrida es una fila: su clave determinista, su estado, su resultado y el paso donde se detuvo. Es lo que permite reanudar una corrida sin repetir personas ya terminadas y explicar el veredicto persona a persona.',
    whyNotDelete:
      'Es el punto de control de la recuperación: tras una caída del worker, las personas COMPLETED no se rehacen y las RUNNING se retoman desde su último paso. Sin la tabla, un reinicio duplicaría clientes y comercios sintéticos y volvería a gastar cuota de proveedores.',
    decisionContribution:
      'Los recuentos por estado (PASSED, FAILED, BLOCKED, CANCELLED) son la base del veredicto; y ver qué personas fallaron y en qué paso permite decidir si es un defecto del producto, del entorno o de la receta.',
    usageExample:
      'Se mata el worker a mitad de una corrida de 20 personas. Al volver, retoma las 7 que estaban RUNNING desde su paso pendiente y no toca las 13 ya terminadas: el total sigue siendo 20 clientes, sin duplicados.',
    systemsExplanation:
      'Tabla en `platform_ops` con FK a `qa_runs`, `persona_key` única por corrida, `ordinal`, `status`, `outcome`, `current_step_key` y `finished_at`. Las escrituras llevan el cerco de época del worker; el índice por (run_id, status) sirve la reanudación y los contadores.',
  },
  {
    tableName: 'qa_step_runs',
    whyExists:
      'Registra cada paso que una persona ejecutó: qué endpoint, con qué actor, cuántos intentos, qué respondió el sistema y por qué pasó o falló. Es la evidencia fina de la corrida, la que se abre cuando el veredicto no basta.',
    whyNotDelete:
      'Sin los pasos, un FAILED es una palabra sin causa. Aquí está la aserción que falló, el código de error del backend y la petición saneada; es lo que convierte la corrida en un informe de defecto reproducible en vez de en un semáforo.',
    decisionContribution:
      'La causa raíz por paso separa el fallo del producto (422 con código de negocio) del fallo del entorno (timeout, 5xx) y del de la receta (aserción mal escrita), y con ello a quién le toca actuar. Los pasos NOT_APPLICABLE con motivo evitan leer una omisión como cobertura.',
    usageExample:
      'Una corrida del alta de comercios falla en `partner.submit` con PARTNER_SUBMISSION_INCOMPLETE: faltan power_of_attorney y bank_qr. El paso muestra la respuesta exacta y se corrige el flujo, no la aserción.',
    systemsExplanation:
      'Tabla en `platform_ops` con FK a la persona, `step_key`, `visit_index` (único por persona y paso), `logical_operation_id`, `status`, `attempts_json`, `evidence_json` saneada (sin tokens ni códigos), `requests_issued` y `root_cause_step_key`. Se escribe con anticipo (RUNNING antes de enviar) para que un reinicio sepa qué operación pudo haber tenido efecto.',
  },
  {
    tableName: 'qa_run_events',
    whyExists:
      'Es la línea de tiempo de la corrida: lanzada, persona iniciada o terminada, cancelación pedida, recuperada tras reinicio, cerrada. El portal la sondea para pintar el progreso sin releer todas las tablas.',
    whyNotDelete:
      'Es la única fuente ordenada de lo que pasó y cuándo. Sin ella, la reconstrucción de un incidente del propio motor de QA (una corrida atascada, una recuperación fallida) no tiene secuencia; y el sondeo incremental del portal (`after=`) deja de funcionar.',
    decisionContribution:
      'Permite decidir si una corrida que parece colgada de verdad avanza, y medir cuánto tardó cada fase; en una cancelación demuestra cuándo se pidió y cuándo se completó.',
    usageExample:
      'Una corrida lleva 10 minutos RUNNING. Los eventos muestran que el worker latió y 3 personas terminaron en los últimos 2 minutos: no está colgada, está esperando cupo de admisión.',
    systemsExplanation:
      'Tabla append-only en `platform_ops` con FK a `qa_runs`, `sequence` única por corrida, `event_type`, `payload_json` saneado y `occurred_at`. La secuencia se asigna con la fila de `qa_runs` bloqueada (FOR UPDATE): sin ese cerrojo dos personas terminando a la vez chocaban en la clave única y tumbaban el trabajo.',
  },
  {
    tableName: 'qa_run_resources',
    whyExists:
      'Anota cada recurso que la corrida creó en el sistema de destino: clientes, comercios, usuarios de comercio, casos de soporte. Es el inventario que permite reconocer y limpiar lo sintético y no confundirlo con datos reales.',
    whyNotDelete:
      'Sin este inventario, los clientes y comercios sintéticos quedan mezclados con los reales y nadie puede decir con certeza cuáles borrar. Es también lo que prueba que la corrida no tocó recursos ajenos: todo lo que creó está aquí, con su corrida.',
    decisionContribution:
      'Sostiene la decisión de purgar datos de prueba de un entorno y la comprobación de que una corrida se mantuvo dentro de su ámbito. Cuenta cuántos recursos reales produjo cada plantilla, que es el coste de correrla.',
    usageExample:
      'Antes de una demo en TEST se purgan los datos sintéticos: la tabla lista los 600 clientes y 40 comercios creados por corridas QA, con su corrida, y nada más se toca.',
    systemsExplanation:
      'Tabla en `platform_ops` con FK a `qa_runs`, `persona_key`, `service`, `resource_type`, `resource_id` (únicos por corrida), `cleanup_strategy` y `cleanup_result`. Se escribe al extraer identificadores de las respuestas de cada paso; nunca guarda tokens ni datos personales, sólo identificadores y cómo se limpia cada uno.',
  },
  {
    tableName: 'qa_run_secrets',
    whyExists:
      'Guarda, cifrado, el token que el simulador de proveedores entregó para el espacio de nombres de la corrida. El worker lo necesita para leer el journal y el buzón, y el middleware para validar que una petición marcada como QA pertenece a una corrida viva.',
    whyNotDelete:
      'Sin la fila, una corrida en marcha pierde el acceso a su journal y no puede conciliar las llamadas a proveedores: el veredicto pasaría a INCONCLUSIVE. Y separar el secreto de la corrida es lo que permite que `qa_runs` y sus eventos se lean sin exponer credenciales.',
    decisionContribution:
      'Es lo que hace fiable la evidencia externa: la conciliación contra el journal del simulador sólo vale si el token que firmó ese espacio de nombres es el de esta corrida. Sin él, «SEGIP fue llamado» sería una afirmación sin prueba.',
    usageExample:
      'El worker se reinicia a mitad de corrida; recupera el token cifrado, vuelve a abrir el journal del simulador y la conciliación final confirma las 60 llamadas a SEGIP de las 20 personas.',
    systemsExplanation:
      'Tabla en `platform_ops` con FK única a `qa_runs`, `mock_run_token_encrypted` (cifrado con `encryptSecret`, clave del servidor), `mock_epoch` y `expires_at`. Sólo el módulo qa-orchestration la lee; jamás sale por la API ni va a la evidencia. Se puede borrar al cerrar la corrida: el journal ya está conciliado y el espacio de nombres cerrado en el simulador.',
  },
  {
    tableName: 'qa_worker_heartbeats',
    whyExists:
      'Cada worker que ejecuta corridas QA deja su latido: identidad, última señal y corrida que atiende. Es lo que permite al portal decir «hay un worker disponible» antes de ofrecer el botón de lanzar.',
    whyNotDelete:
      'Sin latidos, la preparación no puede distinguir «no hay worker» de «el worker está ocupado», y una corrida QUEUED se quedaría esperando sin que nadie lo sepa. Es también la base para detectar arriendos vencidos y retomar trabajos huérfanos.',
    decisionContribution:
      'Convierte WORKER_UNAVAILABLE en un bloqueo explícito de la preparación en vez de en una espera indefinida, y da a operaciones la señal de que el consumidor QA de un entorno está apagado o caído.',
    usageExample:
      'En DEV el consumidor QA está apagado por configuración. La preparación devuelve WORKER_UNAVAILABLE con el mensaje humano y el operador sabe que no es su plantilla lo que falla.',
    systemsExplanation:
      'Tabla en `platform_ops` con `worker_id` único, `last_seen_at` y `version` del worker. Se considera vivo un worker con latido en los últimos tres intervalos (mínimo 30 s). Es de tamaño acotado (una fila por worker) y se refresca en cada tick del consumidor.',
  },
];
