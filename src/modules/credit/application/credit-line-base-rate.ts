/**
 * @file Utilidad: la tasa base que viaja al motor cuando se calcula una LÍNEA, que no tiene producto.
 * @business La línea se calcula sin compra concreta; el motor exige igual una tasa base para tarifar,
 *   y sin ella no decide y el cliente se queda sin saber cuánto puede gastar.
 * @system la tasa más baja de los productos ofertables hoy, en porcentaje; 0 si no hay ninguno.
 */
import { Logger } from '@nestjs/common';
import type { CreditRepository } from '../credit.repository.js';

/**
 * La tasa base con la que se pide una línea, en PORCENTAJE (como `credit_products.annual_interest_rate`).
 *
 * ## Por qué hacía falta
 *
 * `ATLAS_BNPL_UNDERWRITING` declara `product_base_annual_rate` obligatoria: es lo que suma a la prima
 * de la banda para tarifar. La compra la manda (`decideWithProduct`), pero el recálculo de la línea
 * no, porque una línea no es de ningún producto. Resultado medido en TEST el 2026-10-05: cada recálculo
 * horario del cliente 53 moría con `VARIABLE_MISSING_OR_INVALID: product_base_annual_rate`.
 *
 * ## Por qué la MÁS BAJA de los ofertables
 *
 * La tasa que sale de una línea no se cobra: cada compra se tarifa otra vez con la tasa de SU
 * producto. En la línea es la tasa «desde» que puede enseñarse al cliente, y la honesta es la del
 * producto más barato que de verdad puede contratar hoy —ni uno en borrador ni uno vencido—.
 *
 * Sin productos ofertables o si la consulta falla se manda 0, igual que `decideWithProduct`: un fallo
 * al leer el catálogo no puede dejar al cliente sin línea.
 */
export async function lineBaseRatePercent(
  credit: Pick<CreditRepository, 'findOfferableProducts'>,
  logger: Pick<Logger, 'error'>,
  input: { tenantId: string; now: Date },
): Promise<number> {
  try {
    const rates = (await credit.findOfferableProducts(input.tenantId, input.now))
      .map((product) => (product.annualInterestRate == null ? null : Number(product.annualInterestRate)))
      .filter((rate): rate is number => rate !== null && Number.isFinite(rate) && rate >= 0);
    return rates.length ? Math.min(...rates) : 0;
  } catch (error) {
    logger.error(`No se pudo leer la tasa base de los productos para la línea: ${(error as Error).message}`);
    return 0;
  }
}
