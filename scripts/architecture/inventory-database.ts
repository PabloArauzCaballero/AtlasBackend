/**
 * @file Inventario de propiedad de datos, dependencias SQL y grupos transaccionales (AT-004).
 * @business Antes de separar una base hay que saber quién escribe cada tabla, quién la lee por
 *   detrás (vistas, funciones, disparadores, SQL en cadenas) y qué claves foráneas cruzan un
 *   contexto; el TypeScript solo no lo cuenta.
 * @system Cruza tres fuentes: el catálogo de PostgreSQL (`pg_catalog` / `information_schema`) de una
 *   base migrada, el inventario lógico `ATLAS_DOMAIN_TABLES`, y el registro de modelos por módulo
 *   (`SequelizeModule.forFeature`) más el SQL literal que aparece en `src/`. Escribe
 *   docs/architecture/microservices/data-ownership.json. No modifica la base.
 *
 * Uso: tsx scripts/architecture/inventory-database.ts [--stdout]   (usa las variables DB_* del entorno)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { buildSequelizeOptions } from '../../src/config/database.config.js';
import { ATLAS_DOMAIN_TABLES } from '../../src/database/domain-schemas.js';

export type ForeignKey = {
  name: string;
  fromSchema: string;
  fromTable: string;
  fromColumns: string[];
  toSchema: string;
  toTable: string;
  toColumns: string[];
  crossSchema: boolean;
};

export type CatalogView = { schema: string; name: string; referencedTables: string[] };
export type CatalogTrigger = { schema: string; table: string; name: string; function: string };
export type CatalogFunction = { schema: string; name: string; referencedTables: string[] };
export type TableGrant = { schema: string; table: string; grantee: string; privileges: string[] };

export type DatabaseCatalog = {
  tables: { schema: string; table: string; owner: string }[];
  foreignKeys: ForeignKey[];
  views: CatalogView[];
  triggers: CatalogTrigger[];
  functions: CatalogFunction[];
  grants: TableGrant[];
};

export type StaticRegistry = {
  /** tabla → modelo TypeScript que la mapea. */
  modelByTable: Record<string, string>;
  /** módulo → tablas que registra con forFeature. */
  registrationsByModule: Record<string, string[]>;
  /** módulo → sentencias SQL literales con la tabla y la operación. */
  rawSqlByModule: Record<string, { table: string; operation: string; file: string }[]>;
  /** módulo → archivos que abren transacciones. */
  transactionOpenersByModule: Record<string, string[]>;
};

export type TableOwnership = {
  table: string;
  physicalSchema: string | null;
  logicalSchema: string | null;
  model: string | null;
  ownerCandidate: string | null;
  registrants: string[];
  rawSqlModules: string[];
  incomingForeignKeys: number;
  outgoingForeignKeys: number;
  crossSchemaForeignKeys: number;
  triggers: number;
  readByViews: string[];
  issues: string[];
};

const TABLE_REFERENCE =
  /\b(iam|credit|customer|privacy|telemetry|catalog|risk|case_management|audit|integrations|messaging|platform_ops|read_api)\.([a-z_][a-z0-9_]*)/g;

