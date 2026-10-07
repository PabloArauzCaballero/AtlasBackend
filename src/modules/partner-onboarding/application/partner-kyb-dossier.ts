/**
 * @file Arma el anexo del expediente de un comercio que viaja al caso de revisión del Motor.
 * @business Quien aprueba o rechaza un comercio tiene que ver de quién es el expediente y qué le falta, no sólo un número.
 * @system Función pura sobre filas ya leídas; el resultado va en `evidenceJson.alta` del caso (límite 256 KB en el Motor).
 */
import type { PartnerProfileModel } from '../../../database/models/index.js';
import type { SubmissionGap } from './partner-verification.service.js';

/** Lo que se necesita de cada fila; estructural, para armarlo en una prueba sin modelos. */
type Representante = {
  fullName: string;
  documentType: string;
  documentNumber: string;
  powerOfAttorneyKey: string | null;
  verifiedAt: Date | null;
};
type Sucursal = { branchCode: string; name: string; addressLine: string | null; city: string | null; status: string };
type Qr = {
  qrKind: string;
  status: string;
  bankInstitutionCode: string | null;
  accountNumberMasked: string | null;
  verifiedAt: Date | null;
};

export type KybDossierInput = {
  profile: PartnerProfileModel;
  representatives: readonly Representante[];
  branches: readonly Sucursal[];
  qrCodes: readonly Qr[];
  gaps: readonly SubmissionGap[];
};

const iso = (value: Date | null | undefined): string | null => (value ? new Date(value).toISOString() : null);

/**
 * El anexo del comercio, versión 1.
 *
 * Hasta el 2026-10-07 el caso llevaba sólo `{ origen, expedienteId }`: el Motor decide con
 * booleanos y no necesitaba más. Pero desde que la aprobación de un comercio ocurre SÓLO en el
 * Motor (AtlasAdminPortal#130), quien revisa abría el caso y no sabía ni de qué empresa era. Aquí
 * va lo que una persona necesita para decidir: quién es, quién lo representa, dónde opera y qué
 * le falta.
 *
 * Sigue sin viajar lo que no hace falta para eso: ningún número de cuenta completo (sólo el
 * enmascarado que ya enseña la consola), ninguna clave de almacén ni contenido de documentos. Los
 * archivos se abren desde el expediente, con su permiso y su bitácora. Y nada de esto entra en las
 * VARIABLES del artefacto: el grafo sigue decidiendo sin datos del comercio.
 */
export function buildKybDossier(input: KybDossierInput): Record<string, unknown> {
  const { profile } = input;
  return {
    version: 1,
    generadoEn: new Date().toISOString(),
    comercio: {
      razonSocial: profile.legalName,
      nombreComercial: profile.tradeName,
      nit: profile.taxId,
      matriculaDeComercio: profile.commercialRegistry,
      rubro: profile.businessCategory,
      correo: profile.contactEmail,
      correoVerificado: profile.emailVerifiedAt !== null,
      telefono: profile.contactPhone,
      telefonoVerificado: profile.phoneVerifiedAt !== null,
      estado: profile.onboardingStatus,
      creadoEn: iso(profile.createdAtValue),
      enviadoEn: iso(profile.submittedAt),
      cuentaEnElErp: profile.erpAccountId,
    },
    representantes: input.representatives.map((item) => ({
      nombre: item.fullName,
      tipoDeDocumento: item.documentType,
      numeroDeDocumento: item.documentNumber,
      poderAdjunto: Boolean(item.powerOfAttorneyKey),
      verificadoEn: iso(item.verifiedAt),
    })),
    sucursales: input.branches.map((item) => ({
      codigo: item.branchCode,
      nombre: item.name,
      direccion: item.addressLine,
      ciudad: item.city,
      estado: item.status,
    })),
    qr: input.qrCodes.map((item) => ({
      tipo: item.qrKind,
      estado: item.status,
      banco: item.bankInstitutionCode,
      cuentaEnmascarada: item.accountNumberMasked,
      verificadoEn: iso(item.verifiedAt),
    })),
    pendientes: input.gaps.map((gap) => ({ requisito: gap.requirement, detalle: gap.detail })),
  };
}
