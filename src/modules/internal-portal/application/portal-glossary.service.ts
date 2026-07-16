import { NotFoundException } from '@nestjs/common';
import { clean, containsQuery, id, iso, nullableText, paginate, Query, Row } from './portal-format.util.js';
import { NOW_SEED } from './portal-report-definitions.js';
import { PortalQueryBase } from './portal-query.base.js';

/**
 * Glosario de negocio del portal interno: dominios, tablas y campos catalogados, con sus relaciones.
 *
 * Extraído de `internal-portal.service.ts` (Fase 2.2 del plan 10/10) sin cambios de comportamiento.
 * `InternalPortalService` delega aquí y mantiene su API pública intacta.
 */
export class PortalGlossaryService extends PortalQueryBase {
  async listBusinessTerms(query: Query) {
    const q = clean(query.q, '').toLowerCase();
    const [domains, tables, fields] = await Promise.all([
      this.queryRows(
        `SELECT _id, domain_code, domain_name, description, owner_team, data_nature, _updated_at FROM system_domain_catalog ORDER BY domain_code ASC LIMIT 80`,
      ),
      this.queryRows(
        `SELECT _id, schema_name, table_name, entity_name, module, domain_code, business_purpose, data_owner, status, review_status, _updated_at FROM system_data_entity_catalog ORDER BY module ASC, table_name ASC LIMIT 120`,
      ),
      this.queryRows(
        `SELECT _id, data_entity_id, schema_name, table_name, column_name, business_name, business_meaning, domain_code, sensitivity_level, referenced_table, referenced_column, _updated_at FROM system_data_field_catalog WHERE COALESCE(status, 'ACTIVE') <> 'DEPRECATED' ORDER BY table_name ASC, ordinal_position ASC LIMIT 240`,
      ),
    ]);
    const entityIds = tables.map((row) => id(row._id)).filter(Boolean);
    const endpointImpacts = entityIds.length
      ? await this.queryRows<{ data_entity_id: string; method: string; full_path: string }>(
          `SELECT i.data_entity_id, e.method, e.full_path
             FROM system_endpoint_data_entity_impacts i
             JOIN system_endpoint_catalog e ON e._id = i.endpoint_id
            WHERE i.data_entity_id IN (:entityIds)`,
          { entityIds },
        )
      : [];
    const endpointsByEntityId = new Map<string, string[]>();
    for (const impact of endpointImpacts) {
      const key = clean(impact.data_entity_id, '');
      const label = `${clean(impact.method)} ${clean(impact.full_path)}`;
      const current = endpointsByEntityId.get(key) ?? [];
      if (!current.includes(label)) endpointsByEntityId.set(key, [...current, label]);
    }
    const fieldsByTable = new Map<string, Row[]>();
    for (const field of fields) {
      const key = clean(field.table_name, '').toLowerCase();
      fieldsByTable.set(key, [...(fieldsByTable.get(key) ?? []), field]);
    }
    const tablesForDomain = (domainCode: unknown) => {
      const domain = clean(domainCode, '').toLowerCase();
      return tables
        .filter(
          (row) => clean(row.domain_code, clean(row.module, '')).toLowerCase() === domain || clean(row.module, '').toLowerCase() === domain,
        )
        .map((row) => clean(row.table_name));
    };
    const columnsForDomain = (domainCode: unknown) => {
      const domain = clean(domainCode, '').toLowerCase();
      const tableNames = new Set(tablesForDomain(domainCode).map((table) => table.toLowerCase()));
      return fields
        .filter((row) => clean(row.domain_code, '').toLowerCase() === domain || tableNames.has(clean(row.table_name, '').toLowerCase()))
        .map((row) => `${clean(row.table_name)}.${clean(row.column_name)}`);
    };
    const endpointsForDomain = (domainCode: unknown) => {
      const domainTables = new Set(tablesForDomain(domainCode).map((table) => table.toLowerCase()));
      const result = new Set<string>();
      for (const row of tables) {
        if (!domainTables.has(clean(row.table_name, '').toLowerCase())) continue;
        for (const endpoint of endpointsByEntityId.get(clean(row._id, '')) ?? []) result.add(endpoint);
      }
      return [...result];
    };
    const items = [
      ...domains.map((row) => ({
        termId: `domain:${clean(row.domain_code)}`,
        key: clean(row.domain_code),
        name: clean(row.domain_name, clean(row.domain_code)),
        definition: clean(row.description, 'Dominio de negocio registrado para agrupar datos, endpoints y reglas.'),
        domain: clean(row.domain_code),
        owner: clean(row.owner_team, 'systems'),
        status: 'ACTIVE',
        relatedTables: tablesForDomain(row.domain_code),
        relatedColumns: columnsForDomain(row.domain_code),
        relatedEndpoints: endpointsForDomain(row.domain_code),
        relatedReports: ['operations-overview', 'data-governance'],
        metadata: { dataNature: clean(row.data_nature, 'OPERACIONAL'), source: 'system_domain_catalog' },
        updatedAt: iso(row._updated_at) ?? NOW_SEED,
      })),
      ...tables.map((row) => ({
        termId: `table:${id(row._id)}`,
        key: clean(row.table_name),
        name: clean(row.entity_name, clean(row.table_name)),
        definition: clean(row.business_purpose, 'Tabla operacional documentada en el catálogo de datos.'),
        domain: clean(row.module, 'platform'),
        owner: clean(row.data_owner, 'systems'),
        status: clean(row.status, 'ACTIVE'),
        relatedTables: [clean(row.table_name)],
        relatedColumns: (fieldsByTable.get(clean(row.table_name, '').toLowerCase()) ?? []).map(
          (field) => `${clean(field.table_name)}.${clean(field.column_name)}`,
        ),
        relatedEndpoints: endpointsByEntityId.get(id(row._id)) ?? [],
        relatedReports: ['endpoint-coverage', 'data-governance'],
        metadata: { schemaName: clean(row.schema_name), reviewStatus: clean(row.review_status), source: 'system_data_entity_catalog' },
        updatedAt: iso(row._updated_at) ?? NOW_SEED,
      })),
      ...fields.map((row) => this.mapFieldTerm(row)),
    ].filter((item) => containsQuery(item, q));
    return paginate(items, query);
  }

