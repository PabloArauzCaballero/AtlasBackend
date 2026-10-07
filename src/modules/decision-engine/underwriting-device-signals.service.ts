/**
 * @file De dónde salen las señales del TELÉFONO con las que el Motor puede decidir un crédito.
 * @business El rastro de ubicación, la agenda, el dispositivo y la bitácora del alta se recogían y sólo los veía una
 *   persona en el expediente. Aquí se leen para que la decisión también los vea (plan F3, H-01/H-13).
 * @system cinco lecturas acotadas; el cálculo es `calcularSeñalesDelTelefono`, puro.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, QueryTypes, type FindOptions } from 'sequelize';

import {
  CustomerConsentModel,
  CustomerDeviceContactModel,
  CustomerDeviceLinkModel,
  CustomerLocationPingModel,
  DeviceSnapshotModel,
  OnboardingBehaviorSummaryModel,
  WatchlistEntryModel,
} from '../../database/models/index.js';
import { env } from '../../config/env.js';
import { ADDRESS_BOOK_PURPOSE, LOCATION_TRACKING_PURPOSE, isConsentInForce } from '../../common/utils/consent/consent-in-force.util.js';
import { calcularFormaDeLaAgenda } from '../../common/utils/contact/contact-book-shape.util.js';
import {
  calcularSeñalesDelTelefono,
  UMBRAL_ANILLO_CONTACTOS,
  VENTANA_PINGS_DIAS,
  type AgendaObservada,
  type SeñalesDelTelefono,
  variablesEnVivo as variablesDe,
} from './device-risk-features.js';

/**
 * Las señales del teléfono y en qué modo viajaron. En `shadow` NO entran en las variables: van al contexto de la
 * ejecución para calibrar sin decidir.
 */
export type SeñalesDelTelefonoConModo = SeñalesDelTelefono & { mode: 'shadow' | 'live' };

/** Las variables que sustituyen a las ausentes del expediente: sólo en `live` y sólo las que tienen materia prima. */
export function variablesEnVivo(señales: SeñalesDelTelefonoConModo | null): [string, unknown][] {
  return señales ? variablesDe(señales, señales.mode) : [];
}

/** Tope de posiciones leídas: 30 días a una cada 15 min son ~2.900; más es ruido de reenvíos. */
const MAX_PINGS = 5_000;
/** Tope de hashes que entran en un `IN`/`&&`: una agenda real rara vez pasa de 3.000 teléfonos. */
const MAX_HASHES = 5_000;

@Injectable()
export class UnderwritingDeviceSignalsService {
  private readonly logger = new Logger(UnderwritingDeviceSignalsService.name);

  constructor(
    @InjectModel(CustomerLocationPingModel) private readonly pings: typeof CustomerLocationPingModel,
    @InjectModel(DeviceSnapshotModel) private readonly snapshots: typeof DeviceSnapshotModel,
    @InjectModel(CustomerDeviceLinkModel) private readonly links: typeof CustomerDeviceLinkModel,
    @InjectModel(OnboardingBehaviorSummaryModel) private readonly behavior: typeof OnboardingBehaviorSummaryModel,
    @InjectModel(CustomerDeviceContactModel) private readonly contacts: typeof CustomerDeviceContactModel,
    @InjectModel(WatchlistEntryModel) private readonly watchlist: typeof WatchlistEntryModel,
    @InjectModel(CustomerConsentModel) private readonly consents: typeof CustomerConsentModel,
  ) {}

  /** Si la ÚLTIMA decisión de esa finalidad es un «sí» sin retirar: sin eso, lo ya guardado no se lee. */
  private async vigente(tenantId: string, customerId: string, purposeCode: string): Promise<boolean> {
    const ultima = await this.consents.findOne({ where: { tenantId, customerId, purposeCode }, order: [['_id', 'DESC']] } as FindOptions);
    return isConsentInForce(ultima);
  }

  /**
   * Las señales del teléfono de un cliente, o `null` si no se pudieron leer.
   *
   * Falla en blando, como el resto de la evidencia: una lectura caída no puede tumbar una solicitud de crédito, y
   * `null` se traduce en variables ausentes, que la política pondera como menos información.
   */
  async signalsFor(tenantId: string, customerId: string, now: Date): Promise<SeñalesDelTelefonoConModo | null> {
    try {
      const desde = new Date(now.getTime() - VENTANA_PINGS_DIAS * 86_400_000);
      const [pings, snapshots, sharedDeviceCustomers, comportamiento, agenda] = await Promise.all([
        this.posiciones(tenantId, customerId, desde, now),
        this.snapshots.findAll({
          where: { tenantId, customerId },
          attributes: ['isRooted', 'isEmulator'],
          order: [['capturedAt', 'DESC']],
          limit: 20,
        } as FindOptions),
        this.sharedDeviceCustomers(tenantId, customerId),
        this.behavior.findOne({
          where: { tenantId, customerId },
          attributes: ['botLikelihoodScore'],
          order: [['computedAt', 'DESC']],
        } as FindOptions),
        this.agenda(tenantId, customerId, now),
      ]);

      const señales = calcularSeñalesDelTelefono({
        pings: pings.map((p) => ({
          capturedAt: p.capturedAt,
          captureMode: p.captureMode,
          isMocked: p.isMocked === true,
          distanceToDeclaredMeters: p.distanceToDeclaredMeters === null ? null : Number(p.distanceToDeclaredMeters),
        })),
        snapshots: snapshots.map((s) => ({ isRooted: s.isRooted, isEmulator: s.isEmulator })),
        sharedDeviceCustomers,
        comportamiento: comportamiento
          ? { botLikelihoodScore: comportamiento.botLikelihoodScore === null ? null : Number(comportamiento.botLikelihoodScore) }
          : null,
        agenda,
      });
      return { ...señales, mode: env.UNDERWRITING_DEVICE_SIGNALS_MODE };
    } catch (error: unknown) {
      this.logger.warn(`No se pudieron leer las señales del teléfono del cliente ${customerId}: ${(error as Error).message}`);
      return null;
    }
  }

