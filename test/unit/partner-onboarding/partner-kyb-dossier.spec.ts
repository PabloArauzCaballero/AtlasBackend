import { describe, expect, it } from '@jest/globals';
import { buildKybDossier } from '../../../src/modules/partner-onboarding/application/partner-kyb-dossier.js';

/**
 * El anexo que ve quien aprueba o rechaza un comercio en el Motor.
 *
 * Hasta el 2026-10-07 el caso llevaba sólo el número del expediente. Aquí se fija lo que tiene que
 * llegar para poder decidir —quién es, quién lo representa, dónde opera, qué le falta— y lo que
 * NO puede viajar: cuentas completas, claves del almacén ni contenido de documentos.
 */
describe('buildKybDossier', () => {
  const entrada = () => ({
    profile: {
      id: '10',
      legalName: 'Tienda Ejemplo SRL',
      tradeName: 'La Tienda',
      taxId: '1234567011',
      commercialRegistry: 'MAT-0099',
      businessCategory: 'retail',
      contactEmail: 'contacto@tienda.example',
      contactPhone: '+59170000000',
      emailVerifiedAt: new Date('2026-10-01T10:00:00Z'),
      phoneVerifiedAt: null,
      onboardingStatus: 'under_review',
      createdAtValue: new Date('2026-09-30T10:00:00Z'),
      submittedAt: new Date('2026-10-02T10:00:00Z'),
      erpAccountId: '55',
    } as never,
    representatives: [
      {
        fullName: 'Ana Pérez',
        documentType: 'CI',
        documentNumber: '7654321',
        powerOfAttorneyKey: 'tenants/1/partners/10/poder.pdf',
        verifiedAt: null,
      },
    ],
    branches: [{ branchCode: 'S1', name: 'Central', addressLine: 'Av. Siempre Viva 1', city: 'Santa Cruz', status: 'active' }],
    qrCodes: [
      {
        qrKind: 'bank',
        status: 'pending_review',
        bankInstitutionCode: 'BNB',
        accountNumberMasked: '****4321',
        verifiedAt: null,
        storageKey: 'tenants/1/partners/10/qr.png',
        sha256: 'abc',
      },
    ],
    gaps: [{ requirement: 'branch' as const, detail: 'Falta registrar al menos una sucursal.' }],
  });

  it('lleva quién es el comercio, quién lo representa, dónde opera y qué le falta', () => {
    const anexo = buildKybDossier(entrada());

    expect(anexo).toMatchObject({
      version: 1,
      comercio: {
        razonSocial: 'Tienda Ejemplo SRL',
        nombreComercial: 'La Tienda',
        nit: '1234567011',
        matriculaDeComercio: 'MAT-0099',
        correoVerificado: true,
        telefonoVerificado: false,
        enviadoEn: '2026-10-02T10:00:00.000Z',
      },
      representantes: [{ nombre: 'Ana Pérez', numeroDeDocumento: '7654321', poderAdjunto: true }],
      sucursales: [{ codigo: 'S1', ciudad: 'Santa Cruz' }],
      qr: [{ tipo: 'bank', estado: 'pending_review', banco: 'BNB', cuentaEnmascarada: '****4321' }],
      pendientes: [{ requisito: 'branch', detalle: 'Falta registrar al menos una sucursal.' }],
    });
  });

  it('no se lleva claves del almacén ni hashes: los archivos se abren desde el expediente', () => {
    const texto = JSON.stringify(buildKybDossier(entrada()));

    expect(texto).not.toContain('tenants/1/partners');
    expect(texto).not.toContain('storageKey');
    expect(texto).not.toContain('sha256');
  });

  it('un comercio sin nada declarado sale con listas vacías, no con un error', () => {
    const anexo = buildKybDossier({ ...entrada(), representatives: [], branches: [], qrCodes: [], gaps: [] });

    expect(anexo).toMatchObject({ representantes: [], sucursales: [], qr: [], pendientes: [] });
  });
});
