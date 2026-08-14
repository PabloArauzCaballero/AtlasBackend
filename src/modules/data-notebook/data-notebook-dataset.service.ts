/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza abre los datos gobernados al análisis sin dejar que nadie los altere ni los extraiga en claro.
 * @system sirve páginas de un dataset del cuaderno, acotadas por inquilino y con la PII enmascarada.
 */
import { Injectable } from '@nestjs/common';
import { ReadQueryService } from '../../common/database/read-query.service.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { DataNotebookCatalogService, DatasetShape } from './data-notebook-catalog.service.js';
import { applyColumnPolicies, describeColumns, NotebookColumnDescriptor } from './data-notebook-masking.js';
import { DATA_NOTEBOOK_LIMITS, DATA_NOTEBOOK_REVEAL_ROLES, NOTEBOOK_SCHEMA } from './data-notebook.constants.js';

export type DatasetPageQuery = {
  page: number;
  pageSize: number;
  orderBy?: string;
  orderDirection: 'ASC' | 'DESC';
};

export type DatasetPage = {
  dataset: { code: string; label: string; view: string };
  columns: NotebookColumnDescriptor[];
  rows: Record<string, unknown>[];
  page: number;
  pageSize: number;
  /** Filas contadas. Si `totalIsExact` es falso, hay al menos este número: se dejó de contar. */
  total: number;
  totalIsExact: boolean;
  /** Si alguna columna viaja enmascarada, y por tanto no sirve para comparar valores exactos. */
  masked: boolean;
};

type CountRow = { total: string | number };

@Injectable()
export class DataNotebookDatasetService {
  constructor(
    private readonly catalog: DataNotebookCatalogService,
    private readonly readQuery: ReadQueryService,
  ) {}

  async readPage(code: string, query: DatasetPageQuery, user: AuthenticatedUser): Promise<DatasetPage> {
    const shape = await this.catalog.describe(code);
    const reveal = DATA_NOTEBOOK_REVEAL_ROLES.includes(user.role);
    const columns = describeColumns(
      shape.columns.map((column) => column.name),
      reveal,
    );

    const pageSize = Math.min(query.pageSize, DATA_NOTEBOOK_LIMITS.maxPageSize);
    const offset = (query.page - 1) * pageSize;
    const tenantId = user.tenantId ?? null;

    const [rows, total] = await Promise.all([
      this.selectRows(shape, { ...query, pageSize }, tenantId, offset),
      this.countRows(shape, tenantId),
    ]);

    return {
      dataset: { code: shape.dataset.code, label: shape.dataset.label, view: shape.dataset.view },
      columns,
      rows: applyColumnPolicies(rows, columns),
      page: query.page,
      pageSize,
      total: total.value,
      totalIsExact: total.exact,
      masked: columns.some((column) => column.policy !== 'PLAIN'),
    };
  }

  private async selectRows(
    shape: DatasetShape,
    query: DatasetPageQuery,
    tenantId: string | null,
    offset: number,
  ): Promise<Record<string, unknown>[]> {
    const orderColumn = this.catalog.resolveOrderColumn(shape, query.orderBy);
    // El identificador ya salió de `information_schema`; la dirección es una de dos constantes.
    // Nada de lo que se concatena aquí procede del cuerpo de la petición.
    const orderClause = orderColumn ? `ORDER BY ${quoteIdentifier(orderColumn)} ${query.orderDirection}` : '';

    return this.readQuery.select<Record<string, unknown>>(
      `SELECT * FROM ${this.relation(shape)}
        ${this.tenantFilter(shape)}
        ${orderClause}
        LIMIT :limit OFFSET :offset`,
      { tenantId, limit: query.pageSize, offset },
    );
  }

  /**
   * El filtro de inquilino, o nada en un dataset de plataforma.
   *
   * `:tenantId` se sigue pasando aunque la cláusula no exista: un parámetro de más es inocuo y
   * quitar la clave del objeto según la forma de la consulta era una segunda cosa que mantener
   * sincronizada con la primera.
   */
  private tenantFilter(shape: DatasetShape): string {
    return shape.tenantColumn ? `WHERE ${quoteIdentifier(shape.tenantColumn)} = :tenantId` : '';
  }

  /**
   * Cuenta hasta un techo y luego se detiene.
   *
   * Un `count(*)` sin cota sobre una vista con varios millones de filas recorre la tabla entera
   * para producir un número que en pantalla sólo sirve para dibujar el paginador. Se cuenta hasta
   * `countCeiling` y se informa de que el total es un mínimo (`totalIsExact: false`), que es
   * honesto y le cuesta a la base lo que vale la respuesta.
   */
  private async countRows(shape: DatasetShape, tenantId: string | null): Promise<{ value: number; exact: boolean }> {
    const rows = await this.readQuery.select<CountRow>(
      `SELECT count(*) AS total
         FROM (SELECT 1 FROM ${this.relation(shape)}
                ${this.tenantFilter(shape)}
                LIMIT :ceiling) AS bounded`,
      { tenantId, ceiling: DATA_NOTEBOOK_LIMITS.countCeiling },
    );

    const value = Number(rows[0]?.total ?? 0);
    return { value, exact: value < DATA_NOTEBOOK_LIMITS.countCeiling };
  }

  private relation(shape: DatasetShape): string {
    return `${quoteIdentifier(NOTEBOOK_SCHEMA)}.${quoteIdentifier(shape.dataset.view)}`;
  }
}

/**
 * Entrecomilla un identificador ya verificado.
 *
 * No es la defensa contra la inyección —esa es que el nombre venga del catálogo del servidor— sino
 * lo que evita que una columna llamada `order` o `user` rompa la sentencia. Duplicar la comilla
 * interna es la regla de Postgres y se aplica igualmente: una defensa que depende de que la capa
 * anterior nunca falle no es una defensa.
 */
function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
