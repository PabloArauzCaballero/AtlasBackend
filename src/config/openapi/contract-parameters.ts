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

  // --- Filtros de los listados de gobierno y operación ---
  'query:offset': 'Desplazamiento en número de elementos. Alternativa a `page` en los listados que la exponen.',
  'query:pagination': 'Estrategia de paginación pedida (`page` u `offset`) cuando el listado admite ambas.',
  'query:correlationId': 'Filtra por el identificador de correlación con el que se registró la operación.',
  'query:customerId': 'Filtra por cliente. No sustituye a la comprobación de pertenencia: un `customer` sigue viendo solo lo suyo.',
  'query:reviewStatus': 'Estado de revisión humana de la ficha del catálogo técnico (`AUTO_DETECTED`, `APPROVED`, …).',
  'query:riskLevel': 'Nivel de riesgo clasificado del endpoint (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`).',
  'query:severity': 'Severidad del hallazgo.',
  'query:priority': 'Prioridad asignada al caso o a la alerta.',
  'query:queue': 'Cola de trabajo de operaciones sobre la que se consulta.',
  'query:active': 'Restringe a los registros vigentes cuando es `true`.',
  'query:enabled': 'Restringe a los registros habilitados cuando es `true`.',
  'query:strict': 'Aplica la variante estricta de la comprobación: los avisos pasan a considerarse fallos.',
  'query:domain': 'Filtra por dominio de negocio del catálogo técnico.',
  'query:moduleCode': 'Filtra por módulo funcional del backend.',
  'query:backendService': 'Filtra por servicio backend que expone el endpoint catalogado.',
  'query:environment': 'Entorno de ejecución sobre el que aplica la consulta (`LOCAL`, `STAGING`, `PRODUCTION_READONLY`).',
  'query:suiteId': 'Filtra por suite de pruebas.',
  'query:suiteType': 'Filtra por tipo de suite de pruebas.',
  'query:endpointId': 'Filtra por endpoint del catálogo técnico.',
  'query:entityType': 'Filtra por tipo de entidad del catálogo de datos.',
  'query:actorType': 'Filtra por tipo de actor que originó el registro (`customer`, `internal_user`, `system`).',
  'query:eventType': 'Filtra por tipo de evento de dominio.',
  'query:eventCode': 'Filtra por código del evento en el catálogo de definiciones.',
  'query:aggregateType': 'Filtra por tipo de agregado al que pertenece el evento.',
  'query:code': 'Filtra por el código natural del recurso.',
  'query:purposeCode': 'Filtra por finalidad de tratamiento de datos personales.',
  'query:containsPii': 'Restringe a los registros marcados como portadores de datos personales.',
  'query:windowHours': 'Ventana de agregación en horas hacia atrás desde ahora.',
  'query:featureMaxAgeHours': 'Antigüedad máxima aceptada de las variables derivadas, en horas. Por encima se recalculan.',
  'query:includeRawResponses':
    'Incluye la respuesta cruda del proveedor externo. Puede contener datos personales: se limita a roles de auditoría.',

  // --- Filtros de un solo endpoint, catalogados para cerrar el gate de descripciones ---
  'query:statusCode': 'Filtra por el código de estado HTTP con el que respondió la petición registrada.',
  'query:method': 'Filtra por método HTTP (`GET`, `POST`, …).',
  'query:requestId': 'Filtra por el identificador de la petición registrada en el log de acciones.',
  'query:includeInactive': 'Incluye también los registros dados de baja. Por omisión sólo se devuelven los vigentes.',
  'query:includeDeprecated': 'Incluye también las versiones retiradas del catálogo. Por omisión se omiten.',
  'query:tableType': 'Filtra por tipo de objeto de esquema (`BASE TABLE`, `VIEW`).',
  'query:versionId': 'Filtra por versión concreta del recurso versionado.',
  'query:requesterUserId': 'Filtra por el usuario interno que solicitó el cambio.',
  'query:changeType': 'Filtra por tipo de cambio de esquema propuesto (`create_table`, `add_column`, …).',
  'query:approvalStatus': 'Filtra por estado de aprobación de la propuesta (`pending`, `approved`, `rejected`).',
  'query:service': 'Filtra por servicio backend que originó el registro.',
  'query:ownerDomain': 'Filtra por dominio de negocio propietario del recurso.',
  'query:processType': 'Filtra por familia del proceso (`customer_journey`, `back_office`, `system_job`, `integration`).',
  'query:lifecycleStatus': 'Filtra por estado del ciclo de vida del cliente (`registered`, `under_review`, `active`, …).',

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
