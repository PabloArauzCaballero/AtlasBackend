/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza abre los datos gobernados al análisis sin dejar que nadie los altere ni los extraiga en claro.
 * @system publica el catálogo de datasets del cuaderno y sus páginas de datos.
 */
import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
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
import { DataNotebookDocumentService } from './data-notebook-document.service.js';
import { DataNotebookHistoryService } from './data-notebook-history.service.js';
import { describeColumns } from './data-notebook-masking.js';
import { DATA_NOTEBOOK_LIMITS, DATA_NOTEBOOK_REVEAL_ROLES, DATA_NOTEBOOK_ROLES } from './data-notebook.constants.js';
import {
  notebookDatasetParamsSchema,
  NotebookDatasetParamsDto,
  notebookDocumentParamsSchema,
  NotebookDocumentParamsDto,
  notebookDocumentSchema,
  NotebookDocumentDto,
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
    private readonly documents: DataNotebookDocumentService,
  ) {}

  @ApiOperation({ summary: 'Listar los datasets gobernados que el cuaderno puede cargar' })
  @ApiResponse({ status: 200, description: 'Catálogo de datasets y techos vigentes.' })
  @Get('datasets')
  async listDatasets(@CurrentUser() user: AuthenticatedUser) {
    const { datasets, omitted } = await this.catalog.listDatasets();
    return {
      datasets,
      // Las vistas que existen y NO se sirven viajan con su motivo. Un catálogo que encoge en
      // silencio se lee como que la base tiene menos datos de los que tiene.
      omitted,
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
  @ApiQuery({ name: 'limit', required: false, description: 'Entradas por página.' })
  @ApiQuery({ name: 'offset', required: false, description: 'Cuántas entradas se saltan.' })
  @ApiResponse({
    status: 200,
    description: 'Página del historial de quien pregunta, con el total para poder paginarla.',
  })
  @Get('history')
  listHistory(
    @Query(new ZodValidationPipe(notebookHistoryQuerySchema)) query: NotebookHistoryQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.history.listOwn(user, query.limit, query.offset);
  }

  @ApiOperation({ summary: 'Leer una página de un dataset, acotada por inquilino y enmascarada' })
  @ApiParam({ name: 'code', description: 'Código del dataset en el catálogo del cuaderno.' })
  @ApiQuery({ name: 'page', required: false, description: 'Página a devolver, empezando en 1.', schema: rowsQueryProperties.page })
  @ApiQuery({ name: 'pageSize', required: false, description: 'Filas por página.', schema: rowsQueryProperties.pageSize })
  @ApiQuery({
    name: 'orderBy',
    required: false,
    description: 'Columna por la que ordenar. Sólo se admiten columnas del dataset gobernado.',
    schema: rowsQueryProperties.orderBy,
  })
  @ApiQuery({
    name: 'orderDirection',
    required: false,
    description: 'Sentido del orden: ascendente o descendente.',
    schema: rowsQueryProperties.orderDirection,
  })
  @ApiResponse({ status: 200, description: 'Página de filas con sus columnas y el total acotado.' })
  @Get('datasets/:code/rows')
  readRows(
    @Param(new ZodValidationPipe(notebookDatasetParamsSchema)) params: NotebookDatasetParamsDto,
    @Query(new ZodValidationPipe(notebookRowsQuerySchema)) query: NotebookRowsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.datasets.readPage(params.code, query, user);
  }

  /*
   * Los cuadernos guardados de QUIEN PREGUNTA.
   *
   * Las cinco operaciones toman el dueño del token, nunca de la ruta ni del cuerpo. No hay un
   * `?owner=` que alguien pueda probar a cambiar, y por eso tampoco hay una comprobación de
   * propiedad que se pueda olvidar en el endpoint siguiente: un cuaderno de otra persona
   * simplemente no aparece en la consulta.
   */
  @ApiOperation({ summary: 'Listar los cuadernos guardados por quien pregunta' })
  @ApiResponse({ status: 200, description: 'Cuadernos propios, del más reciente al más antiguo.' })
  @Get('notebooks')
  listNotebooks(@CurrentUser() user: AuthenticatedUser) {
    return this.documents.listOwn(user);
  }

  @ApiOperation({ summary: 'Guardar un cuaderno nuevo' })
  @ApiBody({ schema: zodToApiSchema(notebookDocumentSchema) })
  @ApiResponse({ status: 201, description: 'Cuaderno creado.' })
  @Post('notebooks')
  createNotebook(@Body(new ZodValidationPipe(notebookDocumentSchema)) body: NotebookDocumentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.documents.create(body, user);
  }

  @ApiOperation({ summary: 'Abrir un cuaderno propio con todas sus celdas' })
  @ApiParam({ name: 'id', description: 'Identificador del cuaderno.' })
  @ApiResponse({ status: 200, description: 'Cuaderno con sus celdas.' })
  @Get('notebooks/:id')
  readNotebook(
    @Param(new ZodValidationPipe(notebookDocumentParamsSchema)) params: NotebookDocumentParamsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.findOne(params.id, user);
  }

  @ApiOperation({ summary: 'Guardar los cambios de un cuaderno propio' })
  @ApiParam({ name: 'id', description: 'Identificador del cuaderno.' })
  @ApiBody({ schema: zodToApiSchema(notebookDocumentSchema) })
  @ApiResponse({ status: 200, description: 'Cuaderno actualizado.' })
  @Put('notebooks/:id')
  updateNotebook(
    @Param(new ZodValidationPipe(notebookDocumentParamsSchema)) params: NotebookDocumentParamsDto,
    @Body(new ZodValidationPipe(notebookDocumentSchema)) body: NotebookDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.update(params.id, body, user);
  }

  @ApiOperation({ summary: 'Borrar un cuaderno propio' })
  @ApiParam({ name: 'id', description: 'Identificador del cuaderno.' })
  @ApiResponse({ status: 200, description: 'Si existía y se borró.' })
  @Delete('notebooks/:id')
  deleteNotebook(
    @Param(new ZodValidationPipe(notebookDocumentParamsSchema)) params: NotebookDocumentParamsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.remove(params.id, user);
  }
}
