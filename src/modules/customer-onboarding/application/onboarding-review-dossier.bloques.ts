/**
 * @file Los bloques del expediente del alta, armados desde lo que ya se leyó.
 * @business Cada bloque dice lo que Atlas sabe y deja en `null` lo que no: nada inventado, nada de PII de más.
 * @system funciones puras que compone `OnboardingReviewDossierService`; sin base ni Nest.
 */
import {
  estadoDelRegistroEstatalDe,
  LIVENESS_IDENTITY_CHANNEL,
  pickCurrentIdentityAttempt,
} from '../../../common/utils/identity/identity-result.util.js';
import { calculateAgeInYears } from '../../customers/application/customer-eligibility.evaluator.js';
import type { ContactsSnapshotFeatures } from '../customer-contacts-snapshot.schemas.js';
import type { OnboardingAnswers } from './customer-onboarding-answers.service.js';
import {
  aniosDesdeMeses,
  coincideNacimiento,
  coincideNombre,
  EDAD_DE_MAYOR_RIESGO,
  enmascararCorreo,
  enmascararTelefono,
  isoONulo,
  numeroONulo,
  rastreoSiempre,
  resumenDePings,
  segundosPorPantalla,
  ultimos4,
  type PingLeido,
} from './onboarding-review-dossier.mapeo.js';
import type { OnboardingReviewDossier as Dossier } from './onboarding-review-dossier.types.js';

/** `obj.key`, o `null` si no hay objeto o el valor no está. Evita una cadena de `?.` y `??` por campo. */
export function campo<T extends object, K extends keyof T>(obj: T | null | undefined, key: K): NonNullable<T[K]> | null {
  if (!obj) return null;
  const valor = obj[key];
  return valor === undefined || valor === null ? null : (valor as NonNullable<T[K]>);
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : null;
}

/** Lo leído del carnet por el Motor: `{ campo: { value } }`, ya filtrado a procedencias fiables al guardarlo. */
function valorLeido(extracted: unknown, nombre: string): string | null {
  const crudo = (extracted as Record<string, { value?: unknown } | undefined>)[nombre];
  return texto(crudo?.value);
}

type Perfil = OnboardingAnswers['personalData'];
type Contacto = { contactType: string | null; valueLast4?: string | null; emailDomain?: string | null; status: string | null };
type Cliente = { primaryPhoneLast4: string | null; primaryEmailDomain: string | null };

export function identidadDeclarada(perfil: Perfil, carnetUltimos4: string | null, now: Date) {
  const nacimiento = campo(perfil, 'birthDate');
  const edad = nacimiento ? calculateAgeInYears(nacimiento, now) : Number.NaN;
  const edadValida = Number.isFinite(edad) ? edad : null;
  const nombres = campo(perfil, 'firstName');
  const apellidos = campo(perfil, 'lastName');
  return {
    nombreCompleto: [nombres, apellidos].filter(Boolean).join(' ') || null,
    nombres,
    apellidos,
    carnetUltimos4,
    fechaNacimiento: nacimiento,
    edad: edadValida,
    menorDe23: edadValida === null ? null : edadValida < EDAD_DE_MAYOR_RIESGO,
  };
}

/** Teléfono y correo SIEMPRE enmascarados; verificado sólo si hay método de contacto que lo diga. */
export function contactoDeclarado(metodos: readonly Contacto[], cliente: Cliente) {
  const phone = metodos.find((metodo) => metodo.contactType === 'phone') ?? null;
  const email = metodos.find((metodo) => metodo.contactType === 'email') ?? null;
  return {
    telefono: enmascararTelefono(campo(phone, 'valueLast4') ?? cliente.primaryPhoneLast4),
    telefonoVerificado: phone ? phone.status === 'verified' : null,
    correo: enmascararCorreo(campo(email, 'emailDomain') ?? cliente.primaryEmailDomain),
    correoVerificado: email ? email.status === 'verified' : null,
  };
}

export function domicilioDeclarado(address: OnboardingAnswers['address']): Dossier['declarado']['domicilio'] {
  if (!address) return null;
  return { departamento: address.department, ciudad: address.city, zona: address.zone, calle: address.addressLine };
}

