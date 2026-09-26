/**
 * @file Las piezas compartidas de la copia de semillas: sus tipos y el citado de identificadores.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system nombra tablas y columnas de forma segura para componer SQL.
 */

/**
 * Vive aparte para ROMPER UN CICLO: la orquestación (`seed-sync.ts`) y la introspección
 * (`seed-sync.introspection.ts`) se necesitan mutuamente, y estas tres funciones y estos tipos son
 * lo único que ambas comparten. Un archivo de hojas, sin imports, no puede formar ciclo con nadie.
 */
export interface TableRef {
  readonly schema: string;
  readonly name: string;
  readonly rows: number;
}
export interface ColumnRef {
  readonly name: string;
  readonly type: string;
  readonly alwaysIdentity: boolean;
}
export interface ForeignKeyRef {
  readonly schema: string;
  readonly table: string;
  readonly name: string;
  readonly definition: string;
}

export const quoteIdentifier = (identifier: string): string => `"${identifier.replace(/"/g, '""')}"`;
export const quoteTable = (table: { schema: string; name: string }): string =>
  `${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)}`;
export const tableKey = (table: { schema: string; name: string }): string => `${table.schema}.${table.name}`;
