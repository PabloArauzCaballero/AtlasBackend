/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system lee la documentación de endpoints y refleja en el catálogo qué tabla toca cada uno.
 */
import { Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atlasSchemaFor } from '../../database/domain-schemas.js';
import { pathExists } from './path-exists.util.js';
import { SystemsCatalogRepository } from './systems-catalog.repository.js';

type DocsImpact = { method: string; path: string; reads: string[]; writes: string[] };

/**
 * Qué tabla lee y qué tabla escribe cada endpoint, según la documentación versionada.
 *
 * Vive aparte de las semillas porque su fuente no es la base ni el código: es Markdown. Un cambio de
 * formato en esos documentos rompe esto y nada más, que es exactamente la frontera que se quiere.
 */
@Injectable()
export class SystemsEndpointDocsService {
  constructor(private readonly catalogRepository: SystemsCatalogRepository) {}

  async seedImpactsFromDocs(): Promise<number> {
    const docs = await this.parseEndpointDocs();
    let count = 0;
    for (const doc of docs) {
      const endpoint = await this.catalogRepository.findEndpointByMethodAndPath(doc.method, doc.path);
      if (!endpoint) continue;
      for (const table of doc.reads) {
        if (await this.upsertImpactForTable(String(endpoint.id), table, 'READ', false)) count += 1;
      }
      for (const [index, table] of doc.writes.entries()) {
        if (await this.upsertImpactForTable(String(endpoint.id), table, 'INSERT', index === 0)) count += 1;
      }
    }
    return count;
  }

  private async upsertImpactForTable(
    endpointId: string,
    tableName: string,
    operationType: string,
    isPrimaryEntity: boolean,
  ): Promise<boolean> {
    const entity = await this.catalogRepository.findDataEntityByTable(atlasSchemaFor(tableName), tableName);
    if (!entity) return false;
    await this.catalogRepository.upsertDataImpact({
      endpointId,
      dataEntityId: String(entity.id),
      operationType,
      impactLevel: entity.isAuditCritical ? 'HIGH' : 'MEDIUM',
      isPrimaryEntity,
      affectsCustomerState: entity.module === 'customers',
      affectsRiskState: entity.containsRiskData,
      affectsLegalState: entity.containsLegalData,
      affectsDeviceState: entity.containsDeviceData,
      affectsNotificationState: entity.module === 'notifications',
      requiresStressTest: entity.isAuditCritical,
      detectedFrom: 'docs/endpoints/endpoints.md',
      confidenceLevel: 'HIGH',
      reviewStatus: 'AUTO_DETECTED',
    });
    return true;
  }

  private async parseEndpointDocs(): Promise<DocsImpact[]> {
    const path = join(process.cwd(), 'docs', 'endpoints', 'endpoints.md');
    if (!(await pathExists(path))) return [];
    const lines = (await readFile(path, 'utf8')).split('\n');
    const impacts: DocsImpact[] = [];
    let current: DocsImpact | null = null;
    let section: 'reads' | 'writes' | null = null;

    for (const line of lines) {
      const endpoint = line.match(/^(GET|POST|PATCH|PUT|DELETE)\s+(`)?(\/api\/v[0-9]+\/[^`\s]+)\2?/);
      const httpBlock = line.match(/^```http\s*$/);
      if (httpBlock) continue;
      const inlineHttp = line.match(/^(GET|POST|PATCH|PUT|DELETE)\s+(\/api\/v[0-9]+\/\S+)/);
      const detected = endpoint ?? inlineHttp;
      if (detected) {
        if (current) impacts.push(current);
        current = { method: detected[1], path: detected[3] ?? detected[2], reads: [], writes: [] };
        section = null;
        continue;
      }
      if (!current) continue;
      if (/^###\s+Lee/.test(line)) {
        section = 'reads';
        continue;
      }
      if (/^###\s+Escribe/.test(line)) {
        section = 'writes';
        continue;
      }
      if (/^###\s+/.test(line) || /^---/.test(line)) {
        section = null;
        continue;
      }
      const table = line.match(/^\s*-\s+`([^`]+)`/);
      if (table && section) current[section].push(table[1]);
    }
    if (current) impacts.push(current);
    return impacts.filter((impact) => impact.reads.length > 0 || impact.writes.length > 0);
  }
}
