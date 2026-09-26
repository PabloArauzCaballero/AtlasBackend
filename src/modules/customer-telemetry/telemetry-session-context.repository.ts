/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza captura señales de comportamiento y dispositivo necesarias para prevención de fraude y mejora de conversión.
 * @system persiste una familia de señales de telemetría del cliente.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions } from 'sequelize';
import { CustomerDeviceLinkModel, CustomerSessionModel, OnboardingFlowModel } from '../../database/models/index.js';

/**
 * Contexto al que se cuelga cada señal: el vínculo cliente-dispositivo, la sesión y el flujo de
 * onboarding vigente. Son las tres lecturas que la ingesta hace ANTES de escribir nada, para no
 * atribuir telemetría a un dispositivo o una sesión que no son de ese cliente.
 */
@Injectable()
export class TelemetrySessionContextRepository {
  constructor(
    @InjectModel(CustomerDeviceLinkModel)
    private readonly customerDeviceLinkModel: typeof CustomerDeviceLinkModel,
    @InjectModel(CustomerSessionModel)
    private readonly customerSessionModel: typeof CustomerSessionModel,
    @InjectModel(OnboardingFlowModel)
    private readonly onboardingFlowModel: typeof OnboardingFlowModel,
  ) {}

  findCustomerDeviceLink(tenantId: string, customerId: string, deviceId: string): Promise<CustomerDeviceLinkModel | null> {
    return this.customerDeviceLinkModel.findOne({ where: { tenantId, customerId, deviceId } } as FindOptions);
  }

  findCustomerSession(tenantId: string, customerId: string, sessionId: string): Promise<CustomerSessionModel | null> {
    return this.customerSessionModel.findOne({ where: { tenantId, customerId, id: sessionId } } as FindOptions);
  }

  findLatestOnboardingFlow(tenantId: string, customerId: string): Promise<OnboardingFlowModel | null> {
    return this.onboardingFlowModel.findOne({
      where: { tenantId, customerId },
      order: [
        ['startedAt', 'DESC'],
        ['id', 'DESC'],
      ],
    } as FindOptions);
  }
}
