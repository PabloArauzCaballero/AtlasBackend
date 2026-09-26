/**
 * @file Registro de modelos del contexto de corridas QA (AT-018).
 * @business Esta pieza declara qué tablas son de este módulo.
 * @system se agrega a `databaseModels` mientras el monolito comparte proceso.
 */
import {
  QaPersonaRunModel,
  QaRunEventModel,
  QaRunModel,
  QaRunPlanModel,
  QaRunResourceModel,
  QaRunSecretModel,
  QaStepRunModel,
  QaWorkerHeartbeatModel,
} from '../../../../database/models/index.js';

export const QA_MODELS = [
  QaRunPlanModel,
  QaRunModel,
  QaPersonaRunModel,
  QaStepRunModel,
  QaRunEventModel,
  QaRunResourceModel,
  QaRunSecretModel,
  QaWorkerHeartbeatModel,
];
