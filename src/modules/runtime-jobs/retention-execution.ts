/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza aplica de verdad la retención que una política activa declara sobre su tabla.
 * @system ejecuta, por `policy_code`, la purga o anonimización registrada en RETENTION_TARGETS.
 */
import { Op } from 'sequelize';
import { Logger } from '@nestjs/common';
import {
  AddressGpsObservationModel,
  DeviceSnapshotModel,
  FormFieldInteractionEventModel,
  SystemActionLogModel,
  SystemJobRunModel,
} from '../../database/models/index.js';
import { RETENTION_TARGETS } from './retention-targets.js';

export type RetentionOutcome = { table: string; action: 'delete' | 'anonymize'; affected: number };

export type RetentionModels = {
  gpsObservationModel: typeof AddressGpsObservationModel;
  deviceSnapshotModel: typeof DeviceSnapshotModel;
  formInteractionModel: typeof FormFieldInteractionEventModel;
  systemJobRunModel: typeof SystemJobRunModel;
  systemActionLogModel: typeof SystemActionLogModel;
};

/** Un `policyCode` sin rama de ejecución cae aquí: `null` (política sin destino ejecutable). */
export async function executeRetentionTarget(
  policyCode: string,
  cutoffDate: Date,
  dryRun: boolean,
  models: RetentionModels,
  logger: Logger,
): Promise<RetentionOutcome | null> {
  const target = RETENTION_TARGETS[policyCode];
  if (!target) {
    return null;
  }

  if (policyCode === 'gps_observations_90d') {
    const where = { createdAtValue: { [Op.lt]: cutoffDate } } as never;
    const affected = dryRun ? await models.gpsObservationModel.count({ where }) : await models.gpsObservationModel.destroy({ where });
    return { table: target.table, action: 'delete', affected };
  }

  if (policyCode === 'device_snapshots_90d') {
    const where = { createdAtValue: { [Op.lt]: cutoffDate } } as never;
    if (dryRun) {
      const affected = await models.deviceSnapshotModel.count({ where });
      return { table: target.table, action: 'anonymize', affected };
    }
    const [affected] = await models.deviceSnapshotModel.update(
      {
        brand: null,
        model: null,
        osVersion: null,
        appVersion: null,
        // Se conservan deliberadamente: isRooted, isEmulator, vpnDetected, osFamily,
        // deviceTierSnapshot — señales de riesgo agregadas sin valor identificatorio directo.
      } as never,
      { where },
    );
    return { table: target.table, action: 'anonymize', affected };
  }

  if (policyCode === 'form_interaction_events_60d') {
    const where = { createdAtValue: { [Op.lt]: cutoffDate } } as never;
    const affected = dryRun ? await models.formInteractionModel.count({ where }) : await models.formInteractionModel.destroy({ where });
    return { table: target.table, action: 'delete', affected };
  }

  if (policyCode === 'system-job-runs-30d') {
    const where = { createdAtValue: { [Op.lt]: cutoffDate } } as never;
    const affected = dryRun ? await models.systemJobRunModel.count({ where }) : await models.systemJobRunModel.destroy({ where });
    return { table: target.table, action: 'delete', affected };
  }

  if (policyCode === 'system-action-logs-30d') {
    const where = { createdAtValue: { [Op.lt]: cutoffDate } } as never;
    const affected = dryRun ? await models.systemActionLogModel.count({ where }) : await models.systemActionLogModel.destroy({ where });
    return { table: target.table, action: 'delete', affected };
  }

  // No debería alcanzarse: todo policyCode presente en RETENTION_TARGETS debe tener una rama
  // arriba. Se deja como red de seguridad explícita en vez de un `else` silencioso.
  logger.warn(`RETENTION_TARGETS tiene "${policyCode}" registrado pero sin lógica de ejecución implementada.`);
  return null;
}
