/**
 * @file Servicio de aplicación: el perfil de agente nace del rol, no de un alta aparte.
 * @business Quien tiene el rol de soporte (o de administración) puede atender desde el primer día.
 * @system crea `support_agent_profiles` la primera vez que la persona entra en la mesa.
 */
import { Injectable } from '@nestjs/common';
import { UniqueConstraintError } from 'sequelize';
import type { SupportAgentProfileModel } from '../../../database/models/index.js';
import { SupportAgentRepository } from '../support-agent.repository.js';

/**
 * Roles RBAC que, por sí solos, habilitan a atender.
 *
 * `SUPPORT_AGENT` es literalmente «Soporte interno»; los otros tres ya salen como `admin` en el token
 * y son quienes supervisan la mesa. Un analista de riesgo o de cumplimiento NO está aquí a propósito:
 * tener rol interno no da derecho a entrar en la conversación de un cliente.
 */
const ROLES_QUE_ATIENDEN = ['SUPPORT_AGENT', 'SUPER_ADMIN', 'SYSTEMS_ADMIN', 'INTERNAL_IDENTITY_ADMIN'];

/**
 * ## Por qué existe
 *
 * El rol RBAC `SUPPORT_AGENT` y el perfil de `support_agent_profiles` eran dos altas desconectadas.
 * Dar el rol en el portal no creaba el perfil, y sin perfil cada ruta de la mesa respondía 403
 * `SUPPORT_AGENT_PROFILE_REQUIRED`, también al SUPER_ADMIN. Medido en TEST el 2026-09-26: tres
 * usuarios internos, uno con `SUPPORT_AGENT`, cero perfiles; nadie podía contestar un solo chat.
 *
 * ## Qué NO hace
 *
 * No recrea un perfil dado de baja. Si un supervisor quitó a alguien de la mesa, esa decisión se
 * respeta aunque la persona conserve el rol; volver es una reactivación explícita desde «Agentes».
 */
@Injectable()
export class SupportAgentEnrollmentService {
  constructor(private readonly agents: SupportAgentRepository) {}

  async ensureProfile(tenantId: string, internalUserId: string): Promise<SupportAgentProfileModel | null> {
    const current = await this.agents.findByInternalUser(tenantId, internalUserId);
    if (current) return current;

    // Existe pero dado de baja: la baja manda sobre el rol.
    if (await this.agents.findAnyByInternalUser(tenantId, internalUserId)) return null;

    const roles = await this.agents.activeRoleCodes(tenantId, internalUserId);
    if (!roles.some((role) => ROLES_QUE_ATIENDEN.includes(role))) return null;

    try {
      return await this.agents.createProfile({
        tenantId,
        internalUserId,
        supportLevel: roles.includes('SUPPORT_AGENT') ? 'L1' : 'SUPERVISOR',
        // Sin cola fija: atiende cualquier cola hasta que un supervisor lo especialice.
        defaultQueueId: null,
        maxConcurrentChannels: 5,
        timezone: 'America/La_Paz',
        languageCodes: ['es'],
      });
    } catch (error) {
      // Dos pestañas abriendo la mesa a la vez: la otra petición ya lo creó.
      if (error instanceof UniqueConstraintError) return this.agents.findByInternalUser(tenantId, internalUserId);
      throw error;
    }
  }
}
