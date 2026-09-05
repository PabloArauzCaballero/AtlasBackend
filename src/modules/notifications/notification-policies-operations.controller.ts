/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza deja que negocio decida qué avisos existen y cuáles no se pueden apagar.
 * @system expone el CRUD del catálogo de políticas de notificación.
 */
import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
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

@ApiTags('notifications')
@ApiBearerAuth('access-token')
@Controller('operations/notification-policies')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('internal_operator', 'risk_analyst', 'admin', 'platform_admin')
export class NotificationPoliciesOperationsController {
  constructor(private readonly policies: NotificationPoliciesRepository) {}

  @ApiOperation({
    summary: 'Catálogo de avisos del producto',
    description:
      'Qué avisos existen, cómo se llaman de cara al cliente, en qué canal salen y cuáles son irrenunciables. ' +
      'Es lo que la app usa para dibujar la pantalla de preferencias: sin catálogo, esa pantalla sale vacía.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'Políticas del tenant, activas e inactivas.' })
  @Get()
  async list(@CurrentTenant() tenantId: string) {
    const policies = await this.policies.listAll(tenantId);
    return {
      data: policies.map((policy) => ({
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
  async upsert(
    @CurrentTenant() tenantId: string,
    @Body(new ZodValidationPipe(upsertNotificationPolicySchema)) body: UpsertNotificationPolicyDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const policy = await this.policies.upsert({ tenantId, ...body, updatedByInternalUserId: currentUser.sub ?? null });
    return { policyId: policy.id, eventCode: policy.eventCode, channel: policy.channel, isMandatory: policy.isMandatory };
  }
}
