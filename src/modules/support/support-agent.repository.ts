/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Reserva un agente disponible para atender, sin que dos personas se queden con el mismo chat.
 * @system compare-and-set atómico sobre `support_agent_profiles` con `FOR UPDATE SKIP LOCKED`.
 */
import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { SupportAgentProfileModel, SupportAgentSkillModel } from '../../database/models/index.js';
import { atlasSchemaFor } from '../../database/domain-schemas.js';

const AGENTS = `${atlasSchemaFor('support_agent_profiles')}.support_agent_profiles`;
const SKILLS = `${atlasSchemaFor('support_agent_skills')}.support_agent_skills`;
const INTERNAL_USERS = `${atlasSchemaFor('internal_users')}.internal_users`;

export type RepositoryOptions = { transaction?: Transaction };

/** El perfil como lo ve quien administra la mesa: quién es la persona, no sólo su identificador. */
export interface AgentProfileRow {
  readonly agentProfileId: string;
  readonly internalUserId: string;
  readonly email: string | null;
  readonly fullName: string | null;
  readonly roleCode: string | null;
  readonly supportLevel: string;
  readonly defaultQueueId: string | null;
  readonly maxConcurrentChannels: number;
  readonly activeChannelCount: number;
  readonly presenceState: string;
  readonly employmentStatus: string;
  readonly isActive: boolean;
}

/** Lo mínimo que el enrutador necesita saber del agente que acaba de reservar. */
export interface ReservedAgent {
  readonly agentProfileId: string;
  readonly internalUserId: string;
  readonly supportLevel: string;
  readonly activeChannelCount: number;
  readonly maxConcurrentChannels: number;
}

