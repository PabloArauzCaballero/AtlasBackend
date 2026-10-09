/**
 * @file Regla de aplicación: el importe del pago inicial avisado tiene que ser el de la compra (APP-04).
 * @business El cliente no puede declarar Bs 1 y que el comercio, que confirma «entró el dinero», lo dé por bueno.
 * @system traduce el cálculo puro de `domain/down-payment.ts` a un 422 con código y el importe esperado.
 */
import { UnprocessableEntityException } from '@nestjs/common';
import type { CreditApplicationModel } from '../../../database/models/index.js';
import { checkDownPaymentAmount, expectedDownPaymentAmount, fromCents } from '../domain/down-payment.js';

/**
 * El servidor calcula el inicial del financiado de la solicitud (`requested_amount`, el 40 %) con la regla 60/40.
 * Devuelve el importe normalizado a dos decimales, que es lo que se guarda; si no cuadra, 422 con
 * `error.code` (`DOWN_PAYMENT_AMOUNT_MISMATCH`, `DOWN_PAYMENT_AMOUNT_INVALID` o `DOWN_PAYMENT_EXPECTED_UNKNOWN`) y
 * `error.details.expectedAmount` / `acceptedAmounts` para que la app lo diga sin calcularlo por su cuenta.
 */
export function assertExpectedDownPaymentAmount(
  amount: string,
  application: Pick<CreditApplicationModel, 'requestedAmount' | 'currencyCode'>,
): string {
  const check = checkDownPaymentAmount(amount, application.requestedAmount);
  if (check.ok) return fromCents(check.amountCents);
  const expectedAmount = expectedDownPaymentAmount(application.requestedAmount);
  const mensajes = {
    DOWN_PAYMENT_AMOUNT_INVALID: 'El importe del pago inicial tiene que ser mayor que cero.',
    DOWN_PAYMENT_EXPECTED_UNKNOWN: 'Esta compra no tiene un importe financiado del que calcular el pago inicial.',
    DOWN_PAYMENT_AMOUNT_MISMATCH: `El pago inicial de esta compra es ${expectedAmount ?? '—'} ${application.currencyCode}.`,
  } as const;
  throw new UnprocessableEntityException({
    code: check.code,
    message: mensajes[check.code],
    expectedAmount,
    acceptedAmounts: check.expectedCents.map(fromCents),
    currencyCode: application.currencyCode,
  });
}
