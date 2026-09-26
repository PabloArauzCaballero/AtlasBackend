/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza recibe la agenda y el rastro de ubicación que el cliente autorizó a compartir desde su teléfono.
 * @system valida el lote, comprueba consentimiento y propiedad del dispositivo, y delega la escritura.
 */
import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { CustomerAddressBookService } from './application/customer-address-book.service.js';
import { CustomerLocationTrackingService } from './application/customer-location-tracking.service.js';
import {
  addressBookSyncSchema,
  AddressBookSyncDto,
  deviceSignalsCustomerParamsSchema,
  DeviceSignalsCustomerParamsDto,
  locationPingBatchSchema,
  LocationPingBatchDto,
} from './customer-device-signals.schemas.js';

type RequestWithIp = { ip?: string };

/**
 * Las dos señales que el dispositivo entrega con permiso explícito.
 *
 * Van bajo `/customers/:id` y no bajo `/customer-onboarding` porque no son del alta: la agenda se
 * resincroniza y la ubicación se registra durante toda la vida de la cuenta. El snapshot AGREGADO de
 * la agenda sigue donde estaba —es una señal del expediente de alta— y estos dos endpoints no lo
 * sustituyen: conviven, y el agregado se puede seguir enviando aunque no haya consentimiento para
 * guardar las fichas.
 */
@ApiTags('customer-device-signals')
@ApiBearerAuth('access-token')
@Controller('customers/:customerId')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
export class CustomerDeviceSignalsController {
  constructor(
    private readonly addressBookService: CustomerAddressBookService,
    private readonly locationService: CustomerLocationTrackingService,
  ) {}

  /*
   * Treinta lotes por minuto: una agenda de 15.000 contactos son treinta lotes de 500, y ése es el
   * caso extremo real. Más que eso no es una sincronización, es un bucle.
   */
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @ApiOperation({
    summary: 'Sincronizar la agenda del dispositivo',
    description:
      'Recibe la ficha COMPLETA de cada contacto —nombre, teléfonos, correos, empresa, cumpleaños y direcciones— y la guarda ' +
      'cifrada. Exige consentimiento vigente para la finalidad `device_address_book` (`CONSENT_NOT_GRANTED` si falta) y que el ' +
      'dispositivo esté vinculado al cliente. La agenda se trocea en lotes de hasta 500 contactos; sólo el último lleva ' +
      '`isFinalBatch`. Un contacto ya conocido se ACTUALIZA por su identificador de origen, no se duplica. No devuelve análisis.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(deviceSignalsCustomerParamsSchema.shape.customerId) })
  @ApiBody({ schema: zodToApiSchema(addressBookSyncSchema) })
  @ApiResponse({ status: 202, description: 'Lote recibido — cuántas fichas se crearon y cuántas se actualizaron.' })
  @ApiResponse({ status: 403, description: 'El token no permite operar sobre este cliente, o el dispositivo no es suyo.' })
  @ApiResponse({ status: 404, description: 'Cliente no encontrado.' })
  @ApiResponse({ status: 422, description: 'CONSENT_NOT_GRANTED — no hay consentimiento vigente para guardar la agenda.' })
  @Post('address-book')
  @HttpCode(HttpStatus.ACCEPTED)
  syncAddressBook(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(deviceSignalsCustomerParamsSchema)) params: DeviceSignalsCustomerParamsDto,
    @Body(new ZodValidationPipe(addressBookSyncSchema)) body: AddressBookSyncDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithIp,
  ) {
    return this.addressBookService.sync({
      tenantId,
      customerId: params.customerId,
      body,
      currentUser,
      ipAddress: request.ip ?? null,
    });
  }

  @ApiOperation({
    summary: 'Borrar la agenda guardada de este cliente',
    description:
      'Borrado FÍSICO de todas las fichas guardadas. Es lo que promete el texto del consentimiento al retirarlo, y por eso no ' +
      'es un borrado lógico: una fila marcada como borrada seguiría conteniendo el nombre y el teléfono de cada contacto. La ' +
      'constancia de que la agenda existió queda en `on_device_computation_runs`, que no guarda ningún dato personal.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(deviceSignalsCustomerParamsSchema.shape.customerId) })
  @ApiResponse({ status: 200, description: 'Agenda borrada — cuántas fichas se eliminaron.' })
  @ApiResponse({ status: 403, description: 'El token no permite operar sobre este cliente.' })
  @ApiResponse({ status: 404, description: 'Cliente no encontrado.' })
  @Delete('address-book')
  @HttpCode(HttpStatus.OK)
  purgeAddressBook(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(deviceSignalsCustomerParamsSchema)) params: DeviceSignalsCustomerParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithIp,
  ) {
    return this.addressBookService.purge({
      tenantId,
      customerId: params.customerId,
      currentUser,
      ipAddress: request.ip ?? null,
    });
  }

  /*
   * Sesenta lotes por minuto. El rastreo normal manda uno cada pocos minutos; el tope está para el
   * reenvío de lo acumulado sin red, que puede llegar en ráfaga al recuperar cobertura.
   */
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @ApiOperation({
    summary: 'Registrar un lote de posiciones del dispositivo',
    description:
      'Recibe hasta 200 posiciones fechadas con el reloj DEL TELÉFONO, para que un lote acumulado sin cobertura no se aplaste ' +
      'contra la hora de llegada. Exige consentimiento vigente para `location_tracking`. El reenvío de un lote ya recibido no ' +
      'duplica el rastro: se responde `duplicated`. La distancia al domicilio declarado la calcula el servidor.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(deviceSignalsCustomerParamsSchema.shape.customerId) })
  @ApiBody({ schema: zodToApiSchema(locationPingBatchSchema) })
  @ApiResponse({ status: 202, description: 'Lote recibido — cuántas posiciones se guardaron y cuántas venían repetidas.' })
  @ApiResponse({ status: 403, description: 'El token no permite operar sobre este cliente, o el dispositivo no es suyo.' })
  @ApiResponse({ status: 404, description: 'Cliente no encontrado.' })
  @ApiResponse({ status: 422, description: 'CONSENT_NOT_GRANTED — no hay consentimiento vigente para registrar la ubicación.' })
  @Post('location-pings')
  @HttpCode(HttpStatus.ACCEPTED)
  ingestLocationPings(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(deviceSignalsCustomerParamsSchema)) params: DeviceSignalsCustomerParamsDto,
    @Body(new ZodValidationPipe(locationPingBatchSchema)) body: LocationPingBatchDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithIp,
  ) {
    return this.locationService.ingest({
      tenantId,
      customerId: params.customerId,
      body,
      currentUser,
      ipAddress: request.ip ?? null,
    });
  }
}
