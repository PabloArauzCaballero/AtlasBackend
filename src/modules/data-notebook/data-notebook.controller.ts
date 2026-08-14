/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza abre los datos gobernados al análisis sin dejar que nadie los altere ni los extraiga en claro.
 * @system publica el catálogo de datasets del cuaderno y sus páginas de datos.
 */
import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { zodObjectPropertySchemas, zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { DataNotebookCatalogService } from './data-notebook-catalog.service.js';
import { DataNotebookDatasetService } from './data-notebook-dataset.service.js';
import { DataNotebookHistoryService } from './data-notebook-history.service.js';
import { describeColumns } from './data-notebook-masking.js';
import { DATA_NOTEBOOK_LIMITS, DATA_NOTEBOOK_REVEAL_ROLES, DATA_NOTEBOOK_ROLES } from './data-notebook.constants.js';
import {
  notebookDatasetParamsSchema,
  NotebookDatasetParamsDto,
  notebookHistoryEntrySchema,
  NotebookHistoryEntryDto,
  notebookHistoryQuerySchema,
  NotebookHistoryQueryDto,
  notebookRowsQuerySchema,
  NotebookRowsQueryDto,
} from './data-notebook.schemas.js';

const rowsQueryProperties = zodObjectPropertySchemas(notebookRowsQuerySchema);

/**
 * Aquí no se ejecuta código, y el único POST tampoco lo hace.
 *
 * El Python y el JavaScript del cuaderno corren en el navegador de quien los escribe (Pyodide y
 * un Web Worker), nunca aquí: abrir un cuaderno de análisis no le añade al backend una superficie
 * de ejecución remota, que es exactamente el riesgo que suele traer una herramienta con esta forma.
 *
 * `POST /history` recibe el TEXTO de una celda para guardarlo y jamás lo interpreta. Es la
 * distinción que hay que tener presente al tocar este archivo: si algún día alguien añade aquí un
 * `eval`, un `spawn` o una llamada a un ejecutor, la propiedad de arriba deja de ser cierta y toda
 * la arquitectura del módulo —que se apoya en ella— pasa a estar mal argumentada.
 */
@ApiTags('data-notebook')
@ApiBearerAuth('access-token')
@Controller('data-notebook')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...DATA_NOTEBOOK_ROLES)
export class DataNotebookController {
  constructor(
    private readonly catalog: DataNotebookCatalogService,
    private readonly datasets: DataNotebookDatasetService,
    private readonly history: DataNotebookHistoryService,
  ) {}

  @ApiOperation({ summary: 'Listar los datasets gobernados que el cuaderno puede cargar' })
  @ApiResponse({ status: 200, description: 'Catálogo de datasets y techos vigentes.' })
  @Get('datasets')
  listDatasets(@CurrentUser() user: AuthenticatedUser) {
    return {
      datasets: this.catalog.listDatasets(),
      limits: DATA_NOTEBOOK_LIMITS,
      // Que la pantalla sepa de antemano si verá dato en claro evita el peor malentendido de una
      // herramienta de análisis: creer que se comparan valores cuando se comparan máscaras.
      reveal: DATA_NOTEBOOK_REVEAL_ROLES.includes(user.role),
    };
  }

  @ApiOperation({ summary: 'Describir las columnas de un dataset y su política de enmascarado' })
  @ApiParam({ name: 'code', description: 'Código del dataset en el catálogo del cuaderno.' })
  @ApiResponse({ status: 200, description: 'Columnas del dataset con su política.' })
  @Get('datasets/:code/schema')
  async describeDataset(
    @Param(new ZodValidationPipe(notebookDatasetParamsSchema)) params: NotebookDatasetParamsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const shape = await this.catalog.describe(params.code);
    const reveal = DATA_NOTEBOOK_REVEAL_ROLES.includes(user.role);
    const policies = describeColumns(
      shape.columns.map((column) => column.name),
      reveal,
    );

    return {
      dataset: shape.dataset,
      columns: shape.columns.map((column, index) => ({ ...column, ...policies[index] })),
    };
  }

  @ApiOperation({ summary: 'Registrar en el historial una celda ejecutada (nunca su resultado)' })
  @ApiBody({ schema: zodToApiSchema(notebookHistoryEntrySchema) })
  @ApiResponse({ status: 201, description: 'Entrada registrada.' })
  @Post('history')
  recordHistory(
    @Body(new ZodValidationPipe(notebookHistoryEntrySchema)) body: NotebookHistoryEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.history.record(body, user);
  }

  @ApiOperation({ summary: 'Listar el historial PROPIO de consultas del cuaderno' })
  @ApiResponse({ status: 200, description: 'Últimas celdas ejecutadas por quien pregunta.' })
  @Get('history')
  listHistory(
    @Query(new ZodValidationPipe(notebookHistoryQuerySchema)) query: NotebookHistoryQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.history.listOwn(user, query.limit);
  }

  @ApiOperation({ summary: 'Leer una página de un dataset, acotada por inquilino y enmascarada' })
  @ApiParam({ name: 'code', description: 'Código del dataset en el catálogo del cuaderno.' })
  @ApiQuery({ name: 'page', required: false, schema: rowsQueryProperties.page })
  @ApiQuery({ name: 'pageSize', required: false, schema: rowsQueryProperties.pageSize })
  @ApiQuery({ name: 'orderBy', required: false, schema: rowsQueryProperties.orderBy })
  @ApiQuery({ name: 'orderDirection', required: false, schema: rowsQueryProperties.orderDirection })
  @ApiResponse({ status: 200, description: 'Página de filas con sus columnas y el total acotado.' })
  @Get('datasets/:code/rows')
  readRows(
    @Param(new ZodValidationPipe(notebookDatasetParamsSchema)) params: NotebookDatasetParamsDto,
    @Query(new ZodValidationPipe(notebookRowsQuerySchema)) query: NotebookRowsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.datasets.readPage(params.code, query, user);
  }
}
