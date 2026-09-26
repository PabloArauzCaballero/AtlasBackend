/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Abre y cierra el caso que pone a una persona a mirar una solicitud de crédito que el Motor no resolvió.
 * @system escrituras de `manual_review_cases` del flujo de crédito, con el mismo modelo que usa riesgo.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Transaction } from 'sequelize';
import { ManualReviewCaseModel } from '../../database/models/index.js';
import { CREDIT_REVIEW_CASE_TYPE } from '../../common/types/review-case.types.js';

type RepositoryOptions = { transaction?: Transaction };

/**
 * El caso PROPIO de Atlas para una solicitud de crédito (C-1).
 *
 * Vive fuera de `CreditRepository` porque ése ya guarda productos, solicitudes y eventos, y esto es
 * otro vecindario: el trabajo humano que la solicitud dejó pendiente. Es también el mismo modelo
 * `manual_review_cases` que usa riesgo (`RevisionManualRepository`), sin depender de su módulo.
 */
@Injectable()
export class CreditReviewCaseRepository {
  constructor(@InjectModel(ManualReviewCaseModel) private readonly caseModel: typeof ManualReviewCaseModel) {}

  /**
   * Abre el caso de la solicitud, o devuelve el que ya existe.
   *
   * El código es determinista (`CR-<código de solicitud>`): dos caminos pueden llegar a abrirlo —la
   * petición original y el barrido que recoge las `submitted` atascadas— y no puede haber dos
   * casos para la misma solicitud. No nace delegado (`decision_execution_id` nulo): que el Motor
   * respondiera «revisión» no significa que abriera bandeja, que es justo el hueco que esto cierra.
   */
  async open(
    values: { tenantId: string; customerId: string; applicationCode: string; notes: string; now: Date },
    options: RepositoryOptions,
  ): Promise<ManualReviewCaseModel> {
    const caseCode = `CR-${values.applicationCode}`.slice(0, 80);
    const existing = await this.caseModel.findOne({
      where: { tenantId: values.tenantId, caseCode, deleted: false },
      transaction: options.transaction,
    } as FindOptions);
    if (existing) return existing;

    return this.caseModel.create(
      {
        tenantId: values.tenantId,
        caseCode,
        customerId: values.customerId,
        riskAssessmentRunId: null,
        fraudCaseId: null,
        decisionExecutionId: null,
        caseType: CREDIT_REVIEW_CASE_TYPE,
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

  /**
   * Cierra el caso de la solicitud cuando una persona la resuelve. Devuelve `false` si no había
   * caso abierto (una solicitud anterior a C-1, o ya cerrado): decidir la solicitud no depende de
   * que el caso exista.
   */
  async close(
    values: { tenantId: string; caseCode: string; resolution: string; notes: string | null; now: Date },
    options: RepositoryOptions,
  ): Promise<boolean> {
    const found = await this.caseModel.findOne({
      where: { tenantId: values.tenantId, caseCode: values.caseCode, deleted: false },
      transaction: options.transaction,
    } as FindOptions);
    if (!found || found.closedAt || found.status === 'closed') return false;

    found.status = 'closed';
    found.resolution = values.resolution;
    found.notes = values.notes ?? found.notes;
    found.closedAt = values.now;
    found.updatedAtValue = values.now;
    await found.save({ transaction: options.transaction });
    return true;
  }
}
