/**
 * @file Repositorio: encapsula el acceso a datos de Flujos (Flow Intelligence).
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system carga el artefacto de `flows:derive` en las tablas `system_flow_*` y sirve consultas paginadas.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindAndCountOptions, literal, Op, QueryTypes, Transaction } from 'sequelize';
import { buildPaginationMeta, toOffset } from '../../common/utils/pagination/pagination.util.js';
import {
  SystemFlowCatalogModel,
  SystemFlowFindingModel,
  SystemFlowImportModel,
  SystemScreenCatalogModel,
} from '../../database/models/index.js';
import { FindingsListQueryDto, FlowsListQueryDto, ScreensListQueryDto } from './system-flows.schemas.js';
import { buildFlowsWhere, like } from './system-flows.where.util.js';
import { RouteRuns } from './system-flows.verification.util.js';
import { BUSINESS_FLOWS_SQL, RUNS_BY_ROUTE_SQL } from './system-flows.sql.constants.js';

type FlowRow = Omit<SystemFlowCatalogModel['dataValues'], 'id' | 'createdAtValue' | 'updatedAtValue'>;
type ScreenRow = Omit<SystemScreenCatalogModel['dataValues'], 'id' | 'createdAtValue' | 'updatedAtValue'>;
type FindingRow = Omit<SystemFlowFindingModel['dataValues'], 'id' | 'createdAtValue' | 'updatedAtValue' | 'status'>;

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

  /**
   * Corridas por ruta en `system_action_logs` dentro de la ventana. La plantilla se normaliza al
   * formato del catálogo en SQL para que el cruce sea un JOIN y no un bucle. Sólo lecturas agregadas:
   * ningún payload sale de aquí.
   */
  async runsByRoute(windowDays: number): Promise<Map<string, RouteRuns>> {
    const rows = await this.flows.sequelize!.query<{
      method: string;
      path: string;
      ok: string;
      failed: string;
      last_at: Date | null;
      last_status: number | null;
      statuses: Record<string, number>;
      correlation_sample: string[];
    }>(RUNS_BY_ROUTE_SQL, { type: QueryTypes.SELECT, replacements: { windowDays: String(windowDays) } });
    const out = new Map<string, RouteRuns>();
    for (const row of rows) {
      out.set(`${row.method} ${row.path}`, {
        ok: Number(row.ok),
        failed: Number(row.failed),
        lastAt: row.last_at ? new Date(row.last_at) : null,
        lastStatus: row.last_status,
        statuses: row.statuses ?? {},
        correlationSample: (row.correlation_sample ?? []).filter(Boolean),
      });
    }
    return out;
  }

  async flowsOfSystem(systemCode: string): Promise<SystemFlowCatalogModel[]> {
    return this.flows.findAll({
      where: { systemCode },
      attributes: ['id', 'flowId', 'httpMethod', 'path', 'controller', 'handler', 'analyzedCommit', 'verification', 'freshness'],
    });
  }

  async applyVerification(
    flowId: string,
    outcome: { verification: string; evidence: Record<string, unknown> },
    actor: string | null,
    tx: Transaction,
  ): Promise<void> {
    await this.flows.update(
      {
        verification: outcome.verification,
        verificationEvidenceJson: outcome.evidence,
        verifiedAt: new Date(),
        verifiedBy: actor,
        updatedAtValue: new Date(),
      },
      { where: { flowId }, transaction: tx },
    );
  }

  async applyFreshness(flowId: string, freshness: string, tx: Transaction): Promise<void> {
    await this.flows.update({ freshness, updatedAtValue: new Date() }, { where: { flowId }, transaction: tx });
  }

  /**
   * Los procesos de negocio del `workflow-catalog` cruzados con los flujos por (método, ruta).
   *
   * Es la mitad que el análisis del código no puede dar: `workflow_definitions` dice qué pasos
   * componen «alta de cuenta» o «recorrido hasta la decisión de crédito», y el catálogo dice qué
   * hace cada uno por dentro. Un paso cuyo endpoint no aparece en el catálogo sale con `flowId`
   * nulo: es un paso declarado sobre una ruta que ya no existe, y verlo es el punto.
   */
  async businessFlows(): Promise<Array<Record<string, unknown>>> {
    return this.flows.sequelize!.query(BUSINESS_FLOWS_SQL, { type: QueryTypes.SELECT });
  }

  latestImports(): Promise<SystemFlowImportModel[]> {
    return this.imports.findAll({ order: [['createdAtValue', 'DESC']], limit: 30 });
  }
}
