import { Injectable } from '@nestjs/common';
import { mapWithConcurrency } from '../../common/utils/concurrency.util.js';
import { SystemsDataImpactInferenceRepository } from './systems-data-impact-inference.repository.js';
import { readSourcesForEndpoint } from './systems-source-scan.util.js';
import { SystemDataEntityCatalogModel, SystemEndpointCatalogModel } from '../../database/models/index.js';

const WRITE_METHODS = ['create', 'update', 'destroy', 'upsert', 'bulkCreate', 'findOrCreate', 'increment', 'decrement'];
const READ_METHODS = ['findAll', 'findByPk', 'findOne', 'findAndCountAll', 'count'];

/** Cuántos upserts `endpoint x tabla` se disparan en paralelo contra la BD por lote. */
const UPSERT_CONCURRENCY = 20;

type ImpactUsage = {
  operationType: 'READ' | 'UPSERT';
  confidenceLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  reason: string;
};

type DataImpactInference = {
  endpointId: string;
  endpointCode: string;
  tableName: string;
  impactKind: 'DIRECT' | 'INDIRECT';
  operationType: 'READ' | 'UPSERT';
  confidenceLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  notes: string;
};

type PendingUpsert = {
  endpoint: SystemEndpointCatalogModel;
  entity: SystemDataEntityCatalogModel;
  values: { operationType: 'READ' | 'UPSERT'; confidenceLevel: 'LOW' | 'MEDIUM' | 'HIGH'; notes: string; detectedFrom: string };
};

/**
 * Infers which data entities (tables) an endpoint reads/writes by scanning its
 * module's source, the same static-analysis approach `SystemsToolInferenceService`
 * uses for tools. Detection is layered so every table can be reached:
 *
 * 1. DIRECT — Sequelize model method calls (`Model.findAll(` / `Model.update(`).
 * 2. DIRECT — raw-SQL / literal references to the physical table name (covers
 *    entities without a Sequelize model, e.g. `schema_tables`).
 * 3. DIRECT — bare model references (associations, `include: [Model]`, imports),
 *    reported with LOW confidence.
 * 4. INDIRECT — one-hop propagation over the FK relationship catalog: if an
 *    endpoint affects table A and A relates to B, B is indirectly affected.
 *
 * This scales to every endpoint/table automatically instead of requiring each
 * pair to be hand-curated in a seed fixture, and guarantees that tables only
 * reachable through joins/FKs still show who affects them.
 *
 * The source scan (CPU + file I/O) and the DB persistence are two separate passes:
 * scanning builds an in-memory list of pending upserts first, then `mapWithConcurrency`
 * flushes them in bounded-concurrency batches — not one `await` per endpoint-table pair,
 * which would serialize potentially tens of thousands of round trips against the pool.
 */
@Injectable()
export class SystemsDataImpactInferenceService {
  constructor(private readonly repository: SystemsDataImpactInferenceRepository) {}

