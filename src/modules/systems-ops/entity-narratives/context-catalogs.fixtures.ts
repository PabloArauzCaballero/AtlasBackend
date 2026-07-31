/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import type { EntityBusinessNarrative } from './entity-narrative.types.js';

/** Catálogos de contexto (zonas, empleadores, ocupaciones) y su ciclo de ingesta y aprobación (schema `catalog`). */
export const CONTEXT_CATALOG_NARRATIVES: EntityBusinessNarrative[] = [
  {
    tableName: 'context_sources',
    whyExists:
      'Los catálogos de contexto se arman a partir de fuentes muy distintas: censos, listados oficiales, scraping, aportes manuales, sugerencias de IA. Esta tabla declara cada fuente, su confiabilidad y con qué frecuencia se refresca.',
    whyNotDelete:
      'Sin ella, todos los datos de contexto parecen igual de confiables. Se pierde la capacidad de decir "esta zona viene de un padrón oficial y esta otra de una sugerencia automática", que es exactamente lo que determina si un dato puede usarse para una decisión adversa.',
    decisionContribution:
      '`reliability_score` pondera cuánto pesa un ítem derivado de esa fuente, y `refresh_frequency` indica cuándo un catálogo está quedando obsoleto. Ambos alimentan la decisión de aprobar o no una versión de catálogo para producción.',
    usageExample:
      'Una versión del catálogo de zonas mezcla ítems de un padrón municipal (confiabilidad 0.95) y de scraping (0.55). El comité aprueba usar solo los primeros para bandas de riesgo y deja los segundos como referencia descriptiva.',
    systemsExplanation:
      'Catálogo en `catalog` con `source_code` único, `source_type`, `reliability_score` e `is_active`. Es referenciado por `context_items.source_id`. No participa del hot path de decisión: se lee al construir y aprobar catálogos, y su efecto llega al runtime a través de los ítems ya publicados.',
  },
  {
    tableName: 'context_catalogs',
    whyExists:
      'Agrupa el conocimiento contextual por tema: zonas geográficas, empleadores, ocupaciones, instituciones educativas. Es lo que permite convertir texto libre del cliente en categorías comparables y con dueño responsable.',
    whyNotDelete:
      'Es la cabecera bajo la que viven todas las versiones e ítems. Sin ella, el conocimiento de contexto se dispersa en tablas ad hoc por tema y se pierde el `owner_team`, es decir, quién responde por la calidad de cada catálogo.',
    decisionContribution:
      'Define qué dimensiones contextuales existen y quién las gobierna. La decisión de crear un catálogo nuevo (por ejemplo, comercios por rubro) es una decisión de producto sobre qué señales quiere incorporar el negocio.',
    usageExample:
      'Se crea el catálogo `ZONAS_BOL` con dueño `risk-operations`. A partir de ahí, toda dirección declarada se intenta mapear contra la versión vigente de ese catálogo, y las inconsistencias se le reportan a ese equipo.',
    systemsExplanation:
      'Catálogo en `catalog` con `catalog_code` único, dominio, `owner_team` e `is_active`. Es padre de `context_catalog_versions`. La resolución en runtime nunca apunta al catálogo directamente sino a una versión: leer "el catálogo" sin versión es el error que hace que decisiones pasadas cambien de significado.',
  },
  {
    tableName: 'context_catalog_versions',
    whyExists:
      'El conocimiento contextual cambia: aparecen barrios, cambian nombres, se corrigen clasificaciones. Versionar permite publicar mejoras sin alterar el significado de lo ya decidido.',
    whyNotDelete:
      'Es lo que hace inmutable el pasado. Sin versiones, actualizar la banda de riesgo de una zona reescribiría retroactivamente por qué se rechazó a alguien hace un año. También se pierde el registro de quién aprobó publicar cada versión.',
    decisionContribution:
      'La versión vigente define el mapeo que se aplica hoy; las versiones históricas explican las decisiones de ayer. `status` y `valid_from`/`valid_until` permiten preparar una versión, revisarla y publicarla de forma controlada, o revertirla si degrada resultados.',
    usageExample:
      'La v5 del catálogo de zonas reclasifica 30 barrios. Se publica y las nuevas evaluaciones la usan; las evaluaciones de marzo siguen explicándose con la v4, cuyo snapshot quedó guardado en `customer_context_enrichments`.',
    systemsExplanation:
      'Tabla en `catalog` hija de `context_catalogs`, con (`catalog_id`, `version_code`) único, estado, vigencia y doble actor (`created_by_*`, `approved_by_*`) para separar quien propone de quien aprueba. Las vigencias no deben solaparse por catálogo. Los `catalog_versions_json` de `feature_snapshots` registran qué versión se usó en cada decisión.',
  },
  {
    tableName: 'context_items',
    whyExists:
      'Es el contenido real del catálogo: cada zona, empleador u ocupación, con sus atributos. Es lo que convierte "Villa Fátima" en una entidad con código, tipo y propiedades comparables.',
    whyNotDelete:
      'Es la base de todo el enriquecimiento de datos declarados. Sin ítems, el texto del cliente queda como texto y desaparece la posibilidad de analizar por zona, empleador u ocupación, que son dimensiones centrales del riesgo en un mercado sin bureau universal.',
    decisionContribution:
      'Sus `attributes_json` y su `confidence_score` alimentan el enriquecimiento y, por su intermedio, las features de riesgo. Un ítem inactivo deja de usarse sin borrar la historia de quienes ya fueron mapeados a él.',
    usageExample:
      'El ítem `LPZ-VF` (Villa Fátima) tiene atributos de densidad y accesibilidad. Un cliente mapeado a ese ítem hereda esas propiedades como contexto de su evaluación, sin que nadie tenga que codificar barrios a mano en las reglas.',
    systemsExplanation:
      'Tabla en `catalog` hija de `context_catalog_versions`, con `item_code` único dentro de la versión, `attributes_json` flexible y FK a `context_sources`. Los ítems de una versión publicada deben tratarse como inmutables: corregir uno exige una versión nueva, o se pierde la garantía de reproducibilidad.',
  },
  {
    tableName: 'context_item_aliases',
    whyExists:
      'La gente escribe "V. Fátima", "villa fatima", "Vfatima". Los alias son lo que hace que el matching funcione en el mundo real, donde nadie escribe el nombre canónico.',
    whyNotDelete:
      'Sin alias, la tasa de match cae drásticamente y una porción grande de clientes queda sin enriquecimiento, es decir, sin contexto para evaluar. Es una de las tablas que más impacto tiene sobre la cobertura efectiva del modelo.',
    decisionContribution:
      'Cada alias nuevo convierte casos "sin dato" en casos evaluables. `confidence_score` y `alias_type` permiten distinguir un alias oficial de uno inferido y decidir si el match resultante puede sostener una decisión adversa.',
    usageExample:
      'Se agregan 40 alias de escritura frecuente para zonas de La Paz. La tasa de match de direcciones sube del 61% al 88%, y con ello baja la proporción de casos que van a revisión manual por falta de contexto.',
    systemsExplanation:
      'Tabla en `catalog` hija de `context_items`, con `alias_value` y `normalized_alias` (minúsculas, sin acentos ni puntuación) que es el que efectivamente se indexa y consulta. La función de normalización debe ser la MISMA en ingesta y en consulta; cualquier divergencia produce falsos negativos silenciosos.',
  },
  {
    tableName: 'context_risk_mappings',
    whyExists:
      'Traduce un ítem de contexto a lenguaje de riesgo: qué dimensión afecta, en qué banda cae, cuántos puntos sugiere y por qué. Es el puente explícito entre "vive en tal zona" y "esto influye en el riesgo".',
    whyNotDelete:
      'Es el punto donde una decisión puede volverse discriminatoria si nadie la controla. Las banderas `allowed_for_direct_adverse_credit_action` y `requires_calibration` existen precisamente para impedir que un mapeo geográfico rechace crédito por sí solo. Borrar esta tabla elimina ese control y deja el sesgo sin gobierno.',
    decisionContribution:
      'Aporta puntos sugeridos y `reason_code` explicables, con vigencia propia. Permite que el negocio decida explícitamente qué contexto puede influir, cuánto y con qué justificación escrita, en lugar de que quede implícito en el modelo.',
    usageExample:
      'El mapeo de una zona sugiere -30 puntos en la dimensión de fraude, con `allowed_for_direct_adverse_credit_action = false`. El motor lo usa para priorizar revisión, pero no puede rechazar el crédito apoyándose solo en la zona de residencia.',
    systemsExplanation:
      'Tabla en `catalog` hija de `context_items`, con `risk_dimension`, `risk_band`, `score_points_suggested`, `reason_code`, `explanation`, `model_usage` y vigencia (`valid_from`/`valid_until`). El motor debe verificar la bandera de acción adversa ANTES de aplicar los puntos; leer solo `score_points_suggested` es el atajo que convierte un control legal en letra muerta.',
  },
  {
    tableName: 'context_staging_items',
    whyExists:
      'Las propuestas de nuevos ítems (venidas de ingesta automática, scraping o sugerencia de IA) no entran directo al catálogo: pasan por una bandeja de revisión. Esta tabla es esa bandeja.',
    whyNotDelete:
      'Es el control de calidad que separa una propuesta de un dato publicado. Sin ella, cualquier ingesta automática contaminaría el catálogo que alimenta decisiones de riesgo, y no habría registro de qué se propuso y se rechazó.',
    decisionContribution:
      '`ai_suggested` y `review_status` permiten decidir con distinto rigor según el origen, y evitan que contenido generado automáticamente influya en decisiones sin que una persona lo haya validado.',
    usageExample:
      'Una ingesta propone 500 nuevos empleadores, 120 marcados como sugeridos por IA. El revisor aprueba 380, rechaza 90 por duplicados y deja 30 pendientes; solo los aprobados pasan a `context_items` en la siguiente versión.',
    systemsExplanation:
      'Tabla en `catalog` ligada a `context_catalogs` y a `context_ingestion_jobs`, con los campos propuestos como `proposed_*` para no confundirlos con datos publicados. La promoción a `context_items` se hace dentro de una versión nueva y deja evidencia en `context_approval_events`. Es la única puerta de entrada legítima al catálogo desde procesos automáticos.',
  },
  {
    tableName: 'context_approval_events',
    whyExists:
      'Registra quién aprobó o rechazó cada propuesta y cada publicación de versión, y por qué. Es la evidencia del gobierno del catálogo.',
    whyNotDelete:
      'Sin ella, el catálogo que influye en decisiones de crédito cambia sin rastro de autoría. Es la primera cosa que un auditor pide cuando descubre que un dato de contexto afecta la aprobación de crédito de personas.',
    decisionContribution:
      'Permite decidir sobre el proceso de gobierno (quién aprueba demasiado rápido, qué fuentes generan más rechazos) y sostener la reversión fundada de una publicación que degradó resultados.',
    usageExample:
      'Se detecta que una versión del catálogo de zonas empeoró la tasa de aprobación. El historial muestra quién la aprobó, con qué justificación y qué propuestas venían de IA sin revisión detallada; se revierte y se ajusta el procedimiento.',
    systemsExplanation:
      'Tabla append-only en `catalog` ligada a `context_staging_items` y a `context_catalog_versions`, con `event_type`, `decided_by_platform_user_id`, `decided_at` y `decision_reason`. Se escribe en la misma transacción que el cambio de estado que documenta.',
  },
  {
    tableName: 'context_ingestion_jobs',
    whyExists:
      'Las cargas de contexto son procesos con inicio, fin y resultado. Esta tabla los registra: qué fuente, quién lo disparó, cuándo terminó y con qué resumen.',
    whyNotDelete:
      'Es la trazabilidad de cómo llegó el contenido al catálogo. Sin ella, aparecen ítems sin explicación de origen y no se puede diagnosticar una carga parcial o corrupta, ni reprocesarla con criterio.',
    decisionContribution:
      'Su `summary_json` y su estado permiten decidir si una carga se acepta, se repite o se descarta, y medir la calidad de cada fuente a lo largo del tiempo.',
    usageExample:
      'Un job de ingesta termina con 500 propuestas y 4.000 descartes por formato. El resumen revela que el proveedor cambió el separador del archivo; se corrige el parser y se reprocesa solo esa carga.',
    systemsExplanation:
      'Tabla en `catalog` con `job_code` único, tipo y nombre de fuente, actor disparador, estado y tiempos. Es la cabecera de `context_staging_items`. Debe registrar también los fallos: un job que no deja rastro cuando falla es indistinguible de uno que nunca corrió.',
  },
  {
    tableName: 'context_seed_import_checkpoints',
    whyExists:
      'La carga inicial de catálogos de contexto es grande y puede interrumpirse. Los checkpoints permiten reanudarla sin volver a empezar y sin duplicar lo ya cargado.',
    whyNotDelete:
      'Es lo que hace idempotente y reanudable una carga masiva. Sin checkpoints, una interrupción obliga a recargar todo con riesgo de duplicados, o a decidir a mano qué falta, que es precisamente el tipo de operación manual que produce errores en producción.',
    decisionContribution:
      'Permite decidir con certeza si un ambiente tiene el contexto completo: comparar `content_sha256` e `item_count` responde "¿este ambiente tiene exactamente el mismo catálogo base que producción?" sin inspeccionar millones de filas.',
    usageExample:
      'La carga se corta a mitad de camino. Al reintentar, el proceso salta los archivos con checkpoint completado y con hash coincidente, y retoma exactamente donde quedó, sin insertar duplicados.',
    systemsExplanation:
      'Tabla de control en `catalog` con clave por (`package_build_version`, `catalog_code`, `relative_path`), `content_sha256`, `item_count` y `completed_at`. El hash del contenido es lo que detecta que un archivo cambió respecto a la última carga: sin él, el checkpoint saltaría archivos modificados. La usa `multidomain-context-loader.ts`.',
  },
  {
    tableName: 'catalog_entries',
    whyExists:
      'Es el catálogo genérico de valores del negocio: bandas de ingreso, zonas de riesgo, categorías de producto, listas de opciones. Evita que esos valores queden hardcodeados en el código o duplicados en cada pantalla.',
    whyNotDelete:
      'Es la fuente única de los valores controlados que aparecen en formularios, reglas y reportes. Sin ella, cada módulo define su propia lista, aparecen inconsistencias y cambiar una banda de ingreso exige un despliegue en vez de una operación de configuración.',
    decisionContribution:
      'Sus `entry_attributes` alimentan reglas de negocio parametrizables, y `is_immutable_after_use` protege la coherencia histórica: un valor ya usado en decisiones no puede reescribirse silenciosamente.',
    usageExample:
      'La banda de ingreso `INC-B3` (4.001 a 7.000 Bs) se usa en la segmentación de límites. Cuando el negocio decide mover el techo a 8.000, no se edita la entrada usada: se publica una versión nueva y las decisiones viejas siguen refiriéndose a la banda original.',
    systemsExplanation:
      'Tabla en `catalog` con clave (`catalog_code`, `catalog_version`, `entry_code`), `entry_attributes` en JSON, `usage_count` y `superseded_by_version_id` para encadenar versiones. `is_immutable_after_use` debe hacerse cumplir en el servicio: la base no puede saber sola si un valor ya influyó en una decisión. Se seedea de forma idempotente en el perfil de producción.',
  },
];
