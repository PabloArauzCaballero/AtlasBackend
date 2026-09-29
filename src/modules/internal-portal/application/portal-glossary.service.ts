/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza ofrece a operaciones una vista gobernada del negocio sin acceso directo a tablas sensibles.
 * @system compone consultas read-only, reportes, glosario, linaje y búsqueda para el portal administrativo.
 */
import { NotFoundException } from '@nestjs/common';
import { clean, id, intValue, iso, nullableText, parsePage, Query, Row } from './portal-format.util.js';
import { containsLikePattern } from '../../../common/utils/strings/like-pattern.util.js';
import { PortalQueryBase } from './portal-query.base.js';
import {
  GLOSSARY_COUNT_SQL,
  GLOSSARY_DOMAIN_TABLES_SQL,
  GLOSSARY_FACETS_SQL,
  GLOSSARY_PAGE_SQL,
  GLOSSARY_RELATED_ENDPOINTS_SQL,
  GLOSSARY_RELATED_FIELDS_SQL,
  GLOSSARY_TERM_BY_REF_SQL,
} from './portal-glossary-sql.constants.js';

export const GLOSSARY_TERM_KINDS = ['domain', 'table', 'field'] as const;
export type GlossaryTermKind = (typeof GLOSSARY_TERM_KINDS)[number];

type TermRow = {
  kind: GlossaryTermKind;
  ref_id: string;
  term_key: string;
  name: string;
  definition: string | null;
  domain: string;
  owner: string | null;
  status: string;
  updated_at: unknown;
  data_nature: string | null;
  schema_name: string | null;
  table_name: string | null;
  review_status: string | null;
  sensitivity_level: string | null;
};

type Relations = { tables: Map<string, string[]>; columns: Map<string, string[]>; endpoints: Map<string, string[]> };

/** Un `IN ()` vacío no es SQL válido: se sustituye por un valor que no casa con nada. */
const orNone = (values: string[]) => (values.length > 0 ? values : ['\u0000']);

const DEFINITION_FALLBACK: Record<GlossaryTermKind, string> = {
  domain: 'Dominio de negocio registrado para agrupar datos, endpoints y reglas.',
  table: 'Tabla operacional documentada en el catálogo de datos.',
  field: 'Campo documentado para auditoría, análisis y gobierno de datos.',
};

const RELATED_REPORTS: Record<GlossaryTermKind, string[]> = {
  domain: ['operations-overview', 'data-governance'],
  table: ['endpoint-coverage', 'data-governance'],
  field: ['data-governance'],
};

const SOURCE: Record<GlossaryTermKind, string> = {
  domain: 'system_domain_catalog',
  table: 'system_data_entity_catalog',
  field: 'system_data_field_catalog',
};

/**
 * Glosario de negocio del portal interno: dominios, tablas y campos catalogados, con sus relaciones.
 *
 * La página, el total, el buscador y los filtros `domain` y `type` se resuelven en SQL sobre el
 * catálogo entero (`portal-glossary-sql.constants.ts`); sólo las relaciones de los términos de ESA
 * página se cruzan después, con tres consultas acotadas a ellos.
 */
export class PortalGlossaryService extends PortalQueryBase {
  async listBusinessTerms(query: Query) {
    const page = parsePage(query);
    const q = clean(query.q, '').trim();
    const filters = {
      q,
      like: containsLikePattern(q),
      domain: clean(query.domain, '').trim(),
      kind: GLOSSARY_TERM_KINDS.includes(query.type as GlossaryTermKind) ? String(query.type) : '',
    };
    const [rows, totals] = await Promise.all([
      this.queryRows<TermRow>(GLOSSARY_PAGE_SQL, { ...filters, limit: page.limit, offset: page.offset }),
      this.queryRows<{ total: string }>(GLOSSARY_COUNT_SQL, filters),
    ]);
    const total = intValue(totals[0]?.total, 0);
    const relations = await this.loadRelations(rows);
    return {
      items: rows.map((row) => this.toTerm(row, relations)),
      meta: { page: page.page, limit: page.limit, total, totalPages: Math.max(1, Math.ceil(total / page.limit)) },
    };
  }

  /** Valores del filtro «Dominio» y reparto por tipo, contados sobre el catálogo entero. */
  async listBusinessTermFacets() {
    const rows = await this.queryRows<{ facet: string; value: string; total: string }>(GLOSSARY_FACETS_SQL);
    const pick = (facet: string) =>
      rows.filter((row) => row.facet === facet).map((row) => ({ value: clean(row.value), total: intValue(row.total, 0) }));
    return { domains: pick('domain'), types: pick('kind') };
  }

