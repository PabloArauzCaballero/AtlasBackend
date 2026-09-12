import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { AuthBrokerClient } from '../../../src/modules/external-data/infrastructure/auth-broker/auth-broker.client.js';

/**
 * El cliente del broker de autenticación.
 *
 * Lo que se fija es la ASIMETRÍA deliberada, que es toda la razón de ser de este archivo: falla
 * ABIERTO en las lecturas de estado —si el broker no responde, el portal enseña «inalcanzable» y el
 * resto del panel sigue funcionando— y CERRADO en `authorize`, porque sin token no puede haber
 * llamada al proveedor. Un panel a medias es un inconveniente; una llamada a un buró de crédito sin
 * autenticar es un incidente.
 *
 * Y dos cosas que sólo se ven mirando el código: el error de red NO se propaga crudo, porque en
 * algunos runtimes arrastra la URL con el token dentro; y un cuerpo fuera de contrato se trata como
 * broker no disponible en vez de dejarlo pasar, que es lo que convertiría una respuesta rara en un
 * estado de credencial inventado.
 */
const CLAVES = ['AUTH_BROKER_BASE_URL', 'AUTH_BROKER_SERVICE_TOKEN', 'AUTH_BROKER_TIMEOUT_MS'] as const;

const ESTADO = {
  providerCode: 'buro',
  authMethod: 'oauth2_client_credentials',
  credentialStatus: 'ACTIVE',
  tokenStatus: 'VALID',
  scopes: ['read'],
};

function respuesta(cuerpo: unknown, estado = 200) {
  return { ok: estado >= 200 && estado < 300, status: estado, json: async () => cuerpo };
}

