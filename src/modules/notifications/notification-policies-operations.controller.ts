/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza deja que negocio decida qué avisos existen y cuáles no se pueden apagar.
 * @system expone el CRUD del catálogo de políticas de notificación.
 */
import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { queryBooleanSchema } from '../../common/pipes/query-boolean.schema.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { GOVERNANCE_POLICY_READ_ROLES, GOVERNANCE_POLICY_WRITE_ROLES } from '../../common/utils/auth/role-groups.util.js';
import { NotificationPoliciesRepository } from './notification-policies.repository.js';

/**
 * Un aviso obligatorio DEBE traer su motivo.
 *
 * Se valida aquí y no sólo en la base para que quien edita desde el portal lea una frase que
 * entiende en lugar de una violación de restricción. El motivo no es burocracia: es lo que la app
 * enseña junto al candado, y un interruptor bloqueado sin explicación se lee como abuso.
 */
export const upsertNotificationPolicySchema = z
  .object({
    eventCode: z.string().trim().min(3).max(80),
    channel: z.enum(['push', 'email', 'sms', 'in_app', 'whatsapp']),
    label: z.string().trim().min(2).max(120),
    description: z.string().trim().max(400).nullable().optional(),
    category: z.string().trim().min(2).max(40).default('general'),
    icon: z.string().trim().max(40).nullable().optional(),
    isMandatory: z.boolean().default(false),
    defaultEnabled: z.boolean().default(true),
    mandatoryReason: z.string().trim().max(400).nullable().optional(),
    displayOrder: z.number().int().min(0).max(10_000).default(100),
    isActive: z.boolean().default(true),
  })
  .refine((value) => !value.isMandatory || Boolean(value.mandatoryReason), {
    message: 'Un aviso obligatorio necesita explicar por qué no se puede apagar.',
    path: ['mandatoryReason'],
  });

export type UpsertNotificationPolicyDto = z.infer<typeof upsertNotificationPolicySchema>;

/**
 * El listado del portal: buscador por partes, filtros y paginación en el servidor.
 *
 * `limit` no lleva valor por omisión a propósito: quien no lo manda (un cliente anterior a la
 * paginación) sigue recibiendo el catálogo entero. Si manda `page` sin `limit`, se pagina de 20 en 20.
 */
export const listNotificationPoliciesQuerySchema = z
  .object({
    /** Por partes: código del evento, nombre, categoría y explicación. */
    q: z.string().trim().min(1).max(120).optional(),
    category: z.string().trim().min(1).max(40).optional(),
    channel: z.enum(['push', 'email', 'sms', 'in_app', 'whatsapp']).optional(),
    /** `true` sólo las irrenunciables; `false` sólo las que el cliente puede apagar. */
    mandatory: queryBooleanSchema.optional(),
    /** `true` sólo las que salen en la app; `false` sólo las apagadas. */
    active: queryBooleanSchema.optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
  })
  .transform(({ page, limit, ...rest }) => ({
    ...rest,
    page: page ?? 1,
    limit: limit ?? (page === undefined ? undefined : 20),
  }));
export type ListNotificationPoliciesQueryDto = z.infer<typeof listNotificationPoliciesQuerySchema>;

@ApiTags('notifications')
@ApiBearerAuth('access-token')
@Controller('operations/notification-policies')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class NotificationPoliciesOperationsController {
  constructor(private readonly policies: NotificationPoliciesRepository) {}

  @ApiOperation({
    summary: 'Catálogo de avisos del producto',
    description:
      'Qué avisos existen, cómo se llaman de cara al cliente, en qué canal salen y cuáles son irrenunciables. ' +
      'Es lo que la app usa para dibujar la pantalla de preferencias: sin catálogo, esa pantalla sale vacía.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiQuery({
    name: 'q',
    required: false,
    description: 'Busca por partes en el código del evento, el nombre, la categoría y la explicación.',
  })
  @ApiQuery({ name: 'category', required: false, description: 'Sólo los avisos de esta categoría (p. ej. `pagos`).' })
  @ApiQuery({
    name: 'channel',
    required: false,
    description: 'Sólo los avisos de este canal: `push`, `email`, `sms`, `in_app` o `whatsapp`.',
  })
  @ApiQuery({
    name: 'mandatory',
    required: false,
    description: '`true` sólo los irrenunciables; `false` sólo los que el cliente puede apagar.',
  })
  @ApiQuery({ name: 'active', required: false, description: '`true` sólo los que salen en la app; `false` sólo los apagados.' })
  @ApiQuery({ name: 'page', required: false, description: 'Página, desde 1. Con `page` y sin `limit` se pagina de 20 en 20.' })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Políticas por página, de 1 a 100. Sin `limit` ni `page` responde el catálogo entero.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Políticas del tenant, activas e inactivas, con `meta` y `summary` (total, irrenunciables, activas, por canal y por categoría del catálogo entero).',
  })
  @Get()
  @Roles(...GOVERNANCE_POLICY_READ_ROLES)
  async list(
    @CurrentTenant() tenantId: string,
    @Query(new ZodValidationPipe(listNotificationPoliciesQuerySchema)) query: ListNotificationPoliciesQueryDto,
  ) {
    const { rows, meta, summary } = await this.policies.listPage(tenantId, query);
    return {
      data: rows.map((policy) => ({
        policyId: policy.id,
        eventCode: policy.eventCode,
        channel: policy.channel,
        label: policy.label,
        description: policy.description,
        category: policy.category,
        icon: policy.icon,
        isMandatory: policy.isMandatory,
        defaultEnabled: policy.defaultEnabled,
        mandatoryReason: policy.mandatoryReason,
        displayOrder: policy.displayOrder,
        isActive: policy.isActive,
        updatedAt: policy.updatedAtValue?.toISOString() ?? null,
      })),
      meta,
      summary,
    };
  }

  @ApiOperation({
    summary: 'Crear o reemplazar una política de aviso',
    description:
      'Idempotente por `eventCode` + `channel`. Marcar algo `isMandatory` bloquea el interruptor en la app Y hace ' +
      'que el servidor rechace apagarlo, aunque una app antigua lo intente: la obligatoriedad dejó de venir en el ' +
      'cuerpo de la petición del cliente, que era lo que permitía silenciar el aviso de mora.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiBody({ schema: zodToApiSchema(upsertNotificationPolicySchema) })
  @ApiResponse({ status: 200, description: 'Política guardada.' })
  @Put()
  @Roles(...GOVERNANCE_POLICY_WRITE_ROLES)
  async upsert(
    @CurrentTenant() tenantId: string,
    @Body(new ZodValidationPipe(upsertNotificationPolicySchema)) body: UpsertNotificationPolicyDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const policy = await this.policies.upsert({ tenantId, ...body, updatedByInternalUserId: currentUser.sub ?? null });
    return { policyId: policy.id, eventCode: policy.eventCode, channel: policy.channel, isMandatory: policy.isMandatory };
  }
}
