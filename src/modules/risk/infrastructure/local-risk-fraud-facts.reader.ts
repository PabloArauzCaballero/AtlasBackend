/**
 * @file Lee de la base los hechos de fraude de un alta: dispositivo, red, ritmo y agenda.
 * @business Todo esto ya se guardaba —la IP y el dispositivo de cada sesión, los snapshots, el rastro, la bitácora, la
 *   agenda— y la evaluación de riesgo no lo miraba: con carnet y teléfono verificado el alta seguía sola.
 * @system seis lecturas acotadas e independientes; cada una falla en blando. El criterio vive en `risk-fraud-flags.ts`.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, type FindOptions } from 'sequelize';

import {
  CustomerDeviceContactModel,
  CustomerDeviceLinkModel,
  CustomerLocationPingModel,
  CustomerSessionModel,
  DeviceSnapshotModel,
  OnboardingBehaviorSummaryModel,
} from '../../../database/models/index.js';
import { calcularFormaDeLaAgenda } from '../../../common/utils/contact/contact-book-shape.util.js';
import { SIN_HECHOS_DE_FRAUDE, type RiskFraudFacts } from '../application/risk-fraud-flags.js';

const DIA_MS = 86_400_000;
/** Ventana de sesiones que cuentan como «el alta»: un alta que dura más de dos semanas ya se retomó varias veces. */
const VENTANA_DEL_ALTA_DIAS = 14;
const TOPE = 2_000;

/**
 * Una IP que no identifica a nadie: privada, de enlace local o de bucle. Detrás de un proxy mal configurado TODAS las
 * sesiones llegan con la misma, y contarla convertiría a cada cliente en «ráfaga desde la misma IP».
 */
export function esIpSinValor(ip: string | null | undefined): boolean {
  if (!ip) return true;
  const valor = ip
    .trim()
    .toLowerCase()
    .replace(/^::ffff:/u, '');
  if (valor === '' || valor === '::1' || valor === 'localhost' || valor === 'unknown') return true;
  if (/^(10\.|127\.|192\.168\.|169\.254\.)/u.test(valor)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./u.test(valor)) return true;
  // CGNAT (100.64.0.0/10) y Tailscale comparten rango: tampoco distinguen a una persona.
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./u.test(valor)) return true;
  return /^(fc|fd|fe80)/u.test(valor);
}

@Injectable()
export class LocalRiskFraudFactsReader {
  private readonly logger = new Logger(LocalRiskFraudFactsReader.name);

  constructor(
    @InjectModel(CustomerSessionModel) private readonly sessions: typeof CustomerSessionModel,
    @InjectModel(CustomerDeviceLinkModel) private readonly links: typeof CustomerDeviceLinkModel,
    @InjectModel(DeviceSnapshotModel) private readonly snapshots: typeof DeviceSnapshotModel,
    @InjectModel(CustomerLocationPingModel) private readonly pings: typeof CustomerLocationPingModel,
    @InjectModel(OnboardingBehaviorSummaryModel) private readonly behavior: typeof OnboardingBehaviorSummaryModel,
    @InjectModel(CustomerDeviceContactModel) private readonly contacts: typeof CustomerDeviceContactModel,
  ) {}

  /** Los hechos de un cliente. Cada lectura que falla deja su parte en «no se sabe», sin tumbar la evaluación. */
  async read(tenantId: string, customerId: string, now: Date = new Date()): Promise<RiskFraudFacts> {
    const seguro = async <T>(nombre: string, lectura: () => Promise<T>, porDefecto: T): Promise<T> => {
      try {
        return await lectura();
      } catch (error: unknown) {
        this.logger.warn(`Hechos de fraude (${nombre}) no legibles para el cliente ${customerId}: ${(error as Error).message}`);
        return porDefecto;
      }
    };
    const [red, dispositivo, mockedLocationPings, comportamiento, contactSignals] = await Promise.all([
      seguro('red', () => this.red(tenantId, customerId, now), { sameIpCustomers24h: 0, sessionDevices: 0 }),
      seguro('dispositivo', () => this.dispositivo(tenantId, customerId), { emulator: null, rooted: null, sharedDeviceCustomers: 0 }),
      seguro('ubicación', () => this.pings.count({ where: { tenantId, customerId, isMocked: true } } as FindOptions), 0),
      seguro('comportamiento', () => this.comportamiento(tenantId, customerId), { botScore: null, rhythmSignals: [] as string[] }),
      seguro('agenda', () => this.agenda(tenantId, customerId, now), [] as string[]),
    ]);
    return {
      ...SIN_HECHOS_DE_FRAUDE,
      ...red,
      ...dispositivo,
      mockedLocationPings: Number(mockedLocationPings),
      ...comportamiento,
      contactSignals,
    };
  }