describe('AuthBrokerClient', () => {
  let fetchMock: jest.Mock;
  let original: Record<string, string | undefined>;

  beforeEach(() => {
    original = Object.fromEntries(CLAVES.map((clave) => [clave, process.env[clave]]));
    process.env.AUTH_BROKER_BASE_URL = 'http://broker:9000';
    process.env.AUTH_BROKER_SERVICE_TOKEN = 'token-de-servicio';
    process.env.AUTH_BROKER_TIMEOUT_MS = '500';
    fetchMock = jest.fn();
    (globalThis as { fetch: unknown }).fetch = fetchMock;
  });

  afterEach(() => {
    for (const [clave, valor] of Object.entries(original)) {
      if (valor === undefined) delete process.env[clave];
      else process.env[clave] = valor;
    }
    jest.restoreAllMocks();
  });

  function cliente(): AuthBrokerClient {
    return new AuthBrokerClient();
  }

  describe('configuración', () => {
    it('exige base y token: con uno solo no está configurado', () => {
      expect(cliente().isConfigured()).toBe(true);

      delete process.env.AUTH_BROKER_SERVICE_TOKEN;
      expect(cliente().isConfigured()).toBe(false);

      process.env.AUTH_BROKER_SERVICE_TOKEN = 't';
      delete process.env.AUTH_BROKER_BASE_URL;
      expect(cliente().isConfigured()).toBe(false);
    });

    it('sin configurar, cualquier operación es 503 y no una llamada a ninguna parte', async () => {
      delete process.env.AUTH_BROKER_BASE_URL;

      await expect(cliente().authorize('buro')).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('autorización (falla CERRADO)', () => {
    it('devuelve las cabeceras del proveedor y las pide por POST al broker', async () => {
      fetchMock.mockResolvedValueOnce(respuesta({ headers: { authorization: 'Bearer del-proveedor' } }) as never);

      await expect(cliente().authorize('buro')).resolves.toEqual({ authorization: 'Bearer del-proveedor' });

      const [url, opciones] = fetchMock.mock.calls[0] as [string, { method: string; headers: Record<string, string> }];
      expect(url).toBe('http://broker:9000/outbound/providers/buro/authorize');
      expect(opciones.method).toBe('POST');
      expect(opciones.headers.authorization).toBe('Bearer token-de-servicio');
    });

    it('el código del proveedor va escapado en la ruta', async () => {
      fetchMock.mockResolvedValueOnce(respuesta({ headers: {} }) as never);

      await cliente().authorize('bu ro/otro');

      expect(fetchMock.mock.calls[0]?.[0]).toBe('http://broker:9000/outbound/providers/bu%20ro%2Fotro/authorize');
    });

    it('si el broker no responde, LANZA: sin token no puede haber llamada al proveedor', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED http://broker:9000?token=secreto') as never);

      await expect(cliente().authorize('buro')).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('el error de red NO se propaga crudo: en algunos runtimes arrastra la URL con el token', async () => {
      fetchMock.mockRejectedValueOnce(new Error('conectando a http://broker:9000 con Bearer token-de-servicio') as never);

      await expect(cliente().authorize('buro')).rejects.toThrow('AUTH_BROKER_UNREACHABLE');
    });

    it('un error del broker conserva su código y su estado HTTP', async () => {
      fetchMock.mockResolvedValueOnce(respuesta({ code: 'CREDENTIAL_REVOKED', message: 'La credencial fue revocada.' }, 409) as never);

      await expect(cliente().authorize('buro')).rejects.toMatchObject({ status: 409 });
    });

    it('un error sin cuerpo de contrato cae a un código genérico en vez de reventar al parsear', async () => {
      fetchMock.mockResolvedValueOnce(respuesta('<html>502</html>', 502) as never);

      const fallo = await cliente()
        .authorize('buro')
        .catch((error: unknown) => error);

      expect(fallo).toBeInstanceOf(HttpException);
      expect((fallo as HttpException).getResponse()).toMatchObject({ code: 'AUTH_BROKER_ERROR' });
    });

    it('un cuerpo fuera de contrato es 503 y no un estado inventado', async () => {
      fetchMock.mockResolvedValueOnce(respuesta({ cabeceras: { a: 'b' } }) as never);

      await expect(cliente().authorize('buro')).rejects.toThrow('AUTH_BROKER_CONTRACT_MISMATCH');
    });
  });

  describe('lecturas de estado', () => {
    it('el listado desenvuelve la clave del sobre y aplica el valor por defecto de los alcances', async () => {
      const { scopes: _sin, ...sinAlcances } = ESTADO;
      fetchMock.mockResolvedValueOnce(respuesta({ providers: [ESTADO, sinAlcances] }) as never);

      const estados = await cliente().listAuthStates();

      expect(estados).toHaveLength(2);
      expect(estados[0].scopes).toEqual(['read']);
      expect(estados[1].scopes).toEqual([]);
    });

    it('el estado de un proveedor concreto va a su propia ruta', async () => {
      fetchMock.mockResolvedValueOnce(respuesta(ESTADO) as never);

      await expect(cliente().authStateFor('buro')).resolves.toMatchObject({ providerCode: 'buro' });
      expect(fetchMock.mock.calls[0]?.[0]).toBe('http://broker:9000/outbound/providers/buro/auth-state');
    });

    it('las rotaciones pendientes salen de su propia clave', async () => {
      fetchMock.mockResolvedValueOnce(respuesta({ credentials: [{ ...ESTADO, credentialStatus: 'ROTATION_DUE' }] }) as never);

      const pendientes = await cliente().pendingRotation();

      expect(pendientes[0].credentialStatus).toBe('ROTATION_DUE');
      expect(fetchMock.mock.calls[0]?.[0]).toBe('http://broker:9000/outbound/credentials/pending-rotation');
    });

    it('un estado de credencial que no está en el catálogo cerrado no pasa: es 503, no un valor libre', async () => {
      fetchMock.mockResolvedValueOnce(respuesta({ providers: [{ ...ESTADO, credentialStatus: 'INVENTADO' }] }) as never);

      await expect(cliente().listAuthStates()).rejects.toThrow('AUTH_BROKER_CONTRACT_MISMATCH');
    });
  });

  describe('operaciones sobre la credencial', () => {
    it('rotar manda el material en el cuerpo y devuelve la huella, no el secreto', async () => {
      fetchMock.mockResolvedValueOnce(
        respuesta({ providerCode: 'buro', field: 'client_secret', fingerprint: 'sha256:abc', rotatedAt: '2026-09-10T10:00:00Z' }) as never,
      );

      const resultado = await cliente().rotateCredential('buro', 'client_secret', 'nuevo-secreto');

      expect(resultado.fingerprint).toBe('sha256:abc');
      expect(resultado).not.toHaveProperty('material');
      const enviado = JSON.parse((fetchMock.mock.calls[0]?.[1] as { body: string }).body) as Record<string, string>;
      expect(enviado).toEqual({ field: 'client_secret', material: 'nuevo-secreto' });
    });

    it('revocar manda el motivo: una revocación sin razón no es auditable', async () => {
      fetchMock.mockResolvedValueOnce(respuesta({ revokedAt: '2026-09-10T10:00:00Z' }) as never);

      await cliente().revokeCredential('buro', 'FILTRACION');

      const enviado = JSON.parse((fetchMock.mock.calls[0]?.[1] as { body: string }).body) as Record<string, string>;
      expect(enviado).toEqual({ reason: 'FILTRACION' });
    });

    it('invalidar el token manda cuerpo vacío y no omite el cuerpo', async () => {
      fetchMock.mockResolvedValueOnce(respuesta({ providerCode: 'buro', invalidated: true }) as never);

      await expect(cliente().invalidateToken('buro')).resolves.toEqual({ providerCode: 'buro', invalidated: true });
      expect((fetchMock.mock.calls[0]?.[1] as { body: string }).body).toBe('{}');
    });
  });

  describe('disponibilidad (falla ABIERTO)', () => {
    it('sin configurar lo dice, sin llamar a nadie y sin lanzar', async () => {
      delete process.env.AUTH_BROKER_BASE_URL;

      await expect(cliente().availability()).resolves.toEqual({ configured: false, reachable: false });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('con el broker vivo declara el driver de bóveda cuando lo hay', async () => {
      fetchMock.mockResolvedValueOnce(respuesta({ status: 'ok', vaultDriver: 'hashicorp' }) as never);

      await expect(cliente().availability()).resolves.toEqual({ configured: true, reachable: true, vaultDriver: 'hashicorp' });
    });

    it('sin driver de bóveda no se inventa la clave', async () => {
      fetchMock.mockResolvedValueOnce(respuesta({ status: 'ok' }) as never);

      await expect(cliente().availability()).resolves.toEqual({ configured: true, reachable: true });
    });

    it('si el broker no responde NO lanza: un throw aquí dejaría la pantalla en blanco', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED') as never);

      await expect(cliente().availability()).resolves.toEqual({ configured: true, reachable: false, errorCode: '503' });
    });

    it('un error HTTP del broker se reporta con su estado y la vista sigue en pie', async () => {
      fetchMock.mockResolvedValueOnce(respuesta({ code: 'UNAUTHORIZED', message: 'token inválido' }, 401) as never);

      await expect(cliente().availability()).resolves.toEqual({ configured: true, reachable: false, errorCode: '401' });
    });
  });
});
