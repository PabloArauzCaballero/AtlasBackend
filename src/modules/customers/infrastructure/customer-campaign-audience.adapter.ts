/**
 * @file Adaptador de Clientes para la audiencia de campañas de Mensajería.
 * @business Clientes es dueño de quién es cliente activo, dónde vive, qué crédito tiene y qué aceptó;
 *   Mensajería sólo recibe el recuento y los identificadores opacos de quienes cumplen el segmento.
 * @system Implementa `CampaignAudiencePort` con SQL de sólo lectura construido por `campaign-audience.sql`.
 *   Lo registra la composición de Mensajería con el token del puerto, igual que el directorio.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { atlasSchemaFor } from '../../../database/domain-schemas.js';
import { CustomerModel } from '../../../database/models/index.js';
import type {
  AudienceDefinition,
  AudienceEstimate,
  AudienceMember,
  AudienceOptions,
  CampaignAudiencePort,
} from '../../../platform/contracts/campaign-audience.js';
import { type AudienceTables, buildAudienceWhere, pushDevicePredicate, verifiedEmailPredicate } from './campaign-audience.sql.js';

const qualified = (table: string): string => `${atlasSchemaFor(table)}.${table}`;

export function audienceTables(): AudienceTables {
  return Object.freeze({
    customers: qualified('customers'),
    profileVersions: qualified('customer_profile_versions'),
    addresses: qualified('customer_addresses'),
    addressVersions: qualified('customer_address_versions'),
    contactMethods: qualified('customer_contact_methods'),
    deviceTokens: qualified('device_tokens'),
    loans: qualified('loans'),
    installments: qualified('loan_installments'),
    creditLines: qualified('credit_lines'),
  });
}

@Injectable()
export class CustomerCampaignAudienceAdapter implements CampaignAudiencePort {
  constructor(@InjectModel(CustomerModel) private readonly customerModel: typeof CustomerModel) {}

  async estimate(tenantId: string, definition: AudienceDefinition, options: AudienceOptions): Promise<AudienceEstimate> {
    const tables = audienceTables();
    const { where, replacements } = buildAudienceWhere(definition, options, tables);
    const [row] = await this.query<{ total: number; with_push: number; with_email: number }>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE ${pushDevicePredicate(tables)})::int AS with_push,
              COUNT(*) FILTER (WHERE ${verifiedEmailPredicate(tables)})::int AS with_email
         FROM ${tables.customers} c
        WHERE ${where}`,
      { ...replacements, tenantId },
    );
    return Object.freeze({
      total: Number(row?.total ?? 0),
      withPushDevice: Number(row?.with_push ?? 0),
      withVerifiedEmail: Number(row?.with_email ?? 0),
      estimatedAt: new Date().toISOString(),
    });
  }

  async listMembers(
    tenantId: string,
    definition: AudienceDefinition,
    options: AudienceOptions,
    page: Readonly<{ afterCustomerId: string | null; limit: number }>,
  ): Promise<readonly AudienceMember[]> {
    const tables = audienceTables();
    const { where, replacements } = buildAudienceWhere(definition, options, tables);
    const rows = await this.query<{ customer_id: string; has_push: boolean; has_email: boolean }>(
      `SELECT c._id::text AS customer_id,
              ${pushDevicePredicate(tables)} AS has_push,
              ${verifiedEmailPredicate(tables)} AS has_email
         FROM ${tables.customers} c
        WHERE ${where} AND c._id > CAST(:afterCustomerId AS BIGINT)
        ORDER BY c._id ASC
        LIMIT :limit`,
      { ...replacements, tenantId, afterCustomerId: page.afterCustomerId ?? '0', limit: page.limit },
    );
    return Object.freeze(
      rows.map((row) =>
        Object.freeze({
          customerId: String(row.customer_id),
          hasPushDevice: Boolean(row.has_push),
          hasVerifiedEmail: Boolean(row.has_email),
        }),
      ),
    );
  }

  private query<T extends object>(sql: string, replacements: Record<string, unknown>): Promise<T[]> {
    const sequelize = this.customerModel.sequelize;
    if (!sequelize) throw new Error('AUDIENCE_DATABASE_UNAVAILABLE');
    return sequelize.query<T>(sql, { replacements, type: QueryTypes.SELECT });
  }
}
