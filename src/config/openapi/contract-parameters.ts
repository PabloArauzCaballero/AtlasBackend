/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza permite que un integrador entienda el contrato sin leer el código fuente.
 * @system declara las descripciones reutilizables de los parámetros transversales del contrato.
 */

/**
 * Descripciones de los parámetros que se repiten por toda la API.
 *
 * Medido sobre el contrato generado: **472 de 505 parámetros no traían descripción**, y la
 * distribución estaba muy concentrada — `x-tenant-id` aparecía 122 veces, `x-idempotency-key` 53 y
 * `customerId` 51. Anotarlos endpoint por endpoint con `@ApiParam`/`@ApiQuery` habría significado
 * escribir la misma frase decenas de veces y garantizar que la siguiente copia se desviara.
 *
 * La clave es `in:name` porque el mismo nombre significa cosas distintas según dónde viaje:
 * `providerCode` en `path` identifica al proveedor del recurso; en `query` filtra un listado.
 *
 * Este mapa NO inventa semántica: cada entrada describe lo que el handler correspondiente hace de
 * verdad. Un parámetro que no está aquí se queda sin descripción a propósito — es preferible que el
 * linter lo siga reportando a rellenarlo con una frase genérica que no aporta nada y que además
 * apagaría la señal para los que sí importan.
 */
export const PARAMETER_DESCRIPTIONS: Readonly<Record<string, string>> = {
  // --- Paginación y búsqueda, comunes a los listados ---
  'query:page': 'Página solicitada, empezando en 1.',
  'query:limit': 'Tamaño de página. El backend impone un máximo por endpoint; pedir más lo recorta en vez de fallar.',
  'query:cursor':
    'Cursor opaco devuelto por la página anterior. Los listados con cursor no aceptan `page`: son excluyentes, ' +
    'porque paginar por desplazamiento sobre datos que cambian salta o repite filas.',
  'query:q': 'Texto de búsqueda libre. Se compara de forma insensible a mayúsculas sobre los campos indexados del recurso.',
  'query:from': 'Inicio del rango temporal (ISO-8601, UTC). Inclusivo.',
  'query:to': 'Fin del rango temporal (ISO-8601, UTC). Exclusivo.',
  'query:days': 'Ventana en días hacia atrás desde ahora. Alternativa a `from`/`to` para consultas rápidas.',
  'query:status': 'Filtra por estado del recurso. Los valores admitidos son los del dominio de ese recurso.',
  'query:type': 'Filtra por tipo del recurso dentro de su catálogo.',
  'query:module': 'Filtra por módulo funcional del backend (`auth`, `credit`, `customer_onboarding`, …).',
  'query:channel': 'Canal de comunicación (`email`, `sms`, `push`, `whatsapp`).',
  'query:providerCode': 'Filtra por proveedor externo.',
  'query:language': 'Idioma del contenido solicitado, en código ISO-639-1 (`es`, `en`).',
  'query:role': 'Filtra por rol autorizado del sistema de autorización.',
  'query:version': 'Versión concreta del recurso versionado, o `latest` para la vigente.',

  // --- Identificadores de ruta del dominio ---
  'path:customerId': 'Identificador del cliente. Un actor con rol `customer` sólo puede operar sobre el suyo.',
  'path:sessionId': 'Identificador de la sesión del cliente.',
  'path:internalUserId': 'Identificador del usuario interno (operador, analista o administrador).',
  'path:consentId': 'Identificador del consentimiento otorgado.',
  'path:requestId': 'Identificador de la petición a un proveedor externo.',
  'path:providerCode': 'Código del proveedor externo (`segip`, `infocenter`, …).',
  'path:eventId': 'Identificador del evento de dominio en el outbox.',
  'path:messageId': 'Identificador del mensaje de notificación.',
  'path:templateId': 'Identificador de la plantilla de notificación.',
  'path:caseId': 'Identificador del caso de revisión manual o de fraude.',
  'path:issueId': 'Identificador del hallazgo de calidad de datos.',
  'path:applicationId': 'Identificador de la solicitud de crédito.',
  'path:productId': 'Identificador del producto crediticio.',
  'path:catalogCode': 'Código del catálogo de contexto.',
  'path:versionId': 'Identificador de la versión del catálogo.',
  'path:rulesetVersionId': 'Identificador de la versión del conjunto de reglas de riesgo.',
  'path:riskAssessmentRunId': 'Identificador de la corrida de evaluación de riesgo.',
  'path:workflowCode': 'Código del flujo de trabajo en `snake_case` (`customer_credit_journey`).',
  'path:suiteId': 'Identificador de la suite de pruebas del portal de sistemas.',
  'path:stepId': 'Identificador del paso dentro de la suite de pruebas.',
  'path:runId': 'Identificador de la ejecución de pruebas.',
  'path:profileId': 'Identificador del perfil de estrés.',
  'path:endpointId': 'Identificador del endpoint en el catálogo técnico.',
  'path:entityId': 'Identificador de la entidad de datos en el catálogo técnico.',
  'path:toolId': 'Identificador de la herramienta o dependencia externa catalogada.',
  'path:domainCode': 'Código del dominio de negocio del catálogo técnico.',
  'path:tableId': 'Identificador de la tabla en el catálogo de esquema.',
  'path:changeId': 'Identificador de la propuesta de cambio de esquema.',
  'path:reportId': 'Identificador del reporte del portal interno.',
  'path:nodeId': 'Identificador del nodo de linaje de datos.',
  'path:alertId': 'Identificador de la alerta operativa.',
  'path:jobRunId': 'Identificador de la ejecución de un job.',
  'path:ruleId': 'Identificador de la regla de calidad de datos.',
  'path:policyId': 'Identificador de la política de gobierno de datos.',
  'path:termId': 'Identificador del término del glosario de negocio.',
  'path:exportId': 'Identificador de la exportación solicitada.',
  'path:notificationId': 'Identificador de la notificación del cliente.',
  'path:deviceTokenId': 'Identificador del token de dispositivo registrado.',
  'path:referenceId': 'Identificador de la referencia personal del cliente.',
  'path:requirementId': 'Identificador del requerimiento de herramienta del catálogo técnico.',
  'path:impactId': 'Identificador del impacto de datos catalogado.',
  'path:fieldImpactId': 'Identificador del impacto a nivel de campo.',
  'path:columnId': 'Identificador de la columna en el catálogo de datos.',
  'path:schemaName': 'Nombre del schema PostgreSQL (`customer`, `credit`, `platform_ops`, …).',
  'path:tableName': 'Nombre físico de la tabla dentro del schema.',
};

/**
 * Descripción de un parámetro de ruta no catalogado.
 *
 * Para un parámetro `path` el genérico SÍ es cierto: la plantilla de la ruta lo declara como el
 * identificador del recurso que la operación direcciona. No es relleno, es la única afirmación que
 * se puede hacer sin conocer el dominio del recurso.
 */
export function fallbackPathParameterDescription(name: string): string {
  return `Identificador de ruta \`${name}\` del recurso direccionado por la operación.`;
}

export function parameterDescriptionFor(location: string | undefined, name: string | undefined): string | undefined {
  if (!name) return undefined;
  const curated = PARAMETER_DESCRIPTIONS[`${location}:${name}`];
  if (curated) return curated;
  return location === 'path' ? fallbackPathParameterDescription(name) : undefined;
}
