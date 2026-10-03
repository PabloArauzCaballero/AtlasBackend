/**
 * @file Resumen de monitoreo legible por máquina.
 * @business Lo que el portal admin enseña a una persona (red, herramientas críticas, tráfico, proveedores,
 *   entrega al Motor, colas y negocio) pasa a estar también disponible para el informador del servidor,
 *   que lo manda a Telegram sin que nadie tenga que abrir el portal ni iniciar sesión con 2FA.
 * @system Compone los servicios que ya alimentan al portal —no reimplementa ninguno— y les pone el
 *   semáforo de `systems-monitor.rules`. Sólo lectura. Cada bloque falla por separado: si la consulta
 *   de proveedores se cae, el resto del resumen sigue llegando y ese bloque dice `unknown` con el motivo.
 */
import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { SystemsActionLogRepository, type TrafficLatencyRow } from './systems-action-log.repository.js';
import { SystemsHealthService } from './systems-health.service.js';
import { SystemsNetworkHealthService } from './systems-network-health.service.js';
import {
  MIN_REQUESTS_FOR_RATE,
  criticalToolsStatus,
  networkStatus,
  outcomesStatus,
  providersStatus,
  reviewQueueStatus,
  trafficStatus,
  worstStatus,
  type MonitorStatus,
} from './systems-monitor.rules.js';

/**
 * Puertos hacia dos contextos ajenos (proveedores externos y entrega al Motor). Este módulo no los
 * importa: `systems-monitor.module.ts`, que es raíz de composición, enlaza la clase real a cada token.
 */
export const MONITOR_PROVIDERS_PORT = Symbol('MONITOR_PROVIDERS_PORT');
export const MONITOR_OUTCOMES_PORT = Symbol('MONITOR_OUTCOMES_PORT');

export interface MonitorProvidersPort {
  getDashboard(input: { days: number; tenantId?: string; healthPoints: number }): Promise<{
    totals: { providers: number; respondingProviders: number; unmeasuredProviders: number; successRate: number | null };
  }>;
}

export interface MonitorOutcomesPort {
  summarize(tenantId: string | null): Promise<{ configured: boolean; pending: number; retrying: number; exhausted: number }>;
}

type Guarded<T> = { ok: true; value: T } | { ok: false; error: string };

async function guarded<T>(run: () => Promise<T>): Promise<Guarded<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message.slice(0, 200) : 'error desconocido' };
  }
}

const failed = (error: string) => ({ status: 'unknown' as MonitorStatus, error });

type BusinessRow = Record<string, string | null>;

type SummaryParts = {
  network: Guarded<Awaited<ReturnType<SystemsNetworkHealthService['getNetworkHealth']>>>;
  tools: Guarded<Awaited<ReturnType<SystemsHealthService['getToolsHealth']>>>;
  traffic15m: Guarded<Awaited<ReturnType<SystemsMonitorSummaryService['trafficWindow']>>>;
  traffic24h: Guarded<Awaited<ReturnType<SystemsMonitorSummaryService['trafficWindow']>>>;
  providers: Guarded<Awaited<ReturnType<MonitorProvidersPort['getDashboard']>>>;
  outcomes: Guarded<Awaited<ReturnType<MonitorOutcomesPort['summarize']>>>;
  business: Guarded<Awaited<ReturnType<SystemsMonitorSummaryService['businessCounts']>>>;
};

