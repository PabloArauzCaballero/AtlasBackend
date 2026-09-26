import { describe, expect, it, jest } from '@jest/globals';
import { env } from '../../../src/config/env.js';
import { MobileIdentityService } from '../../../src/modules/mobile-identity/mobile-identity.service.js';
import { startIdentityVerificationSchema } from '../../../src/modules/mobile-identity/mobile-identity.schemas.js';

/**
 * Verificación de identidad desde el móvil.
 *
 * Las propiedades que fijan estas pruebas son las que separan una integración
 * defendible de una peligrosa:
 *
 * 1. **Un motor caído no rechaza a nadie.** «La política dice que no» y «no
 *    llegué a preguntar» son cosas opuestas; confundirlas deja fuera del
 *    producto a personas verificables y, de paso, registra una tanda de
 *    identidades falsas que ninguna versión del artefacto llegó a emitir.
 * 2. **Un desenlace desconocido va a revisión, nunca a aprobación.** El
 *    artefacto puede añadir una rama y este repositorio no tiene por qué
 *    enterarse para seguir siendo seguro.
 * 3. **Aceptar no es esperar.** La petición contesta antes de que el motor
 *    responda; si no, habríamos construido el endpoint síncrono que este flujo
 *    existe para evitar.
 */
describe('MobileIdentityService', () => {
  const IMAGEN = 'A'.repeat(120);

  function cuerpo(overrides: Record<string, unknown> = {}) {
    return startIdentityVerificationSchema.parse({
      documentFront: IMAGEN,
      selfie: IMAGEN,
      ...overrides,
    });
  }

  function montar(engineResult: { output?: Record<string, unknown> } | Error) {
    const fila = { id: '5501', requestedAt: new Date('2026-08-20T12:00:00Z') };
    const repository = {
      createPending: jest.fn(async (..._args: unknown[]) => fila),
      complete: jest.fn(async (..._args: unknown[]) => undefined),
      findById: jest.fn(async (..._args: unknown[]) => null),
      // Lo que contestó el registro estatal en el flujo de alta. `null` = nunca se consultó, que es
      // el camino que estas pruebas recorren y el que no puede aprobar a nadie.
      findLatestOnboardingAttempt: jest.fn(async (..._args: unknown[]) => null),
    };
    const engine = {
      isConfigured: true,
      execute: jest.fn(async (..._args: unknown[]) => {
        if (engineResult instanceof Error) throw engineResult;
        return { executionId: '9001', status: 'COMPLETED', reasonCodes: [], ...engineResult };
      }),
    };
    /*
     * La asignacion de artefacto: por defecto NO hay fila, asi que `resolve` devuelve el valor del
     * entorno. Es el camino que estas pruebas recorren y el que garantiza que un despliegue sin
     * configurar siga funcionando igual que antes.
     */
    const bindings = {
      resolve: jest.fn(async (..._args: unknown[]) => ({
        decisionType: 'identity',
        artifactCode: 'IDENTIDAD_CARNET_MOVIL',
        source: 'environment',
      })),
    };
    const contacts = {
      featuresFor: jest.fn(async (..._args: unknown[]) => ({
        available: false,
        totalContacts: 0,
        uniqueRatio: 0,
        bolivianRatio: 0,
        referencesFoundInAddressBook: 0,
        riskMatches: 0,
      })),
    };
    // Las señales externas —registro estatal y agenda— salieron a `MobileIdentitySignalsService`
    // al partir el archivo por tamaño. Este spec no las ejercita: el doble responde «sin dato».
    const senales = {
      estadoDelRegistroEstatal: jest.fn(async () => ({ estado: 'sin_dato', coincidencia: 0 })),
      // La tercera señal, el comportamiento del alta: por defecto «no medido».
      comportamientoDe: jest.fn(async () => ({
        disponible: false,
        summaryId: null,
        segundosTotal: null,
        segundosIdentidad: null,
        pegadoEnCarnet: null,
        correccionesOcr: null,
        ratioErrores: null,
        segundoPlanoEnCaptura: null,
        abandonosPrevios: null,
        botScore: null,
        senales: [],
      })),
      agendaDe: jest.fn(async () => ({
        available: false,
        totalContacts: 0,
        uniqueRatio: 0,
        bolivianRatio: 0,
        referencesFoundInAddressBook: 0,
        riskMatches: 0,
      })),
    };
    const service = new MobileIdentityService(repository as never, engine as never, bindings as never, contacts as never, senales as never);
    return { service, repository, engine, bindings, contacts, senales };
  }

  /** Deja correr la promesa que el servicio lanzó sin esperar. */
  const dejarResolver = () => new Promise((resolve) => setImmediate(resolve));

  it('acepta sin esperar al veredicto y devuelve PENDING', async () => {
    const { service, engine } = montar({ output: { identidad_resultado: 'VERIFICADO' } });

    const vista = await service.start('1', cuerpo(), 'idem-1');

    expect(vista.status).toBe('PENDING');
    expect(vista.verificationId).toBe('5501');
    /*
     * La respuesta sale ANTES de que el motor conteste, y ahora también antes de que se reúnan las
     * dos señales que no salen de las fotos —el registro estatal y la agenda—. La aserción es que
     * al contestar la llamada al motor todavía no ha OCURRIDO, y que ocurre después: si se esperara
     * a ella, la petición duraría lo que dure la biometría y habríamos construido el endpoint
     * síncrono que este flujo existe para evitar.
     */
    expect(engine.execute).not.toHaveBeenCalled();
    await dejarResolver();
    expect(engine.execute).toHaveBeenCalledTimes(1);
    // Plazo propio y UN solo intento: el worker tarda más que el plazo general y un reintento con
    // la misma clave de idempotencia sólo produce `409 IDEMPOTENCY_IN_PROGRESS` (TEST, 2026-09-18).
    expect(engine.execute.mock.calls[0]?.[2]).toEqual({ timeoutMs: env.DECISION_ENGINE_IDENTITY_TIMEOUT_MS, maxAttempts: 1 });
  });

  it('escribe VERIFIED cuando el artefacto verifica', async () => {
    const { service, repository } = montar({
      output: {
        identidad_resultado: 'VERIFICADO',
        identidad_motivo: 'IDENTIDAD_CONFIRMADA',
        identidad_parecido: 0.897,
        identidad_evidencia_documento: 0.92,
      },
    });

    await service.start('1', cuerpo(), 'idem-1');
    await dejarResolver();

    expect(repository.complete).toHaveBeenCalledWith(
      '1',
      '5501',
      expect.objectContaining({
        finalResult: 'VERIFIED',
        selfieMatchScore: '0.90',
        documentForensicsScore: '0.92',
      }),
    );
  });

  it('escribe REJECTED cuando el artefacto rechaza', async () => {
    const { service, repository } = montar({
      output: { identidad_resultado: 'RECHAZADO', identidad_motivo: 'DOCUMENTO_NO_VALIDO' },
    });

    await service.start('1', cuerpo(), 'idem-1');
    await dejarResolver();

    expect(repository.complete).toHaveBeenCalledWith('1', '5501', expect.objectContaining({ finalResult: 'REJECTED' }));
  });

  it('un desenlace que este código no conoce va a revisión, no a aprobación', async () => {
    const { service, repository } = montar({
      output: { identidad_resultado: 'ALGO_NUEVO_DEL_ARTEFACTO' },
    });

    await service.start('1', cuerpo(), 'idem-1');
    await dejarResolver();

    expect(repository.complete).toHaveBeenCalledWith('1', '5501', expect.objectContaining({ finalResult: 'IN_REVIEW' }));
  });

  it('un motor caído NO rechaza: deja el caso como no disponible', async () => {
    const { service, repository } = montar(new Error('connect ECONNREFUSED'));

    await service.start('1', cuerpo(), 'idem-1');
    await dejarResolver();

    const [, , update] = repository.complete.mock.calls[0] as [
      string,
      string,
      { finalResult: string; reasonCodes: Record<string, unknown> },
    ];
    expect(update.finalResult).toBe('UNAVAILABLE');
    expect(update.reasonCodes.reason).toBe('DECISION_ENGINE_UNAVAILABLE');
  });

  it('sin motor configurado contesta 503 en vez de abrir un trámite que nadie resolverá', async () => {
    const { service, repository } = montar({ output: {} });
    Object.defineProperty(service, 'engine', { value: { isConfigured: false } });

    await expect(service.start('1', cuerpo(), 'idem-1')).rejects.toMatchObject({
      status: 503,
    });
    expect(repository.createPending).not.toHaveBeenCalled();
  });

  /*
   * El origen de la captura (escáner del sistema frente a cámara) viaja en el CONTEXTO de la
   * ejecución, nunca como variable: una variable nueva del artefacto exige una versión firmada por
   * dos personas. Y sin el campo, la llamada al Motor tiene que ser idéntica a la de antes.
   */
  it('reenvía documentCaptureSource en el contexto y no en las variables', async () => {
    const { service, engine } = montar({ output: { identidad_resultado: 'VERIFICADO' } });

    await service.start('1', cuerpo({ documentCaptureSource: 'system_scanner' }), 'idem-escaner');
    await dejarResolver();

    const peticion = engine.execute.mock.calls[0]?.[1] as { variables: Record<string, unknown>; context: Record<string, unknown> };
    expect(peticion.context).toEqual({
      channel: 'MOBILE_APP',
      verificationId: '5501',
      behaviorSummaryId: null,
      documentCaptureSource: 'system_scanner',
    });
    expect(Object.keys(peticion.variables).some((clave) => clave.toLowerCase().includes('capture'))).toBe(false);
    expect(Object.values(peticion.variables)).not.toContain('system_scanner');
  });

  it('sin documentCaptureSource el contexto queda exactamente como antes', async () => {
    const { service, engine } = montar({ output: { identidad_resultado: 'VERIFICADO' } });

    await service.start('1', cuerpo(), 'idem-camara');
    await dejarResolver();

    const peticion = engine.execute.mock.calls[0]?.[1] as { context: Record<string, unknown> };
    expect(peticion.context).toEqual({ channel: 'MOBILE_APP', verificationId: '5501', behaviorSummaryId: null });
  });
});

