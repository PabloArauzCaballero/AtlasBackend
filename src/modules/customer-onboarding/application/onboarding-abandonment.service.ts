/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { FindOptions, Op } from 'sequelize';
import { OnboardingFlowModel } from '../../../database/models/index.js';
import { CustomerOnboardingFlowRepository } from '../repositories/customer-onboarding-flow.repository.js';

/** Días de inactividad tras los cuales un onboarding sin terminar se considera abandonado. */
export const ONBOARDING_ABANDONMENT_DAYS = 30;

/**
 * Cierre de los onboardings abandonados.
 *
 * `completion_status` se escribía una sola vez como `in_progress` y no se actualizaba nunca, así que
 * `abandoned_at` quedaba en `null` para siempre y la tasa de abandono —la métrica que dice si el
 * embudo funciona— no existía. El envío del paquete ya cierra los flujos completados; este job cierra
 * el otro extremo.
 *
 * Marca el FLUJO, no al cliente: alguien que dejó el registro a medias puede volver semanas después
 * y retomar. Cambiar su estado sería castigarlo por tardar.
 */
@Injectable()
export class OnboardingAbandonmentService {
  private readonly logger = new Logger(OnboardingAbandonmentService.name);

  constructor(
    @InjectModel(OnboardingFlowModel) private readonly flowModel: typeof OnboardingFlowModel,
    private readonly flowRepository: CustomerOnboardingFlowRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async markAbandonedFlows(input: { tenantId: string; olderThanDays?: number; limit?: number }): Promise<{
    evaluated: number;
    abandoned: number;
    thresholdDate: string;
  }> {
    const days = input.olderThanDays ?? ONBOARDING_ABANDONMENT_DAYS;
    const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const limit = input.limit ?? 500;

    const stale = await this.flowModel.findAll({
      where: {
        tenantId: input.tenantId,
        completionStatus: 'in_progress',
        completedAt: null,
        abandonedAt: null,
        startedAt: { [Op.lt]: threshold },
      },
      order: [['startedAt', 'ASC']],
      limit,
    } as FindOptions);

    if (stale.length === 0) {
      return { evaluated: 0, abandoned: 0, thresholdDate: threshold.toISOString() };
    }

    const now = new Date();
    let abandoned = 0;
    await this.sequelize.transaction(async (transaction) => {
      for (const flow of stale) {
        await this.flowRepository.closeOnboardingFlow(flow, { completionStatus: 'abandoned', closedAt: now }, { transaction });
        abandoned += 1;
      }
    });

    this.logger.log(
      `Onboardings marcados como abandonados en el tenant ${input.tenantId}: ${abandoned} (corte ${threshold.toISOString()}).`,
    );
    return { evaluated: stale.length, abandoned, thresholdDate: threshold.toISOString() };
  }
}
