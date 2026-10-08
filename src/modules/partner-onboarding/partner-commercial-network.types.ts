/**
 * @file Valores de creación de la red comercial del comercio (representantes, sucursales y QR).
 * @business Separa los contratos de escritura del repositorio para que éste siga siendo legible.
 * @system tipos puros, sin dependencias de Sequelize.
 */

/** Valores con los que el repositorio crea un representante legal. */
export type NewRepresentativeValues = {
  tenantId: string;
  partnerProfileId: string;
  fullName: string;
  documentType: string;
  documentNumber: string;
  powerOfAttorneyKey: string | null;
};

/** Valores con los que el repositorio crea una sucursal. */
export type NewBranchValues = {
  tenantId: string;
  partnerProfileId: string;
  branchCode: string;
  name: string;
  addressLine: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  erpBranchId: string | null;
};

/** Valores con los que el repositorio crea un QR de cobro. */
export type NewQrCodeValues = {
  tenantId: string;
  partnerProfileId: string;
  branchId: string | null;
  qrKind: string;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  bankInstitutionCode: string | null;
  accountNumberMasked: string | null;
};
