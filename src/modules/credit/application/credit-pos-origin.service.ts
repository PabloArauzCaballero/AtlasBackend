/**
 * @file Servicio de aplicación: de qué sucursal y caja salió cada compra, y lo que pasó en cada caja.
 * @business En el mostrador pueden coincidir dos compras del mismo importe en cajas distintas: cada solicitud y cada
 *   comprobante tiene que decir su sucursal y su caja para que el comercio sepa a cuál corresponde (Pablo, 2026-10-08).
 * @system lee `credit_applications.pos_terminal_id` y el directorio de cajas del comercio; entrega el origen por solicitud
 *   y los movimientos ya respondidos (solicitudes y pagos iniciales) para el historial del POS.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, type WhereOptions } from 'sequelize';
import { CreditApplicationModel } from '../../../database/models/index.js';
import type { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { assertOwnPartnerResource } from '../../../common/utils/auth/ownership.util.js';
import { PartnerDirectoryService } from '../../partner-onboarding/application/partner-directory.service.js';
import { PartnerProfileService } from '../../partner-onboarding/application/partner-profile.service.js';

/** El local de una compra. Todo `null` si no nació de un QR físico (o la caja ya no existe). */
export type OrigenDeCaja = {
  branchId: string | null;
  branchName: string | null;
  branchCode: string | null;
  terminalId: string | null;
  terminalAlias: string | null;
  terminalSerial: string | null;
};

export const SIN_ORIGEN: OrigenDeCaja = {
  branchId: null,
  branchName: null,
  branchCode: null,
  terminalId: null,
  terminalAlias: null,
  terminalSerial: null,
};

/** Un movimiento del historial del POS que vive en la solicitud: su respuesta, o su pago inicial ya verificado. */
export type MovimientoDeSolicitud = OrigenDeCaja & {
  kind: 'purchase_request' | 'down_payment';
  id: string;
  code: string;
  amount: number;
  currencyCode: string;
  status: string;
  reference: string | null;
  termMonths: number | null;
  happenedAt: string;
};

export type RangoDeFechas = { from: Date | null; to: Date | null };

function enRango(campo: string, rango: RangoDeFechas): WhereOptions {
  if (!rango.from && !rango.to) return { [campo]: { [Op.ne]: null } };
  return {
    [campo]: {
      ...(rango.from ? { [Op.gte]: rango.from } : {}),
      ...(rango.to ? { [Op.lte]: rango.to } : {}),
    },
  };
}

@Injectable()
export class CreditPosOriginService {
  constructor(
    @InjectModel(CreditApplicationModel) private readonly applications: typeof CreditApplicationModel,
    private readonly partnerDirectory: PartnerDirectoryService,
    private readonly partners: PartnerProfileService,
  ) {}

  /** Que el comercio exista y sea de quien pregunta (los internos pasan). Aquí y no en el libro de préstamos: fronteras. */
  async asegurarComercio(tenantId: string, partnerProfileId: string, currentUser: AuthenticatedUser): Promise<void> {
    const profile = await this.partners.requireProfile(tenantId, partnerProfileId);
    assertOwnPartnerResource(currentUser, profile.ownerMerchantUserId);
  }

  /** Las sucursales y cajas del comercio, para los filtros del historial. */
  async cajas(tenantId: string, partnerProfileId: string) {
    const directorio = await this.partnerDirectory.terminalDirectory(tenantId, partnerProfileId);
    const cajas = [...directorio.entries()].map(([terminalId, t]) => ({ terminalId, ...t }));
    const sucursales = new Map<string, { branchId: string; branchName: string; branchCode: string }>();
    for (const c of cajas) sucursales.set(c.branchId, { branchId: c.branchId, branchName: c.branchName, branchCode: c.branchCode });
    return {
      branches: [...sucursales.values()].sort((a, b) => a.branchName.localeCompare(b.branchName)),
      terminals: cajas.sort((a, b) => (a.terminalAlias ?? a.terminalSerial).localeCompare(b.terminalAlias ?? b.terminalSerial)),
    };
  }

  /** El origen de varias solicitudes de este comercio a la vez, por id de solicitud. */
  async origenes(tenantId: string, partnerProfileId: string, applicationIds: readonly string[]): Promise<Map<string, OrigenDeCaja>> {
    const resultado = new Map<string, OrigenDeCaja>();
    if (applicationIds.length === 0) return resultado;
    const [filas, directorio] = await Promise.all([
      this.applications.findAll({
        attributes: ['id', 'posTerminalId'],
        where: { tenantId, partnerProfileId, id: [...new Set(applicationIds)] },
      }),
      this.partnerDirectory.terminalDirectory(tenantId, partnerProfileId),
    ]);
    for (const fila of filas) resultado.set(String(fila.id), origenDe(fila.posTerminalId, directorio));
    return resultado;
  }

  /** Las solicitudes que el comercio ya respondió y los pagos iniciales ya verificados, dentro del rango. */
  async movimientos(tenantId: string, partnerProfileId: string, rango: RangoDeFechas): Promise<MovimientoDeSolicitud[]> {
    const [respondidas, iniciales, directorio] = await Promise.all([
      this.applications.findAll({
        where: {
          tenantId,
          partnerProfileId,
          businessAcceptance: ['accepted', 'declined'],
          ...enRango('businessAcceptanceAt', rango),
        },
        order: [['businessAcceptanceAt', 'DESC']],
        limit: 2000,
      }),
      this.applications.findAll({
        where: { tenantId, partnerProfileId, downPaymentStatus: ['confirmed', 'rejected'], ...enRango('downPaymentDecidedAt', rango) },
        order: [['downPaymentDecidedAt', 'DESC']],
        limit: 2000,
      }),
      this.partnerDirectory.terminalDirectory(tenantId, partnerProfileId),
    ]);
    return [
      ...respondidas.map((a) => ({
        kind: 'purchase_request' as const,
        id: `solicitud-${a.id}`,
        code: a.applicationCode,
        amount: Number(a.requestedAmount),
        currencyCode: a.currencyCode,
        status: a.businessAcceptance as string,
        reference: null,
        termMonths: a.requestedTermMonths ?? null,
        happenedAt: (a.businessAcceptanceAt as Date).toISOString(),
        ...origenDe(a.posTerminalId, directorio),
      })),
      ...iniciales.map((a) => ({
        kind: 'down_payment' as const,
        id: `inicial-${a.id}`,
        code: a.applicationCode,
        amount: Number(a.downPaymentAmount ?? 0),
        currencyCode: a.currencyCode,
        status: a.downPaymentStatus as string,
        reference: a.downPaymentPayerReference,
        termMonths: null,
        happenedAt: (a.downPaymentDecidedAt as Date).toISOString(),
        ...origenDe(a.posTerminalId, directorio),
      })),
    ];
  }
}

type Directorio = Awaited<ReturnType<PartnerDirectoryService['terminalDirectory']>>;

export function origenDe(posTerminalId: string | null, directorio: Directorio): OrigenDeCaja {
  if (!posTerminalId) return SIN_ORIGEN;
  const caja = directorio.get(String(posTerminalId));
  if (!caja) return { ...SIN_ORIGEN, terminalId: String(posTerminalId) };
  return {
    branchId: caja.branchId,
    branchName: caja.branchName || null,
    branchCode: caja.branchCode || null,
    terminalId: String(posTerminalId),
    terminalAlias: caja.terminalAlias,
    terminalSerial: caja.terminalSerial,
  };
}
