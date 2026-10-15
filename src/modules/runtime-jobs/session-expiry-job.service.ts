/**
 * @file Servicio de aplicación: trabajo de fondo que caduca sesiones inactivas.
 * @business Cierra las sesiones de cliente sin actividad para que no queden abiertas indefinidamente.
 * @system compara la última actividad con el límite de inactividad y actualiza el estado de la sesión.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { CustomerSessionModel } from '../../database/models/index.js';
import { JobRunRecorderService } from './job-run-recorder.service.js';
import { ExpireStaleSessionsDto } from './runtime-jobs.schemas.js';

@Injectable()
export class SessionExpiryJobService {
  constructor(
    @InjectModel(CustomerSessionModel) private readonly sessionModel: typeof CustomerSessionModel,
    private readonly jobRuns: JobRunRecorderService,
  ) {}

  async expireStaleSessions(input: { tenantId: string; body: ExpireStaleSessionsDto; currentUser: AuthenticatedUser }) {
    return this.jobRuns.run(
      { tenantId: input.tenantId, jobCode: 'expire_stale_sessions', body: input.body, currentUser: input.currentUser },
      async () => {
        const cutoff = new Date(Date.now() - input.body.maxIdleMinutes * 60_000);
        // Por la ÚLTIMA actividad (hallazgo B6), no por el inicio: sin latidos se cae a `started_at`, como antes.
        const lastActivity = Sequelize.fn('COALESCE', Sequelize.col('last_activity_at'), Sequelize.col('started_at'));
        const where = {
          tenantId: input.tenantId,
          sessionStatus: 'active',
          [Op.and]: [Sequelize.where(lastActivity, Op.lt, cutoff)],
        };
        const selected = await this.sessionModel.count({ where } as never);
        let expired = 0;
        if (!input.body.dryRun) {
          const [count] = await this.sessionModel.update({ sessionStatus: 'expired', endedAt: new Date() }, { where } as never);
          expired = count;
        }
        return { selected, expired, cutoff: cutoff.toISOString(), dryRun: input.body.dryRun };
      },
    );
  }
}
