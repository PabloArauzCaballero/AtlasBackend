/**
 * @file Mapper: transforma modelos internos a contratos de transporte.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import { SystemDataEntityCatalogModel } from '../../database/models/index.js';

/**
 * Narrativa de gobierno de una entidad de datos: por qué existe, por qué no se elimina, qué aporta
 * a las decisiones, un ejemplo de uso y la explicación a nivel sistemas.
 *
 * Vive fuera de `systems-ops.mapper.ts` y fuera de `mapDataEntity` a propósito: son cinco textos
 * largos que el modelo excluye por `defaultScope`, y solo el detalle de la entidad los consulta
 * (`findDataEntityById` / `findDataEntityByTable` usan `.unscoped()`). Si se adjuntara al listado,
 * una página de entidades pasaría de decenas de KB a cerca de un megabyte.
 */
export function mapDataEntityNarrative(row: SystemDataEntityCatalogModel) {
  return {
    whyExists: row.businessWhyExists,
    whyNotDelete: row.businessWhyNotDelete,
    decisionContribution: row.businessDecisionContribution,
    usageExample: row.businessUsageExample,
    systemsExplanation: row.systemsExplanation,
    source: row.narrativeSource,
    updatedAt: row.narrativeUpdatedAt,
  };
}
