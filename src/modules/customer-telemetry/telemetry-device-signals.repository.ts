/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza captura señales de comportamiento y dispositivo necesarias para prevención de fraude y mejora de conversión.
 * @system persiste una familia de señales de telemetría del cliente.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';

import { AuthEventModel, DeviceRiskEventModel, IpReputationObservationModel, SimObservationModel } from '../../database/models/index.js';
import type { RepositoryOptions } from './telemetry-repository-options.js';

/**
 * Señales de riesgo del aparato y de la red: eventos de autenticación, riesgo de dispositivo, cambio
 * de SIM y reputación de IP. Todas responden a la misma pregunta —¿es quien dice ser, desde donde
 * dice estar?— y todas alimentan al motor de fraude.
 */
@Injectable()
export class TelemetryDeviceSignalsRepository {
  constructor(
    @InjectModel(AuthEventModel)
    private readonly authEventModel: typeof AuthEventModel,
    @InjectModel(DeviceRiskEventModel)
    private readonly deviceRiskEventModel: typeof DeviceRiskEventModel,
    @InjectModel(SimObservationModel)
    private readonly simObservationModel: typeof SimObservationModel,
    @InjectModel(IpReputationObservationModel)
    private readonly ipReputationObservationModel: typeof IpReputationObservationModel,
  ) {}

  createAuthEvent(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string;
      deviceId: string;
      eventType: string;
      loginSuccessful: boolean | null;
      failureReasonCode: string | null;
      occurredAt: Date;
      ipAddress: string | null;
    },
    options: RepositoryOptions,
  ): Promise<AuthEventModel> {
    return this.authEventModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        sessionId: values.sessionId,
        deviceId: values.deviceId,
        eventType: values.eventType,
        loginSuccessful: values.loginSuccessful,
        failureReasonCode: values.failureReasonCode,
        occurredAt: values.occurredAt,
        ipAddress: values.ipAddress,
        createdAtValue: values.occurredAt,
      },
      { transaction: options.transaction },
    );
  }

  createDeviceRiskEvent(
    values: {
      tenantId: string;
      deviceId: string;
      eventType: string;
      reasonCode: string | null;
      evidence: Record<string, unknown> | null;
      occurredAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<DeviceRiskEventModel> {
    return this.deviceRiskEventModel.create(
      {
        tenantId: values.tenantId,
        deviceId: values.deviceId,
        eventType: values.eventType,
        previousRiskStatus: null,
        newRiskStatus: null,
        reasonCode: values.reasonCode,
        supportingEvidenceJson: values.evidence,
        happenedAt: values.occurredAt,
        createdAtValue: values.occurredAt,
      },
      { transaction: options.transaction },
    );
  }

  createSimObservation(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string;
      deviceId: string;
      metadata: Record<string, unknown>;
      occurredAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<SimObservationModel> {
    return this.simObservationModel.create(
      {
        tenantId: values.tenantId,
        deviceId: values.deviceId,
        customerId: values.customerId,
        sessionId: values.sessionId,
        phoneNumberHash: typeof values.metadata.phoneNumberHash === 'string' ? values.metadata.phoneNumberHash : null,
        phoneLast4: typeof values.metadata.phoneLast4 === 'string' ? values.metadata.phoneLast4 : null,
        carrierName: typeof values.metadata.carrierName === 'string' ? values.metadata.carrierName : null,
        simType: typeof values.metadata.simType === 'string' ? values.metadata.simType : null,
        simCount: typeof values.metadata.simCount === 'number' ? values.metadata.simCount : null,
        phoneLineTenureMonths: null,
        lastSimSwapAt: null,
        simSwapDaysSince: null,
        sourceType: 'mobile_app',
        confidenceScore: null,
        capturedAt: values.occurredAt,
        createdAtValue: values.occurredAt,
      },
      { transaction: options.transaction },
    );
  }

  createIpReputation(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string;
      deviceId: string;
      ipAddress: string | null;
      metadata: Record<string, unknown>;
      occurredAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<IpReputationObservationModel> {
    return this.ipReputationObservationModel.create(
      {
        tenantId: values.tenantId,
        sessionId: values.sessionId,
        customerId: values.customerId,
        deviceId: values.deviceId,
        providerRequestId: null,
        ipAddress: values.ipAddress,
        isVpn: typeof values.metadata.isVpn === 'boolean' ? values.metadata.isVpn : null,
        isProxy: typeof values.metadata.isProxy === 'boolean' ? values.metadata.isProxy : null,
        isTor: typeof values.metadata.isTor === 'boolean' ? values.metadata.isTor : null,
        countryCode: typeof values.metadata.countryCode === 'string' ? values.metadata.countryCode : null,
        city: typeof values.metadata.city === 'string' ? values.metadata.city : null,
        reputationScore: typeof values.metadata.reputationScore === 'number' ? values.metadata.reputationScore.toFixed(4) : null,
        capturedAt: values.occurredAt,
        createdAtValue: values.occurredAt,
      },
      { transaction: options.transaction },
    );
  }
}
