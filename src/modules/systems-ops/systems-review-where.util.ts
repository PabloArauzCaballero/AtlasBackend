/**
 * @file Utilidad de repositorio: traduce los filtros de la cola de revisión del catálogo a cláusulas WHERE por familia.
 * @business Esta pieza hace que buscar en la cola de revisión encuentre lo que se ve en cada tabla, no sólo en dos de las seis.
 * @system construye el `where` de cada una de las seis familias (rutas, tablas, columnas, impactos y herramientas) sin tocar la base.
 */
import { literal, Op, WhereOptions } from 'sequelize';
import { atlasSchemaFor } from '../../database/domain-schemas.js';
import { SystemsReviewQueueDto } from './systems-ops.schemas.js';
import { containsPattern } from '../../common/utils/strings/like-pattern.util.js';

/** Las seis familias de la cola, con el mismo nombre que acepta `type`. */
export type ReviewFamily =
  | 'endpoints'
  | 'data_entities'
  | 'data_impacts'
  | 'field_impacts'
  | 'data_column_impacts'
  | 'tool_requirements';

/** Escapa un literal SQL (`sequelize.escape`); se inyecta para que esta utilidad siga siendo pura. */
export type SqlEscape = (value: string) => string;

const ENDPOINTS = `${atlasSchemaFor('system_endpoint_catalog')}.system_endpoint_catalog`;
const ENTITIES = `${atlasSchemaFor('system_data_entity_catalog')}.system_data_entity_catalog`;
const TOOLS = `${atlasSchemaFor('system_tool_catalog')}.system_tool_catalog`;

/**
 * Los impactos y los requisitos de herramienta sólo guardan IDs (`endpoint_id`, `data_entity_id`,
 * `tool_id`), y la pantalla los enseña por esos IDs. Buscar «loans» tiene que encontrar el impacto
 * de una ruta de `loans` aunque la fila no lo diga: por eso se busca en la tabla a la que apunta.
 */
const endpointIdsWhere = (condition: string) => ({ [Op.in]: literal(`(SELECT _id FROM ${ENDPOINTS} WHERE ${condition})`) });
const entityIdsWhere = (condition: string) => ({ [Op.in]: literal(`(SELECT _id FROM ${ENTITIES} WHERE ${condition})`) });
const toolIdsWhere = (condition: string) => ({ [Op.in]: literal(`(SELECT _id FROM ${TOOLS} WHERE ${condition})`) });

function anyColumnLike(columns: readonly string[], pattern: string): string {
  return `(${columns.map((column) => `${column} ILIKE ${pattern}`).join(' OR ')})`;
}

const ENDPOINT_TEXT = ['code', 'full_path', 'route_name', 'module', 'handler_name'];
const ENTITY_TEXT = ['table_name', 'entity_name', 'schema_name', 'module'];
const TOOL_TEXT = ['code', 'name', 'provider'];

function textConditions(family: ReviewFamily, q: string, escape: SqlEscape): WhereOptions {
  const pattern = containsPattern(q);
  const sqlPattern = escape(pattern);
  const like = { [Op.iLike]: pattern };
  const byEndpoint = { endpointId: endpointIdsWhere(anyColumnLike(ENDPOINT_TEXT, sqlPattern)) };
  const byEntity = { dataEntityId: entityIdsWhere(anyColumnLike(ENTITY_TEXT, sqlPattern)) };
  switch (family) {
    case 'endpoints':
      return { [Op.or]: [{ code: like }, { fullPath: like }, { routeName: like }, { module: like }, { handlerName: like }] };
    case 'data_entities':
      return { [Op.or]: [{ tableName: like }, { entityName: like }, { schemaName: like }, { module: like }] };
    case 'data_column_impacts':
      return { [Op.or]: [{ schemaName: like }, { tableName: like }, { columnName: like }, { businessName: like }] };
    case 'data_impacts':
      return { [Op.or]: [byEndpoint, byEntity, { operationType: like }] };
    case 'field_impacts':
      return { [Op.or]: [byEndpoint, byEntity, { fieldName: like }] };
    case 'tool_requirements':
      return { [Op.or]: [byEndpoint, { toolId: toolIdsWhere(anyColumnLike(TOOL_TEXT, sqlPattern)) }, { usageType: like }] };
  }
}

/**
 * El módulo se aplicaba sólo a rutas y tablas: en las otras cuatro familias se ignoraba y la cola
 * enseñaba filas de cualquier módulo. Ahora cada familia filtra por el módulo de la ruta o de la
 * tabla a la que pertenece.
 */
function moduleCondition(family: ReviewFamily, module: string, escape: SqlEscape): WhereOptions {
  switch (family) {
    case 'endpoints':
    case 'data_entities':
      return { module };
    case 'data_column_impacts':
      return { dataEntityId: entityIdsWhere(`module = ${escape(module)}`) };
    case 'data_impacts':
    case 'field_impacts':
    case 'tool_requirements':
      return { endpointId: endpointIdsWhere(`module = ${escape(module)}`) };
  }
}

export function buildReviewFamilyWhere(family: ReviewFamily, query: SystemsReviewQueueDto, escape: SqlEscape): WhereOptions {
  const conditions: WhereOptions[] = [{ reviewStatus: query.reviewStatus }];
  if (query.module) conditions.push(moduleCondition(family, query.module, escape));
  if (query.q) conditions.push(textConditions(family, query.q, escape));
  return { [Op.and]: conditions };
}
