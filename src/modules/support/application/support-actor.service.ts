/**
 * @file Servicio de aplicación: resuelve quién actúa y qué puede ver dentro del soporte.
 * @business Impide que un cliente lea el caso de otro y que un comercio vea el de otro comercio.
 * @system RBAC del token + ABAC del contexto (sujeto, cola, sensibilidad, asignación).
 */
import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AtlasUserRole, AuthenticatedUser } from '../../../common/types/auth.types.js';
import type { SupportCaseModel } from '../../../database/models/index.js';
import { PartnerProfileService } from '../../partner-onboarding/application/partner-profile.service.js';
import { SupportAgentRepository } from '../support-agent.repository.js';
import type { SupportActorType } from '../support.constants.js';

/** Quién está actuando, ya resuelto contra la base y no sólo según el token. */
export interface SupportActor {
  readonly actorType: SupportActorType;
  /** El rol del token. Lo necesitan las reglas que dependen del cargo y no del perfil de agente. */
  readonly role: AtlasUserRole;
  /** Identificador estable dentro de su tipo. Es lo que se guarda en mensajes y eventos. */
  readonly actorId: string;
  readonly customerId: string | null;
  readonly merchantUserId: string | null;
  readonly agentProfileId: string | null;
  readonly agentLevel: string | null;
  readonly isInternal: boolean;
  readonly isSupervisor: boolean;
  readonly displayName: string | null;
}

const SUPERVISOR_ROLES = ['admin', 'platform_admin'];
const INTERNAL_ROLES = [
  'internal_operator',
  'risk_analyst',
  'compliance_analyst',
  'fraud_analyst',
  'admin',
  'platform_admin',
  'readonly_auditor',
];

@Injectable()
export class SupportActorService {
  constructor(
    private readonly agents: SupportAgentRepository,
    private readonly partners: PartnerProfileService,
  ) {}

  /**
   * Traduce el token en un actor del dominio de soporte.
   *
   * El rol del JWT dice de qué familia es quien llama; el PERFIL DE AGENTE dice si además está
   * habilitado para atender. Son cosas distintas a propósito: un analista de riesgo tiene rol
   * interno y no por eso debe entrar en la conversación de un cliente. Sin perfil de agente, un
   * usuario interno puede leer lo que su rol le permita pero no puede tomar canales ni escribir
   * como soporte.
   */
  async resolve(currentUser: AuthenticatedUser, tenantId: string): Promise<SupportActor> {
    const isInternal = INTERNAL_ROLES.includes(currentUser.role);
    const isSupervisor = SUPERVISOR_ROLES.includes(currentUser.role);

    if (currentUser.role === 'customer') {
      return {
        actorType: 'CUSTOMER',
        role: currentUser.role,
        actorId: currentUser.customerId ?? currentUser.sub,
        customerId: currentUser.customerId ?? null,
        merchantUserId: null,
        agentProfileId: null,
        agentLevel: null,
        isInternal: false,
        isSupervisor: false,
        displayName: null,
      };
    }

    if (currentUser.role === 'merchant') {
      return {
        actorType: 'PARTNER_USER',
        role: currentUser.role,
        actorId: currentUser.merchantUserId ?? currentUser.sub,
        customerId: null,
        merchantUserId: currentUser.merchantUserId ?? null,
        agentProfileId: null,
        agentLevel: null,
        isInternal: false,
        isSupervisor: false,
        displayName: null,
      };
    }

    const profile = currentUser.internalUserId ? await this.agents.findByInternalUser(tenantId, currentUser.internalUserId) : null;

    return {
      actorType: isSupervisor ? 'SUPERVISOR' : 'AGENT',
      role: currentUser.role,
      actorId: currentUser.internalUserId ?? currentUser.sub,
      customerId: null,
      merchantUserId: null,
      agentProfileId: profile ? String(profile.id) : null,
      agentLevel: profile?.supportLevel ?? null,
      isInternal,
      isSupervisor,
      displayName: null,
    };
  }

  /** Sólo quien tiene perfil de agente vivo puede atender. El rol por sí solo no basta. */
  assertIsAgent(actor: SupportActor): string {
    if (!actor.agentProfileId) {
      throw new ForbiddenException({
        code: 'SUPPORT_AGENT_PROFILE_REQUIRED',
        message: 'Este usuario interno no tiene perfil de agente de soporte habilitado.',
      });
    }
    return actor.agentProfileId;
  }

