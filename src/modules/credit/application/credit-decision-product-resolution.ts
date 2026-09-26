/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Ninguna solicitud puede quedar `submitted` para siempre por un fallo previo a decidir.
 * @system resuelve el producto y llama al Motor con su tasa base, sin dejar escapar una excepción (C-2).
 */
import { Logger } from '@nestjs/common';
import {
  CreditDecisionEngineService,
  CreditDecisionRequest,
  CreditDecisionResult,
} from '../../decision-engine/credit-decision-engine.service.js';
import { CreditRepository } from '../credit.repository.js';

/**
 * Resuelve el producto ANTES de preguntarle al Motor, para poder mandarle su tasa base (Frente 3A,
 * punto 3 del plan `_plan-motor-decisiones-tasa-2026-09-25`: `product_base_annual_rate`).
 *
 * Su try/catch cubre SÓLO la resolución del producto, nunca la llamada a `decide` — esa ya tiene su
 * propio manejo de errores (C-2) con una semántica distinta (reintento vs. revisión). Envolver
 * también `decide` aquí convertiría un fallo del motor (recuperable, cuenta como `failed` en
 * `retryDeferred`) en `engineUnavailable` (deriva a revisión manual), pisando esa distinción.
 * Sin producto o sin tasa declarada se manda `0`: es sólo lo que el Motor SUMA a la prima de banda,
 * no lo que se cobra — el clamp real vive en el desembolso.
 */
export async function decideWithProduct(
  engine: CreditDecisionEngineService,
  credit: CreditRepository,
  logger: Logger,
  input: Omit<CreditDecisionRequest, 'productBaseAnnualRatePercent'>,
): Promise<CreditDecisionResult> {
  let productBaseAnnualRatePercent = 0;
  try {
    const product = input.productCode ? await credit.findProductByCode(input.tenantId, input.productCode) : null;
    productBaseAnnualRatePercent = product?.annualInterestRate != null ? Number(product.annualInterestRate) : 0;
  } catch (error) {
    const message = (error as Error).message ?? 'PRODUCT_RESOLUTION_FAILED';
    logger.error(`No se pudo resolver el producto de la solicitud ${input.applicationCode} antes de decidir: ${message}`);
  }
  return engine.decide({ ...input, productBaseAnnualRatePercent });
}
