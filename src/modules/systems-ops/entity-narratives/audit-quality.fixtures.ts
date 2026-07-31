/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import type { EntityBusinessNarrative } from './entity-narrative.types.js';

/** Auditoría operativa, cambios de datos, calidad y gobierno del esquema (schemas `audit` y `platform_ops`). */
export const AUDIT_QUALITY_NARRATIVES: EntityBusinessNarrative[] = [
  {
    tableName: 'operational_audit_logs',
    whyExists:
      'Responde la pregunta que se hace después de cada incidente: quién hizo qué, cuándo y desde dónde. Es la bitácora de los actos de los operadores internos sobre datos y casos de clientes reales.',
    whyNotDelete:
      'Es la evidencia central de control interno. Sin ella no se puede investigar un fraude interno, ni demostrar que el acceso a datos personales estuvo controlado, ni sostener ninguna certificación de seguridad. Es también la tabla que un auditor pide primero y la que ningún proceso de negocio debe poder borrar.',
    decisionContribution:
      'Sostiene decisiones disciplinarias y de control: revocar accesos, ajustar permisos, exigir justificación en acciones sensibles. Los patrones de acceso anómalo (consultas masivas de PII, actividad fuera de horario) disparan investigaciones antes de que haya daño.',
    usageExample:
      'Se detecta que un usuario de soporte consultó 400 perfiles de clientes en una hora, muy por encima de su promedio. La auditoría muestra la acción, la IP y los objetivos; se suspende el acceso y se abre investigación el mismo día.',
    systemsExplanation:
      'Tabla append-only en `audit` con `_tenant_id`, actor (interno o de plataforma), `action_code`, objetivo polimórfico (`target_type`, `target_id`), IP, user agent, `payload_json` y `occurred_at`. El payload pasa por `redactSensitiveObject`: la bitácora de auditoría no puede convertirse en el mayor depósito de PII del sistema. Solo INSERT: el rol de runtime no debe tener UPDATE ni DELETE sobre ella.',
  },
  {
    tableName: 'data_change_logs',
    whyExists:
      'Registra que un dato concreto cambió: en qué tabla, en qué registro, de qué tipo de cambio, por quién y por qué. Complementa la auditoría de acciones con la auditoría de datos.',
    whyNotDelete:
      'Es la única forma de detectar y probar una modificación indebida de datos de negocio. Sin ella, alguien puede cambiar un monto, un estado o un dato de identidad y no queda rastro fuera de los logs del motor, que no son evidencia de negocio.',
    decisionContribution:
      'Permite decidir sobre reversión de cambios, sanciones y ajustes de permisos, y sostiene la reconstrucción de un registro corrompido. `change_reason` obliga a que los cambios manuales tengan una justificación escrita y revisable.',
    usageExample:
      'Un cliente aparece con estado modificado sin caso asociado. El log muestra el cambio hecho por un usuario interno, con hash del valor anterior y posterior y sin razón informada. Se revierte y se revisa el permiso que lo permitió.',
    systemsExplanation:
      'Tabla append-only en `audit` que guarda `old_values_hash` y `new_values_hash`, no los valores: prueba que hubo cambio y permite verificar un valor propuesto sin duplicar datos personales en la bitácora. La referencia al registro es polimórfica (`table_name`, `record_id`), así que no hay FK y el consumidor debe resolverla. Solo INSERT.',
  },
  {
    tableName: 'audit_event_feed',
    whyExists:
      'La auditoría vive en varias tablas (acciones de operadores, cambios de datos, acciones técnicas). Para investigar, el negocio necesita una línea de tiempo única en lugar de tres consultas y una hoja de cálculo.',
    whyNotDelete:
      'Es la puerta de entrada práctica a la auditoría. Sin ella cada investigación exige reconstruir a mano la unión de fuentes, con el riesgo de que cada analista lo haga distinto y llegue a conclusiones distintas sobre el mismo hecho.',
    decisionContribution:
      'Acelera decisiones bajo presión: durante un incidente, ver la secuencia completa de eventos en orden cronológico es lo que permite decidir si se corta el acceso, se revierte un cambio o se escala a legal.',
    usageExample:
      'Ante una sospecha de acceso indebido, el analista filtra el feed por actor y ventana de tiempo y ve, en una sola lista, los logins, las consultas de PII y los cambios de estado que ese usuario ejecutó esa tarde.',
    systemsExplanation:
      'Es una VISTA en el schema `audit`, no una tabla: no almacena datos propios, unifica las fuentes de auditoría. Por eso no tiene retención propia (hereda la de sus fuentes) y su rendimiento depende de los índices de las tablas base, típicamente por `occurred_at` y actor. Al estar catalogada como entidad, aparece en el gobierno de datos igual que una tabla, lo cual es deliberado: quien la consulta ve datos sensibles y ese acceso debe gobernarse.',
  },
  {
    tableName: 'data_quality_rules',
    whyExists:
      'Declara qué significa que un dato esté bien: qué tabla, qué campo, qué expresión debe cumplirse, con qué severidad y qué hacer si falla. Convierte la calidad de datos en algo medible en lugar de una queja recurrente.',
    whyNotDelete:
      'Sin reglas explícitas, la calidad se descubre cuando un reporte da un número absurdo o cuando el modelo se degrada. Es también la referencia de `data_quality_issues`: sin la regla, un incidente de calidad no tiene definición ni umbral.',
    decisionContribution:
      'Permite decidir si un dato es apto para decisión, bloquear un release cuando la calidad cae, y priorizar remediación por severidad. Un modelo alimentado con datos que violan reglas críticas no debería promoverse.',
    usageExample:
      'La regla `PHONE_FORMAT_VALID` sobre `customer_contact_methods` tiene severidad alta. Una carga masiva introduce 2.000 teléfonos mal formateados; se abren incidentes automáticamente y la campaña de SMS se detiene hasta corregirlos.',
    systemsExplanation:
      'Catálogo en `platform_ops` con `rule_code` único, `target_table`/`target_field`, `expression_json`, `severity` y `expected_action`. Las evalúa un job programado que abre filas en `data_quality_issues`. La expresión debe ser declarativa y parametrizada: interpolar valores en SQL crudo desde esta tabla sería una vía directa de inyección.',
  },
  {
    tableName: 'data_quality_issues',
    whyExists:
      'Es el registro de cada incumplimiento concreto de una regla de calidad: qué tabla, qué registro, cuándo se detectó y cómo se resolvió. Es la lista de trabajo de la remediación.',
    whyNotDelete:
      'Sin ella, la detección de calidad no produce acción: se sabe que hay problemas pero no cuáles ni si se arreglaron. También se pierde la métrica de deuda de datos a lo largo del tiempo, que es lo que justifica invertir en corregir el origen en vez de parchear reportes.',
    decisionContribution:
      'La cantidad de incidentes abiertos por severidad es un semáforo para decisiones de release y de uso de datos. `resolution_notes` acumula el conocimiento de por qué ocurren, que es lo que permite arreglar la causa y no el síntoma.',
    usageExample:
      'Se abren 2.000 incidentes de formato de teléfono en un día. La investigación revela que un import omitió el prefijo del país; se corrige el importador, se normalizan los registros y los incidentes se cierran con la misma nota de resolución.',
    systemsExplanation:
      'Tabla en `platform_ops` con `_tenant_id`, FK a `data_quality_rules` y referencia polimórfica al registro afectado (`target_table`, `target_record_id`). Es de alto volumen cuando una regla falla masivamente: conviene agrupar por regla y ejecución en lugar de abrir un incidente por fila sin control, o la remediación se vuelve inmanejable.',
  },
  {
    tableName: 'schema_constraint_notes',
    whyExists:
      'Documenta por qué existe cada restricción del modelo: qué regla de negocio protege una FK, un UNIQUE o un CHECK. Sin esa nota, las restricciones parecen trabas técnicas y alguien termina quitándolas para que "pase el insert".',
    whyNotDelete:
      'Es la memoria del porqué de las reglas duras del modelo. Cuando una restricción bloquea una carga, esta tabla es lo que evita que se elimine sin entender qué invariante de negocio estaba protegiendo, que es la forma más común de corromper datos en producción.',
    decisionContribution:
      'Permite decidir con criterio si una restricción se mantiene, se relaja o se refuerza, y qué restricciones son imprescindibles para el MVP (`is_required_for_mvp`) frente a las que pueden esperar.',
    usageExample:
      'Una migración de datos falla por un UNIQUE en contactos. La nota explica que protege contra dos clientes con el mismo teléfono verificado, una regla antifraude. En lugar de quitar el índice, se depura la carga.',
    systemsExplanation:
      'Catálogo en `platform_ops` con `table_name`, `constraint_type`, `constraint_expression`, `rationale` y `build_phase`. Es documentación, no ejecución: la restricción vive en el DDL. Su valor está en poder cruzar lo declarado aquí con lo que realmente existe en la base y detectar restricciones sin justificación o justificaciones sin restricción.',
  },
  {
    tableName: 'schema_versions',
    whyExists:
      'Permite hablar del modelo de datos como un objeto versionado: "la versión 7 del esquema" en lugar de "lo que había en la base ese día". Es la base del gobierno del modelo por parte del negocio, no solo de ingeniería.',
    whyNotDelete:
      'Es la cabecera de todo el catálogo de esquema gobernado (tablas, columnas, relaciones, cambios). Sin ella, ese catálogo pierde su eje temporal y no se puede comparar cómo era el modelo antes y después de un cambio.',
    decisionContribution:
      'Habilita aprobar o revertir cambios de modelo como una unidad, y comparar versiones para evaluar impacto antes de ejecutar. `parent_version_id` permite ramificar propuestas sin tocar la versión activa.',
    usageExample:
      'Se propone la versión 8 con tres tablas nuevas para un producto. El comité la revisa como conjunto, la aprueba y a partir de ahí los cambios se registran contra esa versión, con posibilidad de comparar contra la 7.',
    systemsExplanation:
      'Tabla en `platform_ops` con `version_code` único, `is_active`, `parent_version_id` y autor. Es un modelo declarativo del esquema, paralelo a las migraciones reales de Umzug: no ejecuta DDL. La divergencia entre lo declarado aquí y lo que existe en `information_schema` es en sí un hallazgo de gobierno que vale la pena monitorear.',
  },
  {
    tableName: 'schema_tables',
    whyExists:
      'Declara las tablas del modelo gobernado con propiedades que el negocio entiende: si es append-only, si está alcanzada por tenant, qué describe. Es el inventario revisable del modelo.',
    whyNotDelete:
      'Sin él, el inventario de tablas solo existe en el catálogo de PostgreSQL, sin semántica de negocio ni control de versión. Se pierde la capacidad de discutir el modelo con áreas no técnicas y de detectar tablas que nadie declaró pero existen.',
    decisionContribution:
      '`is_append_only` e `is_tenant_scoped` son decisiones de arquitectura con consecuencias legales y de aislamiento: declararlas explícitamente permite auditarlas y detectar tablas que deberían ser inmutables y no lo son.',
    usageExample:
      'Al revisar el modelo se detecta que una tabla de eventos está declarada `is_append_only = true` pero un servicio ejecuta UPDATE sobre ella. La contradicción se corrige antes de que un auditor la encuentre.',
    systemsExplanation:
      'Tabla en `platform_ops` hija de `schema_versions`, con `table_name` único por versión, `table_type`, banderas de gobierno y borrado lógico (`is_deleted`). Es padre de `schema_columns` y participa en `schema_relationships`. Convive con `system_data_entity_catalog`: aquella describe lo que EXISTE (detectado del `information_schema`), esta describe lo que se DECLARÓ y aprobó.',
  },
  {
    tableName: 'schema_columns',
    whyExists:
      'Lleva el gobierno al nivel de columna: tipo, si acepta nulos, si es inmutable, si es PII, si está indexada y qué significa. Es donde se decide, antes de crear el campo, cómo debe tratarse.',
    whyNotDelete:
      'Es el inventario declarado de campos sensibles y de invariantes por columna. Sin él, marcar un campo como PII o inmutable queda como acuerdo verbal y se pierde en el siguiente cambio de equipo.',
    decisionContribution:
      '`is_pii` e `is_immutable` deciden protección y política de escritura; `is_indexed` participa de decisiones de rendimiento. Juntos permiten revisar un cambio de modelo en términos de riesgo antes de aplicarlo.',
    usageExample:
      'Se propone agregar una columna con número de documento en claro. La revisión ve `is_pii = true` sin cifrado declarado, la rechaza y exige el patrón hash + blob cifrado antes de aprobar el cambio.',
    systemsExplanation:
      'Tabla en `platform_ops` hija de `schema_tables`, con `column_name` único por tabla, tipo, banderas y borrado lógico. Es el equivalente declarativo de `system_data_field_catalog`, que en cambio se genera automáticamente desde `information_schema`. Comparar ambas detecta columnas reales sin declaración y declaraciones sin columna real.',
  },
  {
    tableName: 'schema_relationships',
    whyExists:
      'Declara cómo se relacionan las entidades del modelo y con qué política de borrado, en términos que el negocio puede revisar: qué pasa con las evidencias si se elimina un cliente, por ejemplo.',
    whyNotDelete:
      'Sin este mapa, entender el modelo exige leer DDL y las decisiones de cascada quedan invisibles hasta que un borrado elimina más de lo que debía. Es también el insumo para analizar impacto antes de un cambio.',
    decisionContribution:
      '`cascade_delete` e `is_immutable` son decisiones con consecuencias severas: un CASCADE mal puesto puede borrar evidencia legal. Declararlas y revisarlas explícitamente es el control que evita ese error.',
    usageExample:
      'Se revisa una propuesta que pone borrado en cascada de `customers` hacia `evidence_documents`. La revisión lo rechaza: la evidencia debe sobrevivir a la baja lógica del cliente y su eliminación se rige por la política de retención, no por una FK.',
    systemsExplanation:
      'Tabla en `platform_ops` hija de `schema_versions`, que enlaza dos `schema_tables` con sus columnas. Es documentación de diseño; las FKs reales las crean las migraciones siguiendo la política central de `atlas-schema-builder.util.ts` (SET NULL si nullable, RESTRICT si no). Su valor es permitir revisar la intención antes de que se convierta en DDL.',
  },
  {
    tableName: 'schema_change_log',
    whyExists:
      'Registra cada cambio propuesto al modelo: quién lo pidió, quién lo aprobó, qué resultado tuvo y si se revirtió. Convierte los cambios de esquema en un proceso con control de cambios y no en un acto individual.',
    whyNotDelete:
      'Es la evidencia del control de cambios sobre la estructura que sostiene datos financieros y personales. Sin ella no se puede demostrar que los cambios de modelo pasan por aprobación, que es un control estándar en cualquier auditoría de sistemas.',
    decisionContribution:
      'Permite aprobar, rechazar y revertir con trazabilidad, y medir el proceso: cuántos cambios se revierten, cuánto tardan las aprobaciones, qué áreas generan más riesgo estructural.',
    usageExample:
      'Un cambio que agrega una columna NOT NULL sin default se aprueba y falla en producción. El registro guarda `change_result`, `error_message`, `rolled_back = true` y quién revirtió, y ese caso se usa para exigir el patrón expand/contract en adelante.',
    systemsExplanation:
      'Tabla append-only en `platform_ops` ligada a `schema_versions`, con entidad afectada polimórfica, payload del cambio, estado de aprobación, resultado y datos de reversión. Es el registro del proceso declarativo; la ejecución real sigue siendo de las migraciones de Umzug, que llevan su propio tracking en `SequelizeMeta`. Ambos registros deben contar la misma historia.',
  },
];
