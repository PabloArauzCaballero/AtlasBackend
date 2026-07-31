/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import type { EntityBusinessNarrative } from './entity-narrative.types.js';

/** Catálogo de flujos de trabajo: el árbol de endpoints de cada proceso (schema `platform_ops`). */
export const WORKFLOW_CATALOG_NARRATIVES: EntityBusinessNarrative[] = [
  {
    tableName: 'workflow_definitions',
    whyExists:
      'Declara qué procesos de negocio existen en la plataforma y en qué versión. El backend ya sabía qué endpoints expone; esta tabla dice cuáles de ellos componen un recorrido con principio, fin y criterio de éxito.',
    whyNotDelete:
      'Es la cabecera de la que cuelga el árbol completo por FK en cascada: sin ella no hay etapas, pasos ni transiciones. Además guarda las versiones retiradas, que son lo que permite explicar un recorrido que un cliente hizo bajo una definición anterior.',
    decisionContribution:
      '`status` e `is_default` deciden qué definición consumen el frontend y el portal: publicar una versión nueva no cambia el comportamiento de nadie hasta que se marca como predeterminada. `success_criteria_json`/`failure_criteria_json` fijan qué cuenta como recorrido terminado bien o mal, que es la base de cualquier métrica de conversión.',
    usageExample:
      'Se publica `v2` del recorrido con una etapa nueva. Queda en `draft` mientras se revisa; las apps siguen recibiendo `v1` porque es la marcada por defecto, y el cambio se activa moviendo una sola bandera.',
    systemsExplanation:
      'Tabla en `platform_ops` con unicidad `(workflow_code, version)` e índice único parcial que impide dos definiciones predeterminadas con el mismo código. No lleva `_tenant_id` a propósito: describe el software desplegado, no la operación de un cliente. La siembra el seeder productivo del árbol estándar, que es idempotente y actualiza por clave natural.',
  },
  {
    tableName: 'workflow_stages',
    whyExists:
      'Descompone el proceso en etapas y subetapas comprensibles para una persona (registro, captura de datos, revisión, habilitación, crédito), cada una con su módulo funcional, su actor y su regla de completitud.',
    whyNotDelete:
      'Es el nivel en el que el negocio habla del proceso. Sin él quedan pasos HTTP sueltos, y desaparece la jerarquía que permite decir "la captura de datos tiene seis subetapas" en lugar de enumerar veinte llamadas.',
    decisionContribution:
      '`completion_rule_json` es lo que traduce el estado real del cliente a "esta etapa está cumplida", reutilizando la evaluación de habilitación en vez de duplicar la regla. `required_states_json` declara desde qué estados del ciclo de vida la etapa es alcanzable.',
    usageExample:
      'La app pinta el avance del onboarding recorriendo las etapas ordenadas y pidiendo el progreso del cliente: seis subetapas de captura, tres completas, la cuarta en curso, sin que la app conozca ninguna regla de negocio.',
    systemsExplanation:
      'Tabla en `platform_ops` con unicidad `(workflow_definition_id, stage_code)` y `parent_stage_id` autorreferente para modelar subflujos sin tablas extra, con `CHECK` que impide que una etapa sea su propio padre. El borrado es lógico (`_deleted`): una etapa retirada de la definición deja de listarse pero sus referencias siguen resolviendo.',
  },
  {
    tableName: 'workflow_steps',
    whyExists:
      'Es la unión entre el proceso de negocio y la API real: cada fila es un endpoint concreto (método y ruta) con su orden, su obligatoriedad, sus roles, sus estados requeridos y resultantes, sus errores posibles y su estrategia de reintento.',
    whyNotDelete:
      'Sin ella, el árbol describe etapas abstractas que no se pueden ejecutar. Es también lo que hace verificable al catálogo: el informe de consistencia compara estas filas con las rutas realmente montadas y detecta que el proceso documentado dejó de existir.',
    decisionContribution:
      'Responde "¿cuál es la siguiente llamada que corresponde hacer?" con método, ruta y roles, y "¿qué puede salir mal y se puede reintentar?" con `possible_errors_json` y `retry_strategy_json`. Un cliente HTTP deja de descubrirlo a base de 403 y 422.',
    usageExample:
      'Alguien renombra una ruta sin actualizar el árbol. El informe de consistencia marca `STEP_ROUTE_NOT_EXPOSED` con el paso afectado, y el error aparece en CI en lugar de en la app de un cliente.',
    systemsExplanation:
      'Tabla en `platform_ops` con unicidad `(workflow_definition_id, step_code)`, `CHECK` de método HTTP legal, de ruta con barra inicial y de orden positivo. `endpoint_code` se deriva con la misma función que usa el catálogo técnico de endpoints, nunca se escribe a mano: así los dos catálogos cruzan por construcción. No es FK física hacia `system_endpoint_catalog` porque ese catálogo se puebla por descubrimiento en runtime y puede estar vacío en una instalación recién migrada.',
  },
  {
    tableName: 'workflow_step_dependencies',
    whyExists:
      'Declara qué pasos exigen otro paso previo y de qué forma: por completitud obligatoria, por dato necesario o como recomendación. Es el grafo de precedencia que el orden de ejecución no alcanza a expresar.',
    whyNotDelete:
      'El orden dice en qué secuencia se recorren los pasos; la dependencia dice cuáles son verdaderamente bloqueantes. Sin ella, validar si una transición es legal degenera en "¿está antes en la lista?", que es falso en cuanto el proceso tiene ramas.',
    decisionContribution:
      'La validación de transición trata `requires_completion` como condición dura y devuelve exactamente qué pasos faltan; `requires_data` y `soft` informan sin bloquear, lo que evita frenar recorridos legítimos por una recomendación.',
    usageExample:
      'El cliente intenta enviar el paquete de onboarding sin haber verificado su contacto. La validación responde `UNSATISFIED_DEPENDENCIES` nombrando el paso pendiente, y la app lo lleva directamente ahí.',
    systemsExplanation:
      'Tabla en `platform_ops` con unicidad del par `(step_id, depends_on_step_id)`, `CHECK` que impide la autodependencia y FKs en cascada hacia pasos y definición. Se sincroniza por borrado y alta —no lógico— porque son aristas sin identidad propia: dejarlas marcadas obligaría a filtrar en cada recorrido del grafo.',
  },
  {
    tableName: 'workflow_transitions',
    whyExists:
      'Modela el paso siguiente y el anterior con su condición: éxito, error, estado del ciclo de vida o expresión condicional. Un extremo nulo significa entrada o salida del flujo.',
    whyNotDelete:
      'Es lo que convierte una lista de endpoints en un proceso navegable. Sin transiciones no hay bifurcaciones —y el proceso real las tiene: enviar el paquete lleva a revisión o de vuelta a corregir según los bloqueadores.',
    decisionContribution:
      'Alimenta la validación de transición y la visualización del proceso: `condition_type` e `is_default_path` distinguen el camino feliz de las ramas de excepción, y `condition_expression_json` nombra los estados y códigos de error concretos que las disparan.',
    usageExample:
      'El portal dibuja el recorrido con el camino por defecto resaltado y, en gris, las ramas de error: verificación de identidad fallida hacia evidencia externa, paquete incompleto hacia observaciones.',
    systemsExplanation:
      'Tabla en `platform_ops` con unicidad `(workflow_definition_id, transition_code)`, `CHECK` de tipos de condición legales y `CHECK` que exige al menos un extremo no nulo (una transición sin origen ni destino no describe nada). Índices por origen y destino para recorrer el grafo en ambas direcciones sin escaneo secuencial.',
  },
];
