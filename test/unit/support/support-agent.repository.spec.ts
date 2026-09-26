import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Sequelize } from 'sequelize-typescript';
import { SupportAgentRepository } from '../../../src/modules/support/support-agent.repository.js';
import type { SupportAgentProfileModel, SupportAgentSkillModel } from '../../../src/database/models/index.js';

/**
 * Los perfiles de la mesa de atención.
 *
 * Lo que se fija son las tres decisiones que hacen que dar de alta a un agente no falle de forma
 * incomprensible. `uq_support_agent_user` es por (tenant, persona) y NO mira `is_active`, así que
 * volver a insertar choca: por eso quitar a alguien apaga el perfil en vez de borrarlo, el listado
 * enseña también a los inactivos —esconderlos haría que el alta siguiente fallara con un choque de
 * unicidad que nadie sabría explicar—, y volver a darle de alta REACTIVA el perfil existente, que
 * además conserva la historia: las asignaciones y los eventos ya escritos siguen apuntando al mismo
 * `agent_profile_id`, que es lo que una auditoría necesita para saber quién atendió qué. Y la
 * existencia del usuario interno se comprueba ANTES de insertar, porque la clave foránea diría lo
 * mismo con un error de Postgres que llega al cliente como 500 y que no distingue «no existe» de
 * «existe en otro tenant».
 */
type Doble = { create: jest.Mock; findOne: jest.Mock; findAll: jest.Mock; update: jest.Mock };

function doble(): Doble {
  return {
    create: jest.fn(async (values: unknown) => values),
    findOne: jest.fn(async () => null),
    findAll: jest.fn(async () => []),
    update: jest.fn(async () => [0]),
  };
}

function ultima(mock: jest.Mock): { where: Record<string | symbol, unknown>; transaction?: unknown } {
  return mock.mock.calls.at(-1)?.[0] as { where: Record<string, unknown> };
}

