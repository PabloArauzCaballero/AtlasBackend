import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { SupportActorService, type SupportActor } from '../../../src/modules/support/application/support-actor.service.js';
import type { SupportAgentRepository } from '../../../src/modules/support/support-agent.repository.js';
import type { PartnerProfileService } from '../../../src/modules/partner-onboarding/application/partner-profile.service.js';
import type { AuthenticatedUser } from '../../../src/common/types/auth.types.js';
import type { SupportCaseModel } from '../../../src/database/models/index.js';

/**
 * Quién actúa y qué puede ver dentro del soporte.
 *
 * Es el archivo de autorización del módulo, y cada una de sus reglas existe porque sin ella algo
 * concreto se filtra.
 *
 * El rol del token dice de qué FAMILIA es quien llama; el perfil de agente dice si además está
 * habilitado para ATENDER. Son cosas distintas a propósito: un analista de riesgo tiene rol interno
 * y no por eso debe entrar en la conversación de un cliente.
 *
 * Un caso `RESTRICTED` —seguridad, fraude, privacidad— no lo abre cualquiera por ser interno: hace
 * falta ser el asignado o un supervisor. Sin esa excepción, «restringido» sería una etiqueta sin
 * efecto.
 *
 * El aislamiento entre comercios se comprueba contra el DUEÑO del expediente y nunca contra el
 * `partnerProfileId` que venga en la petición: confiar en el identificador enviado por el cliente
 * convierte la comprobación en una formalidad que el propio atacante controla.
 *
 * Y la audiencia del motivo no es una etiqueta de presentación: arrastra cola, sensibilidad,
 * impacto y urgencia. Sin comprobarla, un consumidor abría su caso con el motivo de conciliación
 * del comercio y aterrizaba en `partner_operations`, delante de los expedientes de los comercios y
 * fuera de la cola de quien debía atenderle. El código de categoría viaja en el cuerpo, que es por
 * donde se cuela cualquiera.
 */
function usuario(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return { sub: 'sub-1', role: 'customer', tenantId: 't1', ...overrides } as AuthenticatedUser;
}

function actor(overrides: Partial<SupportActor> = {}): SupportActor {
  return {
    actorType: 'AGENT',
    role: 'internal_operator',
    actorId: '7',
    customerId: null,
    merchantUserId: null,
    agentProfileId: 'ag-1',
    agentLevel: 'L1',
    isInternal: true,
    isSupervisor: false,
    displayName: null,
    ...overrides,
  } as SupportActor;
}

function caso(overrides: Record<string, unknown> = {}): SupportCaseModel {
  return {
    id: 7,
    subjectCustomerId: null,
    subjectPartnerProfileId: null,
    openedByActorId: null,
    sensitivity: 'NORMAL',
    currentAssigneeAgentId: null,
    partnerVisibility: 'PARTNER_ORGANIZATION',
    ...overrides,
  } as unknown as SupportCaseModel;
}

