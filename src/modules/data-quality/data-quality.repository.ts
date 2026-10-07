/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza evita decisiones crediticias basadas en datos incompletos, incoherentes o sin linaje.
 * @system administra reglas, ejecuciones y hallazgos de calidad consultables por operaciones.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { col, fn, FindAndCountOptions, FindOptions, Op, Transaction, where as sqlWhere, WhereOptions } from 'sequelize';
import { containsLikePattern } from '../../common/utils/strings/like-pattern.util.js';
import { buildPaginationMeta, toOffset } from '../../common/utils/pagination/pagination.util.js';
import { decodeCursor, encodeCursor } from '../../common/utils/pagination/cursor-pagination.util.js';
import { DataChangeLogModel, DataQualityIssueModel, DataQualityRuleModel, OperationalAuditLogModel } from '../../database/models/index.js';
import { DataQualityQueryDto } from './data-quality.schemas.js';

type IssueFilters = { q?: string; status?: string; severity?: string; entityType?: string; customerId?: string };
export type StatusCount = { status: string; count: number };

@Injectable()
export class DataQualityRepository {
  constructor(
    @InjectModel(DataQualityIssueModel) private readonly issueModel: typeof DataQualityIssueModel,
    @InjectModel(DataQualityRuleModel) private readonly ruleModel: typeof DataQualityRuleModel,
    @InjectModel(OperationalAuditLogModel) private readonly auditModel: typeof OperationalAuditLogModel,
    @InjectModel(DataChangeLogModel) private readonly dataChangeLogModel: typeof DataChangeLogModel,
  ) {}

  /**
   * `severity` vive en `data_quality_rules` (via `quality_rule_id`), no en `data_quality_issues`
   * — no hay un `severity` propio en la fila del issue. Como el proyecto no usa asociaciones de
   * sequelize-typescript (patrón consistente en todo el repo, ver p. ej. `risk.service.ts`
   * resolviendo relaciones con queries separadas en vez de `include`), resolvemos el filtro con
   * una sub-consulta: primero los ids de reglas con esa severidad, luego filtramos issues por
   * `qualityRuleId IN (...)`. Si no hay ninguna regla con esa severidad, el resultado es vacío
   * sin tocar `issueModel` (antes: el parámetro `severity` de la query se ignoraba en silencio).
   *
   * La comparación es en MAYÚSCULAS a los dos lados: el portal ofrece `LOW…CRITICAL` y la siembra
   * guarda `critical`; comparando exacto el filtro devolvía 0 filas con datos que sí existían.
   */
  private async severityRuleIds(severity: string | undefined): Promise<string[] | null> {
    if (!severity) return null;
    const rules = await this.ruleModel.findAll({
      where: sqlWhere(fn('UPPER', col('severity')), severity.trim().toUpperCase()),
      attributes: ['id'],
    } as FindOptions);
    return rules.map((rule) => String(rule.id));
  }

  /** Reglas cuyo código contiene el texto buscado: el issue no guarda el código, sólo `quality_rule_id`. */
  private async ruleIdsByCode(pattern: string): Promise<string[]> {
    const rules = await this.ruleModel.findAll({ where: { ruleCode: { [Op.iLike]: pattern } }, attributes: ['id'] } as FindOptions);
    return rules.map((rule) => String(rule.id));
  }

