/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza captura señales de comportamiento y dispositivo necesarias para prevención de fraude y mejora de conversión.
 * @system persiste una familia de señales de telemetría del cliente.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';

import { OnDeviceComputationRunModel, OnDeviceMetricValueModel } from '../../database/models/index.js';
import type { RepositoryOptions } from './telemetry-repository-options.js';

/**
 * Cálculos que corrieron EN el teléfono y las métricas que produjeron. Se guardan aparte porque su
 * garantía es distinta: el backend no los computó, los recibió, y el registro de la corrida es lo
 * que permite saber con qué versión y en qué condiciones se obtuvo cada valor.
 */
@Injectable()
export class TelemetryOnDeviceRepository {
  constructor(
    @InjectModel(OnDeviceComputationRunModel)
    private readonly onDeviceComputationRunModel: typeof OnDeviceComputationRunModel,
    @InjectModel(OnDeviceMetricValueModel)
    private readonly onDeviceMetricValueModel: typeof OnDeviceMetricValueModel,
  ) {}

  createOnDeviceRun(
    values: {
      tenantId: string;
      customerId: string;
      deviceId: string;
      sessionId: string;
      onboardingFlowId: string | null;
      integrityHash: string;
      computedAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<OnDeviceComputationRunModel> {
    return this.onDeviceComputationRunModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        deviceId: values.deviceId,
        sessionId: values.sessionId,
        onboardingFlowId: values.onboardingFlowId,
        consentId: null,
        algorithmCode: 'atlas_on_device_metrics',
        algorithmVersion: 'v1',
        computationStatus: 'received',
        rawContactsStored: false,
        rawSmsStored: false,
        integrityHash: values.integrityHash,
        computedAtDevice: values.computedAt,
        receivedAtServer: new Date(),
        createdAtValue: new Date(),
      },
      { transaction: options.transaction },
    );
  }

  createOnDeviceMetric(
    values: {
      tenantId: string;
      computationRunId: string;
      metricCode: string;
      value: string | number | boolean | Record<string, unknown>;
      confidenceScore: string | null;
      createdAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<OnDeviceMetricValueModel> {
    return this.onDeviceMetricValueModel.create(
      {
        tenantId: values.tenantId,
        computationRunId: values.computationRunId,
        metricCode: values.metricCode,
        valueText: typeof values.value === 'string' ? values.value : null,
        valueNumber: typeof values.value === 'number' ? values.value.toFixed(4) : null,
        valueBoolean: typeof values.value === 'boolean' ? values.value : null,
        valueJson: typeof values.value === 'object' && !Array.isArray(values.value) ? values.value : null,
        confidenceScore: values.confidenceScore,
        createdAtValue: values.createdAt,
      },
      { transaction: options.transaction },
    );
  }

  /**
   * Batch de `createOnDeviceMetric` — un batch de telemetría puede traer hasta 100 métricas
   * (ver `telemetryBatchSchema`), y todas van a la misma tabla con la misma forma, así que
   * `bulkCreate` reemplaza hasta 100 INSERT secuenciales por uno solo.
   */

  createOnDeviceMetrics(
    values: Array<{
      tenantId: string;
      computationRunId: string;
      metricCode: string;
      value: string | number | boolean | Record<string, unknown>;
      confidenceScore: string | null;
      createdAt: Date;
    }>,
    options: RepositoryOptions,
  ): Promise<OnDeviceMetricValueModel[]> {
    if (values.length === 0) return Promise.resolve([]);
    return this.onDeviceMetricValueModel.bulkCreate(
      values.map((value) => ({
        tenantId: value.tenantId,
        computationRunId: value.computationRunId,
        metricCode: value.metricCode,
        valueText: typeof value.value === 'string' ? value.value : null,
        valueNumber: typeof value.value === 'number' ? value.value.toFixed(4) : null,
        valueBoolean: typeof value.value === 'boolean' ? value.value : null,
        valueJson: typeof value.value === 'object' && !Array.isArray(value.value) ? value.value : null,
        confidenceScore: value.confidenceScore,
        createdAtValue: value.createdAt,
      })) as never[],
      { transaction: options.transaction },
    );
  }
}
