/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza sostiene el ciclo del préstamo desembolsado con saldos reconstruibles.
 * @system castiga un préstamo incobrable dejando el saldo perdido registrado, no borrado.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { WriteOffLoanDto } from '../loans.schemas.js';
import { LoansRepository } from '../loans.repository.js';

@Injectable()
export class LoanWriteOffService {
  constructor(
    private readonly loans: LoansRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  /**
   * Castigo contable: se reconoce que el saldo no se va a cobrar.
   *
   * El préstamo NO se borra ni se marca como saldado. El importe castigado queda escrito porque es
   * dato de riesgo de primer orden: la pérdida observada es lo que hace comparables dos carteras, y
   * un préstamo castigado que desapareciera del libro haría que la tasa de malos del modelo bajara
   * justo cuando la realidad empeoró.
   *
   * Las cuotas pasan a `written_off` y dejan de ser cobrables, pero conservan sus importes: la
   * historia de atraso que produjeron sigue alimentando el desenlace que ve el motor.
   */
  async writeOff(input: { tenantId: string; loanId: string; body: WriteOffLoanDto; currentUser: AuthenticatedUser }) {
    return this.sequelize.transaction(async (transaction) => {
      const loan = await this.loans.findLoanForUpdate(input.tenantId, input.loanId, transaction);
      if (!loan) throw new NotFoundException('LOAN_NOT_FOUND');
      if (loan.status === 'written_off') throw new ConflictException('LOAN_ALREADY_WRITTEN_OFF');
      if (loan.status !== 'active') throw new ConflictException('LOAN_NOT_WRITE_OFF_ELIGIBLE');

      const now = new Date();
      const previousStatus = loan.status;
      loan.status = 'written_off';
      loan.writtenOffAt = now;
      loan.writtenOffAmount = loan.outstandingPrincipal;
      loan.writeOffReasonCode = input.body.reasonCode;
      loan.delinquencyBucket = 'written_off';
      loan.closedAt = now;
      loan.updatedAtValue = now;
      await loan.save({ transaction });

      const installments = await this.loans.findInstallments(input.tenantId, loan.id, { transaction });
      for (const installment of installments) {
        if (installment.status === 'paid') continue;
        installment.status = 'written_off';
        installment.updatedAtValue = now;
        await installment.save({ transaction });
      }

      await this.loans.createEvent(
        {
          tenantId: input.tenantId,
          loanId: loan.id,
          eventType: 'loan_written_off',
          previousStatus,
          newStatus: loan.status,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          reasonCode: input.body.reasonCode,
          payloadJson: { writtenOffAmount: loan.writtenOffAmount },
          notes: input.body.notes,
          happenedAt: now,
        },
        { transaction },
      );

      return { loanId: loan.id, status: loan.status, writtenOffAmount: loan.writtenOffAmount };
    });
  }
}
