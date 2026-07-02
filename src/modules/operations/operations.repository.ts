import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindAndCountOptions, FindOptions, Op, Transaction, WhereOptions } from 'sequelize';
import { buildPaginationMeta, toOffset } from '../../common/utils/pagination/pagination.util.js';
import {
  CustomerObservationModel,
  CustomerStatusEventModel,
  DataChangeLogModel,
  FraudCaseModel,
  ManualReviewCaseModel,
  ManualReviewEventModel,
  OperationalAuditLogModel,
} from '../../database/models/index.js';
import { WorkQueueQueryDto } from './operations.schemas.js';

/**
 * ATLAS-AUDIT-014 (cerrado en este patch): las escrituras de decisión de casos de fraude
 * (`closeFraudCase`, `createFraudCaseEvent`, `createWatchlistEntry`, `findFraudCaseById`) se
 * movieron a `src/modules/fraud/fraud.repository.ts`. `FraudCaseModel` se mantiene inyectado
 * aquí porque `findFraudCasesForQueue`/`getInvestigationSummary` (lectura para el panel de
 * operaciones) siguen necesitándolo — una cola de trabajo que combina fraude + revisión manual
 * es, correctamente, responsabilidad de "operations", no de "fraud".
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
  ) {}

  async findManualReviewCasesForQueue(tenantId: string, query: WorkQueueQueryDto) {
    const where: WhereOptions = {
      tenantId,
      deleted: { [Op.ne]: true },
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
    };

    const orderField = query.sortBy === 'updatedAt' ? 'updatedAtValue' : 'createdAtValue';
    const orderDir = query.sortOrder.toUpperCase() as 'ASC' | 'DESC';

    const result = await this.manualReviewCaseModel.findAndCountAll({
      where,
      order: [
        [orderField, orderDir],
        ['id', 'DESC'],
      ],
      limit: query.limit,
      offset: toOffset({ page: query.page, limit: query.limit }),
    } as FindAndCountOptions);

    return {
      rows: result.rows,
      meta: buildPaginationMeta({ page: query.page, limit: query.limit }, result.count),
    };
  }

  async findFraudCasesForQueue(tenantId: string, query: WorkQueueQueryDto) {
    const where: WhereOptions = {
      tenantId,
      deleted: { [Op.ne]: true },
      ...(query.status ? { caseStatus: query.status } : {}),
      ...(query.priority ? { severity: query.priority } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
    };

    const orderField = query.sortBy === 'updatedAt' ? 'updatedAtValue' : 'createdAtValue';
    const orderDir = query.sortOrder.toUpperCase() as 'ASC' | 'DESC';

    const result = await this.fraudCaseModel.findAndCountAll({
      where,
      order: [
        [orderField, orderDir],
        ['id', 'DESC'],
      ],
      limit: query.limit,
      offset: toOffset({ page: query.page, limit: query.limit }),
    } as FindAndCountOptions);

    return {
      rows: result.rows,
      meta: buildPaginationMeta({ page: query.page, limit: query.limit }, result.count),
    };
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

  // findFraudCaseById movido a src/modules/fraud/fraud.repository.ts (ATLAS-AUDIT-014).

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

  // closeFraudCase y createFraudCaseEvent movidos a src/modules/fraud/fraud.repository.ts
  // (ATLAS-AUDIT-014). createStatusEvent/createCustomerObservation se mantienen aquí Y se
  // duplican en FraudRepository porque decideManualReviewCase (que sigue en operations) y
  // decideFraudCase (movido a fraud) ambos los necesitan — son escrituras genéricas de una
  // sola fila, estables, de bajo riesgo de divergencia.

  createStatusEvent(
    values: {
      tenantId: string;
      customerId: string;
      previousStatus: string | null;
      newStatus: string;
      reasonCode: string;
      actorType: string;
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

  // createWatchlistEntry movido a src/modules/fraud/fraud.repository.ts (ATLAS-AUDIT-014).

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
