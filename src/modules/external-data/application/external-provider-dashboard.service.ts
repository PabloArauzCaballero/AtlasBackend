/**
 * @file Servicio de aplicación: arma la vista de actividad de los proveedores externos.
 * @business Esta pieza incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
 * @system aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.
 */
import { Injectable } from '@nestjs/common';
import { DataProviderRequestModel } from '../../../database/models/index.js';
import { ExternalDataRepository } from '../external-data.repository.js';
import { ExternalProviderDashboardRepository } from '../infrastructure/external-provider-dashboard.repository.js';
import { percentile, providerModeFromEnv, round2, toProviderCode } from './external-data-policy.util.js';

/** Estados de `response_status` agrupados por lo que significan PARA EL OPERADOR, no por su nombre. */
const SUCCESS_STATUSES = ['COMPLETED', 'MOCKED', 'DATA_NOT_AVAILABLE'];
const FAILURE_STATUSES = ['FAILED', 'PROVIDER_UNAVAILABLE', 'PROVIDER_AUTH_FAILED', 'RATE_LIMITED'];
const BLOCKED_STATUSES = ['BLOCKED_BY_COST_POLICY', 'CONSENT_REQUIRED', 'MANUAL_APPROVAL_REQUIRED'];

type ProviderActivity = {
  total: number;
  success: number;
  failed: number;
  blocked: number;
  cached: number;
  successRate: number | null;
  p95LatencyMs: number | null;
  avgLatencyMs: number | null;
  estimatedCost: number;
  actualCost: number;
  lastRequestAt: string | null;
  lastErrorStatus: string | null;
  lastErrorMessage: string | null;
};

type ProviderHealthPoint = { status: string; latencyMs: number; checkedAt: string };

type ProviderRow = {
  providerCode: string;
  name: string | null;
  category: string | null;
  status: string;
  mode: string;
  isCostly: boolean;
  requiresManualApproval: boolean;
  health: (ProviderHealthPoint & { modeChecked: string; errorCode: string | null; errorMessageSafe: string | null }) | null;
  healthSeries: ProviderHealthPoint[];
  activity: ProviderActivity;
};

type ProviderBucket = {
  total: number;
  success: number;
  failed: number;
  blocked: number;
  cached: number;
  latencies: number[];
  estimatedCost: number;
  actualCost: number;
  lastRequestAt: string | null;
  lastErrorStatus: string | null;
  lastErrorMessage: string | null;
};

function emptyBucket(): ProviderBucket {
  return {
    total: 0,
    success: 0,
    failed: 0,
    blocked: 0,
    cached: 0,
    latencies: [],
    estimatedCost: 0,
    actualCost: 0,
    lastRequestAt: null,
    lastErrorStatus: null,
    lastErrorMessage: null,
  };
}

function countStatus(bucket: ProviderBucket, status: string): void {
  if (SUCCESS_STATUSES.includes(status)) bucket.success += 1;
  if (FAILURE_STATUSES.includes(status)) bucket.failed += 1;
  if (BLOCKED_STATUSES.includes(status)) bucket.blocked += 1;
  if (status === 'CACHED') bucket.cached += 1;
}

/**
 * Las solicitudes llegan ordenadas de más nueva a más vieja, así que la PRIMERA de cada clase que
 * se ve es la última que ocurrió: por eso sólo se fija mientras el hueco siga vacío.
 */
function rememberLatest(bucket: ProviderBucket, request: DataProviderRequestModel, status: string): void {
  if (!bucket.lastRequestAt && request.requestedAt) bucket.lastRequestAt = request.requestedAt.toISOString();
  if (!bucket.lastErrorStatus && FAILURE_STATUSES.includes(status)) {
    bucket.lastErrorStatus = status;
    bucket.lastErrorMessage = request.errorMessageSafe ?? null;
  }
}

/**
 * El tablero que abre la pantalla de Proveedores externos.
 *
 * Existe porque la tabla sola no contesta las preguntas que se hacen al entrar: ¿están
 * respondiendo?, ¿cuánto tardan?, ¿cuántas llamadas hubo y cuántas fallaron?, ¿cuánto costó. La
 * columna «Salud» contestaba a la primera con un `UP` constante que en modo simulado local no
 * medía nada, y las otras tres no las contestaba nadie.
 *
 * TODO lo que devuelve sale de la base: `data_provider_requests` para la actividad y
 * `provider_health_logs` para la disponibilidad. No fabrica ni una cifra.
 */