describe('SupportActorService', () => {
  let agents: { findByInternalUser: jest.Mock };
  let partners: { requireProfile: jest.Mock };
  let service: SupportActorService;

  beforeEach(() => {
    agents = { findByInternalUser: jest.fn(async () => null) };
    partners = { requireProfile: jest.fn(async () => ({ ownerMerchantUserId: 'u-1' })) };
    service = new SupportActorService(agents as unknown as SupportAgentRepository, partners as unknown as PartnerProfileService);
  });

  describe('resolver el actor', () => {
    it('un cliente nunca es interno ni supervisor, y no se consulta perfil de agente', async () => {
      const resuelto = await service.resolve(usuario({ role: 'customer', customerId: '42' }), 't1');

      expect(resuelto).toMatchObject({ actorType: 'CUSTOMER', actorId: '42', customerId: '42', isInternal: false, isSupervisor: false });
      expect(agents.findByInternalUser).not.toHaveBeenCalled();
    });

    it('un cliente sin `customerId` en el token cae a su `sub`, no a una cadena vacía', async () => {
      const resuelto = await service.resolve(usuario({ role: 'customer' }), 't1');

      expect(resuelto.actorId).toBe('sub-1');
      expect(resuelto.customerId).toBeNull();
    });

    it('un comercio es PARTNER_USER y tampoco consulta perfil de agente', async () => {
      const resuelto = await service.resolve(usuario({ role: 'merchant', merchantUserId: 'u-9' }), 't1');

      expect(resuelto).toMatchObject({ actorType: 'PARTNER_USER', actorId: 'u-9', merchantUserId: 'u-9', isInternal: false });
      expect(agents.findByInternalUser).not.toHaveBeenCalled();
    });

    it('el rol interno NO da perfil de agente: son cosas distintas a propósito', async () => {
      const resuelto = await service.resolve(usuario({ role: 'risk_analyst', internalUserId: '7' }), 't1');

      expect(resuelto.isInternal).toBe(true);
      expect(resuelto.agentProfileId).toBeNull();
      expect(resuelto.agentLevel).toBeNull();
    });

    it('con perfil habilitado llegan su identificador y su nivel', async () => {
      agents.findByInternalUser.mockResolvedValueOnce({ id: 55, supportLevel: 'L2' } as never);

      const resuelto = await service.resolve(usuario({ role: 'internal_operator', internalUserId: '7' }), 't1');

      expect(resuelto).toMatchObject({ agentProfileId: '55', agentLevel: 'L2' });
    });

    it('`admin` y `platform_admin` son SUPERVISOR; el resto de roles internos, AGENT', async () => {
      for (const rol of ['admin', 'platform_admin']) {
        const resuelto = await service.resolve(usuario({ role: rol as never, internalUserId: '7' }), 't1');
        expect(resuelto).toMatchObject({ actorType: 'SUPERVISOR', isSupervisor: true, isInternal: true });
      }

      const analista = await service.resolve(usuario({ role: 'fraud_analyst', internalUserId: '7' }), 't1');
      expect(analista).toMatchObject({ actorType: 'AGENT', isSupervisor: false });
    });

    it('un auditor de sólo lectura es interno pero no supervisor', async () => {
      const resuelto = await service.resolve(usuario({ role: 'readonly_auditor', internalUserId: '7' }), 't1');

      expect(resuelto).toMatchObject({ isInternal: true, isSupervisor: false });
    });

    it('un rol desconocido no se cuela como interno', async () => {
      const resuelto = await service.resolve(usuario({ role: 'rol_raro' as never, internalUserId: '7' }), 't1');

      expect(resuelto.isInternal).toBe(false);
    });
  });

  describe('exigir perfil de agente', () => {
    it('sin perfil es 403 con un código que explica qué falta, no un 500', () => {
      const fallo = (() => {
        try {
          service.assertIsAgent(actor({ agentProfileId: null }));
        } catch (error) {
          return error;
        }
      })();

      expect(fallo).toBeInstanceOf(ForbiddenException);
      expect((fallo as ForbiddenException).getResponse()).toMatchObject({ code: 'SUPPORT_AGENT_PROFILE_REQUIRED' });
    });

    it('con perfil devuelve su identificador, que es lo que usan los llamadores', () => {
      expect(service.assertIsAgent(actor({ agentProfileId: 'ag-9' }))).toBe('ag-9');
    });
  });

  describe('ver un expediente: cliente', () => {
    it('ve el suyo', async () => {
      const cliente = actor({ actorType: 'CUSTOMER', customerId: '42', isInternal: false });

      await expect(service.assertCanViewCase(cliente, caso({ subjectCustomerId: 42 }), 't1')).resolves.toBeUndefined();
    });

    it('no ve el de otro', async () => {
      const cliente = actor({ actorType: 'CUSTOMER', customerId: '42', isInternal: false });

      await expect(service.assertCanViewCase(cliente, caso({ subjectCustomerId: 99 }), 't1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('un caso sin cliente asociado tampoco es suyo', async () => {
      const cliente = actor({ actorType: 'CUSTOMER', customerId: '42', isInternal: false });

      await expect(service.assertCanViewCase(cliente, caso({ subjectCustomerId: null }), 't1')).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('ver un expediente: personal interno', () => {
    it('un interno ve un caso normal', async () => {
      await expect(service.assertCanViewCase(actor(), caso(), 't1')).resolves.toBeUndefined();
    });

    it('un RESTRINGIDO no lo abre cualquiera por ser interno', async () => {
      const fallo = await service
        .assertCanViewCase(actor({ agentProfileId: 'ag-1' }), caso({ sensitivity: 'RESTRICTED', currentAssigneeAgentId: 'ag-otro' }), 't1')
        .catch((error: unknown) => error);

      expect(fallo).toBeInstanceOf(ForbiddenException);
      expect((fallo as ForbiddenException).getResponse()).toMatchObject({ code: 'SUPPORT_CASE_RESTRICTED' });
    });

    it('sí lo abre su responsable', async () => {
      await expect(
        service.assertCanViewCase(
          actor({ agentProfileId: 'ag-1' }),
          caso({ sensitivity: 'RESTRICTED', currentAssigneeAgentId: 'ag-1' }),
          't1',
        ),
      ).resolves.toBeUndefined();
    });

    it('y un supervisor, esté asignado o no', async () => {
      await expect(
        service.assertCanViewCase(
          actor({ isSupervisor: true, agentProfileId: null }),
          caso({ sensitivity: 'RESTRICTED', currentAssigneeAgentId: 'ag-otro' }),
          't1',
        ),
      ).resolves.toBeUndefined();
    });

    it('un restringido SIN responsable no se abre por defecto', async () => {
      await expect(
        service.assertCanViewCase(actor(), caso({ sensitivity: 'RESTRICTED', currentAssigneeAgentId: null }), 't1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('quien no es interno ni cliente ni comercio no ve nada', async () => {
      await expect(service.assertCanViewCase(actor({ actorType: 'AGENT', isInternal: false }), caso(), 't1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('ver un expediente: aislamiento entre comercios', () => {
    const empleado = () =>
      actor({ actorType: 'PARTNER_USER', merchantUserId: 'u-1', actorId: 'u-1', isInternal: false, agentProfileId: null });

    it('el dueño del expediente lo ve, y el dueño se lee de la BASE, no de la petición', async () => {
      partners.requireProfile.mockResolvedValueOnce({ ownerMerchantUserId: 'u-1' } as never);

      await expect(service.assertCanViewCase(empleado(), caso({ subjectPartnerProfileId: 'pp-1' }), 't1')).resolves.toBeUndefined();
      expect(partners.requireProfile).toHaveBeenCalledWith('t1', 'pp-1');
    });

    it('un empleado de OTRO comercio no lo ve', async () => {
      partners.requireProfile.mockResolvedValueOnce({ ownerMerchantUserId: 'u-ajeno' } as never);

      await expect(service.assertCanViewCase(empleado(), caso({ subjectPartnerProfileId: 'pp-1' }), 't1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('un empleado que no es dueño pero ABRIÓ el caso sí lo ve', async () => {
      partners.requireProfile.mockResolvedValueOnce({ ownerMerchantUserId: 'u-ajeno' } as never);

      await expect(
        service.assertCanViewCase(empleado(), caso({ subjectPartnerProfileId: 'pp-1', openedByActorId: 'u-1' }), 't1'),
      ).resolves.toBeUndefined();
    });

    it('un caso sin comercio asociado, o un actor sin usuario de comercio, no pasa', async () => {
      await expect(service.assertCanViewCase(empleado(), caso({ subjectPartnerProfileId: null }), 't1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(partners.requireProfile).not.toHaveBeenCalled();

      await expect(
        service.assertCanViewCase(
          actor({ actorType: 'PARTNER_USER', merchantUserId: null, isInternal: false }),
          caso({ subjectPartnerProfileId: 'pp-1' }),
          't1',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('un caso marcado ATLAS_ONLY no lo ve el comercio ni siendo el dueño', async () => {
      const fallo = await service
        .assertCanViewCase(empleado(), caso({ subjectPartnerProfileId: 'pp-1', partnerVisibility: 'ATLAS_ONLY' }), 't1')
        .catch((error: unknown) => error);

      expect((fallo as ForbiddenException).getResponse()).toMatchObject({ code: 'SUPPORT_CASE_INTERNAL_ONLY' });
    });

    it('uno PRIVADO PARA QUIEN LO ABRIÓ no lo ve el dueño si lo abrió otro', async () => {
      await expect(
        service.assertCanViewCase(
          empleado(),
          caso({ subjectPartnerProfileId: 'pp-1', partnerVisibility: 'PRIVATE_TO_REQUESTER', openedByActorId: 'u-otro' }),
          't1',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('y sí lo ve quien lo abrió', async () => {
      await expect(
        service.assertCanViewCase(
          empleado(),
          caso({ subjectPartnerProfileId: 'pp-1', partnerVisibility: 'PRIVATE_TO_REQUESTER', openedByActorId: 'u-1' }),
          't1',
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe('audiencias del catálogo', () => {
    it('cada familia ve sus motivos, y `ANY` está en todas', () => {
      expect(service.caseCategoryAudiences(actor())).toEqual(['CONSUMER', 'PARTNER_USER', 'PARTNER_ORGANIZATION', 'INTERNAL', 'ANY']);
      expect(service.caseCategoryAudiences(actor({ actorType: 'PARTNER_USER', isInternal: false }))).toEqual([
        'PARTNER_USER',
        'PARTNER_ORGANIZATION',
        'ANY',
      ]);
      expect(service.caseCategoryAudiences(actor({ actorType: 'CUSTOMER', isInternal: false }))).toEqual(['CONSUMER', 'ANY']);
      expect(service.caseCategoryAudiences(actor({ actorType: 'AGENT', isInternal: false }))).toEqual(['ANY']);
    });

    it('un consumidor NO puede abrir con el motivo del comercio: aterrizaría en su cola', () => {
      const consumidor = actor({ actorType: 'CUSTOMER', isInternal: false });

      const fallo = (() => {
        try {
          service.assertCategoryAllowed(consumidor, { categoryCode: 'PARTNER_RECON', audience: 'PARTNER_ORGANIZATION' });
        } catch (error) {
          return error;
        }
      })();

      expect(fallo).toBeInstanceOf(ForbiddenException);
      expect((fallo as ForbiddenException).getResponse()).toMatchObject({
        code: 'SUPPORT_CATEGORY_NOT_ALLOWED',
        categoryCode: 'PARTNER_RECON',
        audience: 'PARTNER_ORGANIZATION',
      });
    });

    it('el rechazo NO es «no encontrado»: el motivo existe y decir lo contrario manda a buscar un error que no hay', () => {
      const consumidor = actor({ actorType: 'CUSTOMER', isInternal: false });

      expect(() => service.assertCategoryAllowed(consumidor, { categoryCode: 'X', audience: 'INTERNAL' })).toThrow(ForbiddenException);
    });

    it('un motivo de cualquiera se permite a todos', () => {
      for (const quien of [
        actor({ actorType: 'CUSTOMER', isInternal: false }),
        actor({ actorType: 'PARTNER_USER', isInternal: false }),
        actor(),
      ]) {
        expect(() => service.assertCategoryAllowed(quien, { categoryCode: 'COMPLAINT', audience: 'ANY' })).not.toThrow();
      }
    });
  });

  describe('audiencias de conocimiento', () => {
    it('el cliente no llega al material de comercios ni al interno', () => {
      const audiencias = service.knowledgeAudiences(actor({ actorType: 'CUSTOMER', isInternal: false }));

      expect(audiencias).toEqual(['PUBLIC_CONSUMER', 'AUTHENTICATED_CONSUMER']);
      expect(audiencias).not.toContain('INTERNAL_SUPPORT');
    });

    it('el comercio ve lo público y lo suyo, no el material de consumidor autenticado', () => {
      expect(service.knowledgeAudiences(actor({ actorType: 'PARTNER_USER', isInternal: false }))).toEqual(['PUBLIC_CONSUMER', 'PARTNER']);
    });

    it('el equipo lo ve todo, incluida la guía interna', () => {
      expect(service.knowledgeAudiences(actor())).toContain('INTERNAL_SUPPORT');
    });

    it('quien no encaja en ninguna familia sólo ve lo público', () => {
      expect(service.knowledgeAudiences(actor({ actorType: 'AGENT', isInternal: false }))).toEqual(['PUBLIC_CONSUMER']);
    });
  });
});
