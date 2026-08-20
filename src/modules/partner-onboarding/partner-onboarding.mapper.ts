/**
 * @file Mapper: transforma modelos internos a contratos de transporte.
 * @business Esta pieza convierte un comercio declarado en un partner verificable, con locales, cobro y terminales trazables.
 * @system traduce los modelos del expediente al contrato estable que consume el portal.
 */
import {
  PartnerBranchModel,
  PartnerLegalRepresentativeModel,
  PartnerPosTerminalModel,
  PartnerProfileModel,
  PartnerQrCodeModel,
} from '../../database/models/index.js';

/**
 * Ningún modelo Sequelize cruza el borde HTTP.
 *
 * Y hay una omisión deliberada en el QR: **no se publica `storageKey`**. Es la ruta interna del
 * objeto en el almacenamiento; publicarla convierte un listado de lectura en un mapa de dónde
 * están las evidencias de todos los comercios. Lo que el portal necesita para decidir qué pintar
 * es el tipo, el estado y el ámbito, y eso sí viaja.
 */
export function toPartnerProfileDto(model: PartnerProfileModel) {
  return {
    partnerId: model.id,
    legalName: model.legalName,
    tradeName: model.tradeName,
    taxId: model.taxId,
    commercialRegistry: model.commercialRegistry,
    businessCategory: model.businessCategory,
    contactEmail: model.contactEmail,
    contactPhone: model.contactPhone,
    emailVerified: model.emailVerifiedAt !== null,
    phoneVerified: model.phoneVerifiedAt !== null,
    onboardingStatus: model.onboardingStatus,
    submittedAt: model.submittedAt?.toISOString() ?? null,
    decidedAt: model.decidedAt?.toISOString() ?? null,
    rejectionReason: model.rejectionReason,
    erpAccountId: model.erpAccountId,
  };
}

export function toPartnerBranchDto(model: PartnerBranchModel) {
  return {
    branchId: model.id,
    branchCode: model.branchCode,
    name: model.name,
    addressLine: model.addressLine,
    city: model.city,
    latitude: model.latitude === null ? null : Number(model.latitude),
    longitude: model.longitude === null ? null : Number(model.longitude),
    status: model.status,
    erpBranchId: model.erpBranchId,
  };
}

export function toPartnerQrDto(model: PartnerQrCodeModel) {
  return {
    qrId: model.id,
    qrKind: model.qrKind,
    branchId: model.branchId,
    /** Sólo el prefijo del hash: identifica el archivo en una traza sin publicarlo entero. */
    fingerprint: model.sha256.slice(0, 12),
    contentType: model.contentType,
    sizeBytes: model.sizeBytes,
    bankInstitutionCode: model.bankInstitutionCode,
    accountNumberMasked: model.accountNumberMasked,
    status: model.status,
    verifiedAt: model.verifiedAt?.toISOString() ?? null,
    replacedById: model.replacedById,
    createdAt: model.createdAtValue.toISOString(),
  };
}

export function toPartnerPosTerminalDto(model: PartnerPosTerminalModel) {
  return {
    terminalId: model.id,
    branchId: model.branchId,
    terminalSerial: model.terminalSerial,
    terminalAlias: model.terminalAlias,
    provider: model.provider,
    model: model.model,
    status: model.status,
    activatedAt: model.activatedAt?.toISOString() ?? null,
    lastSeenAt: model.lastSeenAt?.toISOString() ?? null,
  };
}

/**
 * El representante legal. El número de documento sale ENMASCARADO: identifica a una persona, y el
 * expediente prueba quién firma, no necesita publicar su cédula entera en cada lectura.
 */
export function toPartnerRepresentativeDto(model: PartnerLegalRepresentativeModel) {
  const number = model.documentNumber;
  return {
    representativeId: model.id,
    fullName: model.fullName,
    documentType: model.documentType,
    documentNumberMasked: number.length <= 4 ? '****' : `****${number.slice(-4)}`,
    hasPowerOfAttorney: model.powerOfAttorneyKey !== null,
    verifiedAt: model.verifiedAt?.toISOString() ?? null,
  };
}