  /** La red y los dispositivos de las sesiones del alta: con qué IP y con qué teléfono inició sesión de verdad. */
  private async red(
    tenantId: string,
    customerId: string,
    now: Date,
  ): Promise<Pick<RiskFraudFacts, 'sameIpCustomers24h' | 'sessionDevices'>> {
    const propias = await this.sessions.findAll({
      where: { tenantId, customerId, startedAt: { [Op.gte]: new Date(now.getTime() - VENTANA_DEL_ALTA_DIAS * DIA_MS) } },
      attributes: ['ipAddress', 'deviceId', 'startedAt'],
      limit: TOPE,
    } as FindOptions);
    const sessionDevices = new Set(propias.map((s) => s.deviceId).filter((id): id is string => Boolean(id))).size;
    const hace24h = new Date(now.getTime() - DIA_MS);
    const ips = [
      ...new Set(
        propias
          .filter((s) => s.startedAt !== null && s.startedAt >= hace24h)
          .map((s) => s.ipAddress)
          .filter((ip): ip is string => !esIpSinValor(ip)),
      ),
    ];
    if (ips.length === 0) return { sameIpCustomers24h: 0, sessionDevices };
    const otros: unknown = await this.sessions.count({
      where: {
        tenantId,
        ipAddress: { [Op.in]: ips },
        customerId: { [Op.and]: [{ [Op.ne]: customerId }, { [Op.ne]: null }] },
        startedAt: { [Op.gte]: hace24h },
      },
      distinct: true,
      col: 'customer_id',
    } as FindOptions);
    return { sameIpCustomers24h: Number(otros), sessionDevices };
  }

  private async dispositivo(
    tenantId: string,
    customerId: string,
  ): Promise<Pick<RiskFraudFacts, 'emulator' | 'rooted' | 'sharedDeviceCustomers'>> {
    const [snapshots, propios] = await Promise.all([
      this.snapshots.findAll({
        where: { tenantId, customerId },
        attributes: ['isRooted', 'isEmulator'],
        order: [['capturedAt', 'DESC']],
        limit: 20,
      } as FindOptions),
      this.links.findAll({ where: { tenantId, customerId, deleted: { [Op.ne]: true } }, attributes: ['deviceId'] } as FindOptions),
    ]);
    const deviceIds = [...new Set(propios.map((l) => l.deviceId).filter((id): id is string => Boolean(id)))];
    const compartidos: unknown =
      deviceIds.length === 0
        ? 0
        : await this.links.count({
            where: {
              tenantId,
              deviceId: { [Op.in]: deviceIds },
              customerId: { [Op.and]: [{ [Op.ne]: customerId }, { [Op.ne]: null }] },
              deleted: { [Op.ne]: true },
            },
            distinct: true,
            col: 'customer_id',
          } as FindOptions);
    const conDato = (clave: 'isRooted' | 'isEmulator') => snapshots.filter((s) => s[clave] !== null);
    return {
      emulator: conDato('isEmulator').length === 0 ? null : snapshots.some((s) => s.isEmulator === true),
      rooted: conDato('isRooted').length === 0 ? null : snapshots.some((s) => s.isRooted === true),
      sharedDeviceCustomers: Number(compartidos),
    };
  }

  private async comportamiento(tenantId: string, customerId: string): Promise<Pick<RiskFraudFacts, 'botScore' | 'rhythmSignals'>> {
    const fila = await this.behavior.findOne({
      where: { tenantId, customerId },
      attributes: ['botLikelihoodScore', 'interScreenTimingJson'],
      order: [['computedAt', 'DESC']],
    } as FindOptions);
    if (!fila) return { botScore: null, rhythmSignals: [] };
    const bot = fila.botLikelihoodScore === null ? null : Number(fila.botLikelihoodScore);
    const detalle = (fila.interScreenTimingJson as { detalle?: { ritmo?: { senales?: unknown } } } | null)?.detalle;
    const senales = Array.isArray(detalle?.ritmo?.senales) ? detalle.ritmo.senales.filter((s): s is string => typeof s === 'string') : [];
    return { botScore: bot !== null && Number.isFinite(bot) ? bot : null, rhythmSignals: senales };
  }

  /** La forma de la agenda guardada. Sin agenda no hay señales: no compartirla no cuenta en contra. */
  private async agenda(tenantId: string, customerId: string, now: Date): Promise<string[]> {
    const filas = await this.contacts.findAll({
      where: { tenantId, customerId, deleted: { [Op.ne]: true } },
      attributes: ['phoneHashes', 'emailCount', 'isFavorite', 'birthday', 'contactType', 'createdAtValue'],
      limit: 10_000,
    } as FindOptions);
    if (filas.length === 0) return [];
    return calcularFormaDeLaAgenda(
      filas.map((f) => ({
        phoneHashes: f.phoneHashes ?? [],
        emailCount: f.emailCount ?? 0,
        isFavorite: f.isFavorite === true,
        hasBirthday: f.birthday !== null,
        isCompany: f.contactType === 'company',
        firstSeenAt: f.createdAtValue,
      })),
      now,
    ).senales;
  }
}
