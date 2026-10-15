/**
 * @file Puerto de persistencia: acciones y observaciones del cliente durante la sesión.
 * @business Esta pieza mantiene continuidad, seguridad y señales de uso durante la interacción del cliente.
 * @system orquesta inicio, heartbeat, cierre, ubicación, dispositivo y auditoría del ciclo de sesión.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions } from 'sequelize';
import { CustomerActionLogModel, CustomerObservationModel } from '../../../database/models/index.js';
import type { RepositoryOptions } from './sessions-telemetry.repository.js';

@Injectable()
export class SessionsCustomerActivityRepository {
  constructor(
    @InjectModel(CustomerActionLogModel) private readonly customerActionLogModel: typeof CustomerActionLogModel,
    @InjectModel(CustomerObservationModel) private readonly customerObservationModel: typeof CustomerObservationModel,
  ) {}

  createCustomerAction(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string;
      deviceId: string | null;
      eventName: string;
      screenName: string | null;
      payload: Record<string, unknown> | null;
      occurredAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<CustomerActionLogModel> {
    return this.customerActionLogModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        sessionId: values.sessionId,
        deviceId: values.deviceId,
        eventName: values.eventName,
        screenName: values.screenName,
        actionPayloadJson: values.payload,
        occurredAt: values.occurredAt,
        createdAtValue: values.occurredAt,
      },
      { transaction: options.transaction },
    );
  }

  findSessionCustomerActions(tenantId: string, sessionId: string, limit = 30): Promise<CustomerActionLogModel[]> {
    return this.customerActionLogModel.findAll({
      where: { tenantId, sessionId },
      order: [
        ['occurredAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit,
    } as FindOptions);
  }

  createCustomerObservation(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string;
      deviceId: string | null;
      observationCode: string;
      valueBoolean: boolean | null;
      payload: Record<string, unknown> | null;
      sourceType: string;
      capturedAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<CustomerObservationModel> {
    return this.customerObservationModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        sessionId: values.sessionId,
        deviceId: values.deviceId,
        observationCode: values.observationCode,
        valueText: null,
        valueNumber: null,
        valueBoolean: values.valueBoolean,
        valueJson: values.payload,
        sourceType: values.sourceType,
        sourceProviderId: null,
        evidenceId: null,
        confidenceScore: null,
        verificationStatus: 'observed',
        capturedAt: values.capturedAt,
        validFrom: values.capturedAt,
        validUntil: null,
        derivationMethod: null,
        derivationVersion: null,
        createdAtValue: values.capturedAt,
      },
      { transaction: options.transaction },
    );
  }

  findSessionCustomerObservations(tenantId: string, sessionId: string, limit = 30): Promise<CustomerObservationModel[]> {
    return this.customerObservationModel.findAll({
      where: { tenantId, sessionId },
      order: [
        ['capturedAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit,
    } as FindOptions);
  }
}
