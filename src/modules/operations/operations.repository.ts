/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza permite resolver excepciones y revisiones manuales con responsabilidad y trazabilidad.
 * @system gestiona colas y decisiones operativas mediante servicios transaccionales y repositorios aislados.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op, Transaction } from 'sequelize';

import {
  CustomerObservationModel,
  CustomerStatusEventModel,
  DataChangeLogModel,
  FraudCaseModel,
  IdentityVerificationAttemptModel,
  ManualReviewCaseModel,
  ManualReviewEventModel,
  OperationalAuditLogModel,
} from '../../database/models/index.js';

/**
 * Repositorio de operaciones.
 *
 * Las escrituras de decisión de fraude viven en `FraudRepository`; este repositorio mantiene
 * lecturas de casos de fraude para colas e investigation summary.
 */
@Injectable()
export class OperationsRepository {
  constructor(
    @InjectModel(ManualReviewCaseModel) private readonly manualReviewCaseModel: typeof ManualReviewCaseModel,
    @InjectModel(FraudCaseModel) private readonly fraudCaseModel: typeof FraudCaseModel,
    @InjectModel(ManualReviewEventModel) private readonly manualReviewEventModel: typeof ManualReviewEventModel,
    @InjectModel(CustomerStatusEventModel) private readonly customerStatusEventModel: typeof CustomerStatusEventModel,
    @InjectModel(OperationalAuditLogModel) private readonly operationalAuditLogModel: typeof OperationalAuditLogModel,
    @InjectModel(DataChangeLogModel) private readonly dataChangeLogModel: typeof DataChangeLogModel,
    @InjectModel(CustomerObservationModel) private readonly customerObservationModel: typeof CustomerObservationModel,
    @InjectModel(IdentityVerificationAttemptModel)
    private readonly identityAttemptModel: typeof IdentityVerificationAttemptModel,
  ) {}

  /**
   * El último intento de verificación de identidad del cliente, de cualquier canal.
   *
   * De CUALQUIER canal a propósito: quien investiga un caso necesita el estado
   * actual de la identidad, no el de una vía concreta. Filtrar por canal aquí
   * escondería una verificación de sucursal a quien mira un caso que llegó por el
   * móvil, y al revés — que es exactamente la información que hace falta para
   * saber si el expediente ya tiene respuesta.
   */
  /*
   * Sin filtro por `deleted`: esa columna NO existe en `identity_verification_attempts`.
   *
   * El filtro estaba copiado de las consultas de `customers`, donde sí existe, y hacía que
   * Sequelize generara `WHERE ... AND "IdentityVerificationAttemptModel"."deleted" != true`
   * contra una columna inexistente: PostgreSQL respondía 42703 y el endpoint devolvía 500 en
   * producción (medido el 2026-09-07 en `system_action_logs`, y detectado por Flujos al cruzar el
   * catálogo con esas corridas). Los intentos de verificación no se borran ni lógicamente: son
   * evidencia, y por eso la tabla no tiene la columna.
   */
  findLatestIdentityAttempt(tenantId: string, customerId: string): Promise<IdentityVerificationAttemptModel | null> {
    return this.identityAttemptModel.findOne({
      where: { tenantId, customerId },
      order: [['_id', 'DESC']],
    } as FindOptions);
  }

