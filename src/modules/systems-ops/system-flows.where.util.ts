/**
 * @file Utilidad de repositorio: traduce los filtros del explorador de Flujos a cláusulas WHERE.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system construye el `where` de `system_flow_catalog` desde la consulta validada, sin tocar la base.
 */
import { Op, WhereOptions } from 'sequelize';
import { FlowsListQueryDto } from './system-flows.schemas.js';

export const like = (value: string) => ({ [Op.iLike]: `%${value.replace(/[%_]/g, '\\$&')}%` });

function flowStateWhere(query: FlowsListQueryDto): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (query.discovery) where.discovery = query.discovery;
  if (query.verification) where.verification = query.verification;
  if (query.freshness) where.freshness = query.freshness;
  if (query.isPublic !== undefined) where.isPublic = query.isPublic;
  if (query.tested !== undefined) where.testStatus = query.tested ? 'TESTED' : 'UNTESTED';
  if (query.withFindings !== undefined) where.findingsCount = query.withFindings ? { [Op.gt]: 0 } : 0;
  return where;
}

export function buildFlowsWhere(query: FlowsListQueryDto): WhereOptions {
  const where: Record<string, unknown> = flowStateWhere(query);
  if (query.systemCode) where.systemCode = query.systemCode;
  if (query.module) where.module = query.module;
  if (query.kind) where.kind = query.kind;
  if (query.risk) where.risk = query.risk;
  if (query.caller) where.callers = { [Op.contains]: [query.caller] };
  if (query.table)
    where[Op.or as unknown as string] = [{ reads: { [Op.contains]: [query.table] } }, { writes: { [Op.contains]: [query.table] } }];
  if (query.role)
    where[Op.or as unknown as string] = [
      { roles: { [Op.contains]: [query.role] } },
      { internalPermissions: { [Op.contains]: [query.role] } },
    ];
  if (query.q) {
    const q = like(query.q);
    where[Op.and as unknown as string] = [
      { [Op.or]: [{ name: q }, { slug: q }, { path: q }, { handler: q }, { controller: q }, { module: q }] },
    ];
  }
  return where as WhereOptions;
}
