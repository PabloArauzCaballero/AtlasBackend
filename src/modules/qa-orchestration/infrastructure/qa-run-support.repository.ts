/**
 * @file Repositorio de persistencia: secretos, latido del worker y fixtures de una corrida QA.
 * @business Esta pieza guarda cifrado el único secreto que sobrevive a un reinicio (el runToken del
 *   mock) y publica que el worker está vivo de verdad, no sólo encendido.
 * @system `qa_run_secrets` con TTL, `qa_worker_heartbeats` y la consulta del producto por tenant.
 */
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { atlasSchemaFor } from '../../../database/domain-schemas.js';

import type { Fence } from './qa-run-worker.repository.js';

const S = atlasSchemaFor('qa_runs');
const JOBS = `${atlasSchemaFor('system_job_runs')}.system_job_runs`;

@Injectable()
export class QaRunSupportRepository {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  /**
   * Corridas activas cuyo job ya nadie va a tomar: lease vencido y sin intentos disponibles. Sin este
   * barrido quedarían QUEUED/RUNNING/CANCELLING para siempre y el tope por tenant las contaría.
   */
  async listAbandonedRuns(maxAttempts: number, now: Date = new Date()): Promise<Array<{ runId: string; fence: Fence }>> {
    const rows = await this.sequelize.query<{ run_id: string; job_run_id: string; fencing_token: string }>(
      `SELECT r._id AS run_id, j._id AS job_run_id, j.fencing_token
         FROM ${S}.qa_runs r
         JOIN ${JOBS} j ON j._id = r.job_run_id
        WHERE r.status IN ('QUEUED','PREFLIGHT','RUNNING','CANCELLING')
          AND j.status = 'running'
          AND j.lease_expires_at IS NOT NULL
          AND j.lease_expires_at < $now
          AND j.attempts >= $maxAttempts
        ORDER BY r._id
        LIMIT 20;`,
      { type: QueryTypes.SELECT, bind: { now, maxAttempts } },
    );
    return rows.map((row) => ({
      runId: String(row.run_id),
      fence: { jobRunId: String(row.job_run_id), fencingToken: String(row.fencing_token) },
    }));
  }

  async saveSecret(runId: string, encryptedToken: string, epoch: string | null, expiresAt: Date): Promise<void> {
    await this.sequelize.query(
      `INSERT INTO ${S}.qa_run_secrets (run_id, mock_run_token_encrypted, mock_epoch, expires_at) VALUES ($runId, $token, $epoch, $expiresAt)
       ON CONFLICT (run_id) DO UPDATE SET mock_run_token_encrypted = EXCLUDED.mock_run_token_encrypted, mock_epoch = EXCLUDED.mock_epoch, expires_at = EXCLUDED.expires_at;`,
      { bind: { runId, token: encryptedToken, epoch, expiresAt } },
    );
  }

  async readSecret(runId: string): Promise<{ token: string | null; epoch: string | null } | null> {
    const rows = await this.sequelize.query<{ mock_run_token_encrypted: string | null; mock_epoch: string | null }>(
      `SELECT mock_run_token_encrypted, mock_epoch FROM ${S}.qa_run_secrets WHERE run_id = $runId AND expires_at > now();`,
      { type: QueryTypes.SELECT, bind: { runId } },
    );
    return rows[0] ? { token: rows[0].mock_run_token_encrypted, epoch: rows[0].mock_epoch } : null;
  }

  async purgeSecret(runId: string): Promise<void> {
    await this.sequelize.query(`DELETE FROM ${S}.qa_run_secrets WHERE run_id = $runId;`, { bind: { runId } });
  }

  async workerHeartbeat(workerId: string, version: string): Promise<void> {
    await this.sequelize.query(
      `INSERT INTO ${S}.qa_worker_heartbeats (worker_id, last_seen_at, version) VALUES ($workerId, now(), $version)
       ON CONFLICT (worker_id) DO UPDATE SET last_seen_at = now(), version = EXCLUDED.version;`,
      { bind: { workerId, version } },
    );
  }

  /** Producto de crédito activo del tenant, resuelto por consulta y no quemado. */
  async findActiveCreditProduct(tenantId: string): Promise<{ id: string; minAmount: number; maxAmount: number } | null> {
    const rows = await this.sequelize.query<{ _id: string; min_amount: string; max_amount: string }>(
      `SELECT _id, min_amount, max_amount FROM ${atlasSchemaFor('credit_products')}.credit_products
        WHERE _tenant_id = $tenantId AND status = 'active' ORDER BY min_amount ASC, _id ASC LIMIT 1;`,
      { type: QueryTypes.SELECT, bind: { tenantId } },
    );
    const row = rows[0];
    return row ? { id: String(row._id), minAmount: Number(row.min_amount), maxAmount: Number(row.max_amount) } : null;
  }
}