export async function readCatalog(sequelize: Sequelize): Promise<DatabaseCatalog> {
  const select = <T extends object>(sql: string): Promise<T[]> => sequelize.query<T>(sql, { type: QueryTypes.SELECT });
  const tables = await select<{ schema: string; table: string; owner: string }>(
    `SELECT schemaname AS schema, tablename AS table, tableowner AS owner FROM pg_tables
     WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY 1, 2`,
  );
  const fkRows = await select<{
    name: string;
    from_schema: string;
    from_table: string;
    from_columns: string[];
    to_schema: string;
    to_table: string;
    to_columns: string[];
  }>(
    `SELECT c.conname AS name,
            ns.nspname AS from_schema, s.relname AS from_table,
            ARRAY(SELECT attname FROM pg_attribute WHERE attrelid = c.conrelid AND attnum = ANY(c.conkey)) AS from_columns,
            nt.nspname AS to_schema, t.relname AS to_table,
            ARRAY(SELECT attname FROM pg_attribute WHERE attrelid = c.confrelid AND attnum = ANY(c.confkey)) AS to_columns
     FROM pg_constraint c
     JOIN pg_class s ON s.oid = c.conrelid JOIN pg_namespace ns ON ns.oid = s.relnamespace
     JOIN pg_class t ON t.oid = c.confrelid JOIN pg_namespace nt ON nt.oid = t.relnamespace
     WHERE c.contype = 'f' ORDER BY 2, 3, 1`,
  );
  // Por pg_depend, no por el texto de la vista: `pg_views.definition` omite el schema de las tablas
  // que están en el search_path de la sesión, y esta conexión los lleva todos.
  const viewRows = await select<{ schema: string; name: string; ref: string | null }>(
    `SELECT nv.nspname AS schema, v.relname AS name, nt.nspname || '.' || t.relname AS ref
     FROM pg_class v JOIN pg_namespace nv ON nv.oid = v.relnamespace
     LEFT JOIN pg_rewrite r ON r.ev_class = v.oid
     LEFT JOIN pg_depend d ON d.objid = r.oid AND d.classid = 'pg_rewrite'::regclass AND d.refclassid = 'pg_class'::regclass AND d.refobjid <> v.oid
     LEFT JOIN pg_class t ON t.oid = d.refobjid
     LEFT JOIN pg_namespace nt ON nt.oid = t.relnamespace
     WHERE v.relkind = 'v' AND nv.nspname NOT IN ('pg_catalog','information_schema') ORDER BY 1, 2, 3`,
  );
  const triggerRows = await select<{ schema: string; table: string; name: string; function: string }>(
    `SELECT n.nspname AS schema, c.relname AS table, t.tgname AS name, p.proname AS function
     FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_proc p ON p.oid = t.tgfoid WHERE NOT t.tgisinternal ORDER BY 1, 2, 3`,
  );
  const functionRows = await select<{ schema: string; name: string; source: string }>(
    `SELECT n.nspname AS schema, p.proname AS name, p.prosrc AS source FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname NOT IN ('pg_catalog','information_schema') ORDER BY 1, 2`,
  );
  const grantRows = await select<{ schema: string; table: string; grantee: string; privilege: string }>(
    `SELECT table_schema AS schema, table_name AS table, grantee, privilege_type AS privilege
     FROM information_schema.role_table_grants
     WHERE table_schema NOT IN ('pg_catalog','information_schema') AND grantee LIKE 'atlas%' ORDER BY 1, 2, 3, 4`,
  );

  const references = (text: string): string[] =>
    [...new Set([...text.matchAll(TABLE_REFERENCE)].map((match) => `${match[1]}.${match[2]}`))].sort();
  const grants = new Map<string, TableGrant>();
  for (const row of grantRows) {
    const key = `${row.schema}.${row.table}:${row.grantee}`;
    const entry = grants.get(key) ?? { schema: row.schema, table: row.table, grantee: row.grantee, privileges: [] };
    entry.privileges.push(row.privilege);
    grants.set(key, entry);
  }
  return {
    tables,
    foreignKeys: fkRows.map((row) => ({
      name: row.name,
      fromSchema: row.from_schema,
      fromTable: row.from_table,
      fromColumns: row.from_columns,
      toSchema: row.to_schema,
      toTable: row.to_table,
      toColumns: row.to_columns,
      crossSchema: row.from_schema !== row.to_schema,
    })),
    views: [
      ...viewRows
        .reduce((map, row) => {
          const key = `${row.schema}.${row.name}`;
          const entry = map.get(key) ?? { schema: row.schema, name: row.name, referencedTables: [] as string[] };
          if (row.ref && !entry.referencedTables.includes(row.ref)) entry.referencedTables.push(row.ref);
          return map.set(key, entry);
        }, new Map<string, CatalogView>())
        .values(),
    ],
    triggers: triggerRows,
    functions: functionRows.map((row) => ({ schema: row.schema, name: row.name, referencedTables: references(row.source) })),
    grants: [...grants.values()],
  };
}

