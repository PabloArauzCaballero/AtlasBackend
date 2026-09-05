/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Repara los expedientes que faltan y limpia lo que ya no debe estar guardado.
 * @system dispara a mano los dos trabajos idempotentes del expediente, por lotes.
 */
import { Controller, Headers, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { requireIdempotencyKey } from '../../common/utils/http/headers.util.js';
import { ExpedientesMantenimientoService } from '../expedientes/jobs/expedientes-mantenimiento.service.js';

/**
 * Los dos trabajos de fondo del expediente, en su propio controlador.
 *
 * Viven aparte de `RuntimeJobsController` por tamaño —ese archivo ya rozaba el límite del gate— y
 * porque no comparten nada con él salvo la ruta y los guardias: no llevan cuerpo, no validan Zod y
 * no reciben el usuario. Meterlos allí obligaba a leer cuarenta líneas de un dominio ajeno para
 * entender los otros nueve jobs.
 */
@ApiTags('runtime-jobs')
@ApiBearerAuth('access-token')
@Controller('operations/jobs')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('admin', 'platform_admin', 'system')
export class ExpedientesJobsController {
  constructor(private readonly expedientes: ExpedientesMantenimientoService) {}

  /**
   * El tenant lo resuelve `@CurrentTenant()`; aquí sólo queda exigir la clave de idempotencia, que
   * es lo que impide que un doble clic del operador lance el lote dos veces.
   */
  private exigirCabeceras(tenantId: string, idempotencyKey: string | undefined): string {
    requireIdempotencyKey(idempotencyKey);
    return tenantId;
  }

  /**
   * Rellena los expedientes de los clientes que ya existían.
   *
   * Se dispara a mano y por lotes, no en cada arranque: sobre una base con clientes reales es un
   * recorrido largo, y lanzarlo solo en un despliegue lo pondría a competir con el tráfico del día.
   * Es idempotente — se puede repetir hasta que devuelva cero.
   */
  @ApiOperation({
    summary: 'Rellenar expedientes de clientes existentes',
    description: 'Job de mantenimiento idempotente. Restringido a admin/platform_admin/system.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiResponse({ status: 200, description: 'Cuántos clientes, nodos y objetos ausentes procesó el lote.' })
  @Post('backfill-expedientes')
  @HttpCode(HttpStatus.OK)
  backfillExpedientes(
    @CurrentTenant() tenantId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
  ) {
    this.exigirCabeceras(tenantId, idempotencyKey);
    return this.expedientes.rellenar();
  }

  @ApiOperation({
    summary: 'Limpiar papelera, tickets vencidos y expedientes con retención cumplida',
    description: 'Job de mantenimiento. Sólo borra objetos que ninguna otra tabla referencia.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiResponse({ status: 200, description: 'Cuántos tickets, nodos y expedientes se purgaron.' })
  @Post('limpiar-expedientes')
  @HttpCode(HttpStatus.OK)
  limpiarExpedientes(
    @CurrentTenant() tenantId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
  ) {
    this.exigirCabeceras(tenantId, idempotencyKey);
    return this.expedientes.limpiar();
  }
}
