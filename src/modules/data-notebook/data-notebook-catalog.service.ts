/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza abre los datos gobernados al análisis sin dejar que nadie los altere ni los extraiga en claro.
 * @system resuelve qué columnas tiene cada dataset y por cuál se acota el inquilino.
 */
import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ReadQueryService } from '../../common/database/read-query.service.js';
import { NOTEBOOK_DATASETS, NOTEBOOK_SCHEMA, NOTEBOOK_TENANT_COLUMNS, NotebookDataset } from './data-notebook.constants.js';

export type DatasetShape = {
  dataset: NotebookDataset;
  /** Columnas reales de la vista, en el orden en que las declara. */
  columns: { name: string; dataType: string }[];
  /** Columna por la que se acota el inquilino, o `null` en un dataset de plataforma. */
  tenantColumn: string | null;
};

type ColumnRow = { column_name: string; data_type: string };

type DiscoveredRow = { table_name: string; has_tenant: boolean | null };

/** Vista de `read_api` que existe pero el cuaderno no sirve, con el motivo. */
export type OmittedDataset = { view: string; reason: string };

/**
 * Ficha por omisión de una vista que nadie describió.
 *
 * `v_customer_overview_v1` → código `customer-overview`, rótulo «Customer overview». El sufijo de
 * versión se cae del código A PROPÓSITO: es el contrato de la vista, no parte de su nombre, y
 * arrastrarlo obligaría a reescribir todos los cuadernos guardados el día que salga `_v2`.
 */
function describeDiscovered(view: string): NotebookDataset {
  const base = view.replace(/^v_/, '').replace(/_v\d+$/, '');
  const words = base.replace(/_/g, ' ');
  return {
    code: base.replace(/_/g, '-'),
    view,
    label: words.charAt(0).toUpperCase() + words.slice(1),
    description: `Vista ${NOTEBOOK_SCHEMA}.${view}, descubierta en la base. Acotada por inquilino.`,
    scope: 'TENANT',
  };
}

/**
 * La forma de un dataset se descubre contra `information_schema`, no se declara a mano.
 *
 * Una lista de columnas escrita en el código es correcta el día que se escribe y deja de serlo en
 * la primera migración que añada una columna a la vista, sin que nada lo avise: el cuaderno
 * seguiría publicando un esquema que ya no es el de los datos que sirve, y las columnas nuevas —las
 * que nadie clasificó todavía— viajarían sin política de enmascarado. Preguntándole al catálogo de
 * Postgres, la vista y su descripción no pueden divergir.
 */
@Injectable()
export class DataNotebookCatalogService {
  /** La forma de una vista cambia con una migración, no entre peticiones: se cachea por proceso. */
  private readonly shapes = new Map<string, DatasetShape>();

  constructor(private readonly readQuery: ReadQueryService) {}

  /**
   * El catálogo se DESCUBRE de `read_api`, y la lista escrita a mano pasa a ser sólo la ficha.
   *
   * Antes eran siete vistas enumeradas en el código: publicar una vista nueva significaba tocar
   * una constante en este repositorio y volver a desplegar, así que el cuaderno enseñaba menos
   * datos de los que la base ya servía y nadie se enteraba —el catálogo se veía completo—.
   * Preguntando a `information_schema`, lo que hay en la base es lo que se ofrece.
   *
   * Lo que NO se deduce es el alcance, y ésa es la línea que sostiene todo lo demás. Una vista
   * descubierta se sirve si publica columna de inquilino, y entonces va acotada por ella. Si no la
   * publica, no se sirve por descubrimiento: hace falta que alguien la haya declarado
   * `PLATFORM` en `NOTEBOOK_DATASETS`, que es una firma. Deducir «sin columna de inquilino =
   * de plataforma» convertiría cualquier migración que quitase `tenant_id` en una fuga entre
   * organizaciones, en silencio y con el catálogo en verde.
   *
   * Se devuelven también las descartadas: un catálogo que encoge sin decirlo se lee como que la
   * base tiene menos datos, y manda a buscar el problema donde no está.
   */
  async listDatasets(): Promise<{ datasets: NotebookDataset[]; omitted: OmittedDataset[] }> {
    const rows = await this.readQuery.select<DiscoveredRow>(
      `SELECT v.table_name,
              bool_or(c.column_name IN (:tenantColumns)) AS has_tenant
         FROM information_schema.views v
         LEFT JOIN information_schema.columns c
                ON c.table_schema = v.table_schema AND c.table_name = v.table_name
        WHERE v.table_schema = :schema
        GROUP BY v.table_name
        ORDER BY v.table_name`,
      { schema: NOTEBOOK_SCHEMA, tenantColumns: [...NOTEBOOK_TENANT_COLUMNS] },
    );

    const datasets: NotebookDataset[] = [];
    const omitted: OmittedDataset[] = [];

    for (const row of rows) {
      const declared = NOTEBOOK_DATASETS.find((candidate) => candidate.view === row.table_name);
      if (declared) {
        datasets.push(declared);
        continue;
      }
      if (row.has_tenant) {
        datasets.push(describeDiscovered(row.table_name));
        continue;
      }
      omitted.push({
        view: row.table_name,
        reason:
          `No publica ${NOTEBOOK_TENANT_COLUMNS.join(' ni ')}, así que no hay por dónde acotar el ` +
          'inquilino. Para servirla hay que declararla de plataforma en el catálogo del cuaderno.',
      });
    }

    return { datasets, omitted };
  }

