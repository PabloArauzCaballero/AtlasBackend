/**
 * @file Directorio de destinatarios servido por Clientes a otros contextos (AT-057, bloqueo del piloto).
 * @business Mensajería, fuera del monolito, no puede leer las tablas de Clientes: pregunta por HTTP con su
 *   identidad de servicio y recibe sólo lo que el propósito autoriza (direcciones vigentes y verificadas;
 *   `otp` acepta no verificadas). El tenant sale del token de servicio, nunca de una cabecera.
 * @system `@Public()` porque el guard global de sesión no entiende tokens de servicio (otra audiencia);
 *   `ServiceTokenGuard` con `@ServiceScope('customers:recipient-directory', 'customers', ['messaging-worker'])`
 *   es la regla de autorización. Delega en `CustomerRecipientDirectoryAdapter`, el mismo dueño del puerto local.
 */
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Public } from '../../common/decorators/public.decorator.js';
import { ServiceScope, ServiceTokenGuard, type RequestWithServiceActor } from '../../common/guards/service-token.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { RecipientChannelCode } from '../../platform/contracts/recipient-directory.js';
import { CustomerRecipientDirectoryAdapter } from './infrastructure/customer-recipient-directory.adapter.js';

export const RECIPIENT_DIRECTORY_SCOPE = 'customers:recipient-directory';
export const RECIPIENT_DIRECTORY_CONSUMERS = Object.freeze(['messaging-worker']);

const CHANNELS = ['sms', 'whatsapp', 'email', 'push', 'in_app'] as const;
const resolveQuerySchema = z.object({ customerId: z.string().regex(/^[1-9][0-9]*$/), channel: z.enum(CHANNELS) });
const addressesQuerySchema = resolveQuerySchema.extend({ purpose: z.string().trim().min(1).max(40) });

const resolutionResponseSchema = z.object({
  status: z.enum(['available', 'unverified', 'absent', 'unsupported']),
  contactId: z.string().nullable(),
  resolvedAt: z.string(),
});
const addressesResponseSchema = z.object({
  addresses: z.array(
    z.object({ contactId: z.string(), kind: z.enum(['email', 'phone', 'whatsapp']), address: z.string(), resolvedAt: z.string() }),
  ),
});

@ApiTags('customers')
@Public()
@UseGuards(ServiceTokenGuard)
@ServiceScope(RECIPIENT_DIRECTORY_SCOPE, 'customers', RECIPIENT_DIRECTORY_CONSUMERS)
@Controller('internal/contexts/customers/recipient-directory')
export class CustomerRecipientDirectoryController {
  constructor(private readonly directory: CustomerRecipientDirectoryAdapter) {}

  @ApiOperation({
    summary: 'Resolver si un cliente tiene contacto para un canal (identidad de servicio)',
    description:
      'Contrato entre contextos: sólo servicios admitidos con token de servicio (audiencia `atlas-ctx-customers`). El tenant viaja en el token.',
  })
  @ApiQuery({ name: 'customerId', required: true, description: 'Identificador del cliente dentro del tenant del token de servicio.' })
  @ApiQuery({ name: 'channel', required: true, enum: CHANNELS, description: 'Canal de entrega a resolver.' })
  @ApiResponse({ status: 200, description: 'Resolución sin datos personales.', schema: zodToApiSchema(resolutionResponseSchema) })
  @ApiResponse({ status: 401, description: 'Token de servicio ausente, inválido, de otra audiencia o sin el permiso.' })
  @ApiResponse({ status: 503, description: 'Identidad de servicio no configurada en este despliegue.' })
  @Get('resolve')
  resolve(
    @Req() request: RequestWithServiceActor,
    @Query(new ZodValidationPipe(resolveQuerySchema)) query: z.infer<typeof resolveQuerySchema>,
  ) {
    return this.directory.resolve({
      tenantId: request.serviceActor!.tenantId,
      recipient: { type: 'customer', id: query.customerId },
      channel: query.channel as RecipientChannelCode,
    });
  }

  @ApiOperation({
    summary: 'Direcciones de entrega de un cliente para un canal y propósito (identidad de servicio)',
    description:
      'Devuelve sólo direcciones vigentes autorizadas por el propósito (`transactional`, `otp`, `security`); vacío en cualquier otro caso. El valor en claro es para entregar, nunca para persistir.',
  })
  @ApiQuery({ name: 'customerId', required: true, description: 'Identificador del cliente dentro del tenant del token de servicio.' })
  @ApiQuery({ name: 'channel', required: true, enum: CHANNELS, description: 'Canal de entrega.' })
  @ApiQuery({
    name: 'purpose',
    required: true,
    description: 'Propósito que autoriza usar el contacto: transactional, otp o security; otro valor devuelve vacío.',
  })
  @ApiResponse({ status: 200, description: 'Direcciones autorizadas (puede ser vacío).', schema: zodToApiSchema(addressesResponseSchema) })
  @ApiResponse({ status: 401, description: 'Token de servicio ausente, inválido, de otra audiencia o sin el permiso.' })
  @ApiResponse({ status: 503, description: 'Identidad de servicio no configurada en este despliegue.' })
  @Get('addresses')
  async addresses(
    @Req() request: RequestWithServiceActor,
    @Query(new ZodValidationPipe(addressesQuerySchema)) query: z.infer<typeof addressesQuerySchema>,
  ) {
    const addresses = await this.directory.resolveDeliveryAddresses({
      tenantId: request.serviceActor!.tenantId,
      recipient: { type: 'customer', id: query.customerId },
      channel: query.channel as RecipientChannelCode,
      purpose: query.purpose,
    });
    return { addresses };
  }
}
