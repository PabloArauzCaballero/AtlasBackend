import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { MerchantUsersController } from '../../../src/modules/merchant-identity/merchant-users.controller.js';
import type { MerchantUsersService } from '../../../src/modules/merchant-identity/merchant-users.service.js';
import type { MerchantUserRequestsService } from '../../../src/modules/merchant-identity/merchant-user-requests.service.js';
import type { AuthenticatedUser } from '../../../src/common/types/auth.types.js';

/**
 * El alta de identidades de comercio.
 *
 * Dos decisiones, y las dos son de control, no de forma.
 *
 * El tenant sale del TOKEN del operador interno y nunca del cuerpo de la petición: aceptarlo del
 * cliente permitiría dar de alta identidades en un tenant ajeno con un token válido del propio. Un
 * token sin tenant se rechaza en vez de asumir uno, y se comprueba en las SIETE rutas — la que se
 * olvide es por donde entra.
 *
 * Y quién pidió el alta se resuelve desde el token con respaldo: el ERP puede mandar su propio
 * `requestedBy` —el correo del ejecutivo comercial, que es el que el operador reconoce—, y cuando no
 * lo manda queda el actor del token en vez de un hueco.
 *
 * Nota de lo que este controlador NO tiene: `POST /merchant/users`, el alta libre, se retiró a
 * propósito. Un operador tecleaba correo, nombre y contraseña y nacía un usuario de comercio que el
 * ERP —dueño de la relación comercial— no había pedido ni conocía. El alta es ahora la APROBACIÓN
 * de una petición encolada, y el corte está en el controlador y no en la pantalla: una pantalla se
 * salta con `curl`.
 */
const OPERADOR = { role: 'internal_operator', tenantId: 't1', internalUserId: '7', sub: 'sub-7' } as AuthenticatedUser;

