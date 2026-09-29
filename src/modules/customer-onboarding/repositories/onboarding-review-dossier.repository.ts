/**
 * @file Puerto de persistencia: lee lo que el teléfono y el alta dejaron guardado de un cliente.
 * @business El analista del caso de identidad tiene que ver todo lo que Atlas guardó del alta, en un solo sitio.
 * @system sólo lectura, acotada por inquilino y cliente: intentos de identidad, dispositivo, permisos, consentimientos, pings, agenda, evidencias y extracto.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op } from 'sequelize';
import {
  BankStatementReviewModel,
  CustomerConsentModel,
  CustomerContactMethodModel,
  CustomerDeviceContactModel,
  CustomerDeviceLinkModel,
  CustomerIdentityDocumentModel,
  CustomerLocationPingModel,
  DeviceModel,
  DeviceSnapshotModel,
  EvidenceDocumentModel,
  IdentityVerificationAttemptModel,
  OnboardingFlowModel,
  OnboardingStepEventModel,
  PermissionEventModel,
} from '../../../database/models/index.js';
import { IDENTITY_ATTEMPT_LOOKBACK_LIMIT } from '../../../common/utils/identity/identity-result.util.js';

/** Tope de pings que se resumen. Un rastreo de semanas no cabe en un caso; los últimos sí. */
const PINGS_MAXIMOS = 2_000;
const EVENTOS_MAXIMOS = 200;

@Injectable()
export class OnboardingReviewDossierRepository {
  constructor(
    @InjectModel(OnboardingFlowModel) private readonly flows: typeof OnboardingFlowModel,
    @InjectModel(OnboardingStepEventModel) private readonly stepEvents: typeof OnboardingStepEventModel,
    @InjectModel(CustomerIdentityDocumentModel) private readonly documents: typeof CustomerIdentityDocumentModel,
    @InjectModel(CustomerContactMethodModel) private readonly contactMethods: typeof CustomerContactMethodModel,
    @InjectModel(IdentityVerificationAttemptModel) private readonly attempts: typeof IdentityVerificationAttemptModel,
    @InjectModel(BankStatementReviewModel) private readonly statements: typeof BankStatementReviewModel,
    @InjectModel(CustomerDeviceLinkModel) private readonly deviceLinks: typeof CustomerDeviceLinkModel,
    @InjectModel(DeviceModel) private readonly devices: typeof DeviceModel,
    @InjectModel(DeviceSnapshotModel) private readonly snapshots: typeof DeviceSnapshotModel,
    @InjectModel(PermissionEventModel) private readonly permissions: typeof PermissionEventModel,
    @InjectModel(CustomerConsentModel) private readonly consents: typeof CustomerConsentModel,
    @InjectModel(CustomerLocationPingModel) private readonly pings: typeof CustomerLocationPingModel,
    @InjectModel(CustomerDeviceContactModel) private readonly deviceContacts: typeof CustomerDeviceContactModel,
    @InjectModel(EvidenceDocumentModel) private readonly evidence: typeof EvidenceDocumentModel,
  ) {}

  findLatestFlow(tenantId: string, customerId: string): Promise<OnboardingFlowModel | null> {
    return this.flows.findOne({ where: { tenantId, customerId }, order: [['id', 'DESC']] } as FindOptions);
  }

  findCurrentIdentityDocument(tenantId: string, customerId: string): Promise<CustomerIdentityDocumentModel | null> {
    return this.documents.findOne({ where: { tenantId, customerId, validUntil: null }, order: [['id', 'DESC']] } as FindOptions);
  }

  findContactMethods(tenantId: string, customerId: string): Promise<CustomerContactMethodModel[]> {
    return this.contactMethods.findAll({
      where: { tenantId, customerId, deleted: { [Op.ne]: true } },
      order: [
        ['isPrimary', 'DESC'],
        ['id', 'DESC'],
      ],
    } as FindOptions);
  }

  /** Los intentos recientes de los DOS canales, del más nuevo al más viejo. */
  findRecentAttempts(tenantId: string, customerId: string): Promise<IdentityVerificationAttemptModel[]> {
    return this.attempts.findAll({
      where: { tenantId, customerId },
      order: [['id', 'DESC']],
      limit: IDENTITY_ATTEMPT_LOOKBACK_LIMIT,
    } as FindOptions);
  }

