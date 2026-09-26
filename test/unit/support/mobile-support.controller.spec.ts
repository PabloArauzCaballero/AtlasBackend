import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { MobileSupportController } from '../../../src/modules/support/mobile-support.controller.js';
import type { SupportActorService } from '../../../src/modules/support/application/support-actor.service.js';
import type { SupportCaseService } from '../../../src/modules/support/application/support-case.service.js';
import type { SupportCaseReadService } from '../../../src/modules/support/application/support-case-read.service.js';
import type { SupportCaseClosureService } from '../../../src/modules/support/application/support-case-closure.service.js';
import type { SupportCaseCustomerService } from '../../../src/modules/support/application/support-case-customer.service.js';
import type { SupportKnowledgeService } from '../../../src/modules/support/application/support-knowledge.service.js';
import type { AuthenticatedUser } from '../../../src/common/types/auth.types.js';

/**
 * El centro de ayuda del cliente.
 *
 * Once rutas repartidas entre seis servicios. Lo que se fija es lo único que no puede verse desde
 * ninguno de ellos: que cada ruta llame a lo que dice su nombre, y que TODAS resuelvan el actor
 * desde el token antes de delegar.
 *
 * Las dos cosas fallan en silencio. Un cruce entre `listOwnCases` y una lectura interna compila,
 * responde 200 y le enseña al cliente casos que no son suyos. Y una ruta que se saltara
 * `actors.resolve` pasaría al servicio un identificador sin resolver: el servicio no puede
 * distinguirlo, porque desde ahí abajo un actor mal resuelto y uno bien resuelto tienen la misma
 * forma.
 */
const USUARIO = { role: 'customer', tenantId: 't1', customerId: '42' } as AuthenticatedUser;
const ACTOR = { tipo: 'customer', id: '42' } as never;

