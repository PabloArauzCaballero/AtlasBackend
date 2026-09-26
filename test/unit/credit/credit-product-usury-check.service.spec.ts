import { describe, expect, it, jest } from '@jest/globals';
import { CreditProductUsuryCheckService } from '../../../src/modules/credit/application/credit-product-usury-check.service.js';

/**
 * @file Chequeo de arranque: un producto ACTIVO por encima del tope de usura es un incidente real
 * (Frente 3A, plan `_plan-motor-decisiones-tasa-2026-09-25`, punto 5, último guión — el plan cita
 * `DEMO-MICRO` publicado al 32 %, sobre el 24 % legal). Sólo AVISA: nunca tumba el arranque, porque
 * el desembolso YA clampea de verdad (`loan-disbursement.service.ts`) — este chequeo es para que
 * nadie tenga que desembolsar un crédito para descubrir que el catálogo está mal.
 */
function build(products: Array<Record<string, unknown>>) {
  const logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
  const productModel = { findAll: jest.fn(async (..._args: unknown[]) => products) };
  const service = new CreditProductUsuryCheckService(productModel as never);
  // El logger es privado y de Nest; se sustituye para poder aserir sin acoplarse al formato exacto.
  (service as unknown as { logger: typeof logger }).logger = logger;
  return { service, productModel, logger };
}

describe('CreditProductUsuryCheckService', () => {
  it('PRUEBA EN NEGATIVO — un producto activo por encima del tope de usura (DEMO-MICRO al 32 %) avisa', async () => {
    const { service, logger } = build([{ productCode: 'DEMO-MICRO', tenantId: '1', annualInterestRate: '32.0000' }]);

    await service.onModuleInit();

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toContain('DEMO-MICRO');
    expect(logger.warn.mock.calls[0]?.[0]).toContain('32');
  });

  it('un producto DENTRO del tope no avisa', async () => {
    const { service, logger } = build([{ productCode: 'CONSUMO-30', tenantId: '1', annualInterestRate: '18.0000' }]);

    await service.onModuleInit();

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('un producto justo en el tope (24 %) NO avisa: el corte es "por encima", no "en o por encima"', async () => {
    const { service, logger } = build([{ productCode: 'JUSTO-EN-EL-TOPE', tenantId: '1', annualInterestRate: '24.0000' }]);

    await service.onModuleInit();

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('un producto sin tasa declarada no avisa: no hay nada que comparar contra la usura', async () => {
    const { service, logger } = build([{ productCode: 'SIN-TASA', tenantId: '1', annualInterestRate: null }]);

    await service.onModuleInit();

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('recorre TODOS los tenants: el arranque no tiene uno propio con el que filtrar el catálogo', async () => {
    const { service, productModel } = build([]);

    await service.onModuleInit();

    const [args] = productModel.findAll.mock.calls.at(-1) as [{ where: Record<string, unknown> }];
    expect(args.where).not.toHaveProperty('tenantId');
    expect(args.where).toMatchObject({ deleted: false, status: 'active' });
  });

  it('PRUEBA EN NEGATIVO — si la consulta al catálogo falla, el arranque NO se tumba: sólo avisa que no pudo auditar', async () => {
    const logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
    const productModel = { findAll: jest.fn(async () => Promise.reject(new Error('conexión caída'))) };
    const service = new CreditProductUsuryCheckService(productModel as never);
    (service as unknown as { logger: typeof logger }).logger = logger;

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toContain('conexión caída');
  });

  it('avisa una vez POR PRODUCTO cuando hay varios violando el tope', async () => {
    const { service, logger } = build([
      { productCode: 'DEMO-MICRO', tenantId: '1', annualInterestRate: '32.0000' },
      { productCode: 'OTRO-CARO', tenantId: '2', annualInterestRate: '40.0000' },
      { productCode: 'BUENO', tenantId: '1', annualInterestRate: '15.0000' },
    ]);

    await service.onModuleInit();

    expect(logger.warn).toHaveBeenCalledTimes(2);
  });
});
