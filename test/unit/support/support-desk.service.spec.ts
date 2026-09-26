import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { SupportDeskService } from '../../../src/modules/support/application/support-desk.service.js';
import type { SupportChannelRepository } from '../../../src/modules/support/support-channel.repository.js';
import type { SupportAgentRepository } from '../../../src/modules/support/support-agent.repository.js';
import type { SupportActorService, SupportActor } from '../../../src/modules/support/application/support-actor.service.js';
import type { SupportCatalogRepository } from '../../../src/modules/support/support-catalog.repository.js';

/**
 * La mesa del agente.
 *
 * Lo que se fija es el alta de un agente, que es donde el error no da un mensaje entendible.
 * `uq_support_agent_user` es por (tenant, persona) y NO mira `is_active`, así que dar de alta a
 * alguien que ya tuvo perfil y fue dado de baja chocaría con un error de base que no explica nada.
 * Por eso se REACTIVA el perfil existente, que además conserva el mismo `agent_profile_id` en las
 * asignaciones y los eventos ya escritos —lo único que permite auditar después quién atendió qué—.
 * Y por eso un perfil ya activo es un 409 con su identificador dentro, no un choque de unicidad.
 *
 * También que los códigos de cierre viajen por HTTP desde las constantes del módulo: un catálogo
 * duplicado en el frontend se desincroniza en la primera revisión de la taxonomía, y como la
 * columna fue VARCHAR sin CHECK hasta la migración del 2026-09-05, el desajuste no se habría notado
 * hasta que alguien contara.
 */
const AGENTE = { actorType: 'INTERNAL_USER', actorId: '7', agentProfileId: 'ag-1', isInternal: true } as unknown as SupportActor;

const ALTA: Record<string, unknown> = {
  internalUserId: '7',
  supportLevel: 'L1',
  maxConcurrentChannels: 4,
  timezone: 'America/La_Paz',
  languageCodes: ['es'],
};

