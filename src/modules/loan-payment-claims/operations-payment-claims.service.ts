/**
 * @file Caso de uso: la cola de avisos de pago vista por operaciones, para supervisarla.
 * @business Un aviso que el comercio no mira deja al cliente con su pago sin reconocer; alguien tiene que verlo.
 * @system lista los avisos del tenant con su comercio, cliente, préstamo y cuánto llevan esperando.
 */
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { containsLikePattern } from '../../common/utils/strings/like-pattern.util.js';
import { atlasSchemaFor } from '../../database/domain-schemas.js';
import type { OperationsClaimsQueryDto } from './loan-payment-claims.schemas.js';
import { PENDIENTE } from './payment-claims.shared.js';

/**
 * A partir de cuántas horas un aviso pendiente se considera atrasado.
 *
 * 48 h son dos días hábiles de un comercio que mira su extracto una vez al día: pasado eso, el
 * aviso ya no espera al comercio, lo está esperando a él alguien de operaciones.
 */
export const PAYMENT_CLAIM_STALE_AFTER_HOURS = 48;

const HORA_MS = 3_600_000;

const tabla = (nombre: string): string => `${atlasSchemaFor(nombre)}.${nombre}`;

/**
 * Las dos tablas por las que busca `q` (cliente y comercio). Van en la página Y en el conteo: si el
 * conteo no las tuviera, el total no respetaría la búsqueda y la paginación mentiría.
 */
const JOINS_BUSCABLES = `
        LEFT JOIN ${tabla('customers')} cu ON cu._id = c.customer_id AND cu._tenant_id = c._tenant_id
        LEFT JOIN ${tabla('partner_profiles')} p ON p._id = c.partner_profile_id AND p._tenant_id = c._tenant_id`;

interface FilaDeAviso {
  claimId: string;
  claimCode: string;
  status: string;
  claimedAmount: string;
  currencyCode: string;
  payerReference: string | null;
  hasProof: boolean;
  submittedAt: Date | string;
  decidedAt: Date | string | null;
  rejectionReason: string | null;
  loanId: string;
  loanCode: string | null;
  installmentId: string;
  installmentNumber: number | null;
  installmentDueDate: string | null;
  customerId: string;
  customerCode: string | null;
  customerName: string | null;
  partnerId: string | null;
  partnerName: string | null;
}

export interface AvisoSupervisado extends Omit<FilaDeAviso, 'submittedAt' | 'decidedAt'> {
  submittedAt: string;
  decidedAt: string | null;
  /** Pendiente: horas que lleva esperando. Decidido: horas que tardó en decidirse. */
  ageHours: number;
  /** Pendiente con más de `PAYMENT_CLAIM_STALE_AFTER_HOURS` horas. */
  stale: boolean;
}

/**
 * Sólo lectura, a propósito.
 *
 * La verificación es del COMERCIO —es quien ve el dinero entrar en su cuenta— y ya tiene su pantalla
 * en el ERP. Operaciones no confirma ni rechaza desde aquí: si pudiera, habría dos sitios desde los
 * que dar por pagada una cuota y ninguno sabría del otro. Lo que operaciones necesita es VER la cola
 * entera —de todos los comercios— para llamar al que se está durmiendo.
 *
 * Es una consulta y no un recorrido de repositorios porque junta cinco tablas por página: hacerlo
 * con `findAll` por fila serían cinco viajes por aviso.
 */
@Injectable()
export class OperationsPaymentClaimsService {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  async list(tenantId: string, query: OperationsClaimsQueryDto, now: Date = new Date()) {
    const bind: Record<string, unknown> = { tenantId, pendiente: PENDIENTE };
    const filtros: string[] = [];
    if (query.status) {
      bind.status = query.status;
      filtros.push('c.status = $status');
    }
    if (query.partnerId) {
      bind.partnerId = query.partnerId;
      filtros.push('c.partner_profile_id = $partnerId');
    }
    if (query.customerId) {
      bind.customerId = query.customerId;
      filtros.push('c.customer_id = $customerId');
    }
    if (query.olderThanHours) {
      bind.olderThan = new Date(now.getTime() - query.olderThanHours * HORA_MS);
      filtros.push('c.submitted_at < $olderThan');
    }
    if (query.q) {
      bind.q = containsLikePattern(query.q.trim());
      filtros.push('(c.claim_code ILIKE $q OR cu.customer_code ILIKE $q OR p.trade_name ILIKE $q OR p.legal_name ILIKE $q)');
    }
    const where = ['c._tenant_id = $tenantId', 'c._deleted = false', ...filtros].join(' AND ');

