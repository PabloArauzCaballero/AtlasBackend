/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Un cliente cuya identidad espera a una persona tiene que aparecer en la bandeja de alguien.
 * @system abre y cierra el caso `identity_review` de `manual_review_cases`, que lista la cola de operaciones.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Transaction } from 'sequelize';
import { ManualReviewCaseModel } from '../../../database/models/index.js';
import { IDENTITY_REVIEW_CASE_TYPE } from '../../../common/types/review-case.types.js';

type RepositoryOptions = { transaction?: Transaction };

@Injectable()
export class IdentityReviewCaseRepository {
  constructor(@InjectModel(ManualReviewCaseModel) private readonly caseModel: typeof ManualReviewCaseModel) {}

  /** Uno abierto por cliente: dos intentos seguidos no llenan la bandeja con el mismo trabajo. */
  async openIfAbsent(
    values: { tenantId: string; customerId: string; notes: string; now: Date },
    options: RepositoryOptions = {},
  ): Promise<ManualReviewCaseModel> {
    const existing = await this.caseModel.findOne({
      where: { tenantId: values.tenantId, customerId: values.customerId, caseType: IDENTITY_REVIEW_CASE_TYPE, closedAt: { [Op.is]: null } },
      transaction: options.transaction,
    } as never);
    if (existing) return existing;
    return this.caseModel.create(
      {
        tenantId: values.tenantId,
        caseCode: `MR-ID-${Date.now()}`,
        customerId: values.customerId,
        riskAssessmentRunId: null,
        decisionExecutionId: null,
        fraudCaseId: null,
        caseType: IDENTITY_REVIEW_CASE_TYPE,
        priority: 'medium',
        status: 'open',
        assignedToInternalUserId: null,
        openedAt: values.now,
        closedAt: null,
        resolution: null,
        notes: values.notes,
        createdAtValue: values.now,
        updatedAtValue: values.now,
        deleted: false,
      } as never,
      { transaction: options.transaction },
    );
  }

  async closeOpen(
    values: { tenantId: string; customerId: string; resolution: string; notes: string | null; now: Date },
    options: RepositoryOptions = {},
  ): Promise<number> {
    const [count] = await this.caseModel.update(
      { status: 'closed', closedAt: values.now, resolution: values.resolution, notes: values.notes, updatedAtValue: values.now } as never,
      {
        where: {
          tenantId: values.tenantId,
          customerId: values.customerId,
          caseType: IDENTITY_REVIEW_CASE_TYPE,
          closedAt: { [Op.is]: null },
        },
        transaction: options.transaction,
      } as never,
    );
    return count;
  }
}
