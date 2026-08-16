/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza califica la deuda y al cliente para medir pérdida esperada y exposición.
 * @system responde la calificación vigente, su historial y la distribución de la cartera.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { fromCents, sumCents, toCents } from '../../loans/domain/money.util.js';
import { CreditRatingRepository } from '../credit-rating.repository.js';
import { toCustomerRatingResponse, toLoanRatingResponse, toPortfolioGradeResponse } from '../credit-rating.mapper.js';
import { RatingPolicyService } from './rating-policy.service.js';
import { buildRatingScaleCatalog } from './rating-scale-catalog.js';

@Injectable()
export class RatingQueryService {
  constructor(
    private readonly repository: CreditRatingRepository,
    private readonly policies: RatingPolicyService,
  ) {}

  /**
   * La escala vigente, entera y explicada.
   *
   * Existe porque la interfaz sabía enseñar la LETRA de un cliente pero no tenía
   * de dónde sacar qué significa: ni su etiqueta, ni el tramo de mora que la
   * define, ni la previsión que arrastra, ni su posición dentro de la escala.
   * Sin eso, una «C» en una tabla es un carácter — y lo que hay detrás es una
   * previsión del 20 % de la exposición.
   *
   * Se sirve desde la política ACTIVA y no desde una copia en el frontend: la
   * escala es versionada y regulatoria, y una copia se separa el día que se
   * apruebe una versión nueva sin que nada falle — la letra seguiría siendo
   * correcta y la explicación ya no.
   */
  async getRatingScale(tenantId: string) {
    return buildRatingScaleCatalog(await this.policies.resolveActivePolicy(tenantId));
  }

  /**
   * La calificación vigente de un crédito.
   *
   * Un crédito sin calificar da 404 y no una categoría por defecto. La diferencia importa: «todavía
   * no se calificó» y «se calificó y salió A» son estados distintos, y devolver A para el primero
   * haría que un crédito que el barrido nunca alcanzó se lea como sano en el reporte de cierre.
   */
  async getLoanRating(tenantId: string, loanId: string) {
    const rating = await this.repository.findCurrentLoanRating(tenantId, loanId);
    if (!rating) throw new NotFoundException('LOAN_RATING_NOT_FOUND');
    return toLoanRatingResponse(rating);
  }

  async getLoanRatingHistory(tenantId: string, loanId: string, limit: number) {
    const rows = await this.repository.findLoanRatingHistory(tenantId, loanId, limit);
    return { loanId, items: rows.map(toLoanRatingResponse) };
  }

  async getCustomerRating(tenantId: string, customerId: string) {
    const rating = await this.repository.findCurrentCustomerRating(tenantId, customerId);
    if (!rating) throw new NotFoundException('CUSTOMER_RATING_NOT_FOUND');
    return toCustomerRatingResponse(rating);
  }

  async getCustomerRatingHistory(tenantId: string, customerId: string, limit: number) {
    const rows = await this.repository.findCustomerRatingHistory(tenantId, customerId, limit);
    return { customerId, items: rows.map(toCustomerRatingResponse) };
  }

  /**
   * Distribución de la cartera por categoría, con la política que la produjo.
   *
   * La política viaja en la respuesta y no como dato suelto porque una distribución sin la matriz que
   * la generó no se puede comparar contra la del mes pasado: si entre medias cambió un umbral, la
   * migración de categorías que se ve no es deterioro de la cartera sino un cambio de regla.
   */
  async getPortfolioSummary(tenantId: string) {
    const resolved = await this.policies.resolveActivePolicy(tenantId);
    const rows = await this.repository.summarizePortfolio(tenantId);
    const grades = rows.map(toPortfolioGradeResponse);

    return {
      policy: {
        id: String(resolved.policy.id),
        policyCode: resolved.policy.policyCode,
        versionCode: resolved.policy.versionCode,
        scaleCode: resolved.policy.scaleCode,
        contaminationEnabled: resolved.policy.contaminationEnabled,
      },
      grades,
      totals: {
        loanCount: grades.reduce((total, row) => total + row.loanCount, 0),
        exposureAmount: sumDecimals(grades.map((row) => row.exposureAmount)),
        provisionAmount: sumDecimals(grades.map((row) => row.provisionAmount)),
      },
    };
  }
}

/**
 * Suma importes decimales pasando por céntimos enteros.
 *
 * Sumar los textos con `parseFloat` introduce el error de coma flotante en el único número que
 * contabilidad va a cuadrar contra el libro mayor. `toCents` parsea el decimal por partes —sin pasar
 * por binario flotante— y la suma se hace sobre enteros; el formateo ocurre una sola vez al final.
 */
function sumDecimals(values: readonly string[]): string {
  return fromCents(sumCents(values.map((value) => toCents(value))));
}