describe('el contrato de entrada del móvil', () => {
  it('rechaza una cadena que no es base64 antes de molestar al motor', () => {
    // Sin esto llegaría al motor como una imagen de trescientos bytes y volvería
    // como «no es un documento»: un mensaje que manda a repetir una foto que
    // estaba bien.
    const resultado = startIdentityVerificationSchema.safeParse({
      documentFront: '¡esto no es base64!'.repeat(10),
      selfie: 'A'.repeat(120),
    });

    expect(resultado.success).toBe(false);
  });

  it('el reverso es opcional de verdad', () => {
    const resultado = startIdentityVerificationSchema.safeParse({
      documentFront: 'A'.repeat(120),
      selfie: 'A'.repeat(120),
    });

    expect(resultado.success).toBe(true);
  });

  it('documentCaptureSource es opcional y sólo admite camera o system_scanner', () => {
    const base = { documentFront: 'A'.repeat(120), selfie: 'A'.repeat(120) };

    expect(startIdentityVerificationSchema.parse(base).documentCaptureSource).toBeUndefined();
    expect(startIdentityVerificationSchema.parse({ ...base, documentCaptureSource: 'camera' }).documentCaptureSource).toBe('camera');
    expect(startIdentityVerificationSchema.parse({ ...base, documentCaptureSource: 'system_scanner' }).documentCaptureSource).toBe(
      'system_scanner',
    );
    expect(startIdentityVerificationSchema.safeParse({ ...base, documentCaptureSource: 'gallery' }).success).toBe(false);
    expect(startIdentityVerificationSchema.safeParse({ ...base, documentCaptureSource: '' }).success).toBe(false);
    // El esquema no es `.strict()`: una clave desconocida se descarta sin 400. Un backend anterior a
    // `documentCaptureSource` lo habría tirado en silencio, no rechazado.
    expect(startIdentityVerificationSchema.parse({ ...base, captureSource: 'system_scanner' })).not.toHaveProperty('captureSource');
  });

  it('normaliza el país a mayúsculas y cae a BO', () => {
    const parsed = startIdentityVerificationSchema.parse({
      documentFront: 'A'.repeat(120),
      selfie: 'A'.repeat(120),
      documentCountry: 'bo',
    });

    expect(parsed.documentCountry).toBe('BO');
  });
});
