/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza responde dudas de uso de los portales de Atlas sin hacer esperar a una persona del equipo.
 * @system expone el chat del asistente en los portales y decide qué superficie puede usar cada usuario.
 */
import { Body, Controller, ForbiddenException, Get, HttpCode, HttpException, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { createHash } from 'node:crypto';
import { Throttle } from '@nestjs/throttler';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AtlasUserRole, AuthenticatedUser } from '../../common/types/auth.types.js';
import { AssistService, type PortalAssistActor } from './assist.service.js';
import {
  MERCHANT_ASSIST_SURFACE,
  PORTAL_ASSIST_SURFACES,
  portalAssistChatSchema,
  portalAssistConversationQuerySchema,
  type PortalAssistChatDto,
  type PortalAssistConversationQueryDto,
  type PortalAssistSurface,
} from './assist.schemas.js';

/**
 * El personal interno: los roles con los que se entra a operaciones, al ERP del personal, al Motor
 * y a Tableros. Es la misma familia que `INTERNAL_PORTAL_ROLES` del portal de operaciones.
 * `system` no está porque es una máquina, y una máquina no abre el botón de ayuda.
 */
export const ASSIST_STAFF_ROLES = [
  'internal_operator',
  'risk_analyst',
  'compliance_analyst',
  'fraud_analyst',
  'admin',
  'platform_admin',
  'system_admin',
  'qa_engineer',
  'devops',
  'readonly_auditor',
] as const satisfies readonly AtlasUserRole[];

/**
 * El usuario de comercio (`PARTNER_USER` en soporte): el que entra al portal de comercio del ERP.
 * Es una lista, y no un texto suelto, para que el inventario de endpoints de Systems Ops resuelva
 * el `@Roles(...)` de estas rutas: sólo sabe expandir listas.
 */
export const ASSIST_PARTNER_ROLES = ['merchant'] as const satisfies readonly AtlasUserRole[];

/**
 * El tope es por PERSONA, no por IP. El ERP y Tableros llegan aquí desde su propio backend, así que
 * todas sus preguntas comparten IP: con la clave por defecto, diez preguntas al minuto serían para
 * todo el portal. El limitador corre antes que `JwtAuthGuard` y todavía no hay `req.user`; la
 * credencial que trae la petición identifica igual a la persona, y se guarda sólo su hash.
 */
export function rastreoPorPersona(req: Record<string, unknown>): Promise<string> {
  const headers = (req.headers ?? {}) as Record<string, string | string[] | undefined>;
  const authorization = Array.isArray(headers.authorization) ? headers.authorization[0] : headers.authorization;
  if (authorization) return Promise.resolve(`assist:${createHash('sha256').update(authorization).digest('hex').slice(0, 32)}`);
  return Promise.resolve(String(req.ip ?? 'sin-ip'));
}

/**
 * Atlas Assist en los portales: el mismo asistente de la app, una superficie por portal.
 *
 * Los portales no hablan con AtlasAIService: llaman aquí con su sesión de siempre (operaciones y
 * Tableros por su proxy `/api/v1`, el Motor por `atlas-backend`, el ERP desde su backend) y Core
 * reenvía con la clave de servicio. La superficie viaja en el cuerpo o en la consulta, pero NO se
 * le cree al navegador: se comprueba contra el rol del token antes de ponerla en la cabecera que
 * elige el catálogo del otro lado.
 *
 * Con `ASSIST_ENABLED` apagada responde 404, igual que el móvil: el portal esconde el botón.
 */
