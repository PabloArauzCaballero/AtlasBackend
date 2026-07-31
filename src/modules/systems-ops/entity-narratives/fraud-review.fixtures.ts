/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import type { EntityBusinessNarrative } from './entity-narrative.types.js';

/** Casos de fraude, revisión manual y listas de control (schema `case_management`). */
export const FRAUD_REVIEW_NARRATIVES: EntityBusinessNarrative[] = [
  {
    tableName: 'fraud_cases',
    whyExists:
      'Cuando el sistema detecta algo que huele a fraude, alguien tiene que investigarlo, decidir y responder por esa decisión. `fraud_cases` es el expediente de esa investigación: su código, severidad, patrón detectado, responsable asignado y resolución.',
    whyNotDelete:
      'Es la memoria institucional del fraude. Sin ella se pierde el modus operandi acumulado, las entidades vinculadas de cada red (`linked_customers_json`, `linked_devices_json`, `linked_sessions_json`) y la justificación de bloqueos que afectan a personas reales. Un bloqueo sin expediente es indefendible ante un reclamo o una demanda.',
    decisionContribution:
      'Sostiene bloqueos, desbloqueos y escalamientos, y alimenta la calibración de reglas: qué patrones se repiten, cuánta pérdida se evitó, qué porcentaje de casos resultó falso positivo. Un cliente con casos previos se evalúa distinto, y esta tabla es la fuente de ese antecedente.',
    usageExample:
      'Se abre un caso por cinco cuentas que comparten dispositivo y referencias. El analista vincula clientes, sesiones y dispositivos en el caso, bloquea el conjunto y lo cierra con `resolution = CONFIRMED_FRAUD_RING`. Tres meses después, un sexto cliente con el mismo dispositivo se frena automáticamente por el antecedente.',
    systemsExplanation:
      'Tabla en `case_management` con `_tenant_id`, `case_code` único, FK a `customers` y a `devices`, enlace opcional al caso de revisión del que escaló (`escalated_from_review_case_id`) y borrado lógico. Los `linked_*_json` son vínculos flexibles porque una red de fraude no tiene cardinalidad fija; la consecuencia es que no hay integridad referencial sobre ellos y el código debe validarlos. Toda transición de estado se registra en `fraud_case_events`.',
  },
  {
    tableName: 'fraud_case_events',
    whyExists:
      'Un caso de fraude es un proceso: se abre, se asigna, se pide evidencia, se escala, se resuelve. Esta tabla registra cada uno de esos actos con su actor y su momento.',
    whyNotDelete:
      'Es la cadena de custodia de la investigación. Sin ella no se puede demostrar quién hizo qué y cuándo dentro del caso, ni detectar manipulación interna (alguien que cierra sistemáticamente casos que involucran a los mismos clientes), ni medir tiempos reales de resolución.',
    decisionContribution:
      'Permite auditar la calidad del proceso y decidir sobre él: dónde se atascan los casos, qué analistas necesitan apoyo, qué tipo de caso conviene automatizar. También sostiene la reapertura fundada de un caso cerrado.',
    usageExample:
      'Un caso cerrado como falso positivo se reabre al aparecer nueva evidencia. El historial muestra que se cerró en cuatro minutos sin pedir evidencia adicional, lo que dispara una revisión del criterio de ese analista.',
    systemsExplanation:
      'Tabla append-only en `case_management`, hija de `fraud_cases`, con `event_type`, `actor_type`, `actor_internal_user_id`, `happened_at`, `payload_json` y notas. Se escribe en la misma transacción que el cambio de estado del caso. El `payload_json` debe ir redactado: es un vector clásico de filtración de PII hacia logs y exportaciones.',
  },
  {
    tableName: 'manual_review_cases',
    whyExists:
      'No todo caso dudoso es fraude. La revisión manual es la válvula que evita rechazar clientes buenos por reglas conservadoras: un humano mira, pide evidencia y decide. Esta tabla es la cola de trabajo de ese proceso.',
    whyNotDelete:
      'Es donde vive el trabajo humano que rescata conversión. Sin ella no hay cola, ni asignación, ni SLA, ni forma de medir cuánto negocio se recupera revisando manualmente frente a rechazar automáticamente.',
    decisionContribution:
      'Su resolución sobreescribe o confirma la decisión automática, y esa comparación es la mejor fuente para calibrar umbrales: si el 80% de las revisiones termina en aprobación, el umbral automático está demasiado apretado y está costando ventas.',
    usageExample:
      'Un caso llega a revisión por inconsistencia de domicilio. El analista pide una factura de servicios, la evidencia llega, aprueba y cierra. El reporte mensual muestra que ese motivo genera 200 revisiones al mes con 85% de aprobación: se ajusta la regla y se libera capacidad del equipo.',
    systemsExplanation:
      'Tabla en `case_management` con `_tenant_id`, `case_code` único, enlaces a `customers`, `risk_assessment_runs` y opcionalmente a `fraud_cases`, más prioridad, estado, asignación y borrado lógico. La asignación debe ser atómica para que dos analistas no tomen el mismo caso. `opened_at`/`closed_at` alimentan el SLA operativo.',
  },
  {
    tableName: 'manual_review_events',
    whyExists:
      'Registra cada paso dentro de una revisión manual: asignación, solicitud de evidencia, comentario, decisión. Da visibilidad sobre un proceso que de otro modo sería una caja negra entre "abierto" y "cerrado".',
    whyNotDelete:
      'Es la traza de accountability de la decisión humana sobre casos que afectan el acceso al crédito de personas. Sin ella no se puede auditar el criterio aplicado ni defender la decisión, y se pierde la medición fina de tiempos y cuellos de botella.',
    decisionContribution:
      'Permite decidir sobre el proceso mismo (dotación, entrenamiento, automatización de pasos repetitivos) y sostiene la revisión de segundo nivel: un supervisor puede ver exactamente qué evidencia se pidió y qué se concluyó.',
    usageExample:
      'El historial muestra que las revisiones que empiezan pidiendo evidencia se resuelven en 6 horas y las que no, en 3 días. Se cambia el procedimiento para pedir evidencia en el primer contacto y el SLA mejora sin contratar a nadie.',
    systemsExplanation:
      'Tabla append-only en `case_management`, hija de `manual_review_cases`, con `event_type`, actor, `happened_at`, `payload_json` y notas. Misma disciplina que `fraud_case_events`: escritura transaccional junto al cambio de estado, payload redactado y sin UPDATE ni DELETE sobre filas existentes.',
  },
  {
    tableName: 'watchlist_entries',
    whyExists:
      'Hay entidades que el negocio decide no atender: documentos vinculados a fraude confirmado, teléfonos de redes conocidas, dispositivos quemados, personas en listas regulatorias. Esta tabla es esa lista de control, con su motivo, severidad y vigencia.',
    whyNotDelete:
      'Es la memoria defensiva de la organización. Sin ella, cada fraude confirmado se olvida y el mismo actor vuelve a entrar con otra cuenta. También es el mecanismo por el que se cumplen obligaciones de listas regulatorias, cuya omisión tiene consecuencias legales directas.',
    decisionContribution:
      'Un hit en watchlist es típicamente un hard stop. `severity`, `scope` y `expires_at` permiten graduar: bloquear, solo alertar, o aplicar solo dentro de un tenant o país. La vigencia evita bloqueos eternos por hechos ya prescritos.',
    usageExample:
      'Tras confirmar un fraude, el hash del documento se agrega con `severity = HIGH` y sin expiración. Cuatro meses después, una solicitud con ese documento se bloquea antes de gastar en verificación de identidad, y el motivo queda registrado.',
    systemsExplanation:
      'Tabla en `case_management` que guarda `entity_hash` y `entity_last_4`, nunca el valor en claro: el match se hace por hash, lo que permite bloquear sin almacenar los datos personales de la persona listada. Tiene `scope` y `country_code` para alcance, actor de creación, `expires_at` y borrado lógico. Las entradas activas se cachean; el cache debe invalidarse al alta para que un bloqueo urgente surta efecto de inmediato.',
  },
  {
    tableName: 'watchlist_matches',
    whyExists:
      'Registra cada vez que un cliente, sesión o dispositivo coincidió con una entrada de la lista, con qué método y con qué confianza. Una coincidencia no es lo mismo que una certeza, y el negocio necesita esa distinción.',
    whyNotDelete:
      'Es la evidencia del bloqueo. Sin ella no se puede explicar por qué se rechazó a alguien, ni revisar falsos positivos por homonimia, ni medir la calidad de las listas. Borrarla convierte cada bloqueo en una decisión sin justificación recuperable.',
    decisionContribution:
      '`match_confidence` y `match_method` deciden si el hit bloquea automáticamente o abre una revisión. La tasa de falsos positivos por entrada permite decidir qué entradas depurar o qué umbral de matching ajustar.',
    usageExample:
      'Un cliente coincide por nombre normalizado con confianza 0.72. Como no es un match exacto de documento, en lugar de bloquear se abre una revisión manual (`opened_review_case_id`); el analista confirma que es homónimo y el caso se libera con evidencia.',
    systemsExplanation:
      'Tabla append-only en `case_management` que enlaza `watchlist_entries` con cliente, sesión y dispositivo, y con el caso de revisión o de fraude que abrió. Guarda `matched_value_hash`, nunca el valor. El matching por hash exige normalización previa idéntica en ambos lados: cualquier diferencia de normalización produce falsos negativos silenciosos, que es el peor fallo posible en una lista de control.',
  },
];
