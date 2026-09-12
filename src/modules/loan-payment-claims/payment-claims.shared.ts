/**
 * @file Lo que comparten los cuatro casos de uso del aviso de pago.
 * @business El dinero de una transferencia lo ve el comercio en su cuenta, no Atlas: por eso lo confirma él.
 * @system resuelve la cuota y su comercio, y comprueba que quien llama opera sobre lo suyo.
 */
import { ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ALLOWED_EVIDENCE_MIME_TYPES, type AllowedEvidenceMimeType } from '../../common/storage/document-storage.service.js';
import type { AuthenticatedUser } from '../../common/types/auth.types.js';
import { LoansRepository } from '../loans/loans.repository.js';
import { CreditRepository } from '../credit/credit.repository.js';

/** El estado en el que nace un aviso: el comercio todavía no ha mirado su cuenta. */
export const PENDIENTE = 'pending_verification';

/**
 * Un cliente no opera sobre otro cliente.
 *
 * Es función suelta y no método: no necesita nada inyectado, y así la comparten los cuatro
 * servicios sin heredar de una clase base ni inyectarse entre ellos.
 */
export function assertOwnCustomer(user: AuthenticatedUser, customerId: string): void {
  if (user.role !== 'customer') return;
  if (String(user.customerId ?? '') !== String(customerId)) {
    throw new ForbiddenException('No puede operar sobre otro cliente.');
  }
}

/** El tipo del comprobante se comprueba contra la lista, nunca contra lo que declare quien sube. */
export function assertMimeType(valor: string): AllowedEvidenceMimeType {
  const permitido = (ALLOWED_EVIDENCE_MIME_TYPES as readonly string[]).includes(valor);
  if (!permitido) throw new UnprocessableEntityException(`EVIDENCE_CONTENT_TYPE_NOT_ALLOWED: ${valor}`);
  return valor as AllowedEvidenceMimeType;
}

/**
 * Las dos resoluciones que necesitan repositorio: de qué cuota se habla, y de qué comercio es.
 *
 * Salen de `LoanPaymentClaimsService` al partirlo en cuatro. Son las únicas piezas que los cuatro
 * comparten y que no pueden ser funciones sueltas, porque leen de la base.
 */
@Injectable()
export class PaymentClaimsContextService {
  constructor(
    private readonly loans: LoansRepository,
    private readonly credit: CreditRepository,
  ) {}

  /** La cuota tiene que ser de un préstamo de ESTE cliente; si no, no existe para él. */
  async requireOwnInstallment(tenantId: string, customerId: string, installmentId: string) {
    const loansDelCliente = await this.loans.findLoansByCustomer(tenantId, String(customerId));
    const installments = (
      await Promise.all(loansDelCliente.map((prestamo) => this.loans.findInstallments(tenantId, String(prestamo.id))))
    ).flat();
    const installment = installments.find((cuota) => String(cuota.id) === String(installmentId));
    if (!installment) throw new NotFoundException('INSTALLMENT_NOT_FOUND');

    const loan = loansDelCliente.find((prestamo) => String(prestamo.id) === String(installment.loanId));
    if (!loan) throw new NotFoundException('LOAN_NOT_FOUND');
    return { loan, installment };
  }

  /** El comercio de un préstamo sale de la solicitud que lo originó; sin solicitud, no hay comercio. */
  async resolvePartner(tenantId: string, loan: { creditApplicationId?: string | null }): Promise<string | null> {
    if (!loan.creditApplicationId) return null;
    const application = await this.credit.findApplicationById(tenantId, String(loan.creditApplicationId));
    return application?.partnerProfileId ? String(application.partnerProfileId) : null;
  }
}
