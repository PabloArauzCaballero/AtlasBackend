import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { UniqueConstraintError } from 'sequelize';
import { CreditApplicationService } from '../../../src/modules/credit/application/credit-application.service.js';

/**
 * Creación de la solicitud de crédito.
 *
 * Es donde toda la cadena anterior tiene que sostenerse. La propiedad central que fijan estos tests
 * es que **la elegibilidad se reevalúa en el servidor antes de escribir nada**: ocultar el botón en
 * la app es experiencia de usuario, no una garantía. Un cliente puede quedar inelegible entre que se
 * pintó la pantalla y que llegó el request, y nada impide llamar al endpoint directamente.
 */
describe('CreditApplicationService', () => {
  const PRODUCT = {
    id: 'p1',
    productCode: 'consumo_30',
    status: 'active',
    effectiveFrom: null,
    effectiveUntil: null,
    currencyCode: 'BOB',
    minAmount: '1000.00',
    maxAmount: '20000.00',
    minTermMonths: 3,
    maxTermMonths: 24,
    requiresManualReview: false,
    minMonthlyIncome: null,
  };

  function build(
    options: {
      eligible?: boolean;
      blockers?: Array<{ code: string }>;
      product?: Record<string, unknown>;
      underwritingStatus?: string;
      partnerProfileId?: string;
      partnerOnboardingStatus?: string;
    } = {},
  ) {
    const eligible = options.eligible ?? true;
    const creditRepository = {
      findProductById: jest.fn(async (..._args: unknown[]) => ({ ...PRODUCT, ...(options.product ?? {}) })),
      findOpenApplication: jest.fn(async (..._args: unknown[]) => null),
      createApplication: jest.fn(async (..._args: unknown[]) => ({
        id: 'app-1',
        applicationCode: 'CRA-1',
        status: 'submitted',
        requestedAmount: '5000.00',
        requestedTermMonths: 12,
        currencyCode: 'BOB',
        submittedAt: new Date('2026-07-28T12:00:00.000Z'),
      })),
      createApplicationEvent: jest.fn(),
      findApplicationsByCustomer: jest.fn(async (..._args: unknown[]) => []),
    };
    const eligibilityService = {
      evaluateAndRecord: jest.fn(async (..._args: unknown[]) => ({
        eligible,
        blockers: options.blockers ?? [],
        ruleVersion: 'eligibility-v1',
        evaluatedAt: '2026-07-28T12:00:00.000Z',
        lifecycleStatus: eligible ? 'active' : 'under_review',
      })),
      getLatestEvaluation: jest.fn(async (..._args: unknown[]) => ({ id: 'ev-9' })),
    };
    // Los atributos económicos alimentan la elegibilidad POR PRODUCTO (`min_monthly_income`).
    const eligibilityRepository = {
      loadFacts: jest.fn(async (..._args: unknown[]) => ({ financialAttributeValues: { monthly_income_declared: 8000 } })),
    };
    const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({})) };
    /*
     * El motor se consulta DESPUÉS de confirmar la transacción, así que aquí basta con el doble: lo
     * que fijan estas pruebas es la creación de la solicitud, no la decisión. El desenlace por
     * defecto deja el expediente en `under_review`, que es justo lo que produce el servicio real
     * cuando el motor no responde.
     */
    const underwriting = {
      underwrite: jest.fn(async (..._args: unknown[]) => ({
        status: options.underwritingStatus ?? 'under_review',
        decisionMode: 'engine_unavailable_manual',
        executionId: null,
        reasonCodes: [],
      })),
    };
    /*
     * El expediente del comercio. Por defecto devuelve uno APROBADO: lo que estas pruebas fijan es
     * la creación de la solicitud, y un comercio que no pasa el filtro es el asunto de su propia
     * prueba. `requireProfile` sólo se llama si la solicitud declara comercio.
     */
    const partnerProfiles = {
      requireProfile: jest.fn(async (..._args: unknown[]) => ({
        id: options.partnerProfileId ?? '77',
        onboardingStatus: options.partnerOnboardingStatus ?? 'approved',
      })),
    };
    const service = new CreditApplicationService(
      creditRepository as never,
      eligibilityService as never,
      eligibilityRepository as never,
      underwriting as never,
      partnerProfiles as never,
      sequelize as never,
    );
    return { service, creditRepository, eligibilityService, eligibilityRepository, underwriting, partnerProfiles };
  }

  const customerUser = { role: 'customer', customerId: 'c1', internalUserId: null } as never;
  const baseInput = {
    tenantId: 't1',
    customerId: 'c1',
    body: { productId: 'p1', requestedAmount: 5000, requestedTermMonths: 12 } as never,
    currentUser: customerUser,
    idempotencyKey: 'idem-1',
  };

  it('lanza NotFoundException cuando el producto no existe', async () => {
    const { service, creditRepository } = build();
    (creditRepository.findProductById as jest.Mock).mockResolvedValueOnce(null as never);
    await expect(service.createApplication(baseInput)).rejects.toThrow(NotFoundException);
  });

  it('rechaza un producto que no está activo o cuya vigencia no corresponde', async () => {
    const draft = build({ product: { status: 'draft' } });
    await expect(draft.service.createApplication(baseInput)).rejects.toThrow(/CREDIT_PRODUCT_NOT_AVAILABLE/);

    const expired = build({ product: { effectiveUntil: new Date('2020-01-01T00:00:00.000Z') } });
    await expect(expired.service.createApplication(baseInput)).rejects.toThrow(/CREDIT_PRODUCT_NOT_AVAILABLE/);
  });

  it('rechaza montos y plazos fuera del rango del producto, indicando el rango válido', async () => {
    const { service } = build();
    await expect(
      service.createApplication({ ...baseInput, body: { productId: 'p1', requestedAmount: 500, requestedTermMonths: 12 } as never }),
    ).rejects.toThrow(/REQUESTED_AMOUNT_OUT_OF_RANGE: 1000.00-20000.00/);
    await expect(
      service.createApplication({ ...baseInput, body: { productId: 'p1', requestedAmount: 5000, requestedTermMonths: 60 } as never }),
    ).rejects.toThrow(/REQUESTED_TERM_OUT_OF_RANGE: 3-24/);
  });

  it('impide una segunda solicitud viva del mismo cliente', async () => {
    const { service, creditRepository } = build();
    (creditRepository.findOpenApplication as jest.Mock).mockResolvedValueOnce({ id: 'app-0' } as never);
    await expect(service.createApplication(baseInput)).rejects.toThrow(/CREDIT_APPLICATION_ALREADY_OPEN/);
    expect(creditRepository.createApplication).not.toHaveBeenCalled();
  });

  /** El índice único parcial es la garantía real: el chequeo previo puede perder la carrera. */
  it('traduce la violación del índice único al mismo error de negocio', async () => {
    const { service, creditRepository } = build();
    (creditRepository.createApplication as jest.Mock).mockRejectedValueOnce(new UniqueConstraintError({ errors: [] }) as never);
    await expect(service.createApplication(baseInput)).rejects.toThrow(ConflictException);
  });

  /** La propiedad más importante de todo el módulo. */
  it('REEVALÚA la elegibilidad en el servidor y no persiste nada si el cliente no es elegible', async () => {
    const { service, creditRepository, eligibilityService } = build({
      eligible: false,
      blockers: [{ code: 'IDENTITY_NOT_VERIFIED' }, { code: 'FRAUD_CASE_OPEN' }],
    });

    await expect(service.createApplication(baseInput)).rejects.toThrow(/CUSTOMER_NOT_ELIGIBLE: IDENTITY_NOT_VERIFIED, FRAUD_CASE_OPEN/);
    expect(eligibilityService.evaluateAndRecord).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'c1', reasonCode: 'credit_application_requested' }),
    );
    expect(creditRepository.createApplication).not.toHaveBeenCalled();
    expect(creditRepository.createApplicationEvent).not.toHaveBeenCalled();
  });

  it('crea la solicitud guardando la evaluación que la autorizó', async () => {
    const { service, creditRepository } = build();

    const result = await service.createApplication(baseInput);

    const persisted = (creditRepository.createApplication as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    // Sin este par, demostrar meses después con qué información se aceptó exige reconstruir a mano
    // el estado del cliente en esa fecha.
    expect(persisted.eligibilityEvaluationId).toBe('ev-9');
    expect(persisted.eligibilitySnapshotJson).toMatchObject({ ruleVersion: 'eligibility-v1', eligible: true });
    expect(persisted.status).toBe('submitted');
    // La clave de idempotencia se guarda hasheada, nunca en claro.
    expect(String(persisted.idempotencyKeyHash)).toHaveLength(64);
    expect(result).toMatchObject({ applicationId: 'app-1', productCode: 'consumo_30' });
    expect(creditRepository.createApplicationEvent).toHaveBeenCalledTimes(1);
  });

  it('un producto que exige revisión manual nace en under_review, no en submitted', async () => {
    const { service, creditRepository } = build({ product: { requiresManualReview: true } });
    await service.createApplication(baseInput);
    const persisted = (creditRepository.createApplication as jest.Mock).mock.calls[0][0] as { status: string };
    expect(persisted.status).toBe('under_review');
  });
});
