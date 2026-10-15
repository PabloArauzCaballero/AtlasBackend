/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Deja constancia de la decisión del operador como observación del cliente.
 * @system escribe customer_observations con origen operations dentro de la transacción de la decisión.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { CustomerObservationModel } from '../../database/models/index.js';

@Injectable()
export class CustomerObservationRepository {
  constructor(@InjectModel(CustomerObservationModel) private readonly customerObservationModel: typeof CustomerObservationModel) {}

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

  // Las escrituras de watchlist de fraude viven en `FraudRepository`.
}
