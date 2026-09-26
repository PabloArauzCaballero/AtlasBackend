/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza responde dudas de uso de la app sin hacer esperar a una persona del equipo.
 * @system expone el chat del asistente y la conversación vigente del cliente autenticado.
 */
import { Body, Controller, Get, HttpCode, HttpException, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser } from '../../common/types/auth.types.js';
import { AssistService } from './assist.service.js';
import { assistChatSchema, type AssistChatDto } from './assist.schemas.js';

/**
 * Atlas Assist en el móvil: el botón de ayuda que contesta al momento.
 *
 * Dos endpoints y ninguno más: preguntar y rehidratar el hilo al abrir la hoja. El asistente vive
 * en AtlasAIService y NO ve la cuenta de nadie; este controlador existe para que la app le hable
 * con su sesión de siempre mientras la clave de servicio se queda en el servidor.
 *
 * Toda la superficie contesta 404 con `ASSIST_ENABLED` apagada: la app lo lee como «esconde el
 * botón», que es lo que permite desplegar backend y app sin acoplar sus tiempos.
 */
@ApiTags('mobile-assist')
@Controller('mobile/assist')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class AssistController {
  constructor(private readonly service: AssistService) {}

  /*
   * Diez al minuto. Cada pregunta es una llamada FACTURADA al proveedor de IA, así que el tope es
   * más estricto que el de un formulario; diez deja conversar con calma y corta un bucle mal
   * escrito antes de que consuma el presupuesto del día.
   */
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Roles('customer')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Preguntarle al asistente de la app',
    description:
      'Reenvía la pregunta al asistente de IA con una referencia opaca del cliente AUTENTICADO; el asistente no ve la cuenta ' +
      'ni recibe el token. `clientMessageId` es la clave de idempotencia: el móvil reintenta con la MISMA y recoge la ' +
      'respuesta ya guardada en vez de generar otra.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: false, description: 'Opcional: se toma del token.' })
  @ApiResponse({ status: 200, description: 'La respuesta del asistente, con su conversación y turno.' })
  @ApiResponse({ status: 404, description: 'ASSIST_DISABLED — el asistente está apagado; la app esconde el botón.' })
  @ApiResponse({
    status: 409,
    description: 'ASSIST_IN_FLIGHT — la misma consulta sigue en curso; reintentar con el mismo clientMessageId.',
  })
  @ApiResponse({ status: 429, description: 'ASSIST_BUSY — tope de consultas simultáneas o de mensajes por minuto.' })
  @ApiResponse({ status: 503, description: 'ASSIST_UNAVAILABLE — el asistente no contesta; la app ofrece el chat humano.' })
  @Post('chat')
  @HttpCode(200)
  async chat(
    @CurrentTenant() tenantId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body(new ZodValidationPipe(assistChatSchema)) body: AssistChatDto,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): unknown },
  ) {
    try {
      return await this.service.chat(tenantId, exigirCliente(currentUser), body);
    } catch (error) {
      // El 409 y el 429 son «vuelve en un momento», y la cabecera es lo que hace ese momento
      // concreto: el móvil espera esos segundos en vez de inventarse los suyos.
      if (error instanceof HttpException && [409, 429].includes(error.getStatus())) response.setHeader('Retry-After', '2');
      throw error;
    }
  }

  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Roles('customer')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'La conversación vigente con el asistente',
    description:
      'Los últimos turnos del hilo más reciente, en orden cronológico, para rehidratar la hoja al abrirla. Si el historial ' +
      'no se puede leer se contesta el hilo vacío: no poder leer lo de ayer no impide preguntar hoy.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: false, description: 'Opcional: se toma del token.' })
  @ApiResponse({ status: 200, description: 'El hilo vigente, o vacío si no hay conversaciones.' })
  @ApiResponse({ status: 404, description: 'ASSIST_DISABLED — el asistente está apagado; la app esconde el botón.' })
  @Get('conversation')
  conversation(@CurrentTenant() tenantId: string, @CurrentUser() currentUser: AuthenticatedUser) {
    return this.service.conversation(tenantId, exigirCliente(currentUser));
  }
}

/**
 * Un actor `customer` sin `customerId` en el token no tiene conversación que continuar.
 *
 * No debería ocurrir —`RolesGuard` ya restringe la ruta a ese rol— pero el token es un dato de
 * entrada, y un `?? ''` silencioso partiría el historial de conversaciones en un hilo anónimo
 * compartido por todos los tokens raros.
 */
function exigirCliente(currentUser: AuthenticatedUser): string {
  const customerId = currentUser.customerId;
  if (!customerId) {
    throw new Error('El token de un cliente no trae customerId.');
  }
  return customerId;
}
