/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import type { EntityBusinessNarrative } from './entity-narrative.types.js';

/** Definiciones de variables, cálculo de features, modelos, reglas y evaluaciones de riesgo (schema `risk`). */
export const RISK_SCORING_NARRATIVES: EntityBusinessNarrative[] = [
  {
    tableName: 'attribute_definitions',
    whyExists:
      'Es el diccionario de los rasgos descriptivos del cliente que el negocio puede usar: ingreso declarado, situación laboral, dependientes, gasto estimado. Define qué significa cada uno, de dónde sale y, sobre todo, si está permitido usarlo para decidir un crédito.',
    whyNotDelete:
      'Es el control legal sobre las variables. Sus banderas `allowed_for_credit_decision`, `allowed_for_fraud_decision`, `prohibited_reason_code`, `fairness_review_required` y `legal_review_status` son lo que impide que una variable discriminatoria entre al modelo por descuido. Sin ella, `customer_attribute_values` guarda valores sin significado ni permiso.',
    decisionContribution:
      'Actúa como gate previo al scoring: una variable con `legal_review_status` pendiente o con `allowed_for_credit_decision = false` no puede influir en una decisión adversa, aunque exista el dato. Eso convierte una intención de cumplimiento en un control ejecutable.',
    usageExample:
      'Se propone usar "cantidad de hijos" como variable de capacidad de pago. La definición queda con `fairness_review_required = true` y `allowed_for_credit_decision = false` hasta que legal se pronuncie; el motor la ignora aunque el dato esté cargado.',
    systemsExplanation:
      'Catálogo en `risk` con `attribute_code` único, `entity_scope`, `data_type`, `risk_dimension`, `data_classification_code`, `retention_policy_id`, `owner_team` y `review_status`. Es referenciado por `customer_attribute_values.attribute_definition_id`. Es de lectura intensiva y baja escritura: se cachea, y todo cambio de sus banderas de permiso debe quedar auditado porque altera el comportamiento del motor de decisión.',
  },
  {
    tableName: 'observation_definitions',
    whyExists:
      'Define el vocabulario de los hechos observables sobre un cliente: qué se puede observar, en qué etapa del flujo está disponible, de qué grupo de fuente proviene y qué clasificación de datos tiene. Da estructura a lo que de otro modo sería un saco de claves libres.',
    whyNotDelete:
      'Sin él, `customer_observations.observation_code` es texto libre: cada equipo inventa su nomenclatura, nadie sabe qué significa un código viejo y las features se construyen sobre arena. También se pierden los controles de consentimiento y de uso permitido por observación.',
    decisionContribution:
      '`expected_availability_stage` permite diseñar decisiones por etapa (qué se puede evaluar antes de pedir permisos y qué después), y `requires_consent` más los flags de uso permitido determinan si una observación puede alimentar una decisión crediticia o solo antifraude.',
    usageExample:
      'La observación `SIM_TENURE_MONTHS` está definida con `expected_availability_stage = post_permission` y `requires_consent = true`. El motor no la espera en la evaluación inicial y no la usa si el consentimiento no está vigente, evitando decidir con un dato que no debía tener.',
    systemsExplanation:
      'Catálogo en `risk` con `observation_code` único, tipo de dato, dimensión de riesgo, clasificación, retención, owner y estado de revisión. Es la contraparte de `customer_observations` y el punto donde se valida que un código nuevo esté declarado antes de aceptarlo en la ingesta. Sin esa validación, la tabla de observaciones se degrada en un depósito sin esquema.',
  },
  {
    tableName: 'feature_definitions',
    whyExists:
      'Declara las variables calculadas que alimentan modelos y reglas: cómo se llaman, a qué familia y dimensión de riesgo pertenecen, cómo se calculan, qué hacer si faltan y si son entrada de modelo o de regla. Es el contrato entre data science y el motor de decisión.',
    whyNotDelete:
      'Es lo que hace explicable el score. Sin la definición de cada feature (incluida su `default_missing_strategy` y su `availability_tier`), nadie puede explicar por qué un cliente obtuvo un puntaje, ni reproducir el cálculo, ni auditar si se usó una variable prohibida.',
    decisionContribution:
      'Determina qué puede entrar al modelo (`is_model_input`) y a las reglas (`is_policy_rule_input`), y bloquea legalmente lo que no debe usarse (`allowed_for_credit_decision`, `prohibited_reason_code`, `fairness_review_required`). Es donde el negocio decide el alcance de la automatización antes de que exista una sola línea de scoring.',
    usageExample:
      'La feature `DEVICE_REUSE_COUNT_30D` está marcada `allowed_for_fraud_decision = true` y `allowed_for_credit_decision = false`. Puede bloquear por fraude, pero no puede bajar la línea de crédito de nadie: el motor aplica esa distinción automáticamente.',
    systemsExplanation:
      'Catálogo en `risk` con `feature_code` único, familia, dimensión, tipo de dato, `calculation_kind`, clasificación, retención, owner y estado de revisión. Es referenciado por `feature_values.feature_definition_id` y por las reglas. Cambiar una definición sin versionar el `feature_set_version` rompe la comparabilidad histórica: la definición y el conjunto de features van juntos.',
  },
  {
    tableName: 'feature_computation_runs',
    whyExists:
      'Cada vez que el sistema calcula features para un cliente, esa ejecución es un hecho de negocio: por qué se disparó, con qué versión de código y de conjunto de features, cuánto tardó y si tuvo éxito. Sin esa cabecera, los valores calculados aparecen sin origen.',
    whyNotDelete:
      'Es la unidad de reproducibilidad. Sin `feature_set_version` y `code_version` no se puede reproducir un cálculo pasado ni explicar por qué la misma entrada da hoy un resultado distinto. También se pierde la idempotencia: `idempotency_key` es lo que evita recalcular y duplicar valores ante un reintento.',
    decisionContribution:
      'Su `status` decide si las features son utilizables: una corrida fallida o parcial no debe alimentar una decisión. `retry_count` y la latencia permiten decidir sobre capacidad e infraestructura antes de que el motor empiece a fallar en horas pico.',
    usageExample:
      'Una corrida termina con `status = partial` porque el proveedor de buró expiró. El motor no aprueba con features incompletas: marca la evaluación como no concluyente y la deriva a revisión en lugar de decidir con datos faltantes.',
    systemsExplanation:
      'Tabla en `risk` con `_tenant_id`, sujeto polimórfico (`subject_type`, `subject_id`) más los enlaces concretos a cliente, sesión, flujo y dispositivo. `idempotency_key` es única por sujeto y disparador. Es la cabecera de `feature_values`; ambos se escriben en la misma transacción para que no existan valores sin corrida. `started_at`/`finished_at` alimentan las métricas de latencia del motor.',
  },
  {
    tableName: 'feature_values',
    whyExists:
      'Guarda el valor concreto de cada feature calculada para un sujeto: el número que efectivamente entró al modelo. Es el insumo directo del score.',
    whyNotDelete:
      'Es lo que permite reproducir y defender una decisión. Sin los valores exactos usados en ese momento, recalcular hoy dará otro resultado (los datos cambiaron) y la decisión histórica queda indefendible ante un reclamo o un regulador.',
    decisionContribution:
      'Alimenta modelo y reglas, y su `confidence_score` permite ponderar. La vigencia (`valid_from`/`valid_until`) evita decidir con features caducas, y `derivation_method`/`derivation_version` explican cómo se llegó a cada número.',
    usageExample:
      'La feature `MONTHS_SINCE_FIRST_SEEN = 0.2` con confianza alta contribuye negativamente al score de un cliente nuevo. Al reclamar, se le muestra exactamente ese valor y su contribución, no una explicación genérica.',
    systemsExplanation:
      'Tabla append-only y de alto volumen en `risk`, hija de `feature_computation_runs` y tipada por `feature_definitions`. Valor en columna por tipo (`value_text`/`value_number`/`value_boolean`/`value_json`). Índices por (`customer_id`, `feature_definition_id`, `valid_from`). El motor no debe leer valores sueltos sino a través de `feature_snapshots` cuando la decisión requiere consistencia entre todas las features.',
  },
  {
    tableName: 'feature_lineage_links',
    whyExists:
      'Responde de dónde salió cada número. Conecta una feature calculada con los registros fuente que la produjeron: qué observación, qué respuesta de proveedor, qué evento la originó y con qué peso.',
    whyNotDelete:
      'Es el linaje de datos. Sin él, explicar una decisión se queda en "la feature valía 0.83" y nunca llega a "porque la boleta de pago que subiste decía tal cosa". Es también lo que permite invalidar en cadena: si una fuente resulta errónea, se sabe exactamente qué features y qué decisiones contaminó.',
    decisionContribution:
      'Habilita la explicabilidad real ante el cliente y el auditor, y permite decidir remediaciones quirúrgicas: reprocesar solo las evaluaciones afectadas por una fuente defectuosa en vez de todas.',
    usageExample:
      'Un proveedor reconoce que devolvió datos erróneos durante seis horas. Por linaje se identifican las 412 features derivadas de esas respuestas y las 180 evaluaciones afectadas; solo esas se recalculan y se notifican.',
    systemsExplanation:
      'Tabla append-only en `risk` con referencia polimórfica a la fuente (`source_type`, `source_table`, `source_record_id`, `source_code`), `source_snapshot_json` con el valor tal como estaba, y `contribution_weight`. El snapshot es deliberadamente redundante: si la fila fuente se purga por retención, el linaje sigue siendo legible. Crece rápido y necesita política de retención alineada con la de las decisiones que explica.',
  },
  {
    tableName: 'feature_snapshots',
    whyExists:
      'Congela el conjunto completo de features en el instante de una decisión, con su hash de integridad. Es la "foto" sobre la que se decidió, y es lo que convierte una decisión automatizada en algo auditable.',
    whyNotDelete:
      'Es la pieza central de la defensa de una decisión. Reunir features sueltas después nunca reproduce exactamente el estado del momento; el snapshot sí. Sin él, cualquier impugnación de un rechazo crediticio es prácticamente indefendible.',
    decisionContribution:
      'Es la entrada única del modelo y las reglas, lo que garantiza que todos los componentes decidan sobre el mismo estado. `missing_features_json` documenta qué faltaba, que muchas veces explica una decisión conservadora mejor que lo que sí estaba.',
    usageExample:
      'Un cliente rechazado pide explicación seis meses después. Se recupera el snapshot, se verifica su `integrity_hash`, y se muestran las features presentes, las faltantes y las versiones de catálogo usadas. La explicación es exacta y verificable.',
    systemsExplanation:
      'Tabla append-only en `risk` que guarda `features_json`, `missing_features_json`, `feature_set_version`, `catalog_versions_json` e `integrity_hash`. El hash se calcula sobre el JSON canónico y se verifica al leer: si no coincide, el snapshot está corrupto o alterado y no debe usarse como evidencia. Es referenciado por `risk_assessment_runs` y `risk_assessment_results`. Su retención debe ser al menos tan larga como la obligación legal de justificar decisiones.',
  },
  {
    tableName: 'risk_model_versions',
    whyExists:
      'Un modelo de riesgo no es eterno: se entrena, se aprueba, entra en vigencia y algún día se retira. Esta tabla declara cada versión, su tipo, su período de vigencia y quién la aprobó.',
    whyNotDelete:
      'Es la identidad de la lógica que decidió. Sin ella, todas las decisiones históricas se atribuyen a "el modelo" como si fuera uno solo, y se vuelve imposible explicar por qué dos clientes idénticos en meses distintos recibieron resultados distintos, o hacer backtesting serio.',
    decisionContribution:
      'Determina qué modelo aplica en cada momento y permite decidir sobre su ciclo de vida: promover, revertir, retirar. `artifact_hash` garantiza que el binario que corre en producción es el que se aprobó, no otro que alguien subió después.',
    usageExample:
      'La v4 se despliega y la tasa de aprobación cae 15 puntos. Se revierte a la v3 cambiando la vigencia, sin redeploy: las evaluaciones vuelven a la versión anterior y las hechas con v4 quedan identificadas para revisión.',
    systemsExplanation:
      'Catálogo en `risk` con (`model_code`, `version_code`) único, `status`, `effective_from`/`effective_until`, aprobador y `artifact_url`/`artifact_hash`. La vigencia no debe solaparse para un mismo `assessment_type`; solaparla produce decisiones no deterministas. `risk_assessment_runs.risk_model_version_id` fija la versión usada en cada corrida y `risk_assessment_results` guarda además el código como snapshot de texto.',
  },
  {
    tableName: 'risk_ruleset_versions',
    whyExists:
      'Las reglas de política (los "no" duros del negocio: edad mínima, listas, hard stops) cambian más seguido que los modelos y se versionan aparte. Esta tabla es esa versión de política, con su vigencia y su aprobación.',
    whyNotDelete:
      'Sin versionado de reglas no se puede saber qué política estaba vigente cuando se rechazó a alguien. Se pierde la posibilidad de revertir una regla mal calibrada de forma controlada y de demostrar que el criterio no se cambió después del hecho.',
    decisionContribution:
      'Permite mover la política sin tocar el modelo, que es lo que el negocio necesita para reaccionar rápido ante un ataque o un cambio regulatorio, y permite comparar el efecto de dos versiones sobre el mismo tráfico.',
    usageExample:
      'Ante una ola de fraude con SIM swap se publica una versión con la regla `SIM_SWAP_RECENT` como hard stop, vigente desde esa noche. Al pasar la ola se retira, y las decisiones de esa semana siguen explicándose con la versión que realmente aplicó.',
    systemsExplanation:
      'Catálogo en `risk` con (`ruleset_code`, `version_code`) único, `assessment_type`, `status`, vigencia y aprobador. Es la cabecera de `risk_policy_rules`: las reglas pertenecen a una versión y no se editan una vez vigentes, se publica una versión nueva. `risk_assessment_runs` fija la versión usada y `risk_rules_fired` guarda además el código como snapshot.',
  },
  {
    tableName: 'risk_policy_rules',
    whyExists:
      'Es la política escrita en forma ejecutable: cada regla con su código, dimensión, severidad, expresión, acción y motivo. Permite que negocio y compliance lean las reglas sin abrir el código fuente.',
    whyNotDelete:
      'Es la fuente de verdad de la política de riesgo. Si vive solo en código, cada cambio exige despliegue, nadie fuera de ingeniería puede auditarla y no queda registro comprensible de qué se aplicaba antes. Su `reason_code` es también lo que sostiene una notificación de rechazo con motivo.',
    decisionContribution:
      '`action_code` e `is_hard_stop` definen el resultado: aprobar, revisar, rechazar o bloquear sin apelación automática. `severity` y `risk_dimension` permiten priorizar y explicar la decisión por dimensión, en lugar de un veredicto opaco.',
    usageExample:
      'La regla `AGE_UNDER_18` con `is_hard_stop = true` y `reason_code = MINOR_APPLICANT` rechaza sin evaluar el resto. El cliente recibe un motivo concreto y el caso no consume una consulta paga a buró.',
    systemsExplanation:
      'Tabla en `risk` hija de `risk_ruleset_versions`, con `rule_code` único dentro de la versión y `expression_json` como expresión declarativa evaluada por el motor. La expresión debe referirse a `feature_definitions` declaradas y con permiso de uso; evaluar una expresión sobre features prohibidas es exactamente el fallo de cumplimiento que el catálogo intenta prevenir. Las reglas de una versión vigente son inmutables.',
  },
  {
    tableName: 'risk_assessment_runs',
    whyExists:
      'Es el acto de evaluar: cuándo se evaluó a quién, por qué se disparó, con qué modelo, qué ruleset y qué snapshot de features. Es la cabecera de toda decisión de riesgo.',
    whyNotDelete:
      'Es el índice de todas las decisiones automatizadas del sistema. Sin ella se pierde la relación entre una decisión y las versiones exactas de modelo, reglas y datos que la produjeron, y con ello toda posibilidad de auditoría o de reproducción.',
    decisionContribution:
      'Ordena y hace idempotente el proceso: `idempotency_key` evita evaluar dos veces el mismo hecho y `run_status` distingue una evaluación válida de una fallida. `latency_ms` permite decidir sobre capacidad antes de que el motor degrade la experiencia de compra.',
    usageExample:
      'Una compra dispara una evaluación con `trigger_source = checkout`. Un reintento por timeout de red reusa la misma `idempotency_key` y devuelve la corrida existente, evitando una segunda consulta a buró y una segunda decisión potencialmente distinta.',
    systemsExplanation:
      'Tabla en `risk` con `_tenant_id`, sujeto polimórfico y enlaces a `feature_snapshots`, `risk_model_versions` y `risk_ruleset_versions`. Es padre de `risk_assessment_results`, `risk_feature_contributions`, `risk_rules_fired` y `risk_assessment_contexts`. La corrida y su resultado se escriben en la misma transacción; una corrida sin resultado indica un fallo que debe monitorearse, no un estado normal.',
  },
  {
    tableName: 'risk_assessment_contexts',
    whyExists:
      'El riesgo no depende solo del cliente: depende de qué compra, dónde, por cuánto y a quién. Esta tabla congela ese contexto comercial (comercio, tienda, categoría, canasta, monto, anticipo, distancia a domicilio) en el momento de decidir.',
    whyNotDelete:
      'Sin contexto, una decisión de BNPL es inexplicable: el mismo cliente puede ser bajo riesgo para una compra de 300 Bs y alto para una de 8.000 Bs en un comercio con alta morosidad. Los snapshots del comercio son imprescindibles porque su banda de riesgo cambia con el tiempo.',
    decisionContribution:
      'Aporta las señales que más pesan en BNPL: `purchase_to_declared_income_ratio`, `merchant_risk_band_snapshot`, `merchant_default_rate_snapshot`, `basket_anomaly_score`, `basket_duplicate_item_count`, `down_payment_behavior_snapshot` y `store_to_home_distance_meters`. Deciden monto aprobado, anticipo exigido o derivación a revisión.',
    usageExample:
      'Un cliente intenta comprar tres televisores idénticos en una tienda a 40 km de su domicilio declarado, por un monto equivalente a dos veces su ingreso. El `basket_duplicate_item_count` y el ratio de ingreso disparan revisión manual pese a un buen score de cliente.',
    systemsExplanation:
      'Tabla append-only en `risk`, hija de `risk_assessment_runs`, con referencia polimórfica a la entidad externa (`external_entity_type`, `external_entity_id`) porque el comercio vive fuera de Atlas. Todos los campos `*_snapshot` son denormalización intencional: congelan datos de un sistema externo que Atlas no controla. `context_payload_hash` permite detectar que el contexto enviado fue alterado entre la cotización y la confirmación.',
  },
  {
    tableName: 'risk_assessment_results',
    whyExists:
      'Es el veredicto: qué acción se recomienda, qué nivel de riesgo, qué puntaje total y qué puntajes por dimensión, con los motivos. Es la respuesta que el negocio consume y que el cliente recibe.',
    whyNotDelete:
      'Es la decisión misma. Borrarla equivale a no tener registro de qué se resolvió sobre cada solicitud, lo que rompe la operación (no se sabe qué se aprobó), la analítica (no hay outcome para backtesting) y el cumplimiento (no hay motivo de rechazo que comunicar).',
    decisionContribution:
      'Su `recommended_action` gobierna el flujo posterior (aprobar, revisar, rechazar, bloquear) y sus subpuntajes (`fraud_score`, `identity_score`, `device_risk_score`, `behavior_score`, `contactability_score`, `consistency_score`) permiten explicar la decisión por dimensión y calibrar cada una por separado.',
    usageExample:
      'Un caso obtiene `score_total = 612`, `recommended_action = MANUAL_REVIEW` y `reason_codes_json` con inconsistencia de domicilio y dispositivo nuevo. El analista ve exactamente qué mirar y resuelve en minutos en lugar de revisar todo el expediente.',
    systemsExplanation:
      'Tabla append-only en `risk`, hija de `risk_assessment_runs`, con snapshots textuales de las versiones (`model_version_code_snapshot`, `ruleset_version_code_snapshot`), puntero al `feature_snapshot_id` e `integrity_hash` propio. Los snapshots de versión son redundantes a propósito: sobreviven aunque las filas de versión se archiven. `decided_at` es el instante legalmente relevante de la decisión.',
  },
  {
    tableName: 'risk_feature_contributions',
    whyExists:
      'Descompone el puntaje: cuánto aportó cada variable, en qué bin cayó, con qué WOE y cuántos puntos sumó o restó. Es la explicación cuantitativa de por qué el score es el que es.',
    whyNotDelete:
      'Es lo que permite dar razones concretas de un rechazo en vez de un número. Sin ella, la explicabilidad exigida a decisiones automatizadas no se puede cumplir, y data science pierde la capacidad de ver qué variables están dominando el modelo en producción.',
    decisionContribution:
      'Genera los motivos de rechazo comunicables al cliente y permite detectar variables con peso desproporcionado o comportamiento inesperado, que es la señal temprana de un modelo que se está desalineando.',
    usageExample:
      'Un rechazo se explica con las tres contribuciones más negativas: dispositivo reusado (-120 puntos), sin verificación de domicilio (-80) y línea telefónica de menos de un mes (-60). El cliente recibe motivos accionables y el analista sabe qué evidencia pedir.',
    systemsExplanation:
      'Tabla append-only en `risk`, hija de `risk_assessment_runs`, con `feature_code`, `raw_value_json`, `bin_or_attribute`, `woe_value`, `score_points` y `reason_code`. Es de alto volumen (decenas de filas por evaluación) y su retención debe alinearse con la del resultado que explica. `raw_value_json` puede contener datos sensibles y debe respetar la clasificación de la feature.',
  },
  {
    tableName: 'risk_rules_fired',
    whyExists:
      'Registra qué reglas de política se dispararon en una evaluación, con qué valores de entrada y qué acción produjeron. Es la parte determinista de la decisión, la que no depende del modelo.',
    whyNotDelete:
      'Es la evidencia de que una regla existía y se aplicó tal como estaba escrita. Sin ella no se puede distinguir un rechazo por política (edad, lista, hard stop) de uno por score, que son cosas muy distintas ante un cliente y ante un regulador.',
    decisionContribution:
      'Un `is_hard_stop = true` cierra la decisión independientemente del score. Contar disparos por regla permite decidir qué reglas están generando falsos positivos y cuáles ya no aportan, y calibrarlas con datos.',
    usageExample:
      'La regla `WATCHLIST_HIT` se dispara con `output_action = BLOCK`. El caso se rechaza sin importar el score, y la revisión posterior determina que era un homónimo: se ajusta el umbral de match y el disparo queda como evidencia del antes y el después.',
    systemsExplanation:
      'Tabla append-only en `risk`, hija de `risk_assessment_runs` y con FK a `risk_policy_rules`, más los snapshots textuales `rule_code_snapshot` y `ruleset_version_code_snapshot` para sobrevivir al archivado de la regla. `input_values_json` guarda los valores evaluados, lo que permite reproducir la evaluación de la expresión sin depender del estado actual de las features.',
  },
  {
    tableName: 'risk_signal_seeds',
    whyExists:
      'Es el catálogo de señales candidatas: ideas de variables con su fuente esperada, dimensión de riesgo, dirección esperada del efecto y justificación. Es el backlog razonado del equipo de riesgo, no una lista informal en un documento.',
    whyNotDelete:
      'Conserva el porqué de cada señal (`rationale`, `expected_direction`) y su prioridad. Sin él, el conocimiento de por qué se propuso o se descartó una variable se pierde con la rotación de personas y el equipo repite discusiones ya cerradas.',
    decisionContribution:
      'Ordena la inversión del equipo de riesgo: qué señal construir primero según prioridad, fase de build y fuente disponible. `expected_direction` permite validar después si la señal se comportó como se esperaba o al revés, lo que es en sí un hallazgo.',
    usageExample:
      'La señal `NIGHT_SESSION_RATIO` está priorizada como alta con dirección esperada positiva hacia fraude. Al implementarla, los datos muestran el efecto contrario; el hallazgo se documenta y la señal se descarta con evidencia en lugar de por intuición.',
    systemsExplanation:
      'Catálogo en `risk` con `signal_code` único, `source_entity`, `target_definition_code` (la definición de observación/atributo/feature que materializaría la señal), `example_value_json` y `build_phase`. No participa del cálculo en runtime: es metadata de planificación, y por eso puede vivir con seeders de producción idempotentes sin afectar decisiones.',
  },
];
