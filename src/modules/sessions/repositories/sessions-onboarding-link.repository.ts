import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Transaction } from 'sequelize';
import { OnboardingFlowModel, OnboardingStepEventModel } from '../../../database/models/index.js';

export type RepositoryOptions = {
  transaction?: Transaction;
};

/**
 * ATLAS-P11-T12: parte de la descomposición de `sessions.repository.ts`. Responsabilidad única:
 * lectura del flujo de onboarding más reciente del cliente y registro de eventos de paso, tal
 * como se observan desde una sesión activa. Split mecánico, sin cambio de comportamiento.
 */
@Injectable()
export class SessionsOnboardingLinkRepository {
  constructor(
    @InjectModel(OnboardingFlowModel) private readonly onboardingFlowModel: typeof OnboardingFlowModel,
    @InjectModel(OnboardingStepEventModel) private readonly onboardingStepEventModel: typeof OnboardingStepEventModel,
  ) {}

  findLatestOnboardingFlow(tenantId: string, customerId: string, options: RepositoryOptions = {}): Promise<OnboardingFlowModel | null> {
    return this.onboardingFlowModel.findOne({
      where: { tenantId, customerId },
      order: [
        ['startedAt', 'DESC'],
        ['id', 'DESC'],
      ],
      transaction: options.transaction,
    } as FindOptions);
  }

  createOnboardingStepEvent(
    values: {
      tenantId: string;
      onboardingFlowId: string | null;
      stepCode: string;
      eventType: string;
      payload: Record<string, unknown> | null;
      occurredAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<OnboardingStepEventModel> {
    return this.onboardingStepEventModel.create(
      {
        tenantId: values.tenantId,
        onboardingFlowId: values.onboardingFlowId,
        stepCode: values.stepCode,
        eventType: values.eventType,
        startedAt: values.occurredAt,
        endedAt: null,
        durationMs: null,
        errorCount: 0,
        payloadJson: values.payload,
        createdAtValue: values.occurredAt,
      },
      { transaction: options.transaction },
    );
  }
}