describe('SupportAgentRepository', () => {
  let query: jest.Mock;
  let agents: Doble;
  let skills: Doble;
  let repo: SupportAgentRepository;
  const tx = {} as never;

  beforeEach(() => {
    query = jest.fn(async () => []);
    agents = doble();
    skills = doble();
    repo = new SupportAgentRepository(
      { query } as unknown as Sequelize,
      agents as unknown as typeof SupportAgentProfileModel,
      skills as unknown as typeof SupportAgentSkillModel,
    );
  });

  describe('leer perfiles', () => {
    it('por persona y por id, siempre con tenant y sin los borrados', async () => {
      await repo.findByInternalUser('t1', '7', { transaction: tx });
      expect(ultima(agents.findOne).where).toEqual({ tenantId: 't1', internalUserId: '7', deleted: false });
      expect(ultima(agents.findOne).transaction).toBe(tx);

      await repo.findById('t1', 'ag-1');
      expect(ultima(agents.findOne).where).toEqual({ tenantId: 't1', id: 'ag-1', deleted: false });
    });

    it('la consulta que decide si un alta choca NO filtra por activo: la unicidad tampoco lo hace', async () => {
      await repo.findAnyByInternalUser('t1', '7');

      expect(ultima(agents.findOne).where).toEqual({ tenantId: 't1', internalUserId: '7' });
    });

    it('el listado cruza con la persona: un listado de identificadores obliga a cruzarlo a mano', async () => {
      await repo.listProfiles('t1');

      const [sql, opciones] = query.mock.calls.at(-1) as [string, { replacements: Record<string, unknown> }];
      expect(sql).toContain('LEFT JOIN');
      expect(sql).toContain('person.full_name');
      expect(sql).toContain('agent._deleted = FALSE');
      expect(opciones.replacements).toEqual({ tenantId: 't1' });
    });

    it('los inactivos también salen, y detrás de los activos', async () => {
      const [sql] = (await repo.listProfiles('t1'), query.mock.calls.at(-1) as [string]);

      expect(sql).not.toContain('is_active = TRUE');
      expect(sql).toContain('ORDER BY agent.is_active DESC');
    });

    it('normaliza identificadores a texto y capacidades a número', async () => {
      query.mockResolvedValueOnce([
        {
          _id: 5,
          internal_user_id: 7,
          email: 'ana@atlas.bo',
          full_name: 'Ana Rojas',
          role_code: 'support_agent',
          support_level: 'L1',
          default_queue_id: 11,
          max_concurrent_channels: '4',
          active_channel_count: '2',
          presence_state: 'ONLINE',
          employment_status: 'active',
          is_active: true,
        },
      ] as never);

      const [fila] = await repo.listProfiles('t1');

      expect(fila).toEqual({
        agentProfileId: '5',
        internalUserId: '7',
        email: 'ana@atlas.bo',
        fullName: 'Ana Rojas',
        roleCode: 'support_agent',
        supportLevel: 'L1',
        defaultQueueId: '11',
        maxConcurrentChannels: 4,
        activeChannelCount: 2,
        presenceState: 'ONLINE',
        employmentStatus: 'active',
        isActive: true,
      });
    });

    it('un agente sin cola por defecto la declara nula en vez de la cadena «null»', async () => {
      query.mockResolvedValueOnce([
        {
          _id: 5,
          internal_user_id: 7,
          email: null,
          full_name: null,
          role_code: null,
          support_level: 'L1',
          default_queue_id: null,
          max_concurrent_channels: 4,
          active_channel_count: 0,
          presence_state: 'OFFLINE',
          employment_status: 'active',
          is_active: false,
        },
      ] as never);

      const [fila] = await repo.listProfiles('t1');

      expect(fila.defaultQueueId).toBeNull();
      expect(fila.fullName).toBeNull();
    });
  });

  describe('existencia del usuario interno', () => {
    it('se comprueba antes de insertar, acotada al tenant y a lo no borrado', async () => {
      query.mockResolvedValueOnce([{ total: '1' }] as never);

      await expect(repo.internalUserExists('t1', '7')).resolves.toBe(true);
      const [sql, opciones] = query.mock.calls.at(-1) as [string, { replacements: Record<string, unknown> }];
      expect(sql).toContain('_tenant_id = :tenantId');
      expect(sql).toContain('COALESCE(_deleted, FALSE) = FALSE');
      expect(opciones.replacements).toEqual({ tenantId: 't1', internalUserId: '7' });
    });

    it('alguien de otro tenant no existe para este: la clave foránea no sabría distinguirlo', async () => {
      query.mockResolvedValueOnce([{ total: '0' }] as never);
      await expect(repo.internalUserExists('t1', '7')).resolves.toBe(false);
    });

    it('una respuesta vacía se lee como «no existe» y no como NaN', async () => {
      query.mockResolvedValueOnce([] as never);
      await expect(repo.internalUserExists('t1', '7')).resolves.toBe(false);
    });
  });

  describe('alta, baja y reactivación', () => {
    it('un perfil nuevo nace desconectado, sin canales y activo', async () => {
      await repo.createProfile({
        tenantId: 't1',
        internalUserId: '7',
        supportLevel: 'L1',
        defaultQueueId: null,
        maxConcurrentChannels: 4,
        timezone: 'America/La_Paz',
        languageCodes: ['es'],
      });

      const [values] = agents.create.mock.calls.at(-1) as [Record<string, unknown>];
      expect(values).toMatchObject({
        employmentStatus: 'active',
        activeChannelCount: 0,
        presenceState: 'OFFLINE',
        isActive: true,
        deleted: false,
        languageCodesJson: ['es'],
      });
      expect(values.presenceChangedAt).toBeInstanceOf(Date);
    });

    it('reactivar reutiliza el perfil existente y le devuelve la capacidad a cero', async () => {
      await repo.reactivateProfile('t1', 'ag-1', { supportLevel: 'L2', defaultQueueId: '11', maxConcurrentChannels: 6 });

      const [values, opciones] = agents.update.mock.calls.at(-1) as [Record<string, unknown>, { where: unknown }];
      expect(values).toMatchObject({
        supportLevel: 'L2',
        defaultQueueId: '11',
        maxConcurrentChannels: 6,
        employmentStatus: 'active',
        isActive: true,
        deleted: false,
        activeChannelCount: 0,
        presenceState: 'OFFLINE',
      });
      expect(opciones.where).toEqual({ tenantId: 't1', id: 'ag-1' });
    });

    it('dar de baja apaga el perfil y lo desconecta, sin borrar la historia', async () => {
      await repo.deactivateProfile('t1', 'ag-1');

      const [values, opciones] = agents.update.mock.calls.at(-1) as [Record<string, unknown>, { where: unknown }];
      expect(values).toMatchObject({ isActive: false, employmentStatus: 'inactive', presenceState: 'OFFLINE' });
      expect(values).not.toHaveProperty('deleted');
      expect(opciones.where).toEqual({ tenantId: 't1', id: 'ag-1', deleted: false });
    });
  });

  describe('destrezas y presencia', () => {
    it('sólo cuentan las destrezas vigentes del agente', async () => {
      await repo.listSkills('t1', 'ag-1');

      expect(ultima(skills.findAll).where).toEqual({ tenantId: 't1', agentProfileId: 'ag-1', isActive: true, deleted: false });
    });

    it('cambiar la presencia sella cuándo cambió: la antigüedad del estado decide el reparto', async () => {
      await repo.setPresence('t1', 'ag-1', 'ONLINE');

      const [values, opciones] = agents.update.mock.calls.at(-1) as [Record<string, unknown>, { where: unknown }];
      expect(values.presenceState).toBe('ONLINE');
      expect(values.presenceChangedAt).toBeInstanceOf(Date);
      expect(opciones.where).toEqual({ tenantId: 't1', id: 'ag-1', deleted: false });
    });
  });
});