@Injectable()
export class ExternalProviderDashboardService {
  constructor(
    private readonly repository: ExternalDataRepository,
    private readonly dashboardRepository: ExternalProviderDashboardRepository,
  ) {}

  async getDashboard(input: { days: number; tenantId?: string; healthPoints: number }) {
    const from = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
    const providers = await this.repository.listProviders();
    const requests = await this.dashboardRepository.listRequestsInWindow({ from, tenantId: input.tenantId });

    const buckets = new Map<string, ProviderBucket>();
    for (const request of requests) this.accumulate(buckets, request);

    const rows: ProviderRow[] = [];
    for (const provider of providers) {
      const providerId = String(provider.id);
      const providerCode = String(provider.providerCode);
      const bucket = buckets.get(providerId) ?? emptyBucket();
      const logs = await this.dashboardRepository.listRecentHealthLogs(providerId, input.healthPoints);
      const latest = logs[0];
      rows.push({
        providerCode,
        name: provider.providerName,
        category: provider.providerCategory ?? provider.providerType,
        status: provider.providerStatus ?? (provider.isActive ? 'ACTIVE' : 'DISABLED'),
        mode: providerModeFromEnv(providerCode, provider.defaultMode),
        isCostly: provider.isCostly ?? false,
        requiresManualApproval: provider.requiresManualApproval ?? false,
        health: latest
          ? {
              status: latest.status,
              latencyMs: latest.latencyMs,
              checkedAt: latest.checkedAt.toISOString(),
              modeChecked: latest.modeChecked,
              errorCode: latest.errorCode,
              errorMessageSafe: latest.errorMessageSafe,
            }
          : null,
        // Invertida: la más antigua primero, que es como se dibuja una serie de tiempo.
        healthSeries: [...logs].reverse().map((log) => ({
          status: log.status,
          latencyMs: log.latencyMs,
          checkedAt: log.checkedAt.toISOString(),
        })),
        activity: this.summarize(bucket),
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      days: input.days,
      windowFrom: from.toISOString(),
      totals: this.totals(rows),
      providers: rows,
      recentRequests: requests.slice(0, 20).map((request) => this.mapRequest(request, providers)),
    };
  }

  /**
   * Listado de solicitudes con filtros. Devuelve SIEMPRE el código del proveedor además de su id:
   * la pantalla filtra por código y nadie tiene por qué conocer las claves internas.
   */
  async listRequests(input: {
    days: number;
    tenantId?: string;
    providerCode?: string;
    customerId?: string;
    responseStatuses?: string[];
    approvalStatus?: string;
    limit: number;
    offset: number;
  }) {
    const providers = await this.repository.listProviders();
    const provider = input.providerCode
      ? providers.find((item) => String(item.providerCode) === toProviderCode(input.providerCode ?? ''))
      : undefined;
    // Un código que no existe devuelve una página VACÍA, no todas las solicitudes: sin esto, un
    // filtro mal escrito enseña más datos que el filtro correcto, que es lo contrario de lo que
    // cualquiera espera de un filtro.
    if (input.providerCode && !provider) {
      return { generatedAt: new Date().toISOString(), total: 0, limit: input.limit, offset: input.offset, requests: [] };
    }
    const page = await this.dashboardRepository.listRequestsPage({
      from: new Date(Date.now() - input.days * 24 * 60 * 60 * 1000),
      tenantId: input.tenantId,
      providerId: provider ? String(provider.id) : undefined,
      customerId: input.customerId,
      responseStatuses: input.responseStatuses,
      approvalStatus: input.approvalStatus,
      limit: input.limit,
      offset: input.offset,
    });
    return {
      generatedAt: new Date().toISOString(),
      total: page.count,
      limit: input.limit,
      offset: input.offset,
      requests: page.rows.map((request) => this.mapRequest(request, providers)),
    };
  }

  private accumulate(buckets: Map<string, ProviderBucket>, request: DataProviderRequestModel): void {
    const providerId = String(request.providerId ?? '');
    if (!providerId) return;
    const bucket = buckets.get(providerId) ?? emptyBucket();
    const status = String(request.responseStatus ?? 'UNKNOWN');
    bucket.total += 1;
    countStatus(bucket, status);
    if (typeof request.latencyMs === 'number') bucket.latencies.push(request.latencyMs);
    bucket.estimatedCost += Number(request.estimatedCostAmount ?? 0);
    bucket.actualCost += Number(request.actualCostAmount ?? 0);
    rememberLatest(bucket, request, status);
    buckets.set(providerId, bucket);
  }

  private summarize(bucket: ProviderBucket): ProviderActivity {
    return {
      total: bucket.total,
      success: bucket.success,
      failed: bucket.failed,
      blocked: bucket.blocked,
      cached: bucket.cached,
      // `null` y no `0` cuando no hubo llamadas: un 0 % de éxito y "no se le llamó" son cosas
      // distintas, y pintarlas igual haría ver caído a un proveedor que nadie usó.
      successRate: bucket.total > 0 ? round2((bucket.success / bucket.total) * 100) : null,
      p95LatencyMs: percentile(bucket.latencies, 95),
      avgLatencyMs:
        bucket.latencies.length > 0 ? Math.round(bucket.latencies.reduce((sum, value) => sum + value, 0) / bucket.latencies.length) : null,
      estimatedCost: round2(bucket.estimatedCost),
      actualCost: round2(bucket.actualCost),
      lastRequestAt: bucket.lastRequestAt,
      lastErrorStatus: bucket.lastErrorStatus,
      lastErrorMessage: bucket.lastErrorMessage,
    };
  }

  private totals(rows: ProviderRow[]) {
    const totalCalls = rows.reduce((sum, row) => sum + row.activity.total, 0);
    const success = rows.reduce((sum, row) => sum + row.activity.success, 0);
    const latencies = rows.map((row) => row.activity.p95LatencyMs).filter((value): value is number => typeof value === 'number');
    return {
      providers: rows.length,
      respondingProviders: rows.filter((row) => row.health?.status === 'UP').length,
      // Un proveedor sin ningún chequeo registrado no es «caído»: es «sin medir», y se cuenta aparte
      // para que el titular «7 de 8 responden» no acuse a quien nadie chequeó todavía.
      unmeasuredProviders: rows.filter((row) => !row.health).length,
      totalCalls,
      successCalls: success,
      failedCalls: rows.reduce((sum, row) => sum + row.activity.failed, 0),
      blockedCalls: rows.reduce((sum, row) => sum + row.activity.blocked, 0),
      successRate: totalCalls > 0 ? round2((success / totalCalls) * 100) : null,
      worstP95LatencyMs: latencies.length > 0 ? Math.max(...latencies) : null,
      estimatedCost: round2(rows.reduce((sum, row) => sum + row.activity.estimatedCost, 0)),
      actualCost: round2(rows.reduce((sum, row) => sum + row.activity.actualCost, 0)),
    };
  }

  private mapRequest(request: DataProviderRequestModel, providers: Array<{ id: string; providerCode: string | null }>) {
    const provider = providers.find((item) => String(item.id) === String(request.providerId));
    return {
      requestId: String(request.id),
      providerCode: provider ? String(provider.providerCode) : null,
      customerId: request.customerId ? String(request.customerId) : null,
      requestType: request.requestType,
      purposeCode: request.purposeCode,
      decisionStage: request.decisionStage,
      modeUsed: request.modeUsed,
      responseStatus: request.responseStatus,
      responseCode: request.responseCode,
      approvalStatus: request.approvalStatus,
      latencyMs: request.latencyMs,
      estimatedCostAmount: request.estimatedCostAmount ? Number(request.estimatedCostAmount) : null,
      actualCostAmount: request.actualCostAmount ? Number(request.actualCostAmount) : null,
      currency: request.currency,
      // Mensaje YA saneado en origen (`error_message_safe`); nunca el error crudo del proveedor,
      // que puede llevar el documento o el teléfono consultados.
      errorMessageSafe: request.errorMessageSafe,
      requestedAt: request.requestedAt ? request.requestedAt.toISOString() : null,
      respondedAt: request.respondedAt ? request.respondedAt.toISOString() : null,
    };
  }
}