    const [filas, totales, resumen] = await Promise.all([
      this.sequelize.query<FilaDeAviso>(this.sqlPagina(where), {
        type: QueryTypes.SELECT,
        bind: { ...bind, limit: query.pageSize, offset: (query.page - 1) * query.pageSize },
      }),
      this.sequelize.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total FROM ${tabla('loan_payment_claims')} c ${JOINS_BUSCABLES} WHERE ${where}`,
        {
          type: QueryTypes.SELECT,
          bind,
        },
      ),
      this.sequelize.query<{ pending: string; stale: string }>(
        `SELECT COUNT(*) FILTER (WHERE c.status = $pendiente)::text AS pending,
                COUNT(*) FILTER (WHERE c.status = $pendiente AND c.submitted_at < $staleCutoff)::text AS stale
           FROM ${tabla('loan_payment_claims')} c
          WHERE c._tenant_id = $tenantId AND c._deleted = false`,
        {
          type: QueryTypes.SELECT,
          bind: { tenantId, pendiente: PENDIENTE, staleCutoff: new Date(now.getTime() - PAYMENT_CLAIM_STALE_AFTER_HOURS * HORA_MS) },
        },
      ),
    ]);

    const total = Number(totales[0]?.total ?? 0);
    return {
      items: filas.map((fila) => supervisar(fila, now)),
      meta: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) },
      // El resumen es de TODA la cola del tenant, no de la página filtrada: es el número que dice
      // si hay que ir a mirar, y no debe cambiar porque alguien haya filtrado por un comercio.
      summary: {
        pending: Number(resumen[0]?.pending ?? 0),
        stalePending: Number(resumen[0]?.stale ?? 0),
        staleAfterHours: PAYMENT_CLAIM_STALE_AFTER_HOURS,
      },
    };
  }

  /** Pendientes primero y, entre ellos, el más antiguo arriba; lo ya decidido, lo más reciente arriba. */
  private sqlPagina(where: string): string {
    return `
      SELECT c._id::text AS "claimId", c.claim_code AS "claimCode", c.status,
             c.claimed_amount::text AS "claimedAmount", c.currency_code AS "currencyCode",
             c.payer_reference AS "payerReference", (c.proof_evidence_id IS NOT NULL) AS "hasProof",
             c.submitted_at AS "submittedAt", c.decided_at AS "decidedAt", c.rejection_reason AS "rejectionReason",
             c.loan_id::text AS "loanId", l.loan_code AS "loanCode",
             c.installment_id::text AS "installmentId", i.installment_number AS "installmentNumber",
             i.due_date::text AS "installmentDueDate",
             c.customer_id::text AS "customerId", cu.customer_code AS "customerCode",
             NULLIF(TRIM(CONCAT_WS(' ', pv.first_name, pv.last_name)), '') AS "customerName",
             c.partner_profile_id::text AS "partnerId", COALESCE(p.trade_name, p.legal_name) AS "partnerName"
        FROM ${tabla('loan_payment_claims')} c
        LEFT JOIN ${tabla('loans')} l ON l._id = c.loan_id AND l._tenant_id = c._tenant_id
        LEFT JOIN ${tabla('loan_installments')} i ON i._id = c.installment_id AND i._tenant_id = c._tenant_id
        ${JOINS_BUSCABLES}
        LEFT JOIN ${tabla('customer_profile_versions')} pv ON pv._id = cu.current_profile_version_id AND pv._tenant_id = c._tenant_id
       WHERE ${where}
       ORDER BY (c.status = $pendiente) DESC,
                CASE WHEN c.status = $pendiente THEN c.submitted_at END ASC,
                c.submitted_at DESC, c._id DESC
       LIMIT $limit OFFSET $offset`;
  }
}

function iso(valor: Date | string): string {
  return valor instanceof Date ? valor.toISOString() : new Date(valor).toISOString();
}

/** La edad se calcula aquí y no en SQL para que «ahora» sea el mismo en la página y en el resumen. */
export function supervisar(fila: FilaDeAviso, now: Date): AvisoSupervisado {
  const enviado = new Date(fila.submittedAt).getTime();
  const hasta = fila.decidedAt ? new Date(fila.decidedAt).getTime() : now.getTime();
  const ageHours = Math.max(0, Math.floor((hasta - enviado) / HORA_MS));
  return {
    ...fila,
    submittedAt: iso(fila.submittedAt),
    decidedAt: fila.decidedAt ? iso(fila.decidedAt) : null,
    ageHours,
    stale: fila.status === PENDIENTE && ageHours >= PAYMENT_CLAIM_STALE_AFTER_HOURS,
  };
}