const TABLE_DECORATOR = /@Table\(\{\s*tableName:\s*'([^']+)'/;
const CLASS_NAME = /export class (\w+Model)\b/;
const FOR_FEATURE = /SequelizeModule\.forFeature\(\[([\s\S]*?)\]\)/g;
const RAW_SQL =
  /\b(SELECT|INSERT INTO|UPDATE|DELETE FROM|FROM|JOIN)\b[\s\S]{0,80}?\b(iam|credit|customer|privacy|telemetry|catalog|risk|case_management|audit|integrations|messaging|platform_ops|read_api)\.([a-z_][a-z0-9_]*)/g;
// El SQL crudo del repositorio no escribe `schema.tabla` a mano: compone el nombre con
// `atlasSchemaFor('tabla')`. Es la forma real de una consulta directa fuera del ORM.
const SCHEMA_HELPER = /atlasSchemaFor\('([a-z_][a-z0-9_]*)'\)/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) out.push(path);
  }
  return out;
}

export function readStaticRegistry(rootDir: string): StaticRegistry {
  const modelsDir = resolve(rootDir, 'src/database/models');
  const tableByModel = new Map<string, string>();
  for (const file of readdirSync(modelsDir).filter((name) => name.endsWith('.model.ts'))) {
    const source = readFileSync(join(modelsDir, file), 'utf8');
    const table = source.match(TABLE_DECORATOR)?.[1];
    const model = source.match(CLASS_NAME)?.[1];
    if (table && model) tableByModel.set(model, table);
  }
  const modelByTable: Record<string, string> = {};
  for (const [model, table] of tableByModel) modelByTable[table] = model;

  const modulesDir = resolve(rootDir, 'src/modules');
  const registrationsByModule: Record<string, string[]> = {};
  const rawSqlByModule: Record<string, { table: string; operation: string; file: string }[]> = {};
  const transactionOpenersByModule: Record<string, string[]> = {};
  for (const moduleName of readdirSync(modulesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)) {
    const files = walk(join(modulesDir, moduleName));
    const tables = new Set<string>();
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const rel = relative(rootDir, file);
      if (file.endsWith('.module.ts')) {
        for (const match of source.matchAll(FOR_FEATURE)) {
          for (const model of match[1]
            .split(',')
            .map((name) => name.trim())
            .filter(Boolean)) {
            const table = tableByModel.get(model);
            if (table) tables.add(table);
          }
        }
      }
      for (const match of source.matchAll(RAW_SQL)) {
        (rawSqlByModule[moduleName] ??= []).push({ table: `${match[2]}.${match[3]}`, operation: match[1].toUpperCase(), file: rel });
      }
      for (const match of source.matchAll(SCHEMA_HELPER)) {
        const table = match[1];
        const logical = Object.entries(ATLAS_DOMAIN_TABLES).find(([, tables]) => (tables as readonly string[]).includes(table))?.[0] ?? '?';
        (rawSqlByModule[moduleName] ??= []).push({ table: `${logical}.${table}`, operation: 'RAW', file: rel });
      }
      if (/\.transaction\(/.test(source)) (transactionOpenersByModule[moduleName] ??= []).push(rel);
    }
    registrationsByModule[moduleName] = [...tables].sort();
  }
  return { modelByTable, registrationsByModule, rawSqlByModule, transactionOpenersByModule };
}