  async infer(input: { persist: boolean }) {
    const [endpoints, entities, relationships] = await Promise.all([
      this.repository.listActiveEndpoints(),
      this.repository.listEntitiesWithModel(),
      this.repository.listRelationships(),
    ]);
    const entitiesByTableName = new Map(entities.map((entity) => [entity.tableName, entity]));
    const relatedTables = this.buildAdjacency(relationships.map((row) => [row.sourceTable, row.targetTable]));

    const inferences: DataImpactInference[] = [];
    const pendingUpserts: PendingUpsert[] = [];

    for (const endpoint of endpoints) {
      const source = await readSourcesForEndpoint(endpoint);
      if (!source) continue;

      const directByTable = new Map<string, ImpactUsage>();
      for (const entity of entities) {
        const usage = this.classifyUsage(source, entity.modelName, entity.tableName);
        if (usage) directByTable.set(entity.tableName, usage);
      }

      const indirectByTable = new Map<string, string>();
      for (const [tableName] of directByTable) {
        for (const related of relatedTables.get(tableName) ?? []) {
          if (directByTable.has(related) || !entitiesByTableName.has(related)) continue;
          if (!indirectByTable.has(related)) {
            indirectByTable.set(related, `Afectación indirecta: relacionada vía FK con ${tableName}, usada por este endpoint.`);
          }
        }
      }

      for (const [tableName, usage] of directByTable) {
        const entity = entitiesByTableName.get(tableName);
        if (!entity) continue;
        inferences.push({
          endpointId: String(endpoint.id),
          endpointCode: endpoint.code,
          tableName,
          impactKind: 'DIRECT',
          operationType: usage.operationType,
          confidenceLevel: usage.confidenceLevel,
          notes: usage.reason,
        });
        if (input.persist) {
          pendingUpserts.push({
            endpoint,
            entity,
            values: {
              operationType: usage.operationType,
              confidenceLevel: usage.confidenceLevel,
              notes: usage.reason,
              detectedFrom: 'source_inference',
            },
          });
        }
      }

      for (const [tableName, reason] of indirectByTable) {
        const entity = entitiesByTableName.get(tableName);
        if (!entity) continue;
        inferences.push({
          endpointId: String(endpoint.id),
          endpointCode: endpoint.code,
          tableName,
          impactKind: 'INDIRECT',
          operationType: 'READ',
          confidenceLevel: 'LOW',
          notes: reason,
        });
        if (input.persist) {
          pendingUpserts.push({
            endpoint,
            entity,
            values: { operationType: 'READ', confidenceLevel: 'LOW', notes: reason, detectedFrom: 'relationship_inference' },
          });
        }
      }
    }

    if (input.persist && pendingUpserts.length > 0) {
      await mapWithConcurrency(pendingUpserts, UPSERT_CONCURRENCY, (job) =>
        this.repository.upsertImpact(job.endpoint, job.entity, job.values),
      );
    }

    const affectedTables = new Set(inferences.map((inference) => inference.tableName));
    const unaffectedTables = entities.filter((entity) => !affectedTables.has(entity.tableName)).map((entity) => entity.tableName);

    return {
      inferred: inferences.length,
      direct: inferences.filter((inference) => inference.impactKind === 'DIRECT').length,
      indirect: inferences.filter((inference) => inference.impactKind === 'INDIRECT').length,
      persisted: pendingUpserts.length,
      reviewStatus: input.persist ? 'NEEDS_REVIEW' : 'DRY_RUN',
      unaffectedTables,
      items: inferences.slice(0, 500),
    };
  }

  private buildAdjacency(pairs: Array<[string, string]>): Map<string, Set<string>> {
    const adjacency = new Map<string, Set<string>>();
    const link = (from: string, to: string) => {
      if (!from || !to || from === to) return;
      if (!adjacency.has(from)) adjacency.set(from, new Set());
      adjacency.get(from)?.add(to);
    };
    for (const [source, target] of pairs) {
      link(source, target);
      link(target, source);
    }
    return adjacency;
  }

  private classifyUsage(source: string, modelName: string | null, tableName: string): ImpactUsage | null {
    if (modelName) {
      const writePattern = new RegExp(`${modelName}\\.(${WRITE_METHODS.join('|')})\\(`);
      const readPattern = new RegExp(`${modelName}\\.(${READ_METHODS.join('|')})\\(`);
      if (writePattern.test(source)) {
        return {
          operationType: 'UPSERT',
          confidenceLevel: readPattern.test(source) ? 'HIGH' : 'MEDIUM',
          reason: `Inferido por uso de ${modelName} (write) en el código fuente del módulo.`,
        };
      }
      if (readPattern.test(source)) {
        return {
          operationType: 'READ',
          confidenceLevel: 'MEDIUM',
          reason: `Inferido por uso de ${modelName} (read) en el código fuente del módulo.`,
        };
      }
    }

    const rawWritePattern = new RegExp(`(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+["'\`]?${tableName}\\b`, 'i');
    if (rawWritePattern.test(source)) {
      return {
        operationType: 'UPSERT',
        confidenceLevel: 'MEDIUM',
        reason: `Inferido por SQL crudo de escritura sobre ${tableName} en el código fuente del módulo.`,
      };
    }
    const tableLiteralPattern = new RegExp(`["'\`]${tableName}["'\`]`);
    if (tableLiteralPattern.test(source)) {
      return {
        operationType: 'READ',
        confidenceLevel: 'LOW',
        reason: `Inferido por referencia literal a la tabla ${tableName} en el código fuente del módulo.`,
      };
    }

    if (modelName && new RegExp(`\\b${modelName}\\b`).test(source)) {
      return {
        operationType: 'READ',
        confidenceLevel: 'LOW',
        reason: `Inferido por referencia a ${modelName} (asociaciones/includes) en el código fuente del módulo.`,
      };
    }
    return null;
  }
}
