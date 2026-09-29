/**
 * @file Utilidad de repositorio: traduce los filtros de corridas de estrés a cláusulas WHERE.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system construye el `where` de `system_job_runs` (corridas de estrés) sin tocar la base.
 */
import { Op, WhereOptions } from 'sequelize';
import { containsLikePattern } from '../../common/utils/strings/like-pattern.util.js';
import { SystemsStressRunsQueryDto } from './systems-ops.query.schemas.js';

export const STRESS_RUN_JOB_CODE = 'systems_stress_run';

/** Estados que el portal manda → estados reales de la cola durable. `PASSED` era el nombre del portal. */
const STATUS_IN_QUEUE: Record<NonNullable<SystemsStressRunsQueryDto['status']>, string> = {
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  PASSED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

/**
 * `environment` y el perfil viven dentro de `input_json` (la fila es un trabajo genérico de la cola,
 * no tiene columnas propias de estrés). Antes el esquema los aceptaba y este `where` los ignoraba:
 * elegir «STAGING» devolvía también las corridas LOCAL.
 */
export function buildStressRunWhere(query: SystemsStressRunsQueryDto, tenantId: string | null): WhereOptions {
  const inputJson: Record<string, unknown> = {};
  if (query.environment) inputJson.environment = query.environment;
  const profileId = query.profileId ?? query.suiteId;
  if (profileId) inputJson.profileId = profileId;

  const where: Record<string | symbol, unknown> = { jobCode: STRESS_RUN_JOB_CODE };
  if (query.status) where.status = STATUS_IN_QUEUE[query.status];
  if (tenantId !== null) where.tenantId = tenantId;
  if (Object.keys(inputJson).length > 0) where.inputJson = inputJson;
  if (query.q) {
    const byCode = { inputJson: { profileCode: { [Op.iLike]: containsLikePattern(query.q) } } };
    where[Op.or] = /^[1-9][0-9]{0,17}$/.test(query.q) ? [byCode, { id: query.q }] : [byCode];
  }
  return where as WhereOptions;
}

export type StressConsumerCapabilities = {
  consumerEnabled: boolean;
  disabledReason: string | null;
};

export function stressConsumerCapabilities(consumerEnabled: boolean): StressConsumerCapabilities {
  return {
    consumerEnabled,
    disabledReason: consumerEnabled
      ? null
      : 'El consumidor de estrés está apagado en este entorno (RUNTIME_JOBS_STRESS_CONSUMER_ENABLED=false): una corrida encolada no se ejecutaría.',
  };
}
