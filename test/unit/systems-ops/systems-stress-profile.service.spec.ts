import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SystemsStressProfileService } from '../../../src/modules/systems-ops/systems-stress-profile.service.js';

/**
 * `SystemsStressProfileService` gestiona los perfiles de estrés por endpoint: listado/detalle,
 * upsert (con código derivado del endpoint) y la matriz endpoint→perfiles. Spec directo con los dos
 * repos mockeados; los mappers y `actorId` corren de verdad.
 */
describe('SystemsStressProfileService', () => {
  function build() {
    const catalogRepository = { findEndpointById: jest.fn(async (..._args: unknown[]) => null) };
    const stressRepository = {
      listStressProfiles: jest.fn(async (..._args: unknown[]) => ({ rows: [] as unknown[], meta: {} })),
      findStressProfileById: jest.fn(async (..._args: unknown[]) => null),
      findStressProfileByCode: jest.fn(async (..._args: unknown[]) => null as unknown),
      upsertStressProfile: jest.fn(async (..._args: unknown[]) => ({ id: 1, endpointId: 5, code: 'STRESS_EP', isEnabled: true })),
      listStressRequiredEndpoints: jest.fn(async (..._args: unknown[]) => ({ rows: [] as unknown[], meta: {} })),
      findStressProfilesByEndpointIds: jest.fn(async (..._args: unknown[]) => [] as unknown[]),
    };
    const service = new SystemsStressProfileService(catalogRepository as never, stressRepository as never);
    return { service, catalogRepository, stressRepository };
  }

  const user = { role: 'system_admin', tenantId: 't1', internalUserId: 'u1', platformUserId: null } as never;

  it('listStressProfiles mapea filas y propaga meta', async () => {
    const { service, stressRepository } = build();
    (stressRepository.listStressProfiles as jest.Mock).mockResolvedValueOnce({
      rows: [{ id: 1, endpointId: 5, code: 'C' }],
      meta: { page: 1 },
    } as never);
    const res = await service.listStressProfiles({} as never);
    expect(res.items[0]).toMatchObject({ profileId: '1', endpointId: '5' });
    expect(res.meta).toEqual({ page: 1 });
  });

  it('getStressProfile lanza NotFound o mapea la fila', async () => {
    const { service, stressRepository } = build();
    await expect(service.getStressProfile('1')).rejects.toBeInstanceOf(NotFoundException);
    (stressRepository.findStressProfileById as jest.Mock).mockResolvedValueOnce({ id: 1, endpointId: 5 } as never);
    expect(await service.getStressProfile('1')).toMatchObject({ profileId: '1' });
  });

  it('upsertStressProfile falla con NotFound si el endpoint no existe', async () => {
    const { service } = build();
    await expect(service.upsertStressProfile({ endpointId: '5' } as never, user)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('upsertStressProfile deriva el código por defecto STRESS_<endpoint> y pasa el actor', async () => {
    const { service, catalogRepository, stressRepository } = build();
    (catalogRepository.findEndpointById as jest.Mock).mockResolvedValueOnce({ id: 5, code: 'EP' } as never);
    await service.upsertStressProfile({ endpointId: '5', targetRps: 10 } as never, user);
    const [args] = (stressRepository.upsertStressProfile as jest.Mock).mock.calls[0] as [Record<string, unknown>];
    expect(args).toMatchObject({ endpointId: '5', code: 'STRESS_EP' });
    expect(args.actorId).toBeDefined();
  });

  it('upsertStressProfile respeta el código explícito del body si viene', async () => {
    const { service, catalogRepository, stressRepository } = build();
    (catalogRepository.findEndpointById as jest.Mock).mockResolvedValueOnce({ id: 5, code: 'EP' } as never);
    await service.upsertStressProfile({ endpointId: '5', code: 'CUSTOM_CODE' } as never, user);
    const [args] = (stressRepository.upsertStressProfile as jest.Mock).mock.calls[0] as [Record<string, unknown>];
    expect(args.code).toBe('CUSTOM_CODE');
  });

  describe('quien ejecuta no se quita la aprobación', () => {
    const runner = (role: string) => ({ role, tenantId: 't1', internalUserId: 'u2', platformUserId: null }) as never;
    const endpoint = { id: 5, code: 'EP' } as never;

    it.each(['devops', 'qa_engineer'])('%s no puede crear ni dejar un perfil sin aprobación', async (role) => {
      const { service, catalogRepository, stressRepository } = build();
      (catalogRepository.findEndpointById as jest.Mock).mockResolvedValue(endpoint);
      // Perfil nuevo.
      await expect(service.upsertStressProfile({ endpointId: '5', requiresApproval: false } as never, runner(role))).rejects.toThrow(
        'SYSTEM_STRESS_APPROVAL_WAIVER_REQUIRES_GOVERNANCE',
      );
      // Perfil existente que hoy SÍ pide aprobación: reescribirlo con `false` es bajar el control.
      (stressRepository.findStressProfileByCode as jest.Mock).mockResolvedValueOnce({ requiresApproval: true } as never);
      await expect(service.upsertStressProfile({ endpointId: '5', requiresApproval: false } as never, runner(role))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(stressRepository.findStressProfileByCode).toHaveBeenLastCalledWith('STRESS_EP');
      expect(stressRepository.upsertStressProfile).not.toHaveBeenCalled();
    });

    it('un perfil que ya estaba sin aprobación se sigue pudiendo editar', async () => {
      const { service, catalogRepository, stressRepository } = build();
      (catalogRepository.findEndpointById as jest.Mock).mockResolvedValue(endpoint);
      (stressRepository.findStressProfileByCode as jest.Mock).mockResolvedValueOnce({ requiresApproval: false } as never);
      await service.upsertStressProfile({ endpointId: '5', requiresApproval: false, targetRps: 3 } as never, runner('devops'));
      expect(stressRepository.upsertStressProfile).toHaveBeenCalledTimes(1);
    });

    it('con aprobación exigida cualquiera de los roles de estrés guarda, sin consulta previa', async () => {
      const { service, catalogRepository, stressRepository } = build();
      (catalogRepository.findEndpointById as jest.Mock).mockResolvedValue(endpoint);
      await service.upsertStressProfile({ endpointId: '5', requiresApproval: true } as never, runner('qa_engineer'));
      expect(stressRepository.findStressProfileByCode).not.toHaveBeenCalled();
      expect(stressRepository.upsertStressProfile).toHaveBeenCalledTimes(1);
    });

    it.each(['system_admin', 'platform_admin'])('%s sí puede dejar un perfil sin aprobación', async (role) => {
      const { service, catalogRepository, stressRepository } = build();
      (catalogRepository.findEndpointById as jest.Mock).mockResolvedValue(endpoint);
      await service.upsertStressProfile({ endpointId: '5', requiresApproval: false } as never, runner(role));
      expect(stressRepository.upsertStressProfile).toHaveBeenCalledTimes(1);
    });
  });

  it('getStressMatrix agrupa perfiles por endpoint y calcula hasEnabledProfile', async () => {
    const { service, stressRepository } = build();
    (stressRepository.listStressRequiredEndpoints as jest.Mock).mockResolvedValueOnce({
      rows: [
        { id: 5, code: 'EP5' },
        { id: 6, code: 'EP6' },
      ],
      meta: { page: 1 },
    } as never);
    (stressRepository.findStressProfilesByEndpointIds as jest.Mock).mockResolvedValueOnce([
      { id: 1, endpointId: 5, isEnabled: true },
      { id: 2, endpointId: 5, isEnabled: false },
    ] as never);
    const res = await service.getStressMatrix({} as never);
    expect(stressRepository.findStressProfilesByEndpointIds).toHaveBeenCalledWith(['5', '6']);
    const ep5 = res.items.find((item) => item.endpoint.endpointId === '5');
    const ep6 = res.items.find((item) => item.endpoint.endpointId === '6');
    expect(ep5?.profiles).toHaveLength(2);
    expect(ep5?.hasEnabledProfile).toBe(true);
    expect(ep6?.profiles).toHaveLength(0);
    expect(ep6?.hasEnabledProfile).toBe(false);
  });
});
