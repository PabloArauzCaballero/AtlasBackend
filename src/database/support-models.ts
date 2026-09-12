/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system agrupa los modelos del motor de soporte para registrarlos como un bloque.
 */
import {
  KnowledgeArticleModel,
  KnowledgeArticleVersionModel,
  SupportAgentProfileModel,
  SupportAgentSkillModel,
  SupportAssignmentModel,
  SupportAttachmentModel,
  SupportCannedResponseModel,
  SupportCaseCategoryModel,
  SupportCaseEventModel,
  SupportCaseFeedbackModel,
  SupportCaseLinkModel,
  SupportCaseModel,
  SupportCaseReferenceModel,
  SupportChannelModel,
  SupportChannelParticipantModel,
  SupportMessageModel,
  SupportMessageRelationModel,
  SupportQueueModel,
  SupportResolutionModel,
  SupportSlaClockModel,
  SupportSlaPolicyModel,
} from './models/index.js';

/**
 * Los veintiún modelos del motor de soporte, como un bloque.
 *
 * Mismo motivo que `PARTNER_MODELS`: el inventario crece con el dominio y arrastraría al registro de
 * Sequelize por encima del gate de tamaño. Agrupar dice además algo cierto —un mensaje sin canal,
 * un canal sin caso y un caso sin cola no significan nada por separado—: se registran juntos o no
 * se registra ninguno.
 *
 * **Van en la instancia de Sequelize y no sólo en el `forFeature` del módulo.** Sin esto compila y
 * falla en la primera consulta con «Model not initialized».
 */
export const SUPPORT_MODELS = [
  SupportQueueModel,
  SupportSlaPolicyModel,
  SupportCaseCategoryModel,
  SupportCannedResponseModel,
  SupportAgentProfileModel,
  SupportAgentSkillModel,
  SupportCaseModel,
  SupportCaseEventModel,
  SupportAssignmentModel,
  SupportSlaClockModel,
  SupportResolutionModel,
  SupportCaseLinkModel,
  SupportCaseReferenceModel,
  SupportCaseFeedbackModel,
  SupportChannelModel,
  SupportChannelParticipantModel,
  SupportMessageModel,
  SupportMessageRelationModel,
  SupportAttachmentModel,
  KnowledgeArticleModel,
  KnowledgeArticleVersionModel,
] as const;
