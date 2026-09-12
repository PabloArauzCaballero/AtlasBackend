import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ProviderAuthAdminController } from '../../../src/modules/external-data/controllers/provider-auth.controller.js';
import type { AuthBrokerClient } from '../../../src/modules/external-data/infrastructure/auth-broker/auth-broker.client.js';

/**
 * La administración de credenciales de proveedores externos.
 *
 * Vive en un controlador propio porque su superficie de riesgo es distinta de la del resto del
 * panel: aquí se rota y se revoca material de credenciales, no se ajustan políticas de costo.
 *
 * La regla que estas pruebas fijan, y que ninguna otra capa puede fijar, es lo que este controlador
 * NO expone: la ruta del broker que devuelve material de credencial —`/authorize`— no se publica.
 * La consumen los adaptadores dentro del proceso, nunca el portal. Un método de más aquí convertiría
 * una llave de proveedor en algo que un operador puede leer desde un navegador.
 *
 * Por eso también se comprueba que ninguna respuesta lleve material: rotar devuelve la HUELLA de la
 * credencial resultante, y el material que entra viaja al broker y no se persiste ni se registra
 * aquí.
 *
 * Y las tres acciones que cambian algo —rotar, revocar, invalidar— llevan `@Roles` propio de
 * admin/platform_admin, más estrecho que el de clase: el rol de investigación ve el estado, no
 * sustituye llaves.
 */
describe('ProviderAuthAdminController', () => {
  let broker: {
    availability: jest.Mock;
    listAuthStates: jest.Mock;
    pendingRotation: jest.Mock;
    authStateFor: jest.Mock;
    rotateCredential: jest.Mock;
    revokeCredential: jest.Mock;
    invalidateToken: jest.Mock;
    authorize: jest.Mock;
  };
  let controller: ProviderAuthAdminController;

  beforeEach(() => {
    broker = {
      availability: jest.fn(async () => ({ configured: true, reachable: true })),
      listAuthStates: jest.fn(async () => [{ providerCode: 'buro' }]),
      pendingRotation: jest.fn(async () => [{ providerCode: 'buro', credentialStatus: 'ROTATION_DUE' }]),
      authStateFor: jest.fn(async () => ({ providerCode: 'buro', credentialStatus: 'ACTIVE' })),
      rotateCredential: jest.fn(async () => ({ providerCode: 'buro', field: 'client_secret', fingerprint: 'sha256:abc', rotatedAt: 'x' })),
      revokeCredential: jest.fn(async () => ({ revokedAt: 'x' })),
      invalidateToken: jest.fn(async () => ({ providerCode: 'buro', invalidated: true })),
      authorize: jest.fn(async () => ({ headers: { authorization: 'Bearer SECRETO' } })),
    };
    controller = new ProviderAuthAdminController(broker as unknown as AuthBrokerClient);
  });

  describe('lo que este controlador NO expone', () => {
    it('no publica ninguna ruta que devuelva material de credencial', () => {
      const metodos = Object.getOwnPropertyNames(ProviderAuthAdminController.prototype);

      expect(metodos).not.toContain('authorize');
      expect(metodos).not.toContain('getCredential');
      expect(metodos).not.toContain('reveal');
    });

    it('ninguna de las siete rutas llama a `authorize` del broker', async () => {
      await controller.availability();
      await controller.listAuthStates();
      await controller.pendingRotation();
      await controller.authState({ providerCode: 'buro' } as never);
      await controller.rotate({ providerCode: 'buro' } as never, { field: 'client_secret', material: 'nuevo' } as never);
      await controller.revoke({ providerCode: 'buro' } as never, { reason: 'FILTRACION' } as never);
      await controller.invalidateToken({ providerCode: 'buro' } as never);

      expect(broker.authorize).not.toHaveBeenCalled();
    });
  });

  describe('lecturas de estado', () => {
    it('la disponibilidad se devuelve tal cual: NO lanza, para que la pantalla pueda abrirse', async () => {
      await expect(controller.availability()).resolves.toEqual({ configured: true, reachable: true });
    });

    it('el listado y las rotaciones pendientes salen ENVUELTOS en su clave', async () => {
      await expect(controller.listAuthStates()).resolves.toEqual({ providers: [{ providerCode: 'buro' }] });
      await expect(controller.pendingRotation()).resolves.toEqual({
        credentials: [{ providerCode: 'buro', credentialStatus: 'ROTATION_DUE' }],
      });
    });

    it('el estado de un proveedor concreto sale sin envolver y con el código de la ruta', async () => {
      await expect(controller.authState({ providerCode: 'buro' } as never)).resolves.toMatchObject({ providerCode: 'buro' });

      expect(broker.authStateFor).toHaveBeenCalledWith('buro');
    });
  });

  describe('rotar', () => {
    it('el material viaja al broker y la respuesta devuelve la HUELLA, nunca el material', async () => {
      const resultado = await controller.rotate(
        { providerCode: 'buro' } as never,
        { field: 'client_secret', material: 'super-secreto' } as never,
      );

      expect(broker.rotateCredential).toHaveBeenCalledWith('buro', 'client_secret', 'super-secreto');
      expect(resultado).toMatchObject({ fingerprint: 'sha256:abc' });
      expect(JSON.stringify(resultado)).not.toContain('super-secreto');
    });

    it('rotar no revoca ni invalida: son tres acciones distintas', async () => {
      await controller.rotate({ providerCode: 'buro' } as never, { field: 'f', material: 'm' } as never);

      expect(broker.revokeCredential).not.toHaveBeenCalled();
      expect(broker.invalidateToken).not.toHaveBeenCalled();
    });
  });

  describe('revocar e invalidar', () => {
    it('revocar exige un motivo y lo propaga: es la acción ante sospecha de compromiso', async () => {
      await controller.revoke({ providerCode: 'buro' } as never, { reason: 'FILTRACION' } as never);

      expect(broker.revokeCredential).toHaveBeenCalledWith('buro', 'FILTRACION');
    });

    it('invalidar el token no revoca la credencial: sólo descarta el cacheado', async () => {
      const resultado = await controller.invalidateToken({ providerCode: 'buro' } as never);

      expect(broker.invalidateToken).toHaveBeenCalledWith('buro');
      expect(broker.revokeCredential).not.toHaveBeenCalled();
      expect(resultado).toEqual({ providerCode: 'buro', invalidated: true });
    });
  });
});
