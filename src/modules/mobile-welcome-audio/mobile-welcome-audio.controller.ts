/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza pone la voz de la marca en el momento en que alguien entra a la app.
 * @system expone el par encargar/consultar y la descarga del audio ya generado.
 */
import { Controller, Get, HttpCode, HttpStatus, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser } from '../../common/types/auth.types.js';
import { MobileWelcomeAudioService } from './mobile-welcome-audio.service.js';
import { welcomeAudioIdParamsSchema, type WelcomeAudioIdParamsDto } from './mobile-welcome-audio.schemas.js';

/**
 * La locución de bienvenida del móvil.
 *
 * Tres endpoints porque generar una voz tarda: se encarga, se pregunta y se descarga. Un endpoint
 * único que esperara al audio colgaría la petición durante la síntesis —segundos— justo en el
 * arranque de la app, que es el peor momento posible para ocupar una conexión.
 *
 * No recibe NINGÚN dato: el nombre que se dice sale del perfil del cliente autenticado. Ver el
 * servicio.
 */
@ApiTags('mobile-welcome-audio')
@Controller('mobile/welcome-audio')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class MobileWelcomeAudioController {
  constructor(private readonly service: MobileWelcomeAudioService) {}

  /*
   * Tres al minuto. Es un endpoint que dispara una llamada FACTURADA a un proveedor de voz, así que
   * el tope es más estricto que el de un formulario. Tres deja sitio a un reintento legítimo —la
   * app se cerró y se volvió a abrir— y corta en seco un bucle mal escrito antes de que consuma la
   * cuota de locución de todo el inquilino.
   */
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  @Roles('customer')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Encargar el saludo de bienvenida de quien acaba de entrar',
    description:
      'Pide al worker de locución del motor la bienvenida con el nombre del cliente AUTENTICADO. No acepta ningún dato: el nombre ' +
      'se lee del perfil vigente. Devuelve el identificador con el que consultar y descargar. Si la frase ya se locutó alguna vez ' +
      'con esta misma voz, el motor sirve la que había y no genera nada.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: false, description: 'Opcional: se toma del token.' })
  @ApiResponse({ status: 202, description: 'Aceptada — devuelve requestId y estado PENDING o READY.' })
  @ApiResponse({ status: 503, description: 'WELCOME_AUDIO_NOT_CONFIGURED — esta instalación no tiene el worker conectado.' })
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  start(@CurrentTenant() tenantId: string, @CurrentUser() currentUser: AuthenticatedUser) {
    return this.service.start(tenantId, exigirCliente(currentUser));
  }

  @Roles('customer')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Consultar si el saludo ya se puede reproducir',
    description:
      'PENDING mientras se genera, READY cuando hay audio, UNAVAILABLE si hoy no va a haber saludo. `UNAVAILABLE` NO es un error: ' +
      'el móvil entra en silencio y no muestra nada.',
  })
  @ApiParam({ name: 'requestId', description: 'El identificador devuelto al encargar la locución.' })
  @ApiResponse({ status: 200, description: 'Estado actual de la locución.' })
  @ApiResponse({ status: 404, description: 'WELCOME_AUDIO_NOT_FOUND — no existe, o ya caducó.' })
  @Get(':requestId')
  get(
    @CurrentTenant() tenantId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param(new ZodValidationPipe(welcomeAudioIdParamsSchema)) params: WelcomeAudioIdParamsDto,
  ) {
    return this.service.get(tenantId, params.requestId, exigirCliente(currentUser));
  }

  /**
   * Los bytes del audio, por la puerta autenticada.
   *
   * No se emite ninguna URL firmada: una URL firmada reproduce el saludo sin pasar por el guardián
   * durante todo su tiempo de vida, así que quien la comparte comparte la locución. Aquí el permiso
   * se decide en cada petición, y además nunca sale del servidor la credencial con la que se habla
   * con el motor.
   *
   * Va `inline` porque lo que se espera de un audio es reproducirlo. El móvil lo guarda en su caché
   * y se lo da a su reproductor.
   */
  @Roles('customer')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Descargar el audio del saludo' })
  @ApiParam({ name: 'requestId', description: 'El identificador devuelto al encargar la locución.' })
  @ApiResponse({ status: 200, description: 'Los bytes del audio.' })
  @ApiResponse({ status: 404, description: 'WELCOME_AUDIO_NOT_READY — todavía no hay audio que servir.' })
  @Get(':requestId/audio')
  async audio(
    @CurrentTenant() tenantId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param(new ZodValidationPipe(welcomeAudioIdParamsSchema)) params: WelcomeAudioIdParamsDto,
    @Res() response: Response,
  ): Promise<void> {
    const audio = await this.service.audio(tenantId, params.requestId, exigirCliente(currentUser));
    response.setHeader('Content-Type', audio.mimeType);
    response.setHeader('Content-Disposition', 'inline; filename="atlas-bienvenida.mp3"');
    /*
     * Sin caché intermedia. El saludo lleva el nombre de una persona: un proxy que lo guarde y lo
     * sirva a la siguiente petición estaría entregando el nombre de alguien a quien no le
     * corresponde. El móvil sí lo guarda, pero en su propio almacenamiento privado.
     */
    response.setHeader('Cache-Control', 'no-store, private');
    response.send(audio.bytes);
  }
}

/**
 * Un actor `customer` sin `customerId` en el token no puede tener saludo.
 *
 * No debería ocurrir —`RolesGuard` ya restringe la ruta a ese rol— pero el token es un dato de
 * entrada y el `?? ''` silencioso convertiría un token raro en una consulta de perfil con id vacío.
 */
function exigirCliente(currentUser: AuthenticatedUser): string {
  const customerId = currentUser.customerId;
  if (!customerId) {
    throw new Error('El token de un cliente no trae customerId.');
  }
  return customerId;
}
