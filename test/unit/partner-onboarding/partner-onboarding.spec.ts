import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException, NotFoundException, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { hashOneTimeCode } from '../../../src/common/utils/crypto/one-time-code.util.js';
import { PartnerCommerceService } from '../../../src/modules/partner-onboarding/application/partner-commerce.service.js';
import { PartnerContactVerificationService } from '../../../src/modules/partner-onboarding/application/partner-contact-verification.service.js';
import { PartnerProfileService } from '../../../src/modules/partner-onboarding/application/partner-profile.service.js';
import { PartnerQrService } from '../../../src/modules/partner-onboarding/application/partner-qr.service.js';

/**
 * El expediente del partner: lo que acepta, lo que rechaza y lo que conserva.
 *
 * Se prueba con el repositorio doblado porque lo que hay que fijar son REGLAS de negocio, no
 * consultas: que un NIT repetido no abra un segundo expediente, que el envío diga TODO lo que
 * falta y no sólo lo primero, que un QR nuevo no borre al anterior y que un terminal se pueda
 * suspender aunque el expediente ya esté aprobado.
 */

type AnyRecord = Record<string, unknown>;

function metricsDouble() {
  return { recordPartnerOnboardingStep: jest.fn() } as never;
}

/**
 * Doble del perfil. Devuelve `AnyRecord` y NO `never`: con `never` el spread de la línea del
 * `updateProfile` no compila, y castear en el punto de uso deja que el compilador siga verificando
 * la forma aquí dentro.
 */
function profileDouble(overrides: AnyRecord = {}): AnyRecord {
  return { id: '10', onboardingStatus: 'draft', commercialRegistry: 'MAT-1', ...overrides };
}

