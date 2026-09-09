/**
 * @file Repositorio: encapsula el acceso a datos de Flujos (Flow Intelligence).
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system carga el artefacto de `flows:derive` en las tablas `system_flow_*` y sirve consultas paginadas.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindAndCountOptions, literal, Op, Transaction, WhereOptions } from 'sequelize';
import { buildPaginationMeta, toOffset } from '../../common/utils/pagination/pagination.util.js';
import {
  SystemFlowCatalogModel,
  SystemFlowFindingModel,
  SystemFlowImportModel,
  SystemScreenCatalogModel,
} from '../../database/models/index.js';
import { FindingsListQueryDto, FlowsListQueryDto, ScreensListQueryDto } from './system-flows.schemas.js';

type FlowRow = Omit<SystemFlowCatalogModel['dataValues'], 'id' | 'createdAtValue' | 'updatedAtValue'>;
type ScreenRow = Omit<SystemScreenCatalogModel['dataValues'], 'id' | 'createdAtValue' | 'updatedAtValue'>;
type FindingRow = Omit<SystemFlowFindingModel['dataValues'], 'id' | 'createdAtValue' | 'updatedAtValue' | 'status'>;

const like = (value: string) => ({ [Op.iLike]: `%${value.replace(/[%_]/g, '\\$&')}%` });

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

@Injectable()
export class SystemFlowsRepository {
  constructor(
    @InjectModel(SystemFlowCatalogModel) private readonly flows: typeof SystemFlowCatalogModel,
    @InjectModel(SystemScreenCatalogModel) private readonly screens: typeof SystemScreenCatalogModel,
    @InjectModel(SystemFlowFindingModel) private readonly findings: typeof SystemFlowFindingModel,
    @InjectModel(SystemFlowImportModel) private readonly imports: typeof SystemFlowImportModel,
  ) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.flows.sequelize!.transaction(work);
  }

  createImport(
    values: Omit<SystemFlowImportModel['dataValues'], 'id' | 'createdAtValue'>,
    tx: Transaction,
  ): Promise<SystemFlowImportModel> {
    return this.imports.create({ ...values, createdAtValue: new Date() }, { transaction: tx });
  }

  async replaceFlows(systemCode: string, rows: FlowRow[], tx: Transaction): Promise<{ upserted: number; removed: number }> {
    const now = new Date();
    // `conflictFields` explícito: el índice único es (system_code, http_method, path); sin él Sequelize choca contra la PK.
    for (const row of rows)
      await this.flows.upsert(
        { ...row, createdAtValue: now, updatedAtValue: now },
        { transaction: tx, conflictFields: ['system_code', 'http_method', 'path'] },
      );
    const removed = await this.flows.destroy({ where: { systemCode, flowId: { [Op.notIn]: rows.map((r) => r.flowId) } }, transaction: tx });
    return { upserted: rows.length, removed };
  }

  async replaceScreens(clientCode: string, rows: ScreenRow[], tx: Transaction): Promise<{ upserted: number; removed: number }> {
    const now = new Date();
    for (const row of rows)
      await this.screens.upsert(
        { ...row, createdAtValue: now, updatedAtValue: now },
        { transaction: tx, conflictFields: ['client_code', 'route'] },
      );
    const removed = await this.screens.destroy({ where: { clientCode, route: { [Op.notIn]: rows.map((r) => r.route) } }, transaction: tx });
    return { upserted: rows.length, removed };
  }

  /** Los hallazgos que dejan de venir se cierran como resueltos, no se borran: su historial vale. */
  async replaceFindings(systemCode: string, rows: FindingRow[], tx: Transaction): Promise<{ upserted: number; removed: number }> {
    const now = new Date();
    for (const row of rows) {
      const existing = await this.findings.findOne({ where: { findingKey: row.findingKey }, transaction: tx });
      if (existing) await existing.update({ ...row, updatedAtValue: now }, { transaction: tx });
      else await this.findings.create({ ...row, status: 'open', createdAtValue: now, updatedAtValue: now }, { transaction: tx });
    }
    const [removed] = await this.findings.update(
      { status: 'resolved', updatedAtValue: now },
      { where: { systemCode, status: 'open', findingKey: { [Op.notIn]: rows.map((r) => r.findingKey) } }, transaction: tx },
    );
    return { upserted: rows.length, removed };
  }

  async recountFindings(systemCode: string, tx: Transaction): Promise<void> {
    const open = await this.findings.findAll({ where: { systemCode, status: 'open' }, attributes: ['ref'], transaction: tx, raw: true });
    const counts = new Map<string, number>();
    for (const f of open as Array<{ ref: string }>) counts.set(f.ref, (counts.get(f.ref) ?? 0) + 1);
    await this.flows.update({ findingsCount: 0 }, { where: { systemCode }, transaction: tx });
    for (const [ref, count] of counts) {
      const [method, path] = ref.split(' ');
      if (!path) continue;
      await this.flows.update({ findingsCount: count }, { where: { systemCode, httpMethod: method, path }, transaction: tx });
    }
  }

  async listFlows(query: FlowsListQueryDto) {
    const result = await this.flows.findAndCountAll({
      where: buildFlowsWhere(query),
      // El riesgo se ordena por significado, no por alfabeto (MEDIUM > LOW > HIGH > CRITICAL sería mentira).
      order: [
        [literal(`CASE risk WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END`), 'ASC'],
        ['systemCode', 'ASC'],
        ['module', 'ASC'],
        ['path', 'ASC'],
        ['httpMethod', 'ASC'],
      ],
      limit: query.limit,
      offset: toOffset(query),
    } as FindAndCountOptions);
    return { rows: result.rows, meta: buildPaginationMeta(query, result.count) };
  }

  findFlowsByModule(systemCode: string, module: string): Promise<SystemFlowCatalogModel[]> {
    return this.flows.findAll({
      where: { systemCode, module },
      order: [
        ['path', 'ASC'],
        ['httpMethod', 'ASC'],
      ],
    });
  }

  findFlow(flowId: string): Promise<SystemFlowCatalogModel | null> {
    return this.flows.findOne({ where: { flowId } });
  }

  findingsForRef(systemCode: string, ref: string): Promise<SystemFlowFindingModel[]> {
    return this.findings.findAll({ where: { systemCode, ref }, order: [['severity', 'DESC']] });
  }

  async summary() {
    const [byRisk, byVerification, byFreshness, bySystem, publicWrites, untestedCritical, openFindings] = await Promise.all([
      this.flows.count({ group: ['risk'] }),
      this.flows.count({ group: ['verification'] }),
      this.flows.count({ group: ['freshness'] }),
      this.flows.count({ group: ['systemCode'] }),
      this.flows.count({ where: { isPublic: true, kind: { [Op.ne]: 'READ' } } }),
      this.flows.count({ where: { risk: { [Op.in]: ['HIGH', 'CRITICAL'] }, testStatus: 'UNTESTED' } }),
      this.findings.count({ where: { status: 'open' }, group: ['severity'] }),
    ]);
    return { byRisk, byVerification, byFreshness, bySystem, publicWrites, untestedCritical, openFindings, total: await this.flows.count() };
  }

  async modules(): Promise<Array<{ systemCode: string; module: string; count: number }>> {
    const rows = await this.flows.count({ group: ['systemCode', 'module'] });
    return (rows as unknown as Array<{ systemCode: string; module: string; count: number }>).sort((a, b) =>
      `${a.systemCode}/${a.module}`.localeCompare(`${b.systemCode}/${b.module}`),
    );
  }

  async listScreens(query: ScreensListQueryDto) {
    const where: Record<string, unknown> = {};
    if (query.clientCode) where.clientCode = query.clientCode;
    if (query.q) where[Op.or as unknown as string] = [{ route: like(query.q) }, { navLabel: like(query.q) }];
    const result = await this.screens.findAndCountAll({
      where,
      order: [
        ['clientCode', 'ASC'],
        ['route', 'ASC'],
      ],
      limit: query.limit,
      offset: toOffset(query),
    } as FindAndCountOptions);
    return { rows: result.rows, meta: buildPaginationMeta(query, result.count) };
  }

  async listFindings(query: FindingsListQueryDto) {
    const where: Record<string, unknown> = {};
    if (query.systemCode) where.systemCode = query.systemCode;
    if (query.kind) where.kind = query.kind;
    if (query.severity) where.severity = query.severity;
    where.status = query.status ?? 'open';
    if (query.q) where[Op.or as unknown as string] = [{ ref: like(query.q) }, { summary: like(query.q) }, { module: like(query.q) }];
    const result = await this.findings.findAndCountAll({
      where,
      order: [
        [literal(`CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END`), 'ASC'],
        ['systemCode', 'ASC'],
        ['kind', 'ASC'],
        ['ref', 'ASC'],
      ],
      limit: query.limit,
      offset: toOffset(query),
    } as FindAndCountOptions);
    return { rows: result.rows, meta: buildPaginationMeta(query, result.count) };
  }

  latestImports(): Promise<SystemFlowImportModel[]> {
    return this.imports.findAll({ order: [['createdAtValue', 'DESC']], limit: 30 });
  }
}
