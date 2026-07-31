/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza demuestra qué tratamiento de datos aceptó o rechazó cada cliente y bajo qué versión legal.
 * @system registra decisiones y eventos de consentimiento con separación entre DTO, reglas y persistencia.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op, Transaction } from 'sequelize';
import { ConsentDocumentModel, ConsentEventModel, CustomerConsentModel } from '../../database/models/index.js';

type RepositoryOptions = {
  transaction?: Transaction;
};

@Injectable()
export class ConsentsRepository {
  constructor(
    @InjectModel(ConsentDocumentModel) private readonly consentDocumentModel: typeof ConsentDocumentModel,
    @InjectModel(CustomerConsentModel) private readonly customerConsentModel: typeof CustomerConsentModel,
    @InjectModel(ConsentEventModel) private readonly consentEventModel: typeof ConsentEventModel,
  ) {}

  findActiveDocuments(tenantId: string, query: { language: string; purposeCode?: string }): Promise<ConsentDocumentModel[]> {
    const now = new Date();
    return this.consentDocumentModel.findAll({
      where: {
        tenantId,
        language: query.language,
        status: 'published',
        ...(query.purposeCode ? { documentCode: query.purposeCode } : {}),
        [Op.and]: [
          { [Op.or]: [{ effectiveFrom: null }, { effectiveFrom: { [Op.lte]: now } }] },
          { [Op.or]: [{ effectiveUntil: null }, { effectiveUntil: { [Op.gt]: now } }] },
        ],
      },
      order: [
        ['documentCode', 'ASC'],
        ['effectiveFrom', 'DESC'],
      ],
    } as FindOptions);
  }

  findActiveDocumentById(tenantId: string, consentDocumentId: string): Promise<ConsentDocumentModel | null> {
    const now = new Date();
    return this.consentDocumentModel.findOne({
      where: {
        id: consentDocumentId,
        tenantId,
        status: 'published',
        [Op.and]: [
          { [Op.or]: [{ effectiveFrom: null }, { effectiveFrom: { [Op.lte]: now } }] },
          { [Op.or]: [{ effectiveUntil: null }, { effectiveUntil: { [Op.gt]: now } }] },
        ],
      },
    } as FindOptions);
  }

  /**
   * Batch de `findActiveDocumentById` — `registerConsentDecisions` puede recibir hasta N
   * decisiones en un solo request; antes se buscaba el documento de cada una en un `await`
   * dentro del loop (N+1). Trae todos los documentos activos referenciados en un solo `IN (...)`.
   */
  findActiveDocumentsByIds(tenantId: string, consentDocumentIds: readonly string[]): Promise<ConsentDocumentModel[]> {
    if (consentDocumentIds.length === 0) return Promise.resolve([]);
    const now = new Date();
    return this.consentDocumentModel.findAll({
      where: {
        id: { [Op.in]: [...consentDocumentIds] },
        tenantId,
        status: 'published',
        [Op.and]: [
          { [Op.or]: [{ effectiveFrom: null }, { effectiveFrom: { [Op.lte]: now } }] },
          { [Op.or]: [{ effectiveUntil: null }, { effectiveUntil: { [Op.gt]: now } }] },
        ],
      },
    } as FindOptions);
  }

  /**
   * Documentos legales OBLIGATORIOS y vigentes del tenant.
   *
   * `requires_explicit_action` es la marca de obligatoriedad que la tabla ya declaraba; se usa esa
   * columna en vez de inventar una configuración paralela, para no tener dos fuentes de verdad
   * sobre qué debe aceptar un cliente antes de operar.
   */
  findRequiredActiveDocuments(tenantId: string): Promise<ConsentDocumentModel[]> {
    const now = new Date();
    return this.consentDocumentModel.findAll({
      where: {
        tenantId,
        status: 'published',
        requiresExplicitAction: true,
        [Op.and]: [
          { [Op.or]: [{ effectiveFrom: null }, { effectiveFrom: { [Op.lte]: now } }] },
          { [Op.or]: [{ effectiveUntil: null }, { effectiveUntil: { [Op.gt]: now } }] },
        ],
      },
    } as FindOptions);
  }

  createCustomerConsent(
    values: {
      tenantId: string;
      customerId: string;
      consentDocumentId: string;
      purposeCode: string;
      granted: boolean;
      channel: string;
      sessionId: string | null;
      ipAddress: string | null;
      deviceFingerprintSnapshot: string | null;
      userAgent: string | null;
      evidenceSnapshotUrl: string | null;
      happenedAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<CustomerConsentModel> {
    return this.customerConsentModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        consentDocumentId: values.consentDocumentId,
        purposeCode: values.purposeCode,
        granted: values.granted,
        grantedAt: values.granted ? values.happenedAt : null,
        revokedAt: values.granted ? null : values.happenedAt,
        channel: values.channel,
        sessionId: values.sessionId,
        ipAddress: values.ipAddress,
        deviceFingerprintSnapshot: values.deviceFingerprintSnapshot,
        userAgent: values.userAgent,
        evidenceSnapshotUrl: values.evidenceSnapshotUrl,
        createdAtValue: values.happenedAt,
        updatedAtValue: values.happenedAt,
      },
      { transaction: options.transaction },
    );
  }

  createConsentEvent(
    values: {
      tenantId: string;
      customerConsentId: string;
      eventType: string;
      channel: string;
      sessionId: string | null;
      ipAddress: string | null;
      deviceFingerprintSnapshot: string | null;
      triggeredByType: string;
      triggeredByInternalUserId: string | null;
      notes: string | null;
      happenedAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<ConsentEventModel> {
    return this.consentEventModel.create(
      {
        tenantId: values.tenantId,
        customerConsentId: values.customerConsentId,
        eventType: values.eventType,
        happenedAt: values.happenedAt,
        channel: values.channel,
        sessionId: values.sessionId,
        ipAddress: values.ipAddress,
        deviceFingerprintSnapshot: values.deviceFingerprintSnapshot,
        triggeredByType: values.triggeredByType,
        triggeredByInternalUserId: values.triggeredByInternalUserId,
        notes: values.notes,
        createdAtValue: values.happenedAt,
      },
      { transaction: options.transaction },
    );
  }
}