  findLatestBankStatement(tenantId: string, customerId: string): Promise<BankStatementReviewModel | null> {
    return this.statements.findOne({
      where: { tenantId, customerId, deleted: { [Op.ne]: true } },
      order: [['id', 'DESC']],
    } as FindOptions);
  }

  /**
   * El dispositivo del alta: el vínculo activo visto más recientemente, su huella y su última foto
   * de características. Y cuántos OTROS clientes del inquilino están vinculados al mismo aparato.
   */
  async findDevice(tenantId: string, customerId: string) {
    const link = await this.deviceLinks.findOne({
      where: { tenantId, customerId, deviceId: { [Op.ne]: null }, deleted: { [Op.ne]: true } },
      order: [
        ['lastSeenAt', 'DESC'],
        ['id', 'DESC'],
      ],
    } as FindOptions);
    if (!link?.deviceId) return null;
    const [device, snapshot, otros] = await Promise.all([
      this.devices.findOne({ where: { tenantId, id: link.deviceId } } as FindOptions),
      this.snapshots.findOne({ where: { tenantId, deviceId: link.deviceId }, order: [['id', 'DESC']] } as FindOptions),
      this.deviceLinks.count({
        where: { tenantId, deviceId: link.deviceId, customerId: { [Op.ne]: customerId }, deleted: { [Op.ne]: true } },
        distinct: true,
        col: 'customerId',
      } as never),
    ]);
    return { link, device, snapshot, otrosClientes: Number(otros) || 0 };
  }

  findPermissionEvents(tenantId: string, customerId: string): Promise<PermissionEventModel[]> {
    return this.permissions.findAll({
      where: { tenantId, customerId },
      order: [['id', 'DESC']],
      limit: EVENTOS_MAXIMOS,
    } as FindOptions);
  }

  findConsents(tenantId: string, customerId: string): Promise<CustomerConsentModel[]> {
    return this.consents.findAll({
      where: { tenantId, customerId },
      order: [['id', 'DESC']],
      limit: EVENTOS_MAXIMOS,
    } as FindOptions);
  }

  /** Los últimos pings, devueltos del más viejo al más nuevo. */
  async findPings(tenantId: string, customerId: string): Promise<CustomerLocationPingModel[]> {
    const filas = await this.pings.findAll({
      where: { tenantId, customerId },
      attributes: ['id', 'captureMode', 'isMocked', 'capturedAt', 'gpsLat', 'gpsLng', 'distanceToDeclaredMeters'],
      order: [['capturedAt', 'DESC']],
      limit: PINGS_MAXIMOS,
    } as FindOptions);
    return filas.reverse();
  }

  countSyncedContacts(tenantId: string, customerId: string): Promise<number> {
    return this.deviceContacts.count({ where: { tenantId, customerId, deleted: { [Op.ne]: true } } } as FindOptions);
  }

  /** El alcance del último volcado de la agenda (`all` | `limited` en iOS 18), si lo hubo. */
  async findAddressBookScope(tenantId: string, customerId: string): Promise<string | null> {
    const flows = await this.flows.findAll({ where: { tenantId, customerId }, attributes: ['id'] } as FindOptions);
    if (flows.length === 0) return null;
    const evento = await this.stepEvents.findOne({
      where: { tenantId, onboardingFlowId: { [Op.in]: flows.map((flow) => String(flow.id)) }, stepCode: 'address_book_synced' },
      order: [['id', 'DESC']],
    } as FindOptions);
    const alcance = (evento?.payloadJson as { accessScope?: unknown } | null | undefined)?.accessScope;
    return typeof alcance === 'string' ? alcance : null;
  }

  findEvidence(tenantId: string, customerId: string): Promise<EvidenceDocumentModel[]> {
    return this.evidence.findAll({
      where: { tenantId, customerId, deleted: { [Op.ne]: true } },
      attributes: ['id', 'documentType', 'uploadedAt'],
      order: [['id', 'ASC']],
    } as FindOptions);
  }
}
