/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza controla quién puede operar Atlas y deja evidencia de cada asignación de privilegios.
 * @system expone las sesiones abiertas del personal interno y el cierre de las de una persona.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodObjectPropertySchemas, zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { RequestWithNetwork, requestMeta } from '../../common/utils/http/headers.util.js';
import { InternalPermissionsGuard } from './guards/internal-permissions.guard.js';
import { InternalPermissions } from './internal-permissions.decorator.js';
import { InternalSessionsService } from './internal-sessions.service.js';
import {
  ListInternalSessionsQueryDto,
  RevokeInternalSessionsDto,
  listInternalSessionsQuerySchema,
  revokeInternalSessionsSchema,
} from './internal-sessions.schemas.js';
import { InternalUserParamsDto, internalUserParamsSchema } from './internal-users.schemas.js';

/**
 * Bajo `internal/sessions` y no `internal/users/sessions`: ahí la ruta `internal/users/:internalUserId`
 * capturaría «sessions» como identificador y respondería 400.
 */
@ApiTags('internal-users')
@ApiBearerAuth('access-token')
@Controller('internal')
@UseGuards(JwtAuthGuard, InternalPermissionsGuard)
export class InternalSessionsController {
  constructor(private readonly sessionsService: InternalSessionsService) {}

  @ApiOperation({
    summary: 'Listar sesiones abiertas del personal interno',
    description:
      'Una fila por sesión abierta (token de refresco sin revocar y sin vencer) de las personas del tenant, de la ' +
      'renovación más reciente a la más antigua. `activeNow` indica que la sesión se renovó dentro de la última hora.',
  })
  @ApiQuery({ name: 'page', required: false, schema: zodObjectPropertySchemas(listInternalSessionsQuerySchema).page })
  @ApiQuery({ name: 'limit', required: false, schema: zodObjectPropertySchemas(listInternalSessionsQuerySchema).limit })
  @ApiResponse({ status: 200, description: 'Lista paginada de sesiones abiertas con su resumen.' })
  @Get('sessions')
  @InternalPermissions('internal.sessions.read')
  list(
    @Query(new ZodValidationPipe(listInternalSessionsQuerySchema)) query: ListInternalSessionsQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.sessionsService.listOpenSessions(currentUser, query);
  }

  @ApiOperation({
    summary: 'Cerrar todas las sesiones de un usuario interno',
    description:
      'Revoca sus tokens de refresco y sube su versión de token, así que también el access token ya emitido deja de ' +
      'valer en la siguiente petición. Exige motivo y queda auditado como internal_users.sessions.revoke. No sobre uno mismo.',
  })
  @ApiParam({ name: 'internalUserId', schema: zodToApiSchema(internalUserParamsSchema.shape.internalUserId) })
  @ApiBody({ schema: zodToApiSchema(revokeInternalSessionsSchema) })
  @ApiResponse({ status: 200, description: 'Sesiones cerradas; devuelve cuántas había abiertas.' })
  @ApiResponse({ status: 403, description: 'Sobre uno mismo, o cuenta privilegiada sin SUPER_ADMIN.' })
  @ApiResponse({ status: 404, description: 'INTERNAL_USER_NOT_FOUND.' })
  @Post('users/:internalUserId/sessions/revoke')
  @InternalPermissions('internal.users.manage')
  @HttpCode(HttpStatus.OK)
  revoke(
    @Param(new ZodValidationPipe(internalUserParamsSchema)) params: InternalUserParamsDto,
    @Body(new ZodValidationPipe(revokeInternalSessionsSchema)) body: RevokeInternalSessionsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    return this.sessionsService.revokeSessions(currentUser, params.internalUserId, body, requestMeta(request));
  }
}
