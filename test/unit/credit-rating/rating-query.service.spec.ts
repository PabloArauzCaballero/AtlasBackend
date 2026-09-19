import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { RatingQueryService } from '../../../src/modules/credit-rating/application/rating-query.service.js';
import type { CreditRatingRepository } from '../../../src/modules/credit-rating/credit-rating.repository.js';
import type { RatingPolicyService, ResolvedRatingPolicy } from '../../../src/modules/credit-rating/application/rating-policy.service.js';
import type { RatingBand } from '../../../src/modules/credit-rating/domain/rating-scale.js';
import type { CustomerRiskRatingModel, LoanRiskRatingModel } from '../../../src/database/models/index.js';

/**
 * Las lecturas de la calificación de riesgo.
 *
 * Tres decisiones se fijan aquí y ninguna falla de forma visible si se rompe. La primera: un crédito
 * SIN calificar da 404 y no una categoría por defecto —«todavía no se calificó» y «se calificó y
 * salió A» son estados distintos, y devolver A para el primero hace que un crédito que el barrido
 * nunca alcanzó se lea como sano en el reporte de cierre—. La segunda: lo que ve el cliente es un
 * subconjunto deliberado, sin exposición ni previsión, porque esas dos son la medida del riesgo que
 * la casa asume por él y publicarlas le enseña cuánto provisiona por cada categoría. La tercera: los
 * totales de la cartera se suman en céntimos enteros; sumar los textos con coma flotante mete el
 * error justo en el único número que contabilidad cuadra contra el libro mayor.
 */
const BANDAS: RatingBand[] = [
  { grade: 'A', gradeLabel: 'Normal', severityRank: 0, minDaysPastDue: 0, maxDaysPastDue: 5, provisionRate: 0.01 },
  { grade: 'B', gradeLabel: 'Especial', severityRank: 1, minDaysPastDue: 6, maxDaysPastDue: 30, provisionRate: 0.05 },
  { grade: 'C', gradeLabel: 'Deficiente', severityRank: 2, minDaysPastDue: 31, maxDaysPastDue: null, provisionRate: 0.2 },
];

function politica(bands: RatingBand[] = BANDAS): ResolvedRatingPolicy {
  return {
    policy: {
      id: 3,
      policyCode: 'ASFI',
      versionCode: 'v2',
      scaleCode: 'ASFI_6',
      contaminationEnabled: true,
    } as never,
    bands,
    bestBand: bands[0],
  };
}

function calificacionCliente(overrides: Record<string, unknown> = {}): CustomerRiskRatingModel {
  return {
    id: 1,
    customerId: 42,
    policyVersionId: 3,
    grade: 'B',
    gradeLabel: 'Especial',
    severityRank: 1,
    worstDaysPastDue: 12,
    ratedLoanCount: 2,
    totalExposureAmount: '1000.00',
    totalProvisionAmount: '50.00',
    drivingLoanId: 7,
    previousGrade: 'A',
    ratingReason: 'MORA_12',
    isCurrent: true,
    ratedAt: new Date('2026-09-01T10:00:00Z'),
    ...overrides,
  } as unknown as CustomerRiskRatingModel;
}

function calificacionCredito(overrides: Record<string, unknown> = {}): LoanRiskRatingModel {
  return {
    id: 5,
    loanId: 7,
    customerId: 42,
    policyVersionId: 3,
    grade: 'B',
    gradeLabel: 'Especial',
    severityRank: 1,
    daysPastDue: 12,
    delinquencyBucket: '6-30',
    exposureAmount: '1000.00',
    provisionRate: '0.05',
    provisionAmount: '50.00',
    previousGrade: 'A',
    ratingReason: 'MORA_12',
    isCurrent: true,
    ratedAt: new Date('2026-09-01T10:00:00Z'),
    ...overrides,
  } as unknown as LoanRiskRatingModel;
}

