/**
 * @file Puerto de persistencia: lecturas de la sección Procesos (huellas del volcado, cableado e instancias).
 * @business Esta pieza deja ver si un proceso llegó a la base, si cada paso de una persona tiene pantalla y cuántos casos hay en curso.
 * @system consultas SQL de sólo lectura sobre `workflow_definitions_sync`, `system_flow_catalog` y la tabla de instancia que declara cada proceso.
 */
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { atlasSchemaFor } from '../../database/domain-schemas.js';
import { ATLAS_DOMAIN_TABLES } from '../../database/domain-tables.js';
import type { ProcessInstanceEntity } from './definitions/workflow-definition.types.js';

const SYNC = `${atlasSchemaFor('workflow_definitions_sync')}.workflow_definitions_sync`;
const FLOWS = `${atlasSchemaFor('system_flow_catalog')}.system_flow_catalog`;
const IDENT = /^[a-z_][a-z0-9_]*$/;
const KNOWN_TABLES = new Set(Object.values(ATLAS_DOMAIN_TABLES).flat());

export type SyncRow = { workflowCode: string; version: string; contentHash: string; appliedBy: string; appliedAt: string };
export type FlowRow = {
  systemCode: string;
  method: string;
  path: string;
  flowId: string;
  callers: string[];
  verification: string;
  risk: string;
  /** `TESTED` | `UNTESTED`: si el flujo tiene una prueba que lo ejercita (lo que enseñaba «Procesos de negocio»). */
  testStatus: string;
};
export type InstanceRow = { id: string; label: string | null; status: string };

/**
 * Los identificadores de la tabla de instancia vienen de fixtures del código, no del usuario; aun así
 * se validan (forma y pertenencia a `ATLAS_DOMAIN_TABLES`) antes de interpolarlos: un identificador
 * no se puede pasar como parámetro de consulta, y el día que alguien lo haga configurable ya estará
 * cerrado.
 */
function assertEntity(entity: ProcessInstanceEntity): void {
  const ids = [entity.table, entity.idColumn, entity.statusColumn, entity.labelColumn ?? 'x'];
  if (!ids.every((v) => IDENT.test(v)) || !KNOWN_TABLES.has(entity.table))
    throw new Error(`PROCESS_INSTANCE_ENTITY_INVALID: ${entity.table}`);
}

@Injectable()
export class ProcessCatalogRepository {
  private readonly tenantColumn = new Map<string, boolean>();

  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  async syncRows(): Promise<SyncRow[]> {
    return this.sequelize.query<SyncRow>(
      `SELECT workflow_code AS "workflowCode", version, content_hash AS "contentHash", applied_by AS "appliedBy", applied_at AS "appliedAt" FROM ${SYNC}`,
      { type: QueryTypes.SELECT },
    );
  }

  /** Filas de Flujos para las rutas pedidas, en una sola consulta. `path` sin barra inicial y con `:p`. */
  async flowsFor(keys: Array<{ systemCode: string; method: string; path: string }>): Promise<FlowRow[]> {
    if (!keys.length) return [];
    return this.sequelize.query<FlowRow>(
      `SELECT system_code AS "systemCode", http_method AS "method", path, flow_id AS "flowId", callers, verification, risk, test_status AS "testStatus"
         FROM ${FLOWS}
        WHERE (system_code || ' ' || http_method || ' ' || path) IN (:keys)`,
      { type: QueryTypes.SELECT, replacements: { keys: keys.map((k) => `${k.systemCode} ${k.method} ${k.path}`) } },
    );
  }

  private async hasTenantColumn(entity: ProcessInstanceEntity): Promise<boolean> {
    const key = `${atlasSchemaFor(entity.table)}.${entity.table}`;
    if (!this.tenantColumn.has(key)) {
      const rows = await this.sequelize.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = :schema AND table_name = :table AND column_name = '_tenant_id'`,
        { type: QueryTypes.SELECT, replacements: { schema: atlasSchemaFor(entity.table), table: entity.table } },
      );
      this.tenantColumn.set(key, (rows[0]?.n ?? 0) > 0);
    }
    return this.tenantColumn.get(key)!;
  }

  private async scope(entity: ProcessInstanceEntity, tenantId: string): Promise<{ where: string; replacements: Record<string, unknown> }> {
    const tenant = await this.hasTenantColumn(entity);
    return { where: tenant ? `_tenant_id = :tenantId` : 'true', replacements: tenant ? { tenantId } : {} };
  }

  async countByStatus(entity: ProcessInstanceEntity, tenantId: string): Promise<Array<{ status: string; total: number }>> {
    assertEntity(entity);
    const { where, replacements } = await this.scope(entity, tenantId);
    return this.sequelize.query<{ status: string; total: number }>(
      `SELECT ${entity.statusColumn}::text AS status, count(*)::int AS total FROM ${atlasSchemaFor(entity.table)}.${entity.table} WHERE ${where} GROUP BY 1 ORDER BY 2 DESC`,
      { type: QueryTypes.SELECT, replacements },
    );
  }

  async listInstances(
    entity: ProcessInstanceEntity,
    tenantId: string,
    filter: { status?: string; search?: string; limit: number; offset: number },
  ): Promise<{ rows: InstanceRow[]; total: number }> {
    assertEntity(entity);
    const { where, replacements } = await this.scope(entity, tenantId);
    const label = entity.labelColumn ? `${entity.labelColumn}::text` : 'NULL';
    const conditions = [where];
    if (filter.status) conditions.push(`${entity.statusColumn}::text = :status`);
    if (filter.search) conditions.push(`(${entity.idColumn}::text = :search OR ${label} ILIKE :like ESCAPE '\\')`);
    const sqlWhere = conditions.join(' AND ');
    const params = {
      ...replacements,
      status: filter.status,
      search: filter.search,
      like: `%${(filter.search ?? '').replace(/[\\%_]/g, '\\$&')}%`,
      limit: filter.limit,
      offset: filter.offset,
    };
    const rows = await this.sequelize.query<InstanceRow>(
      `SELECT ${entity.idColumn}::text AS id, ${label} AS label, ${entity.statusColumn}::text AS status
         FROM ${atlasSchemaFor(entity.table)}.${entity.table} WHERE ${sqlWhere}
        ORDER BY ${entity.idColumn} DESC LIMIT :limit OFFSET :offset`,
      { type: QueryTypes.SELECT, replacements: params },
    );
    const total = await this.sequelize.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${atlasSchemaFor(entity.table)}.${entity.table} WHERE ${sqlWhere}`,
      {
        type: QueryTypes.SELECT,
        replacements: params,
      },
    );
    return { rows, total: total[0]?.n ?? 0 };
  }

  async findInstance(entity: ProcessInstanceEntity, tenantId: string, id: string): Promise<InstanceRow | null> {
    assertEntity(entity);
    const { where, replacements } = await this.scope(entity, tenantId);
    const label = entity.labelColumn ? `${entity.labelColumn}::text` : 'NULL';
    const rows = await this.sequelize.query<InstanceRow>(
      `SELECT ${entity.idColumn}::text AS id, ${label} AS label, ${entity.statusColumn}::text AS status
         FROM ${atlasSchemaFor(entity.table)}.${entity.table} WHERE ${where} AND ${entity.idColumn}::text = :id LIMIT 1`,
      { type: QueryTypes.SELECT, replacements: { ...replacements, id } },
    );
    return rows[0] ?? null;
  }
}