describe('PartnerProfileService', () => {
  /*
   * Dos expedientes del mismo NIT son dos verificaciones que pueden contradecirse, y nada obliga a
   * mirar la otra. El conflicto devuelve el identificador del que ya existe para que el portal
   * lleve a continuarlo en vez de dejar al comercio en un callejón sin salida.
   */
  it('rechaza el NIT repetido y dice cuál es el expediente que ya existe', async () => {
    const repository = {
      findProfileByTaxId: jest.fn(async () => profileDouble({ id: '77', onboardingStatus: 'under_review' })),
      createProfile: jest.fn(),
    };
    const service = new PartnerProfileService(repository as never, metricsDouble());

    await expect(
      service.start('1', {
        legalName: 'Comercial Andina S.R.L.',
        taxId: '1023456789',
        contactEmail: 'contacto@andina.bo',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.createProfile).not.toHaveBeenCalled();
  });

  /*
   * La lista COMPLETA y no el primer fallo: quien completa un expediente necesita saber cuánto le
   * queda, y descubrirlo de uno en uno convierte el trámite en una sucesión de intentos
   * rechazados.
   */
  it('enumera todo lo que falta para poder enviar, no sólo lo primero', async () => {
    const repository = {
      listRepresentatives: jest.fn(async () => []),
      listBranches: jest.fn(async (..._a: unknown[]) => [] as AnyRecord[]),
      listQrCodes: jest.fn(async () => []),
    };
    const service = new PartnerProfileService(repository as never, metricsDouble());

    const gaps = await service.findSubmissionGaps('1', profileDouble({ commercialRegistry: null }) as never);

    expect(gaps.map((gap) => gap.requirement)).toEqual(['commercial_registry', 'legal_representative', 'branch', 'business_qr', 'bank_qr']);
  });

  /* Declarar al representante no es acreditarlo: sin el poder, la representación es una
   * afirmación que hace la propia empresa sobre sí misma. */
  it('exige el poder aunque el representante esté declarado', async () => {
    const repository = {
      listRepresentatives: jest.fn(async () => [{ powerOfAttorneyKey: null }]),
      listBranches: jest.fn(async () => [{ id: '1' }]),
      listQrCodes: jest.fn(async () => [
        { qrKind: 'business', status: 'pending_review' },
        { qrKind: 'bank', status: 'active' },
      ]),
    };
    const service = new PartnerProfileService(repository as never, metricsDouble());

    const gaps = await service.findSubmissionGaps('1', profileDouble() as never);

    expect(gaps.map((gap) => gap.requirement)).toEqual(['power_of_attorney']);
  });

  it('un expediente incompleto no se envía, y el error lleva la lista', async () => {
    const repository = {
      findProfileById: jest.fn(async () => profileDouble({ commercialRegistry: null })),
      listRepresentatives: jest.fn(async () => []),
      listBranches: jest.fn(async () => []),
      listQrCodes: jest.fn(async () => []),
      updateProfile: jest.fn(),
    };
    const service = new PartnerProfileService(repository as never, metricsDouble());

    await expect(service.submit('1', '10')).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repository.updateProfile).not.toHaveBeenCalled();
  });

  /* `submit` NO aprueba: deja el caso en revisión. Un onboarding que se auto-aprueba al completar
   * sus campos es un formulario, no una verificación. */
  it('el envío deja el caso en revisión, nunca en aprobado', async () => {
    const profile = profileDouble();
    const repository = {
      findProfileById: jest.fn(async () => profile),
      listRepresentatives: jest.fn(async () => [{ powerOfAttorneyKey: 'k' }]),
      listBranches: jest.fn(async () => [{ id: '1' }]),
      listQrCodes: jest.fn(async () => [
        { qrKind: 'business', status: 'active' },
        { qrKind: 'bank', status: 'active' },
      ]),
      updateProfile: jest.fn(async (...args: unknown[]) => ({ ...profileDouble(), ...(args[1] as AnyRecord) })),
    };
    const service = new PartnerProfileService(repository as never, metricsDouble());

    const { profile: updated } = await service.submit('1', '10');

    expect(updated.onboardingStatus).toBe('under_review');
  });

  it('un expediente ya en revisión no admite más cambios', () => {
    const service = new PartnerProfileService({} as never, metricsDouble());

    expect(() => service.assertEditable(profileDouble({ onboardingStatus: 'under_review' }) as never)).toThrow(
      UnprocessableEntityException,
    );
  });

  /*
   * El QR DE COBRO sí se puede cambiar con el expediente aprobado —es la corrección: el comercio que
   * de verdad cobra es el aprobado, y antes era el único que no podía subir su QR—. Lo que sigue
   * congelado mientras un analista mira es `under_review`.
   */
  it('el QR de cobro se puede reemplazar con el expediente aprobado, pero no en revisión', () => {
    const service = new PartnerProfileService({} as never, metricsDouble());

    expect(() => service.assertPaymentQrEditable(profileDouble({ onboardingStatus: 'approved' }) as never)).not.toThrow();
    expect(() => service.assertPaymentQrEditable(profileDouble({ onboardingStatus: 'under_review' }) as never)).toThrow(
      UnprocessableEntityException,
    );
  });
});

describe('PartnerQrService', () => {
  function build(repositoryOverrides: AnyRecord = {}, metadata: AnyRecord | null = null) {
    const repository = {
      findLiveQr: jest.fn(async (..._a: unknown[]) => null as AnyRecord | null),
      createQrCode: jest.fn(async (..._a: unknown[]) => ({ id: '99' })),
      markQrReplaced: jest.fn(async (..._a: unknown[]) => ({})),
      findBranchById: jest.fn(async (..._a: unknown[]) => ({ id: '5' }) as AnyRecord | null),
      ...repositoryOverrides,
    };
    const profiles = {
      requireProfile: jest.fn(async () => profileDouble()),
      assertEditable: jest.fn(),
      assertPaymentQrEditable: jest.fn(),
    };
    const storage = {
      isConfigured: jest.fn(() => true),
      createUploadTicket: jest.fn(() => ({ storageKey: 'k', uploadUrl: 'u' })),
      readObjectMetadata: jest.fn(async (..._a: unknown[]) => metadata),
    };
    const service = new PartnerQrService(repository as never, profiles as never, storage as never, metricsDouble());
    return { service, repository, storage };
  }

  /*
   * Fiarse de lo que el cliente declaró dejaría entrar en el expediente una fila que afirma «QR en
   * PNG» sobre un objeto que puede no existir siquiera — y el expediente vale por lo que afirma.
   */
  it('no registra un QR cuyo objeto no está en el almacenamiento', async () => {
    const { service, repository } = build({}, null);

    await expect(service.register('1', '10', { qrKind: 'business', storageKey: '1/partner-10/qr-business/a.png' })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(repository.createQrCode).not.toHaveBeenCalled();
  });

  it('rechaza un objeto que no es imagen aunque exista', async () => {
    const { service } = build({}, { contentType: 'application/pdf', sizeBytes: 10, sha256Hex: 'a'.repeat(64) });

    await expect(service.register('1', '10', { qrKind: 'business', storageKey: '1/partner-10/qr-business/a.pdf' })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  /*
   * El reemplazo es la regla que hace auditable el cobro: si un pago salió mal hay que poder
   * reconstruir contra qué QR se cobró ese día, y sobrescribir en sitio destruye exactamente eso.
   */
  it('al subir un QR nuevo conserva el anterior marcándolo como reemplazado', async () => {
    const previous = { id: '50' };
    const { service, repository } = build(
      { findLiveQr: jest.fn(async () => previous) },
      { contentType: 'image/png', sizeBytes: 2048, sha256Hex: 'b'.repeat(64) },
    );

    await service.register('1', '10', {
      qrKind: 'bank',
      storageKey: '1/partner-10/qr-bank/b.png',
      bankInstitutionCode: 'BNB',
      accountNumberMasked: '****7890',
    });

    expect(repository.markQrReplaced).toHaveBeenCalledWith(previous, '99');
  });

  /* El hash se calcula sobre el contenido descargado: uno que aporte el cliente prueba lo que el
   * cliente quiera. */
  it('guarda el hash y el tipo REALES del objeto, no los declarados', async () => {
    const { service, repository } = build({}, { contentType: 'image/jpeg', sizeBytes: 4096, sha256Hex: 'c'.repeat(64) });

    await service.register('1', '10', { qrKind: 'business', storageKey: '1/partner-10/qr-business/c.png' });

    expect(repository.createQrCode).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: 'image/jpeg', sizeBytes: 4096, sha256: 'c'.repeat(64) }),
    );
  });

  it('no deja colgar un QR de la sucursal de otro comercio', async () => {
    const { service } = build(
      { findBranchById: jest.fn(async (..._a: unknown[]) => null as AnyRecord | null) },
      { contentType: 'image/png', sizeBytes: 10, sha256Hex: 'd'.repeat(64) },
    );

    await expect(service.register('1', '10', { qrKind: 'business', branchId: '999', storageKey: 'k' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('PartnerCommerceService', () => {
  function build(repositoryOverrides: AnyRecord = {}, profileOverrides: AnyRecord = {}) {
    const repository = {
      listBranches: jest.fn(async () => []),
      createBranch: jest.fn(async () => ({ id: '5', branchCode: 'SC-01' })),
      findBranchById: jest.fn(async (..._a: unknown[]) => ({ id: '5', branchCode: 'SC-01' }) as AnyRecord | null),
      findPosBySerial: jest.fn(async (..._a: unknown[]) => null as AnyRecord | null),
      createPosTerminal: jest.fn(async () => ({ id: '7' })),
      findPosById: jest.fn(async () => ({ id: '7', status: 'registered', activatedAt: null })),
      updatePosStatus: jest.fn(async () => ({ id: '7', status: 'suspended' })),
      ...repositoryOverrides,
    };
    const profiles = {
      requireProfile: jest.fn(async () => profileDouble(profileOverrides)),
      assertEditable: jest.fn(),
      assertPaymentQrEditable: jest.fn(),
      /* Sucursales y POS pasan por esta puerta, no por `assertEditable`: un comercio aprobado sigue
         abriendo locales. El doble no la mockeaba y estos casos morían con un TypeError. */
      assertCommercialNetworkEditable: jest.fn(),
    };
    const service = new PartnerCommerceService(repository as never, profiles as never, metricsDouble());
    return { service, repository, profiles };
  }

  /*
   * El serial se comprueba contra TODO el tenant: mover un POS de local es normal, pero el mismo
   * serial vivo en dos sitios a la vez sería la forma más simple de duplicar cobros sin que nada
   * lo delate.
   */
  it('rechaza un serial ya registrado aunque sea en otra sucursal', async () => {
    const { service, repository } = build({
      findPosBySerial: jest.fn(async (..._a: unknown[]) => ({ id: '3', branchId: '99' }) as AnyRecord | null),
    });

    await expect(service.registerPosTerminal('1', '10', '5', { terminalSerial: 'SN-0001' })).rejects.toBeInstanceOf(ConflictException);
    expect(repository.createPosTerminal).not.toHaveBeenCalled();
  });

  it('no registra un terminal en la sucursal de otro comercio', async () => {
    const { service } = build({ findBranchById: jest.fn(async (..._a: unknown[]) => null as AnyRecord | null) });

    await expect(service.registerPosTerminal('1', '10', '999', { terminalSerial: 'SN-0002' })).rejects.toBeInstanceOf(NotFoundException);
  });

  /*
   * Suspender es una medida de CONTENCIÓN. Exigir que el expediente estuviera en borrador se la
   * negaría justo al comercio aprobado, que es el único que puede cobrar de verdad.
   */
  it('permite suspender un terminal aunque el expediente ya esté aprobado', async () => {
    const { service, profiles } = build({}, { onboardingStatus: 'approved' });

    await expect(service.changePosStatus('1', '10', '7', { status: 'suspended' })).resolves.toMatchObject({ status: 'suspended' });
    expect(profiles.assertEditable).not.toHaveBeenCalled();
  });

  it('rechaza el código de sucursal repetido', async () => {
    const { service } = build({ listBranches: jest.fn(async () => [{ branchCode: 'SC-01' }]) });

    await expect(service.registerBranch('1', '10', { branchCode: 'SC-01', name: 'Centro' })).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('PartnerContactVerificationService', () => {
  function build(profileOverrides: AnyRecord = {}, mailEnabled = true) {
    const updates: AnyRecord[] = [];
    const perfil = () =>
      profileDouble({
        contactEmail: 'comercio@atlas.test',
        emailVerifiedAt: null,
        contactCodeHash: null,
        contactCodeExpiresAt: null,
        contactCodeAttempts: 0,
        contactCodeSentAt: null,
        ...profileOverrides,
      });
    const repository = {
      updateProfile: jest.fn(async (...args: unknown[]) => {
        updates.push(args[1] as AnyRecord);
        return {} as AnyRecord;
      }),
      /*
       * El canje del código carga el expediente con la fila BLOQUEADA: leer el contador de
       * intentos, decidir con él y escribirlo tienen que ser una sola operación, o el límite se
       * esquiva probando en paralelo. El doble devuelve el mismo perfil que `requireProfile`.
       */
      lockProfileById: jest.fn(async () => perfil()),
    };
    const profiles = {
      requireProfile: jest.fn(async () => perfil()),
      assertEditable: jest.fn(),
      assertPaymentQrEditable: jest.fn(),
    };
    /** La transacción del doble sólo ejecuta el cuerpo: no hay base contra la que abrirla. */
    const sequelize = { transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn({})) };
    const mail = {
      isEnabled: jest.fn(() => mailEnabled),
      sendContactVerificationCode: jest.fn(async (..._a: unknown[]) => ({ trackingId: 't' })),
    };
    const service = new PartnerContactVerificationService(
      sequelize as never,
      repository as never,
      profiles as never,
      mail as never,
      metricsDouble(),
    );
    return { service, repository, mail, updates };
  }

  /*
   * El destino sale del EXPEDIENTE y nunca de la petición: si viajara en el cuerpo, esto no
   * probaría nada — cualquiera pediría el código a su propio buzón y lo daría por verificado.
   */
  it('manda el código al correo del expediente, no a uno recibido', async () => {
    const { service, mail } = build();

    await service.request('1', '10');

    expect(mail.sendContactVerificationCode).toHaveBeenCalledWith(expect.objectContaining({ to: 'comercio@atlas.test' }));
  });

  /* El código se guarda HASHEADO: quien lea la base no puede verificar por él. */
  it('nunca guarda el código en claro', async () => {
    const { service, updates, mail } = build();

    await service.request('1', '10');
    const enviado = (mail.sendContactVerificationCode.mock.calls[0] as unknown[])[0] as AnyRecord;

    expect(updates[0]?.contactCodeHash).not.toBe(enviado.code);
    expect(String(updates[0]?.contactCodeHash)).not.toContain(String(enviado.code));
  });

  it('sin canal de correo no finge haber enviado nada', async () => {
    const { service, mail } = build({}, false);

    await expect(service.request('1', '10')).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(mail.sendContactVerificationCode).not.toHaveBeenCalled();
  });

  it('no reenvía dentro de la ventana de espera', async () => {
    const { service } = build({ contactCodeSentAt: new Date() });

    await expect(service.request('1', '10')).rejects.toBeInstanceOf(ConflictException);
  });

  /*
   * El intento se cuenta al fallar. Sin esto, el TTL no protege nada: un millón de combinaciones
   * de seis dígitos caben de sobra dentro de diez minutos.
   */
  it('gasta un intento con cada código equivocado', async () => {
    const { service, updates } = build({
      contactCodeHash: hashOneTimeCode('123456'),
      contactCodeExpiresAt: new Date(Date.now() + 60_000),
      contactCodeAttempts: 2,
    });

    await expect(service.submit('1', '10', '999999')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(updates[0]?.contactCodeAttempts).toBe(3);
  });

  it('con los intentos agotados no acepta ni el código bueno', async () => {
    const { service } = build({
      contactCodeHash: hashOneTimeCode('123456'),
      contactCodeExpiresAt: new Date(Date.now() + 60_000),
      contactCodeAttempts: 5,
    });

    await expect(service.submit('1', '10', '123456')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('un código vencido no vale aunque sea el correcto', async () => {
    const { service } = build({
      contactCodeHash: hashOneTimeCode('123456'),
      contactCodeExpiresAt: new Date(Date.now() - 1_000),
    });

    await expect(service.submit('1', '10', '123456')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  /* «Un solo uso» significa que el código se consume: dejarlo vivo permitiría reutilizarlo. */
  it('al verificar consume el código y marca el contacto probado', async () => {
    const { service, updates } = build({
      contactCodeHash: hashOneTimeCode('123456'),
      contactCodeExpiresAt: new Date(Date.now() + 60_000),
    });

    await expect(service.submit('1', '10', '123456')).resolves.toEqual({ verified: true });
    expect(updates[0]?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(updates[0]?.contactCodeHash).toBeNull();
    expect(updates[0]?.onboardingStatus).toBe('contact_verified');
  });

  /*
   * Verificar el correo es un paso LATERAL: si el expediente ya iba más adelante, retrocederlo
   * borraría avance real por haber completado algo que no lo condiciona.
   */
  it('no retrocede el estado de un expediente que ya iba más adelante', async () => {
    const { service, updates } = build({
      onboardingStatus: 'documents_submitted',
      contactCodeHash: hashOneTimeCode('123456'),
      contactCodeExpiresAt: new Date(Date.now() + 60_000),
    });

    await service.submit('1', '10', '123456');

    expect(updates[0]?.onboardingStatus).toBeUndefined();
  });
});

/**
 * La clave del objeto tiene que caer dentro del expediente.
 *
 * Hallazgo `authorization` de la revisión del 20-ago-2026: `createUploadTicket` impone la ruta bajo
 * el prefijo del tenant y del partner —para que nadie escriba sobre la evidencia de otro—, pero el
 * REGISTRO aceptaba cualquier `storageKey`. Bastaba pedir un permiso legítimo, ignorarlo y
 * registrar la clave del QR de otro partner como propia: el expediente acabaría afirmando, con su
 * hash y todo, que esa cuenta de cobro es de este comercio.
 */
describe('PartnerQrService · clave de objeto', () => {
  function build() {
    const repository = {
      findLiveQr: jest.fn(async () => null),
      createQrCode: jest.fn(async (values: AnyRecord) => ({ id: '1', ...values })),
      markQrReplaced: jest.fn(async () => undefined),
      findBranchById: jest.fn(async () => ({ id: '5' })),
    };
    const profiles = {
      requireProfile: jest.fn(async () => profileDouble({ onboardingStatus: 'draft' })),
      assertEditable: jest.fn(),
      assertPaymentQrEditable: jest.fn(),
    };
    const storage = {
      isConfigured: jest.fn(() => true),
      readObjectMetadata: jest.fn(async () => ({ contentType: 'image/png', sizeBytes: 100, sha256Hex: 'abc' })),
    };
    const service = new PartnerQrService(repository as never, profiles as never, storage as never, metricsDouble());
    return { service, repository, storage };
  }

  const dto = (storageKey: string) => ({ qrKind: 'business' as const, storageKey });

  it('rechaza la clave del expediente de OTRO partner y no llega a mirar el objeto', async () => {
    const { service, storage } = build();

    await expect(service.register('1', '10', dto('1/partner-99/qr-business/abc.png') as never)).rejects.toThrow(
      /QR_OBJECT_OUTSIDE_PARTNER_SCOPE/,
    );
    expect(storage.readObjectMetadata).not.toHaveBeenCalled();
  });

  it('rechaza la clave de otro TENANT', async () => {
    const { service } = build();

    await expect(service.register('1', '10', dto('2/partner-10/qr-business/abc.png') as never)).rejects.toThrow(
      /QR_OBJECT_OUTSIDE_PARTNER_SCOPE/,
    );
  });

  it('no se deja engañar por un prefijo que sólo COMIENZA igual', async () => {
    // `partner-1` es prefijo textual de `partner-10`: por eso se compara con la barra incluida.
    const { service } = build();

    await expect(service.register('1', '1', dto('1/partner-10/qr-business/abc.png') as never)).rejects.toThrow(
      /QR_OBJECT_OUTSIDE_PARTNER_SCOPE/,
    );
  });

  it('acepta la clave que el propio permiso de subida habría impuesto', async () => {
    const { service, repository } = build();

    await service.register('1', '10', dto('1/partner-10/qr-business/abc.png') as never);

    expect(repository.createQrCode).toHaveBeenCalled();
  });
});
