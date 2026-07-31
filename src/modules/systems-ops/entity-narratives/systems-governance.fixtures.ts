/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import type { EntityBusinessNarrative } from './entity-narrative.types.js';

/** Gobierno técnico del backend: catálogo de endpoints, datos, herramientas, pruebas y operación (schema `platform_ops`). */
export const SYSTEMS_GOVERNANCE_NARRATIVES: EntityBusinessNarrative[] = [
  {
    tableName: 'system_domain_catalog',
    whyExists:
      'Agrupa el modelo de datos en dominios de negocio comprensibles (identidad, privacidad, riesgo, fraude, proveedores) con su definición, su dueño y su relevancia regulatoria. Es lo que permite hablar del sistema por áreas de negocio en lugar de por tablas sueltas.',
    whyNotDelete:
      'Sin dominios, 130 tablas son una lista plana que nadie puede gobernar: no hay dueño por área, no se sabe a quién reclamar por la calidad de un dato ni qué parte del modelo toca un cambio regulatorio. Es el índice que hace navegable todo el catálogo.',
    decisionContribution:
      'Asigna responsabilidad (`owner_team`) y ordena la priorización: dónde invertir en calidad, qué dominios exigen más control por sus `regulatory_notes`, y qué casos de decisión soporta cada área (`decision_use_cases`).',
    usageExample:
      'Un cambio regulatorio afecta el tratamiento de datos biométricos. Se filtra por dominio de privacidad y evidencias, se obtiene la lista de tablas y equipos responsables, y el análisis de impacto se hace en horas en lugar de días.',
    systemsExplanation:
      'Catálogo en `platform_ops` con `domain_code` único, definición de negocio, alcance técnico, `countries_applicable`, `example_tables` y `decision_use_cases` en JSON. Lo consume el portal interno y lo referencian `system_data_entity_catalog.domain_code`, `feature_definitions.domain_code` y otros catálogos. Un dominio declarado sin ninguna entidad asignada es una señal de que la clasificación automática no lo alcanza y debe corregirse.',
  },
  {
    tableName: 'system_data_entity_catalog',
    whyExists:
      'Es el inventario vivo de todas las tablas del sistema con su significado de negocio: qué guarda, por qué, quién la usa, si tiene PII, si es crítica para auditoría y qué retención le aplica. Es el documento que responde "¿qué datos tiene esta empresa?" sin abrir el código.',
    whyNotDelete:
      'Sin él, el conocimiento del modelo vive en la cabeza de quienes lo construyeron y se pierde con la rotación. Se pierde también la capacidad de responder a un requerimiento regulatorio de inventario de datos, de saber dónde hay PII y de justificar por qué cada tabla existe, que es exactamente el propósito de las columnas de narrativa.',
    decisionContribution:
      'Permite decidir sobre el ciclo de vida de los datos: qué se puede archivar, qué no se puede tocar, qué requiere cifrado, qué entra en un export. Sus banderas (`contains_pii`, `contains_financial_data`, `is_audit_critical`) priorizan el trabajo de seguridad y cumplimiento con criterio y no por intuición.',
    usageExample:
      'Antes de aprobar el borrado de una tabla que "parece sin uso", el catálogo muestra `is_audit_critical = true`, retención de 1.095 días y una narrativa que explica que sostiene la explicabilidad de decisiones crediticias. La propuesta de borrado se rechaza con fundamento.',
    systemsExplanation:
      'Tabla en `platform_ops` con clave (`schema_name`, `table_name`). Se llena de forma automática desde `information_schema` (`detected_from`) y se enriquece con narrativa curada a mano; `confidence_level`, `review_status` y `narrative_source` distinguen lo inferido de lo revisado por una persona. Es autorreferente: se cataloga a sí misma, lo cual es correcto porque su propio gobierno también debe ser auditable. La reseeding es idempotente vía upsert por clave natural.',
  },
  {
    tableName: 'system_data_field_catalog',
    whyExists:
      'Baja el inventario al nivel de columna: qué significa cada campo en lenguaje de negocio, de dónde sale, quién lo usa, si es PII, si se usa en scoring o en machine learning, y qué etiqueta muestra el frontend. Es el diccionario de datos real.',
    whyNotDelete:
      'Es lo único que permite responder "¿en qué columnas exactas hay datos personales?" y "¿qué campos alimentan el modelo?" sin auditar todo el código. Sin él, cada análisis de impacto de privacidad o de modelo empieza desde cero.',
    decisionContribution:
      'Sus banderas (`contains_pii`, `used_in_scoring`, `used_in_ml`, `is_ml_candidate`, `sensitivity_level`) deciden qué se puede exponer, exportar y usar para entrenar. `allowed_values` y `validation_rule_json` sostienen la validación y la coherencia entre backend y frontend.',
    usageExample:
      'Se prepara un dataset para entrenar un modelo. Se filtran los campos con `used_in_ml = true` y sin PII directa, y se excluyen los marcados como sensibles, obteniendo un conjunto legalmente defendible sin revisar tabla por tabla.',
    systemsExplanation:
      'Tabla en `platform_ops` con clave (`schema_name`, `table_name`, `column_name`) y FK a `system_data_entity_catalog`. Se genera desde `information_schema` (tipo, nulabilidad, PK/FK, referencias) y se enriquece manualmente; `manually_edited_at` protege el trabajo humano para que un reseed automático no lo sobrescriba. Es la tabla más ancha del catálogo, y esa anchura es deliberada: cada columna responde una pregunta distinta de gobierno.',
  },
  {
    tableName: 'system_data_relationship_catalog',
    whyExists:
      'Documenta cómo se conectan las entidades y, sobre todo, por qué: qué razón de negocio justifica cada relación, qué permite auditar y qué decisión habilita. Incluye relaciones lógicas que no son FK física.',
    whyNotDelete:
      'Es el mapa del modelo. Sin él, entender cómo llegar de un cliente a la evidencia que respaldó su aprobación exige leer código; y las relaciones lógicas (las que no tienen FK) desaparecen por completo del conocimiento del sistema.',
    decisionContribution:
      'Permite hacer análisis de impacto antes de un cambio (qué se rompe si toco esta tabla) y decidir políticas de borrado y de anonimización sin dejar registros huérfanos ni borrar evidencia que debía conservarse.',
    usageExample:
      'Al planificar la anonimización de clientes inactivos, el catálogo revela una relación lógica hacia evidencias que no está protegida por FK. Se ajusta el procedimiento para no dejar documentos huérfanos apuntando a un cliente que ya no existe.',
    systemsExplanation:
      'Tabla en `platform_ops` que enlaza dos entidades del catálogo con sus columnas, más `relationship_type`, `cardinality`, `optionality`, `enforcement_strategy` y `delete_policy`. Se detecta automáticamente desde las FKs reales y se completa a mano con las relaciones lógicas; `confidence_level` y `review_status` distinguen ambas. Es la fuente del grafo de linaje del portal interno.',
  },
  {
    tableName: 'system_operational_rule_catalog',
    whyExists:
      'Reúne en un solo lugar las reglas operativas del backend: qué invariantes deben cumplirse por tabla, columna o endpoint, por qué existen y cómo se hacen cumplir. Es la política técnica escrita.',
    whyNotDelete:
      'Sin este catálogo, las reglas viven dispersas entre constraints, validaciones Zod, guards y convenciones no escritas. Nadie puede revisar el conjunto ni detectar reglas que se dejaron de aplicar cuando se refactorizó un módulo.',
    decisionContribution:
      '`severity`, `expected_action` y `enforcement_layer` permiten decidir dónde falta control y priorizar su implementación. Es la base de gates automáticos que verifican que lo declarado se cumple realmente.',
    usageExample:
      'La regla `REQUEST_TRACEABILITY` exige que toda escritura sea vinculable a endpoint, actor y request id. Al auditar, se descubre un job que escribe sin correlación; se corrige y la regla pasa a verificarse automáticamente.',
    systemsExplanation:
      'Catálogo en `platform_ops` con `rule_code` único y alcance flexible (`scope_type` más schema/tabla/columna/endpoint/dominio). `technical_enforcement` y `enforcement_layer` documentan dónde se aplica realmente: base de datos, aplicación o proceso. Una regla declarada sin enforcement es deuda visible, que es mejor que deuda invisible.',
  },
  {
    tableName: 'system_endpoint_catalog',
    whyExists:
      'Es el inventario de la superficie de API del backend: cada endpoint con su propósito de negocio, su acción, sus roles permitidos, su nivel de riesgo, si es destructivo y si expone PII. Es lo que permite gobernar la API como un activo y no como un efecto secundario del código.',
    whyNotDelete:
      'Sin él nadie sabe cuántos endpoints existen, cuáles exponen datos personales ni cuáles son destructivos. Es imprescindible para revisiones de seguridad, para el portal interno de pruebas y para decidir qué se expone hacia afuera.',
    decisionContribution:
      '`risk_level`, `is_destructive`, `requires_stress_test`, `requires_integration_test` y `is_safe_for_production` deciden qué se prueba, qué se puede ejecutar desde el portal y qué exige aprobación. `contains_pii` y `pii_fields` orientan las revisiones de privacidad.',
    usageExample:
      'Antes de un release se filtran los endpoints con `risk_level = HIGH` y sin prueba de integración asociada. Aparecen tres; se cubren con pruebas antes de desplegar, en lugar de descubrir el hueco en producción.',
    systemsExplanation:
      'Tabla en `platform_ops` con `code` único generado desde módulo, método y ruta. Se llena por descubrimiento automático (`endpoint-discovery.service.ts` escanea controladores y decoradores) y se enriquece a mano; `metadata_completeness_score` mide cuánto falta. Es padre de contratos de payload, impactos de datos y de campos, requerimientos de herramientas y perfiles de estrés.',
  },
  {
    tableName: 'system_endpoint_payload_contracts',
    whyExists:
      'Documenta qué recibe y qué devuelve cada endpoint: esquema, campos requeridos y opcionales, y un ejemplo. Es el contrato que consumen el frontend, QA y los integradores sin tener que leer el backend.',
    whyNotDelete:
      'Sin contratos explícitos, cada integración se hace por prueba y error y cada cambio de payload rompe clientes en silencio. También se pierde la capacidad de generar ejemplos y pruebas automáticas desde el catálogo.',
    decisionContribution:
      '`validation_layer` y `confidence_level` distinguen un contrato derivado de un esquema Zod real de uno inferido de la ruta, y esa distinción decide si se puede confiar en él para generar clientes o si necesita revisión antes de publicarse.',
    usageExample:
      'El equipo del portal administrativo necesita integrar un endpoint nuevo. Toma el contrato con su `sample_payload_json` y construye la llamada correcta a la primera, sin preguntarle a nadie del backend.',
    systemsExplanation:
      'Tabla en `platform_ops` hija de `system_endpoint_catalog`, con clave (`endpoint_id`, `contract_type`, `schema_reference`). Los contratos provenientes de `ZodValidationPipe` se marcan con alta confianza; los inferidos quedan como `NEEDS_REVIEW`, porque publicar un contrato adivinado como si fuera verdad es peor que no publicarlo.',
  },
  {
    tableName: 'system_endpoint_data_entity_impacts',
    whyExists:
      'Responde qué tablas toca cada endpoint y de qué manera: lee, escribe, es transaccional, afecta estado del cliente, financiero, de riesgo o legal. Es el análisis de impacto que normalmente no existe hasta que algo se rompe.',
    whyNotDelete:
      'Sin él, evaluar el impacto de un cambio o de un incidente exige leer el código de cada servicio. Se pierde también la trazabilidad inversa: qué endpoints pueden haber alterado una tabla durante una ventana de incidente.',
    decisionContribution:
      '`affects_financial_state`, `affects_legal_state` y `requires_audit_log` deciden qué endpoints necesitan auditoría obligatoria, transaccionalidad estricta y pruebas de regresión. Es el insumo para decidir el alcance de una prueba antes de un release.',
    usageExample:
      'Se detecta corrupción en una tabla de riesgo. Consultando por impacto se obtienen los cuatro endpoints que escriben en ella; el análisis se concentra en esos y se encuentra la causa en minutos.',
    systemsExplanation:
      'Tabla en `platform_ops` que enlaza `system_endpoint_catalog` con `system_data_entity_catalog`, con `operation_type`, nivel de impacto y las listas de campos leídos y escritos en JSON. Se infiere analizando servicios y repositorios, por lo que `confidence_level` importa: un impacto inferido no debe usarse como garantía de completitud sin revisión.',
  },
  {
    tableName: 'system_endpoint_field_impacts',
    whyExists:
      'Lleva el análisis de impacto al nivel de campo: qué columnas concretas escribe o lee un endpoint, cuáles vienen del payload y cuáles las genera el backend, y cuáles son sensibles.',
    whyNotDelete:
      'Es lo que permite responder con precisión "¿qué endpoint pudo haber cambiado este campo?" y "¿qué endpoints exponen esta columna con PII?". A nivel de tabla la respuesta es demasiado gruesa para una investigación seria.',
    decisionContribution:
      '`is_required_input`, `is_generated`, `is_sensitive` e `is_ml_candidate` deciden validación, redacción en logs y elegibilidad para datasets. `payload_path` conecta el campo de la API con la columna real, que es lo que permite auditar de punta a punta.',
    usageExample:
      'Ante una fuga sospechada de un campo sensible, se listan los endpoints que lo devuelven. Aparece uno de reportes sin restricción de rol adecuada; se corrige el permiso y se revisa quién lo consumió con el registro de acciones.',
    systemsExplanation:
      'Tabla en `platform_ops` que enlaza endpoint y entidad con `field_name` y `field_operation`. Es la de mayor cardinalidad del catálogo de sistemas (endpoints × campos), así que su generación debe ser incremental y su lectura siempre filtrada por endpoint o por entidad, nunca completa.',
  },
  {
    tableName: 'system_endpoint_tool_requirements',
    whyExists:
      'Declara de qué herramientas externas depende cada endpoint (base de datos, Redis, S3, proveedores, colas) y qué pasa si esa dependencia falla. Es el mapa de dependencias que explica por qué se cae lo que se cae.',
    whyNotDelete:
      'Sin él, un incidente en una dependencia obliga a adivinar qué funcionalidades quedaron afectadas. También se pierde la definición de fallback por endpoint, que es lo que permite degradar con criterio en lugar de devolver error a todo.',
    decisionContribution:
      '`failure_impact` y `fallback_strategy` deciden la estrategia de degradación y qué se prueba con mocks. Permiten priorizar redundancia donde el impacto es mayor, en vez de invertir por igual en todas las dependencias.',
    usageExample:
      'Redis se cae. Consultando el catálogo se ve qué endpoints lo requieren de forma crítica y cuáles pueden operar sin cache; se comunica un impacto acotado y correcto en lugar de anunciar una caída total.',
    systemsExplanation:
      'Tabla en `platform_ops` que enlaza `system_endpoint_catalog` con `system_tool_catalog`, con `usage_type`, `is_required`, `requires_mock` y `requires_stress_test`. Se infiere de las dependencias inyectadas en cada servicio y se corrige a mano. Alimenta tanto el health check compuesto como la generación de suites de prueba.',
  },
  {
    tableName: 'system_tool_catalog',
    whyExists:
      'Inventaría las herramientas y servicios de los que depende el backend: qué son, quién las provee, qué variables de entorno necesitan, si tienen sandbox y si son críticas. Es la lista de "de qué depende que esto funcione".',
    whyNotDelete:
      'Sin ella, las dependencias externas viven en variables de entorno y en la memoria del equipo. No se puede evaluar riesgo de proveedor, ni planificar un ambiente nuevo, ni saber qué se rompe si una credencial expira.',
    decisionContribution:
      '`is_critical`, `failure_risks` y `requires_credentials` deciden dónde invertir en redundancia y monitoreo, y qué herramientas necesitan mock para poder probar sin depender de terceros. `business_value` justifica cada dependencia frente a su costo.',
    usageExample:
      'Al preparar un ambiente de pruebas se filtran las herramientas con `has_sandbox = false` e `is_critical = true`: son las que hay que mockear obligatoriamente. Eso define el alcance del servidor de mocks antes de escribir una línea.',
    systemsExplanation:
      'Catálogo en `platform_ops` con `code` único, tipo, proveedor, `required_env_vars`, `healthcheck_route` e `is_worker`. Declara los NOMBRES de las variables de entorno, nunca sus valores: los secretos viven en configuración y KMS. Alimenta el endpoint de salud de herramientas y los requerimientos por endpoint.',
  },
  {
    tableName: 'system_test_suites',
    whyExists:
      'Agrupa las pruebas ejecutables desde el portal interno: qué prueba, de qué módulo, en qué ambientes puede correr y si es segura para producción. Permite que operaciones y QA verifiquen el sistema sin pedirle nada a ingeniería.',
    whyNotDelete:
      'Sin el catálogo de suites, la verificación del sistema depende de que alguien recuerde qué scripts existen. Se pierde también la definición de qué es seguro ejecutar en producción, que es la barrera que evita que una prueba destruya datos reales.',
    decisionContribution:
      '`is_safe_for_production`, `requires_destructive_permission` y `environment_scope` deciden quién puede correr qué y dónde. Es un control de riesgo operativo, no solo una comodidad.',
    usageExample:
      'Tras un despliegue, operaciones ejecuta la suite de humo marcada como segura para producción y confirma en tres minutos que login, catálogo y evaluación de riesgo responden, sin esperar a que ingeniería lo verifique.',
    systemsExplanation:
      'Catálogo en `platform_ops` con `code` único, modo de ejecución y banderas de seguridad. Es padre de `system_test_steps` y de `system_test_runs`. `requires_seed_data` indica dependencia de datos semilla: correr esa suite en un ambiente vacío produce fallos que no son del sistema sino del entorno, y esa distinción hay que hacerla explícita.',
  },
  {
    tableName: 'system_test_steps',
    whyExists:
      'Define los pasos concretos de cada suite: qué endpoint llamar, con qué payload, qué extraer de la respuesta y qué verificar. Es la prueba escrita como dato, no como código, para que pueda mantenerse sin desplegar.',
    whyNotDelete:
      'Sin los pasos, las suites son cascarones vacíos. Se pierde la capacidad de encadenar llamadas (crear un cliente y usar su id en el paso siguiente) y de definir aserciones sin tocar el repositorio.',
    decisionContribution:
      'Las aserciones definen qué se considera "el sistema funciona", y esa definición es una decisión de negocio: qué códigos de respuesta se aceptan, qué tiempos, qué campos deben venir. `cleanup_required` decide si el paso deja residuos que hay que limpiar.',
    usageExample:
      'Un paso crea un cliente de prueba y extrae su id con un extractor; el siguiente inicia una evaluación de riesgo con ese id y verifica que la respuesta traiga un `recommended_action`. La suite completa valida el flujo end to end sin código nuevo.',
    systemsExplanation:
      'Tabla en `platform_ops` hija de `system_test_suites`, con `step_order`, plantilla de ruta, headers y payload por defecto, `extractors` y `assertions` en JSON. La ejecuta `systems-test-runner.service.ts`. Las URLs objetivo pasan por `systems-test-url-policy.util.ts`: sin esa allowlist, una suite editable desde el portal sería un SSRF con interfaz gráfica.',
  },
  {
    tableName: 'system_test_runs',
    whyExists:
      'Registra cada ejecución de una suite: cuándo, en qué ambiente, quién la disparó y cómo terminó. Es la evidencia de que el sistema se verificó.',
    whyNotDelete:
      'Sin historial de ejecuciones no se puede demostrar que se probó antes de desplegar, ni detectar pruebas intermitentes, ni correlacionar un incidente con la última verificación exitosa.',
    decisionContribution:
      'Permite decidir si un despliegue procede o se revierte, y detectar degradación progresiva comparando duraciones y tasas de fallo entre ejecuciones. Una suite que empieza a fallar de forma intermitente es señal antes que síntoma.',
    usageExample:
      'La suite de humo pasa en desarrollo y falla en staging tras un despliegue. La comparación de ejecuciones muestra el paso exacto que cambió de comportamiento y el despliegue se detiene antes de producción.',
    systemsExplanation:
      'Tabla en `platform_ops` hija de `system_test_suites`, con `environment`, `triggered_by`, estado, tiempos, `duration_ms`, `summary` y `logs_url`. Es padre de `system_test_step_runs`. Debe registrar también las ejecuciones que fallan al arrancar: una corrida que no deja rastro es indistinguible de una que nunca se lanzó.',
  },
  {
    tableName: 'system_test_step_runs',
    whyExists:
      'Guarda el resultado de cada paso dentro de una ejecución: qué se envió, qué respondió, con qué código y en cuánto tiempo. Es el detalle que convierte un "falló la suite" en un diagnóstico.',
    whyNotDelete:
      'Sin el detalle por paso, un fallo obliga a reproducir manualmente toda la secuencia. Se pierde además la evidencia del momento del fallo, que muchas veces no se puede reproducir después porque el estado cambió.',
    decisionContribution:
      'Localiza la causa y permite decidir si el fallo es del sistema, de los datos o de la prueba misma. Los tiempos por paso identifican qué endpoint se está degradando antes de que algún usuario lo note.',
    usageExample:
      'La suite falla en el paso 4 con código 500. El registro muestra el payload enviado (saneado) y el mensaje de error; el defecto se reproduce y se corrige sin volver a ejecutar toda la secuencia.',
    systemsExplanation:
      'Tabla append-only en `platform_ops`, hija de `system_test_runs` y ligada a `system_test_steps`. Los campos `request_payload_sanitized` y `response_body_sanitized` son sanitizados por definición: una suite puede llamar endpoints con datos personales y esta tabla es visible desde el portal, así que el saneamiento es un requisito de seguridad, no una comodidad.',
  },
  {
    tableName: 'system_stress_profiles',
    whyExists:
      'Define cómo se prueba la capacidad de cada endpoint: cuántas peticiones por segundo, con qué concurrencia, por cuánto tiempo y qué umbrales de error y latencia se consideran aceptables.',
    whyNotDelete:
      'Sin perfiles declarados, las pruebas de carga se improvisan y sus resultados no son comparables entre ejecuciones. Se pierde también la definición de qué es aceptable, que es la que convierte un número en una decisión de aprobar o no.',
    decisionContribution:
      '`max_error_rate` y `max_p95_ms` son el criterio objetivo de aprobación de rendimiento. `requires_approval` y `environment_scope` evitan que alguien lance carga contra producción por accidente, que es el modo más rápido de causar el incidente que se quería prevenir.',
    usageExample:
      'Antes de una campaña se ejecuta el perfil del endpoint de evaluación de riesgo a 200 peticiones por segundo. El p95 supera el umbral definido; se ajusta el pool de conexiones y se repite hasta cumplir el criterio.',
    systemsExplanation:
      'Tabla en `platform_ops` hija de `system_endpoint_catalog`, con `code` único, objetivos de carga, umbrales, alcance de ambiente y banderas de aprobación. La ejecución vive en el controlador de estrés, que debe verificar `environment_scope` y `requires_approval` ANTES de generar tráfico. Sin ese control, es una herramienta de denegación de servicio contra uno mismo.',
  },
  {
    tableName: 'system_action_logs',
    whyExists:
      'Registra cada petición HTTP relevante que atraviesa el backend: qué endpoint, qué actor, con qué payload saneado, qué respondió, cuánto tardó y con qué nivel de riesgo. Es la caja negra técnica del sistema.',
    whyNotDelete:
      'Es lo que permite reconstruir qué pasó durante un incidente y correlacionar la experiencia del usuario con el comportamiento del backend. Sin ella, la investigación depende de logs de aplicación que rotan y no son evidencia estructurada ni consultable.',
    decisionContribution:
      'Alimenta decisiones operativas (qué endpoints degradan, qué errores crecen), de seguridad (accesos anómalos, uso de idempotencia) y de producto (qué se usa realmente). `contains_pii` y `risk_level` permiten priorizar la revisión sin leerlo todo.',
    usageExample:
      'Los usuarios reportan lentitud. Agrupando por `route_template` se ve que un endpoint pasó de 200 ms a 3 segundos tras un despliegue; el `correlation_id` conecta esas peticiones con las trazas y se identifica una consulta sin índice.',
    systemsExplanation:
      'Tabla append-only y de muy alto volumen en `platform_ops`, escrita por `http-action-log.interceptor.ts` y ligada a `system_endpoint_catalog`. Todo lo que persiste está saneado: payload, URL resuelta, resumen de respuesta, y de la clave de idempotencia solo hash y últimos cuatro caracteres. Nunca debe contener SQL (Sequelize inlinea valores y filtraría PII). Necesita índices por (`occurred_at`, `endpoint_catalog_id`) y purga o particionado por antigüedad.',
  },
  {
    tableName: 'system_job_runs',
    whyExists:
      'Registra la ejecución de los procesos que corren fuera del ciclo petición-respuesta: purgas de retención, recálculo de proyecciones, publicación del outbox, cargas de catálogo. Es la evidencia de que el trabajo de fondo realmente ocurrió.',
    whyNotDelete:
      'Los jobs fallan en silencio: nadie recibe un error 500. Sin este registro, un proceso de purga puede llevar meses sin correr y el primero en notarlo será un auditor. También se pierde la prueba de que las obligaciones de retención se ejecutaron.',
    decisionContribution:
      'Su estado, resultado y duración deciden si se reintenta, se alerta o se escala, y permiten comprometer y verificar SLAs internos. Un job crítico sin ejecución reciente debe disparar alarma, y esta tabla es lo que hace posible detectarlo.',
    usageExample:
      'El job de purga de retención no corre desde hace 30 días por una credencial vencida. El monitoreo sobre esta tabla lo detecta, se renueva la credencial y se ejecuta el atraso antes de que el incumplimiento sea material.',
    systemsExplanation:
      'Tabla en `platform_ops` con `_tenant_id`, `job_code`, estado, tiempos, `input_json`, `result_json`, `error_message` y disparador. El job debe escribir la fila al INICIAR, no al terminar: si solo se registra el final, un proceso que muere a mitad no deja rastro alguno, que es exactamente el caso que más importa detectar.',
  },
  {
    tableName: 'system_catalog_review_events',
    whyExists:
      'El catálogo de sistemas se llena en gran parte de forma automática, y esas inferencias necesitan revisión humana. Esta tabla registra cada revisión: qué se revisó, cómo cambió su estado y su nivel de confianza, y quién lo decidió.',
    whyNotDelete:
      'Es lo que distingue un catálogo revisado de uno adivinado. Sin ella, `review_status = REVIEWED` es una afirmación sin autor ni fecha, y todo el gobierno de datos pierde credibilidad porque nadie puede probar que alguien lo miró.',
    decisionContribution:
      'Permite medir el avance real del gobierno (cuánto del catálogo está revisado y por quién) y decidir dónde concentrar el esfuerzo. También sostiene la reversión de una revisión equivocada con trazabilidad.',
    usageExample:
      'Un endpoint fue marcado como sin PII automáticamente. Un revisor detecta que devuelve el correo del cliente, cambia el estado y la confianza, y el evento queda con su nota. El siguiente reseed automático no puede sobrescribir esa corrección sin dejar rastro.',
    systemsExplanation:
      'Tabla append-only en `platform_ops` con objetivo polimórfico (`target_type`, `target_id`), transición de estado y de confianza, actor y notas. Es la contraparte de auditoría de los campos `review_status`/`confidence_level` que aparecen en todo el catálogo de sistemas. Se escribe en la misma transacción que el cambio que documenta.',
  },
];
