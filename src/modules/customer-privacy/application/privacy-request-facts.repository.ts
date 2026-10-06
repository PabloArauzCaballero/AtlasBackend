/**
 * @file Repositorio de lectura: los hechos de la cuenta con los que se decide una solicitud del titular.
 * @business Deuda, procesos abiertos y señales de cuenta robada, contados en el momento de decidir.
 * @system una sola consulta sobre clientes, contactos, sesiones, fraude, soporte, préstamos, pagos, extractos y solicitudes.
 */
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { atlasSchemaFor } from '../../../database/domain-schemas.js';
import {
  isIdentityVerified,
  IDENTITY_ATTEMPT_LOOKBACK_LIMIT,
  pickCurrentIdentityAttempt,
} from '../../../common/utils/identity/identity-result.util.js';
import type { HechosDeLaCuenta } from './privacy-request-features.js';

const t = (tabla: string) => `${atlasSchemaFor(tabla)}.${tabla}`;

/**
 * «Igual en curso» sólo cuenta las ANTERIORES (`_id <`): con `<>`, dos solicitudes creadas a la vez (un doble toque) se
 * veían la una a la otra y las dos salían rechazadas por «ya hay una en curso». Así sólo la posterior se rechaza.
 */

/** Los mismos que `underwriting-signals.service.ts` cuenta como fraude abierto. */
const FRAUDE_ABIERTO = ['open', 'in_review', 'pending', 'escalated'];
/** Un caso de soporte cerrado ya no retiene nada; cualquier otro estado sí. */
const SOPORTE_CERRADO = ['RESOLVED', 'CLOSED', 'DUPLICATE', 'CANCELLED'];
/** Un préstamo castigado sigue siendo deuda: se cuenta en el saldo aunque ya no esté activo. */
const PRESTAMO_CON_SALDO = ['active', 'pending_disbursement', 'written_off'];
const PRESTAMO_OTORGADO = ['active', 'paid_off', 'written_off'];

const DIA_MS = 86_400_000;

type Fila = {
  lifecycle_status: string | null;
  contacto_cambiado: boolean;
  dispositivo_nuevo: boolean;
  fraude_abierto: boolean;
  caso_abierto: boolean;
  iguales_abiertas: number;
  saldo: string | number;
  prestamos_activos: number;
  cuotas_en_mora: number;
  pagos_en_conciliacion: number;
  tuvo_credito: boolean;
  extracto_en_revision: boolean;
  evidencia_identidad: boolean;
  cambios_del_campo: number;
};

/**
 * Todo en una ida a la base. Dos ventanas que no son obvias:
 *
 * - **Contacto nuevo** sólo cuenta si la cuenta ya existía hace una semana: en un alta reciente todos los contactos son
 *   «nuevos» y eso no dice nada de un robo.
 * - **Dispositivo nuevo** es uno que la persona usó por primera vez en los últimos 7 días **habiendo usado antes
 *   otro**. Por la misma razón: el primer teléfono de una cuenta no es una señal.
 */
const SQL_HECHOS = `
SELECT
  c.lifecycle_status,
  (c._created_at < :hace7 AND EXISTS (
     SELECT 1 FROM ${t('customer_contact_methods')} cm
      WHERE cm._tenant_id = c._tenant_id AND cm.customer_id = c._id AND cm._created_at >= :hace7 AND cm._deleted = FALSE
  )) AS contacto_cambiado,
  (EXISTS (
     SELECT 1 FROM ${t('customer_sessions')} s
      WHERE s._tenant_id = c._tenant_id AND s.customer_id = c._id AND s.started_at >= :hace7 AND s.device_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM ${t('customer_sessions')} s2
           WHERE s2._tenant_id = s._tenant_id AND s2.customer_id = s.customer_id AND s2.device_id = s.device_id AND s2.started_at < :hace7)
   ) AND EXISTS (
     SELECT 1 FROM ${t('customer_sessions')} s3
      WHERE s3._tenant_id = c._tenant_id AND s3.customer_id = c._id AND s3.started_at < :hace7
  )) AS dispositivo_nuevo,
  EXISTS (
    SELECT 1 FROM ${t('fraud_cases')} f
     WHERE f._tenant_id = c._tenant_id AND f.customer_id = c._id AND f.closed_at IS NULL
       AND f.case_status IN (:fraudeAbierto) AND f._deleted = FALSE
  ) AS fraude_abierto,
  EXISTS (
    SELECT 1 FROM ${t('support_cases')} sc
     WHERE sc._tenant_id = c._tenant_id AND sc.subject_customer_id = c._id
       AND sc.status NOT IN (:soporteCerrado) AND sc._deleted = FALSE
  ) AS caso_abierto,
  (SELECT COUNT(*)::int FROM ${t('data_subject_requests')} d
    WHERE d._tenant_id = c._tenant_id AND d.customer_id = c._id AND d.request_type = :requestType
      AND d.status IN ('received', 'in_progress') AND d._id < :requestId AND d._deleted = FALSE) AS iguales_abiertas,
  (SELECT COALESCE(SUM(GREATEST(
            i.principal_amount + i.interest_amount + i.late_fee_amount - i.paid_principal - i.paid_interest - i.paid_late_fee, 0)), 0)
     FROM ${t('loan_installments')} i JOIN ${t('loans')} l ON l._id = i.loan_id AND l._tenant_id = i._tenant_id
    WHERE l._tenant_id = c._tenant_id AND l.customer_id = c._id AND l.status IN (:conSaldo)
      AND l._deleted = FALSE AND i._deleted = FALSE) AS saldo,
  (SELECT COUNT(*)::int FROM ${t('loans')} l
    WHERE l._tenant_id = c._tenant_id AND l.customer_id = c._id AND l.status IN ('active', 'pending_disbursement') AND l._deleted = FALSE) AS prestamos_activos,
  (SELECT COUNT(*)::int
     FROM ${t('loan_installments')} i JOIN ${t('loans')} l ON l._id = i.loan_id AND l._tenant_id = i._tenant_id
    WHERE l._tenant_id = c._tenant_id AND l.customer_id = c._id AND l._deleted = FALSE AND i._deleted = FALSE
      AND (i.status = 'overdue' OR i.days_past_due > 0)) AS cuotas_en_mora,
  (SELECT COUNT(*)::int FROM ${t('loan_payment_claims')} p
    WHERE p._tenant_id = c._tenant_id AND p.customer_id = c._id AND p.status = 'pending_verification' AND p._deleted = FALSE) AS pagos_en_conciliacion,
  EXISTS (
    SELECT 1 FROM ${t('loans')} l
     WHERE l._tenant_id = c._tenant_id AND l.customer_id = c._id AND l.status IN (:otorgado) AND l._deleted = FALSE
  ) AS tuvo_credito,
  EXISTS (
    SELECT 1 FROM ${t('bank_statement_reviews')} b
     WHERE b._tenant_id = c._tenant_id AND b.customer_id = c._id AND b.status IN ('received', 'processing') AND b._deleted = FALSE
  ) AS extracto_en_revision,
  EXISTS (
    SELECT 1 FROM ${t('identity_verification_attempts')} iv
     WHERE iv._tenant_id = c._tenant_id AND iv.customer_id = c._id
  ) AS evidencia_identidad,
  (SELECT COUNT(*)::int FROM ${t('data_subject_requests')} d
    WHERE d._tenant_id = c._tenant_id AND d.customer_id = c._id AND d.request_type = 'rectification'
      AND d.rectification_field IS NOT DISTINCT FROM :campo AND :campo IS NOT NULL
      AND d.status = 'completed' AND d.resolved_at >= :hace365 AND d._deleted = FALSE) AS cambios_del_campo
FROM ${t('customers')} c
WHERE c._tenant_id = :tenantId AND c._id = :customerId AND c._deleted = FALSE
`;