describe('SupportDeskService', () => {
  let channels: { listQueuedChannels: jest.Mock };
  let agents: {
    setPresence: jest.Mock;
    listProfiles: jest.Mock;
    internalUserExists: jest.Mock;
    findAnyByInternalUser: jest.Mock;
    findById: jest.Mock;
    createProfile: jest.Mock;
    reactivateProfile: jest.Mock;
    deactivateProfile: jest.Mock;
  };
  let actors: { assertIsAgent: jest.Mock; caseCategoryAudiences: jest.Mock };
  let catalog: { listCategories: jest.Mock; listQueues: jest.Mock; requireQueueByCode: jest.Mock };
  let service: SupportDeskService;

  beforeEach(() => {
    channels = { listQueuedChannels: jest.fn(async () => []) };
    agents = {
      setPresence: jest.fn(async () => undefined),
      listProfiles: jest.fn(async () => []),
      internalUserExists: jest.fn(async () => true),
      findAnyByInternalUser: jest.fn(async () => null),
      findById: jest.fn(async () => ({ id: 'ag-1' })),
      createProfile: jest.fn(async () => ({ id: 55 })),
      reactivateProfile: jest.fn(async () => undefined),
      deactivateProfile: jest.fn(async () => undefined),
    };
    actors = { assertIsAgent: jest.fn(() => 'ag-1'), caseCategoryAudiences: jest.fn(() => ['CUSTOMER', 'PARTNER', 'INTERNAL']) };
    catalog = {
      listCategories: jest.fn(async () => []),
      listQueues: jest.fn(async () => []),
      requireQueueByCode: jest.fn(async () => ({ id: 11 })),
    };
    service = new SupportDeskService(
      channels as unknown as SupportChannelRepository,
      agents as unknown as SupportAgentRepository,
      actors as unknown as SupportActorService,
      catalog as unknown as SupportCatalogRepository,
    );
  });

  describe('la cola y la presencia', () => {
    it('la cola de espera es sólo para el equipo', async () => {
      actors.assertIsAgent.mockImplementationOnce(() => {
        throw new Error('SUPPORT_NOT_AN_AGENT');
      });

      await expect(service.listQueuedChannels({ tenantId: 't1', actor: AGENTE })).rejects.toThrow('SUPPORT_NOT_AN_AGENT');
      expect(channels.listQueuedChannels).not.toHaveBeenCalled();
    });

    it('sin cola indicada se piden todas', async () => {
      await service.listQueuedChannels({ tenantId: 't1', actor: AGENTE });
      expect(channels.listQueuedChannels).toHaveBeenCalledWith('t1', null);

      await service.listQueuedChannels({ tenantId: 't1', actor: AGENTE, queueId: 'q-vip' });
      expect(channels.listQueuedChannels).toHaveBeenCalledWith('t1', 'q-vip');
    });

    it('los canales encolados salen mapeados y sin decir quién es el agente', async () => {
      channels.listQueuedChannels.mockResolvedValueOnce([
        { id: 5, status: 'QUEUED', channelType: 'CHAT', lastMessageSequence: 0, assignedAgentProfileId: null, caseId: null },
      ] as never);

      const cola = await service.listQueuedChannels({ tenantId: 't1', actor: AGENTE });

      expect(cola.channels[0]).toMatchObject({ channelId: '5', status: 'QUEUED', hasAgent: false });
      expect(cola.channels[0]).not.toHaveProperty('assignedAgentProfileId');
    });

    it('la presencia se escribe contra el PERFIL del agente, no contra su usuario', async () => {
      const resultado = await service.setPresence({ tenantId: 't1', actor: AGENTE, presenceState: 'ONLINE' });

      expect(agents.setPresence).toHaveBeenCalledWith('t1', 'ag-1', 'ONLINE');
      expect(resultado).toEqual({ agentProfileId: 'ag-1', presenceState: 'ONLINE' });
    });
  });

  describe('catálogos del triage', () => {
    it('el árbol de motivos se pide para TODAS las audiencias: el agente triaja consumidores y comercios', async () => {
      await service.listInternalCategories({ tenantId: 't1', actor: AGENTE });

      expect(catalog.listCategories).toHaveBeenCalledWith('t1', ['CUSTOMER', 'PARTNER', 'INTERNAL']);
    });

    it('una base recién migrada devuelve la lista vacía y no un error: el catálogo lo siembra otra rama', async () => {
      await expect(service.listInternalCategories({ tenantId: 't1', actor: AGENTE })).resolves.toEqual({ categories: [] });
    });

    it('el árbol interno lleva la proyección interna, con la cola por defecto de cada motivo', async () => {
      catalog.listCategories.mockResolvedValueOnce([
        {
          id: 1,
          categoryCode: 'AUTH',
          label: 'Acceso',
          description: null,
          requiresSpecialist: false,
          parentCategoryId: null,
          defaultQueueId: 99,
        },
      ] as never);

      const { categories } = await service.listInternalCategories({ tenantId: 't1', actor: AGENTE });

      expect(categories[0]).toMatchObject({ categoryCode: 'AUTH', defaultQueueId: '99' });
    });

    it('las colas también son sólo para el equipo, y salen mapeadas', async () => {
      catalog.listQueues.mockResolvedValueOnce([
        {
          id: 11,
          queueCode: 'AUTH_L1',
          name: 'Acceso',
          description: null,
          contextType: 'CUSTOMER',
          defaultPriority: 'NORMAL',
          slaPolicyCode: 'STD',
          skillsRequiredJson: null,
        },
      ] as never);

      const { queues } = await service.listQueues({ tenantId: 't1', actor: AGENTE });

      expect(queues[0]).toMatchObject({ queueId: '11', queueCode: 'AUTH_L1', skillsRequired: [] });
    });

    it('los códigos de cierre viajan con etiqueta y no tocan la base: son constantes del módulo', () => {
      const codigos = service.supportCodes();

      expect(codigos.resolutionCodes.length).toBeGreaterThan(0);
      expect(codigos.resolutionCodes[0]).toEqual({ code: expect.any(String), label: expect.any(String) });
      expect(codigos.rootCauseCodes[0]).toEqual({ code: expect.any(String), label: expect.any(String) });
      expect(codigos.priorities[0]).toEqual({ code: expect.any(String), label: expect.any(String) });
      expect(codigos.caseTypes.length).toBeGreaterThan(0);
      expect(codigos.impacts.length).toBeGreaterThan(0);
      expect(codigos.urgencies.length).toBeGreaterThan(0);
    });

    it('ninguna etiqueta queda sin traducir: un código sin etiqueta se pintaría como «undefined»', () => {
      const codigos = service.supportCodes();

      for (const grupo of [codigos.resolutionCodes, codigos.rootCauseCodes, codigos.priorities]) {
        for (const entrada of grupo) expect(entrada.label).toBeTruthy();
      }
    });
  });

  describe('habilitar y quitar agentes', () => {
    it('una persona interna que no existe en este tenant es 404 antes de tocar nada más', async () => {
      agents.internalUserExists.mockResolvedValueOnce(false as never);

      await expect(service.createAgent({ tenantId: 't1', body: ALTA as never })).rejects.toBeInstanceOf(NotFoundException);
      expect(agents.createProfile).not.toHaveBeenCalled();
      expect(agents.findAnyByInternalUser).not.toHaveBeenCalled();
    });

    it('sin perfil previo se crea uno, con la cola resuelta desde su código', async () => {
      const resultado = await service.createAgent({ tenantId: 't1', body: { ...ALTA, queueCode: 'AUTH_L1' } as never });

      expect(catalog.requireQueueByCode).toHaveBeenCalledWith('t1', 'AUTH_L1');
      expect(agents.createProfile).toHaveBeenCalledWith(expect.objectContaining({ defaultQueueId: '11', internalUserId: '7' }));
      expect(resultado).toEqual({ agentProfileId: '55', reactivated: false });
    });

    it('sin código de cola no se consulta el catálogo y la cola queda nula', async () => {
      await service.createAgent({ tenantId: 't1', body: ALTA as never });

      expect(catalog.requireQueueByCode).not.toHaveBeenCalled();
      expect(agents.createProfile).toHaveBeenCalledWith(expect.objectContaining({ defaultQueueId: null }));
    });

    it('un perfil ya activo es 409 con su identificador dentro, no un choque de unicidad de la base', async () => {
      agents.findAnyByInternalUser.mockResolvedValueOnce({ id: 42, isActive: true, deleted: false } as never);

      const fallo = await service.createAgent({ tenantId: 't1', body: ALTA as never }).catch((error: unknown) => error);

      expect(fallo).toBeInstanceOf(ConflictException);
      expect((fallo as ConflictException).getResponse()).toMatchObject({ code: 'SUPPORT_AGENT_PROFILE_EXISTS', agentProfileId: '42' });
      expect(agents.createProfile).not.toHaveBeenCalled();
    });

    it('un perfil dado de baja se REACTIVA, conservando el mismo identificador para la auditoría', async () => {
      agents.findAnyByInternalUser.mockResolvedValueOnce({ id: 42, isActive: false, deleted: false } as never);

      const resultado = await service.createAgent({ tenantId: 't1', body: ALTA as never });

      expect(agents.reactivateProfile).toHaveBeenCalledWith('t1', '42', {
        supportLevel: 'L1',
        defaultQueueId: null,
        maxConcurrentChannels: 4,
      });
      expect(agents.createProfile).not.toHaveBeenCalled();
      expect(resultado).toEqual({ agentProfileId: '42', reactivated: true });
    });

    it('un perfil borrado también se reactiva en vez de insertar otro: la unicidad no mira el borrado', async () => {
      agents.findAnyByInternalUser.mockResolvedValueOnce({ id: 42, isActive: true, deleted: true } as never);

      await expect(service.createAgent({ tenantId: 't1', body: ALTA as never })).resolves.toEqual({
        agentProfileId: '42',
        reactivated: true,
      });
    });

    it('quitar a alguien que no existe es 404 y no un update silencioso sobre cero filas', async () => {
      agents.findById.mockResolvedValueOnce(null as never);

      await expect(service.deactivateAgent({ tenantId: 't1', agentProfileId: 'ag-9' })).rejects.toBeInstanceOf(NotFoundException);
      expect(agents.deactivateProfile).not.toHaveBeenCalled();
    });

    it('quitar a alguien apaga su perfil y lo declara', async () => {
      const resultado = await service.deactivateAgent({ tenantId: 't1', agentProfileId: 'ag-1' });

      expect(agents.deactivateProfile).toHaveBeenCalledWith('t1', 'ag-1');
      expect(resultado).toEqual({ agentProfileId: 'ag-1', isActive: false });
    });

    it('el listado de agentes no exige ser agente: lo consulta quien administra la mesa', async () => {
      agents.listProfiles.mockResolvedValueOnce([{ agentProfileId: '1' }] as never);

      await expect(service.listAgents({ tenantId: 't1' })).resolves.toEqual({ agents: [{ agentProfileId: '1' }] });
      expect(actors.assertIsAgent).not.toHaveBeenCalled();
    });
  });
});