@Injectable()
export class SupportAgentRepository {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    @InjectModel(SupportAgentProfileModel) private readonly agents: typeof SupportAgentProfileModel,
    @InjectModel(SupportAgentSkillModel) private readonly skills: typeof SupportAgentSkillModel,
  ) {}

  findByInternalUser(tenantId: string, internalUserId: string, options: RepositoryOptions = {}): Promise<SupportAgentProfileModel | null> {
    return this.agents.findOne({ where: { tenantId, internalUserId, deleted: false }, transaction: options.transaction });
  }

  findById(tenantId: string, agentProfileId: string, options: RepositoryOptions = {}): Promise<SupportAgentProfileModel | null> {
    return this.agents.findOne({ where: { tenantId, id: agentProfileId, deleted: false }, transaction: options.transaction });
  }

  /**
   * Los perfiles de la mesa, con el nombre y el correo de la persona.
   *
   * El join contra `internal_users` no es adorno: la pantalla que habilita agentes tiene que decir
   * QUIÉN es cada fila, y un listado de identificadores obliga a quien administra a cruzarlo a mano
   * contra otra pantalla. Se leen también los inactivos —marcados como tales— porque quitar a
   * alguien de la mesa deja `is_active = FALSE`, y esconderlo haría que el mismo alta fallara
   * después con un choque de unicidad que nadie sabría explicar.
   */
  async listProfiles(tenantId: string): Promise<AgentProfileRow[]> {
    const rows = await this.sequelize.query<{
      _id: string;
      internal_user_id: string;
      email: string | null;
      full_name: string | null;
      role_code: string | null;
      support_level: string;
      default_queue_id: string | null;
      max_concurrent_channels: number;
      active_channel_count: number;
      presence_state: string;
      employment_status: string;
      is_active: boolean;
    }>(
      `SELECT agent._id, agent.internal_user_id, person.email, person.full_name, person.role_code,
              agent.support_level, agent.default_queue_id, agent.max_concurrent_channels,
              agent.active_channel_count, agent.presence_state, agent.employment_status, agent.is_active
         FROM ${AGENTS} AS agent
         LEFT JOIN ${INTERNAL_USERS} AS person ON person._id = agent.internal_user_id
        WHERE agent._tenant_id = :tenantId AND agent._deleted = FALSE
        ORDER BY agent.is_active DESC, person.full_name ASC NULLS LAST, agent._id ASC;`,
      { replacements: { tenantId }, type: QueryTypes.SELECT },
    );

    return rows.map((row) => ({
      agentProfileId: String(row._id),
      internalUserId: String(row.internal_user_id),
      email: row.email,
      fullName: row.full_name,
      roleCode: row.role_code,
      supportLevel: row.support_level,
      defaultQueueId: row.default_queue_id ? String(row.default_queue_id) : null,
      maxConcurrentChannels: Number(row.max_concurrent_channels),
      activeChannelCount: Number(row.active_channel_count),
      presenceState: row.presence_state,
      employmentStatus: row.employment_status,
      isActive: row.is_active,
    }));
  }

  /**
   * Existe el usuario interno y está vivo en este tenant.
   *
   * Se comprueba antes de insertar porque la clave foránea diría lo mismo con un error de Postgres
   * que llega al cliente como 500, y porque la FK no distingue «no existe» de «existe en otro
   * tenant»: sin esta consulta, habilitar por error a alguien de otro tenant fallaría con un
   * mensaje que apunta al sitio equivocado.
   */
  async internalUserExists(tenantId: string, internalUserId: string): Promise<boolean> {
    const rows = await this.sequelize.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
         FROM ${INTERNAL_USERS}
        WHERE _tenant_id = :tenantId AND _id = :internalUserId AND COALESCE(_deleted, FALSE) = FALSE;`,
      { replacements: { tenantId, internalUserId }, type: QueryTypes.SELECT },
    );
    return Number(rows[0]?.total ?? 0) > 0;
  }

  /** El perfil de esa persona exista o no esté dado de baja: lo que decide si un alta choca. */
  findAnyByInternalUser(tenantId: string, internalUserId: string): Promise<SupportAgentProfileModel | null> {
    return this.agents.findOne({ where: { tenantId, internalUserId } });
  }

  createProfile(values: {
    tenantId: string;
    internalUserId: string;
    supportLevel: string;
    defaultQueueId: string | null;
    maxConcurrentChannels: number;
    timezone: string;
    languageCodes: readonly string[];
  }): Promise<SupportAgentProfileModel> {
    return this.agents.create({
      tenantId: values.tenantId,
      internalUserId: values.internalUserId,
      supportLevel: values.supportLevel,
      defaultQueueId: values.defaultQueueId,
      timezone: values.timezone,
      languageCodesJson: [...values.languageCodes],
      employmentStatus: 'active',
      maxConcurrentChannels: values.maxConcurrentChannels,
      activeChannelCount: 0,
      presenceState: 'OFFLINE',
      presenceChangedAt: new Date(),
      isActive: true,
      deleted: false,
    } as never);
  }

  /**
   * Reactiva un perfil dado de baja en vez de crear otro.
   *
   * `uq_support_agent_user` es por (tenant, persona) y no mira `is_active`, así que insertar de nuevo
   * choca. Reactivar además conserva la historia: las asignaciones y los eventos ya escritos siguen
   * apuntando al mismo `agent_profile_id`, que es justo lo que una auditoría necesita para saber
   * quién atendió qué.
   */
  async reactivateProfile(
    tenantId: string,
    agentProfileId: string,
    values: { supportLevel: string; defaultQueueId: string | null; maxConcurrentChannels: number },
  ): Promise<void> {
    await this.agents.update(
      {
        supportLevel: values.supportLevel,
        defaultQueueId: values.defaultQueueId,
        maxConcurrentChannels: values.maxConcurrentChannels,
        employmentStatus: 'active',
        isActive: true,
        deleted: false,
        activeChannelCount: 0,
        presenceState: 'OFFLINE',
        presenceChangedAt: new Date(),
      },
      { where: { tenantId, id: agentProfileId } },
    );
  }

  /** Quitar a alguien de la mesa no borra su historia: apaga el perfil y libera su capacidad. */
  async deactivateProfile(tenantId: string, agentProfileId: string): Promise<void> {
    await this.agents.update(
      { isActive: false, employmentStatus: 'inactive', presenceState: 'OFFLINE', presenceChangedAt: new Date() },
      { where: { tenantId, id: agentProfileId, deleted: false } },
    );
  }

  listSkills(tenantId: string, agentProfileId: string): Promise<SupportAgentSkillModel[]> {
    return this.skills.findAll({ where: { tenantId, agentProfileId, isActive: true, deleted: false } });
  }

  /**
   * Reserva UN agente elegible y le suma una conversación, en una sola sentencia.
   *
   * ## Por qué no «buscar y después actualizar»
   *
   * Porque entre las dos consultas caben otros diez chats. El patrón clásico —`SELECT` del agente
   * menos cargado y luego `UPDATE`— produce exactamente el fallo que §10.6 prohíbe: dos canales
   * asignados a la misma persona, ambos con su registro impecable de que fue asignado. Aquí la
   * condición `active_channel_count < max_concurrent_channels` se evalúa DENTRO del `UPDATE`, así
   * que o se reserva el hueco o no se devuelve fila.
   *
   * ## Por qué `FOR UPDATE SKIP LOCKED`
   *
   * Con dos solicitudes simultáneas, la segunda no espera a que la primera termine con el agente
   * que ya está bloqueando: lo salta y toma el siguiente. Sin `SKIP LOCKED` las solicitudes se
   * serializarían contra el mismo candidato —el menos cargado— y el enrutado se volvería lento
   * justo cuando hay cola, que es cuando importa.
   *
   * ## El orden de preferencia
   *
   * Menos cargado primero (reparte de verdad) y, a igualdad, quien lleva más tiempo sin cambio de
   * presencia (evita que el mismo agente reciba siempre el primer chat de la mañana). Las
   * competencias exigidas por la cola se comprueban como conjunto: se exige tenerlas TODAS.
   */
  async reserveAvailableAgent(input: {
    tenantId: string;
    queueId: string | null;
    requiredSkills: readonly string[];
    options?: RepositoryOptions;
  }): Promise<ReservedAgent | null> {
    const requiredSkills = [...new Set(input.requiredSkills)];
    const rows = await this.sequelize.query<{
      _id: string;
      internal_user_id: string;
      support_level: string;
      active_channel_count: number;
      max_concurrent_channels: number;
    }>(
      `
      UPDATE ${AGENTS} AS target
         SET active_channel_count = target.active_channel_count + 1,
             _updated_at = NOW()
       WHERE target._id = (
         SELECT candidate._id
           FROM ${AGENTS} AS candidate
          WHERE candidate._tenant_id = :tenantId
            AND candidate._deleted = FALSE
            AND candidate.is_active = TRUE
            AND candidate.employment_status = 'active'
            AND candidate.presence_state = 'AVAILABLE'
            AND candidate.active_channel_count < candidate.max_concurrent_channels
            AND (:queueId::bigint IS NULL
                 OR candidate.default_queue_id IS NULL
                 OR candidate.default_queue_id = :queueId::bigint)
            AND (:skillCount = 0 OR (
                  SELECT COUNT(DISTINCT skill.skill_code)
                    FROM ${SKILLS} AS skill
                   WHERE skill.agent_profile_id = candidate._id
                     AND skill.is_active = TRUE
                     AND skill._deleted = FALSE
                     AND (skill.valid_until IS NULL OR skill.valid_until > NOW())
                     AND skill.skill_code IN (:skills)
                ) = :skillCount)
          ORDER BY candidate.active_channel_count ASC, candidate.presence_changed_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
      RETURNING target._id, target.internal_user_id, target.support_level,
                target.active_channel_count, target.max_concurrent_channels;
      `,
      {
        replacements: {
          tenantId: input.tenantId,
          queueId: input.queueId,
          skillCount: requiredSkills.length,
          skills: requiredSkills.length ? requiredSkills : [''],
        },
        type: QueryTypes.SELECT,
        transaction: input.options?.transaction,
      },
    );

    const row = rows[0];
    if (!row) return null;
    return {
      agentProfileId: String(row._id),
      internalUserId: String(row.internal_user_id),
      supportLevel: row.support_level,
      activeChannelCount: Number(row.active_channel_count),
      maxConcurrentChannels: Number(row.max_concurrent_channels),
    };
  }

  /**
   * Devuelve el hueco al cerrar o transferir el canal.
   *
   * `GREATEST(..., 0)` no es paranoia decorativa: un reinicio a medio camino podría intentar
   * liberar dos veces el mismo canal, y un contador negativo dejaría al agente recibiendo trabajo
   * por encima de su capacidad para siempre — un fallo que nadie relacionaría con este renglón.
   */
  async releaseAgentSlot(tenantId: string, agentProfileId: string, options: RepositoryOptions = {}): Promise<void> {
    await this.sequelize.query(
      `UPDATE ${AGENTS}
          SET active_channel_count = GREATEST(active_channel_count - 1, 0), _updated_at = NOW()
        WHERE _tenant_id = :tenantId AND _id = :agentProfileId;`,
      { replacements: { tenantId, agentProfileId }, type: QueryTypes.UPDATE, transaction: options.transaction },
    );
  }

  async setPresence(tenantId: string, agentProfileId: string, presenceState: string): Promise<void> {
    await this.agents.update({ presenceState, presenceChangedAt: new Date() }, { where: { tenantId, id: agentProfileId, deleted: false } });
  }

  /** Cuántos agentes hay ahora mismo con hueco. Alimenta el aviso de espera al usuario. */
  async countAvailable(tenantId: string, queueId: string | null): Promise<number> {
    const rows = await this.sequelize.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
         FROM ${AGENTS}
        WHERE _tenant_id = :tenantId AND _deleted = FALSE AND is_active = TRUE
          AND presence_state = 'AVAILABLE' AND active_channel_count < max_concurrent_channels
          AND (:queueId::bigint IS NULL OR default_queue_id IS NULL OR default_queue_id = :queueId::bigint);`,
      { replacements: { tenantId, queueId }, type: QueryTypes.SELECT },
    );
    return Number(rows[0]?.total ?? 0);
  }
}
