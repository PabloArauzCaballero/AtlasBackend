import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindAndCountOptions, FindOptions, Op, Transaction, WhereOptions } from 'sequelize';
import { buildPaginationMeta, toOffset } from '../../common/utils/pagination/pagination.util.js';
import { decodeCursor, encodeCursor } from '../../common/utils/pagination/cursor-pagination.util.js';
import { DataChangeLogModel, DataQualityIssueModel, DataQualityRuleModel, OperationalAuditLogModel } from '../../database/models/index.js';
import { DataQualityQueryDto } from './data-quality.schemas.js';

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
   */
  private async severityRuleIds(severity: string | undefined): Promise<string[] | null> {
    if (!severity) return null;
    const rules = await this.ruleModel.findAll({ where: { severity }, attributes: ['id'] } as FindOptions);
    return rules.map((rule) => String(rule.id));
  }

  findRulesByIds(ruleIds: string[]): Promise<DataQualityRuleModel[]> {
    if (ruleIds.length === 0) return Promise.resolve([]);
    return this.ruleModel.findAll({ where: { id: { [Op.in]: ruleIds } } } as FindOptions);
  }

  async findIssues(tenantId: string, query: DataQualityQueryDto) {
    const ruleIds = await this.severityRuleIds(query.severity);
    if (ruleIds && ruleIds.length === 0) {
      return { rows: [], meta: buildPaginationMeta(query, 0) };
    }
    const where: WhereOptions = {
      tenantId,
      ...(query.status ? { issueStatus: query.status } : {}),
      ...(query.entityType ? { targetTable: query.entityType } : {}),
      ...(query.customerId ? { targetRecordId: query.customerId } : {}),
      ...(ruleIds ? { qualityRuleId: { [Op.in]: ruleIds } } : {}),
    };
    const result = await this.issueModel.findAndCountAll({
      where,
      order: [
        ['detectedAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit: query.limit,
      offset: toOffset(query),
    } as FindAndCountOptions);
    return { rows: result.rows, meta: buildPaginationMeta(query, result.count) };
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
    query: { status?: string; severity?: string; entityType?: string; customerId?: string; limit: number; cursor?: string },
  ): Promise<{ items: DataQualityIssueModel[]; nextCursor: string | null }> {
    const ruleIds = await this.severityRuleIds(query.severity);
    if (ruleIds && ruleIds.length === 0) {
      return { items: [], nextCursor: null };
    }
    const where: Record<string, unknown> = {
      tenantId,
      ...(query.status ? { issueStatus: query.status } : {}),
      ...(query.entityType ? { targetTable: query.entityType } : {}),
      ...(query.customerId ? { targetRecordId: query.customerId } : {}),
      ...(ruleIds ? { qualityRuleId: { [Op.in]: ruleIds } } : {}),
    };

    const cursorKey = decodeCursor(query.cursor);
    if (cursorKey) {
      // Tupla (detected_at, id) — misma técnica que events.repository.ts::listWithCursor.
      // detected_at puede repetirse entre filas (varias incidencias detectadas en el mismo
      // instante por el mismo job de calidad de datos), por eso el desempate por `id` es
      // obligatorio para que el cursor sea determinístico y no salte/repita filas.
      where[Op.and as unknown as string] = [
        {
          [Op.or]: [
            { detectedAt: { [Op.lt]: new Date(cursorKey.createdAt) } },
            { [Op.and]: [{ detectedAt: new Date(cursorKey.createdAt) }, { id: { [Op.lt]: cursorKey.id } }] },
          ],
        },
      ];
    }

    const rowsPlusOne = await this.issueModel.findAll({
      where: where as never,
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

  findIssueById(tenantId: string, issueId: string): Promise<DataQualityIssueModel | null> {
    return this.issueModel.findOne({ where: { tenantId, id: issueId } } as FindOptions);
  }

  async resolveIssue(
    issue: DataQualityIssueModel,
    values: { status: string; notes: string; resolvedAt: Date },
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
    values: { tenantId: string; issueId: string; actorType: string; actorInternalUserId: string | null; reason: string; happenedAt: Date },
    options: { transaction?: Transaction },
  ): Promise<DataChangeLogModel> {
    return this.dataChangeLogModel.create(
      {
        tenantId: values.tenantId,
        tableName: 'data_quality_issues',
        recordId: values.issueId,
        changeType: 'resolve',
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