describe('MerchantUsersController', () => {
  let users: { listMerchantUsers: jest.Mock; getMerchantUser: jest.Mock; updateStatus: jest.Mock };
  let requests: { enqueue: jest.Mock; list: jest.Mock; get: jest.Mock; approve: jest.Mock; reject: jest.Mock };
  let controller: MerchantUsersController;

  beforeEach(() => {
    users = {
      listMerchantUsers: jest.fn(async () => ({ items: [] })),
      getMerchantUser: jest.fn(async () => ({ merchantUserId: 'mu-1' })),
      updateStatus: jest.fn(async () => ({ status: 'suspended' })),
    };
    requests = {
      enqueue: jest.fn(async () => ({ requestId: 'r-1', status: 'pending' })),
      list: jest.fn(async () => ({ items: [] })),
      get: jest.fn(async () => ({ requestId: 'r-1' })),
      approve: jest.fn(async () => ({ merchantUserId: 'mu-1', status: 'invited' })),
      reject: jest.fn(async () => ({ requestId: 'r-1', status: 'rejected' })),
    };
    controller = new MerchantUsersController(users as unknown as MerchantUsersService, requests as unknown as MerchantUserRequestsService);
  });

  describe('el alta libre no existe', () => {
    it('el controlador no expone ninguna creación directa de identidad', () => {
      const metodos = Object.getOwnPropertyNames(MerchantUsersController.prototype);

      expect(metodos).not.toContain('createMerchantUser');
      expect(metodos).not.toContain('create');
      expect(metodos).toContain('approveRequest');
    });
  });

  describe('el tenant sale del token', () => {
    it('un token sin tenant se rechaza en TODAS las rutas, no se asume uno', () => {
      const sinTenant = { role: 'internal_operator', sub: 'sub-7' } as AuthenticatedUser;

      expect(() => controller.enqueueRequest({} as never, sinTenant)).toThrow(ForbiddenException);
      expect(() => controller.listRequests({} as never, sinTenant)).toThrow(ForbiddenException);
      expect(() => controller.getRequest({ requestId: 'r-1' } as never, sinTenant)).toThrow(ForbiddenException);
      expect(() => controller.approveRequest({ requestId: 'r-1' } as never, {} as never, sinTenant)).toThrow(ForbiddenException);
      expect(() => controller.rejectRequest({ requestId: 'r-1' } as never, {} as never, sinTenant)).toThrow(ForbiddenException);
      expect(() => controller.list({} as never, sinTenant)).toThrow(ForbiddenException);
      expect(() => controller.get({ merchantUserId: 'mu-1' } as never, sinTenant)).toThrow(ForbiddenException);
      expect(() => controller.updateStatus({ merchantUserId: 'mu-1' } as never, {} as never, sinTenant)).toThrow(ForbiddenException);
    });

    it('con tenant sin declarar no se llama a ningún servicio', () => {
      const sinTenant = { role: 'internal_operator', sub: 'sub-7' } as AuthenticatedUser;

      expect(() => controller.list({} as never, sinTenant)).toThrow();
      expect(users.listMerchantUsers).not.toHaveBeenCalled();
      expect(requests.enqueue).not.toHaveBeenCalled();
    });

    it('un tenant en el CUERPO se ignora: el del token es el que manda', () => {
      controller.enqueueRequest({ email: 'a@b.com', tenantId: 't-ajeno' } as never, OPERADOR);

      expect(requests.enqueue).toHaveBeenCalledWith({ email: 'a@b.com', tenantId: 't-ajeno' }, expect.objectContaining({ tenantId: 't1' }));
    });
  });

  describe('la cola de peticiones', () => {
    it('encolar deja constancia de quién pidió, tomado del token', () => {
      controller.enqueueRequest({ email: 'a@b.com' } as never, OPERADOR);

      expect(requests.enqueue).toHaveBeenCalledWith({ email: 'a@b.com' }, { requestedBy: '7', tenantId: 't1' });
    });

    it('sin usuario interno en el token queda el sujeto: un hueco no dice quién pidió', () => {
      controller.enqueueRequest(
        { email: 'a@b.com' } as never,
        { role: 'internal_operator', tenantId: 't1', sub: 'sub-9' } as AuthenticatedUser,
      );

      expect(requests.enqueue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ requestedBy: 'sub-9' }));
    });

    it('listar y consultar una petición van acotadas al tenant del token', () => {
      controller.listRequests({ status: 'pending' } as never, OPERADOR);
      expect(requests.list).toHaveBeenCalledWith('t1', { status: 'pending' });

      controller.getRequest({ requestId: 'r-1' } as never, OPERADOR);
      expect(requests.get).toHaveBeenCalledWith('t1', 'r-1');
    });
  });

  describe('aprobar y rechazar', () => {
    it('aprobar es lo que CREA la identidad, y queda a nombre de quien decidió', () => {
      controller.approveRequest({ requestId: 'r-1' } as never, { role: 'operator' } as never, OPERADOR);

      expect(requests.approve).toHaveBeenCalledWith('t1', 'r-1', { role: 'operator' }, { internalUserId: '7' });
    });

    it('rechazar lleva el motivo, que es lo que el ERP lee para saber qué corregir', () => {
      controller.rejectRequest({ requestId: 'r-1' } as never, { reason: 'correo corporativo obligatorio' } as never, OPERADOR);

      expect(requests.reject).toHaveBeenCalledWith('t1', 'r-1', { reason: 'correo corporativo obligatorio' }, { internalUserId: '7' });
    });

    it('sin usuario interno la decisión queda a nombre de nadie ANTES que a nombre del sujeto', () => {
      const sinInterno = { role: 'internal_operator', tenantId: 't1', sub: 'sub-9' } as AuthenticatedUser;

      controller.approveRequest({ requestId: 'r-1' } as never, {} as never, sinInterno);

      expect(requests.approve).toHaveBeenCalledWith('t1', 'r-1', {}, { internalUserId: null });
    });

    it('aprobar y rechazar son rutas distintas: una no cae en la otra', () => {
      controller.approveRequest({ requestId: 'r-1' } as never, {} as never, OPERADOR);
      expect(requests.reject).not.toHaveBeenCalled();

      requests.approve.mockClear();
      controller.rejectRequest({ requestId: 'r-1' } as never, { reason: 'x' } as never, OPERADOR);
      expect(requests.approve).not.toHaveBeenCalled();
    });
  });

  describe('identidades ya creadas', () => {
    it('listar y consultar van acotadas al tenant del token', () => {
      controller.list({ status: 'active' } as never, OPERADOR);
      expect(users.listMerchantUsers).toHaveBeenCalledWith('t1', { status: 'active' });

      controller.get({ merchantUserId: 'mu-1' } as never, OPERADOR);
      expect(users.getMerchantUser).toHaveBeenCalledWith('t1', 'mu-1');
    });

    it('cambiar el estado deja quién lo hizo: suspender corta la sesión y eso se audita', () => {
      controller.updateStatus({ merchantUserId: 'mu-1' } as never, { status: 'suspended' } as never, OPERADOR);

      expect(users.updateStatus).toHaveBeenCalledWith('t1', 'mu-1', { status: 'suspended' }, { internalUserId: '7' });
    });
  });
});
