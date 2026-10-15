/**
 * @file Servicio de aplicación: trabajo de fondo de calidad de datos.
 * @business Reporta cuántas incidencias de calidad de datos siguen abiertas.
 * @system cuenta incidencias abiertas del inquilino; no evalúa reglas de calidad.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { DataQualityIssueModel } from '../../database/models/index.js';
import { JobRunRecorderService } from './job-run-recorder.service.js';
import { RecalculateDataQualityDto } from './runtime-jobs.schemas.js';

@Injectable()
export class DataQualityJobService {
  constructor(
    @InjectModel(DataQualityIssueModel) private readonly dataQualityIssueModel: typeof DataQualityIssueModel,
    private readonly jobRuns: JobRunRecorderService,
  ) {}

  async recalculateDataQuality(input: { tenantId: string; body: RecalculateDataQualityDto; currentUser: AuthenticatedUser }) {
    return this.jobRuns.run(
      { tenantId: input.tenantId, jobCode: 'recalculate_data_quality', body: input.body, currentUser: input.currentUser },
      async () => {
        const where: Record<string, unknown> = { tenantId: input.tenantId, issueStatus: 'open' };
        if (input.body.customerId) {
          where.targetTable = 'customers';
          where.targetRecordId = input.body.customerId;
        }
        const openIssues = await this.dataQualityIssueModel.count({ where } as never);
        return {
          openIssues,
          issuesCreated: 0,
          dryRun: input.body.dryRun,
          // Corre programado y termina en SUCCESS: sin decir que no evalúa nada, el registro de jobs lo presentaba
          // como una pasada de calidad. Las reglas de `data_quality_rules` no las ejecuta ningún proceso todavía.
          rulesEvaluated: 0,
          note: 'Sólo cuenta las incidencias abiertas: no evalúa ninguna regla de calidad (no hay evaluador de reglas).',
        };
      },
    );
  }
}