/** Módulos que, por nombre, son el dueño natural de un schema lógico. Es un CANDIDATO, no un veredicto. */
const SCHEMA_HOME_MODULES: Record<string, string[]> = {
  iam: ['auth', 'internal-users', 'merchant-identity'],
  credit: ['credit', 'loans', 'loan-payment-claims', 'credit-rating', 'partner-onboarding'],
  customer: ['customers', 'customer-onboarding', 'mobile-identity'],
  privacy: ['consents', 'customer-privacy'],
  telemetry: ['sessions', 'customer-telemetry', 'customer-device-signals'],
  catalog: ['catalog-management', 'data-quality', 'app-content'],
  risk: ['risk'],
  case_management: ['fraud', 'operations', 'support', 'expedientes'],
  audit: ['audit', 'log-sync'],
  integrations: ['external-data', 'decision-engine'],
  messaging: ['notifications', 'mail-sender'],
  platform_ops: [
    'runtime-hardening',
    'events',
    'runtime-jobs',
    'systems-ops',
    'schema-management',
    'workflow-catalog',
    'internal-portal',
    'health',
    'sql-console',
    'data-notebook',
    'mobile-welcome-audio',
  ],
};

export type DeclaredOwners = Record<string, string>;

/** `tableOwners` del mapa de contextos (AT-063), si existe: la declaración manda sobre la heurística. */
export function readDeclaredOwners(rootDir: string): DeclaredOwners {
  const path = resolve(rootDir, 'docs/architecture/microservices/context-map.json');
  if (!existsSync(path)) return {};
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { tableOwners?: DeclaredOwners };
  return parsed.tableOwners ?? {};
}

export function assignOwnership(catalog: DatabaseCatalog, registry: StaticRegistry, declared: DeclaredOwners = {}): TableOwnership[] {
  const logicalSchemaByTable = new Map<string, string>();
  for (const [schema, tables] of Object.entries(ATLAS_DOMAIN_TABLES)) for (const table of tables) logicalSchemaByTable.set(table, schema);
  const registrantsByTable = new Map<string, string[]>();
  for (const [moduleName, tables] of Object.entries(registry.registrationsByModule)) {
    for (const table of tables) (registrantsByTable.get(table) ?? registrantsByTable.set(table, []).get(table))?.push(moduleName);
  }
  const rawModulesByTable = new Map<string, Set<string>>();
  for (const [moduleName, statements] of Object.entries(registry.rawSqlByModule)) {
    for (const statement of statements) {
      const table = statement.table.split('.')[1];
      (rawModulesByTable.get(table) ?? rawModulesByTable.set(table, new Set()).get(table))?.add(moduleName);
    }
  }
  const physicalTables = new Map(catalog.tables.map((entry) => [entry.table, entry.schema]));
  const allTables = new Set<string>([...physicalTables.keys(), ...logicalSchemaByTable.keys()]);

  const result: TableOwnership[] = [];
  for (const table of [...allTables].sort()) {
    const physicalSchema = physicalTables.get(table) ?? null;
    const logicalSchema = logicalSchemaByTable.get(table) ?? null;
    const registrants = (registrantsByTable.get(table) ?? []).sort();
    const home = logicalSchema ? (SCHEMA_HOME_MODULES[logicalSchema] ?? []) : [];
    const rawModules = [...(rawModulesByTable.get(table) ?? [])].sort();
    const ownerCandidate =
      declared[table] ??
      registrants.find((moduleName) => home.includes(moduleName)) ??
      registrants[0] ??
      rawModules.find((moduleName) => home.includes(moduleName)) ??
      null;
    const issues: string[] = [];
    if (!logicalSchema && physicalSchema !== 'public' && physicalSchema !== 'read_api') issues.push('sin_schema_logico');
    if (logicalSchema && physicalSchema && logicalSchema !== physicalSchema) issues.push(`schema_fisico_distinto:${physicalSchema}`);
    if (!ownerCandidate && physicalSchema !== 'public' && physicalSchema !== 'read_api') issues.push('sin_propietario_candidato');
    if (registrants.length > 1) issues.push(`registrada_por_${registrants.length}_modulos`);
    const fksOut = catalog.foreignKeys.filter((fk) => fk.fromTable === table);
    const fksIn = catalog.foreignKeys.filter((fk) => fk.toTable === table);
    result.push({
      table,
      physicalSchema,
      logicalSchema,
      model: registry.modelByTable[table] ?? null,
      ownerCandidate,
      registrants,
      rawSqlModules: rawModules,
      incomingForeignKeys: fksIn.length,
      outgoingForeignKeys: fksOut.length,
      crossSchemaForeignKeys: [...fksOut, ...fksIn].filter((fk) => fk.crossSchema).length,
      triggers: catalog.triggers.filter((trigger) => trigger.table === table).length,
      readByViews: catalog.views
        .filter((view) => view.referencedTables.some((ref) => ref.endsWith(`.${table}`)))
        .map((view) => `${view.schema}.${view.name}`),
      issues,
    });
  }
  return result;
}

