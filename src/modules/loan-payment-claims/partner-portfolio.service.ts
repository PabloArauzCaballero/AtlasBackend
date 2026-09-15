/**
 * @file Caso de uso: la cartera de cobros del comercio, con su comisión devengada.
 * @business Lo que el comercio ha cobrado por Atlas y lo que le costó, en un solo sitio.
 * @system compone los pagos ya recibidos de los créditos del comercio con la comisión de cada uno.
 */
import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/types/auth.types.js';
import { LoansRepository } from '../loans/loans.repository.js';
import { CreditRepository } from '../credit/credit.repository.js';
import { PartnerProfileService } from '../partner-onboarding/application/partner-profile.service.js';
import { assertOwnPartnerResource } from '../../common/utils/auth/ownership.util.js';
import { PENDIENTE } from './payment-claims.shared.js';
import { InjectModel } from '@nestjs/sequelize';
import { LoanPaymentClaimModel } from '../../database/models/index.js';

/** Un cobro ya recibido en un crédito del comercio, con la comisión que devengó. */
interface PagoDeCartera {
  paymentId: string;
  paymentCode: string;
  loanId: string;
  loanCode: string;
  receivedAt: string;
  amount: string;
  appliedAmount: string;
  currencyCode: string;
  paymentMethod: string;
  externalReference: string | null;
  status: string;
  reversed: boolean;
  mdrRatePercent: string;
  commissionAccrued: string;
  installmentNumbers: number[];
}

/**
 * La cartera es un INFORME, no un caso de uso del aviso de pago: no crea ni decide nada, compone
 * lo ya cobrado con la comisión que devengó. Sale de `PartnerPaymentClaimsService` porque juntas
 * pasaban de las 300 líneas de `check:file-size`, y porque quien lee la cola de avisos no necesita
 * leer el cálculo de comisiones.
 */
@Injectable()
export class PartnerPortfolioService {
  constructor(
    private readonly loans: LoansRepository,
    private readonly credit: CreditRepository,
    private readonly partners: PartnerProfileService,
    @InjectModel(LoanPaymentClaimModel) private readonly claims: typeof LoanPaymentClaimModel,
  ) {}

