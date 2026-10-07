/**
 * @file De dónde salen las señales de FRAUDE que Atlas ya tiene en sus propios registros.
 * @business La lista negra, los casos de fraude, los dispositivos y las IP que Atlas conoce llegaban al Motor como «ausente»:
 *   nadie los leía. Aquí se consultan, para que «teléfono de fraude conocido» sea un cotejo hecho y no una variable vacía.
 * @system consultas acotadas por cliente; el cálculo del veredicto es `trust-signals.ts`, puro.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, QueryTypes, type FindOptions } from 'sequelize';

import { CustomerDeviceLinkModel, CustomerModel, FraudCaseModel, WatchlistEntryModel } from '../../database/models/index.js';
import { atlasSchemaFor } from '../../database/domain-schemas.js';
import { calcularSeñalesDeConfianza, VENTANA_IP_DIAS, type SeñalesDeConfianza } from './trust-signals.js';

const tabla = (nombre: string) => `"${atlasSchemaFor(nombre)}"."${nombre}"`;

/** Resoluciones de un caso de fraude que NO prueban nada contra la persona. */
const RESOLUCIONES_SIN_CULPA = ['false_positive', 'needs_more_investigation'];

@Injectable()
export class UnderwritingTrustSignalsService {
  private readonly logger = new Logger(UnderwritingTrustSignalsService.name);

  constructor(
    @InjectModel(CustomerModel) private readonly customers: typeof CustomerModel,
    @InjectModel(WatchlistEntryModel) private readonly watchlist: typeof WatchlistEntryModel,
    @InjectModel(FraudCaseModel) private readonly fraudCases: typeof FraudCaseModel,
    @InjectModel(CustomerDeviceLinkModel) private readonly links: typeof CustomerDeviceLinkModel,
  ) {}

  /**
   * Las señales de confianza de un cliente, o `null` si no se pudieron leer.
   *
   * Falla en blando, como el resto de la evidencia: una lectura caída no puede tumbar una solicitud, y `null` se traduce
   * en variables ausentes, nunca en «limpio».
   */
  async signalsFor(tenantId: string, customerId: string, now: Date): Promise<SeñalesDeConfianza | null> {
    try {
      const customer = await this.customers.findOne({
        where: { tenantId, id: customerId },
        attributes: ['primaryPhoneHash', 'primaryEmailHash'],
      } as unknown as FindOptions);
      const [phoneListed, emailListed, previousFraudCases, devices, ipObservations] = await Promise.all([
        this.listed(tenantId, 'phone', customer?.primaryPhoneHash ?? null, now),
        this.listed(tenantId, 'email', customer?.primaryEmailHash ?? null, now),
        this.fraudCases.count({
          where: {
            tenantId,
            customerId,
            closedAt: { [Op.ne]: null },
            deleted: { [Op.ne]: true },
            [Op.or]: [{ resolution: null }, { resolution: { [Op.notIn]: RESOLUCIONES_SIN_CULPA } }],
          },
        } as FindOptions),
        this.deviceReads(tenantId, customerId),
        this.ipRows(tenantId, customerId, now),
      ]);

      return calcularSeñalesDeConfianza({
        phone: { checkable: Boolean(customer?.primaryPhoneHash), listed: phoneListed },
        email: { checkable: Boolean(customer?.primaryEmailHash), listed: emailListed },
        previousFraudCases,
        devices,
        ipObservations,
      });
    } catch (error: unknown) {
      this.logger.warn(`No se pudieron leer las señales de confianza del cliente ${customerId}: ${(error as Error).message}`);
      return null;
    }
  }

  /** ¿El hash está en una lista negra VIGENTE? Los mismos filtros que el cotejo de cumplimiento del alta. */
  private async listed(tenantId: string, entityType: 'phone' | 'email', hash: string | null, now: Date): Promise<boolean> {
    if (!hash) return false;
    const count = await this.watchlist.count({
      where: {
        entityType,
        entityHash: hash,
        deleted: { [Op.ne]: true },
        status: 'active',
        [Op.and]: [{ [Op.or]: [{ tenantId: null }, { tenantId }] }, { [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: now } }] }],
      },
    } as FindOptions);
    return count > 0;
  }

  /** Los dispositivos del cliente, con su estado de riesgo local y global, y si algún otro cliente de ellos tiene fraude confirmado. */
  private async deviceReads(tenantId: string, customerId: string) {
    const own = await this.links.findAll({
      where: { tenantId, customerId, linkStatus: 'active', deviceId: { [Op.ne]: null }, deleted: { [Op.ne]: true } },
      attributes: ['deviceId'],
    } as FindOptions);
    const ids = [...new Set(own.map((link) => link.deviceId).filter((id): id is string => Boolean(id)))];
    if (ids.length === 0) return [];

    const [devices, others] = await Promise.all([
      this.sql<{ id: string; risk_status: string | null; global_risk_status: string | null }>(
        `SELECT d._id::text AS id, d.risk_status, g.global_risk_status
           FROM ${tabla('devices')} d LEFT JOIN ${tabla('global_device_fingerprints')} g ON g._id = d.global_device_fingerprint_id
          WHERE d._tenant_id = :tenantId AND d._id IN (:ids) AND d._deleted IS NOT TRUE`,
        { tenantId, ids },
      ),
      this.links.findAll({
        where: { tenantId, deviceId: { [Op.in]: ids }, customerId: { [Op.ne]: customerId }, deleted: { [Op.ne]: true } },
        attributes: ['deviceId', 'customerId'],
      } as FindOptions),
    ]);
    const otherCustomers = [...new Set(others.map((link) => link.customerId).filter((id): id is string => Boolean(id)))];
    const fraudulent =
      otherCustomers.length === 0
        ? []
        : await this.fraudCases.findAll({
            where: {
              tenantId,
              customerId: { [Op.in]: otherCustomers },
              closedAt: { [Op.ne]: null },
              deleted: { [Op.ne]: true },
              resolution: { [Op.in]: ['confirmed_fraud', 'blocked'] },
            },
            attributes: ['customerId'],
          } as FindOptions);
    const fraudulentCustomers = new Set(fraudulent.map((c) => String(c.customerId)));
    return devices.map((device) => ({
      riskStatus: device.risk_status,
      globalRiskStatus: device.global_risk_status,
      sharedWithFraudster: others.some((link) => String(link.deviceId) === device.id && fraudulentCustomers.has(String(link.customerId))),
    }));
  }

  /** Las observaciones de IP de la ventana. SQL directo: son tablas de telemetría que este módulo sólo LEE, no registra. */
  private async ipRows(tenantId: string, customerId: string, now: Date) {
    const rows = await this.sql<{
      is_vpn: boolean | null;
      is_proxy: boolean | null;
      is_tor: boolean | null;
      reputation_score: string | null;
    }>(
      `SELECT is_vpn, is_proxy, is_tor, reputation_score FROM ${tabla('ip_reputation_observations')}
        WHERE _tenant_id = :tenantId AND customer_id = :customerId AND captured_at >= :desde LIMIT 200`,
      { tenantId, customerId, desde: new Date(now.getTime() - VENTANA_IP_DIAS * 86_400_000) },
    );
    return rows.map((o) => ({
      isVpn: o.is_vpn === true,
      isProxy: o.is_proxy === true,
      isTor: o.is_tor === true,
      reputationScore: o.reputation_score === null ? null : Number(o.reputation_score),
    }));
  }

  private sql<T extends object>(query: string, replacements: Record<string, unknown>): Promise<T[]> {
    return this.links.sequelize!.query<T>(query, { replacements, type: QueryTypes.SELECT });
  }
}