  /** El rastro de la ventana, sólo con el consentimiento de ubicación vigente. */
  private async posiciones(tenantId: string, customerId: string, desde: Date, now: Date): Promise<CustomerLocationPingModel[]> {
    if (!(await this.vigente(tenantId, customerId, LOCATION_TRACKING_PURPOSE))) return [];
    return this.pings.findAll({
      where: { tenantId, customerId, capturedAt: { [Op.gte]: desde, [Op.lte]: now } },
      attributes: ['capturedAt', 'captureMode', 'isMocked', 'distanceToDeclaredMeters'],
      order: [['capturedAt', 'DESC']],
      limit: MAX_PINGS,
    } as FindOptions);
  }

  /** Otros clientes vinculados a alguno de los dispositivos de éste. */
  private async sharedDeviceCustomers(tenantId: string, customerId: string): Promise<number> {
    const propios = await this.links.findAll({
      where: { tenantId, customerId, deleted: { [Op.ne]: true } },
      attributes: ['deviceId'],
    } as FindOptions);
    const deviceIds = [...new Set(propios.map((l) => l.deviceId).filter((id): id is string => Boolean(id)))];
    if (deviceIds.length === 0) return 0;
    return this.links.count({
      where: { tenantId, deviceId: { [Op.in]: deviceIds }, customerId: { [Op.ne]: customerId }, deleted: { [Op.ne]: true } },
      distinct: true,
      col: 'customer_id',
    } as FindOptions);
  }

  /**
   * Lo que la agenda guardada permite contar, sin descifrar nada: sólo hashes.
   *
   * El anillo se cuenta en SQL con el índice GIN de `phone_hashes` (`&&` filtra, `unnest` cuenta coincidencias por
   * cliente): traer las agendas de todos al proceso sería leer la PII de terceros de toda la base para contar.
   */
  private async agenda(tenantId: string, customerId: string, now: Date): Promise<AgendaObservada> {
    const sinAgenda: AgendaObservada = { available: false, totalContacts: 0, watchlistMatches: 0, ringCustomers: 0 };
    if (!(await this.vigente(tenantId, customerId, ADDRESS_BOOK_PURPOSE))) return sinAgenda;
    const filas = await this.contacts.findAll({
      where: { tenantId, customerId, deleted: { [Op.ne]: true } },
      attributes: ['phoneHashes', 'emailCount', 'isFavorite', 'birthday', 'contactType', 'createdAtValue'],
    } as FindOptions);
    if (filas.length === 0) return sinAgenda;

    const shape = calcularFormaDeLaAgenda(
      filas.map((f) => ({
        phoneHashes: f.phoneHashes ?? [],
        emailCount: f.emailCount ?? 0,
        isFavorite: f.isFavorite === true,
        hasBirthday: f.birthday !== null && f.birthday !== undefined,
        isCompany: f.contactType === 'company',
        firstSeenAt: f.createdAtValue ?? now,
      })),
      now,
    );
    const hashes = [...new Set(filas.flatMap((f) => f.phoneHashes ?? []))].slice(0, MAX_HASHES);
    if (hashes.length === 0) return { available: true, totalContacts: filas.length, watchlistMatches: 0, ringCustomers: 0, shape };

    const tabla = this.contacts.getTableName() as unknown as { schema?: string; tableName: string } | string;
    const nombre = typeof tabla === 'string' ? `"${tabla}"` : `${tabla.schema ? `"${tabla.schema}".` : ''}"${tabla.tableName}"`;
    const [watchlistMatches, anillo] = await Promise.all([
      this.watchlist.count({
        where: {
          tenantId,
          entityType: { [Op.in]: ['phone', 'msisdn', 'phone_number'] },
          entityHash: { [Op.in]: hashes },
          status: { [Op.in]: ['active', 'confirmed'] },
          deleted: { [Op.ne]: true },
        },
      } as FindOptions),
      this.contacts.sequelize!.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM (
           SELECT c.customer_id
             FROM ${nombre} c, unnest(c.phone_hashes) AS h
            WHERE c._tenant_id = :tenantId AND c.customer_id <> :customerId AND c._deleted IS NOT TRUE
              AND c.phone_hashes && CAST(ARRAY[:hashes] AS text[]) AND h = ANY(CAST(ARRAY[:hashes] AS text[]))
            GROUP BY c.customer_id
           HAVING count(DISTINCT h) >= :umbral
         ) anillo`,
        { replacements: { tenantId, customerId, hashes, umbral: UMBRAL_ANILLO_CONTACTOS }, type: QueryTypes.SELECT },
      ),
    ]);
    return { available: true, totalContacts: filas.length, watchlistMatches, ringCustomers: Number(anillo[0]?.n ?? 0), shape };
  }
}
