/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza deja consultar los datos gobernados sin poder alterarlos ni extraer credenciales.
 * @system publica el catálogo, la validación, la ejecución y el historial de la consola SQL.
 */
import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { DataNotebookHistoryService } from '../data-notebook/data-notebook-history.service.js';
import { SqlConsoleCatalogService } from './sql-console-catalog.service.js';
import { SqlConsoleQueryService } from './sql-console-query.service.js';
import { SQL_CONSOLE_LIMITS, SQL_CONSOLE_ROLES } from './sql-console.constants.js';

/**
 * La consulta viaja SIEMPRE en el cuerpo, incluso para validar.
 *
 * En la cadena de consulta acabaría en el registro de acceso, en el proxy y en la traza —tres
 * sitios pensados para conservarse— y una consulta de análisis lleva dentro justo lo que se estaba
 * buscando. El verbo lo decide dónde puede viajar el dato, no si la operación es idempotente.
 */
const statementSchema = z.object({
  statement: z.string().trim().min(1).max(SQL_CONSOLE_LIMITS.maxStatementBytes),
});

type StatementDto = z.infer<typeof statementSchema>;

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(SQL_CONSOLE_LIMITS.historyPageSize).default(25),
});

type HistoryQueryDto = z.infer<typeof historyQuerySchema>;

/**
 * La misma forma que publica la consola del motor, a propósito.
 *
 * El portal ya tiene un explorador, un editor y tres vistas de resultado escritos contra ese
 * contrato. Publicar aquí una forma distinta habría obligado a duplicar toda esa pantalla para
 * enseñar los mismos datos, y a mantener dos veces cada arreglo. Hablando su idioma, el mismo
 * componente sirve las dos fuentes y la persona no tiene que aprender dos consolas.
 */
@ApiTags('sql-console')
@ApiBearerAuth('access-token')
@Controller('sql-console')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...SQL_CONSOLE_ROLES)
export class SqlConsoleController {
  constructor(
    private readonly catalog: SqlConsoleCatalogService,
    private readonly queries: SqlConsoleQueryService,
    private readonly history: DataNotebookHistoryService,
  ) {}

  @ApiOperation({ summary: 'Catálogo de datasets, tablas y columnas consultables de read_api' })
  @ApiResponse({ status: 200, description: 'Catálogo y techos vigentes.' })
  @Get('catalog')
  async catalogo() {
    return { datasets: await this.catalog.datasets(), limits: this.catalog.limits() };
  }

  @ApiOperation({ summary: 'Validar una consulta sin leer una sola fila' })
  @ApiBody({ schema: zodToApiSchema(statementSchema) })
  @ApiResponse({ status: 200, description: 'Validación, con sus violaciones o su estimación.' })
  @Post('validate')
  validar(@Body(new ZodValidationPipe(statementSchema)) body: StatementDto) {
    return this.queries.validate(body.statement);
  }

  @ApiOperation({ summary: 'Ejecutar una consulta de solo lectura sobre read_api' })
  @ApiBody({ schema: zodToApiSchema(statementSchema) })
  @ApiResponse({ status: 200, description: 'Filas, columnas y estimación del plan.' })
  @Post('query')
  async ejecutar(@Body(new ZodValidationPipe(statementSchema)) body: StatementDto, @CurrentUser() user: AuthenticatedUser) {
    try {
      const resultado = await this.queries.execute(body.statement, user);
      // Se registra la CONSULTA, nunca sus filas: mismo criterio y misma tabla que el cuaderno.
      await this.history.record(
        {
          language: 'sql',
          source: body.statement,
          rowCount: resultado.rowCount,
          durationMs: resultado.durationMs,
          status: 'ok',
        },
        user,
      );
      return resultado;
    } catch (error) {
      // Una consulta rechazada también deja rastro. Es la mitad interesante del historial: enseña
      // qué se intentó consultar y no se pudo, que es donde se ve si alguien está tanteando.
      await this.history.record(
        {
          language: 'sql',
          source: body.statement,
          status: 'error',
          errorMessage: error instanceof Error ? error.message.slice(0, 500) : 'Error desconocido',
        },
        user,
      );
      throw error;
    }
  }

  @ApiOperation({ summary: 'Historial PROPIO de consultas, sin resultados' })
  @ApiResponse({ status: 200, description: 'Últimas consultas de quien pregunta.' })
  @Get('history')
  async historial(@Query(new ZodValidationPipe(historyQuerySchema)) query: HistoryQueryDto, @CurrentUser() user: AuthenticatedUser) {
    // `listOwn` devuelve ahora la página y su total, porque el cuaderno pagina su historial. Aquí
    // sólo interesan las filas: esta consola filtra por lenguaje DESPUÉS de leerlas, así que su
    // total tampoco coincidiría con lo que acaba enseñando.
    const { rows: filas } = await this.history.listOwn(user, query.limit);
    return {
      entries: filas
        .filter((fila) => fila.language === 'sql')
        .map((fila) => ({
          id: fila.id,
          statement: fila.source,
          outcome: fila.status === 'ok' ? 'SUCCEEDED' : 'FAILED',
          errorCode: fila.errorMessage,
          rowCount: fila.rowCount,
          durationMs: fila.durationMs,
          truncated: false,
          relations: [],
          executedAt: fila.createdAt,
        })),
    };
  }
}
