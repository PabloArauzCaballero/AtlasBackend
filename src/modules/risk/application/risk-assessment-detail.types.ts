/**
 * @file Tipos de dominio: hacen explícitos estados y contratos internos.
 * @business Fija la forma del detalle de una evaluación de riesgo que consumen las pantallas.
 * @system declara el agregado que devuelve `getRiskAssessmentDetail`.
 */
import type {
  FeatureSnapshotModel,
  RiskAssessmentResultModel,
  RiskAssessmentRunModel,
  RiskFeatureContributionModel,
  RiskRuleFiredModel,
} from '../../../database/models/index.js';

/** Todo lo que se leyó de una evaluación, en una pieza. La explicación se compone desde aquí. */
export type RiskAssessmentDetail = {
  run: RiskAssessmentRunModel;
  result: RiskAssessmentResultModel | null;
  rulesFired: RiskRuleFiredModel[];
  featureContributions: RiskFeatureContributionModel[];
  featureSnapshot: FeatureSnapshotModel | null;
};
