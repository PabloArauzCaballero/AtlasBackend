/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import type { EntityBusinessNarrative } from './entity-narrative.types.js';

/** Identidad del cliente, KYC, contactabilidad, domicilio y observaciones (schema `customer`). */
export const CUSTOMER_IDENTITY_NARRATIVES: EntityBusinessNarrative[] = [
  {
    tableName: 'customers',
    whyExists:
      'Es la cuenta del consumidor: la entidad a la que se le aprueba o niega crédito, a la que se le cobra y a la que responde el negocio. Existe deliberadamente delgada (identificadores estables, contacto primario protegido y estado de ciclo de vida) porque todo lo demás cambia con el tiempo y se versiona en tablas aparte.',
    whyNotDelete:
      'Es la raíz de identidad de todo el modelo: sesiones, dispositivos, evidencias, consentimientos, evaluaciones de riesgo y casos de fraude cuelgan de `customers._id`. Borrarla deja huérfano el 70% del modelo y hace imposible atender un derecho ARCO, una investigación o un reclamo. Por eso el borrado es lógico (`_deleted`) y la baja real se ejecuta como anonimización guiada por `retention_policies`.',
    decisionContribution:
      '`lifecycle_status` es la puerta de entrada de casi toda decisión: un cliente `pending_kyc` no puede operar, uno `blocked` no recibe crédito ni notificaciones comerciales, uno `closed_by_user` no se contacta. Además, `customer_uuid` es la llave estable que permite unir comportamiento a lo largo de años sin exponer datos personales.',
    usageExample:
      'Un usuario intenta pagar en cuotas. El motor lee `lifecycle_status = active`, obtiene el `current_profile_version_id` para saber qué nombre y fecha de nacimiento estaban vigentes, y evalúa. Si estuviera `blocked`, la operación se corta antes de gastar una consulta de buró.',
    systemsExplanation:
      'Tabla en `customer` con `customer_code` y `customer_uuid` únicos por tenant. Aplica el patrón hash-para-buscar + blob cifrado: `primary_phone_hash` / `primary_email_hash` son los que se indexan y buscan, `*_encrypted` guarda el valor bajo envelope encryption y `*_last_4` / `*_domain` permiten mostrar algo al operador sin revelar el dato. Las vistas `read_api` no exponen ni hashes ni blobs. `current_profile_version_id` es un puntero denormalizado a `customer_profile_versions` para evitar un subquery en cada lectura.',
  },
  {
    tableName: 'customer_status_events',
    whyExists:
      'El estado de un cliente no es un dato, es una historia: se registró, pasó KYC, fue bloqueado por fraude, se desbloqueó tras revisión. El negocio necesita esa línea de tiempo para explicar por qué alguien está donde está.',
    whyNotDelete:
      'Es la única fuente que permite reconstruir el ciclo de vida. Sin ella, `customers.lifecycle_status` es un valor sin pasado: se sabe que el cliente está bloqueado, pero no desde cuándo, por qué motivo ni quién lo bloqueó, que es exactamente lo que se pregunta ante un reclamo o una demanda.',
    decisionContribution:
      'Permite decidir sobre reincidencia y rehabilitación: un cliente bloqueado dos veces por el mismo `reason_code` no se trata igual que uno bloqueado una vez por error operativo. También mide cuántos bloqueos se revierten, que es el indicador de calidad de las reglas automáticas.',
    usageExample:
      'Un cliente reclama. El historial muestra `active → blocked` con `reason_code = WATCHLIST_HIT` el 12 de marzo, decidido por el sistema, y luego `blocked → active` el 14 de marzo por el analista `INT-0042` con nota "falso positivo por homónimo". El reclamo se resuelve en minutos.',
    systemsExplanation:
      'Tabla append-only en `customer`: guarda `previous_status`, `new_status`, `reason_code`, el actor (`changed_by_type` más `changed_by_internal_user_id` o `changed_by_platform_user_id`) y `happened_at`. La escritura debe ocurrir en la MISMA transacción que actualiza `customers.lifecycle_status`, o el historial y el estado divergen. Nunca se hace UPDATE sobre filas existentes; una corrección es un evento nuevo.',
  },
  {
    tableName: 'customer_profile_versions',
    whyExists:
      'Los datos personales cambian: la gente se casa, corrige su nombre, actualiza su fecha de nacimiento mal digitada. El negocio necesita saber qué versión del perfil estaba vigente cuando se tomó una decisión, no solo cuál es la actual.',
    whyNotDelete:
      'Sin versionado, cada corrección de datos reescribe el pasado y las decisiones históricas dejan de ser explicables ("se aprobó a una persona de 19 años" cuando hoy el registro dice 34). También se pierde la capacidad de detectar manipulación: alguien que cambia su fecha de nacimiento después de un rechazo.',
    decisionContribution:
      'Alimenta edad al momento de la evaluación (`age_at_capture`), idioma preferido para comunicaciones, y opt-in de marketing. Sobre todo, permite auditar decisiones crediticias contra los datos realmente usados y detectar patrones de edición sospechosa antes de una aprobación.',
    usageExample:
      'Un cliente es rechazado por edad mínima. Dos días después actualiza su fecha de nacimiento y reintenta. La versión anterior sigue en la tabla con `valid_until` cerrado, la nueva apunta a la anterior por `supersedes_version_id`, y la regla antifraude marca el cambio de dato crítico post-rechazo.',
    systemsExplanation:
      'Tabla versionada y append-only en `customer`, con `valid_from` / `valid_until` y `supersedes_version_id` formando la cadena. `customers.current_profile_version_id` apunta a la versión abierta. `full_name_normalized` existe para búsquedas y matching (watchlists, homónimos) sin depender de mayúsculas ni acentos. Cerrar la versión anterior y abrir la nueva debe ser una sola transacción.',
  },
  {
    tableName: 'customer_identity_documents',
    whyExists:
      'KYC exige asociar la cuenta a un documento de identidad real. Esta tabla guarda qué documento declaró el cliente, qué leyó el OCR de la imagen y qué confirmó la verificación, que son tres cosas distintas que el negocio no debe confundir.',
    whyNotDelete:
      'Es la prueba de identidad. Sin ella no hay cumplimiento KYC/AML posible, no se puede responder a un requerimiento de autoridad, ni detectar que un mismo documento se está usando en varias cuentas (suplantación o cuentas mula).',
    decisionContribution:
      'Habilita o bloquea la activación de la cuenta. La comparación entre `declared_number_hash` y `ocr_number_hash`/`verified_number_hash`, más `ocr_confidence_score` y `expires_at`, decide si se aprueba, se pide reintento, se manda a revisión manual o se rechaza por documento vencido.',
    usageExample:
      'El cliente declara CI 1234567 pero el OCR de la foto lee 1234561 con confianza 0.62. La discrepancia manda el caso a revisión manual en vez de aprobarlo automáticamente; el analista compara contra la imagen en `evidence_documents` y corrige.',
    systemsExplanation:
      'Tabla en `customer` que separa tres pistas de datos (declarada, OCR, verificada), cada una con su hash indexable y su blob cifrado. Las columnas `*_hash` son las únicas indexadas; las `*_encrypted` nunca lo son. Enlaza a `evidence_documents` por `front_evidence_id`/`back_evidence_id` y se versiona por `valid_from`/`valid_until`. El número completo solo se revela con permiso de alto riesgo y queda registrado en auditoría.',
  },
  {
    tableName: 'identity_verification_attempts',
    whyExists:
      'Verificar identidad es un proceso con intentos, no un resultado binario. El negocio necesita saber cuántas veces lo intentó una persona, con qué canal y con qué puntajes, porque el patrón de intentos dice tanto como el resultado.',
    whyNotDelete:
      'Guarda la evidencia biométrica y forense de cada intento (`liveness_score`, `selfie_match_score`, `document_forensics_score`, `name_match_score`, `reason_codes_json`). Sin ella no se puede defender un rechazo, ni auditar el desempeño del proveedor de verificación, ni detectar el ataque clásico de reintentar hasta que el liveness pase por casualidad.',
    decisionContribution:
      'Su `final_result` decide activación, reintento, revisión manual o rechazo. La secuencia de intentos alimenta reglas antifraude: muchos intentos fallidos seguidos de uno exitoso es un patrón de ataque, no de un usuario torpe.',
    usageExample:
      'Un usuario falla liveness cuatro veces en diez minutos y aprueba al quinto con `selfie_match_score = 0.71`. La regla de fraude marca el caso, se abre revisión manual y el analista compara las selfies almacenadas antes de activar la cuenta.',
    systemsExplanation:
      'Tabla append-only en `customer` ligada a `customer_identity_documents`, `data_provider_requests` (la llamada al proveedor) y `customer_consents` (la base legal). Guarda además `selfie_evidence_id` y los campos de revisión manual. Los scores llegan del proveedor y se conservan tal cual llegaron: recalcularlos después invalidaría la auditoría del intento.',
  },
  {
    tableName: 'customer_contact_methods',
    whyExists:
      'Un cliente tiene más de un teléfono y más de un correo, y no todos sirven. El negocio necesita saber cuál es el canal primario, cuál está verificado y desde cuándo, para cobrar, notificar y recuperar cuentas.',
    whyNotDelete:
      'La contactabilidad es un activo: sin ella no hay cobranza, ni recuperación de cuenta, ni notificación legal válida. También se pierde el historial de rotación de contactos, que es una señal antifraude fuerte (un teléfono que cambia justo antes de una operación grande).',
    decisionContribution:
      'Alimenta el `contactability_score` de la evaluación de riesgo, decide a qué canal se envía cada notificación y condiciona operaciones sensibles a que el canal esté verificado. Un cliente sin ningún contacto verificado no debería recibir crédito.',
    usageExample:
      'Antes de desembolsar, la regla exige al menos un teléfono con `status = verified`. El cliente tiene dos: el primario verificado hace seis meses y uno agregado ayer sin verificar. La operación procede usando el primario y el nuevo queda marcado para verificación.',
    systemsExplanation:
      'Tabla en `customer` con el patrón hash + cifrado: `contact_value_hash` y `normalized_value_hash` (normalizado para detectar que "+591 700-11223" y "70011223" son el mismo número) se indexan; `contact_value_encrypted` no. `value_last_4` y `email_domain` permiten mostrar y agrupar sin revelar. Unicidad parcial por (`customer_id`, `contact_type`) para el primario. Borrado lógico con `_deleted NOT NULL DEFAULT false`, porque una fila con `_deleted` nulo sería invisible para los filtros y escaparía del índice único parcial.',
  },
  {
    tableName: 'contact_verification_attempts',
    whyExists:
      'Registra cada vez que se intentó probar que un teléfono o correo realmente pertenece al cliente, con qué método y con qué resultado. Es la diferencia entre "declaró un número" y "demostró que controla ese número".',
    whyNotDelete:
      'Es la prueba de la verificación. Sin ella, `customer_contact_methods.status = verified` es una afirmación sin respaldo: no se sabe cuándo, cómo ni con qué proveedor se verificó, y no se puede reconstruir el hecho si el cliente lo niega.',
    decisionContribution:
      'El `confidence_score` y el `verification_method` permiten decidir si la verificación alcanza para la operación en juego: un OTP puede bastar para notificar, pero no para autorizar un cambio de cuenta bancaria. Los fallos repetidos por `failure_reason_code` alimentan reglas antifraude y decisiones sobre proveedores.',
    usageExample:
      'Se envía un OTP al teléfono declarado; tres intentos fallan con `failure_reason_code = CODE_EXPIRED` y el cuarto verifica. El contacto pasa a `verified` con `verified_at`, y el patrón queda disponible para analizar fricción del canal.',
    systemsExplanation:
      'Tabla append-only en `customer`, ligada a `customer_contact_methods` y opcionalmente a `data_provider_requests` cuando la verificación la hizo un tercero (lookup de línea, validación de portabilidad). Nunca guarda el código enviado: eso vive hasheado en `auth_one_time_codes`. La transición de estado del contacto ocurre en la misma transacción que el intento exitoso.',
  },
  {
    tableName: 'customer_addresses',
    whyExists:
      'El domicilio importa para entrega, cobranza, zona de riesgo y cumplimiento. Esta tabla es el "slot" estable de una dirección del cliente (domicilio, trabajo, entrega) mientras su contenido cambia con el tiempo.',
    whyNotDelete:
      'Sin ella no hay logística ni cobranza en terreno, y se pierde la asociación estable entre un cliente y sus lugares. Además, el historial de direcciones es señal de estabilidad, que es una variable crediticia real.',
    decisionContribution:
      'El tipo y estado de dirección condicionan entrega y cobertura; la antigüedad (`first_seen_at`) alimenta variables de estabilidad domiciliaria; y la existencia de una dirección verificada es requisito para ciertos productos.',
    usageExample:
      'Un cliente pide entrega a domicilio. El sistema toma la dirección de tipo `home` con `status = active`, resuelve su `current_version_id` para leer el texto normalizado y la zona, y valida que la zona esté dentro de la cobertura del comercio.',
    systemsExplanation:
      'Tabla en `customer` que actúa como cabecera: los datos reales viven en `customer_address_versions` y `current_version_id` apunta a la versión vigente. Tiene borrado lógico y `first_seen_at`/`last_seen_at` para medir permanencia. Separar cabecera de versión evita reescribir historia cada vez que el cliente corrige una letra de su dirección.',
  },
  {
    tableName: 'customer_address_versions',
    whyExists:
      'Guarda cada versión del contenido de una dirección: lo que el cliente declaró, la versión normalizada, la zona geográfica reconocida y con qué evidencia se respalda. En Bolivia, donde la dirección declarada suele ser textual y ambigua, esta separación es la diferencia entre un dato usable y un texto libre.',
    whyNotDelete:
      'Es la evidencia de dónde vivía el cliente cuando se le aprobó un crédito o se le entregó un producto. También conserva el snapshot de la zona (`geo_zone_code_snapshot`, `geo_zone_name_snapshot`): si mañana el catálogo de zonas cambia, la decisión histórica sigue siendo explicable.',
    decisionContribution:
      '`verification_status` y `verifiability_band` deciden si la dirección sirve como respaldo para crédito o solo para entrega. La zona snapshot alimenta variables de riesgo geográfico y decisiones de cobertura, y `source_type` distingue lo declarado de lo verificado con evidencia.',
    usageExample:
      'El cliente declara "Calle Murillo casi esquina Bolívar, zona Sur". El normalizador la asocia a la zona `SUR-03`, el analista adjunta una factura de servicios como `evidence_id` y la versión pasa a `verified`. La evaluación de riesgo usa el snapshot de esa zona, no el catálogo de hoy.',
    systemsExplanation:
      'Tabla append-only y versionada en `customer`, con `valid_from`/`valid_until` y `supersedes_version_id`. Los campos `*_snapshot` son denormalización deliberada: congelan el valor del catálogo en el momento de la captura para que un cambio posterior en `context_items` no altere decisiones pasadas. Se enlaza a `evidence_documents` y es la fuente contra la que se compara `address_gps_observations`.',
  },
  {
    tableName: 'address_gps_observations',
    whyExists:
      'Permite contrastar lo que el cliente declara con dónde está realmente cuando usa la app. Para el negocio es una verificación barata de domicilio, sin visita de campo.',
    whyNotDelete:
      'Es la única fuente que respalda objetivamente una dirección declarada. Sin ella, verificar domicilio vuelve a costar una visita física o queda sin verificar, y se pierde una señal antifraude fuerte: cuentas creadas siempre desde el mismo punto que declaran domicilios distintos.',
    decisionContribution:
      '`match_score_against_declared_address` y `distance_to_declared_meters` deciden si la dirección se da por verificada, se pide evidencia adicional o se marca inconsistencia. También detecta granjas de cuentas: muchas cuentas distintas capturadas en el mismo GPS.',
    usageExample:
      'El cliente declara vivir en la zona Sur, pero las cinco capturas nocturnas de GPS caen a 14 km, en otra zona. La regla baja el `consistency_score`, la dirección no se da por verificada y el caso pasa a revisión manual.',
    systemsExplanation:
      'Tabla append-only en `customer` con coordenadas, precisión y `captured_at`, ligada a `customer_addresses`, `customer_address_versions` y a la sesión que la originó. Contiene datos de ubicación, así que está marcada `contains_location_data` y su captura exige consentimiento vigente en `customer_consents`. Es de alto volumen: requiere política de retención y agregación, no conservación indefinida del detalle.',
  },
  {
    tableName: 'customer_reference_contacts',
    whyExists:
      'En crédito al consumo boliviano las referencias personales siguen siendo un mecanismo real de recuperación y de validación social. Esta tabla registra a esas personas de referencia declaradas por el cliente.',
    whyNotDelete:
      'Guarda datos de terceros que no son clientes de Atlas, junto con la base legal por la que se los trata (`consent_basis`) y si fueron notificados. Borrarla destruye la evidencia de cumplimiento sobre datos de terceros, que es justamente el punto más frágil de una auditoría de privacidad.',
    decisionContribution:
      'Alimenta el score de contactabilidad y la estrategia de cobranza. `contactability_status` y `verification_status` permiten decidir si las referencias son utilizables; referencias compartidas entre clientes no relacionados son una señal de fraude organizado.',
    usageExample:
      'Dos solicitudes de clientes distintos declaran el mismo teléfono de referencia. El hash coincide, se genera una alerta de vínculo y ambos casos pasan a revisión antes de aprobarse.',
    systemsExplanation:
      'Tabla en `customer` con hash + blob cifrado tanto para el nombre como para el teléfono del tercero (`full_name_hash`/`full_name_encrypted`, `phone_hash`/`phone_encrypted`, `phone_last_4`). El matching entre clientes se hace por hash, nunca desencriptando. Tiene borrado lógico y su retención debe ser más agresiva que la del titular, porque el tercero no es cliente.',
  },
  {
    tableName: 'customer_observations',
    whyExists:
      'Es el almacén genérico de hechos observados sobre un cliente: cualquier dato capturado de la app, de un proveedor o derivado, sin tener que crear una tabla nueva por cada dato. Le da al negocio velocidad para incorporar nuevas señales sin migraciones.',
    whyNotDelete:
      'Es la materia prima de las features de riesgo y conserva la procedencia de cada hecho (`source_type`, `source_provider_id`, `evidence_id`, `derivation_method`, `derivation_version`). Sin ella, las features quedan sin linaje y el score se vuelve una caja negra imposible de defender.',
    decisionContribution:
      'Alimenta el cálculo de features y, por esa vía, el score, las reglas y la revisión manual. `confidence_score` y `verification_status` permiten decidir cuánto pesa cada observación, y la vigencia (`valid_from`/`valid_until`) evita decidir con datos caducos.',
    usageExample:
      'Se captura la observación `INGRESO_DECLARADO = 4500` con `source_type = declared` y confianza media. Al llegar una boleta de pago como evidencia, se cierra esa observación y se abre otra con `source_type = document` y confianza alta; la feature de capacidad de pago se recalcula con la nueva.',
    systemsExplanation:
      'Tabla append-only y versionada en `customer`, tipada por `observation_code` contra `observation_definitions` (que define tipo de dato, clasificación y si está permitida para decisión crediticia). Guarda el valor en la columna que corresponda al tipo (`value_text`/`value_number`/`value_boolean`/`value_json`). Es de alto volumen: exige índices por (`customer_id`, `observation_code`, `valid_from`) y política de retención.',
  },
  {
    tableName: 'customer_attribute_values',
    whyExists:
      'Guarda los rasgos descriptivos y estables que el negocio usa para estimar capacidad de pago: ingreso declarado, situación laboral, gasto estimado, dependientes. Es distinto de una observación puntual: es un atributo del cliente con vigencia.',
    whyNotDelete:
      'Es la base de la evaluación de capacidad de pago. Sin ella, el crédito se decide solo con señales de comportamiento y dispositivo, lo que produce límites mal calibrados y sobreendeudamiento. También guarda el respaldo (`evidence_id`) que justifica cada valor ante un reclamo.',
    decisionContribution:
      'Determina el monto y el plazo que se puede ofrecer, no solo si se aprueba. `verification_status` y `confidence_score` permiten diferenciar un ingreso declarado de uno respaldado con documento, y ofrecer condiciones distintas en cada caso.',
    usageExample:
      'El cliente declara ingreso mensual de 4.500 Bs sin respaldo: el sistema aprueba con límite conservador. Al subir tres boletas de pago, el atributo pasa a `verified` y una nueva evaluación amplía el límite, con trazabilidad completa del porqué.',
    systemsExplanation:
      'Tabla en `customer` tipada por `attribute_definitions` (que declara dominio, si requiere consentimiento y si está permitida para decisión crediticia o de fraude). Versionada por `valid_from`/`valid_until`, con valor en columna por tipo y enlace a evidencia. `attribute_definitions.allowed_for_credit_decision` debe verificarse antes de usar un atributo en scoring: hay atributos que existen para análisis pero están legalmente prohibidos para decidir.',
  },
  {
    tableName: 'customer_context_enrichments',
    whyExists:
      'Convierte texto libre del cliente en información estructurada y comparable: la zona que escribió, el empleador que declaró, la ocupación que puso. Sin este enriquecimiento, esos datos son cadenas irrepetibles imposibles de analizar.',
    whyNotDelete:
      'Guarda no solo el resultado del match sino el snapshot del catálogo con el que se hizo (`catalog_version_code_snapshot`, `matched_item_code_snapshot`, `matched_item_name_snapshot`). Sin eso, actualizar el catálogo de zonas o de empleadores reescribiría el significado de decisiones ya tomadas.',
    decisionContribution:
      'Traduce datos declarados a dimensiones de riesgo utilizables (zona de riesgo, estabilidad del empleador, categoría ocupacional) y aporta `confidence_score` y `match_method` para decidir si el match es suficientemente confiable como para influir en una decisión adversa.',
    usageExample:
      'El cliente escribe "Villa Fátima" como zona. El enriquecimiento la asocia al ítem `LPZ-VF` de la versión v4 del catálogo de zonas, con confianza 0.93 por match exacto de alias. La evaluación usa la banda de riesgo de esa zona y conserva el snapshot aunque mañana se publique la v5.',
    systemsExplanation:
      'Tabla append-only en `customer` que enlaza `customer_observations` con `context_items` a través de `context_catalog_versions`. Las columnas `*_snapshot` son denormalización intencional para inmunizar decisiones pasadas frente a cambios de catálogo. `match_method` distingue exacto, alias y difuso, lo que permite auditar la calidad del matching y reprocesar solo los casos de baja confianza.',
  },
];
