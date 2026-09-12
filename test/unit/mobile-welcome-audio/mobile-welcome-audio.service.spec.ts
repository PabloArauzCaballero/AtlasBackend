import { describe, expect, it, jest } from '@jest/globals';
import { MobileWelcomeAudioService } from '../../../src/modules/mobile-welcome-audio/mobile-welcome-audio.service.js';

/**
 * La locución de bienvenida.
 *
 * Las propiedades que fijan estas pruebas son las tres que separan un detalle simpático de un
 * agujero:
 *
 * 1. **El nombre sale del perfil, nunca de la petición.** Es lo único que impide que este endpoint
 *    sea un sintetizador de voz de uso libre pagado por el inquilino, y que cualquiera ponga
 *    cualquier frase en boca de la marca.
 * 2. **Cada locución es de quien la pidió.** El identificador es un UUID que viaja al teléfono; sin
 *    la comprobación de propiedad, cualquier cliente autenticado que consiguiera uno ajeno se
 *    descargaría un audio que dice el nombre de pila de otra persona.
 * 3. **Nada de esto puede impedir entrar.** Un motor que no contesta se traduce en `UNAVAILABLE`,
 *    que el móvil trata como «entra en silencio» — no en un 500 encima de la app recién abierta.
 */
describe('MobileWelcomeAudioService', () => {
  function montar(opciones: { firstName?: string | null; status?: string; enqueueError?: Error } = {}) {
    const engine = {
      isConfigured: true,
      enqueue: jest.fn(async (..._args: unknown[]) => {
        if (opciones.enqueueError) throw opciones.enqueueError;
        return { requestId: 'a1b2c3d4-0000-4000-8000-000000000001', status: opciones.status ?? 'QUEUED' };
      }),
      status: jest.fn(async (..._args: unknown[]) => ({ status: opciones.status ?? 'SUCCEEDED', errorMessage: null })),
      audio: jest.fn(async (..._args: unknown[]) => ({ bytes: Buffer.alloc(4096), mimeType: 'audio/mpeg' })),
    };
    const customers = {
      findCurrentProfile: jest.fn(async (..._args: unknown[]) => ({
        firstName: opciones.firstName === undefined ? 'Valeria' : opciones.firstName,
      })),
    };
    const service = new MobileWelcomeAudioService(engine as never, customers as never);
    return { service, engine, customers };
  }

  it('locuta la plantilla con nombre usando el del PERFIL, no uno recibido', async () => {
    const { service, engine } = montar({ firstName: 'Valeria' });

    await service.start('1', '23');

    expect(engine.enqueue).toHaveBeenCalledWith('1', 'onboarding.welcome.named', { name: 'Valeria' });
  });

  it('se queda con el primer nombre y descarta lo que no es un nombre', async () => {
    // Un nombre compuesto con basura pegada: lo que llega de un formulario real.
    const { service, engine } = montar({ firstName: '  María José <script>  ' });

    await service.start('1', '23');

    expect(engine.enqueue).toHaveBeenCalledWith('1', 'onboarding.welcome.named', { name: 'María' });
  });

  it('cae a la plantilla genérica cuando no hay nombre publicado', async () => {
    // Un cliente recién creado todavía no tiene versión de perfil: pasa más de lo que parece.
    const { service, engine } = montar({ firstName: null });

    await service.start('1', '23');

    expect(engine.enqueue).toHaveBeenCalledWith('1', 'onboarding.welcome.generic', {});
  });

  it('no deja que un cliente descargue la locución de otro', async () => {
    const { service } = montar();
    const { requestId } = await service.start('1', '23');

    await expect(service.audio('1', requestId, '99')).rejects.toMatchObject({ status: 403 });
  });

  it('contesta 404 —no 403— para un identificador que nadie encargó', async () => {
    // Un 403 confirmaría que existe, que es justo lo que no debe poder averiguarse probando.
    const { service } = montar();

    await expect(service.get('1', 'a1b2c3d4-0000-4000-8000-00000000dead', '23')).rejects.toMatchObject({ status: 404 });
  });

  it('un motor que no contesta se lee como UNAVAILABLE y no como un fallo', async () => {
    const { service, engine } = montar();
    const { requestId } = await service.start('1', '23');
    engine.status.mockImplementation(async () => {
      throw new Error('ECONNREFUSED');
    });

    await expect(service.get('1', requestId, '23')).resolves.toEqual({ requestId, status: 'UNAVAILABLE' });
  });

  it('un motor que revienta al encargar NO se propaga como 500', async () => {
    /*
     * Visto contra el motor local: encolar devolvió `500 Connection terminated` —un tropiezo del
     * pool de base de datos del OTRO servicio— y llegó al móvil tal cual. Una app recién abierta no
     * puede recibir un error del servidor por un saludo.
     */
    const { service } = montar({ enqueueError: new Error('El motor respondió 500. Connection terminated') });

    await expect(service.start('1', '23')).resolves.toEqual({ requestId: '', status: 'UNAVAILABLE' });
  });

  it('sin worker conectado contesta 503 y no intenta locutar nada', async () => {
    const { service, engine } = montar();
    (engine as { isConfigured: boolean }).isConfigured = false;

    await expect(service.start('1', '23')).rejects.toMatchObject({ status: 503 });
    expect(engine.enqueue).not.toHaveBeenCalled();
  });
});
