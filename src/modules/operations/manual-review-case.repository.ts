/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Custodia los casos de revisión manual y su historial de decisiones.
 * @system lee casos abiertos, bloquea la fila al decidir, cierra el caso y registra el evento de decisión.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op, Transaction } from 'sequelize';
import { ManualReviewCaseModel, ManualReviewEventModel } from '../../database/models/index.js';

@Injectable()
export class ManualReviewCaseRepository {
  constructor(
    @InjectModel(ManualReviewCaseModel) private readonly manualReviewCaseModel: typeof ManualReviewCaseModel,
    @InjectModel(ManualReviewEventModel) private readonly manualReviewEventModel: typeof ManualReviewEventModel,
  ) {}

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

  /**
   * Con transacción, la fila queda bloqueada (FOR UPDATE) hasta confirmar: decidir es leer «abierto»
   * y cerrar, y sin el bloqueo dos analistas leían los dos `closedAt = null` y confirmaban los dos.
   */
  findManualReviewCaseById(
    tenantId: string,
    caseId: string,
    options: { transaction?: Transaction } = {},
  ): Promise<ManualReviewCaseModel | null> {
    return this.manualReviewCaseModel.findOne({
      where: { tenantId, id: caseId, deleted: { [Op.ne]: true } },
      transaction: options.transaction,
      lock: options.transaction ? Transaction.LOCK.UPDATE : undefined,
    } as FindOptions);
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
}
