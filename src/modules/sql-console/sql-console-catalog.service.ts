/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza deja consultar los datos gobernados sin poder alterarlos ni extraer credenciales.
 * @system publica qué tablas y columnas de read_api puede consultar la consola SQL.
 */
import { Injectable } from '@nestjs/common';
import { ReadQueryService } from '../../common/database/read-query.service.js';
import { SQL_CONSOLE_LIMITS, SQL_CONSOLE_SCHEMA } from './sql-console.constants.js';

export type CatalogColumn = { name: string; kind: string; description: string };
export type CatalogTable = { name: string; description: string; grain: string; columns: CatalogColumn[] };
export type CatalogDataset = { name: string; description: string; tables: CatalogTable[] };

type ColumnRow = { table_name: string; column_name: string; data_type: string };

/**
 * Etiquetas de los datasets, agrupando las vistas de `read_api` por dominio.
 *
 * El agrupado es de PRODUCTO, no técnico: quien abre la consola busca «clientes», no
 * `v_customer_overview_v1`. La clave es el prefijo de la vista y el valor lo que se enseña.
 */
const DOMINIOS: ReadonlyArray<{ prefijo: string; dataset: string; descripcion: string; grano: string }> = [
  {
    prefijo: 'v_customer',
    dataset: 'clientes',
    descripcion: 'Panorama por cliente: estado, consentimientos, casos abiertos y última evaluación.',
    grano: 'Una fila = un cliente.',
  },
  {
    prefijo: 'v_risk',
    dataset: 'riesgo_backend',
    descripcion: 'Evaluaciones de riesgo con su desenlace, puntaje y motivo.',
    grano: 'Una fila = una evaluación ejecutada.',
  },
  {
    prefijo: 'v_operations',
    dataset: 'operaciones',
    descripcion: 'Cola de revisiones manuales abiertas, por prioridad y antigüedad.',
    grano: 'Una fila = un caso abierto.',
  },
  {
    prefijo: 'v_provider',
    dataset: 'proveedores',
    descripcion: 'Último estado observado de cada proveedor externo.',
    grano: 'Una fila = un proveedor.',
  },
  {
    prefijo: 'v_notification',
    dataset: 'notificaciones',
    descripcion: 'Envíos por canal y desenlace de entrega.',
    grano: 'Una fila = un envío.',
  },
  {
    prefijo: 'v_system',
    dataset: 'plataforma',
    descripcion: 'Catálogo técnico de endpoints con su cobertura de pruebas.',
    grano: 'Una fila = un endpoint.',
  },
  {
    prefijo: 'v_audit',
    dataset: 'auditoria_backend',
    descripcion: 'Eventos de auditoría en orden cronológico inverso.',
    grano: 'Una fila = un evento registrado.',
  },
];

/**
 * El catálogo se DESCUBRE contra `information_schema`, no se escribe a mano.
 *
 * Una lista de columnas en el código es correcta el día que se escribe y deja de serlo en la
 * primera migración que toque una vista, sin que nada avise: el explorador seguiría ofreciendo
 * columnas que ya no existen, y quien las usara recibiría un error de SQL en vez de un catálogo
 * honesto. Preguntándole a Postgres, la vista y su descripción no pueden divergir.
 */
@Injectable()
export class SqlConsoleCatalogService {
  private cache: CatalogDataset[] | null = null;

  constructor(private readonly readQuery: ReadQueryService) {}

  async datasets(): Promise<CatalogDataset[]> {
    if (this.cache) return this.cache;

    const filas = await this.readQuery.select<ColumnRow>(
      `SELECT table_name, column_name, data_type
         FROM information_schema.columns
        WHERE table_schema = :schema
        ORDER BY table_name, ordinal_position`,
      { schema: SQL_CONSOLE_SCHEMA },
    );

    const porTabla = new Map<string, CatalogColumn[]>();
    for (const fila of filas) {
      const columnas = porTabla.get(fila.table_name) ?? [];
      columnas.push({
        name: fila.column_name,
        kind: tipoDe(fila.data_type),
        description: `${fila.data_type} en ${SQL_CONSOLE_SCHEMA}.${fila.table_name}`,
      });
      porTabla.set(fila.table_name, columnas);
    }

    const datasets = new Map<string, CatalogDataset>();
    for (const [tabla, columnas] of porTabla) {
      const dominio = DOMINIOS.find((candidato) => tabla.startsWith(candidato.prefijo));
      // Una vista sin dominio declarado NO desaparece: cae en «otros» para que se vea que existe.
      // Ocultarla dejaría una superficie consultable que el explorador no menciona, que es la
      // clase de invisibilidad que este repositorio persigue en otros gates.
      const nombre = dominio?.dataset ?? 'otros';
      const dataset = datasets.get(nombre) ?? {
        name: nombre,
        description: dominio?.descripcion ?? 'Vistas de read_api sin dominio declarado.',
        tables: [],
      };
      dataset.tables.push({
        name: tabla,
        description: `Vista ${SQL_CONSOLE_SCHEMA}.${tabla}`,
        grain: dominio?.grano ?? 'Una fila = un registro de la vista.',
        columns: columnas,
      });
      datasets.set(nombre, dataset);
    }

    this.cache = [...datasets.values()].sort((a, b) => a.name.localeCompare(b.name));
    return this.cache;
  }

  limits() {
    return {
      maxRows: SQL_CONSOLE_LIMITS.maxRows,
      timeoutMs: SQL_CONSOLE_LIMITS.timeoutMs,
      maxStatementBytes: SQL_CONSOLE_LIMITS.maxStatementBytes,
    };
  }
}

/** Traduce el tipo de Postgres al vocabulario que la consola ya usa para pintar columnas. */
function tipoDe(dataType: string): string {
  if (/^(bigint|integer|smallint)$/.test(dataType)) return 'entero';
  if (/^(numeric|double precision|real)$/.test(dataType)) return 'numero';
  if (dataType === 'boolean') return 'booleano';
  if (/date|timestamp/.test(dataType)) return 'fecha';
  if (dataType === 'uuid') return 'identificador';
  return 'texto';
}