describe('MobileSupportController', () => {
  let actors: { resolve: jest.Mock };
  let cases: { listCategories: jest.Mock; openCase: jest.Mock };
  let read: { listOwnCases: jest.Mock; getCase: jest.Mock };
  let closure: { reopen: jest.Mock };
  let customerActions: { registerCustomerRequest: jest.Mock; submitFeedback: jest.Mock };
  let knowledge: { featuredFaq: jest.Mock; search: jest.Mock; getByKey: jest.Mock; submitFeedback: jest.Mock };
  let controller: MobileSupportController;

  beforeEach(() => {
    actors = { resolve: jest.fn(async () => ACTOR) };
    cases = { listCategories: jest.fn(async () => 'categorias'), openCase: jest.fn(async () => 'caso-abierto') };
    read = { listOwnCases: jest.fn(async () => 'mis-casos'), getCase: jest.fn(async () => 'un-caso') };
    closure = { reopen: jest.fn(async () => 'reabierto') };
    customerActions = {
      registerCustomerRequest: jest.fn(async () => 'solicitud'),
      submitFeedback: jest.fn(async () => 'encuesta-caso'),
    };
    knowledge = {
      featuredFaq: jest.fn(async () => 'faq'),
      search: jest.fn(async () => 'resultados'),
      getByKey: jest.fn(async () => 'articulo'),
      submitFeedback: jest.fn(async () => 'voto'),
    };
    controller = new MobileSupportController(
      actors as unknown as SupportActorService,
      cases as unknown as SupportCaseService,
      read as unknown as SupportCaseReadService,
      closure as unknown as SupportCaseClosureService,
      customerActions as unknown as SupportCaseCustomerService,
      knowledge as unknown as SupportKnowledgeService,
    );
  });

  describe('base de conocimiento', () => {
    it('las FAQ destacadas se piden para el actor resuelto, no para el usuario crudo del token', async () => {
      await expect(controller.faq('t1', USUARIO)).resolves.toBe('faq');

      expect(actors.resolve).toHaveBeenCalledWith(USUARIO, 't1');
      expect(knowledge.featuredFaq).toHaveBeenCalledWith({ tenantId: 't1', actor: ACTOR });
    });

    it('la búsqueda pasa la consulta entera y va al servicio de conocimiento, no al de casos', async () => {
      await expect(controller.search('t1', { q: 'tarjeta' } as never, USUARIO)).resolves.toBe('resultados');

      expect(knowledge.search).toHaveBeenCalledWith({ tenantId: 't1', actor: ACTOR, dto: { q: 'tarjeta' } });
      expect(cases.listCategories).not.toHaveBeenCalled();
    });

    it('un artículo se pide por su clave, desenvuelta del parámetro de ruta', async () => {
      await expect(controller.article('t1', 'auth.codigo', USUARIO)).resolves.toBe('articulo');

      expect(knowledge.getByKey).toHaveBeenCalledWith({ tenantId: 't1', actor: ACTOR, articleKey: 'auth.codigo' });
    });

    it('el voto sobre un artículo va al servicio de conocimiento y NO al de encuestas del caso', async () => {
      await expect(controller.articleFeedback('t1', 'a-1', { helpful: true } as never, USUARIO)).resolves.toBe('voto');

      expect(knowledge.submitFeedback).toHaveBeenCalledWith({ tenantId: 't1', actor: ACTOR, articleId: 'a-1', dto: { helpful: true } });
      expect(customerActions.submitFeedback).not.toHaveBeenCalled();
    });

    it('el catálogo de motivos sale del servicio de casos', async () => {
      await expect(controller.categories('t1', USUARIO)).resolves.toBe('categorias');

      expect(cases.listCategories).toHaveBeenCalledWith({ tenantId: 't1', actor: ACTOR });
    });
  });

  describe('casos del cliente', () => {
    it('abrir un caso propaga la correlación cuando llega, y la declara nula cuando no', async () => {
      await controller.openCase('t1', 'corr-1', { categoryCode: 'AUTH' } as never, USUARIO);
      expect(cases.openCase).toHaveBeenLastCalledWith(expect.objectContaining({ correlationId: 'corr-1' }));

      await controller.openCase('t1', undefined, { categoryCode: 'AUTH' } as never, USUARIO);
      expect(cases.openCase).toHaveBeenLastCalledWith(expect.objectContaining({ correlationId: null }));
    });

    it('el listado usa la lectura de casos PROPIOS y no una lectura general', async () => {
      await expect(controller.listCases('t1', { page: 1 } as never, USUARIO)).resolves.toBe('mis-casos');

      expect(read.listOwnCases).toHaveBeenCalledWith({ tenantId: 't1', actor: ACTOR, query: { page: 1 } });
    });

    it('el detalle de un caso lleva el actor: es lo que decide si puede verlo', async () => {
      await expect(controller.getCase('t1', 'caso-1', USUARIO)).resolves.toBe('un-caso');

      expect(read.getCase).toHaveBeenCalledWith({ tenantId: 't1', actor: ACTOR, caseId: 'caso-1' });
    });

    it('pedir el cierre es una SOLICITUD del cliente, no un cierre: se registra como tal', async () => {
      await expect(controller.closeRequest('t1', 'caso-1', { reason: 'ya se resolvió' } as never, USUARIO)).resolves.toBe('solicitud');

      expect(customerActions.registerCustomerRequest).toHaveBeenCalledWith({
        tenantId: 't1',
        actor: ACTOR,
        caseId: 'caso-1',
        kind: 'CLOSE',
        reason: 'ya se resolvió',
      });
      expect(closure.reopen).not.toHaveBeenCalled();
    });

    it('reabrir sí va al servicio de cierre, con el cuerpo entero', async () => {
      await expect(controller.reopen('t1', 'caso-1', { reason: 'volvió a pasar' } as never, USUARIO)).resolves.toBe('reabierto');

      expect(closure.reopen).toHaveBeenCalledWith({ tenantId: 't1', actor: ACTOR, caseId: 'caso-1', dto: { reason: 'volvió a pasar' } });
    });

    it('la encuesta del caso va al servicio del cliente y NO al de conocimiento', async () => {
      await expect(controller.feedback('t1', 'caso-1', { rating: 5 } as never, USUARIO)).resolves.toBe('encuesta-caso');

      expect(customerActions.submitFeedback).toHaveBeenCalledWith({ tenantId: 't1', actor: ACTOR, caseId: 'caso-1', dto: { rating: 5 } });
      expect(knowledge.submitFeedback).not.toHaveBeenCalled();
    });
  });

  it('las once rutas resuelven el actor desde el token antes de delegar', async () => {
    await controller.faq('t1', USUARIO);
    await controller.categories('t1', USUARIO);
    await controller.search('t1', {} as never, USUARIO);
    await controller.article('t1', 'k', USUARIO);
    await controller.articleFeedback('t1', 'a', {} as never, USUARIO);
    await controller.openCase('t1', undefined, {} as never, USUARIO);
    await controller.listCases('t1', {} as never, USUARIO);
    await controller.getCase('t1', 'c', USUARIO);
    await controller.closeRequest('t1', 'c', {} as never, USUARIO);
    await controller.reopen('t1', 'c', {} as never, USUARIO);
    await controller.feedback('t1', 'c', {} as never, USUARIO);

    expect(actors.resolve).toHaveBeenCalledTimes(11);
    for (const llamada of actors.resolve.mock.calls) expect(llamada).toEqual([USUARIO, 't1']);
  });
});