  findOpenManualReviewCasesForCustomer(tenantId: string, customerId: string): Promise<ManualReviewCaseModel[]> {
    return this.manualReviewCaseModel.findAll({
      where: {
        tenantId,
        customerId,
        deleted: { [Op.ne]: true },
        closedAt: null,
      },
      order: [
        ['openedAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit: 10,
    } as FindOptions);
  }

  findFraudCasesForCustomer(tenantId: string, customerId: string): Promise<FraudCaseModel[]> {
    return this.fraudCaseModel.findAll({
      where: {
        tenantId,
        customerId,
        deleted: { [Op.ne]: true },
      },
      order: [
        ['openedAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit: 10,
    } as FindOptions);
  }
  findManualReviewCaseById(tenantId: string, caseId: string): Promise<ManualReviewCaseModel | null> {
    return this.manualReviewCaseModel.findOne({ where: { tenantId, id: caseId, deleted: { [Op.ne]: true } } } as FindOptions);
  }

  // Las escrituras de fraude viven en `FraudRepository`.

  async closeManualReviewCase(
    caseModel: ManualReviewCaseModel,
    values: { resolution: string; notes: string | null; closedAt: Date },
    options: { transaction?: Transaction },
  ): Promise<ManualReviewCaseModel> {
    caseModel.status = 'closed';
    caseModel.resolution = values.resolution;
    caseModel.notes = values.notes;
    caseModel.closedAt = values.closedAt;
    caseModel.updatedAtValue = values.closedAt;
    return caseModel.save({ transaction: options.transaction });
  }

  createManualReviewEvent(
    values: {
      tenantId: string;
      caseId: string;
      eventType: string;
      actorType: string;
      actorInternalUserId: string | null;
      payload: Record<string, unknown>;
      notes: string | null;
      happenedAt: Date;
    },
    options: { transaction?: Transaction },
  ): Promise<ManualReviewEventModel> {
    return this.manualReviewEventModel.create(
      {
        tenantId: values.tenantId,
        manualReviewCaseId: values.caseId,
        eventType: values.eventType,
        actorType: values.actorType,
        actorInternalUserId: values.actorInternalUserId,
        happenedAt: values.happenedAt,
        payloadJson: values.payload,
        notes: values.notes,
        createdAtValue: values.happenedAt,
      },
      { transaction: options.transaction },
    );
  }

  // Status events y observaciones se usan tanto por manual review como por fraude.

  createStatusEvent(
    values: {
      tenantId: string;
      customerId: string;
      previousStatus: string | null;
      newStatus: string;
      reasonCode: string;
      actorType: string;
      actorInternalUserId: string | null;
      happenedAt: Date;
      notes: string | null;
    },
    options: { transaction?: Transaction },
  ): Promise<CustomerStatusEventModel> {
    return this.customerStatusEventModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        previousStatus: values.previousStatus,
        newStatus: values.newStatus,
        reasonCode: values.reasonCode,
        changedByType: values.actorType,
        changedByInternalUserId: values.actorInternalUserId,
        happenedAt: values.happenedAt,
        notes: values.notes,
        createdAtValue: values.happenedAt,
      },
      { transaction: options.transaction },
    );
  }

  createCustomerObservation(
    values: { tenantId: string; customerId: string; observationCode: string; payload: Record<string, unknown>; happenedAt: Date },
    options: { transaction?: Transaction },
  ): Promise<CustomerObservationModel> {
    return this.customerObservationModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        sessionId: null,
        deviceId: null,
        observationCode: values.observationCode,
        valueText: null,
        valueNumber: null,
        valueBoolean: null,
        valueJson: values.payload,
        sourceType: 'operations',
        sourceProviderId: null,
        evidenceId: null,
        confidenceScore: null,
        verificationStatus: 'operator_decision',
        capturedAt: values.happenedAt,
        validFrom: values.happenedAt,
        validUntil: null,
        derivationMethod: null,
        derivationVersion: null,
        createdAtValue: values.happenedAt,
      },
      { transaction: options.transaction },
    );
  }

  // Las escrituras de watchlist de fraude viven en `FraudRepository`.

  createOperationalAudit(
    values: {
      tenantId: string;
      actorType: string;
      actorInternalUserId: string | null;
      actionCode: string;
      targetType: string;
      targetId: string;
      payload: Record<string, unknown>;
      happenedAt: Date;
    },
    options: { transaction?: Transaction },
  ): Promise<OperationalAuditLogModel> {
    return this.operationalAuditLogModel.create(
      {
        tenantId: values.tenantId,
        actorType: values.actorType,
        actorInternalUserId: values.actorInternalUserId,
        actorPlatformUserId: null,
        actionCode: values.actionCode,
        targetType: values.targetType,
        targetId: values.targetId,
        ipAddress: null,
        userAgent: null,
        payloadJson: values.payload,
        occurredAt: values.happenedAt,
        createdAtValue: values.happenedAt,
      },
      { transaction: options.transaction },
    );
  }

  createDataChange(
    values: {
      tenantId: string;
      tableName: string;
      recordId: string;
      changeType: string;
      actorType: string;
      actorInternalUserId: string | null;
      reason: string;
      happenedAt: Date;
    },
    options: { transaction?: Transaction },
  ): Promise<DataChangeLogModel> {
    return this.dataChangeLogModel.create(
      {
        tenantId: values.tenantId,
        tableName: values.tableName,
        recordId: values.recordId,
        changeType: values.changeType,
        changedByType: values.actorType,
        changedByInternalUserId: values.actorInternalUserId,
        changedByPlatformUserId: null,
        oldValuesHash: null,
        newValuesHash: null,
        changeReason: values.reason,
        changedAt: values.happenedAt,
        createdAtValue: values.happenedAt,
      },
      { transaction: options.transaction },
    );
  }
}
