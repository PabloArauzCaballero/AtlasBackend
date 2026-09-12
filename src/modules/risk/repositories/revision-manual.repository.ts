/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Abre el caso que pone a una persona a mirar una evaluación, y la incidencia del dato que faltó.
 * @system escrituras de `manual_review_cases` y `data_quality_issues` del flujo de riesgo.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import type { Transaction } from 'sequelize';
import { DataQualityIssueModel, ManualReviewCaseModel } from '../../../database/models/index.js';

type RepositoryOptions = { transaction?: Transaction };

/**
 * Lo que se escribe cuando una evaluación NO se resuelve sola.
 *
 * Vive fuera de `RiskRepository` porque ese archivo arrastra deuda de tamaño congelada por
 * `check:file-size` y esto es un vecindario propio: no lee nada del modelo de riesgo, sólo abre el
 * trabajo humano que la evaluación dejó pendiente. Separarlo hace que la delegación al Motor —la
 * única regla no obvia de aquí— se lea sin atravesar quinientas líneas de escrituras de riesgo.
 */
@Injectable()
export class RevisionManualRepository {
  constructor(
    @InjectModel(ManualReviewCaseModel) private readonly manualReviewCaseModel: typeof ManualReviewCaseModel,
    @InjectModel(DataQualityIssueModel) private readonly dataQualityIssueModel: typeof DataQualityIssueModel,
  ) {}

  createManualReviewCase(
    values: {
      tenantId: string;
      customerId: string;
      riskAssessmentRunId: string;
      priority: string;
      caseType: string;
      notes: string;
      /**
       * La ejecución del Motor que YA abrió allí su propio caso.
       *
       * Con valor, este caso nace DELEGADO: existe como ancla del flujo de alta, pero el servicio
       * de operaciones rechaza cerrarlo desde el portal. La bandeja buena —con expediente, imágenes
       * y petición de información— es la del Motor, y dos personas resolviendo el mismo caso sin
       * verse dejan «quién aprobó» sin respuesta.
       */
      decisionExecutionId: string | null;
      now: Date;
    },
    options: RepositoryOptions,
  ): Promise<ManualReviewCaseModel> {
    return this.manualReviewCaseModel.create(
      {
        tenantId: values.tenantId,
        caseCode: `MR-${Date.now()}`,
        customerId: values.customerId,
        riskAssessmentRunId: values.riskAssessmentRunId,
        decisionExecutionId: values.decisionExecutionId,
        fraudCaseId: null,
        caseType: values.caseType,
        priority: values.priority,
        status: 'open',
        assignedToInternalUserId: null,
        openedAt: values.now,
        closedAt: null,
        resolution: null,
        notes: values.notes,
        createdAtValue: values.now,
        updatedAtValue: values.now,
        deleted: false,
      },
      { transaction: options.transaction },
    );
  }

  createDataQualityIssue(
    values: { tenantId: string; targetRecordId: string; issueCode: string; now: Date },
    options: RepositoryOptions,
  ): Promise<DataQualityIssueModel> {
    return this.dataQualityIssueModel.create(
      {
        tenantId: values.tenantId,
        qualityRuleId: null,
        targetTable: 'customers',
        targetRecordId: values.targetRecordId,
        issueStatus: values.issueCode,
        detectedAt: values.now,
        resolvedAt: null,
        resolutionNotes: null,
        createdAtValue: values.now,
      },
      { transaction: options.transaction },
    );
  }
}