export function empleoDeclarado(financiero: OnboardingAnswers['financialProfile']): Dossier['declarado']['empleo'] {
  if (Object.keys(financiero).length === 0) return null;
  return {
    tipo: texto(financiero.employmentStatus),
    empleador: texto(financiero.employerName),
    rubro: texto(financiero.economicActivityCode),
    bandaIngreso: texto(financiero.monthlyIncomeBand),
    frecuenciaIngreso: texto(financiero.incomeFrequency),
    aniosEnTrabajo: aniosDesdeMeses(numeroONulo(campo(financiero, 'employmentSeniorityMonths'))),
  };
}

export function extractoDeclarado(statement: { status: string; monthsComplete: number | null } | null): Dossier['declarado']['extracto'] {
  return statement ? { estado: statement.status, meses: campo(statement, 'monthsComplete') } : null;
}

type IntentoLeido = {
  verificationChannel: string | null;
  finalResult: string | null;
  selfieMatchScore: string | null;
  livenessScore: string | null;
  reasonCodesJson: Record<string, unknown> | null;
};
type OcrGuardado = { ocrFullName: string | null; ocrBirthDate: string | null } | null;

function lecturaDelCarnet(extracted: unknown, document: OcrGuardado): Dossier['carnetVsDeclarado']['lecturaCarnet'] {
  if (extracted && typeof extracted === 'object') {
    return {
      nombres: valorLeido(extracted, 'firstNames'),
      apellidos: valorLeido(extracted, 'lastNames'),
      numeroUltimos4: ultimos4(valorLeido(extracted, 'documentNumber')),
      fechaNacimiento: valorLeido(extracted, 'dateOfBirth'),
    };
  }
  const nombre = campo(document, 'ocrFullName');
  const nacimiento = campo(document, 'ocrBirthDate');
  if (!nombre && !nacimiento) return null;
  return { nombres: nombre, apellidos: null, numeroUltimos4: null, fechaNacimiento: nacimiento };
}

/**
 * Lo leído del carnet frente a lo declarado, y el registro estatal. La lectura sale del último intento
 * MÓVIL (lo que el Motor leyó); si no la hay, del OCR guardado en el documento.
 */
export function carnetVsDeclarado(attempts: readonly IntentoLeido[], document: OcrGuardado, perfil: Perfil): Dossier['carnetVsDeclarado'] {
  const movil = attempts.find((attempt) => attempt.verificationChannel === LIVENESS_IDENTITY_CHANNEL) ?? null;
  const segip = estadoDelRegistroEstatalDe(
    pickCurrentIdentityAttempt(attempts.filter((attempt) => attempt.verificationChannel !== LIVENESS_IDENTITY_CHANNEL)),
  );
  const motivos = campo(movil, 'reasonCodesJson') ?? {};
  const lectura = lecturaDelCarnet(motivos.extracted, document);
  const declarado = { nombres: campo(perfil, 'firstName'), apellidos: campo(perfil, 'lastName') };
  return {
    segipEstado: segip.estado,
    segipCoincidencia: segip.coincidencia,
    lecturaCarnet: lectura,
    coincideNombre: coincideNombre(declarado, lectura),
    coincideNacimiento: coincideNacimiento(campo(perfil, 'birthDate'), campo(lectura, 'fechaNacimiento')),
    parecidoSelfie: numeroONulo(campo(movil, 'selfieMatchScore')),
    pruebaDeVida: movil
      ? { resultado: movil.finalResult, sugerenciaMotor: texto(motivos.engineDecision), puntaje: numeroONulo(movil.livenessScore) }
      : null,
  };
}

type Resumen = {
  completionTimeSeconds: number | null;
  interScreenTimingJson: {
    pantallas?: Record<string, { totalMs: number }>;
    detalle?: { correccionesSobreOcr?: number; segundoPlanoDuranteCaptura?: boolean; senales?: string[] };
  } | null;
  formErrorRate: number | null;
  ciCopyPasteDetected: boolean | null;
  abandonmentCountPrior: number;
  botLikelihoodScore: number | null;
};

