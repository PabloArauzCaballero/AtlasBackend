/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza ofrece a operaciones una vista gobernada del negocio sin acceso directo a tablas sensibles.
 * @system compone consultas read-only, reportes, glosario, linaje y búsqueda para el portal administrativo.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { ReadQueryService } from '../../../common/database/read-query.service.js';
import {
  AuditEventViewQueryDto,
  CustomerViewQueryDto,
  EndpointCoverageViewQueryDto,
  NotificationViewQueryDto,
  ProviderHealthViewQueryDto,
  RiskViewQueryDto,
  WorkQueueViewQueryDto,
} from '../admin-read.schemas.js';
import {
  AUDIT_VIEW,
  buildViewFilters,
  CUSTOMER_VIEW,
  ENDPOINT_VIEW,
  FACET_VALUE_LIMIT,
  GOVERNED_VIEWS,
  GovernedViewKey,
  NOTIFICATION_VIEW,
  PROVIDER_VIEW,
  ReadListQuery,
  RISK_VIEW,
  ViewConfig,
  WORK_QUEUE_VIEW,
} from './admin-read.views.js';

@Injectable()
export class AdminReadService {
  constructor(private readonly readQuery: ReadQueryService) {}

  listCustomers(tenantId: string, query: CustomerViewQueryDto) {
    return this.list(CUSTOMER_VIEW, query, tenantId);
  }

  listRiskAssessments(tenantId: string, query: RiskViewQueryDto) {
    return this.list(RISK_VIEW, query, tenantId);
  }

  listWorkQueue(tenantId: string, query: WorkQueueViewQueryDto) {
    return this.list(WORK_QUEUE_VIEW, query, tenantId);
  }

  listProviderHealth(query: ProviderHealthViewQueryDto) {
    return this.list(PROVIDER_VIEW, query);
  }

  listNotificationDeliveries(tenantId: string, query: NotificationViewQueryDto) {
    return this.list(NOTIFICATION_VIEW, query, tenantId);
  }

  listEndpointCoverage(query: EndpointCoverageViewQueryDto) {
    return this.list(ENDPOINT_VIEW, query);
  }

  listAuditEvents(tenantId: string, query: AuditEventViewQueryDto) {
    return this.list(AUDIT_VIEW, query, tenantId);
  }

  /**
   * Valores distintos de cada filtro de la vista, sobre la vista ENTERA (acotada al tenant cuando la
   * vista lo es). Antes el desplegable se armaba con los valores de la página cargada, así que al
   * elegir uno las demás opciones desaparecían y un valor que no estaba en la página no se ofrecía.
   */
  async listFacets(viewKey: GovernedViewKey, tenantId?: string) {
    const config = GOVERNED_VIEWS[viewKey];
    if (config.tenantScoped && !tenantId) {
      throw new BadRequestException('La vista requiere un tenant explícito.');
    }
    const whereSql = config.tenantScoped ? ' AND tenant_id = :tenantId' : '';
    const entries = await Promise.all(
      Object.entries(config.facets).map(async ([name, column]) => {
        const rows = await this.readQuery.select<{ value: string }>(
          `SELECT DISTINCT ${column}::text AS "value" FROM ${config.view} WHERE ${column} IS NOT NULL${whereSql} ORDER BY 1 LIMIT :limit`,
          { tenantId, limit: FACET_VALUE_LIMIT },
        );
        return [name, rows.map((row) => row.value)] as const;
      }),
    );
    return { view: viewKey, facets: Object.fromEntries(entries) as Record<string, string[]> };
  }

  private async list(config: ViewConfig, query: ReadListQuery, tenantId?: string) {
    const selectedFields = query.fields ?? [...config.defaultFields];
    const unknownFields = selectedFields.filter((field) => !Object.hasOwn(config.columns, field));
    if (unknownFields.length > 0) {
      throw new BadRequestException({
        code: 'INVALID_VIEW_FIELDS',
        message: `Campos no permitidos: ${unknownFields.join(', ')}.`,
        allowedFields: Object.keys(config.columns),
      });
    }

    if (config.tenantScoped && !tenantId) {
      throw new BadRequestException('La vista requiere un tenant explícito.');
    }

    const where: string[] = [];
    const replacements: Record<string, unknown> = {
      limit: query.limit,
      offset: (query.page - 1) * query.limit,
    };
    if (config.tenantScoped) {
      where.push('tenant_id = :tenantId');
      replacements.tenantId = tenantId;
    }
    buildViewFilters(config, query, where, replacements);

    const projection = selectedFields.map((field) => `${config.columns[field]} AS "${field}"`).join(', ');
    const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
    const [items, totals] = await Promise.all([
      this.readQuery.select<Record<string, unknown>>(
        `SELECT ${projection} FROM ${config.view}${whereSql} ORDER BY ${config.orderBy} LIMIT :limit OFFSET :offset`,
        replacements,
      ),
      this.readQuery.select<{ count: string }>(`SELECT COUNT(*)::text AS "count" FROM ${config.view}${whereSql}`, replacements),
    ]);
    const total = Number(totals[0]?.count ?? 0);

    return {
      items,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
        selectedFields,
      },
    };
  }
}
