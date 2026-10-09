/**
 * @file Servicio de aplicación: el historial del POS del comercio y el origen (sucursal y caja) de cada comprobante.
 * @business El comercio cuadra su caja: qué solicitudes respondió y qué pagos verificó, filtrado por sucursal, caja y
 *   fechas, en páginas y con el total del filtro (Pablo, 2026-10-08). Dos operaciones del mismo importe pueden venir de
 *   cajas distintas, así que cada fila dice la suya.
 * @system junta los movimientos de la solicitud (crédito: respuesta y pago inicial) con los comprobantes de cuota ya
 *   decididos; el origen de un comprobante es el de la compra que dio el crédito (cuota → préstamo → solicitud → caja).
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import type { AuthenticatedUser } from '../../common/types/auth.types.js';
import { LoanInstallmentModel, LoanModel, LoanPaymentClaimModel } from '../../database/models/index.js';
import {
  CreditPosOriginService,
  SIN_ORIGEN,
  type MovimientoDeSolicitud,
  type OrigenDeCaja,
  type RangoDeFechas,
} from '../credit/application/credit-pos-origin.service.js';

export type MovimientoDePos = Omit<MovimientoDeSolicitud, 'kind'> & { kind: MovimientoDeSolicitud['kind'] | 'installment_payment' };

export type FiltroDeHistorial = {
  branchId?: string | undefined;
  terminalId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  page: number;
  pageSize: number;
};

/** `from`/`to` son días (AAAA-MM-DD) en hora de Bolivia (UTC−4): el día del mostrador, no el de UTC. */
export function rangoDeDias(from?: string, to?: string): RangoDeFechas {
  return {
    from: from ? new Date(`${from}T00:00:00.000-04:00`) : null,
    to: to ? new Date(`${to}T23:59:59.999-04:00`) : null,
  };
}

/** Filtra por sucursal y caja, ordena de lo más reciente a lo más antiguo y corta la página. Pura, para probarla. */
export function paginarMovimientos(movimientos: MovimientoDePos[], filtro: FiltroDeHistorial) {
  const filtrados = movimientos
    .filter((m) => !filtro.branchId || m.branchId === filtro.branchId)
    .filter((m) => !filtro.terminalId || m.terminalId === filtro.terminalId)
    .sort((a, b) => b.happenedAt.localeCompare(a.happenedAt) || b.id.localeCompare(a.id));
  const total = filtrados.length;
  const pages = Math.max(1, Math.ceil(total / filtro.pageSize));
  const page = Math.min(Math.max(1, filtro.page), pages);
  return {
    items: filtrados.slice((page - 1) * filtro.pageSize, page * filtro.pageSize),
    page,
    pageSize: filtro.pageSize,
    total,
    pages,
    // El total del FILTRO, no de la página: es lo que se compara con la caja al cerrar el día.
    totals: {
      count: total,
      amount: filtrados
        .filter((m) => m.status === 'confirmed' || m.status === 'verified' || m.status === 'accepted')
        .reduce((suma, m) => suma + m.amount, 0)
        .toFixed(2),
    },
  };
}

@Injectable()
export class PosHistoryService {
  constructor(
    @InjectModel(LoanPaymentClaimModel) private readonly claims: typeof LoanPaymentClaimModel,
    @InjectModel(LoanInstallmentModel) private readonly installments: typeof LoanInstallmentModel,
    @InjectModel(LoanModel) private readonly loans: typeof LoanModel,
    private readonly posOrigin: CreditPosOriginService,
  ) {}

  async history(input: { tenantId: string; partnerProfileId: string; currentUser: AuthenticatedUser; filtro: FiltroDeHistorial }) {
    await this.posOrigin.asegurarComercio(input.tenantId, input.partnerProfileId, input.currentUser);
    const rango = rangoDeDias(input.filtro.from, input.filtro.to);

    const [deSolicitudes, comprobantes, cajas] = await Promise.all([
      this.posOrigin.movimientos(input.tenantId, input.partnerProfileId, rango),
      this.claims.findAll({
        where: {
          tenantId: input.tenantId,
          partnerProfileId: input.partnerProfileId,
          deleted: false,
          status: ['verified', 'rejected'],
          decidedAt: {
            [Op.ne]: null,
            ...(rango.from ? { [Op.gte]: rango.from } : {}),
            ...(rango.to ? { [Op.lte]: rango.to } : {}),
          },
        },
        order: [['decided_at', 'DESC']],
        limit: 2000,
      }),
      this.posOrigin.cajas(input.tenantId, input.partnerProfileId),
    ]);
    const origen = await this.origenDeComprobantes(input.tenantId, input.partnerProfileId, comprobantes);

    const deCuotas: MovimientoDePos[] = comprobantes.map((claim) => ({
      kind: 'installment_payment',
      id: `cuota-${claim.id}`,
      code: claim.claimCode,
      amount: Number(claim.claimedAmount),
      currencyCode: claim.currencyCode,
      status: claim.status,
      reference: claim.payerReference,
      termMonths: null,
      happenedAt: new Date(claim.decidedAt as Date).toISOString(),
      ...(origen.get(String(claim.id)) ?? SIN_ORIGEN),
    }));

    return {
      partnerProfileId: input.partnerProfileId,
      filters: cajas,
      ...paginarMovimientos([...deSolicitudes, ...deCuotas], input.filtro),
    };
  }

  /** El origen de cada comprobante, por id de comprobante: el de la compra que dio el crédito de su cuota. */
  async origenDeComprobantes(
    tenantId: string,
    partnerProfileId: string,
    claims: readonly Pick<LoanPaymentClaimModel, 'id' | 'installmentId'>[],
  ): Promise<Map<string, OrigenDeCaja>> {
    const resultado = new Map<string, OrigenDeCaja>();
    if (claims.length === 0) return resultado;
    const cuotas = await this.installments.findAll({
      attributes: ['id', 'loanId'],
      where: { tenantId, id: [...new Set(claims.map((c) => String(c.installmentId)))] },
    });
    const prestamoDeCuota = new Map(cuotas.map((c) => [String(c.id), String(c.loanId)]));
    const prestamos = await this.loans.findAll({
      attributes: ['id', 'creditApplicationId'],
      where: { tenantId, id: [...new Set(prestamoDeCuota.values())] },
    });
    const solicitudDePrestamo = new Map(prestamos.map((l) => [String(l.id), String(l.creditApplicationId)]));
    const origenes = await this.posOrigin.origenes(tenantId, partnerProfileId, [...solicitudDePrestamo.values()]);
    for (const claim of claims) {
      const prestamo = prestamoDeCuota.get(String(claim.installmentId));
      const solicitud = prestamo ? solicitudDePrestamo.get(prestamo) : undefined;
      resultado.set(String(claim.id), (solicitud && origenes.get(solicitud)) || SIN_ORIGEN);
    }
    return resultado;
  }
}
