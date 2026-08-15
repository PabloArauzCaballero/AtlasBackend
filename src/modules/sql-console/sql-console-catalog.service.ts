/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza deja consultar los datos gobernados sin poder alterarlos ni extraer credenciales.
 * @system publica qué esquemas, tablas y columnas puede consultar la consola SQL.
 */
import { Injectable } from '@nestjs/common';
import { ReadQueryService } from '../../common/database/read-query.service.js';
import { SQL_CONSOLE_LIMITS, SQL_CONSOLE_SCHEMAS, SQL_FORBIDDEN_RELATIONS } from './sql-console.constants.js';

export type CatalogColumn = { name: string; kind: string; description: string };
export type CatalogTable = { name: string; description: string; grain: string; columns: CatalogColumn[] };
export type CatalogDataset = { name: string; description: string; tables: CatalogTable[] };

type RelacionRow = { table_schema: string; table_name: string; table_type: string };
type ColumnaRow = { table_schema: string; table_name: string; column_name: string; data_type: string };

/**
 * Qué es cada esquema, en una línea.
 *
 * El explorador enseña el nombre técnico —`case_management`, `platform_ops`— y por sí solo no dice
 * nada a quien busca «los casos de fraude». La descripción es lo que convierte una lista de
 * esquemas en un mapa.
 */
const DESCRIPCIONES: Readonly<Record<string, string>> = {
  read_api: 'Superficie de lectura gobernada y versionada. Ya viene desidentificada: empieza aquí.',
  customer: 'Clientes, sus datos de contacto, dispositivos y ciclo de vida.',
  credit: 'Solicitudes de crédito, préstamos, cuotas y pagos.',
  risk: 'Evaluaciones de riesgo, políticas, límites y señales.',
  case_management: 'Revisiones manuales y casos de fraude abiertos.',
  privacy: 'Consentimientos, derechos del titular y retención.',
  telemetry: 'Comportamiento observado: sesiones, dispositivos, señales de uso.',
  catalog: 'Catálogos del dominio: códigos, motivos, tipos y sus versiones.',
  iam: 'Identidad interna: usuarios, roles y permisos. Sin credenciales: ésas no se sirven.',
  audit: 'Bitácora de auditoría y registro de acciones.',
  integrations: 'Proveedores externos, su salud y sus respuestas.',
  messaging: 'Notificaciones, plantillas y entregas.',
  platform_ops: 'Operación de la propia plataforma: trabajos, pruebas, catálogo técnico.',
  public: 'Tablas sin dominio asignado.',
};

const PROHIBIDAS = new Set<string>(SQL_FORBIDDEN_RELATIONS);

/**
 * El catálogo se DESCUBRE contra `information_schema`, no se escribe a mano.
 *
 * Antes publicaba sólo las siete vistas de `read_api` y la consola se veía vacía al lado de una
 * base con 158 relaciones: quien buscaba préstamos, consentimientos o casos de fraude no
 * encontraba nada y concluía, con razón, que la herramienta no servía. Un catálogo que enseña
 * menos de lo que se puede consultar es tan engañoso como uno que enseña de más.
 *
 * `read_api` sigue primero en la lista y con su descripción diciendo por qué: es la superficie
 * versionada y ya desidentificada. Las tablas base son consultables, pero en ellas el enmascarado
 * depende de la heurística por nombre de columna, no de un trabajo de desidentificación hecho a
 * propósito — y eso hay que saberlo antes de elegir de dónde leer.
 */
@Injectable()
export class SqlConsoleCatalogService {
  private cache: CatalogDataset[] | null = null;

  constructor(private readonly readQuery: ReadQueryService) {}

  async datasets(): Promise<CatalogDataset[]> {
    if (this.cache) return this.cache;

    const [relaciones, columnas] = await Promise.all([
      this.readQuery.select<RelacionRow>(
        `SELECT table_schema, table_name, table_type
           FROM information_schema.tables
          WHERE table_schema = ANY(:schemas)
          ORDER BY table_schema, table_name`,
        { schemas: [...SQL_CONSOLE_SCHEMAS] },
      ),
      this.readQuery.select<ColumnaRow>(
        `SELECT table_schema, table_name, column_name, data_type
           FROM information_schema.columns
          WHERE table_schema = ANY(:schemas)
          ORDER BY table_schema, table_name, ordinal_position`,
        { schemas: [...SQL_CONSOLE_SCHEMAS] },
      ),
    ]);

    const porRelacion = new Map<string, CatalogColumn[]>();
    for (const columna of columnas) {
      const clave = `${columna.table_schema}.${columna.table_name}`;
      const lista = porRelacion.get(clave) ?? [];
      lista.push({
        name: columna.column_name,
        kind: tipoDe(columna.data_type),
        description: columna.data_type,
      });
      porRelacion.set(clave, lista);
    }

    const datasets = new Map<string, CatalogDataset>();
    for (const relacion of relaciones) {
      // Las relaciones prohibidas no se listan siquiera: enseñarlas y luego rechazarlas al
      // consultarlas invita a intentarlo, y deja en el catálogo un rótulo que dice dónde están las
      // credenciales.
      if (PROHIBIDAS.has(relacion.table_name.toLowerCase())) continue;

      const dataset = datasets.get(relacion.table_schema) ?? {
        name: relacion.table_schema,
        description: DESCRIPCIONES[relacion.table_schema] ?? 'Esquema sin descripción declarada.',
        tables: [],
      };
      dataset.tables.push({
        name: relacion.table_name,
        description: relacion.table_type === 'VIEW' ? 'Vista' : 'Tabla',
        // El grano honesto: no se conoce sin leer la definición, y afirmarlo a la ligera sería
        // peor que no decirlo — un `COUNT(*)` sobre un grano equivocado engaña sin fallar.
        grain: `Una fila = un registro de ${relacion.table_schema}.${relacion.table_name}.`,
        columns: porRelacion.get(`${relacion.table_schema}.${relacion.table_name}`) ?? [],
      });
      datasets.set(relacion.table_schema, dataset);
    }

    // `read_api` primero: es la superficie que este repositorio versiona y verifica, y la que
    // alguien debería usar salvo que sepa por qué necesita otra cosa.
    this.cache = [...datasets.values()].sort((a, b) => {
      if (a.name === 'read_api') return -1;
      if (b.name === 'read_api') return 1;
      return a.name.localeCompare(b.name);
    });
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
