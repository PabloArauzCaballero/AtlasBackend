/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza califica la deuda y al cliente para medir pérdida esperada y exposición.
 * @system califica cada crédito con la matriz vigente y arrastra el resultado a la ficha del cliente.
 */
import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Transaction } from 'sequelize';
import { CustomerRiskRatingModel, LoanModel, LoanRiskRatingModel } from '../../../database/models/index.js';
import { fromCents, toCents } from '../../loans/domain/money.util.js';
import { CreditRatingRepository, RATEABLE_LOAN_STATUSES } from '../credit-rating.repository.js';
import { rateCustomer, type RatedDebt } from '../domain/customer-rating.js';
import { rateLoan } from '../domain/rating-scale.js';
import { RatingPolicyService, type ResolvedRatingPolicy } from './rating-policy.service.js';

type PortfolioOutcome = {
  loanRatings: LoanRiskRatingModel[];
  customerRating: CustomerRiskRatingModel;
};

@Injectable()
export class DebtRatingService {
  private readonly logger = new Logger(DebtRatingService.name);

  constructor(
    private readonly repository: CreditRatingRepository,
    private readonly policies: RatingPolicyService,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  /**
   * Califica un crédito — y con él toda la cartera de su titular.
   *
   * Calificar un solo crédito de forma aislada no es posible sin mentir en la ficha del cliente: su
   * categoría se deriva por arrastre de TODAS sus operaciones, así que tocar una obliga a releer el
   * resto de todas formas. Hacerlo en una sola transacción cierra la ventana en la que el crédito ya
   * está en categoría D y su titular sigue figurando en A — que es justo el instante en el que
   * alguien consulta si le presta otra vez.
   */
  async rateLoanById(input: { tenantId: string; loanId: string }) {
    return this.sequelize.transaction(async (transaction) => {
      const loan = await this.repository.findLoanForRating(input.tenantId, input.loanId, { transaction });
      if (!loan) throw new NotFoundException('LOAN_NOT_FOUND');
      if (!isRateable(loan)) throw new UnprocessableEntityException('LOAN_NOT_RATEABLE');

      const resolved = await this.policies.resolveActivePolicy(input.tenantId, { transaction });
      const outcome = await this.ratePortfolio(input.tenantId, loan.customerId, resolved, transaction);
      const loanRating = outcome.loanRatings.find((rating) => rating.loanId === loan.id) ?? null;
      return { loanRating, customerRating: outcome.customerRating };
    });
  }

  /** Recalifica todas las operaciones de un cliente y su ficha. Es la unidad real de análisis. */
  async rateCustomerById(input: { tenantId: string; customerId: string }): Promise<PortfolioOutcome> {
    return this.sequelize.transaction(async (transaction) => {
      const resolved = await this.policies.resolveActivePolicy(input.tenantId, { transaction });
      return this.ratePortfolio(input.tenantId, input.customerId, resolved, transaction);
    });
  }

  /**
   * Barrido de calificación de la cartera.
   *
   * Recorre por CLIENTE y no por préstamo porque el arrastre necesita ver todas sus operaciones a la
   * vez. Un cliente que falla no detiene el barrido: el resto de la cartera quedaría sin calificar y
   * el dato de un cierre no se recupera al día siguiente. Lo que sí se registra es cuántos fallaron,
   * porque un barrido «exitoso» que calificó la mitad es peor que uno que dice que falló.
   */
  async sweep(input: { tenantId: string; limit: number }) {
    const customerIds = await this.repository.findCustomerIdsWithExposure(input.tenantId, input.limit);
    let rated = 0;
    const failures: string[] = [];

    for (const customerId of customerIds) {
      try {
        await this.rateCustomerById({ tenantId: input.tenantId, customerId });
        rated += 1;
      } catch (error) {
        failures.push(customerId);
        this.logger.error(`No se pudo calificar al cliente ${customerId}: ${(error as Error).message}`);
      }
    }

    return { customers: customerIds.length, rated, failed: failures.length, failedCustomerIds: failures };
  }

  /**
   * El cálculo completo: cada operación con exposición y, a partir de ellas, la ficha del titular.
   *
   * Las calificaciones de deuda se conservan EN MEMORIA para agregar al cliente, en vez de releerlas
   * de la base. No es una optimización: releerlas obligaría a reconstruir la banda a partir de la
   * fila persistida, y esa banda reconstruida no es la de la política —pierde los umbrales— así que
   * cualquier regla futura que mire el rango de días estaría operando sobre datos inventados.
   */
  private async ratePortfolio(
    tenantId: string,
    customerId: string,
    resolved: ResolvedRatingPolicy,
    transaction: Transaction,
  ): Promise<PortfolioOutcome> {
    const loans = await this.repository.findRateableLoansByCustomer(tenantId, customerId, { transaction });
    const loanRatings: LoanRiskRatingModel[] = [];
    const debts: RatedDebt[] = [];

    for (const loan of loans) {
      const rating = rateLoan(resolved.bands, {
        daysPastDue: loan.daysPastDue,
        // La exposición es el CAPITAL vivo, no el saldo total del cronograma: previsionar interés
        // futuro todavía no devengado inflaría la pérdida esperada con dinero que aún no se ganó.
        exposureCents: toCents(loan.outstandingPrincipal),
        writtenOff: loan.status === 'written_off',
      });
      const previous = await this.repository.findCurrentLoanRating(tenantId, loan.id, { transaction });

      loanRatings.push(
        await this.repository.supersedeLoanRating(
          tenantId,
          loan.id,
          {
            tenantId,
            loanId: loan.id,
            customerId: loan.customerId,
            policyVersionId: resolved.policy.id,
            grade: rating.band.grade,
            gradeLabel: rating.band.gradeLabel,
            severityRank: rating.band.severityRank,
            daysPastDue: rating.daysPastDue,
            delinquencyBucket: loan.delinquencyBucket,
            exposureAmount: fromCents(rating.exposureCents),
            provisionRate: rating.band.provisionRate.toFixed(4),
            provisionAmount: fromCents(rating.provisionCents),
            previousGrade: previous?.grade ?? null,
            ratingReason: rating.reason,
            isCurrent: true,
            ratedAt: new Date(),
          },
          transaction,
        ),
      );
      debts.push({ loanId: loan.id, rating });
    }

    const customerRating = await this.persistCustomerRating(tenantId, customerId, debts, resolved, transaction);
    return { loanRatings, customerRating };
  }

  private async persistCustomerRating(
    tenantId: string,
    customerId: string,
    debts: readonly RatedDebt[],
    resolved: ResolvedRatingPolicy,
    transaction: Transaction,
  ): Promise<CustomerRiskRatingModel> {
    const previous = await this.repository.findCurrentCustomerRating(tenantId, customerId, { transaction });
    const rating = rateCustomer({
      debts,
      bestBand: resolved.bestBand,
      applyContamination: resolved.policy.contaminationEnabled,
    });

    return this.repository.supersedeCustomerRating(
      tenantId,
      customerId,
      {
        tenantId,
        customerId,
        policyVersionId: resolved.policy.id,
        grade: rating.band.grade,
        gradeLabel: rating.band.gradeLabel,
        severityRank: rating.band.severityRank,
        worstDaysPastDue: rating.worstDaysPastDue,
        ratedLoanCount: rating.ratedLoanCount,
        totalExposureAmount: fromCents(rating.totalExposureCents),
        totalProvisionAmount: fromCents(rating.totalProvisionCents),
        drivingLoanId: rating.drivingLoanId,
        previousGrade: previous?.grade ?? null,
        ratingReason: rating.reason,
        isCurrent: true,
        ratedAt: new Date(),
      },
      transaction,
    );
  }
}

/** Sólo se califica lo que todavía representa exposición: un crédito cancelado ya no arriesga nada. */
function isRateable(loan: LoanModel): boolean {
  return (RATEABLE_LOAN_STATUSES as readonly string[]).includes(loan.status);
}
