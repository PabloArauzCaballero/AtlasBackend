/**
 * @file Adaptador HTTP del resumen de monitoreo (identidad de servicio, sin sesión humana).
 * @business El informador del servidor de pruebas lee el estado de Atlas cada minuto y avisa por Telegram
 *   cuando algo cambia. No puede iniciar sesión (2FA por correo): se identifica como servicio.
 * @system `@Public()` para que el guard global de sesión no evalúe el token (otra audiencia) y
 *   `ServiceTokenGuard` con `@ServiceScope`: sólo el servicio `atlas-monitor`, con el permiso
 *   `systems:monitor:read`, para el tenant que viaja en su token. Sin `CONTEXT_SERVICE_TOKEN_SECRET`
 *   configurado la ruta responde 503: no existe hasta que alguien la habilita a propósito.
 */
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import { ServiceScope, ServiceTokenGuard, type RequestWithServiceActor } from '../../common/guards/service-token.guard.js';
import { SystemsMonitorSummaryService } from './systems-monitor-summary.service.js';

export const SYSTEMS_MONITOR_SCOPE = 'systems:monitor:read';
export const SYSTEMS_MONITOR_CONSUMERS = ['atlas-monitor'] as const;

@ApiTags('systems-ops')
@ApiBearerAuth('access-token')
@Public()
@UseGuards(ServiceTokenGuard)
@Controller('systems/monitor')
export class SystemsMonitorController {
  constructor(private readonly summary: SystemsMonitorSummaryService) {}

  @ApiOperation({
    summary: 'Resumen de monitoreo para el informador del servidor (identidad de servicio)',
    description:
      'Red, herramientas críticas, tráfico, proveedores, entrega al Motor, colas y conteos de negocio, cada bloque con su ' +
      'semáforo (`ok | warn | bad | unknown`). Sólo servicios admitidos con token de servicio (audiencia `atlas-ctx-systems`). El tenant viaja en el token.',
  })
  @ApiResponse({ status: 200, description: 'Resumen agregado, sin datos personales.' })
  @ApiResponse({ status: 401, description: 'Token de servicio ausente, inválido, de otra audiencia o sin el permiso.' })
  @ApiResponse({ status: 503, description: 'Identidad de servicio no configurada en este despliegue.' })
  @ServiceScope(SYSTEMS_MONITOR_SCOPE, 'systems', SYSTEMS_MONITOR_CONSUMERS)
  @Get('summary')
  getSummary(@Req() request: RequestWithServiceActor) {
    return this.summary.summarize(request.serviceActor!.tenantId);
  }
}
