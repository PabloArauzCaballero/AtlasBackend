import { describe, expect, it, jest } from '@jest/globals';
import { FacilityRegistrationService } from '../../../src/modules/decision-engine/facility-registration.service.js';

/**
 * El ALTA del crédito en el motor.
 *
 * Es lo que permite atribuirle un desenlace: sin `credit_facility` el motor no tiene a qué colgar la
 * observación, su matriz de cosechas sale vacía y la cobertura cae a `BREACH` — y el tablero lo
 * enseña como un motor que no acierta, cuando lo que pasa es que nadie le contó qué se concedió.
 *
 * La propiedad que estas pruebas protegen es la de la COLA: sólo se marca lo que el motor confirmó.
 * Marcar de más saca un crédito de la cola para siempre y sus desenlaces se rechazarán luego con
 * `FACILITY_NOT_FOUND`, sin que nadie sepa por qué.
 */
describe('FacilityRegistrationService', () => {
  /** Un préstamo desembolsado, con la decisión que lo originó y sin marca de alta. */
  function loan(overrides: Record<string, unknown> = {}) {
    return {
      id: 'l1',
      loanCode: 'LOAN-0001',
      decisionExecutionId: '88001',
      principalAmount: '1500.00',
      currencyCode: 'BOB',
      termMonths: 12,
      annualInterestRate: '0.2800',
      disbursedAt: new Date('2026-02-01T00:00:00Z'),
      decisionFacilityRegisteredAt: null,
      save: jest.fn(async () => undefined),
      ...overrides,
    };
  }

  function build(options: { canReport?: boolean; loans?: Array<Record<string, unknown>> } = {}) {
    const loans = options.loans ?? [loan()];
    const client = {
      canReportOutcomes: options.canReport ?? true,
      registerFacilities: jest.fn(async (...args: unknown[]) =>
        (args[0] as Array<{ externalReference: string }>).map(
          (alta): { externalReference: string; accepted: boolean; reason: string | null } => ({
            externalReference: alta.externalReference,
            accepted: true,
            reason: null,
          }),
        ),
      ),
    };
    const loanModel = { findAll: jest.fn(async (..._args: unknown[]) => loans) };
    return {
      service: new FacilityRegistrationService(client as never, loanModel as never),
      client,
      loans,
    };
  }

  it('registra los créditos pendientes y los marca, con la tasa en tanto por uno', async () => {
    const { service, client } = build();
    const resultado = await service.registrarCreditosNuevos({ tenantId: '1', limit: 50 });

    expect(resultado).toEqual({ registrados: 1, rechazados: 0 });
    const [[altas]] = client.registerFacilities.mock.calls as unknown as [[Array<Record<string, unknown>>]];
    expect(altas[0]).toMatchObject({
      externalReference: 'LOAN-0001',
      originationExecutionId: '88001',
      principalAmount: 1500,
      annualRate: 0.28,
    });
  });

  /*
   * Un crédito que el motor RECHAZA no se marca: se queda en la cola. Marcarlo lo esconderría, y
   * lo que hace falta es que se VEA que hay créditos que el motor nunca podrá medir —un
   * `EXECUTION_WITHOUT_SUBJECT` no se arregla reintentando—.
   */
  it('no marca el crédito que el motor rechaza: sigue visible en la cola', async () => {
    const { service, client } = build();
    client.registerFacilities.mockImplementationOnce(async () => [
      { externalReference: 'LOAN-0001', accepted: false, reason: 'EXECUTION_WITHOUT_SUBJECT' },
    ]);

    const resultado = await service.registrarCreditosNuevos({ tenantId: '1', limit: 50 });

    expect(resultado).toEqual({ registrados: 0, rechazados: 1 });
  });

  /*
   * Si la llamada falla no se marca NADA: el motor pudo no recibir el lote, y marcar un crédito que
   * no está registrado lo saca de la cola para siempre — sus desenlaces se rechazarían después con
   * `FACILITY_NOT_FOUND` y nadie sabría por qué.
   */
  it('un fallo de red no marca ningún crédito', async () => {
    const { service, client } = build();
    client.registerFacilities.mockImplementationOnce(() => Promise.reject(new Error('ECONNREFUSED')));

    const resultado = await service.registrarCreditosNuevos({ tenantId: '1', limit: 50 });

    expect(resultado).toEqual({ registrados: 0, rechazados: 1 });
  });

  it('sin credencial del plano de gestión no intenta nada, y lo explica', async () => {
    const { service, client } = build({ canReport: false });
    const resultado = await service.registrarCreditosNuevos({ tenantId: '1', limit: 50 });

    expect(resultado.reason).toBe('DECISION_ENGINE_OUTCOME_KEY_NOT_CONFIGURED');
    expect(client.registerFacilities).not.toHaveBeenCalled();
  });

  it('con la cola vacía no llama al motor', async () => {
    const { service, client } = build({ loans: [] });
    const resultado = await service.registrarCreditosNuevos({ tenantId: '1', limit: 50 });

    expect(resultado).toEqual({ registrados: 0, rechazados: 0 });
    expect(client.registerFacilities).not.toHaveBeenCalled();
  });
});
