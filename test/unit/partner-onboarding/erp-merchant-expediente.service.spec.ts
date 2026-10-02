import { describe, expect, it, jest } from '@jest/globals';
import { ErpMerchantExpedienteService } from '../../../src/modules/partner-onboarding/application/erp-merchant-expediente.service.js';

const CUENTA = '8b8f0f5e-3f55-4a47-9c3a-1b6f0b0e2a11';

type Perfil = {
  id: string;
  erpAccountId: string | null;
  tradeName: string | null;
  taxId: string;
  onboardingStatus?: string;
  commercialRegistry?: string | null;
  businessCategory?: string | null;
};

function build(
  opts: {
    porCuenta?: Perfil | null;
    porNit?: Perfil | null;
    representantes?: Array<{ documentNumber: string }>;
    sucursales?: Array<{ branchCode: string }>;
    qrVigente?: { id: string } | null;
    huecos?: string[];
  } = {},
) {
  const profiles = {
    findProfilesByExternalKeys: jest.fn(async (..._args: unknown[]) => ({ rows: opts.porCuenta ? [opts.porCuenta] : [], count: 0 })),
    findProfileByTaxId: jest.fn(async (..._args: unknown[]) => opts.porNit ?? null),
    updateProfile: jest.fn(async (perfil: unknown, values: unknown) => ({ ...(perfil as Perfil), ...(values as object) })),
    adoptOwnerForAccount: jest.fn(async (..._args: unknown[]) => 0),
  };
  const profileService = {
    start: jest.fn(async (...args: unknown[]) => {
      const dto = args[1] as { tradeName?: string; taxId: string };
      return { id: 'nuevo', erpAccountId: null, tradeName: dto.tradeName ?? null, taxId: dto.taxId, onboardingStatus: 'draft' };
    }),
    submit: jest.fn(async (_t: unknown, id: unknown) => ({ profile: { id, onboardingStatus: 'under_review' }, gaps: [] })),
  };
  const hooks = { alCrearComercio: jest.fn(async (..._args: unknown[]) => undefined) };
  const expedientes = { findExpedientePorSujeto: jest.fn(async (..._args: unknown[]) => ({ id: 'exp-1' })) };
  const network = {
    listRepresentatives: jest.fn(async (..._args: unknown[]) => opts.representantes ?? []),
    listBranches: jest.fn(async (..._args: unknown[]) => opts.sucursales ?? []),
    findLiveQr: jest.fn(async (..._args: unknown[]) => opts.qrVigente ?? null),
  };
  const representatives = { addLegalRepresentative: jest.fn(async (..._args: unknown[]) => ({ id: 'r1' })) };
  const commerce = { registerBranch: jest.fn(async (..._args: unknown[]) => ({ id: 'b1' })) };
  const qr = { register: jest.fn(async (..._args: unknown[]) => ({ id: 'q1', status: 'active' })) };
  const verification = {
    findSubmissionGaps: jest.fn(async (..._args: unknown[]) => (opts.huecos ?? []).map((requirement) => ({ requirement, detail: '' }))),
  };
  const service = new ErpMerchantExpedienteService(
    profiles as never,
    profileService as never,
    hooks as never,
    expedientes as never,
    network as never,
    representatives as never,
    commerce as never,
    qr as never,
    verification as never,
  );
  return { service, profiles, profileService, hooks, expedientes, network, representatives, commerce, qr, verification };
}

/**
 * La carpeta del comercio tiene que existir desde que el ERP crea el onboarding (Pablo,
 * 2026-09-26): si la ficha no existe se abre, si existe se enlaza, y en los dos casos se asegura el
 * expediente.
 */