@Injectable()
export class SystemsMonitorSummaryService {
  constructor(
    private readonly network: SystemsNetworkHealthService,
    private readonly health: SystemsHealthService,
    private readonly traffic: SystemsActionLogRepository,
    @Inject(MONITOR_PROVIDERS_PORT) private readonly providers: MonitorProvidersPort,
    @Inject(MONITOR_OUTCOMES_PORT) private readonly outcomes: MonitorOutcomesPort,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async summarize(tenantId: string) {
    const [network, tools, traffic15m, traffic24h, providers, outcomes, business] = await Promise.all([
      guarded(() => this.network.getNetworkHealth()),
      guarded(() => this.health.getToolsHealth()),
      guarded(() => this.trafficWindow(tenantId, 15 / 60, 1)),
      guarded(() => this.trafficWindow(tenantId, 24, 50)),
      guarded(() => this.providers.getDashboard({ days: 1, tenantId, healthPoints: 1 })),
      guarded(() => this.outcomes.summarize(tenantId)),
      guarded(() => this.businessCounts(tenantId)),
    ]);

    return this.compose(tenantId, { network, tools, traffic15m, traffic24h, providers, outcomes, business });
  }

  private compose(tenantId: string, r: SummaryParts) {
    const { network, tools, traffic15m, traffic24h, providers, outcomes, business } = r;
    const blocks = network.ok
      ? {
          status: networkStatus(network.value.overallState),
          overallState: network.value.overallState,
          blocksUp: network.value.blocksUp,
          blocksDown: network.value.blocksDown,
          blocks: network.value.blocks.map((block) => ({
            systemCode: block.systemCode,
            liveState: block.liveState,
            isCritical: block.isCritical,
            healthMessage: block.healthMessage,
          })),
        }
      : failed(network.error);

    const criticalTools = tools.ok
      ? {
          status: criticalToolsStatus(tools.value),
          down: tools.value
            .filter((tool) => tool.isCritical && tool.isHealthy === false)
            .map((tool) => ({ code: tool.code, name: tool.name, healthMessage: tool.healthMessage })),
        }
      : failed(tools.error);

    const trafficBlock = {
      last15m: traffic15m.ok ? { status: trafficStatus(traffic15m.value.summary), ...traffic15m.value.summary } : failed(traffic15m.error),
      last24h: traffic24h.ok
        ? { status: trafficStatus(traffic24h.value.summary), ...traffic24h.value.summary, slowestRoute: traffic24h.value.slowestRoute }
        : failed(traffic24h.error),
    };

    const providersBlock = providers.ok
      ? { status: providersStatus(providers.value.totals), ...providers.value.totals }
      : failed(providers.error);

    const outcomesBlock = outcomes.ok
      ? {
          status: outcomesStatus(outcomes.value),
          configured: outcomes.value.configured,
          pending: outcomes.value.pending,
          retrying: outcomes.value.retrying,
          exhausted: outcomes.value.exhausted,
        }
      : failed(outcomes.error);

    const queueBlock = business.ok
      ? {
          status: reviewQueueStatus(business.value.oldestOpenAgeHours),
          reviewOpen: business.value.reviewOpen,
          oldestOpenAgeHours: business.value.oldestOpenAgeHours,
        }
      : failed(business.error);

    const statuses: MonitorStatus[] = [
      blocks.status,
      criticalTools.status,
      trafficBlock.last15m.status,
      providersBlock.status,
      outcomesBlock.status,
      queueBlock.status,
    ];
    return {
      generatedAt: new Date().toISOString(),
      tenantId,
      overall: worstStatus(statuses),
      network: blocks,
      criticalTools,
      traffic: trafficBlock,
      providers: providersBlock,
      outcomes: outcomesBlock,
      queue: queueBlock,
      business: business.ok
        ? { last24h: business.value.last24h, merchantsApproved: business.value.merchantsApproved }
        : failed(business.error),
      outbox: business.ok ? { pending: business.value.outboxPending } : failed(business.error),
    };
  }

  /** Resumen de tráfico de una ventana. Con `routes` > 1 también calcula la ruta más lenta con volumen. */
  private async trafficWindow(tenantId: string, hours: number, routes: number) {
    const from = new Date(Date.now() - hours * 60 * 60 * 1000);
    const rows = await this.traffic.getTrafficLatencyByRoute(from, tenantId, { limit: routes, offset: 0 });
    const overall: TrafficLatencyRow | undefined = rows[0];
    const totalRequests = Number(overall?.overall_total_requests ?? 0);
    const summary = {
      totalRequests,
      avgLatencyMs: Math.round(Number(overall?.overall_avg_latency_ms ?? 0)),
      p95LatencyMs: Math.round(Number(overall?.overall_p95_latency_ms ?? 0)),
      serverErrorRate: totalRequests > 0 ? Number(overall?.overall_error_count ?? 0) / totalRequests : 0,
    };
    const slowest = rows
      .filter((row) => row.route_present !== false && Number(row.total_requests) >= MIN_REQUESTS_FOR_RATE && row.p95_latency_ms)
      .sort((a, b) => Number(b.p95_latency_ms) - Number(a.p95_latency_ms))[0];
    return {
      summary,
      slowestRoute: slowest
        ? { method: slowest.method, route: slowest.route_template, p95LatencyMs: Math.round(Number(slowest.p95_latency_ms)) }
        : null,
    };
  }

  /** Conteos de negocio del tenant. Sólo agregados: ningún dato personal sale de aquí. */
  private async businessCounts(tenantId: string) {
    const [row] = await this.sequelize.query<BusinessRow>(
      `
      SELECT
        (SELECT COUNT(*) FROM customer.customers WHERE _tenant_id = CAST(:t AS bigint) AND _created_at >= now() - interval '24 hours')::text AS customers_new,
        (SELECT COUNT(*) FROM credit.credit_applications WHERE _tenant_id = CAST(:t AS bigint) AND _created_at >= now() - interval '24 hours')::text AS applications_new,
        (SELECT COUNT(*) FROM credit.credit_applications WHERE _tenant_id = CAST(:t AS bigint) AND decided_at >= now() - interval '24 hours' AND status ILIKE 'approved%')::text AS applications_approved,
        (SELECT COUNT(*) FROM credit.loans WHERE _tenant_id = CAST(:t AS bigint) AND _created_at >= now() - interval '24 hours')::text AS loans_new,
        (SELECT COUNT(*) FROM credit.loan_payments WHERE _tenant_id = CAST(:t AS bigint) AND _created_at >= now() - interval '24 hours')::text AS payments_new,
        (SELECT COUNT(*) FROM partner.partner_profiles WHERE _tenant_id = CAST(:t AS bigint) AND _created_at >= now() - interval '24 hours')::text AS merchants_new,
        (SELECT COUNT(*) FROM partner.partner_profiles WHERE _tenant_id = CAST(:t AS bigint) AND onboarding_status = 'approved')::text AS merchants_approved,
        (SELECT COUNT(*) FROM case_management.manual_review_cases WHERE _tenant_id = CAST(:t AS bigint) AND closed_at IS NULL)::text AS review_open,
        (SELECT EXTRACT(EPOCH FROM (now() - MIN(opened_at))) / 3600 FROM case_management.manual_review_cases WHERE _tenant_id = CAST(:t AS bigint) AND closed_at IS NULL)::text AS review_oldest_hours,
        (SELECT COUNT(*) FROM platform_ops.outbox_events WHERE _tenant_id = CAST(:t AS bigint) AND status <> 'processed')::text AS outbox_pending
      `,
      { replacements: { t: tenantId }, type: QueryTypes.SELECT },
    );
    const n = (key: string) => Number(row?.[key] ?? 0);
    const oldest = row?.review_oldest_hours;
    return {
      last24h: {
        customersNew: n('customers_new'),
        applicationsNew: n('applications_new'),
        applicationsApproved: n('applications_approved'),
        loansNew: n('loans_new'),
        paymentsNew: n('payments_new'),
        merchantsNew: n('merchants_new'),
      },
      merchantsApproved: n('merchants_approved'),
      reviewOpen: n('review_open'),
      oldestOpenAgeHours: oldest === null || oldest === undefined ? null : Math.round(Number(oldest) * 10) / 10,
      outboxPending: n('outbox_pending'),
    };
  }
}
