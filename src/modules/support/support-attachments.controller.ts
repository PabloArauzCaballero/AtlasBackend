/**
 * @file Adaptador HTTP: mandar y ver archivos dentro de la conversación de soporte.
 * @business Que se pueda enviar la foto del comprobante y que sólo la vea quien está en el chat.
 * @system ticket de subida firmado y entrega por bytes autenticados; nunca una URL pública.
 */
import { Body, Controller, Get, Headers, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser } from '../../common/types/auth.types.js';
import { tenantIdFromHeader } from '../../common/utils/http/headers.util.js';
import { SupportActorService } from './application/support-actor.service.js';
import { SupportAttachmentService } from './application/support-attachment.service.js';
import { type AttachmentTicketDto, attachmentTicketSchema } from './support-case.schemas.js';

@ApiTags('Soporte · Adjuntos')
@ApiBearerAuth('access-token')
@Controller('support')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('customer', 'merchant', 'internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin')
export class SupportAttachmentsController {
  constructor(
    private readonly actors: SupportActorService,
    private readonly attachments: SupportAttachmentService,
  ) {}

  /**
   * Permiso para subir un archivo a esta conversación.
   *
   * El archivo no pasa por el backend: se sube directo al almacenamiento con una URL firmada de
   * vida corta. Después se envía el mensaje citando la clave, y es ENTONCES cuando el servidor
   * comprueba hash, tipo real y antivirus antes de aceptarlo.
   */
  @ApiOperation({ summary: 'Pedir permiso para subir un archivo al chat' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 201, description: 'URL firmada, clave del objeto y cabeceras obligatorias.' })
  @Post('channels/:channelId/attachments/ticket')
  async ticket(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('channelId') channelId: string,
    @Body(new ZodValidationPipe(attachmentTicketSchema)) body: AttachmentTicketDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = tenantIdFromHeader(tenantIdHeader);
    const actor = await this.actors.resolve(currentUser, tenantId);
    return this.attachments.createTicket({
      tenantId,
      actor,
      channelId,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
    });
  }

  /**
   * El contenido del archivo, por una ruta autenticada.
   *
   * La app tiene que pedirlo con su token y convertirlo en blob: un `<img src>` no manda cabeceras
   * y recibiría un 401. Servirlo por URL prefirmada habría creado un enlace que funciona sin sesión
   * y que queda en el historial y en los logs de cualquier proxy por el que pase.
   */
  @ApiOperation({ summary: 'Descargar un adjunto del chat (bytes autenticados)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 403, description: 'SUPPORT_CHANNEL_NOT_PARTICIPANT o adjunto aún sin escanear.' })
  @Get('attachments/:attachmentId/content')
  async content(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Res() response: Response,
  ): Promise<void> {
    const tenantId = tenantIdFromHeader(tenantIdHeader);
    const actor = await this.actors.resolve(currentUser, tenantId);
    const file = await this.attachments.readContent({ tenantId, actor, attachmentId });

    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Length', String(file.bytes.byteLength));
    // `attachment` y no `inline`: el navegador no debe renderizar en la misma página un archivo
    // que subió un tercero, aunque haya pasado el antivirus.
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.end(file.bytes);
  }
}