describe('ErpMerchantExpedienteService', () => {
  const entrada = {
    erpAccountId: CUENTA,
    legalName: 'Dismac S.A.',
    tradeName: 'Dismac',
    taxId: '1023456029',
    contactEmail: 'ventas@dismac.bo',
  };

  it('recoge como dueño a quien ya tenía acceso por esa cuenta (el orden de los dos sucesos no está garantizado)', async () => {
    const { service, profiles } = build({ porCuenta: { id: 'p1', erpAccountId: CUENTA, tradeName: 'Dismac', taxId: '1023456029' } });

    await service.asegurar('t1', entrada);

    expect(profiles.adoptOwnerForAccount).toHaveBeenCalledWith('t1', CUENTA);
  });

  it('una cuenta sin ficha en Atlas abre la ficha SIN dueño, la enlaza y asegura la carpeta', async () => {
    const { service, profileService, profiles, hooks } = build();

    await expect(service.asegurar('1', entrada)).resolves.toMatchObject({
      partnerId: 'nuevo',
      expedienteId: 'exp-1',
      created: true,
      reason: null,
      loaded: [],
      gaps: [],
    });

    expect(profileService.start).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({ taxId: '1023456029', contactEmail: 'ventas@dismac.bo' }),
      undefined,
    );
    expect(profiles.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ id: 'nuevo' }), { erpAccountId: CUENTA });
    expect(hooks.alCrearComercio).toHaveBeenCalledWith({ tenantId: '1', partnerId: 'nuevo', customerCode: 'Dismac' });
  });

  it('una ficha ya enlazada no se vuelve a abrir ni a enlazar; sólo se asegura su carpeta', async () => {
    const { service, profileService, profiles, hooks } = build({
      porCuenta: { id: 'p1', erpAccountId: CUENTA, tradeName: null, taxId: '1023456029' },
    });

    await expect(service.asegurar('1', entrada)).resolves.toMatchObject({ partnerId: 'p1', created: false, reason: null });

    expect(profileService.start).not.toHaveBeenCalled();
    expect(profiles.updateProfile).not.toHaveBeenCalled();
    expect(hooks.alCrearComercio).toHaveBeenCalledWith({ tenantId: '1', partnerId: 'p1', customerCode: 'NIT 1023456029' });
  });

  it('una ficha encontrada por NIT sin cuenta se enlaza a esta cuenta', async () => {
    const { service, profiles } = build({ porNit: { id: 'p2', erpAccountId: null, tradeName: 'Dismac', taxId: '1023456029' } });
    await service.asegurar('1', entrada);
    expect(profiles.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ id: 'p2' }), { erpAccountId: CUENTA });
  });

  it('una ficha enlazada a OTRA cuenta no se pisa ni recibe carpeta', async () => {
    const { service, profiles, hooks } = build({ porNit: { id: 'p3', erpAccountId: 'otra', tradeName: null, taxId: '1023456029' } });
    await expect(service.asegurar('1', entrada)).resolves.toMatchObject({ partnerId: 'p3', reason: 'CUENTA_ENLAZADA_A_OTRA_FICHA' });
    expect(profiles.updateProfile).not.toHaveBeenCalled();
    expect(hooks.alCrearComercio).not.toHaveBeenCalled();
  });

  it('sin correo de contacto o con un NIT inválido no inventa la ficha: lo dice', async () => {
    const sinCorreo = build();
    await expect(sinCorreo.service.asegurar('1', { ...entrada, contactEmail: null })).resolves.toMatchObject({
      partnerId: null,
      reason: 'SIN_CORREO_DE_CONTACTO',
    });
    expect(sinCorreo.profileService.start).not.toHaveBeenCalled();

    const nitMalo = build();
    await expect(nitMalo.service.asegurar('1', { ...entrada, taxId: 'NIT-12' })).resolves.toMatchObject({
      reason: 'DATOS_DE_LA_CUENTA_INVALIDOS',
    });
    expect(nitMalo.profileService.start).not.toHaveBeenCalled();
  });

  /*
   * Lo que el vendedor captura en el alta del ERP llega al expediente en la misma llamada (Pablo,
   * 2026-10-02): matrícula, representante con poder, sucursal y QR bancario. Sin huecos y con
   * `submitWhenComplete`, se envía a revisión ahí mismo.
   */
  describe('carga lo que el ERP capturó en el alta', () => {
    const completo = {
      ...entrada,
      commercialRegistry: '00008022',
      businessCategory: 'RETAIL',
      legalRepresentative: {
        fullName: 'Pablo Arauz Caballero',
        documentType: 'ci' as const,
        documentNumber: '1234567',
        powerOfAttorneyKey: '1/partner-p1/power-of-attorney/x.pdf',
      },
      branch: { branchCode: 'CASA-MATRIZ', name: 'Casa matriz', addressLine: 'Av. Banzer km 2 1/2', city: 'Santa Cruz' },
      bankQr: {
        qrKind: 'bank' as const,
        storageKey: '1/partner-p1/qr-bank/x.png',
        bankInstitutionCode: 'BNB',
        accountNumberMasked: '****0739',
      },
      submitWhenComplete: true,
    };
    const perfil: Perfil = {
      id: 'p1',
      erpAccountId: CUENTA,
      tradeName: 'Multicenter',
      taxId: '1028341029',
      onboardingStatus: 'draft',
      commercialRegistry: null,
    };

    it('carga las cuatro partes, deja el expediente sin huecos y lo envía a revisión', async () => {
      const { service, profiles, representatives, commerce, qr, profileService } = build({ porCuenta: perfil });

      const resultado = await service.asegurar('1', completo);

      expect(profiles.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }), {
        commercialRegistry: '00008022',
        businessCategory: 'RETAIL',
      });
      expect(representatives.addLegalRepresentative).toHaveBeenCalledWith('1', 'p1', completo.legalRepresentative);
      expect(commerce.registerBranch).toHaveBeenCalledWith('1', 'p1', completo.branch);
      expect(qr.register).toHaveBeenCalledWith(
        '1',
        'p1',
        expect.objectContaining({ qrKind: 'bank', storageKey: completo.bankQr.storageKey }),
      );
      expect(profileService.submit).toHaveBeenCalledWith('1', 'p1');
      expect(resultado).toMatchObject({
        loaded: ['commercial_registry', 'business_category', 'legal_representative', 'branch', 'bank_qr', 'submitted'],
        gaps: [],
        onboardingStatus: 'under_review',
      });
    });

    it('no repite lo que ya estaba: ni matrícula, ni el mismo representante, ni la misma sucursal, ni otro QR con uno vigente', async () => {
      const { service, profiles, representatives, commerce, qr } = build({
        porCuenta: { ...perfil, commercialRegistry: '00008022', businessCategory: 'RETAIL' },
        representantes: [{ documentNumber: '1234567' }],
        sucursales: [{ branchCode: 'CASA-MATRIZ' }],
        qrVigente: { id: 'q0' },
      });

      const resultado = await service.asegurar('1', completo);

      expect(profiles.updateProfile).not.toHaveBeenCalled();
      expect(representatives.addLegalRepresentative).not.toHaveBeenCalled();
      expect(commerce.registerBranch).not.toHaveBeenCalled();
      expect(qr.register).not.toHaveBeenCalled();
      expect(resultado.loaded).toEqual(['submitted']);
    });

    it('con huecos no envía a revisión y los devuelve para que el ERP se los muestre al operador', async () => {
      const { service, profileService } = build({ porCuenta: perfil, huecos: ['power_of_attorney'] });

      const resultado = await service.asegurar('1', {
        ...completo,
        legalRepresentative: { ...completo.legalRepresentative, powerOfAttorneyKey: undefined },
      });

      expect(profileService.submit).not.toHaveBeenCalled();
      expect(resultado.gaps).toEqual(['power_of_attorney']);
      expect(resultado.onboardingStatus).toBe('draft');
    });

    it('un expediente ya aprobado no se toca en matrícula ni representante (son lo que se verificó), y no se reenvía', async () => {
      const { service, profiles, representatives, profileService } = build({ porCuenta: { ...perfil, onboardingStatus: 'approved' } });

      await service.asegurar('1', completo);

      expect(profiles.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }), { businessCategory: 'RETAIL' });
      expect(representatives.addLegalRepresentative).not.toHaveBeenCalled();
      expect(profileService.submit).not.toHaveBeenCalled();
    });

    it('sin `submitWhenComplete` carga pero deja el envío al comercio', async () => {
      const { service, profileService } = build({ porCuenta: perfil });
      const resultado = await service.asegurar('1', { ...completo, submitWhenComplete: false });
      expect(profileService.submit).not.toHaveBeenCalled();
      expect(resultado.onboardingStatus).toBe('draft');
    });

    it('un rubro del ERP fuera del catálogo del expediente no entra: el ERP usa texto libre', async () => {
      const { service, profiles } = build({ porCuenta: perfil });
      await service.asegurar('1', { ...completo, businessCategory: 'Venta de repuestos', submitWhenComplete: false });
      expect(profiles.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }), { commercialRegistry: '00008022' });
    });
  });
});
