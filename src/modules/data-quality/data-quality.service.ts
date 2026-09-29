/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza evita decisiones crediticias basadas en datos incompletos, incoherentes o sin linaje.
 * @system administra reglas, ejecuciones y hallazgos de calidad consultables por operaciones.
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import {
  DATA_QUALITY_ACKNOWLEDGED_STATUS,
  isClosedIssueStatus,
  normalizeIssueStatus,
} from '../../common/utils/data-quality-issue-status.util.js';
import { DataQualityRepository, StatusCount } from './data-quality.repository.js';
import { DataQualityQueryDto, DataQualityIssueParamsDto, ResolveDataQualityIssueDto } from './data-quality.schemas.js';

@Injectable()
export class DataQualityService {
  constructor(
    private readonly repository: DataQualityRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async listIssues(tenantId: string, query: DataQualityQueryDto) {
    const result = await this.repository.findIssues(tenantId, query);
    const ruleIds = [...new Set(result.rows.map((issue) => issue.qualityRuleId).filter((id): id is string => id !== null))];
    const rules = await this.repository.findRulesByIds(ruleIds);
    const ruleById = new Map(rules.map((rule) => [String(rule.id), rule]));
    return {
      items: result.rows.map((issue) => {
        const rule = issue.qualityRuleId ? ruleById.get(String(issue.qualityRuleId)) : undefined;
        const acknowledged = normalizeIssueStatus(issue.issueStatus) === DATA_QUALITY_ACKNOWLEDGED_STATUS;
        return {
          issueId: String(issue.id),
          // En mayúsculas, como las opciones del filtro (la siembra guarda `critical`).
          severity: rule?.severity ? rule.severity.toUpperCase() : null,
          entityType: issue.targetTable,
          entityId: issue.targetRecordId,
          issueCode: rule?.ruleCode ?? null,
          ruleName: rule?.ruleName ?? null,
          status: issue.issueStatus,
          detectedAt: issue.detectedAt?.toISOString() ?? null,
          // Una reconocida NO está resuelta aunque el antiguo «Reconocer» le rellenara `resolved_at`.
          resolvedAt: acknowledged ? null : (issue.resolvedAt?.toISOString() ?? null),
          resolutionNotes: issue.resolutionNotes ?? null,
        };
      }),
      meta: result.meta,
      summary: summaryFrom(result.meta.total, result.countsByStatus),
    };
  }

  /**
   * Tres resoluciones, todas con motivo y notas en la auditoría:
   *
   * - `resolved` / `ignored` cierran la incidencia (fijan `resolved_at`).
   * - `acknowledged` la reconoce: sigue pendiente y se puede cerrar después. Reconocer otra vez una
   *   ya reconocida es idempotente (200, sin escribir ni duplicar notas).
   *
   * Una incidencia cerrada responde 409. La reconocida por el antiguo `POST /internal/alerts/:id/acknowledge`
   * tiene `resolved_at` relleno y aun así se puede cerrar: antes ese 409 la dejaba bloqueada para siempre.
   */
  async resolveIssue(input: {
    tenantId: string;
    params: DataQualityIssueParamsDto;
    body: ResolveDataQualityIssueDto;
    currentUser: AuthenticatedUser;
    idempotencyKey: string;
  }) {
    if (!input.idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    const now = new Date();
    return this.sequelize.transaction(async (transaction) => {
      const issue = await this.repository.findIssueById(input.tenantId, input.params.issueId);
      if (!issue) throw new NotFoundException('DATA_QUALITY_ISSUE_NOT_FOUND');
      const current = normalizeIssueStatus(issue.issueStatus);
      const wasAcknowledged = current === DATA_QUALITY_ACKNOWLEDGED_STATUS;
      if (isClosedIssueStatus(current) || (issue.resolvedAt && !wasAcknowledged)) {
        throw new ConflictException('DATA_QUALITY_ISSUE_ALREADY_RESOLVED');
      }
      const acknowledging = input.body.resolution === DATA_QUALITY_ACKNOWLEDGED_STATUS;
      if (acknowledging && wasAcknowledged) return { issueId: input.params.issueId, status: input.body.resolution };

      const note = `${input.body.reasonCode}: ${input.body.notes}`;
      await this.repository.resolveIssue(
        issue,
        {
          status: input.body.resolution,
          // Al cerrar una reconocida se conserva la nota del reconocimiento: es parte del rastro.
          notes: wasAcknowledged && issue.resolutionNotes ? `${issue.resolutionNotes}\n${note}` : note,
          resolvedAt: acknowledging ? issue.resolvedAt : now,
        },
        { transaction },
      );
      await this.repository.createAudit(
        {
          tenantId: input.tenantId,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actionCode: acknowledging ? 'data_quality.issue.acknowledge' : 'data_quality.issue.resolve',
          targetId: input.params.issueId,
          payload: { resolution: input.body.resolution, reasonCode: input.body.reasonCode, previousStatus: current },
          happenedAt: now,
        },
        { transaction },
      );
      await this.repository.createDataChange(
        {
          tenantId: input.tenantId,
          issueId: input.params.issueId,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          reason: input.body.reasonCode,
          happenedAt: now,
          changeType: acknowledging ? 'acknowledge' : 'resolve',
        },
        { transaction },
      );
      return { issueId: input.params.issueId, status: input.body.resolution };
    });
  }
}

/**
 * Tarjetas de la bandeja, con el mismo filtro que la lista: pendientes (sin revisar + reconocidas),
 * reconocidas y cerradas. «Pendiente» es la misma definición que el semáforo de salida.
 */
function summaryFrom(total: number, counts: StatusCount[]) {
  const byStatus: Record<string, number> = {};
  for (const row of counts) byStatus[row.status] = (byStatus[row.status] ?? 0) + row.count;
  const closed = counts.filter((row) => isClosedIssueStatus(row.status)).reduce((sum, row) => sum + row.count, 0);
  const acknowledged = byStatus[DATA_QUALITY_ACKNOWLEDGED_STATUS] ?? 0;
  return { total, pending: total - closed, unreviewed: total - closed - acknowledged, acknowledged, closed, byStatus };
}
