/**
 * @file Adaptador HTTP: lectura de la instantánea del servidor para el portal admin.
 * @business «Servidor de TEST» en Operaciones › Salud de la red: memoria, disco, carga, caché de build, copia
 *   de bases y cada app con su respaldo, con los mismos colores y umbrales que las alertas de Telegram.
 * @system Sesión interna normal (mismos roles que el resto de Salud de la red), acotado al tenant de la
 *   sesión. Lee lo que mandó el informador; no mide nada por su cuenta.
 */
import { Controller, ForbiddenException, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/types/auth.types.js';
import { SystemsOpsControllerSecurity } from './systems-controller.decorators.js';
import { hostStatus } from './systems-monitor.rules.js';
import { SystemsMonitorHostStore } from './systems-monitor-host.store.js';

@Controller('systems/monitor')
@SystemsOpsControllerSecurity()
export class SystemsMonitorHostController {
  constructor(private readonly store: SystemsMonitorHostStore) {}

  @ApiOperation({ summary: 'Estado del servidor de TEST según la última instantánea del informador' })
  @ApiResponse({ status: 200, description: '`available: false` si el informador no ha mandado nada en 15 min.' })
  @Get('host')
  async getHost(@CurrentUser() user: AuthenticatedUser) {
    if (!user.tenantId) throw new ForbiddenException('SYSTEMS_OPS_TENANT_SCOPE_REQUIRED');
    const snapshot = await this.store.read(user.tenantId);
    if (!snapshot) return { available: false as const };
    const ageMinutes = Math.max(0, Math.round((Date.now() - new Date(snapshot.capturedAt).getTime()) / 60000));
    return {
      available: true as const,
      ageMinutes,
      snapshot,
      status: hostStatus({ ...snapshot, ageMinutes }),
    };
  }
}
