import { NotFoundException } from '@nestjs/common';
import { clean, id, intValue, iso, jsonValue, nullableText, parsePage, Query, Row } from './portal-format.util.js';
import { NOW_SEED } from './portal-report-definitions.js';
import { PortalQueryBase } from './portal-query.base.js';

/**
 * Operación del portal interno: alertas (issues de calidad) y ejecuciones de jobs.
 *
 * Extraído de `internal-portal.service.ts` (Fase 2.2 del plan 10/10) sin cambios de comportamiento.
 */
export class PortalOperationsService extends PortalQueryBase {
  async listAlerts(query: Query) {
    const page = parsePage(query);
    const q = clean(query.q, '');
    const rows = await this.queryRows(
      `SELECT i._id, i.target_table, i.target_record_id, i.issue_status, i.detected_at, i.resolved_at, i.resolution_notes,
              r.rule_code, r.rule_name, r.severity
         FROM data_quality_issues i
         LEFT JOIN data_quality_rules r ON r._id = i.quality_rule_id
        WHERE (:q = '' OR i.target_table ILIKE :like OR COALESCE(r.rule_name,'') ILIKE :like OR COALESCE(r.rule_code,'') ILIKE :like)
        ORDER BY i.detected_at DESC NULLS LAST, i._id DESC
        LIMIT :limit OFFSET :offset`,
      { q, like: `%${q}%`, limit: page.limit, offset: page.offset },
    );
    const total = await this.queryRows<{ count: string }>(`SELECT COUNT(*)::text AS count FROM data_quality_issues`);
    const items = rows.map((row) => ({
      alertId: `dq:${id(row._id)}`,
      title: clean(row.rule_name, `Issue de calidad ${id(row._id)}`),
      description: clean(row.resolution_notes, `Registro ${clean(row.target_record_id)} en ${clean(row.target_table)} requiere revisión.`),
      severity: clean(row.severity, 'medium').toUpperCase(),
      status: clean(row.issue_status, 'open').toUpperCase(),
      source: clean(row.rule_code, 'data_quality'),
      resourceType: 'data_quality_issue',
      resourceId: id(row._id),
      createdAt: iso(row.detected_at) ?? NOW_SEED,
      acknowledgedAt: clean(row.issue_status, '').toLowerCase() === 'acknowledged' ? (iso(row.resolved_at) ?? NOW_SEED) : null,
      acknowledgedBy: clean(row.issue_status, '').toLowerCase() === 'acknowledged' ? 'internal_portal' : null,
      metadata: { targetTable: clean(row.target_table), targetRecordId: clean(row.target_record_id) },
    }));
    return {
      items,
      meta: {
        page: page.page,
        limit: page.limit,
        total: intValue(total[0]?.count),
        totalPages: Math.max(1, Math.ceil(intValue(total[0]?.count) / page.limit)),
      },
    };
  }

  async acknowledgeAlert(alertId: string) {
    const rawId = decodeURIComponent(alertId).replace(/^dq:/, '');
    await this.sequelize.query(
      `UPDATE data_quality_issues SET issue_status = 'acknowledged', resolved_at = NOW(), resolution_notes = COALESCE(resolution_notes, '') || ' | Acknowledged from internal portal.' WHERE _id::text = :id`,
      { replacements: { id: rawId } },
    );
    return { alertId, status: 'ACKNOWLEDGED', message: 'Alerta reconocida correctamente.' };
  }

  async listJobs(query: Query) {
    const page = parsePage(query);
    const q = clean(query.q, '');
    const rows = await this.queryRows(
      `SELECT _id, job_code, status, started_at, completed_at, input_json, result_json, error_message, triggered_by_type, triggered_by_id, _created_at
         FROM system_job_runs
        WHERE (:q = '' OR job_code ILIKE :like OR status ILIKE :like)
        ORDER BY COALESCE(started_at, _created_at) DESC, _id DESC
        LIMIT :limit OFFSET :offset`,
      { q, like: `%${q}%`, limit: page.limit, offset: page.offset },
    );
    const total = await this.queryRows<{ count: string }>(`SELECT COUNT(*)::text AS count FROM system_job_runs`);
    const items = rows.map((row) => this.mapJob(row));
    return {
      items,
      meta: {
        page: page.page,
        limit: page.limit,
        total: intValue(total[0]?.count),
        totalPages: Math.max(1, Math.ceil(intValue(total[0]?.count) / page.limit)),
      },
    };
  }

  async getJob(jobRunId: string) {
    const rows = await this.queryRows(
      `SELECT _id, job_code, status, started_at, completed_at, input_json, result_json, error_message, triggered_by_type, triggered_by_id, _created_at FROM system_job_runs WHERE _id::text = :id OR job_code = :id LIMIT 1`,
      { id: decodeURIComponent(jobRunId) },
    );
    if (!rows[0]) throw new NotFoundException('JOB_RUN_NOT_FOUND');
    const job = this.mapJob(rows[0]);
    return {
      ...job,
      requestId: `job:${job.jobRunId}`,
      payloadSummary: jsonValue(rows[0].input_json),
      resultSummary: jsonValue(rows[0].result_json),
      errorCode: rows[0].error_message ? 'JOB_ERROR' : null,
      errorMessage: nullableText(rows[0].error_message),
      logs: [
        {
          timestamp: job.createdAt,
          level: 'info',
          message: `Job ${job.jobKey} registrado con estado ${job.status}.`,
          details: { triggeredBy: rows[0].triggered_by_id },
        },
      ],
    };
  }

  async retryJob(jobRunId: string) {
    const job = await this.getJob(jobRunId);
    return {
      jobRunId: job.jobRunId,
      status: 'QUEUED_FOR_RETRY',
      message: 'Reintento solicitado. El job queda registrado para ejecución controlada.',
    };
  }

  async cancelJob(jobRunId: string) {
    const job = await this.getJob(jobRunId);
    return {
      jobRunId: job.jobRunId,
      status: 'CANCEL_REQUESTED',
      message: 'Cancelación solicitada. Si el job ya terminó, no se altera evidencia histórica.',
    };
  }

  private mapJob(row: Row) {
    const started = iso(row.started_at);
    const finished = iso(row.completed_at);
    const duration = started && finished ? Math.max(0, new Date(finished).getTime() - new Date(started).getTime()) : null;
    return {
      jobRunId: id(row._id),
      jobKey: clean(row.job_code),
      name: clean(row.job_code).replace(/_/g, ' '),
      queue: clean(row.triggered_by_type, 'system'),
      status: clean(row.status, 'unknown').toUpperCase(),
      priority: 'normal',
      attempts: 1,
      durationMs: duration,
      startedAt: started,
      finishedAt: finished,
      createdAt: iso(row._created_at) ?? NOW_SEED,
      metadata: { triggeredBy: nullableText(row.triggered_by_id), hasError: Boolean(row.error_message) },
    };
  }
}