  /**
   * El `WHERE` común a la lista, su `summary` y la variante por cursor. Devuelve `null` cuando el
   * filtro de severidad no casa con ninguna regla (el resultado es vacío sin consultar issues).
   *
   * - `status` no distingue mayúsculas y trata la fila sin estado como `open`, igual que la bandeja.
   * - `q` busca «contiene» (con `%` y `_` escapados) en la tabla del registro, en las notas de la
   *   resolución y en el código de la regla. Antes el buscador del portal mandaba `entityType`, que
   *   es igualdad exacta con la tabla: escribir «customer» no encontraba `customer.customers`.
   */
  private async issueConditions(tenantId: string, query: IssueFilters): Promise<WhereOptions[] | null> {
    const ruleIds = await this.severityRuleIds(query.severity);
    if (ruleIds && ruleIds.length === 0) return null;
    const conditions: WhereOptions[] = [{ tenantId }];
    if (query.status)
      conditions.push(sqlWhere(fn('LOWER', fn('COALESCE', col('issue_status'), 'open')), query.status.trim().toLowerCase()));
    if (query.entityType) conditions.push({ targetTable: query.entityType });
    if (query.customerId) conditions.push({ targetRecordId: query.customerId });
    if (ruleIds) conditions.push({ qualityRuleId: { [Op.in]: ruleIds } });
    const q = query.q?.trim();
    if (q) {
      const pattern = containsLikePattern(q);
      const byCode = await this.ruleIdsByCode(pattern);
      conditions.push({
        [Op.or]: [
          { targetTable: { [Op.iLike]: pattern } },
          { resolutionNotes: { [Op.iLike]: pattern } },
          ...(byCode.length > 0 ? [{ qualityRuleId: { [Op.in]: byCode } }] : []),
        ],
      });
    }
    return conditions;
  }

  findRulesByIds(ruleIds: string[]): Promise<DataQualityRuleModel[]> {
    if (ruleIds.length === 0) return Promise.resolve([]);
    return this.ruleModel.findAll({ where: { id: { [Op.in]: ruleIds } } } as FindOptions);
  }

  async findIssues(tenantId: string, query: DataQualityQueryDto) {
    const conditions = await this.issueConditions(tenantId, query);
    if (!conditions) {
      return { rows: [], meta: buildPaginationMeta(query, 0), countsByStatus: [] as StatusCount[] };
    }
    const where: WhereOptions = { [Op.and]: conditions };
    const statusExpression = fn('LOWER', fn('COALESCE', col('issue_status'), 'open'));
    const [result, countsByStatus] = await Promise.all([
      this.issueModel.findAndCountAll({
        where,
        order: [
          ['detectedAt', 'DESC'],
          ['id', 'DESC'],
        ],
        limit: query.limit,
        offset: toOffset(query),
      } as FindAndCountOptions),
      // Con el MISMO `WHERE`: las tarjetas «Abiertos/Cerrados» sumaban sólo las 20 filas de la página.
      this.issueModel.findAll({
        where,
        attributes: [
          [statusExpression, 'status'],
          [fn('COUNT', col('_id')), 'count'],
        ],
        group: [statusExpression],
        raw: true,
      } as FindOptions) as unknown as Promise<Array<{ status: string; count: string | number }>>,
    ]);
    return {
      rows: result.rows,
      meta: buildPaginationMeta(query, result.count),
      countsByStatus: countsByStatus.map((row) => ({ status: String(row.status), count: Number(row.count) })),
    };
  }