  private async loadRelations(rows: TermRow[]): Promise<Relations> {
    const relations: Relations = { tables: new Map(), columns: new Map(), endpoints: new Map() };
    const codes = rows.filter((row) => row.kind === 'domain').map((row) => row.ref_id.toLowerCase());
    const tableRows = rows.filter((row) => row.kind === 'table');
    if (codes.length === 0 && tableRows.length === 0) return relations;

    const domainTables = codes.length
      ? await this.queryRows<{ id: string; table_name: string; domain_key: string; module_key: string }>(GLOSSARY_DOMAIN_TABLES_SQL, {
          codes,
        })
      : [];
    const entityIds = [...new Set([...tableRows.map((row) => row.ref_id), ...domainTables.map((row) => row.id)])];
    const tableNames = [...new Set([...tableRows, ...domainTables].map((row) => clean(row.table_name, '').toLowerCase()))];
    const [fields, impacts] = await Promise.all([
      this.queryRows<{ data_entity_id: string | null; table_name: string; column_name: string; domain_key: string }>(
        GLOSSARY_RELATED_FIELDS_SQL,
        { entityIds: orNone(entityIds), tableNames: orNone(tableNames), codes: orNone(codes) },
      ),
      entityIds.length
        ? this.queryRows<{ data_entity_id: string; method: string; full_path: string }>(GLOSSARY_RELATED_ENDPOINTS_SQL, { entityIds })
        : Promise.resolve([]),
    ]);

    const endpointsByEntity = new Map<string, string[]>();
    for (const impact of impacts) addUnique(endpointsByEntity, impact.data_entity_id, `${clean(impact.method)} ${clean(impact.full_path)}`);
    const columnOf = (field: { table_name: string; column_name: string }) => `${clean(field.table_name)}.${clean(field.column_name)}`;

    for (const table of tableRows) {
      const key = `table:${table.ref_id}`;
      const name = clean(table.table_name, '').toLowerCase();
      relations.tables.set(key, [clean(table.table_name)]);
      relations.columns.set(
        key,
        fields.filter((field) => field.data_entity_id === table.ref_id || clean(field.table_name, '').toLowerCase() === name).map(columnOf),
      );
      relations.endpoints.set(key, endpointsByEntity.get(table.ref_id) ?? []);
    }
    for (const code of codes) {
      const key = `domain:${code}`;
      const tables = domainTables.filter((row) => row.domain_key === code || row.module_key === code);
      const ids = new Set(tables.map((row) => row.id));
      const names = new Set(tables.map((row) => clean(row.table_name, '').toLowerCase()));
      relations.tables.set(key, [...new Set(tables.map((row) => clean(row.table_name)))]);
      relations.columns.set(key, [
        ...new Set(
          fields
            .filter(
              (field) => field.domain_key === code || ids.has(clean(field.data_entity_id, '')) || names.has(field.table_name.toLowerCase()),
            )
            .map(columnOf),
        ),
      ]);
      relations.endpoints.set(key, [...new Set(tables.flatMap((row) => endpointsByEntity.get(row.id) ?? []))]);
    }
    return relations;
  }

  private toTerm(row: TermRow, relations: Relations) {
    const termId = `${row.kind}:${row.kind === 'domain' ? clean(row.ref_id) : id(row.ref_id)}`;
    const relationKey = row.kind === 'domain' ? `domain:${row.ref_id.toLowerCase()}` : termId;
    const tableName = clean(row.table_name);
    return {
      termId,
      key: clean(row.term_key),
      name: clean(row.name, clean(row.term_key)),
      definition: clean(row.definition, DEFINITION_FALLBACK[row.kind]),
      type: row.kind,
      domain: clean(row.domain),
      owner: clean(row.owner, row.kind === 'field' ? 'data-governance' : 'systems'),
      status: clean(row.status, 'ACTIVE'),
      relatedTables: row.kind === 'field' ? [tableName] : (relations.tables.get(relationKey) ?? []),
      relatedColumns: row.kind === 'field' ? [clean(row.term_key)] : (relations.columns.get(relationKey) ?? []),
      relatedEndpoints: row.kind === 'field' ? [] : (relations.endpoints.get(relationKey) ?? []),
      relatedReports: RELATED_REPORTS[row.kind],
      metadata: this.metadataFor(row),
      updatedAt: iso(row.updated_at),
    };
  }

  private metadataFor(row: TermRow): Row {
    if (row.kind === 'domain') return { dataNature: clean(row.data_nature, 'OPERACIONAL'), source: SOURCE.domain };
    if (row.kind === 'table') return { schemaName: clean(row.schema_name), reviewStatus: clean(row.review_status), source: SOURCE.table };
    return { sensitivityLevel: clean(row.sensitivity_level, 'INTERNAL'), source: SOURCE.field };
  }

  /**
   * La ficha se resuelve por su identificador en la base, no buscándola dentro de una página: con
   * la versión anterior una tabla más allá de las 120 primeras respondía 404 aunque existiera.
   */
  private async findSingleBusinessTerm(decodedTermId: string) {
    const separator = decodedTermId.indexOf(':');
    const kind = decodedTermId.slice(0, separator) as GlossaryTermKind;
    const ref = decodedTermId.slice(separator + 1);
    if (separator < 1 || !GLOSSARY_TERM_KINDS.includes(kind) || !ref) return undefined;
    const rows = await this.queryRows<TermRow>(GLOSSARY_TERM_BY_REF_SQL, { kind, ref });
    if (!rows[0]) return undefined;
    return this.toTerm(rows[0], await this.loadRelations(rows));
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
      audit: [{ auditId: `audit:${term.termId}`, action: 'seeded_or_detected', actor: 'atlas_backend', createdAt: term.updatedAt }],
    };
  }
}

function addUnique(map: Map<string, string[]>, key: string, value: string) {
  const current = map.get(key) ?? [];
  if (!current.includes(value)) map.set(key, [...current, value]);
}
