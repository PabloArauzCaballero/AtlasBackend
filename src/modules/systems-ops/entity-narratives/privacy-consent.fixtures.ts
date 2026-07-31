/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import type { EntityBusinessNarrative } from './entity-narrative.types.js';

/** Base legal, consentimiento, clasificación de datos, retención y derechos del titular (schema `privacy`). */
export const PRIVACY_CONSENT_NARRATIVES: EntityBusinessNarrative[] = [
  {
    tableName: 'privacy_processing_purposes',
    whyExists:
      'Declara para qué está permitido usar cada dato: KYC, prevención de fraude, scoring crediticio, marketing, cobranza. El negocio necesita ese catálogo porque el mismo dato puede ser legítimo para una finalidad e ilegal para otra.',
    whyNotDelete:
      'Es la definición de las finalidades contra las que se otorga o revoca consentimiento. Sin ella, `customer_consents.purpose_code` apunta a un código sin significado y la organización pierde la capacidad de demostrar que trató datos con base legal, que es el corazón de cualquier régimen de protección de datos.',
    decisionContribution:
      '`legal_basis` y `requires_explicit_consent` deciden si una operación puede ejecutarse sin preguntar (interés legítimo, obligación legal) o si hay que bloquearla hasta obtener consentimiento explícito. Es un gate previo a consultar buró, enviar marketing o procesar datos del dispositivo.',
    usageExample:
      'Antes de consultar un buró de crédito, el servicio verifica que la finalidad `CREDIT_SCORING` requiere consentimiento explícito y que el cliente lo tiene vigente. Si no, la llamada no se hace y el flujo pide el consentimiento primero, evitando una consulta ilegal y su costo.',
    systemsExplanation:
      'Catálogo en `privacy` con `purpose_code` único, referenciado por `customer_consents.purpose_code` y por la política de ejecución de proveedores externos. Es de baja escritura y alta lectura, por lo que se cachea; toda alta o cambio de finalidad debe pasar por revisión legal y quedar en auditoría. Los seeders de producción lo materializan de forma idempotente.',
  },
  {
    tableName: 'consent_documents',
    whyExists:
      'El consentimiento se otorga sobre un texto concreto, en un idioma y una versión concreta. Esta tabla guarda esos documentos publicados (términos, política de privacidad, autorizaciones específicas) con su vigencia.',
    whyNotDelete:
      'Es lo que permite responder "¿qué aceptó exactamente esta persona?". Sin la versión y el `content_hash` del documento vigente en esa fecha, un consentimiento es una casilla marcada sin contenido probatorio, y cualquier impugnación lo tumba.',
    decisionContribution:
      'Determina si un consentimiento sigue siendo válido cuando el documento cambia: publicar una versión con nuevas finalidades obliga a re-consentir antes de seguir tratando ciertos datos. Eso decide si una campaña o una consulta externa puede ejecutarse sobre la base instalada.',
    usageExample:
      'Se publica la v3 de la autorización de tratamiento con una finalidad nueva de enriquecimiento externo. Los clientes que solo aceptaron la v2 quedan excluidos de esa finalidad hasta re-consentir; el sistema lo resuelve comparando `consent_document_id` contra la versión vigente.',
    systemsExplanation:
      'Tabla en `privacy` con clave (`document_code`, `version_code`, `language`), vigencia (`effective_from`/`effective_until`), `content_url` y `content_hash` para probar integridad del texto, y `published_by_internal_user_id`. El hash es la garantía de no repudio: si el archivo del CDN cambia, el hash deja de coincidir y se detecta. Las versiones no se editan, se supersede publicando una nueva.',
  },
  {
    tableName: 'customer_consents',
    whyExists:
      'Es el registro de que una persona concreta autorizó (o revocó) una finalidad concreta, en un momento, desde un canal y un dispositivo. Es el permiso operativo sobre el que se apoya todo el tratamiento de datos personales.',
    whyNotDelete:
      'Es la prueba de licitud del tratamiento. Sin ella, cada consulta a un buró, cada lectura de datos del dispositivo y cada mensaje comercial pasa a ser injustificable, con exposición legal directa. Además, es lo que permite ejecutar una revocación de verdad: sin el registro no se sabe qué hay que dejar de hacer.',
    decisionContribution:
      'Funciona como interruptor de decisiones: habilita o bloquea KYC, buró, scoring, marketing, cobranza y procesamiento on-device. Una operación con consentimiento revocado no debe ejecutarse aunque el negocio la quiera, y esta tabla es lo que lo hace verificable en tiempo de ejecución.',
    usageExample:
      'Un cliente revoca la finalidad `MARKETING`. `revoked_at` se llena y el motor de notificaciones deja de incluirlo en campañas comerciales, pero sigue enviándole avisos transaccionales, cuya base legal es la ejecución del contrato y no el consentimiento.',
    systemsExplanation:
      'Tabla en `privacy` que enlaza `customers`, `consent_documents` y `privacy_processing_purposes`, y captura el contexto probatorio del acto: `channel`, `session_id`, `ip_address`, `device_fingerprint_snapshot`, `user_agent`, `evidence_snapshot_url`. La revocación es un UPDATE de `revoked_at` acompañado SIEMPRE de un `consent_events` append-only, para que el historial no dependa del estado actual. Las consultas de autorización filtran por `granted = true AND revoked_at IS NULL`.',
  },
  {
    tableName: 'consent_events',
    whyExists:
      'Un consentimiento no es un booleano: se otorga, se actualiza, se revoca y a veces se vuelve a otorgar. Esta tabla es la bitácora de esos actos, con quién y desde dónde ocurrió cada uno.',
    whyNotDelete:
      'Es la línea de tiempo probatoria. `customer_consents` dice el estado actual; solo `consent_events` puede demostrar que entre marzo y julio el cliente SÍ tenía consentimiento vigente cuando se hizo esa consulta al buró. Sin ella, una revocación posterior parece invalidar retroactivamente todo el tratamiento previo.',
    decisionContribution:
      'Permite decidir sobre reclamos y auditorías con evidencia, y detectar patrones anómalos: revocaciones masivas tras un cambio de texto, u otorgamientos hechos desde una IP distinta a la del titular (posible consentimiento otorgado por un tercero).',
    usageExample:
      'Un cliente denuncia que nunca autorizó la consulta a buró. El evento `granted` muestra fecha, canal `mobile_app`, IP, sesión y snapshot del fingerprint del dispositivo, coincidentes con su sesión de onboarding. El reclamo se cierra con evidencia.',
    systemsExplanation:
      'Tabla append-only en `privacy`, ligada a `customer_consents`, con `event_type`, `happened_at`, contexto de canal/sesión/IP/dispositivo y el actor que lo disparó (`triggered_by_type`, `triggered_by_internal_user_id`). Se escribe en la misma transacción que el cambio de estado del consentimiento. Nunca se hace UPDATE ni DELETE sobre ella.',
  },
  {
    tableName: 'data_classification_policies',
    whyExists:
      'Define los niveles de sensibilidad de los datos que maneja Atlas y qué se puede hacer con cada nivel: si se puede guardar en crudo, si hay que cifrarlo, si hay que hashearlo, cuánto se retiene por defecto. Es la política escrita, no la costumbre.',
    whyNotDelete:
      'Es la regla contra la que se audita el modelo de datos entero. Sin ella, cada tabla decide por su cuenta cómo tratar un dato sensible y la protección se vuelve inconsistente; también se pierde la referencia que usan `sensitive_field_rules`, `attribute_definitions`, `feature_definitions` y `event_definitions` para clasificar sus campos.',
    decisionContribution:
      'Decide el modo de almacenamiento y el control de acceso de cada dato nuevo antes de escribirlo, y sustenta decisiones de arquitectura: qué se puede indexar, qué puede salir en un export, qué puede viajar a un proveedor externo.',
    usageExample:
      'Al modelar un campo de número de documento se le asigna la clasificación `PII_STRONG`, que tiene `encryption_required = true`, `hashing_required = true` y `raw_storage_allowed = false`. Eso obliga al patrón hash + blob cifrado y prohíbe indexar el valor en claro.',
    systemsExplanation:
      'Catálogo en `privacy` con `classification_code` único, `sensitivity_level`, `allowed_storage_modes_json` y `default_retention_policy_id`. Es referenciado por código (`data_classification_code`) desde varias tablas de definición. Es de lectura casi pura; los gates de repositorio (`check:read-api-views`, revisión de PII) se apoyan en él para verificar que las vistas de lectura no expongan datos de clasificación alta.',
  },
  {
    tableName: 'sensitive_field_rules',
    whyExists:
      'Baja la política de clasificación al nivel concreto de tabla y columna: este campo se cifra, este se hashea para buscar, este se enmascara al mostrarlo, este requiere tal política de acceso. Es el mapa operativo de la protección de datos.',
    whyNotDelete:
      'Es el inventario de dónde vive el dato sensible. Sin él, responder "¿qué columnas tienen PII?" exige leer todo el código, y cualquier campo nuevo puede quedar desprotegido sin que nadie lo note. Es también la evidencia que un auditor pide primero.',
    decisionContribution:
      'Decide cómo se muestra un dato a cada rol (enmascarado o completo), qué puede exportarse y qué estrategia de búsqueda se permite. Habilita decisiones de remediación priorizadas: qué campos migrar primero a cifrado cuando cambia la política.',
    usageExample:
      'La regla para `customer_contact_methods.contact_value_encrypted` declara `storage_mode = ENCRYPTED`, `search_strategy = HASH_LOOKUP` y `masking_strategy = LAST_4`. Soporte ve `•••• 1223` salvo que tenga el permiso de revelación, y la búsqueda se hace por hash normalizado.',
    systemsExplanation:
      'Catálogo en `privacy` con clave (`table_name`, `field_name`), enlazado a `data_classification_policies` y a `retention_policies`. No se aplica solo: el cumplimiento lo ejercen los mappers y `redactSensitiveObject` en la capa de logging y transporte. Su valor está en ser la fuente declarativa contra la que se pueden escribir gates automáticos que detecten campos sensibles sin regla.',
  },
  {
    tableName: 'retention_policies',
    whyExists:
      'Responde cuánto tiempo se conserva cada tipo de dato y qué se hace al vencer: anonimizar, borrar, archivar o retener por obligación legal. Guardar todo para siempre no es prudencia, es riesgo acumulado y costo.',
    whyNotDelete:
      'Es lo que hace posible cumplir la minimización y la limitación de plazo. Sin ella no hay proceso de purga defendible, los datos personales se acumulan indefinidamente y cada brecha futura es más grave. También es la referencia de `evidence_documents`, `data_provider_responses`, `attribute_definitions`, `feature_definitions` y `sensitive_field_rules`.',
    decisionContribution:
      'Define hasta cuándo un dato puede usarse para decidir y cuándo debe dejar de existir. `legal_basis` permite sostener la retención frente a una solicitud de borrado cuando existe obligación legal de conservar, distinguiendo lo que se puede borrar de lo que no.',
    usageExample:
      'La política `pii-core-1095d` retiene datos de identidad 1.095 días y luego anonimiza. Un cliente inactivo desde hace cuatro años entra en el proceso de purga: sus blobs cifrados se eliminan, los hashes se conservan para detección de duplicados y el histórico agregado sigue sirviendo para análisis.',
    systemsExplanation:
      'Catálogo en `privacy` con `policy_code` único, `applies_to`, `retention_days`, `post_retention_action` y `legal_basis`. Se referencia por `retention_policy_id` (FK) o por `retention_policy_code` (texto, en el catálogo de sistemas): ese código debe existir realmente en esta tabla, o el join produce referencias huérfanas. La ejecución de la purga corre como job y debe quedar registrada en `system_job_runs`.',
  },
  {
    tableName: 'data_subject_requests',
    whyExists:
      'Materializa los derechos del titular: acceso, rectificación, cancelación, oposición, portabilidad. Cuando una persona ejerce un derecho, el negocio tiene un plazo legal para responder y debe poder demostrar que lo cumplió.',
    whyNotDelete:
      'Es la evidencia de atención de derechos y del cumplimiento de plazos (`requested_at`, `due_at`, `resolved_at`). Sin ella, la organización no puede probar que respondió a tiempo, que es precisamente lo que se sanciona. Nótese la paradoja necesaria: el registro de una solicitud de borrado no se borra, se conserva como prueba del borrado.',
    decisionContribution:
      'Dispara y ordena acciones concretas sobre los datos (anonimizar, exportar, corregir) y permite medir la carga y los cuellos de botella del proceso. Un aumento de solicitudes de cancelación es además una señal de negocio sobre la confianza del usuario.',
    usageExample:
      'Un cliente solicita eliminación de sus datos. Se abre la solicitud con `request_type = deletion` y `due_at` a 15 días. Compliance ejecuta la anonimización guiada por `retention_policies`, registra `resolution_notes` y cierra con `resolved_at`; el registro queda como prueba ante el regulador.',
    systemsExplanation:
      'Tabla en `privacy` con `request_code` único, estado, plazos, responsable (`handled_by`) y borrado lógico. Su cumplimiento cruza casi todos los schemas, por lo que la ejecución no es un DELETE simple sino un procedimiento que respeta FKs y obligaciones legales de conservación. Cada paso debe quedar en `operational_audit_logs` con el actor que lo ejecutó.',
  },
];