@Injectable()
export class PrivacyRequestFactsRepository {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  /** Los hechos de la cuenta de una solicitud, o `null` si el cliente no existe o está borrado. */
  async hechos(input: {
    tenantId: string;
    customerId: string;
    requestId: string;
    requestType: string;
    rectificationField: string | null;
    now: Date;
  }): Promise<HechosDeLaCuenta | null> {
    const hace7 = new Date(input.now.getTime() - 7 * DIA_MS);
    const hace365 = new Date(input.now.getTime() - 365 * DIA_MS);
    const [fila] = await this.sequelize.query<Fila>(SQL_HECHOS, {
      replacements: {
        tenantId: input.tenantId,
        customerId: input.customerId,
        requestId: input.requestId,
        requestType: input.requestType,
        campo: input.rectificationField,
        hace7,
        hace365,
        fraudeAbierto: FRAUDE_ABIERTO,
        soporteCerrado: SOPORTE_CERRADO,
        conSaldo: PRESTAMO_CON_SALDO,
        otorgado: PRESTAMO_OTORGADO,
      },
      type: QueryTypes.SELECT,
    });
    if (!fila) return null;

    return {
      lifecycleStatus: fila.lifecycle_status,
      identidadVerificada: await this.identidadVerificada(input.tenantId, input.customerId),
      contactoCambiado7d: Boolean(fila.contacto_cambiado),
      dispositivoNuevo7d: Boolean(fila.dispositivo_nuevo),
      fraudeAbierto: Boolean(fila.fraude_abierto),
      casoAbierto: Boolean(fila.caso_abierto),
      solicitudesIgualesAbiertas: Number(fila.iguales_abiertas),
      saldoPendiente: Number(fila.saldo),
      prestamosActivos: Number(fila.prestamos_activos),
      cuotasEnMora: Number(fila.cuotas_en_mora),
      pagosEnConciliacion: Number(fila.pagos_en_conciliacion),
      tuvoCredito: Boolean(fila.tuvo_credito),
      extractoEnRevision: Boolean(fila.extracto_en_revision),
      evidenciaIdentidad: Boolean(fila.evidencia_identidad),
      cambiosDelCampo365d: Number(fila.cambios_del_campo),
    };
  }

  /**
   * Con la misma regla que crédito: el intento terminal más reciente manda, y uno posterior todavía en cola no tapa un
   * `verified` anterior (`pickCurrentIdentityAttempt`).
   */
  private async identidadVerificada(tenantId: string, customerId: string): Promise<boolean> {
    const intentos = await this.sequelize.query<{ finalResult: string | null }>(
      `SELECT final_result AS "finalResult" FROM ${t('identity_verification_attempts')}
        WHERE _tenant_id = :tenantId AND customer_id = :customerId
        ORDER BY _id DESC LIMIT :limite`,
      { replacements: { tenantId, customerId, limite: IDENTITY_ATTEMPT_LOOKBACK_LIMIT }, type: QueryTypes.SELECT },
    );
    return isIdentityVerified(pickCurrentIdentityAttempt(intentos)?.finalResult);
  }
}
