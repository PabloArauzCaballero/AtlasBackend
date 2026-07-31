/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import type { EntityBusinessNarrative } from './entity-narrative.types.js';

/** Eventos de dominio, outbox y el canal de comunicación con el cliente (schemas `messaging` y `catalog`). */
export const COMMUNICATION_NARRATIVES: EntityBusinessNarrative[] = [
  {
    tableName: 'event_definitions',
    whyExists:
      'Declara el vocabulario de eventos de negocio del sistema: qué eventos existen, a qué familia pertenecen, qué payload esperan, qué tablas impactan y qué clasificación de datos llevan. Es el contrato entre quien emite y quien consume.',
    whyNotDelete:
      'Sin catálogo de eventos, cada módulo inventa nombres y formatos, los consumidores se rompen en silencio y nadie sabe qué eventos existen realmente. Se pierde además el control de clasificación y retención sobre payloads que suelen arrastrar datos personales.',
    decisionContribution:
      'Permite decidir qué eventos merecen notificación, cuáles son de alto volumen (`is_high_volume`) y por tanto necesitan tratamiento especial, y cuáles alimentan riesgo (`risk_dimension`). Es la base para diseñar integraciones sin descubrir el contrato leyendo código.',
    usageExample:
      'Se define `CUSTOMER_BLOCKED` con su esquema de payload y las tablas que impacta. El módulo de notificaciones se suscribe usando ese contrato, y cuando alguien cambia el payload sin actualizar la definición, el gate de catálogo lo detecta.',
    systemsExplanation:
      'Catálogo en `catalog` con `event_code` único, `event_family`, `source_package`, `target_tables_json`, `expected_payload_schema_json`, clasificación, retención, owner y estado de revisión. Es referenciado por `outbox_events.event_code` y por `user_notification_preferences.event_code`. Emitir un evento no declarado debería fallar la validación, no pasar silenciosamente.',
  },
  {
    tableName: 'outbox_events',
    whyExists:
      'Cuando algo importante pasa (un cliente se bloquea, un crédito se aprueba), hay que avisar a otros sistemas y al usuario. El outbox garantiza que ese aviso no se pierda aunque el proceso muera justo después de guardar el cambio.',
    whyNotDelete:
      'Es lo que hace confiable la integración entre el cambio de estado y su efecto externo. Sin outbox, la alternativa es publicar dentro de la transacción (y perder eventos si el broker falla) o después (y perderlos si el proceso muere). En ambos casos el negocio descubre el problema cuando un cliente no recibió un aviso legal.',
    decisionContribution:
      'Su estado, `attempts`, `last_error`, `failed_at` y `error_code` permiten decidir sobre reintentos, escalamiento y cola de mensajes muertos. La acumulación de eventos pendientes es una alerta operativa temprana de que algo aguas abajo está caído.',
    usageExample:
      'Se aprueba un crédito y en la misma transacción se inserta el evento `CREDIT_APPROVED`. El worker se cae; al reiniciar, toma el evento pendiente y lo procesa. El cliente recibe su notificación con retraso, pero la recibe.',
    systemsExplanation:
      'Tabla en `messaging` que implementa el patrón transactional outbox: el evento se inserta EN LA MISMA TRANSACCIÓN que el cambio de negocio y un worker lo publica después. `available_at`, `locked_at`, `locked_by` y `max_attempts` implementan backoff y lock de trabajo, evitando que dos workers tomen el mismo evento. `correlation_id`/`causation_id` encadenan el evento con la petición que lo originó. `idempotency_key` protege contra publicación doble. Es de alto volumen: requiere índice por (`status`, `available_at`) y archivado de procesados.',
  },
  {
    tableName: 'notification_templates',
    whyExists:
      'Los mensajes al cliente deben ser consistentes, revisables por legal y traducibles. Esta tabla guarda las plantillas por canal e idioma, en lugar de tener textos incrustados en el código.',
    whyNotDelete:
      'Sin plantillas versionadas no se puede probar qué texto exacto recibió un cliente, ni cambiar un mensaje sin desplegar, ni operar en más de un idioma. En comunicaciones con efecto legal (avisos de mora, cambios de condiciones), el texto es la obligación.',
    decisionContribution:
      'Permite decidir el contenido y el canal de cada comunicación sin ciclo de desarrollo, probar variantes y desactivar una plantilla problemática de inmediato. `payload_schema_json` evita enviar mensajes rotos por falta de variables.',
    usageExample:
      'Legal exige cambiar la redacción del aviso de mora. Se publica la versión 3 de la plantilla `PAYMENT_OVERDUE` en español, se desactiva la anterior, y los mensajes ya enviados conservan la referencia a la versión con la que se generaron.',
    systemsExplanation:
      'Tabla en `messaging` con clave (`code`, `channel`, `locale`) y `version`. Guarda plantillas de título, asunto y cuerpo más el esquema de variables. El renderizado debe escapar las variables para no permitir inyección de contenido, y validar el payload contra `payload_schema_json` antes de enviar. Se cachea por su alta lectura.',
  },
  {
    tableName: 'notification_messages',
    whyExists:
      'Es el mensaje concreto dirigido a una persona: qué se le dijo, por qué canal, con qué prioridad y en qué estado está. Es la bandeja del cliente vista desde el negocio.',
    whyNotDelete:
      'Es la prueba de que se comunicó algo. Sin ella no se puede demostrar que se notificó un vencimiento, un bloqueo o un cambio de condiciones, que en cobranza y en cumplimiento es exactamente lo que se exige. También se pierde el historial que soporte necesita para atender un reclamo.',
    decisionContribution:
      'Los estados (`sent_at`, `delivered_at`, `read_at`, `failed_at`) permiten decidir si escalar a otro canal, si el cliente es alcanzable y qué mensajes efectivamente se leen. Eso afecta directamente la estrategia de cobranza y de retención.',
    usageExample:
      'Un cliente afirma no haber sido notificado de una mora. El mensaje muestra `channel = push`, `delivered_at` con fecha y `read_at` vacío; el sistema escala a SMS y el registro sostiene la posición del negocio.',
    systemsExplanation:
      'Tabla en `messaging` con `_tenant_id`, enlace opcional al `outbox_event_id` que lo originó, destinatario polimórfico, plantilla, contenido renderizado, estados y `idempotency_key` para no enviar dos veces lo mismo. `correlation_id`/`causation_id` permiten seguir la cadena desde la petición original. El cuerpo puede contener datos personales: no debe loguearse ni exponerse sin control de acceso.',
  },
  {
    tableName: 'notification_deliveries',
    whyExists:
      'Un mensaje puede intentarse varias veces y por varios proveedores antes de llegar. Esta tabla registra cada intento de entrega, con su resultado y su referencia en el proveedor.',
    whyNotDelete:
      'Es donde vive la verdad operativa del canal: qué proveedor falla, con qué códigos de error y a qué costo. Sin ella, el estado del mensaje es un resumen sin evidencia y reclamar a un proveedor por entregas no realizadas es imposible.',
    decisionContribution:
      'Permite decidir reintento, cambio de proveedor y desactivación de un destino inválido. Los `error_code` agregados por proveedor sostienen decisiones comerciales y técnicas sobre a quién se le manda el tráfico.',
    usageExample:
      'Los SMS a una operadora empiezan a fallar con un código de rechazo específico. El sistema conmuta a otro proveedor para esa operadora y el reporte de entregas justifica el cambio ante el proveedor original.',
    systemsExplanation:
      'Tabla append-only en `messaging`, hija de `notification_messages`, con `attempt_number`, `provider`, `provider_message_id`, estados y los payloads de petición y respuesta. Esos payloads deben persistirse ya redactados: contienen números de teléfono y contenido del mensaje. `provider_message_id` es lo que permite conciliar los webhooks de estado del proveedor con el intento correcto.',
  },
  {
    tableName: 'user_notification_preferences',
    whyExists:
      'El cliente decide por qué canales quiere ser contactado y para qué. Respetarlo no es solo cortesía: para las comunicaciones comerciales es una obligación legal, y para las transaccionales es una obligación contractual que no se puede desactivar.',
    whyNotDelete:
      'Es la prueba de que se respetó la voluntad del usuario y la que distingue lo que se puede silenciar de lo que no (`is_required`). Sin ella, o se molesta al cliente hasta que desinstala, o se dejan de enviar avisos obligatorios; ambos son incumplimientos.',
    decisionContribution:
      'Decide, mensaje por mensaje, si se envía y por qué canal. Los patrones de desactivación son además una señal temprana de insatisfacción, útil para decisiones de producto y retención.',
    usageExample:
      'Un cliente desactiva push para eventos promocionales pero mantiene los de seguridad. El motor de notificaciones filtra la campaña comercial y sigue enviando la alerta de nuevo dispositivo, que está marcada como requerida.',
    systemsExplanation:
      'Tabla en `messaging` con `_tenant_id` y clave (`customer_id`, `event_code`, `channel`), enlazada al catálogo de eventos. `is_required` protege las notificaciones que el negocio no puede dejar de enviar: el motor debe respetar esa bandera por encima de la preferencia. La ausencia de fila implica el valor por defecto del evento, así que el default debe ser explícito y no accidental.',
  },
];