/** El cronómetro del alta: el flujo da inicio y fin; el resumen VIGENTE de comportamiento, el resto. */
export function cronometroDe(
  resumen: Resumen | null,
  flow: { startedAt: Date | null; completedAt: Date | null } | null,
): Dossier['cronometro'] {
  if (!resumen && !flow) return null;
  const tiempos = campo(resumen, 'interScreenTimingJson');
  const detalle = campo(tiempos, 'detalle');
  return {
    inicioAlta: isoONulo(campo(flow, 'startedAt')),
    finAlta: isoONulo(campo(flow, 'completedAt')),
    segundosTotal: campo(resumen, 'completionTimeSeconds'),
    segundosPorPantalla: segundosPorPantalla(campo(tiempos, 'pantallas')),
    ratioErrores: campo(resumen, 'formErrorRate'),
    pegadoEnCarnet: campo(resumen, 'ciCopyPasteDetected'),
    correccionesOcr: campo(detalle, 'correccionesSobreOcr'),
    abandonosPrevios: campo(resumen, 'abandonmentCountPrior'),
    botScore: campo(resumen, 'botLikelihoodScore'),
    segundoPlanoEnCaptura: campo(detalle, 'segundoPlanoDuranteCaptura'),
    senales: campo(detalle, 'senales') ?? [],
  };
}

type DispositivoLeido = {
  link: { firstSeenAt: Date | null };
  device: { deviceFingerprint: string | null; firstSeenAt: Date | null } | null;
  snapshot: {
    brand: string | null;
    model: string | null;
    osFamily: string | null;
    osVersion: string | null;
    appVersion: string | null;
    isRooted: boolean | null;
    isEmulator: boolean | null;
  } | null;
  otrosClientes: number;
};

/** El aparato del alta. De la huella sólo los primeros 12 caracteres: basta para cruzar, no para rastrear. */
export function dispositivoDe(leido: DispositivoLeido | null): Dossier['dispositivo'] {
  if (!leido) return null;
  const { device, snapshot } = leido;
  const huella = campo(device, 'deviceFingerprint');
  return {
    marca: campo(snapshot, 'brand'),
    modelo: campo(snapshot, 'model'),
    sistema: campo(snapshot, 'osFamily'),
    version: campo(snapshot, 'osVersion'),
    versionApp: campo(snapshot, 'appVersion'),
    rooteado: campo(snapshot, 'isRooted'),
    emulador: campo(snapshot, 'isEmulator'),
    huella: huella ? huella.slice(0, 12) : null,
    primeraVezVisto: isoONulo(campo(device, 'firstSeenAt') ?? leido.link.firstSeenAt),
    otrosClientesConEsteDispositivo: leido.otrosClientes,
  };
}

export function ubicacionDe(
  address: OnboardingAnswers['address'],
  pings: readonly PingLeido[],
  permisos: Dossier['permisos'],
): Dossier['ubicacion'] {
  const gps = campo(address, 'gps');
  return {
    puntoDomicilio: gps ? { lat: gps.lat, lng: gps.lng, precision: gps.accuracyMeters } : null,
    pings: resumenDePings(pings),
    rastreoSiempre: rastreoSiempre(permisos),
  };
}

export type AgendaLeida = ContactsSnapshotFeatures & { alcance: string | null; sincronizados: number };

/** Los agregados sólo si la agenda se compartió de verdad; si no, `null` (no «cero contactos»). */
export function agendaDe(agenda: AgendaLeida | null, consentimientos: Dossier['consentimientos']): Dossier['agenda'] {
  const consintio = consentimientos.some((c) => c.finalidad === 'device_address_book' && c.decision === 'concedido');
  const base = { alcance: campo(agenda, 'alcance'), sincronizados: campo(agenda, 'sincronizados') ?? 0 };
  if (!agenda?.available) {
    return {
      compartida: consintio,
      ...base,
      total: null,
      unicosRatio: null,
      boliviaRatio: null,
      referenciasEnAgenda: null,
      coincidenciasRiesgo: null,
    };
  }
  return {
    compartida: true,
    ...base,
    total: agenda.totalContacts,
    unicosRatio: agenda.uniqueRatio,
    boliviaRatio: agenda.bolivianRatio,
    referenciasEnAgenda: agenda.referencesFoundInAddressBook,
    coincidenciasRiesgo: agenda.riskMatches,
  };
}
