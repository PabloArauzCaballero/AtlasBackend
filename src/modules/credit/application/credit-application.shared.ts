/**
 * @file Lo que comparten la solicitud de crédito y su admisión.
 * @business La respuesta que ve quien solicita, y la comprobación de que el producto se puede ofrecer.
 * @system funciones puras, sin estado, usadas por los dos servicios del alta de crédito.
 */
import { UnprocessableEntityException } from '@nestjs/common';
import type { CreateCreditApplicationDto } from '../credit.schemas.js';

/**
 * Viven aparte para romper un ciclo: el servicio del caso de uso y el de admisión se necesitan
 * mutuamente si cualquiera de los dos las exporta. Son funciones puras, así que no arrastran nada.
 */
export function assertProductIsOfferable(
  product: { status: string; effectiveFrom: Date | null; effectiveUntil: Date | null },
  now: Date,
): void {
  if (product.status !== 'active') throw new UnprocessableEntityException('CREDIT_PRODUCT_NOT_AVAILABLE');
  if (product.effectiveFrom && product.effectiveFrom.getTime() > now.getTime()) {
    throw new UnprocessableEntityException('CREDIT_PRODUCT_NOT_AVAILABLE');
  }
  if (product.effectiveUntil && product.effectiveUntil.getTime() <= now.getTime()) {
    throw new UnprocessableEntityException('CREDIT_PRODUCT_NOT_AVAILABLE');
  }
}

export /**
 * La forma con la que sale una solicitud recién creada.
 *
 * Sale de la transacción a propósito: es una proyección pura y no tiene nada que hacer dentro del
 * bloque que decide y escribe. Leerlo aparte también deja ver de un vistazo qué expone el
 * endpoint, que dentro de ochenta líneas de escritura se perdía.
 */
function toSubmissionResponse(
  application: {
    id: unknown;
    applicationCode: string;
    status: string;
    requestedAmount: string;
    requestedTermMonths: number;
    currencyCode: string;
    submittedAt: Date;
  },
  productCode: string,
  input: { customerId: string; body: CreateCreditApplicationDto },
) {
  return {
    applicationId: String(application.id),
    applicationCode: application.applicationCode,
    customerId: input.customerId,
    productCode,
    status: application.status,
    requestedAmount: application.requestedAmount,
    requestedTermMonths: application.requestedTermMonths,
    currencyCode: application.currencyCode,
    submittedAt: application.submittedAt.toISOString(),
    purposeCode: input.body.purposeCode ?? null,
  };
}