  async findDataset(code: string): Promise<NotebookDataset> {
    const { datasets } = await this.listDatasets();
    const dataset = datasets.find((candidate) => candidate.code === code);
    if (!dataset) {
      throw new NotFoundException(`El dataset «${code}» no existe en el catálogo del cuaderno.`);
    }
    return dataset;
  }

  async describe(code: string): Promise<DatasetShape> {
    const cached = this.shapes.get(code);
    if (cached) return cached;

    const dataset = await this.findDataset(code);
    const rows = await this.readQuery.select<ColumnRow>(
      `SELECT column_name, data_type
         FROM information_schema.columns
        WHERE table_schema = :schema AND table_name = :view
        ORDER BY ordinal_position`,
      { schema: NOTEBOOK_SCHEMA, view: dataset.view },
    );

    if (rows.length === 0) {
      // La vista está en el catálogo del código pero no en la base: casi siempre una migración sin
      // correr. Se dice eso exactamente, porque «dataset vacío» mandaría a buscar el fallo en los
      // datos y no en el despliegue.
      throw new ServiceUnavailableException(
        `La vista ${NOTEBOOK_SCHEMA}.${dataset.view} no existe en esta base. Corre las migraciones (yarn db:migration:up) y vuelve a intentarlo.`,
      );
    }

    const columns = rows.map((row) => ({ name: row.column_name, dataType: row.data_type }));
    const tenantColumn = NOTEBOOK_TENANT_COLUMNS.find((candidate) => columns.some((column) => column.name === candidate)) ?? null;

    if (dataset.scope === 'TENANT' && !tenantColumn) {
      // El dataset se DECLARÓ por inquilino y la vista no publica por dónde acotarlo: servirlo
      // sería entregar datos de otras organizaciones. Se prefiere que no esté disponible — un
      // cuaderno con una vista menos es un defecto visible, y una fuga entre inquilinos no lo es
      // hasta que alguien la encuentra.
      throw new ServiceUnavailableException(
        `El dataset «${dataset.code}» se declaró por inquilino, pero ${NOTEBOOK_SCHEMA}.${dataset.view} no publica ` +
          `${NOTEBOOK_TENANT_COLUMNS.join(' ni ')}. No se sirve hasta que alguien decida por escrito si es de plataforma.`,
      );
    }

    const shape: DatasetShape = {
      dataset,
      columns,
      // Un dataset de plataforma se sirve entero A PROPÓSITO, y por eso ignora la columna aunque
      // exista: lo que decide es la declaración del catálogo, no lo que la vista tenga ese día.
      tenantColumn: dataset.scope === 'TENANT' ? tenantColumn : null,
    };
    this.shapes.set(code, shape);
    return shape;
  }

  /**
   * Traduce el orden pedido a una columna REAL de la vista.
   *
   * Devuelve el nombre ya verificado contra `information_schema`, que es lo que permite
   * interpolarlo en el `ORDER BY` —un identificador no admite parámetro en Postgres—. La
   * comprobación no es una validación de forma: es lo que hace que el único texto interpolado en
   * toda la consulta provenga del catálogo del servidor y nunca del cuerpo de la petición.
   */
  resolveOrderColumn(shape: DatasetShape, requested: string | undefined): string | null {
    if (!requested) return null;
    const match = shape.columns.find((column) => column.name === requested);
    return match ? match.name : null;
  }
}