/** El inventario falla su validación si alguna tabla de negocio queda sin propietario: no se asigna a plataforma por defecto. */
export function validateOwnership(ownership: TableOwnership[]): string[] {
  return ownership
    .filter((entry) => entry.physicalSchema !== null && entry.issues.includes('sin_propietario_candidato'))
    .map((entry) => `${entry.physicalSchema}.${entry.table}`);
}

async function main(): Promise<void> {
  const rootDir = process.cwd();
  const sequelize = new Sequelize({ ...buildSequelizeOptions(), models: [], logging: false });
  try {
    const catalog = await readCatalog(sequelize);
    const registry = readStaticRegistry(rootDir);
    const ownership = assignOwnership(catalog, registry, readDeclaredOwners(rootDir));
    const unowned = validateOwnership(ownership);
    const output = {
      generatedAt: new Date().toISOString(),
      database: { host: buildSequelizeOptions().host, name: buildSequelizeOptions().database },
      summary: {
        tables: catalog.tables.length,
        foreignKeys: catalog.foreignKeys.length,
        crossSchemaForeignKeys: catalog.foreignKeys.filter((fk) => fk.crossSchema).length,
        views: catalog.views.length,
        triggers: catalog.triggers.length,
        functions: catalog.functions.length,
        tablesWithIssues: ownership.filter((entry) => entry.issues.length > 0).length,
        tablesRegisteredByManyModules: ownership.filter((entry) => entry.registrants.length > 1).length,
        unownedTables: unowned,
      },
      ownership,
      crossSchemaForeignKeys: catalog.foreignKeys.filter((fk) => fk.crossSchema),
      views: catalog.views,
      triggers: catalog.triggers,
      functions: catalog.functions,
      grants: catalog.grants,
      registrationsByModule: registry.registrationsByModule,
      rawSqlByModule: registry.rawSqlByModule,
      transactionOpenersByModule: registry.transactionOpenersByModule,
    };
    const json = `${JSON.stringify(output, null, 2)}\n`;
    if (process.argv.includes('--stdout')) {
      process.stdout.write(json);
    } else {
      const target = resolve(rootDir, 'docs/architecture/microservices/data-ownership.json');
      if (!existsSync(dirname(target))) mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, json);
      console.log(
        `Inventario escrito en ${relative(rootDir, target)}: ${output.summary.tables} tablas, ${output.summary.foreignKeys} FKs ` +
          `(${output.summary.crossSchemaForeignKeys} entre schemas), ${output.summary.views} vistas, ${output.summary.triggers} disparadores; ` +
          `${output.summary.tablesRegisteredByManyModules} tablas registradas por más de un módulo; sin propietario: ${unowned.length}.`,
      );
    }
    if (unowned.length > 0) {
      console.error(`❌ Tablas sin propietario candidato: ${unowned.join(', ')}`);
      process.exitCode = 1;
    }
  } finally {
    await sequelize.close();
  }
}

const invokedDirectly = /inventory-database\.(ts|js)$/.test(process.argv[1] ?? '');
if (invokedDirectly) void main();