  /**
   * Puede este actor VER este expediente.
   *
   * El cliente ve el suyo. El empleado del comercio ve el que abrió y, según la visibilidad del
   * caso, los de su empresa. El personal interno ve según su rol, con una excepción explícita: un
   * caso `RESTRICTED` —seguridad, fraude, privacidad— no lo abre cualquiera por el hecho de ser
   * interno; hace falta ser el asignado o un supervisor. Sin esa excepción, «restringido» sería
   * una etiqueta sin efecto.
   */
  async assertCanViewCase(actor: SupportActor, supportCase: SupportCaseModel, tenantId: string): Promise<void> {
    if (actor.actorType === 'CUSTOMER') {
      if (supportCase.subjectCustomerId && String(supportCase.subjectCustomerId) === actor.customerId) return;
      throw new ForbiddenException({ code: 'SUPPORT_CASE_FORBIDDEN' });
    }

    if (actor.actorType === 'PARTNER_USER') {
      await this.assertPartnerCaseAccess(actor, supportCase, tenantId);
      return;
    }

    if (!actor.isInternal) throw new ForbiddenException({ code: 'SUPPORT_CASE_FORBIDDEN' });

    if (supportCase.sensitivity === 'RESTRICTED' && !actor.isSupervisor) {
      const assigned = supportCase.currentAssigneeAgentId && String(supportCase.currentAssigneeAgentId) === actor.agentProfileId;
      if (!assigned) {
        throw new ForbiddenException({
          code: 'SUPPORT_CASE_RESTRICTED',
          message: 'Este expediente es restringido: sólo su responsable o un supervisor puede abrirlo.',
        });
      }
    }
  }

  /**
   * El aislamiento entre comercios, que es la regla que ningún atajo puede saltarse.
   *
   * Se comprueba contra el DUEÑO del expediente de partner y no contra el `partnerProfileId` que
   * venga en la petición: confiar en el identificador enviado por el cliente convierte la
   * comprobación en una formalidad que el propio atacante controla.
   */
  private async assertPartnerCaseAccess(actor: SupportActor, supportCase: SupportCaseModel, tenantId: string): Promise<void> {
    if (!supportCase.subjectPartnerProfileId || !actor.merchantUserId) {
      throw new ForbiddenException({ code: 'SUPPORT_CASE_FORBIDDEN' });
    }

    const profile = await this.partners.requireProfile(tenantId, String(supportCase.subjectPartnerProfileId));
    if (profile.ownerMerchantUserId !== actor.merchantUserId) {
      // Puede seguir siendo suyo si él lo abrió: un empleado no dueño del expediente igual atiende.
      if (supportCase.openedByActorId !== actor.actorId) {
        throw new ForbiddenException({ code: 'SUPPORT_CASE_FORBIDDEN' });
      }
    }

    if (supportCase.partnerVisibility === 'ATLAS_ONLY') {
      throw new ForbiddenException({ code: 'SUPPORT_CASE_INTERNAL_ONLY' });
    }
    if (supportCase.partnerVisibility === 'PRIVATE_TO_REQUESTER' && supportCase.openedByActorId !== actor.actorId) {
      throw new ForbiddenException({ code: 'SUPPORT_CASE_FORBIDDEN' });
    }
  }

  /**
   * Con qué motivos del catálogo puede abrirse o clasificarse un caso de este actor.
   *
   * La audiencia de la categoría no es una etiqueta de presentación: arrastra cola, sensibilidad,
   * impacto y urgencia por defecto. `findCategoryByCode` sólo filtra por inquilino, código y
   * vigencia, así que sin esta comprobación un consumidor podía abrir su caso con el motivo de
   * conciliación del comercio y aterrizar en `partner_operations`, delante de los expedientes de
   * los comercios y fuera de la cola de quien debía atenderle. Se cuela por el mismo sitio por el
   * que se colaría cualquiera: el código de categoría viaja en el cuerpo de la petición.
   *
   * `ANY` está en todas las listas porque hay motivos que son de cualquiera —queja, fraude,
   * consulta genérica— y negárselos a alguien sería peor que el problema que esto resuelve.
   */
  caseCategoryAudiences(actor: SupportActor): string[] {
    if (actor.isInternal) return ['CONSUMER', 'PARTNER_USER', 'PARTNER_ORGANIZATION', 'INTERNAL', 'ANY'];
    if (actor.actorType === 'PARTNER_USER') return ['PARTNER_USER', 'PARTNER_ORGANIZATION', 'ANY'];
    if (actor.actorType === 'CUSTOMER') return ['CONSUMER', 'ANY'];
    return ['ANY'];
  }

  /**
   * Rechaza el motivo que no le corresponde a este actor.
   *
   * Se responde con un error propio y no con «no encontrado»: el motivo existe, y decir lo contrario
   * mandaría a quien integra a buscar un error de catálogo que no hay.
   */
  assertCategoryAllowed(actor: SupportActor, category: { categoryCode: string; audience: string }): void {
    if (!this.caseCategoryAudiences(actor).includes(category.audience)) {
      throw new ForbiddenException({
        code: 'SUPPORT_CATEGORY_NOT_ALLOWED',
        categoryCode: category.categoryCode,
        audience: category.audience,
      });
    }
  }

  /** Qué audiencias de conocimiento puede leer este actor. Se aplica en el WHERE, no en la vista. */
  knowledgeAudiences(actor: SupportActor): string[] {
    if (actor.actorType === 'CUSTOMER') return ['PUBLIC_CONSUMER', 'AUTHENTICATED_CONSUMER'];
    if (actor.actorType === 'PARTNER_USER') return ['PUBLIC_CONSUMER', 'PARTNER'];
    if (actor.isInternal) return ['PUBLIC_CONSUMER', 'AUTHENTICATED_CONSUMER', 'PARTNER', 'INTERNAL_SUPPORT'];
    return ['PUBLIC_CONSUMER'];
  }
}
