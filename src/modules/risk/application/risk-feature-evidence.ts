/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza conserva con qué información se evaluó a un cliente, y no sólo el resultado.
 * @system escribe la corrida de features, sus valores y el snapshot dentro de la transacción dada.
 */
import { Transaction } from 'sequelize';
import { sha256Hex } from '../../../common/utils/crypto/hash.util.js';
import { FeatureSnapshotModel } from '../../../database/models/index.js';
import { RiskRepository } from '../risk.repository.js';

export type EvidenceSubject = {
  tenantId: string;
  customerId: string;
  sessionId: string | null;
  deviceId: string | null;
  assessmentType: string;
  channel: string;
  idempotencyKey: string;
};

/**
 * Persiste la EVIDENCIA de con qué se evaluó: corrida, valores de cada feature y snapshot firmado.
 *
 * Vive fuera del servicio porque es una responsabilidad distinta de orquestar la decisión —guardar
 * la foto de la información, no elegir el desenlace— y porque el servicio ya era el archivo más
 * largo del módulo.
 *
 * El `integrityHash` del snapshot es lo que permite demostrar, meses después, que dos evaluaciones
 * partieron del mismo estado de información: sin él, «se evaluó con estos datos» es una afirmación
 * que nadie puede comprobar.
 */
export async function writeFeatureEvidence(
  repository: RiskRepository,
  subject: EvidenceSubject,
  featureMap: Record<string, number | boolean>,
  missing: string[],
  now: Date,
  transaction: Transaction,
): Promise<FeatureSnapshotModel> {
  const featureRun = await repository.createFeatureComputationRun(
    {
      tenantId: subject.tenantId,
      customerId: subject.customerId,
      sessionId: subject.sessionId,
      deviceId: subject.deviceId,
      runReason: subject.assessmentType,
      triggerSource: subject.channel,
      idempotencyKey: subject.idempotencyKey,
      now,
    },
    { transaction },
  );

  for (const [featureCode, value] of Object.entries(featureMap)) {
    await repository.createFeatureValue(
      {
        tenantId: subject.tenantId,
        computationRunId: String(featureRun.id),
        customerId: subject.customerId,
        sessionId: subject.sessionId,
        deviceId: subject.deviceId,
        featureCode,
        valueNumber: typeof value === 'number' ? value.toFixed(4) : null,
        valueBoolean: typeof value === 'boolean' ? value : null,
        valueText: null,
        valueJson: null,
        now,
      },
      { transaction },
    );
  }

  // Se devuelve el MODELO y no su id: quien llama tiene que atarlo a la corrida
  // (`attachSnapshotToRun`), y volver a leerlo por id sería una consulta de más dentro de la
  // transacción para recuperar algo que ya se tenía en la mano.
  return repository.createFeatureSnapshot(
    {
      tenantId: subject.tenantId,
      customerId: subject.customerId,
      deviceId: subject.deviceId,
      sessionId: subject.sessionId,
      featuresJson: featureMap,
      missingFeaturesJson: { missing },
      integrityHash: sha256Hex(JSON.stringify(featureMap)),
      now,
    },
    { transaction },
  );
}
