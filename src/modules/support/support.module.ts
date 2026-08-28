/**
 * @file Módulo Nest: agrupa el motor de soporte, atención, casos y conocimiento.
 * @business Un solo contexto acotado para el servicio de atención: expediente, canal y conocimiento.
 * @system arquitectura hexagonal dentro del backend; no hace falta un microservicio aparte.
 */
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  KnowledgeArticleModel,
  KnowledgeArticleVersionModel,
  OperationalAuditLogModel,
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
} from '../../database/models/index.js';
import { RedisModule } from '../../common/redis/redis.module.js';
import { DocumentStorageService } from '../../common/storage/document-storage.service.js';
import { MalwareScannerService } from '../../common/storage/malware-scanner.service.js';
import { EventsModule } from '../events/events.module.js';
import { PartnerOnboardingModule } from '../partner-onboarding/partner-onboarding.module.js';
import { SupportActorService } from './application/support-actor.service.js';
import { SupportAttachmentService } from './application/support-attachment.service.js';
import { SupportAuditService } from './application/support-audit.service.js';
import { SupportCaseClosureService } from './application/support-case-closure.service.js';
import { SupportCaseCustomerService } from './application/support-case-customer.service.js';
import { SupportCaseEscalationService } from './application/support-case-escalation.service.js';
import { SupportCaseFactoryService } from './application/support-case-factory.service.js';
import { SupportCaseMembershipService } from './application/support-case-membership.service.js';
import { SupportCaseReadService } from './application/support-case-read.service.js';
import { SupportCaseService } from './application/support-case.service.js';
import { SupportCaseTransitionService } from './application/support-case-transition.service.js';
import { SupportCaseWorkflowService } from './application/support-case-workflow.service.js';
import { SupportChannelService } from './application/support-channel.service.js';
import { SupportConversationService } from './application/support-conversation.service.js';
import { SupportRealtimeService } from './application/support-realtime.service.js';
import { SupportDeskService } from './application/support-desk.service.js';
import { SupportKnowledgeService } from './application/support-knowledge.service.js';
import { SupportMessageService } from './application/support-message.service.js';
import { SupportSlaService } from './application/support-sla.service.js';
import { InternalSupportController } from './internal-support.controller.js';
import { InternalSupportDeskController } from './internal-support-desk.controller.js';
import { MerchantSupportController } from './merchant-support.controller.js';
import { MobileSupportController } from './mobile-support.controller.js';
import { SupportAgentRepository } from './support-agent.repository.js';
import { SupportCaseRepository } from './support-case.repository.js';
import { SupportCaseTimelineRepository } from './support-case-timeline.repository.js';
import { SupportCatalogRepository } from './support-catalog.repository.js';
import { SupportChannelRepository } from './support-channel.repository.js';
import { SupportAttachmentsController } from './support-attachments.controller.js';
import { SupportChatController } from './support-chat.controller.js';
import { SupportKnowledgeAdminController } from './support-knowledge-admin.controller.js';
import { SupportKnowledgeRepository } from './support-knowledge.repository.js';
import { SupportMessageRepository } from './support-message.repository.js';

/**
 * Un ÚNICO contexto acotado de Service Management, modular por dentro.
 *
 * No hacen falta quince microservicios: lo que hace falta es que el expediente, el canal y la
 * transcripción no se confundan entre sí, y eso se consigue con fronteras dentro del módulo —
 * dominio puro, repositorios, servicios de aplicación, adaptadores HTTP— y no con red por medio.
 *
 * Depende de `PartnerOnboardingModule` para una sola cosa: comprobar quién es el dueño del
 * expediente de un comercio. Es la dependencia que sostiene el aislamiento entre comercios, y
 * duplicar esa lógica aquí habría creado una segunda respuesta a la pregunta más delicada del
 * portal de negocio.
 */
@Module({
  imports: [
    SequelizeModule.forFeature([
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
      OperationalAuditLogModel,
    ]),
    EventsModule,
    RedisModule,
    PartnerOnboardingModule,
  ],
  controllers: [
    MobileSupportController,
    MerchantSupportController,
    SupportChatController,
    SupportAttachmentsController,
    InternalSupportController,
    InternalSupportDeskController,
    SupportKnowledgeAdminController,
  ],
  providers: [
    SupportCatalogRepository,
    SupportAgentRepository,
    SupportCaseRepository,
    SupportCaseTimelineRepository,
    SupportChannelRepository,
    SupportMessageRepository,
    SupportKnowledgeRepository,
    SupportActorService,
    SupportAttachmentService,
    DocumentStorageService,
    MalwareScannerService,
    SupportAuditService,
    SupportSlaService,
    SupportCaseTransitionService,
    SupportCaseMembershipService,
    SupportMessageService,
    SupportRealtimeService,
    SupportConversationService,
    SupportCaseFactoryService,
    SupportCaseService,
    SupportCaseReadService,
    SupportCaseWorkflowService,
    SupportCaseEscalationService,
    SupportCaseClosureService,
    SupportCaseCustomerService,
    SupportChannelService,
    SupportDeskService,
    SupportKnowledgeService,
  ],
  exports: [SupportCaseService, SupportSlaService, SupportKnowledgeService],
})
export class SupportModule {}
