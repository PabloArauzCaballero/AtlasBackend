/**
 * @file Seeder idempotente: instala datos de referencia o fixtures del perfil.
 * @business Habilita como agentes de soporte a los usuarios internos que ya existen en desarrollo.
 * @system crea `support_agent_profiles` y sus habilidades a partir de `iam.internal_users`.
 */
import { QueryInterface, QueryTypes } from 'sequelize';
import { atlasSchemaFor } from '../../domain-schemas.js';

type SeedContext = { context: QueryInterface };

const SCHEMA = atlasSchemaFor('support_agent_profiles');
const AGENTS = `${SCHEMA}.support_agent_profiles`;
const SKILLS = `${SCHEMA}.support_agent_skills`;
const QUEUES = `${SCHEMA}.support_queues`;
const INTERNAL_USERS = `${atlasSchemaFor('internal_users')}.internal_users`;

/**
 * Sin agentes habilitados, el motor de soporte funciona pero nadie puede atender.
 *
 * Tener rol interno no habilita a atender clientes: hace falta un perfil de agente con capacidad y
 * habilidades. En desarrollo eso significaría crear el perfil a mano en cada entorno antes de poder
 * probar un chat, así que este seeder habilita a los usuarios internos que ya existen.
 *
 * Va en `development` y no en `production` a propósito: quién atiende soporte en producción es una
 * decisión de operaciones con nombre y apellido, no algo que un seeder deba suponer.
 */
const AGENT_SEED = [
  { level: 'L1', capacity: 4, queue: 'consumer_l1', skills: ['CONSUMER_SUPPORT', 'AUTH'] },
  { level: 'L2', capacity: 2, queue: 'consumer_l2', skills: ['CONSUMER_SUPPORT', 'AUTH', 'CREDIT'] },
  { level: 'SPECIALIST', capacity: 2, queue: 'partner_operations', skills: ['PARTNER_SUPPORT', 'RECONCILIATION'] },
  { level: 'SPECIALIST', capacity: 2, queue: 'security_fraud', skills: ['SECURITY', 'FRAUD', 'PRIVACY'] },
];

export async function up({ context: queryInterface }: SeedContext): Promise<void> {
  const users = await queryInterface.sequelize.query<{ id: string; tenant_id: string }>(
    `SELECT _id AS id, _tenant_id AS tenant_id
       FROM ${INTERNAL_USERS}
      WHERE _deleted = FALSE
      ORDER BY _id
      LIMIT :limit;`,
    { replacements: { limit: AGENT_SEED.length }, type: QueryTypes.SELECT },
  );
  if (!users.length) return;

  for (let index = 0; index < users.length; index += 1) {
    const user = users[index];
    const seed = AGENT_SEED[index % AGENT_SEED.length];
    if (!user || !seed) continue;

    const [profile] = await queryInterface.sequelize.query<{ _id: string }>(
      `INSERT INTO ${AGENTS}
         (_tenant_id, internal_user_id, support_level, default_queue_id, timezone, language_codes_json,
          employment_status, max_concurrent_channels, active_channel_count, presence_state, is_active)
       VALUES (:tenantId, :userId, :level,
               (SELECT _id FROM ${QUEUES} WHERE _tenant_id = :tenantId AND queue_code = :queue LIMIT 1),
               'America/La_Paz', '["es"]'::jsonb, 'active', :capacity, 0, 'OFFLINE', TRUE)
       ON CONFLICT (_tenant_id, internal_user_id) DO UPDATE SET
         support_level = EXCLUDED.support_level,
         default_queue_id = EXCLUDED.default_queue_id,
         max_concurrent_channels = EXCLUDED.max_concurrent_channels,
         _updated_at = NOW()
       RETURNING _id;`,
      {
        replacements: {
          tenantId: String(user.tenant_id),
          userId: String(user.id),
          level: seed.level,
          queue: seed.queue,
          capacity: seed.capacity,
        },
        type: QueryTypes.SELECT,
      },
    );

    for (const skill of seed.skills) {
      await queryInterface.sequelize.query(
        `INSERT INTO ${SKILLS} (_tenant_id, agent_profile_id, skill_code, competency_level, is_active)
         VALUES (:tenantId, :profileId, :skill, 3, TRUE)
         ON CONFLICT (_tenant_id, agent_profile_id, skill_code) DO UPDATE SET
           competency_level = EXCLUDED.competency_level,
           is_active = TRUE,
           _updated_at = NOW();`,
        { replacements: { tenantId: String(user.tenant_id), profileId: String(profile._id), skill } },
      );
    }
  }
}

export async function down({ context: queryInterface }: SeedContext): Promise<void> {
  await queryInterface.sequelize.query(`DELETE FROM ${SKILLS};`);
  await queryInterface.sequelize.query(`DELETE FROM ${AGENTS};`);
}
