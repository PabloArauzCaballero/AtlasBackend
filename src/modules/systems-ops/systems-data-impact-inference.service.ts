import { Injectable } from '@nestjs/common';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SystemEndpointCatalogModel } from '../../database/models/index.js';
import { SystemsDataImpactInferenceRepository } from './systems-data-impact-inference.repository.js';

const WRITE_METHODS = ['create', 'update', 'destroy', 'upsert', 'bulkCreate', 'findOrCreate', 'increment', 'decrement'];
const READ_METHODS = ['findAll', 'findByPk', 'findOne', 'findAndCountAll', 'count'];

type DataImpactInference = {
  endpointId: string;
  endpointCode: string;
  tableName: string;
  operationType: 'READ' | 'WRITE';
  confidenceLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  notes: string;
};

function sourceFilesForEndpoint(endpoint: SystemEndpointCatalogModel): string[] {
  const files = new Set<string>();
  if (endpoint.sourceFile) files.add(join(process.cwd(), endpoint.sourceFile));
  const moduleDir = endpoint.sourceFile
    ? dirname(join(process.cwd(), endpoint.sourceFile))
    : join(process.cwd(), 'src', 'modules', endpoint.module);
  if (existsSync(moduleDir)) {
    for (const file of walk(moduleDir).filter((path) => path.endsWith('.ts'))) files.add(file);
  }
  return Array.from(files);
}

function walk(directory: string): string[] {
  const entries = readdirSync(directory).map((entry) => join(directory, entry));
  return entries.flatMap((entry) => (statSync(entry).isDirectory() ? walk(entry) : [entry]));
}

function readSources(files: string[]): string {
  return files
    .filter((file) => existsSync(file))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
}

/**
 * Infers which data entities (tables) an endpoint reads/writes by scanning its
 * module's source for references to known Sequelize model classes, the same
 * static-analysis approach `SystemsToolInferenceService` uses for tools. This
 * scales to every endpoint/table automatically instead of requiring each pair
 * to be hand-curated in a seed fixture.
 */
@Injectable()
export class SystemsDataImpactInferenceService {
  constructor(private readonly repository: SystemsDataImpactInferenceRepository) {}

  async infer(input: { persist: boolean }) {
    const [endpoints, entities] = await Promise.all([
      this.repository.listActiveEndpoints(),
      this.repository.listEntitiesWithModel(),
    ]);
    const entitiesByModelName = new Map(
      entities.filter((entity) => entity.modelName).map((entity) => [entity.modelName as string, entity]),
    );
    const inferences: DataImpactInference[] = [];
    let persisted = 0;

    for (const endpoint of endpoints) {
      const source = readSources(sourceFilesForEndpoint(endpoint));
      if (!source) continue;
      for (const [modelName, entity] of entitiesByModelName) {
        const usage = this.classifyUsage(source, modelName);
        if (!usage) continue;
        const inference = {
          endpointId: String(endpoint.id),
          endpointCode: endpoint.code,
          tableName: entity.tableName,
          operationType: usage.operationType,
          confidenceLevel: usage.confidenceLevel,
          notes: `Inferido por uso de ${modelName} (${usage.operationType.toLowerCase()}) en el código fuente del módulo.`,
        } satisfies DataImpactInference;
        inferences.push(inference);
        if (input.persist) {
          await this.repository.upsertImpact(endpoint, entity, {
            operationType: usage.operationType,
            confidenceLevel: usage.confidenceLevel,
            notes: inference.notes,
          });
          persisted += 1;
        }
      }
    }

    return {
      inferred: inferences.length,
      persisted,
      reviewStatus: input.persist ? 'NEEDS_REVIEW' : 'DRY_RUN',
      items: inferences.slice(0, 500),
    };
  }

  private classifyUsage(
    source: string,
    modelName: string,
  ): { operationType: 'READ' | 'WRITE'; confidenceLevel: 'LOW' | 'MEDIUM' | 'HIGH' } | null {
    const mention = new RegExp(`\\b${modelName}\\b`);
    if (!mention.test(source)) return null;
    const writePattern = new RegExp(`${modelName}\\.(${WRITE_METHODS.join('|')})\\(`);
    const readPattern = new RegExp(`${modelName}\\.(${READ_METHODS.join('|')})\\(`);
    if (writePattern.test(source)) {
      return { operationType: 'WRITE', confidenceLevel: readPattern.test(source) ? 'HIGH' : 'MEDIUM' };
    }
    if (readPattern.test(source)) {
      return { operationType: 'READ', confidenceLevel: 'MEDIUM' };
    }
    return null;
  }
}
