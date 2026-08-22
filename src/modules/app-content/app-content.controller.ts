/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza entrega a la app lo que el cliente lee, sin que haya que publicar una versión.
 * @system expone el catálogo de contenidos por pantalla e idioma.
 */
import { Controller, Get, Headers, Query, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodObjectPropertySchemas } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { tenantIdFromHeader } from '../../common/utils/http/headers.util.js';
import { AppContentService } from './app-content.service.js';
import { listContentQuerySchema, type ListContentQueryDto } from './app-content.schemas.js';

@ApiTags('app-content')
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class AppContentController {
  constructor(private readonly service: AppContentService) {}

  /*
   * Público a propósito. La bienvenida, las preguntas frecuentes y el botón de ayuda se leen ANTES
   * de que exista una sesión: quien no consigue entrar es justamente quien más necesita el enlace de
   * soporte, y exigir token para leerlo dejaría fuera al único caso que importa.
   */
  @Public()
  @ApiOperation({
    summary: 'Contenido de la app por pantalla',
    description:
      'Todo lo que la app enseña y no es un dato del cliente: pasos de bienvenida, preguntas frecuentes, ayuda y ' +
      'enlaces legales. Estaba escrito en el código de la app, así que cambiar una frase exigía publicar en las ' +
      'tiendas y esperar a que cada persona actualizara. Las acciones vienen resueltas (el enlace de WhatsApp ya ' +
      'trae el prefijo del país) para que la app no tenga que componer nada.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiQuery({ name: 'surface', required: false, schema: zodObjectPropertySchemas(listContentQuerySchema).surface })
  @ApiQuery({ name: 'locale', required: false, schema: zodObjectPropertySchemas(listContentQuerySchema).locale })
  @ApiResponse({ status: 200, description: 'Piezas de contenido activas, ordenadas para pintar.' })
  @Get('app-content')
  list(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Query(new ZodValidationPipe(listContentQuerySchema)) query: ListContentQueryDto,
  ) {
    return this.service.listPublic(tenantIdFromHeader(tenantIdHeader), query);
  }
}
