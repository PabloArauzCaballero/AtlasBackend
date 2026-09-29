/**
 * @file Contrato del expediente del alta que se anexa al caso de revisión del Motor.
 * @business Lo que el analista necesita para decidir una identidad: lo declarado, lo leído del carnet, cómo se hizo el alta y qué dejó el teléfono.
 * @system tipo de salida de `OnboardingReviewDossierService.build`; lo consumen el anexo al Motor y `GET /operations/customers/:id/review-dossier`.
 */

/** Versión del contrato. Sube si cambia el significado de un campo, no si se añade uno. */
export const ONBOARDING_REVIEW_DOSSIER_VERSION = 1;

export type LatLng = { lat: number; lng: number };

/**
 * Regla general: un bloque o campo sin dato es `null`, NUNCA un valor inventado. Sin PII en claro
 * salvo la que se revisa: el carnet sólo con sus últimos cuatro, teléfono y correo enmascarados, y la
 * calle sí (se revisa el domicilio).
 */
export type OnboardingReviewDossier = {
  version: typeof ONBOARDING_REVIEW_DOSSIER_VERSION;
  generadoEn: string;
  cliente: { customerId: string; customerCode: string | null; estado: string | null };
  declarado: {
    nombreCompleto: string | null;
    nombres: string | null;
    apellidos: string | null;
    carnetUltimos4: string | null;
    fechaNacimiento: string | null;
    edad: number | null;
    /** Menor de 23 años: mayor riesgo según la política del alta. `null` sin fecha de nacimiento. */
    menorDe23: boolean | null;
    telefono: string | null;
    telefonoVerificado: boolean | null;
    correo: string | null;
    correoVerificado: boolean | null;
    domicilio: { departamento: string | null; ciudad: string | null; zona: string | null; calle: string | null } | null;
    empleo: {
      tipo: string | null;
      empleador: string | null;
      rubro: string | null;
      bandaIngreso: string | null;
      frecuenciaIngreso: string | null;
      aniosEnTrabajo: number | null;
    } | null;
    extracto: { estado: string; meses: number | null } | null;
  };
  carnetVsDeclarado: {
    segipEstado: string;
    segipCoincidencia: number;
    lecturaCarnet: {
      nombres: string | null;
      apellidos: string | null;
      numeroUltimos4: string | null;
      fechaNacimiento: string | null;
    } | null;
    coincideNombre: boolean | null;
    coincideNacimiento: boolean | null;
    parecidoSelfie: number | null;
    pruebaDeVida: { resultado: string | null; sugerenciaMotor: string | null; puntaje: number | null } | null;
  };
  cronometro: {
    inicioAlta: string | null;
    finAlta: string | null;
    segundosTotal: number | null;
    segundosPorPantalla: { pantalla: string; segundos: number }[];
    ratioErrores: number | null;
    pegadoEnCarnet: boolean | null;
    correccionesOcr: number | null;
    abandonosPrevios: number | null;
    botScore: number | null;
    segundoPlanoEnCaptura: boolean | null;
    senales: string[];
  } | null;
  dispositivo: {
    marca: string | null;
    modelo: string | null;
    sistema: string | null;
    version: string | null;
    versionApp: string | null;
    rooteado: boolean | null;
    emulador: boolean | null;
    huella: string | null;
    primeraVezVisto: string | null;
    otrosClientesConEsteDispositivo: number;
  } | null;
  permisos: { permiso: string; decision: 'concedido' | 'denegado' | 'sin_respuesta'; fecha: string | null }[];
  consentimientos: { finalidad: string; decision: 'concedido' | 'denegado' | 'revocado'; fecha: string | null }[];
  ubicacion: {
    puntoDomicilio: { lat: number; lng: number; precision: number | null } | null;
    pings: {
      total: number;
      primerPlano: number;
      segundoPlano: number;
      simulados: number;
      primero: string | null;
      ultimo: string | null;
      ultimaPosicion: LatLng | null;
      distanciaMedianaAlDomicilioM: number | null;
      distanciaMaximaAlDomicilioM: number | null;
    };
    rastreoSiempre: boolean | null;
  };
  agenda: {
    compartida: boolean;
    alcance: string | null;
    total: number | null;
    unicosRatio: number | null;
    boliviaRatio: number | null;
    referenciasEnAgenda: number | null;
    coincidenciasRiesgo: number | null;
    sincronizados: number;
  };
  evidencias: { tipo: string; fecha: string | null }[];
};
