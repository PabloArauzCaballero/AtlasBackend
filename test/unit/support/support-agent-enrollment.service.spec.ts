import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { UniqueConstraintError } from 'sequelize';
import { SupportAgentEnrollmentService } from '../../../src/modules/support/application/support-agent-enrollment.service.js';
import type { SupportAgentRepository } from '../../../src/modules/support/support-agent.repository.js';

/**
 * El perfil de agente nace del rol.
 *
 * Antes, dar el rol `SUPPORT_AGENT` en el portal no creaba el perfil y cada ruta de la mesa
 * respondía 403 `SUPPORT_AGENT_PROFILE_REQUIRED`, también al SUPER_ADMIN: nadie podía contestar un
 * chat. Estas pruebas fijan quién entra solo, quién no, y que una baja explícita se respeta.
 */
describe('SupportAgentEnrollmentService', () => {
  let agents: { findByInternalUser: jest.Mock; findAnyByInternalUser: jest.Mock; activeRoleCodes: jest.Mock; createProfile: jest.Mock };
  let service: SupportAgentEnrollmentService;

  beforeEach(() => {
    agents = {
      findByInternalUser: jest.fn(async () => null),
      findAnyByInternalUser: jest.fn(async () => null),
      activeRoleCodes: jest.fn(async () => [] as string[]),
      createProfile: jest.fn(async () => ({ id: 90, supportLevel: 'L1' })),
    };
    service = new SupportAgentEnrollmentService(agents as unknown as SupportAgentRepository);
  });

  it('con perfil vivo lo devuelve sin mirar roles ni crear nada', async () => {
    agents.findByInternalUser.mockResolvedValueOnce({ id: 5 } as never);

    await expect(service.ensureProfile('t1', '3')).resolves.toEqual({ id: 5 });
    expect(agents.activeRoleCodes).not.toHaveBeenCalled();
    expect(agents.createProfile).not.toHaveBeenCalled();
  });

  it('con el rol SUPPORT_AGENT y sin perfil, lo crea como L1 sin cola fija', async () => {
    agents.activeRoleCodes.mockResolvedValueOnce(['SUPPORT_AGENT'] as never);

    await expect(service.ensureProfile('t1', '3')).resolves.toEqual({ id: 90, supportLevel: 'L1' });
    expect(agents.createProfile).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', internalUserId: '3', supportLevel: 'L1', defaultQueueId: null }),
    );
  });

  it('un SUPER_ADMIN entra como supervisor', async () => {
    agents.activeRoleCodes.mockResolvedValueOnce(['SUPER_ADMIN'] as never);

    await service.ensureProfile('t1', '1');
    expect(agents.createProfile).toHaveBeenCalledWith(expect.objectContaining({ supportLevel: 'SUPERVISOR' }));
  });

  it('un rol interno que no atiende (riesgo) no recibe perfil', async () => {
    agents.activeRoleCodes.mockResolvedValueOnce(['RISK_ANALYST'] as never);

    await expect(service.ensureProfile('t1', '8')).resolves.toBeNull();
    expect(agents.createProfile).not.toHaveBeenCalled();
  });

  it('una baja explícita manda sobre el rol: no se recrea', async () => {
    agents.findAnyByInternalUser.mockResolvedValueOnce({ id: 5, deleted: true } as never);

    await expect(service.ensureProfile('t1', '3')).resolves.toBeNull();
    expect(agents.activeRoleCodes).not.toHaveBeenCalled();
    expect(agents.createProfile).not.toHaveBeenCalled();
  });

  it('si otra petición lo creó a la vez, devuelve el que quedó', async () => {
    agents.activeRoleCodes.mockResolvedValueOnce(['SUPPORT_AGENT'] as never);
    agents.createProfile.mockRejectedValueOnce(new UniqueConstraintError({}) as never);
    agents.findByInternalUser.mockResolvedValueOnce(null as never).mockResolvedValueOnce({ id: 91 } as never);

    await expect(service.ensureProfile('t1', '3')).resolves.toEqual({ id: 91 });
  });

  it('otro error de base no se traga', async () => {
    agents.activeRoleCodes.mockResolvedValueOnce(['SUPPORT_AGENT'] as never);
    agents.createProfile.mockRejectedValueOnce(new Error('boom') as never);

    await expect(service.ensureProfile('t1', '3')).rejects.toThrow('boom');
  });
});