@ApiTags('internal-assist')
@Controller('internal/assist')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class PortalAssistController {
  constructor(private readonly service: AssistService) {}

  /*
   * Diez al minuto, como en el móvil: cada pregunta es una llamada FACTURADA al proveedor de IA.
   */
  @Throttle({ default: { ttl: 60_000, limit: 10, getTracker: rastreoPorPersona } })
  @Roles(...ASSIST_STAFF_ROLES, ...ASSIST_PARTNER_ROLES)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Preguntarle al asistente del portal',
    description:
      'Reenvía la pregunta al asistente de IA con una referencia opaca `<surface>:<tenantId>:<userId>` y la superficie en ' +
      'cabecera; el asistente no ve el token ni datos de la cuenta. El personal interno puede usar `admin-portal`, ' +
      '`erp-staff`, `risk-portal` y `dashboards`; un usuario de comercio sólo `merchant-portal`. `screen` es la sección ' +
      'del portal en texto corto. `clientMessageId` es la clave de idempotencia: reintentar con la MISMA recoge la ' +
      'respuesta ya guardada. Si el servicio contestó sin modelo, la vista trae `mode: "sin-ia"`.',
  })
  @ApiBody({ schema: zodToApiSchema(portalAssistChatSchema) })
  @ApiHeader({ name: 'x-tenant-id', required: false, description: 'Opcional: se toma del token.' })
  @ApiResponse({ status: 200, description: 'La respuesta del asistente, con su conversación y turno.' })
  @ApiResponse({ status: 403, description: 'ASSIST_SURFACE_FORBIDDEN — esa superficie no es de este tipo de usuario.' })
  @ApiResponse({ status: 404, description: 'ASSIST_DISABLED — el asistente está apagado; el portal esconde el botón.' })
  @ApiResponse({
    status: 409,
    description: 'ASSIST_IN_FLIGHT — la misma consulta sigue en curso; reintentar con el mismo clientMessageId.',
  })
  @ApiResponse({ status: 429, description: 'ASSIST_BUSY — tope de consultas simultáneas o de mensajes por minuto.' })
  @ApiResponse({ status: 503, description: 'ASSIST_UNAVAILABLE — el asistente no contesta.' })
  @Post('chat')
  @HttpCode(200)
  async chat(
    @CurrentTenant() tenantId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body(new ZodValidationPipe(portalAssistChatSchema)) body: PortalAssistChatDto,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): unknown },
  ) {
    const actor = autorizarSuperficie(currentUser, body.surface, tenantId);
    try {
      return await this.service.chatEnPortal(actor, body);
    } catch (error) {
      // Igual que en el móvil: el 409 y el 429 son «vuelve en un momento», y la cabecera dice cuánto.
      if (error instanceof HttpException && [409, 429].includes(error.getStatus())) response.setHeader('Retry-After', '2');
      throw error;
    }
  }

  @Throttle({ default: { ttl: 60_000, limit: 30, getTracker: rastreoPorPersona } })
  @Roles(...ASSIST_STAFF_ROLES, ...ASSIST_PARTNER_ROLES)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'La conversación vigente con el asistente del portal',
    description:
      'Los últimos turnos del hilo más reciente de ESA superficie, en orden cronológico, para rehidratar el panel al ' +
      'abrirlo. Cada portal tiene su hilo. Si el historial no se puede leer se contesta el hilo vacío.',
  })
  @ApiQuery({
    name: 'surface',
    required: true,
    enum: [...PORTAL_ASSIST_SURFACES],
    description: 'El portal desde el que se abre el asistente; tiene que ser una superficie del tipo de usuario del token.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: false, description: 'Opcional: se toma del token.' })
  @ApiResponse({ status: 200, description: 'El hilo vigente, o vacío si no hay conversaciones.' })
  @ApiResponse({ status: 403, description: 'ASSIST_SURFACE_FORBIDDEN — esa superficie no es de este tipo de usuario.' })
  @ApiResponse({ status: 404, description: 'ASSIST_DISABLED — el asistente está apagado; el portal esconde el botón.' })
  @Get('conversation')
  async conversation(
    @CurrentTenant() tenantId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query(new ZodValidationPipe(portalAssistConversationQuerySchema)) query: PortalAssistConversationQueryDto,
  ) {
    return this.service.conversationEnPortal(autorizarSuperficie(currentUser, query.surface, tenantId));
  }
}

/**
 * Qué superficie puede usar quien llama, decidido por el ROL del token y nunca por lo que pida el
 * navegador.
 *
 * - Usuario de comercio (`merchant`): sólo `merchant-portal`. Las superficies internas describen
 *   cómo opera Atlas por dentro, y un comercio no debe poder pedir ese catálogo cambiando un campo.
 * - Personal interno: todas menos `merchant-portal`. No es un secreto, pero su hilo y sus
 *   respuestas estarían redactados para otra audiencia y mezclarían dos historiales.
 * - Cualquier otro rol (`customer`, `system`): ninguna. `RolesGuard` ya lo corta; esto lo repite
 *   para que la regla se sostenga aunque alguien amplíe `@Roles` sin leer aquí.
 *
 * El id de la persona sale del claim de su población. Los usuarios de plataforma llevan prefijo
 * porque su tabla numera aparte y un `platformUserId` 7 no es el `internalUserId` 7: sin prefijo,
 * compartirían hilo en la misma superficie.
 */
export function autorizarSuperficie(currentUser: AuthenticatedUser, surface: PortalAssistSurface, tenantId: string): PortalAssistActor {
  if ((ASSIST_PARTNER_ROLES as readonly string[]).includes(currentUser.role)) {
    if (surface !== MERCHANT_ASSIST_SURFACE) throw superficieAjena(surface);
    return { surface, tenantId, userId: currentUser.merchantUserId ?? currentUser.sub, audience: 'comercio' };
  }
  if ((ASSIST_STAFF_ROLES as readonly string[]).includes(currentUser.role)) {
    if (surface === MERCHANT_ASSIST_SURFACE) throw superficieAjena(surface);
    return { surface, tenantId, userId: idDePersonal(currentUser), audience: 'personal' };
  }
  throw superficieAjena(surface);
}

function idDePersonal(currentUser: AuthenticatedUser): string {
  if (currentUser.internalUserId) return currentUser.internalUserId;
  if (currentUser.platformUserId) return `plataforma-${currentUser.platformUserId}`;
  return currentUser.sub;
}

function superficieAjena(surface: PortalAssistSurface): ForbiddenException {
  return new ForbiddenException({
    code: 'ASSIST_SURFACE_FORBIDDEN',
    message: 'Tu usuario no puede usar el asistente de este portal.',
    surface,
  });
}
