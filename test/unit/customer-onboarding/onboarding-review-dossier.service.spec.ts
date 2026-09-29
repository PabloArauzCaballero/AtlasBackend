/**
 * @file El expediente del alta que ve quien revisa la identidad: todo lo guardado, nada inventado, nada de más.
 * @business Pablo pidió que el caso del alta en el Motor lleve cronómetro, dispositivo, permisos, ubicación, agenda, SEGIP y lo declarado frente al carnet.
 * @system Ejercita `OnboardingReviewDossierService.build` con dobles de las lecturas que reutiliza.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { OnboardingReviewDossierService } from '../../../src/modules/customer-onboarding/application/onboarding-review-dossier.service.js';

const NACIMIENTO_JOVEN = `${new Date().getUTCFullYear() - 20}-01-15`;

function completo() {
  return {
    customer: {
      id: 'c1',
      customerCode: 'CLI-0001',
      lifecycleStatus: 'under_review',
      primaryPhoneLast4: '9999',
      primaryEmailDomain: 'x.com',
    },
    answers: {
      customerId: 'c1',
      personalData: { firstName: 'José Luis', lastName: 'Pérez', birthDate: NACIMIENTO_JOVEN },
      financialProfile: {
        employmentStatus: 'employee',
        employerName: 'Tienda Sol',
        economicActivityCode: 'comercio',
        monthlyIncomeBand: 'bs_3000_5000',
        monthlyIncomeDeclared: 3000,
        incomeFrequency: 'monthly',
        employmentSeniorityMonths: 30,
      },
      address: {
        countryCode: 'BOL',
        department: 'Santa Cruz',
        city: 'Santa Cruz de la Sierra',
        zone: 'Equipetrol',
        addressLine: 'Av. Busch 1234',
        gps: { lat: -17.77, lng: -63.18, accuracyMeters: 12 },
      },
    },
    document: { declaredNumberLast4: '5678', ocrFullName: null, ocrBirthDate: null },
    contactMethods: [
      { contactType: 'phone', valueLast4: '4321', status: 'verified' },
      { contactType: 'email', emailDomain: 'gmail.com', status: 'pending' },
    ],
    attempts: [
      {
        verificationChannel: 'MOBILE_APP',
        finalResult: 'IN_REVIEW',
        selfieMatchScore: '0.91',
        livenessScore: null,
        reasonCodesJson: {
          executionId: 'ex-1',
          engineDecision: 'VERIFIED',
          humanReviewPolicy: true,
          extracted: {
            firstNames: { value: 'JOSE LUIS', source: 'OCR' },
            lastNames: { value: 'PEREZ', source: 'OCR' },
            documentNumber: { value: '12345678', source: 'MRZ' },
            dateOfBirth: { value: NACIMIENTO_JOVEN.split('-').reverse().join('/'), source: 'OCR' },
          },
        },
      },
      { verificationChannel: 'onboarding_package', finalResult: 'verified', reasonCodesJson: null },
    ],
    statement: { status: 'rejected', monthsComplete: 2 },
    evidence: [
      { documentType: 'identity_front', uploadedAt: new Date('2026-09-28T10:00:00Z') },
      { documentType: 'selfie_left', uploadedAt: new Date('2026-09-28T10:01:00Z') },
      { documentType: null, uploadedAt: null },
    ],
    resumen: {
      completionTimeSeconds: 420,
      interScreenTimingJson: {
        pantallas: { identidad: { totalMs: 120_000 }, economia: { totalMs: 60_000 } },
        detalle: { correccionesSobreOcr: 2, segundoPlanoDuranteCaptura: true, senales: ['PEGADO_EN_CARNET'] },
      },
      formErrorRate: 0.1,
      ciCopyPasteDetected: true,
      abandonmentCountPrior: 1,
      botLikelihoodScore: 0.2,
    },
    flow: { startedAt: new Date('2026-09-28T09:50:00Z'), completedAt: new Date('2026-09-28T10:30:00Z') },
    device: {
      link: { firstSeenAt: new Date('2026-09-01T00:00:00Z') },
      device: { deviceFingerprint: 'abcdef0123456789ffff', firstSeenAt: new Date('2026-08-01T00:00:00Z') },
      snapshot: {
        brand: 'samsung',
        model: 'SM-A145',
        osFamily: 'android',
        osVersion: '14',
        appVersion: '1.0.7',
        isRooted: false,
        isEmulator: false,
      },
      otrosClientes: 2,
    },
    permisos: [
      { permissionCode: 'location_background', granted: true, respondedAt: new Date('2026-09-28T10:10:00Z'), requestedAt: null },
      { permissionCode: 'contacts', granted: true, respondedAt: new Date('2026-09-28T10:09:00Z'), requestedAt: null },
    ],
    consents: [
      {
        purposeCode: 'device_address_book',
        granted: true,
        grantedAt: new Date('2026-09-28T10:09:00Z'),
        revokedAt: null,
        createdAtValue: new Date('2026-09-28T10:09:00Z'),
      },
    ],
    pings: [
      {
        captureMode: 'foreground',
        isMocked: false,
        capturedAt: new Date('2026-09-28T10:11:00Z'),
        gpsLat: '-17.7',
        gpsLng: '-63.1',
        distanceToDeclaredMeters: '80',
      },
    ],
    features: {
      available: true,
      totalContacts: 250,
      uniqueRatio: 0.9,
      bolivianRatio: 0.8,
      referencesFoundInAddressBook: 1,
      riskMatches: 0,
    },
    alcance: 'limited',
    sincronizados: 240,
  };
}

type Datos = ReturnType<typeof completo>;

function build(datos: Partial<Datos> & Record<string, unknown> = completo()) {
  const d = { ...completo(), ...datos } as Datos;
  const customers = { findById: jest.fn(async (..._args: unknown[]) => d.customer) };
  const answers = { read: jest.fn(async (..._args: unknown[]) => d.answers) };
  const repository = {
    findCurrentIdentityDocument: jest.fn(async (..._args: unknown[]) => d.document),
    findContactMethods: jest.fn(async (..._args: unknown[]) => d.contactMethods),
    findRecentAttempts: jest.fn(async (..._args: unknown[]) => d.attempts),
    findLatestBankStatement: jest.fn(async (..._args: unknown[]) => d.statement),
    findEvidence: jest.fn(async (..._args: unknown[]) => d.evidence),
    findLatestFlow: jest.fn(async (..._args: unknown[]) => d.flow),
    findDevice: jest.fn(async (..._args: unknown[]) => d.device),
    findPermissionEvents: jest.fn(async (..._args: unknown[]) => d.permisos),
    findConsents: jest.fn(async (..._args: unknown[]) => d.consents),
    findPings: jest.fn(async (..._args: unknown[]) => d.pings),
    findAddressBookScope: jest.fn(async (..._args: unknown[]) => d.alcance),
    countSyncedContacts: jest.fn(async (..._args: unknown[]) => d.sincronizados),
  };
  const contacts = { featuresFor: jest.fn(async (..._args: unknown[]) => d.features) };
  const behavior = { ultimo: jest.fn(async (..._args: unknown[]) => d.resumen), calcular: jest.fn() };
  const service = new OnboardingReviewDossierService(
    customers as never,
    answers as never,
    repository as never,
    contacts as never,
    behavior as never,
  );
  return { service, customers, answers, repository, contacts, behavior };
}

describe('OnboardingReviewDossierService.build', () => {
  it('arma el expediente completo con lo guardado, enmascarando lo que no se revisa', async () => {
    const { service } = build();

    const dossier = await service.build('t1', 'c1');

    expect(dossier.version).toBe(1);
    expect(dossier.cliente).toEqual({ customerId: 'c1', customerCode: 'CLI-0001', estado: 'under_review' });
    expect(dossier.declarado).toMatchObject({
      nombreCompleto: 'José Luis Pérez',
      carnetUltimos4: '5678',
      edad: 20,
      menorDe23: true,
      telefono: '•••• 4321',
      telefonoVerificado: true,
      correo: '•••@gmail.com',
      correoVerificado: false,
      domicilio: { departamento: 'Santa Cruz', ciudad: 'Santa Cruz de la Sierra', zona: 'Equipetrol', calle: 'Av. Busch 1234' },
      empleo: {
        tipo: 'employee',
        empleador: 'Tienda Sol',
        rubro: 'comercio',
        bandaIngreso: 'bs_3000_5000',
        frecuenciaIngreso: 'monthly',
        aniosEnTrabajo: 2.5,
      },
      extracto: { estado: 'rejected', meses: 2 },
    });
    expect(dossier.carnetVsDeclarado).toEqual({
      segipEstado: 'FOUND',
      segipCoincidencia: 1,
      lecturaCarnet: { nombres: 'JOSE LUIS', apellidos: 'PEREZ', numeroUltimos4: '5678', fechaNacimiento: expect.any(String) },
      coincideNombre: true,
      coincideNacimiento: true,
      parecidoSelfie: 0.91,
      pruebaDeVida: { resultado: 'IN_REVIEW', sugerenciaMotor: 'VERIFIED', puntaje: null },
    });
    expect(dossier.cronometro).toEqual({
      inicioAlta: '2026-09-28T09:50:00.000Z',
      finAlta: '2026-09-28T10:30:00.000Z',
      segundosTotal: 420,
      segundosPorPantalla: [
        { pantalla: 'identidad', segundos: 120 },
        { pantalla: 'economia', segundos: 60 },
      ],
      ratioErrores: 0.1,
      pegadoEnCarnet: true,
      correccionesOcr: 2,
      abandonosPrevios: 1,
      botScore: 0.2,
      segundoPlanoEnCaptura: true,
      senales: ['PEGADO_EN_CARNET'],
    });
    expect(dossier.dispositivo).toEqual({
      marca: 'samsung',
      modelo: 'SM-A145',
      sistema: 'android',
      version: '14',
      versionApp: '1.0.7',
      rooteado: false,
      emulador: false,
      huella: 'abcdef012345',
      primeraVezVisto: '2026-08-01T00:00:00.000Z',
      otrosClientesConEsteDispositivo: 2,
    });
    expect(dossier.permisos).toHaveLength(2);
    expect(dossier.consentimientos).toEqual([
      { finalidad: 'device_address_book', decision: 'concedido', fecha: '2026-09-28T10:09:00.000Z' },
    ]);
    expect(dossier.ubicacion).toMatchObject({
      puntoDomicilio: { lat: -17.77, lng: -63.18, precision: 12 },
      pings: { total: 1, distanciaMedianaAlDomicilioM: 80 },
      rastreoSiempre: true,
    });
    expect(dossier.agenda).toEqual({
      compartida: true,
      alcance: 'limited',
      total: 250,
      unicosRatio: 0.9,
      boliviaRatio: 0.8,
      referenciasEnAgenda: 1,
      coincidenciasRiesgo: 0,
      sincronizados: 240,
    });
    expect(dossier.evidencias).toEqual([
      { tipo: 'identity_front', fecha: '2026-09-28T10:00:00.000Z' },
      { tipo: 'selfie_left', fecha: '2026-09-28T10:01:00.000Z' },
      { tipo: 'other', fecha: null },
    ]);
    // Nada de PII en claro fuera de la calle: ni el número completo del carnet ni el teléfono.
    const texto = JSON.stringify(dossier);
    expect(texto).not.toContain('12345678');
  });

  it('un cliente recién empezado: todo lo que no hay es null o vacío, nunca inventado', async () => {
    const { service } = build({
      customer: { id: 'c1', customerCode: null, lifecycleStatus: 'registered', primaryPhoneLast4: null, primaryEmailDomain: null },
      answers: { customerId: 'c1', personalData: null, financialProfile: {}, address: null },
      document: null,
      contactMethods: [],
      attempts: [],
      statement: null,
      evidence: [],
      resumen: null,
      flow: null,
      device: null,
      permisos: [],
      consents: [],
      pings: [],
      features: { available: false, totalContacts: 0, uniqueRatio: 0, bolivianRatio: 0, referencesFoundInAddressBook: 0, riskMatches: 0 },
      alcance: null,
      sincronizados: 0,
    } as never);

    const dossier = await service.build('t1', 'c1');

    expect(dossier.declarado).toEqual({
      nombreCompleto: null,
      nombres: null,
      apellidos: null,
      carnetUltimos4: null,
      fechaNacimiento: null,
      edad: null,
      menorDe23: null,
      telefono: null,
      telefonoVerificado: null,
      correo: null,
      correoVerificado: null,
      domicilio: null,
      empleo: null,
      extracto: null,
    });
    expect(dossier.carnetVsDeclarado).toEqual({
      segipEstado: 'NO_CONSULTADO',
      segipCoincidencia: 0,
      lecturaCarnet: null,
      coincideNombre: null,
      coincideNacimiento: null,
      parecidoSelfie: null,
      pruebaDeVida: null,
    });
    expect(dossier.cronometro).toBeNull();
    expect(dossier.dispositivo).toBeNull();
    expect(dossier.ubicacion).toMatchObject({ puntoDomicilio: null, rastreoSiempre: null, pings: { total: 0 } });
    expect(dossier.agenda).toEqual({
      compartida: false,
      alcance: null,
      total: null,
      unicosRatio: null,
      boliviaRatio: null,
      referenciasEnAgenda: null,
      coincidenciasRiesgo: null,
      sincronizados: 0,
    });
  });

  it('sin lectura del Motor usa el OCR guardado del documento, y compara igual', async () => {
    const base = completo();
    const { service } = build({
      attempts: [{ verificationChannel: 'onboarding_package', finalResult: 'rejected', reasonCodesJson: null }],
      document: { declaredNumberLast4: '5678', ocrFullName: 'JOSE LUIS PEREZ', ocrBirthDate: base.answers.personalData.birthDate },
    } as never);

    const { carnetVsDeclarado } = await service.build('t1', 'c1');

    expect(carnetVsDeclarado).toMatchObject({
      segipEstado: 'NOT_FOUND',
      lecturaCarnet: { nombres: 'JOSE LUIS PEREZ', apellidos: null, numeroUltimos4: null },
      coincideNombre: true,
      coincideNacimiento: true,
      pruebaDeVida: null,
    });
  });

  it('un bloque que no se puede leer queda vacío y el expediente sale igual', async () => {
    const { service, repository, behavior } = build();
    (repository.findDevice as jest.Mock).mockRejectedValueOnce(new Error('relation "devices" does not exist') as never);
    (repository.findPings as jest.Mock).mockRejectedValueOnce(new Error('timeout') as never);
    (behavior.ultimo as jest.Mock).mockRejectedValueOnce(new Error('boom') as never);

    const dossier = await service.build('t1', 'c1');

    expect(dossier.dispositivo).toBeNull();
    expect(dossier.cronometro).toBeNull();
    expect(dossier.ubicacion.pings.total).toBe(0);
    expect(dossier.declarado.nombres).toBe('José Luis');
  });

  it('no recalcula el comportamiento: construir el expediente no escribe filas', async () => {
    const { service, behavior } = build();

    await service.build('t1', 'c1');

    expect(behavior.ultimo).toHaveBeenCalledWith('t1', 'c1');
    expect(behavior.calcular).not.toHaveBeenCalled();
  });

  it('un cliente que no existe es 404', async () => {
    const { service } = build({ customer: null } as never);

    await expect(service.build('t1', 'c1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