  /**
   * La cartera del comercio: qué le deben, quién y cuándo.
   *
   * Una sola lectura para las tres preguntas que el comercio se hace —cuánto tengo por cobrar, qué
   * cuota vence qué día, y cómo va el mes— porque las tres se responden con los mismos datos. Tres
   * endpoints separados habrían recorrido los mismos préstamos tres veces y se habrían
   * desincronizado en cuanto uno cambiara su forma de contar.
   *
   * NO lleva la identidad del cliente. El comercio necesita saber que la cuota 3 de una operación
   * suya vence el martes, no quién es la persona: darle el nombre convertiría la cartera en un
   * padrón de deudores que nadie autorizó.
   */
  async portfolioForPartner(input: { tenantId: string; partnerProfileId: string; currentUser: AuthenticatedUser }) {
    const profile = await this.partners.requireProfile(input.tenantId, input.partnerProfileId);
    assertOwnPartnerResource(input.currentUser, profile.ownerMerchantUserId);

    const applications = await this.credit.findApplicationsByPartner(input.tenantId, input.partnerProfileId, {
      onlyPendingAcceptance: false,
    });
    /* Una solicitud produce como mucho un prestamo: los que aun no desembolsaron no tienen cartera. */
    const loans = (
      await Promise.all(applications.map((application) => this.loans.findLoanByApplication(input.tenantId, String(application.id))))
    ).filter((loan): loan is NonNullable<typeof loan> => loan !== null);

    const hoy = new Date().toISOString().slice(0, 10);
    const creditos = [];
    /* Los cobros ya recibidos, con la comisión que devengó cada uno. Se ordenan al final. */
    const pagosRecibidos: PagoDeCartera[] = [];
    const porDia = new Map<string, { fecha: string; cuotas: number; monto: number }>();
    let saldoPorCobrar = 0;
    let montoVencido = 0;
    let cuotasVencidas = 0;
    /* Las tres cestas que el comercio distingue de un vistazo: mora, pendiente y pagado. */
    let cuotasPendientes = 0;
    let cuotasPagadas = 0;
    let cobradoTotal = 0;
    /* La tasa de comisión del comercio y lo que se le ha devengado a Atlas por cobrar. */
    const tasaMdr = Number(profile.mdrRatePercent ?? '0');
    let comisionDevengada = 0;

    for (const loan of loans) {
      const cuotas = await this.loans.findInstallments(input.tenantId, String(loan.id));
      const detalle = cuotas.map((cuota) => {
        const debido = Number(cuota.principalAmount) + Number(cuota.interestAmount) + Number(cuota.lateFeeAmount);
        const pagado = Number(cuota.paidPrincipal) + Number(cuota.paidInterest) + Number(cuota.paidLateFee);
        const pendiente = Math.max(debido - pagado, 0);
        const vence = String(cuota.dueDate).slice(0, 10);
        const vencida = pendiente > 0 && vence < hoy;

        saldoPorCobrar += pendiente;
        cobradoTotal += pagado;
        if (pendiente === 0) cuotasPagadas += 1;
        else if (vencida) {
          montoVencido += pendiente;
          cuotasVencidas += 1;
        } else cuotasPendientes += 1;
        if (pendiente > 0) {
          const dia = porDia.get(vence) ?? { fecha: vence, cuotas: 0, monto: 0 };
          dia.cuotas += 1;
          dia.monto += pendiente;
          porDia.set(vence, dia);
        }

        return {
          installmentId: String(cuota.id),
          installmentNumber: cuota.installmentNumber,
          dueDate: vence,
          amountDue: debido.toFixed(2),
          amountPaid: pagado.toFixed(2),
          amountOutstanding: pendiente.toFixed(2),
          status: cuota.status,
          daysPastDue: cuota.daysPastDue,
          overdue: vencida,
        };
      });

      const cobradoCredito = detalle.reduce((suma, cuota) => suma + Number(cuota.amountPaid), 0);
      // La comisión de Atlas se DEVENGA sobre lo cobrado, no sobre lo aprobado: un crédito que aún
      // no paga nada no debe comisión. Cuando el crédito quede saldado, la comisión acumulada será
      // la tasa por el total cobrado —que es la venta financiada—.
      const comisionCredito = (cobradoCredito * tasaMdr) / 100;
      comisionDevengada += comisionCredito;

      pagosRecibidos.push(
        ...(await this.pagosDelCredito({
          tenantId: input.tenantId,
          loanId: String(loan.id),
          loanCode: loan.loanCode,
          cuotas,
          tasaMdr,
        })),
      );

      creditos.push({
        loanId: String(loan.id),
        loanCode: loan.loanCode,
        currencyCode: loan.currencyCode,
        principalAmount: loan.principalAmount,
        status: loan.status,
        outstanding: detalle.reduce((suma, cuota) => suma + Number(cuota.amountOutstanding), 0).toFixed(2),
        collected: cobradoCredito.toFixed(2),
        commissionAccrued: comisionCredito.toFixed(2),
        installments: detalle,
      });
    }

    const pendientesDeVerificar = await this.claims.count({
      where: { tenantId: input.tenantId, partnerProfileId: input.partnerProfileId, status: PENDIENTE, deleted: false },
    });

    return {
      partnerProfileId: input.partnerProfileId,
      summary: {
        activeCredits: creditos.filter((credito) => credito.status === 'active').length,
        totalCredits: creditos.length,
        outstanding: saldoPorCobrar.toFixed(2),
        overdueAmount: montoVencido.toFixed(2),
        overdueInstallments: cuotasVencidas,
        collected: cobradoTotal.toFixed(2),
        /* Lo que aún no vence: `outstanding` menos lo que ya está en mora. */
        pendingAmount: Math.max(saldoPorCobrar - montoVencido, 0).toFixed(2),
        pendingInstallments: cuotasPendientes,
        paidInstallments: cuotasPagadas,
        paymentsCount: pagosRecibidos.filter((pago) => !pago.reversed).length,
        proofsAwaitingVerification: pendientesDeVerificar,
        /* La comisión: su tasa, lo devengado (lo que Atlas ya ganó sobre lo cobrado). */
        mdrRatePercent: tasaMdr.toFixed(2),
        commissionAccrued: comisionDevengada.toFixed(2),
      },
      credits: creditos,
      /* Los cobros ya recibidos, del más reciente al más antiguo. */
      payments: pagosRecibidos.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)),
      /* El calendario: qué entra cada día, ordenado. Es la vista que pide quien maneja caja. */
      calendar: [...porDia.values()]
        .sort((a, b) => a.fecha.localeCompare(b.fecha))
        .map((dia) => ({ date: dia.fecha, installments: dia.cuotas, amount: dia.monto.toFixed(2), overdue: dia.fecha < hoy })),
    };
  }

  /**
   * Los cobros de UN crédito, uno a uno, con la comisión que cada uno devengó.
   *
   * La comisión de un pago sale de lo que ese pago IMPUTÓ a cuotas, no de su importe declarado. Un
   * pago revertido tiene sus imputaciones anuladas —y por tanto no devenga—, y uno imputado en
   * parte sólo devenga sobre lo que entró. Usar `payment.amount` habría hecho que una reversión
   * devengara comisión sobre dinero que volvió al cliente.
   *
   * Lo que esta lista NO puede prometer es sumar `commissionAccrued`. Ese total se calcula sobre lo
   * pagado EN LAS CUOTAS, y una cuota puede aparecer saldada sin un pago detrás —así entran las
   * carteras migradas y los datos sembrados—. La diferencia es información real y se enseña en la
   * pantalla como tal; taparla igualando una cifra a la otra habría escondido cobros sin respaldo.
   */
  private async pagosDelCredito(input: {
    tenantId: string;
    loanId: string;
    loanCode: string;
    cuotas: { id: string; installmentNumber: number }[];
    tasaMdr: number;
  }): Promise<PagoDeCartera[]> {
    const pagos = await this.loans.findPaymentsByLoan(input.tenantId, input.loanId);
    const imputaciones = await this.loans.findAllocationsByPayments(
      input.tenantId,
      pagos.map((pago) => String(pago.id)),
    );
    const numeroDeCuota = new Map(input.cuotas.map((cuota) => [String(cuota.id), cuota.installmentNumber] as const));

    return pagos.map((pago) => {
      const suyas = imputaciones.filter((fila) => String(fila.loanPaymentId) === String(pago.id));
      const aplicado = suyas.reduce(
        (suma, fila) => suma + Number(fila.principalApplied) + Number(fila.interestApplied) + Number(fila.lateFeeApplied),
        0,
      );

      return {
        paymentId: String(pago.id),
        paymentCode: pago.paymentCode,
        loanId: input.loanId,
        loanCode: input.loanCode,
        receivedAt: new Date(pago.receivedAt).toISOString(),
        amount: Number(pago.amount).toFixed(2),
        appliedAmount: aplicado.toFixed(2),
        currencyCode: pago.currencyCode,
        paymentMethod: pago.paymentMethod,
        externalReference: pago.externalReference,
        status: pago.status,
        reversed: pago.status === 'reversed',
        mdrRatePercent: input.tasaMdr.toFixed(2),
        commissionAccrued: ((aplicado * input.tasaMdr) / 100).toFixed(2),
        /* Qué cuotas cubrió: un pago puede saldar varias, y una cuota recibir varios pagos. */
        installmentNumbers: [...new Set(suyas.map((fila) => numeroDeCuota.get(String(fila.loanInstallmentId))))]
          .filter((numero): numero is number => numero !== undefined)
          .sort((a, b) => a - b),
      };
    });
  }
}