  private mapFieldTerm(row: Row) {
    return {
      termId: `field:${id(row._id)}`,
      key: `${clean(row.table_name)}.${clean(row.column_name)}`,
      name: clean(row.business_name, clean(row.column_name)),
      definition: clean(row.business_meaning, 'Campo documentado para auditoría, análisis y gobierno de datos.'),
      domain: clean(row.domain_code, 'PLATAFORMA'),
      owner: 'data-governance',
      status: 'ACTIVE',
      relatedTables: [clean(row.table_name)],
      relatedColumns: [`${clean(row.table_name)}.${clean(row.column_name)}`],
      relatedReports: ['data-governance'],
      metadata: { sensitivityLevel: clean(row.sensitivity_level, 'INTERNAL'), source: 'system_data_field_catalog' },
      updatedAt: iso(row._updated_at) ?? NOW_SEED,
    };
  }

  /**
   * `field:` es, con diferencia, el prefijo más numeroso de `termId` (hasta 240 candidatos vs 120
   * de `table:` y 80 de `domain:`) y, a diferencia de esos dos, un término de campo no necesita
   * cruzar contra el resto del catálogo (`relatedTables`/`relatedColumns` se arman solo con la
   * fila misma — ver `mapFieldTerm`). Para ese caso se resuelve con una sola query dirigida por
   * id en vez de traer domains+tables+fields completos (`listBusinessTerms`) solo para hacer
   * `.find()` sobre uno. `domain:`/`table:` sí necesitan el resto del catálogo para calcular sus
   * relaciones (tablesForDomain/columnsForDomain, fieldsByTable), así que esos siguen usando el
   * camino original.
   */
  private async findSingleBusinessTerm(
    decodedTermId: string,
  ): Promise<Awaited<ReturnType<PortalGlossaryService['listBusinessTerms']>>['items'][number] | undefined> {
    if (decodedTermId.startsWith('field:')) {
      const fieldId = decodedTermId.slice('field:'.length);
      const rows = await this.queryRows(
        `SELECT _id, data_entity_id, schema_name, table_name, column_name, business_name, business_meaning, domain_code,
                sensitivity_level, referenced_table, referenced_column, _updated_at
           FROM system_data_field_catalog
          WHERE _id = :fieldId AND COALESCE(status, 'ACTIVE') <> 'DEPRECATED'
          LIMIT 1`,
        { fieldId },
      );
      return rows[0] ? this.mapFieldTerm(rows[0]) : undefined;
    }
    const result = await this.listBusinessTerms({ page: 1, limit: 500 });
    return result.items.find((item) => item.termId === decodedTermId);
  }

  async getBusinessTerm(termId: string) {
    const decodedTermId = decodeURIComponent(termId);
    const term = await this.findSingleBusinessTerm(decodedTermId);
    if (!term) throw new NotFoundException('BUSINESS_TERM_NOT_FOUND');
    const relatedTableNames = term.relatedTables ?? [];
    const fkRelations = relatedTableNames.length
      ? await this.queryRows(
          `SELECT _id, source_table, source_column, target_table, target_column, relationship_type
             FROM system_data_relationship_catalog
            WHERE source_table IN (:tables) OR target_table IN (:tables)
            ORDER BY source_table ASC, target_table ASC
            LIMIT 80`,
          { tables: relatedTableNames },
        )
      : [];
    return {
      ...term,
      synonyms: [term.key, term.name, ...(term.relatedTables ?? []), ...(term.relatedColumns ?? [])].filter(Boolean),
      examples: [
        `Usado por ${term.owner ?? 'systems'} para auditoría, análisis y decisiones operativas.`,
        'Debe mantenerse trazable y documentado para evitar interpretación ambigua.',
      ],
      restrictions: ['No modificar significado sin revisión de gobierno de datos.', 'No exponer PII ni payloads crudos en reportes.'],
      relations:
        fkRelations.length > 0
          ? fkRelations.map((relation) => ({
              relationId: `fk:${id(relation._id)}`,
              relationType: clean(relation.relationship_type, 'FOREIGN_KEY'),
              targetType: 'table',
              targetId: clean(relation.target_table),
              targetLabel: `${clean(relation.source_table)}.${clean(relation.source_column)} -> ${clean(relation.target_table)}.${clean(relation.target_column)}`,
              sourceTable: clean(relation.source_table),
              sourceColumn: nullableText(relation.source_column),
              targetTable: clean(relation.target_table),
              targetColumn: nullableText(relation.target_column),
            }))
          : (term.relatedTables ?? []).map((table) => ({
              relationId: `rel:${term.termId}:${table}`,
              relationType: 'documents',
              targetType: 'table',
              targetId: table,
              targetLabel: table,
            })),
      audit: [
        { auditId: `audit:${term.termId}`, action: 'seeded_or_detected', actor: 'atlas_backend', createdAt: term.updatedAt ?? NOW_SEED },
      ],
    };
  }
}