describe('RatingQueryService', () => {
  let repository: {
    findCurrentLoanRating: jest.Mock;
    findLoanRatingHistory: jest.Mock;
    findCurrentCustomerRating: jest.Mock;
    findCustomerRatingHistory: jest.Mock;
    summarizePortfolio: jest.Mock;
  };
  let policies: { resolveActivePolicy: jest.Mock };
  let service: RatingQueryService;

  beforeEach(() => {
    repository = {
      findCurrentLoanRating: jest.fn(async () => null),
      findLoanRatingHistory: jest.fn(async () => []),
      findCurrentCustomerRating: jest.fn(async () => null),
      findCustomerRatingHistory: jest.fn(async () => []),
      summarizePortfolio: jest.fn(async () => []),
    };
    policies = { resolveActivePolicy: jest.fn(async () => politica()) };
    service = new RatingQueryService(repository as unknown as CreditRatingRepository, policies as unknown as RatingPolicyService);
  });

  describe('la escala', () => {
    it('se sirve desde la política ACTIVA y no desde una copia: es versionada y regulatoria', async () => {
      const catalogo = await service.getRatingScale('t1');

      expect(policies.resolveActivePolicy).toHaveBeenCalledWith('t1');
      expect(catalogo.policyCode).toBe('ASFI');
      expect(catalogo.versionCode).toBe('v2');
      expect(catalogo.grades.map((g) => g.grade)).toEqual(['A', 'B', 'C']);
    });

    it('cada categoría llega explicada: tramo de mora, previsión y tono derivado de su posición', async () => {
      const catalogo = await service.getRatingScale('t1');

      expect(catalogo.grades[0]).toMatchObject({ grade: 'A', minDaysPastDue: 0, maxDaysPastDue: 5, provisionRate: 0.01, tone: 'success' });
      expect(catalogo.grades[2]).toMatchObject({ grade: 'C', maxDaysPastDue: null, tone: 'critical' });
      expect(catalogo.grades[0].help.length).toBeGreaterThan(0);
    });
  });

  describe('la calificación de un crédito', () => {
    it('sin calificar es 404 y no una categoría por defecto', async () => {
      await expect(service.getLoanRating('t1', '7')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('calificado devuelve la ficha completa con la fecha en ISO', async () => {
      repository.findCurrentLoanRating.mockResolvedValueOnce(calificacionCredito() as never);

      const ficha = await service.getLoanRating('t1', '7');

      expect(ficha).toMatchObject({ loanId: '7', grade: 'B', provisionAmount: '50.00', isCurrent: true });
      expect(ficha.ratedAt).toBe('2026-09-01T10:00:00.000Z');
    });

    it('el historial respeta el tope pedido y sale envuelto con el crédito al que pertenece', async () => {
      repository.findLoanRatingHistory.mockResolvedValueOnce([calificacionCredito(), calificacionCredito({ id: 6, grade: 'A' })] as never);

      const historial = await service.getLoanRatingHistory('t1', '7', 25);

      expect(repository.findLoanRatingHistory).toHaveBeenCalledWith('t1', '7', 25);
      expect(historial.loanId).toBe('7');
      expect(historial.items.map((item) => item.grade)).toEqual(['B', 'A']);
    });
  });

  describe('la calificación de un cliente', () => {
    it('sin calificar es 404', async () => {
      await expect(service.getCustomerRating('t1', '42')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.getCustomerFacingRating('t1', '42')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('la vista interna lleva exposición y previsión totales', async () => {
      repository.findCurrentCustomerRating.mockResolvedValueOnce(calificacionCliente() as never);

      const ficha = await service.getCustomerRating('t1', '42');

      expect(ficha.totalExposureAmount).toBe('1000.00');
      expect(ficha.totalProvisionAmount).toBe('50.00');
      expect(ficha.drivingLoanId).toBe('7');
    });

    it('la del cliente NO lleva exposición ni previsión: es lo que la casa arriesga por él, no un dato suyo', async () => {
      repository.findCurrentCustomerRating.mockResolvedValueOnce(calificacionCliente() as never);

      const ficha = await service.getCustomerFacingRating('t1', '42');

      for (const prohibido of ['totalExposureAmount', 'totalProvisionAmount', 'drivingLoanId', 'policyVersionId', 'severityRank']) {
        expect(ficha).not.toHaveProperty(prohibido);
      }
    });

    it('añade la posición en la escala: «2 de 3» convierte una letra en un lugar', async () => {
      repository.findCurrentCustomerRating.mockResolvedValueOnce(calificacionCliente({ grade: 'B' }) as never);

      const ficha = await service.getCustomerFacingRating('t1', '42');

      expect(ficha.position).toBe(2);
      expect(ficha.scaleSize).toBe(3);
    });

    it('la posición se cuenta desde la MEJOR aunque la política venga desordenada', async () => {
      policies.resolveActivePolicy.mockResolvedValueOnce(politica([BANDAS[2], BANDAS[0], BANDAS[1]]) as never);
      repository.findCurrentCustomerRating.mockResolvedValueOnce(calificacionCliente({ grade: 'A' }) as never);

      const ficha = await service.getCustomerFacingRating('t1', '42');

      expect(ficha.position).toBe(1);
    });

    it('una letra que ya no está en la escala vigente declara posición nula en vez de inventar un lugar', async () => {
      repository.findCurrentCustomerRating.mockResolvedValueOnce(calificacionCliente({ grade: 'Z' }) as never);

      const ficha = await service.getCustomerFacingRating('t1', '42');

      expect(ficha.position).toBeNull();
      expect(ficha.scaleSize).toBe(3);
    });

    it('con la escala vacía no se afirma ni posición ni tamaño', async () => {
      policies.resolveActivePolicy.mockResolvedValueOnce({ ...politica(), bands: [] } as never);
      repository.findCurrentCustomerRating.mockResolvedValueOnce(calificacionCliente() as never);

      const ficha = await service.getCustomerFacingRating('t1', '42');

      expect(ficha.position).toBeNull();
      expect(ficha.scaleSize).toBeNull();
    });

    it('el historial del cliente sale envuelto con el cliente al que pertenece', async () => {
      repository.findCustomerRatingHistory.mockResolvedValueOnce([calificacionCliente()] as never);

      const historial = await service.getCustomerRatingHistory('t1', '42', 10);

      expect(repository.findCustomerRatingHistory).toHaveBeenCalledWith('t1', '42', 10);
      expect(historial.customerId).toBe('42');
      expect(historial.items).toHaveLength(1);
    });
  });

  describe('la distribución de la cartera', () => {
    it('viaja con la política que la produjo: sin ella no se puede comparar contra la del mes pasado', async () => {
      const resumen = await service.getPortfolioSummary('t1');

      expect(resumen.policy).toEqual({
        id: '3',
        policyCode: 'ASFI',
        versionCode: 'v2',
        scaleCode: 'ASFI_6',
        contaminationEnabled: true,
      });
    });

    it('suma en céntimos enteros: el error de coma flotante no entra en lo que cuadra contabilidad', async () => {
      repository.summarizePortfolio.mockResolvedValueOnce([
        { grade: 'A', gradeLabel: 'Normal', severityRank: 0, loanCount: 2, exposureAmount: '0.10', provisionAmount: '0.10' },
        { grade: 'B', gradeLabel: 'Especial', severityRank: 1, loanCount: 3, exposureAmount: '0.20', provisionAmount: '0.20' },
      ] as never);

      const resumen = await service.getPortfolioSummary('t1');

      expect(resumen.totals.exposureAmount).toBe('0.30');
      expect(resumen.totals.provisionAmount).toBe('0.30');
      expect(resumen.totals.loanCount).toBe(5);
    });

    it('una categoría sin importes cuenta como cero y no rompe el total', async () => {
      repository.summarizePortfolio.mockResolvedValueOnce([
        { grade: 'A', gradeLabel: 'Normal', severityRank: 0, loanCount: 1, exposureAmount: null, provisionAmount: null },
        { grade: 'B', gradeLabel: 'Especial', severityRank: 1, loanCount: 1, exposureAmount: '15.75', provisionAmount: '1.25' },
      ] as never);

      const resumen = await service.getPortfolioSummary('t1');

      expect(resumen.grades[0].exposureAmount).toBe('0.00');
      expect(resumen.totals.exposureAmount).toBe('15.75');
      expect(resumen.totals.provisionAmount).toBe('1.25');
    });

    it('una cartera vacía da totales en cero y no en cadena vacía', async () => {
      const resumen = await service.getPortfolioSummary('t1');

      expect(resumen.grades).toEqual([]);
      expect(resumen.totals).toEqual({ loanCount: 0, exposureAmount: '0.00', provisionAmount: '0.00' });
    });
  });
});
