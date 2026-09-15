import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { InternalSupportController } from '../../../src/modules/support/internal-support.controller.js';
import type { SupportActorService } from '../../../src/modules/support/application/support-actor.service.js';
import type { SupportCaseReadService } from '../../../src/modules/support/application/support-case-read.service.js';
import type { SupportCaseWorkflowService } from '../../../src/modules/support/application/support-case-workflow.service.js';
import type { SupportCaseEscalationService } from '../../../src/modules/support/application/support-case-escalation.service.js';
import type { SupportCaseClosureService } from '../../../src/modules/support/application/support-case-closure.service.js';
import type { AuthenticatedUser } from '../../../src/common/types/auth.types.js';

/**
 * La consola del agente: once rutas repartidas entre cuatro servicios.
 *
 * Un cruce entre dos de ellas no da error. `triage` donde va `assign` reclasifica un caso en vez de
 * tomarlo; `resolve` donde va `close` deja el expediente abierto habiendo dicho que se cerró;
 * `getTimeline` donde va `getCase` devuelve la historia entera —con notas internas y hashes— a una
 * ruta documentada como ficha. Las tres compilan, responden 200 y no escriben nada raro en ningún
 * log. Sólo se ven desde arriba.
 *
 * Y las once resuelven el actor desde el token ANTES de delegar, porque de ahí sale el perfil de
 * agente: tener rol de analista no habilita a atender clientes, y esa comprobación depende de la
 * base —quién está habilitado hoy— y no del token.
 */
const USUARIO = { role: 'internal_operator', tenantId: 't1', internalUserId: '7' } as AuthenticatedUser;
const ACTOR = { actorType: 'AGENT', actorId: '7', agentProfileId: 'ag-1' } as never;