  /**
   * ATLAS-P10-031 (cierra parcialmente ATLAS-PEND-102 / RC-06 de AUDITORIA_ATLAS_BACKEND_10_10.md):
   * variante por cursor de `findIssues()`, siguiendo el mismo patrón ya aplicado en
   * `events.repository.ts::listWithCursor` (ver `cursor-pagination.util.ts` para el porqué).
   * `findIssues()` se mantiene sin cambios por compatibilidad con quien ya la consuma; esta es
   * la variante recomendada para listados nuevos del panel de operaciones/calidad de datos.
   */
  async findIssuesWithCursor(
    tenantId: string,
    query: IssueFilters & { limit: number; cursor?: string },
  ): Promise<{ items: DataQualityIssueModel[]; nextCursor: string | null }> {
    const conditions = await this.issueConditions(tenantId, query);
    if (!conditions) {
      return { items: [], nextCursor: null };
    }

    const cursorKey = decodeCursor(query.cursor);
    if (cursorKey) {
      // Tupla (detected_at, id) — misma técnica que events.repository.ts::listWithCursor.
      // detected_at puede repetirse entre filas (varias incidencias detectadas en el mismo
      // instante por el mismo job de calidad de datos), por eso el desempate por `id` es
      // obligatorio para que el cursor sea determinístico y no salte/repita filas.
      conditions.push({
        [Op.or]: [
          { detectedAt: { [Op.lt]: new Date(cursorKey.createdAt) } },
          { [Op.and]: [{ detectedAt: new Date(cursorKey.createdAt) }, { id: { [Op.lt]: cursorKey.id } }] },
        ],
      });
    }

    const rowsPlusOne = await this.issueModel.findAll({
      where: { [Op.and]: conditions },
      order: [
        ['detectedAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit: query.limit + 1,
    } as FindOptions);

    const hasMore = rowsPlusOne.length > query.limit;
    const items = hasMore ? rowsPlusOne.slice(0, query.limit) : rowsPlusOne;
    const last = items[items.length - 1];
    const nextCursor = hasMore && last?.detectedAt ? encodeCursor({ createdAt: last.detectedAt.toISOString(), id: last.id }) : null;

    return { items, nextCursor };
  }

  findIssueById(tenantId: string, issueId: string, options: { transaction?: Transaction } = {}): Promise<DataQualityIssueModel | null> {
    // Dentro de una transacción se toma FOR UPDATE: dos resoluciones simultáneas se serializan y la
    // segunda ve la incidencia ya cerrada (409) en vez de pisar estado y notas de la primera.
    return this.issueModel.findOne({
      where: { tenantId, id: issueId },
      transaction: options.transaction,
      lock: Boolean(options.transaction),
    } as FindOptions);
  }

  async resolveIssue(
    issue: DataQualityIssueModel,
    values: { status: string; notes: string; resolvedAt: Date | null },
    options: { transaction?: Transaction },
  ): Promise<DataQualityIssueModel> {
    issue.issueStatus = values.status;
    issue.resolvedAt = values.resolvedAt;
    issue.resolutionNotes = values.notes;
    return issue.save({ transaction: options.transaction });
  }

  createAudit(
    values: {
      tenantId: string;
      actorType: string;
      actorInternalUserId: string | null;
      actionCode: string;
      targetId: string;
      payload: Record<string, unknown>;
      happenedAt: Date;
    },
    options: { transaction?: Transaction },
  ): Promise<OperationalAuditLogModel> {
    return this.auditModel.create(
      {
        tenantId: values.tenantId,
        actorType: values.actorType,
        actorInternalUserId: values.actorInternalUserId,
        actorPlatformUserId: null,
        actionCode: values.actionCode,
        targetType: 'data_quality_issue',
        targetId: values.targetId,
        ipAddress: null,
        userAgent: null,
        payloadJson: values.payload,
        occurredAt: values.happenedAt,
        createdAtValue: values.happenedAt,
      },
      { transaction: options.transaction },
    );
  }

  createDataChange(
    values: {
      tenantId: string;
      issueId: string;
      actorType: string;
      actorInternalUserId: string | null;
      reason: string;
      happenedAt: Date;
      changeType?: string;
    },
    options: { transaction?: Transaction },
  ): Promise<DataChangeLogModel> {
    return this.dataChangeLogModel.create(
      {
        tenantId: values.tenantId,
        tableName: 'data_quality_issues',
        recordId: values.issueId,
        changeType: values.changeType ?? 'resolve',
        changedByType: values.actorType,
        changedByInternalUserId: values.actorInternalUserId,
        changedByPlatformUserId: null,
        oldValuesHash: null,
        newValuesHash: null,
        changeReason: values.reason,
        changedAt: values.happenedAt,
        createdAtValue: values.happenedAt,
      },
      { transaction: options.transaction },
    );
  }
}
