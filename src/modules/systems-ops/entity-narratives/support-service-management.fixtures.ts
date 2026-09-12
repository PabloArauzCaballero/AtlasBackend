/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import type { EntityBusinessNarrative } from './entity-narrative.types.js';

/** Motor de soporte, atención, casos y conocimiento (schema `support`). */
export const SUPPORT_SERVICE_MANAGEMENT_NARRATIVES: EntityBusinessNarrative[] = [
  {
    tableName: 'support_queues',
    whyExists:
      'La atención se reparte por competencia y por audiencia, no por quien esté mirando la pantalla. Esta tabla declara qué colas existen, a quién sirve cada una, qué habilidades exige y a qué cola desborda cuando no da abasto.',
    whyNotDelete:
      'Sin colas, «asignar a cualquier agente disponible» significa que un agente de consumidores puede terminar leyendo el expediente de un comercio y que un caso de fraude cae en la cola de consultas. Se pierde la separación de funciones y con ella la posibilidad de medir capacidad por equipo.',
    decisionContribution:
      'Decide a quién se enruta cada caso y qué compromiso de SLA se le aplica, y permite dimensionar personal: una cola con backlog persistente y agentes al límite es la evidencia con la que se justifica contratar o redistribuir habilidades.',
    usageExample:
      'Un comercio abre un caso de conciliación. La categoría lo enruta a `partner_operations`, cuya política exige la habilidad RECONCILIATION; el enrutador descarta a los agentes de consumo aunque estén libres y lo reserva en el especialista con menos carga.',
    systemsExplanation:
      'Tabla en `support` con `_tenant_id`, `queue_code` único por tenant, `context_type`, `skills_required_json`, `default_priority`, `sla_policy_code` y `overflow_queue_id` autorreferencial. La lee el enrutador en cada solicitud de canal; su borrado es lógico. Modo de fallo: una cola sin agentes con sus habilidades deja canales encolados indefinidamente, visible en la métrica de profundidad de cola.',
  },
  {
    tableName: 'support_sla_policies',
    whyExists:
      'Un compromiso de atención sólo significa algo si está escrito, versionado y fechado. Esta tabla guarda, por prioridad, en cuánto se acusa recibo, se responde, se actualiza y se resuelve, y con qué calendario laboral se cuenta ese tiempo.',
    whyNotDelete:
      'Es la prueba de qué se prometió cuando se abrió cada caso. Sin ella los indicadores de cumplimiento pierden su referencia y cualquier cambio de configuración reescribiría el pasado: los incumplimientos del trimestre anterior desaparecerían al relajar los plazos.',
    decisionContribution:
      'Determina cuándo un caso entra en riesgo, cuándo se avisa y cuándo se escala por incumplimiento. También sostiene la negociación con partners: un compromiso distinto por segmento se expresa como otra política, no como una excepción informal.',
    usageExample:
      'Se publica la versión 2 de `atlas_support_default` para P2 subiendo la primera respuesta de 15 a 20 minutos. Los casos abiertos antes siguen apuntando a la versión 1 y se miden con 15 minutos; los nuevos, con 20. El informe mensual distingue ambos grupos.',
    systemsExplanation:
      'Tabla en `support` con unicidad por (`_tenant_id`, `policy_code`, `priority`, `version_number`), plazos en minutos, banderas de pausa por estado de espera y `business_hours_json`. La escribe el catálogo sembrado o la administración; la leen `support_sla_clocks` y el servicio de SLA. Nunca se actualiza una versión publicada: se inserta otra con `previous_version_id`.',
  },
  {
    tableName: 'support_case_categories',
    whyExists:
      'Clasificar es enrutar. Esta tabla es el árbol jerárquico de motivos y submotivos —dominio, tipo, sensibilidad, cola por defecto— con el que se convierte «no me reconocen el pago» en algo que se puede contar, comparar y dirigir al equipo correcto.',
    whyNotDelete:
      'Sin taxonomía, la clasificación vuelve a ser texto libre y se pierde toda la analítica de causas: no se puede saber qué motivo genera doscientos casos al mes ni convertirlo en un artículo de conocimiento. También se pierde la sensibilidad heredada, que es lo que hace que un caso de fraude nazca restringido.',
    decisionContribution:
      'Aporta la cola, el impacto, la urgencia y la sensibilidad por defecto de cada caso, y es la dimensión principal de los informes de causas repetidas que alimentan la gestión de problemas y las mejoras de producto.',
    usageExample:
      'La categoría `PAYMENT_PROOF_NOT_RECOGNIZED` enruta a la cola de operaciones con impacto individual y urgencia alta. Al ver que acumula 180 casos mensuales con la misma resolución, se publica un artículo y la categoría pasa a ofrecerlo antes de permitir abrir el caso.',
    systemsExplanation:
      'Tabla en `support` con `parent_category_id` autorreferencial, `catalog_version` y unicidad por (`_tenant_id`, `category_code`, `catalog_version`). Reorganizar la taxonomía publica una versión nueva sin tocar la anterior, así que los casos ya clasificados conservan el criterio con el que se clasificaron. La lee la apertura de casos y el triage.',
  },
  {
    tableName: 'support_canned_responses',
    whyExists:
      'Las explicaciones que se repiten cien veces al día —plazos, cómo recuperar acceso, la advertencia de no compartir códigos— deben decirse igual siempre. Esta tabla guarda esas respuestas aprobadas, con su versión y las variables que se les permite insertar.',
    whyNotDelete:
      'Sin plantillas versionadas, cada agente improvisa su propia redacción y la empresa pierde el control de lo que afirma ante sus clientes; y sin lista cerrada de variables, una plantilla puede terminar insertando datos sensibles en un mensaje que queda para siempre en la transcripción.',
    decisionContribution:
      'Estandariza la comunicación y reduce el tiempo de respuesta sin sacrificar exactitud; su uso y su tasa de reapertura asociada indican qué explicaciones funcionan y cuáles habría que reescribir o convertir en artículo público.',
    usageExample:
      'El agente inserta `security_never_asks_v2` al detectar que el cliente ofrece su código de verificación. La plantilla se envía sin retoques, queda en la transcripción con su versión y el equipo legal puede comprobar exactamente qué se advirtió y cuándo.',
    systemsExplanation:
      'Tabla en `support` con unicidad por (`_tenant_id`, `response_code`, `locale`, `version_number`), estado `draft|published|retired` y `previous_version_id`. La consulta la consola del agente filtrando por audiencia y equipo. Una versión publicada no se edita: se publica otra.',
  },
  {
    tableName: 'support_agent_profiles',
    whyExists:
      'Ser usuario interno no es lo mismo que estar habilitado para atender clientes. Este perfil declara quién atiende soporte, con qué nivel, en qué zona horaria, en qué idiomas y cuántas conversaciones simultáneas puede sostener.',
    whyNotDelete:
      'Es la fuente de la capacidad y de la elegibilidad. Sin ella cualquier rol interno podría entrar en la conversación de un cliente, y el enrutador no tendría contra qué comprobar si un agente puede aceptar otro chat: dos agentes acabarían con la misma conversación.',
    decisionContribution:
      'Decide a quién se le puede asignar cada canal y sostiene la medición de ocupación y utilización por agente y por nivel, que es la base para dimensionar turnos y detectar sobrecarga antes de que se traduzca en incumplimientos.',
    usageExample:
      'Un agente L1 con capacidad 3 tiene dos chats abiertos. Llega una solicitud y el enrutador la reserva en él con un UPDATE condicional que incrementa `active_channel_count` a 3; la siguiente solicitud ya no lo considera y busca a otro.',
    systemsExplanation:
      'Tabla en `support` con FK a `iam.internal_users`, unicidad por (`_tenant_id`, `internal_user_id`) y las columnas de capacidad y presencia en la misma fila. La reserva se hace con `UPDATE ... WHERE active_channel_count < max_concurrent_channels ... FOR UPDATE SKIP LOCKED`, que es un compare-and-set atómico. Modo de fallo: si el cierre de canal no libera el hueco, el agente deja de recibir trabajo; `GREATEST(...,0)` evita el contador negativo.',
  },
  {
    tableName: 'support_agent_skills',
    whyExists:
      'Atender fraude, privacidad o crédito exige preparación específica y una habilitación que caduca. Esta tabla registra qué sabe atender cada agente, con qué nivel de competencia y hasta cuándo vale esa habilitación.',
    whyNotDelete:
      'Sin ella el enrutado por competencias no existe y cualquier agente sería elegible para cualquier cola, incluidas las que manejan expedientes restringidos. También se perdería la vigencia: quien dejó el equipo hace meses seguiría siendo elegible porque nadie borró su fila.',
    decisionContribution:
      'Filtra a los candidatos del enrutador y permite planificar formación: una cola con demanda creciente y pocas habilitaciones vigentes es exactamente el cuello de botella que hay que resolver antes de que se traduzca en espera.',
    usageExample:
      'La cola `security_fraud` exige las habilidades SECURITY y FRAUD. El enrutador cuenta cuántas de las exigidas tiene cada candidato con `valid_until` no vencido y descarta a quien no las tenga todas, aunque esté libre.',
    systemsExplanation:
      'Tabla en `support` con FK a `support_agent_profiles` en cascada, unicidad por (`_tenant_id`, `agent_profile_id`, `skill_code`) y `competency_level` entre 1 y 5. Se consulta como subconsulta agregada dentro del UPDATE de reserva; el índice por `skill_code` sostiene esa comprobación.',
  },
  {
    tableName: 'support_cases',
    whyExists:
      'Es el expediente: el registro durable de un problema, solicitud, reclamo o incidente que alguien planteó a Atlas, con su clasificación, su responsable, su prioridad y su estado. Existe con independencia de cualquier chat, y sobrevive a todos los que tenga.',
    whyNotDelete:
      'Es la memoria de la relación con cada cliente y cada comercio cuando algo salió mal. Sin ella no se puede demostrar que un reclamo fue recibido y atendido, ni sostener una respuesta ante un requerimiento regulatorio, ni medir nada del servicio. Es también el objeto sobre el que actúa el bloqueo legal.',
    decisionContribution:
      'Sostiene el enrutado, la priorización y toda la medición del servicio (primera respuesta, resolución, reapertura, cumplimiento). Sus causas agregadas son la entrada de la gestión de problemas y de las decisiones de producto sobre qué arreglar primero.',
    usageExample:
      'Un cliente reporta que su comprobante no fue reconocido. El caso nace clasificado en `PAYMENT_EVIDENCE` con prioridad P2, se enruta a operaciones, se resuelve con `PAYMENT_EVIDENCE_ACCEPTED` y se cierra. Tres meses después, un reclamo formal sobre ese cobro se apoya en ese expediente.',
    systemsExplanation:
      'Tabla en `support` con `case_number` único por tenant (aleatorio, no correlativo), sujeto polimórfico validado por CHECK, punteros a cola, categoría, agente y versión de SLA, banderas de retención y bloqueo legal, y `last_event_sequence` para la cadena de eventos. Se actualiza porque es una proyección de estado, no evidencia; la evidencia está en `support_case_events`. Un trigger prohíbe el DELETE.',
  },
  {
    tableName: 'support_case_events',
    whyExists:
      'La fila del caso dice cómo está; esta tabla dice cómo llegó hasta ahí. Registra cada creación, clasificación, asignación, transferencia, escalamiento, pausa de reloj, resolución, cierre y reapertura, con su autor y su momento.',
    whyNotDelete:
      'Es la cadena de custodia del expediente. Sin ella no se puede demostrar que un caso pasó por cuatro manos en dos horas ni detectar manipulación interna, y una reapertura perdería la explicación de por qué se creyó resuelto. Es la evidencia que sostiene la respuesta ante un reclamo.',
    decisionContribution:
      'Permite auditar la calidad del proceso y decidir sobre él: dónde se atascan los casos, qué transferencias se repiten, qué agentes cierran demasiado rápido. También sostiene la reapertura fundada y la reconstrucción de un incidente.',
    usageExample:
      'Un supervisor revisa por qué un caso incumplió su SLA. La secuencia muestra que estuvo cuarenta minutos sin asignar, se escaló a seguridad y el reloj se pausó dos veces con su motivo; ninguna de esas cosas figura ya en la fila del caso.',
    systemsExplanation:
      'Tabla append-only en `support` con unicidad por (`case_id`, `sequence_number`), `payload_json` redactado antes de escribirse y cadena `previous_hash` → `event_hash` en SHA-256. La secuencia se obtiene incrementando `support_cases.last_event_sequence` en la misma sentencia que la lee. Un trigger prohíbe UPDATE y DELETE: alterar un evento del medio rompe la verificación de todos los posteriores.',
  },
  {
    tableName: 'support_assignments',
    whyExists:
      'La responsabilidad sobre un caso es un intervalo, no un campo: alguien la toma, la ejerce un tiempo y la suelta o la transfiere. Esta tabla guarda ese historial completo, con el motivo de cada entrada y de cada salida.',
    whyNotDelete:
      'Guardar sólo el responsable actual perdería que el caso estuvo dos horas en otra cola antes de llegar aquí, que es a menudo la explicación del incumplimiento. Sin el historial no hay forma de responder quién era responsable en un momento dado, ni de detectar el rebote sistemático de casos incómodos.',
    decisionContribution:
      'Alimenta la tasa de transferencia y el tiempo hasta la asignación, dos indicadores que revelan clasificación deficiente o falta de competencias en la cola de entrada, y sostiene la revisión de calidad sobre casos que cambiaron de manos muchas veces.',
    usageExample:
      'Un caso rebota tres veces entre L1 y operaciones. El historial muestra que las tres transferencias citan el mismo motivo, lo que lleva a corregir la regla de enrutado de esa categoría en vez de insistir con formación.',
    systemsExplanation:
      'Tabla en `support` con FK al caso y opcional al canal, `assignee_type` AGENT o TEAM validado por CHECK, e índice único parcial sobre `case_id` donde `released_at IS NULL`: sólo una asignación viva por caso. El servicio libera explícitamente antes de crear la siguiente. Un trigger prohíbe el DELETE.',
  },
  {
    tableName: 'support_sla_clocks',
    whyExists:
      'Cada compromiso del caso —acuse, primera respuesta, resolución, cierre— tiene su propio reloj, con su objetivo calculado en horario hábil y sus pausas registradas. Esta tabla es donde esos relojes viven y donde se marca el incumplimiento.',
    whyNotDelete:
      'Es la evidencia del cumplimiento. Sin ella no se puede afirmar ni negar que se respondió a tiempo, y las pausas dejarían de ser auditables: bastaría poner un caso «en espera» para que ningún plazo venciera nunca.',
    decisionContribution:
      'Dispara los avisos preventivos, las alertas de riesgo y el escalamiento por incumplimiento, y produce la tasa de cumplimiento por cola, prioridad y equipo con la que se revisan compromisos y dotación.',
    usageExample:
      'Un caso P2 abierto un viernes a las cinco de la tarde con calendario laboral vence el lunes por la mañana, no el sábado de madrugada. El reloj se pausa mientras se espera al cliente y el objetivo se corre exactamente lo que duró la pausa.',
    systemsExplanation:
      'Tabla en `support` con unicidad por (`case_id`, `metric_type`), `policy_version_id` guardado en el propio reloj y estados RUNNING, PAUSED, MET, BREACHED o CANCELLED. El índice parcial por `state` y `target_at` sostiene el barrido del vigilante. El cálculo de vencimiento usa el calendario de la política, no la zona del servidor.',
  },
  {
    tableName: 'support_resolutions',
    whyExists:
      'Resolver no es cambiar un estado: es documentar con qué código se resolvió, cuál fue la causa raíz, qué se le dijo al cliente y qué quedó anotado para el equipo. Esta tabla guarda esa doble redacción y su autor.',
    whyNotDelete:
      'Es la respuesta que se le dio a una persona y la explicación técnica que la sostiene. Sin ella, un caso cerrado es indistinguible de un caso abandonado, no se puede defender la decisión ante un reclamo y se pierde toda la analítica de causas.',
    decisionContribution:
      'Los códigos de resolución y de causa raíz agregados revelan qué problemas se repiten, cuáles tienen rodeo y cuáles exigen un cambio en el producto; también sostienen la resolución en primer contacto como indicador de calidad.',
    usageExample:
      'Doscientos casos al mes se cierran con `USER_GUIDANCE` y causa `USER_MISUNDERSTANDING` sobre la misma pantalla. La agregación justifica rediseñar esa pantalla en vez de seguir explicándola de a una.',
    systemsExplanation:
      'Tabla en `support` con unicidad por (`case_id`, `resolution_sequence`): una reapertura no borra la resolución anterior, la marca `superseded_at` y añade otra secuencia. `root_cause_code` admite UNKNOWN al cierre, para determinarse después en gestión de problemas. Un trigger prohíbe el DELETE.',
  },
  {
    tableName: 'support_case_links',
    whyExists:
      'Los casos se relacionan: uno duplica a otro, cien comparten la causa de un incidente mayor, uno es el seguimiento de otro cerrado fuera de la ventana de reapertura. Esta tabla declara esas relaciones de forma explícita y tipada.',
    whyNotDelete:
      'Sin los enlaces se pierde la agrupación de un incidente masivo y la trazabilidad entre un caso y su seguimiento: cada expediente volvería a parecer un hecho aislado y la magnitud real de una incidencia quedaría invisible.',
    decisionContribution:
      'Permite dimensionar el alcance de un incidente por número de casos vinculados, decidir la comunicación pública y priorizar la corrección; también evita trabajo duplicado al marcar duplicados sin cerrarlos por decreto.',
    usageExample:
      'Una caída del proveedor de SMS genera 340 casos de «no recibo el código». Se crea un caso maestro y los demás se enlazan como `CAUSED_BY`; cada uno conserva su respuesta y su SLA, y el maestro concentra la causa raíz.',
    systemsExplanation:
      'Tabla en `support` con unicidad por (`case_id`, `linked_case_id`, `link_type`), CHECK de tipos permitidos y CHECK que impide enlazar un caso consigo mismo. La escriben los agentes; la lee la vista de expediente. Un trigger prohíbe el DELETE.',
  },
  {
    tableName: 'support_case_references',
    whyExists:
      'Un caso casi siempre trata de algo concreto de Atlas: una compra, una cuota, un pago, una verificación de identidad, un QR. Esta tabla apunta a esas entidades sin copiarlas, para que el agente sepa de qué se está hablando.',
    whyNotDelete:
      'Sin la referencia, el contexto vuelve a llegar como texto pegado por el cliente —con números mal transcritos— y se pierde la posibilidad de cruzar casos con entidades: cuántos casos genera un comercio, una versión de la app o un tipo de producto.',
    decisionContribution:
      'Convierte el soporte en una fuente de señal para el resto del negocio: permite ver qué compras, qué partners o qué flujos concentran incidencias, y da al agente el contexto autorizado sin abrirle todo el perfil del cliente.',
    usageExample:
      'El cliente abre soporte desde la pantalla de una cuota. La app envía `installment_id` como referencia y el agente ve la cuota exacta sin pedirle que la describa, evitando el error de imputar el reclamo a la cuota equivocada.',
    systemsExplanation:
      'Tabla en `support` con unicidad por (`case_id`, `entity_type`, `entity_id`, `relation_type`) e índice por entidad para la consulta inversa. Guarda punteros y una etiqueta descriptiva, nunca una copia del estado: el dominio dueño sigue siendo la única verdad sobre esa entidad. Un trigger prohíbe el DELETE.',
  },
  {
    tableName: 'support_case_feedback',
    whyExists:
      'Cerrar un caso no significa que la persona haya quedado conforme. Esta tabla guarda la valoración de quien recibió la atención: satisfacción, esfuerzo percibido y comentario, una sola vez y sin posibilidad de retoque.',
    whyNotDelete:
      'Es la única voz del cliente sobre la calidad del servicio. Sin ella, la evaluación del soporte se apoyaría sólo en indicadores de velocidad, que se pueden mejorar cerrando rápido sin resolver, y se perdería la evidencia de insatisfacción que precede a un reclamo formal.',
    decisionContribution:
      'Alimenta CSAT y esfuerzo del cliente, contrapesa las métricas de productividad en la evaluación de agentes y marca los casos que la revisión de calidad debe mirar primero.',
    usageExample:
      'Un caso cerrado en diez minutos recibe una valoración de 1 con el comentario «no me resolvieron nada». La combinación de cierre rápido y valoración baja lo pone en la muestra de auditoría de calidad de esa semana.',
    systemsExplanation:
      'Tabla en `support` con unicidad por (`case_id`, `respondent_actor_type`, `respondent_actor_id`) y CHECK de rangos (1-5 y 1-7). El servicio nunca actualiza filas existentes y un trigger prohíbe el DELETE: una encuesta que el evaluado puede corregir mide su disciplina, no la calidad del servicio.',
  },
  {
    tableName: 'support_channels',
    whyExists:
      'Es la sesión de conversación entre alguien y soporte: chat en vivo o mensajería asíncrona. Guarda su estado, su cola, el agente que la atiende y el contador que da orden determinista a los mensajes.',
    whyNotDelete:
      'Sin el canal se pierde el contenedor de la transcripción y su contexto: quién la atendió, cuándo se abrió, por qué se cerró. Además `last_message_sequence` y `last_message_hash` son la base de la ordenación y de la cadena de integridad de los mensajes.',
    decisionContribution:
      'Sostiene la cola de espera, el tiempo hasta la atención y la tasa de abandono, y separa explícitamente cerrar la conversación de cerrar el caso, que es lo que impide que una caída de conexión se contabilice como problema resuelto.',
    usageExample:
      'Un cliente cierra el chat porque se queda sin batería. El canal pasa a CLOSED con motivo `USER_ENDED` y el caso sigue en `WAITING_INTERNAL`; cuando el agente termina la investigación, responde en un canal asíncrono del mismo expediente.',
    systemsExplanation:
      'Tabla en `support` con `channel_code` único por tenant, `case_id` opcional, estados validados por CHECK y `claim_version` para la toma concurrente. La secuencia de mensajes se reserva con `UPDATE ... RETURNING` sobre esta fila, lo que serializa por canal. Borrado lógico; un trigger prohíbe el DELETE físico.',
  },
  {
    tableName: 'support_channel_participants',
    whyExists:
      'Registra quién estuvo dentro de cada conversación, con qué papel y en qué intervalo. Estar dentro del canal es lo que autoriza a leerlo y a escribir en él, así que esta tabla es también el control de acceso de la transcripción.',
    whyNotDelete:
      'Sin el historial de participación no se puede saber quién pudo leer una conversación, que es justo lo que hay que poder responder ante una sospecha de acceso indebido. Borrar la fila al salir haría desaparecer la prueba de que alguien entró.',
    decisionContribution:
      'Sostiene la autorización por participación en vez de por rol, hace auditable la entrada de un supervisor a una conversación ajena y permite la transferencia cálida, donde dos agentes conviven un momento con el cliente.',
    usageExample:
      'Un supervisor entra a una conversación para ayudar y sale diez minutos después. Deja de poder leerla, pero queda registrado que estuvo dentro entre las 10:12 y las 10:22, con el motivo de entrada y de salida.',
    systemsExplanation:
      'Tabla en `support` con índice único parcial sobre (`channel_id`, `actor_type`, `actor_id`) donde `left_at IS NULL`: una sola participación viva por actor. Salir es un UPDATE de `left_at`, no un borrado; un trigger prohíbe el DELETE. La consulta de participación viva se ejecuta en cada lectura y escritura del canal.',
  },
  {
    tableName: 'support_messages',
    whyExists:
      'Es la transcripción: lo que se dijo, quién lo dijo y en qué orden, incluidas las notas internas del equipo. Es evidencia de lo que se comunicó, no un buffer de pantalla, y por eso ninguna fila se edita ni se borra jamás.',
    whyNotDelete:
      'Es la prueba de la comunicación entre Atlas y una persona. Sin ella no se puede sostener ni rebatir un reclamo sobre lo que se prometió, ni demostrar que se advirtió sobre no compartir códigos, ni reconstruir un incidente. Un mensaje editable convierte la conversación en la palabra de quien tenga acceso a la base.',
    decisionContribution:
      'Sostiene la primera respuesta medible, la revisión de calidad de la atención y la evidencia de cualquier disputa; su cadena de hash permite afirmar ante un tercero que la transcripción exportada es la original.',
    usageExample:
      'Un cliente pega su código de verificación. La vista guarda el texto redactado, el original queda cifrado, se escribe el evento de redacción y el hash se calcula sobre el original: la cadena sigue probando qué se escribió aunque casi nadie pueda leerlo.',
    systemsExplanation:
      'Tabla append-only en `support` con doble unicidad —(`channel_id`, `server_sequence`) y (`channel_id`, `client_message_id`)—, cuerpo visible y cuerpo cifrado, y cadena `previous_message_hash` → `integrity_hash`. La secuencia se reserva incrementando el contador del canal en la misma sentencia. Un trigger prohíbe UPDATE y DELETE; la idempotencia devuelve el mensaje existente ante un reintento.',
  },
  {
    tableName: 'support_message_relations',
    whyExists:
      'Un mensaje puede corregir a otro, responderlo, referenciarlo o sustituir su vista redactada. Como los mensajes no se editan, estas relaciones son la forma de expresar todo eso sin tocar una sola letra del original.',
    whyNotDelete:
      'Es lo que hace innecesario un endpoint de edición. Sin las relaciones, corregir un error obligaría a modificar el mensaje original —que la otra parte ya leyó— y la conversación pasaría a contar una historia distinta de la que ocurrió.',
    decisionContribution:
      'Permite a la interfaz marcar un mensaje como corregido posteriormente sin alterarlo, y deja auditable cuántas correcciones emite cada equipo, que es una señal de claridad de las plantillas y de la formación.',
    usageExample:
      'Un agente escribe una fecha equivocada de vencimiento. Envía un mensaje nuevo enlazado como `CORRECTS`; el cliente ve ambos, con el primero marcado como corregido, y el expediente conserva la prueba de que llegó a decirse.',
    systemsExplanation:
      'Tabla append-only en `support` con unicidad por (`message_id`, `related_message_id`, `relation_type`), CHECK de tipos y CHECK que impide relacionar un mensaje consigo mismo. Un trigger prohíbe UPDATE y DELETE. La lee la vista de transcripción junto con los mensajes.',
  },
  {
    tableName: 'support_attachments',
    whyExists:
      'Guarda los archivos que acompañan a un caso —comprobantes, capturas, planillas— con su hash, su tipo detectado, el resultado del escaneo de malware y, cuando son evidencia, su bloqueo contra borrado hasta una fecha.',
    whyNotDelete:
      'Sin esta tabla se pierde la cadena de custodia de la evidencia: qué archivo era, quién lo subió, si estaba limpio y si su contenido cambió. En un reclamo sobre un pago, el comprobante y su hash son a menudo la única prueba disponible.',
    decisionContribution:
      'Determina si un archivo puede ofrecerse para descarga (sólo tras el escaneo), si debe conservarse por retención o bloqueo legal, y si la evidencia sensible debe redirigirse al almacén especializado en vez de viajar por el chat.',
    usageExample:
      'Un cliente adjunta la foto de su comprobante. La fila nace con `malware_scan_status = pending` y el archivo no se ofrece a nadie; cuando el escáner lo marca limpio, el agente puede verlo, y el hash permite comprobar después que es el mismo archivo.',
    systemsExplanation:
      'Tabla en `support` con FK opcional al mensaje y al caso, `evidence_document_id` hacia `privacy.evidence_documents` para la evidencia sensible, y `object_lock_until` para el bloqueo. Índices por caso y por estado de escaneo pendiente. Admite UPDATE (el escaneo evoluciona) pero un trigger prohíbe el DELETE.',
  },
  {
    tableName: 'knowledge_articles',
    whyExists:
      'Es la identidad estable de un artículo de ayuda: su clave, su audiencia, su equipo responsable, su ciclo de revisión y qué versión está publicada. Es el enlace que se comparte y que no cambia aunque el texto sí.',
    whyNotDelete:
      'Sin el artículo se rompen los enlaces compartidos y se pierde el gobierno: quién es responsable de mantenerlo, cuándo toca revisarlo y a qué audiencia puede mostrarse. La audiencia como columna es lo que impide que una guía interna aparezca en el buscador del cliente.',
    decisionContribution:
      'Sostiene la deflexión —cuántos casos se evitan porque alguien encontró la respuesta— y, con los contadores de utilidad, señala qué artículos hay que reescribir y qué preguntas siguen sin respuesta escrita.',
    usageExample:
      'El artículo `no-recibo-el-codigo` acumula 4 000 lecturas y 82% de votos útiles; la categoría de casos equivalente cae a la mitad. Cuando la tasa de «no me sirvió» sube tras un cambio de producto, salta la revisión.',
    systemsExplanation:
      'Tabla en `support` con `article_key` único por tenant, `current_version_id` hacia la versión publicada (FK añadida después de crear la tabla de versiones) y estados DRAFT a RETIRED. Los contadores se actualizan con `increment` atómico. Borrado lógico.',
  },
  {
    tableName: 'knowledge_article_versions',
    whyExists:
      'Es el contenido concreto de un artículo: su título, su pregunta, su respuesta corta, su cuerpo, cuándo escalar y el vector de búsqueda en español. Cada versión guarda quién la redactó, quién la aprobó y cuándo se publicó.',
    whyNotDelete:
      'Es la prueba de qué decía la ayuda el día que alguien la leyó y actuó en consecuencia. Sin versiones, un artículo editable en caliente haría imposible responder a «yo seguí lo que decía su página», y la aprobación del dominio dejaría de significar nada.',
    decisionContribution:
      'La aprobación por versión sostiene el control de lo que la empresa afirma sobre crédito, seguridad, privacidad y pagos; el historial permite correlacionar un cambio de redacción con la variación de casos de esa categoría.',
    usageExample:
      'Se publica la versión 4 de la política de reapertura. La 3 queda RETIRED con su fecha, y ante un reclamo de febrero se puede mostrar exactamente el texto vigente ese mes, con su aprobador.',
    systemsExplanation:
      'Tabla en `support` con unicidad por (`article_id`, `locale`, `version_number`), `checksum` del contenido y `search_vector` como columna generada `tsvector` en español con índice GIN. La búsqueda filtra por audiencia y por estado PUBLISHED en el WHERE, nunca en la vista. Publicar retira las versiones anteriores del mismo idioma dentro de la misma transacción.',
  },
];