describe('InternalSupportController', () => {
  let actors: { resolve: jest.Mock };
  let read: { listWorkQueue: jest.Mock; getCase: jest.Mock; getTimeline: jest.Mock };
  let workflow: { triage: jest.Mock; assign: jest.Mock; transfer: jest.Mock };
  let escalation: { escalate: jest.Mock; addInternalNote: jest.Mock; link: jest.Mock };
  let closure: { resolve: jest.Mock; close: jest.Mock };
  let controller: InternalSupportController;

  beforeEach(() => {
    actors = { resolve: jest.fn(async () => ACTOR) };
    read = {
      listWorkQueue: jest.fn(async () => 'cola'),
      getCase: jest.fn(async () => 'ficha'),
      getTimeline: jest.fn(async () => 'historia'),
    };
    workflow = {
      triage: jest.fn(async () => 'triaje'),
      assign: jest.fn(async () => 'asignado'),
      transfer: jest.fn(async () => 'transferido'),
    };
    escalation = {
      escalate: jest.fn(async () => 'escalado'),
      addInternalNote: jest.fn(async () => 'nota'),
      link: jest.fn(async () => 'enlazado'),
    };
    closure = { resolve: jest.fn(async () => 'resuelto'), close: jest.fn(async () => 'cerrado') };

    controller = new InternalSupportController(
      actors as unknown as SupportActorService,
      read as unknown as SupportCaseReadService,
      workflow as unknown as SupportCaseWorkflowService,
      escalation as unknown as SupportCaseEscalationService,
      closure as unknown as SupportCaseClosureService,
    );
  });

  describe('lecturas', () => {
    it('la cola de trabajo pasa la consulta entera al servicio de lectura', async () => {
      await expect(controller.workQueue('t1', { limit: 20, queueId: 'q1' } as never, USUARIO)).resolves.toBe('cola');

      expect(read.listWorkQueue).toHaveBeenCalledWith({ tenantId: 't1', actor: ACTOR, query: { limit: 20, queueId: 'q1' } });
    });

    it('la ficha y la HISTORIA son rutas distintas: la historia lleva notas internas y hashes', async () => {
      await expect(controller.detail('t1', 'caso-1', USUARIO)).resolves.toBe('ficha');
      expect(read.getCase).toHaveBeenCalledWith({ tenantId: 't1', actor: ACTOR, caseId: 'caso-1' });
      expect(read.getTimeline).not.toHaveBeenCalled();

      await expect(controller.timeline('t1', 'caso-1', USUARIO)).resolves.toBe('historia');
      expect(read.getTimeline).toHaveBeenCalledWith({ tenantId: 't1', actor: ACTOR, caseId: 'caso-1' });
    });
  });

  describe('flujo del caso', () => {
    it('triar reclasifica y NO asigna', async () => {
      await expect(controller.triage('t1', 'caso-1', { categoryCode: 'AUTH' } as never, USUARIO)).resolves.toBe('triaje');

      expect(workflow.triage).toHaveBeenCalledWith({ tenantId: 't1', actor: ACTOR, caseId: 'caso-1', dto: { categoryCode: 'AUTH' } });
      expect(workflow.assign).not.toHaveBeenCalled();
    });

    it('tomar el caso asigna y NO reclasifica', async () => {
      await expect(controller.claim('t1', 'caso-1', {} as never, USUARIO)).resolves.toBe('asignado');

      expect(workflow.assign).toHaveBeenCalledWith({ tenantId: 't1', actor: ACTOR, caseId: 'caso-1', dto: {} });
      expect(workflow.triage).not.toHaveBeenCalled();
    });

    it('transferir va a su propio caso de uso, no a asignar', async () => {
      await expect(controller.transfer('t1', 'caso-1', { queueCode: 'L2' } as never, USUARIO)).resolves.toBe('transferido');

      expect(workflow.transfer).toHaveBeenCalledWith({ tenantId: 't1', actor: ACTOR, caseId: 'caso-1', dto: { queueCode: 'L2' } });
      expect(workflow.assign).not.toHaveBeenCalled();
    });
  });

  describe('escalado, notas y enlaces', () => {
    it('escalar, anotar y enlazar van al servicio de escalado, cada uno al suyo', async () => {
      await expect(controller.escalate('t1', 'caso-1', { reason: 'urge' } as never, USUARIO)).resolves.toBe('escalado');
      await expect(controller.note('t1', 'caso-1', { body: 'ojo con esto' } as never, USUARIO)).resolves.toBe('nota');
      await expect(controller.link('t1', 'caso-1', { linkedCaseId: 'caso-2' } as never, USUARIO)).resolves.toBe('enlazado');

      expect(escalation.escalate).toHaveBeenCalledWith(expect.objectContaining({ caseId: 'caso-1', dto: { reason: 'urge' } }));
      expect(escalation.addInternalNote).toHaveBeenCalledWith(expect.objectContaining({ dto: { body: 'ojo con esto' } }));
      expect(escalation.link).toHaveBeenCalledWith(expect.objectContaining({ dto: { linkedCaseId: 'caso-2' } }));
    });

    it('una nota interna NO se confunde con la resolución que ve el cliente', async () => {
      await controller.note('t1', 'caso-1', { body: 'jerga interna' } as never, USUARIO);

      expect(closure.resolve).not.toHaveBeenCalled();
    });
  });

  describe('cierre', () => {
    it('resolver documenta la resolución y NO cierra', async () => {
      await expect(controller.resolve('t1', 'caso-1', { resolutionCode: 'FIXED' } as never, USUARIO)).resolves.toBe('resuelto');

      expect(closure.resolve).toHaveBeenCalledWith({ tenantId: 't1', actor: ACTOR, caseId: 'caso-1', dto: { resolutionCode: 'FIXED' } });
      expect(closure.close).not.toHaveBeenCalled();
    });

    it('cerrar cierra y NO vuelve a resolver: la resolución ya está escrita', async () => {
      await expect(controller.close('t1', 'caso-1', { reason: 'conforme' } as never, USUARIO)).resolves.toBe('cerrado');

      expect(closure.close).toHaveBeenCalledWith({ tenantId: 't1', actor: ACTOR, caseId: 'caso-1', dto: { reason: 'conforme' } });
      expect(closure.resolve).not.toHaveBeenCalled();
    });
  });

  it('las once rutas resuelven el actor desde el token antes de delegar', async () => {
    await controller.workQueue('t1', {} as never, USUARIO);
    await controller.detail('t1', 'c', USUARIO);
    await controller.timeline('t1', 'c', USUARIO);
    await controller.triage('t1', 'c', {} as never, USUARIO);
    await controller.claim('t1', 'c', {} as never, USUARIO);
    await controller.transfer('t1', 'c', {} as never, USUARIO);
    await controller.escalate('t1', 'c', {} as never, USUARIO);
    await controller.note('t1', 'c', {} as never, USUARIO);
    await controller.link('t1', 'c', {} as never, USUARIO);
    await controller.resolve('t1', 'c', {} as never, USUARIO);
    await controller.close('t1', 'c', {} as never, USUARIO);

    expect(actors.resolve).toHaveBeenCalledTimes(11);
    for (const llamada of actors.resolve.mock.calls) expect(llamada).toEqual([USUARIO, 't1']);
  });
});
