/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza ofrece a operaciones una vista gobernada del negocio sin acceso directo a tablas sensibles.
 * @system compone consultas read-only, reportes, glosario, linaje y búsqueda para el portal administrativo.
 */
import { NotFoundException } from '@nestjs/common';
import { clean, id, intValue, iso, jsonValue, nullableText, parsePage, Query, Row } from './portal-format.util.js';
import { PortalQueryBase } from './portal-query.base.js';
import { PortalScope, scopeReplacements, tenantPredicate } from './portal-scope.util.js';

/**
 * Operación del portal interno: alertas (issues de calidad) y ejecuciones de jobs.
 *
 * Las dos tablas que consulta —`data_quality_issues` y `system_job_runs`— llevan `_tenant_id`, así
 * que **todas** sus consultas están acotadas por `PortalScope` (ATLAS-SEC-009). Antes no lo estaban:
 * un operador de un tenant leía las corridas de job de otro y podía reconocer alertas ajenas.
 *
 * Este servicio es de LECTURA. Las acciones que ejecutan trabajo de verdad (reintentar un job,
 * recalcular calidad de datos) viven en `runtime-jobs`, que es quien tiene el planificador, el lock
 * de líder y el registro de corridas. Ver la nota de `retryJob`/`cancelJob` en el controller.
 */
export class PortalOperationsService extends PortalQueryBase {
  async listAlerts(scope: PortalScope, query: Query) {
    const page = parsePage(query);
    const q = clean(query.q, '');
    const scoped = tenantPredicate(scope, 'i');
    const filters = { q, like: `%${q}%`, ...scopeReplacements(scope) };
    const textMatch = `(:q = '' OR i.target_table ILIKE :like OR COALESCE(r.rule_name,'') ILIKE :like OR COALESCE(r.rule_code,'') ILIKE :like)`;

    const rows = await this.queryRows(
      `SELECT i._id, i.target_table, i.target_record_id, i.issue_status, i.detected_at, i.resolved_at, i.resolution_notes,
              r.rule_code, r.rule_name, r.severity
         FROM data_quality_issues i
         LEFT JOIN data_quality_rules r ON r._id = i.quality_rule_id
        WHERE ${scoped} AND ${textMatch}
        ORDER BY i.detected_at DESC NULLS LAST, i._id DESC
        LIMIT :limit OFFSET :offset`,
      { ...filters, limit: page.limit, offset: page.offset },
    );

    // El total se calcula con EXACTAMENTE el mismo `WHERE` que la página. Antes contaba la tabla
    // entera: al filtrar por texto, `totalPages` prometía páginas que no existían.
    const total = await this.queryRows<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM data_quality_issues i
         LEFT JOIN data_quality_rules r ON r._id = i.quality_rule_id
        WHERE ${scoped} AND ${textMatch}`,
      filters,
    );

    const items = rows.map((row) => ({
      alertId: `dq:${id(row._id)}`,
      title: clean(row.rule_name, `Issue de calidad ${id(row._id)}`),
      description: clean(row.resolution_notes, `Registro ${clean(row.target_record_id)} en ${clean(row.target_table)} requiere revisión.`),
      severity: clean(row.severity, 'medium').toUpperCase(),
      status: clean(row.issue_status, 'open').toUpperCase(),
      source: clean(row.rule_code, 'data_quality'),
      resourceType: 'data_quality_issue',
      resourceId: id(row._id),
      // `null` cuando la fila no tiene fecha: una marca temporal inventada en un panel de operación
      // es peor que un hueco visible (antes se rellenaba con la constante NOW_SEED).
      createdAt: iso(row.detected_at),
      acknowledgedAt: clean(row.issue_status, '').toLowerCase() === 'acknowledged' ? iso(row.resolved_at) : null,
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

  /**
   * El `UPDATE` lleva el tenant en su propio `WHERE`, no en una comprobación previa: así no existe
   * ventana entre "verifico que es mío" y "escribo". Si no afecta ninguna fila, se responde 404 —
   * indistinguible de un id inexistente, para que el actor no pueda sondear ids de otros tenants.
   */
  async acknowledgeAlert(scope: PortalScope, alertId: string) {
    const rawId = decodeURIComponent(alertId).replace(/^dq:/, '');
    const updated = await this.queryRows<{ _id: string }>(
      `UPDATE data_quality_issues i
          SET issue_status = 'acknowledged',
              resolved_at = NOW(),
              resolution_notes = COALESCE(i.resolution_notes, '') || ' | Acknowledged from internal portal.'
        WHERE i._id::text = :id AND ${tenantPredicate(scope, 'i')}
        RETURNING i._id`,
      { id: rawId, ...scopeReplacements(scope) },
    );

    if (updated.length === 0) throw new NotFoundException('DATA_QUALITY_ISSUE_NOT_FOUND');

    return { alertId, status: 'ACKNOWLEDGED', message: 'Alerta reconocida correctamente.' };
  }

  async listJobs(scope: PortalScope, query: Query) {
    const page = parsePage(query);
    const q = clean(query.q, '');
    const scoped = tenantPredicate(scope, 'j');
    const filters = { q, like: `%${q}%`, ...scopeReplacements(scope) };
    const textMatch = `(:q = '' OR j.job_code ILIKE :like OR j.status ILIKE :like)`;

    const rows = await this.queryRows(
      `SELECT j._id, j.job_code, j.status, j.started_at, j.completed_at, j.input_json, j.result_json,
              j.error_message, j.triggered_by_type, j.triggered_by_id, j._created_at
         FROM system_job_runs j
        WHERE ${scoped} AND ${textMatch}
        ORDER BY COALESCE(j.started_at, j._created_at) DESC, j._id DESC
        LIMIT :limit OFFSET :offset`,
      { ...filters, limit: page.limit, offset: page.offset },
    );

    const total = await this.queryRows<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM system_job_runs j WHERE ${scoped} AND ${textMatch}`,
      filters,
    );

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

  async getJob(scope: PortalScope, jobRunId: string) {
    const rows = await this.queryRows(
      `SELECT j._id, j.job_code, j.status, j.started_at, j.completed_at, j.input_json, j.result_json,
              j.error_message, j.triggered_by_type, j.triggered_by_id, j._created_at
         FROM system_job_runs j
        WHERE (j._id::text = :id OR j.job_code = :id) AND ${tenantPredicate(scope, 'j')}
        LIMIT 1`,
      { id: decodeURIComponent(jobRunId), ...scopeReplacements(scope) },
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
      durationMs: duration,
      startedAt: started,
      finishedAt: finished,
      createdAt: iso(row._created_at),
      metadata: { triggeredBy: nullableText(row.triggered_by_id), hasError: Boolean(row.error_message) },
    };
  }
}
