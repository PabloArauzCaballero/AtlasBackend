import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { SupportCaseService } from '../../../src/modules/support/application/support-case.service.js';
import type { SupportActor, SupportActorService } from '../../../src/modules/support/application/support-actor.service.js';
import type { SupportAuditService } from '../../../src/modules/support/application/support-audit.service.js';
import type { SupportCaseFactoryService } from '../../../src/modules/support/application/support-case-factory.service.js';
import type { SupportSlaService } from '../../../src/modules/support/application/support-sla.service.js';
import type { SupportCaseCreationEventsService } from '../../../src/modules/support/application/support-case-creation-events.service.js';
import type { SupportCaseUnclassifiedService } from '../../../src/modules/support/application/support-case-unclassified.service.js';
import type { SupportCatalogRepository } from '../../../src/modules/support/support-catalog.repository.js';
import type { SupportCaseRepository } from '../../../src/modules/support/support-case.repository.js';

/**
 * Abrir un caso desde fuera: la app del cliente o el portal del comercio.
 *
 * Dos reglas que el cuerpo de la petición no puede saltarse. La prioridad la pone la regla y no
 * quien grita más fuerte: impacto `PLATFORM_WIDE` y urgencia `CRITICAL` en el cuerpo convertían una
 * consulta de cuotas en P1. Y el comercio a cuyo nombre se abre tiene que ser de quien llama.
 */
const CLIENTE = { actorType: 'CUSTOMER', actorId: '42', customerId: '42', isInternal: false } as SupportActor;
const COMERCIO = { actorType: 'PARTNER_USER', actorId: 'u-9', merchantUserId: 'u-9', isInternal: false } as SupportActor;
const AGENTE = { actorType: 'AGENT', actorId: '7', agentProfileId: 'ag-1', isInternal: true } as SupportActor;

describe('SupportCaseService.openCase', () => {
  let catalog: { findCategoryByCode: jest.Mock; findQueueById: jest.Mock; findActiveSlaPolicy: jest.Mock };
  let cases: { findOpenCasesForCustomer: jest.Mock };
  let factory: { insertCase: jest.Mock; linkReferences: jest.Mock; openInitialChannel: jest.Mock };
  let actors: { assertCategoryAllowed: jest.Mock; assertOwnsPartnerProfile: jest.Mock };
  let service: SupportCaseService;

  beforeEach(() => {
    catalog = {
      findCategoryByCode: jest.fn(async () => ({
        id: 1,
        categoryCode: 'CUOTAS',
        audience: 'ANY',
        defaultCaseType: 'QUESTION',
        defaultImpact: 'INDIVIDUAL',
        defaultUrgency: 'NORMAL',
        defaultQueueId: null,
      })),
      findQueueById: jest.fn(async () => null),
      findActiveSlaPolicy: jest.fn(async () => null),
    };
    cases = { findOpenCasesForCustomer: jest.fn(async () => []) };
    factory = {
      insertCase: jest.fn(async () => ({ id: 9, caseNumber: 'SUP-9' })),
      linkReferences: jest.fn(async () => undefined),
      openInitialChannel: jest.fn(async () => '5'),
    };
    actors = { assertCategoryAllowed: jest.fn(), assertOwnsPartnerProfile: jest.fn(async () => undefined) };
    const sequelize = { transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})) } as unknown as Sequelize;
    service = new SupportCaseService(
      sequelize,
      catalog as unknown as SupportCatalogRepository,
      cases as unknown as SupportCaseRepository,
      { startClocks: jest.fn(async () => undefined) } as unknown as SupportSlaService,
      { record: jest.fn(async () => undefined) } as unknown as SupportAuditService,
      factory as unknown as SupportCaseFactoryService,
      actors as unknown as SupportActorService,
      {
        recordCreationEvents: jest.fn(async () => undefined),
        publishCreation: jest.fn(async () => undefined),
      } as unknown as SupportCaseCreationEventsService,
      {} as unknown as SupportCaseUnclassifiedService,
    );
  });

  const abrir = (actor: SupportActor, dto: Record<string, unknown>) =>
    service.openCase({ tenantId: 't1', actor, dto: { categoryCode: 'CUOTAS', title: 't', description: 'd', ...dto } as never });
  const clasificacion = () => (factory.insertCase.mock.calls[0]?.[0] ?? {}) as { impact?: string; urgency?: string; priority?: string };

  it('el cliente que declara impacto de plataforma y urgencia crítica no se pone en P1', async () => {
    await abrir(CLIENTE, { impact: 'PLATFORM_WIDE', urgency: 'CRITICAL' });

    expect(clasificacion()).toMatchObject({ impact: 'INDIVIDUAL', urgency: 'HIGH' });
    expect(clasificacion().priority).not.toBe('P1');
  });

  it('el equipo sí clasifica a mano', async () => {
    await abrir(AGENTE, { impact: 'PLATFORM_WIDE', urgency: 'CRITICAL' });

    expect(clasificacion()).toMatchObject({ impact: 'PLATFORM_WIDE', urgency: 'CRITICAL', priority: 'P1' });
  });

  it('un comercio que no es suyo no abre el caso: 403 antes de escribir nada', async () => {
    actors.assertOwnsPartnerProfile.mockRejectedValueOnce(new ForbiddenException({ code: 'SUPPORT_CASE_FORBIDDEN' }) as never);

    await expect(abrir(COMERCIO, { partnerProfileId: 'pp-ajeno' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(actors.assertOwnsPartnerProfile).toHaveBeenCalledWith(COMERCIO, 'pp-ajeno', 't1');
    expect(factory.insertCase).not.toHaveBeenCalled();
  });

  it('el cliente no tiene comercio que comprobar', async () => {
    await abrir(CLIENTE, { partnerProfileId: 'pp-1' });

    expect(actors.assertOwnsPartnerProfile).not.toHaveBeenCalled();
  });
});
