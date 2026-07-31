/**
 * Gate estático de migraciones: verifica que `yarn db:migration:up` pueda correr sobre una base
 * VACÍA sin colisiones.
 *
 * Existe por ATLAS-TECH-001 (auditoría integral 2026-07-30, hallazgo A-01): una migración monolítica
 * de 12 559 líneas creaba las mismas 86 tablas que las diez migraciones `schema-part-*`. Como
 * `src/database/migrate.ts` usa `glob` + el orden alfabético de Umzug y ambas compartían el prefijo
 * `20260626154044`, el monolito corría primero y la migración siguiente reventaba con
 * `relation "tenants" already exists`. Provisionar un entorno nuevo era imposible.
 *
 * Ningún gate lo detectaba: el único que lo habría visto (`db-and-cache-integration` en CI) necesita
 * un Postgres real y estaba rojo por esta misma causa. Este gate es estático — corre en milisegundos,
 * sin base de datos — y bloquea la regresión en el PR.
 *
 * Reglas:
 *  1. ERROR — una tabla creada por dos o más migraciones donde al menos una creación NO es
 *     idempotente (`createTable(...)` de Sequelize o `CREATE TABLE` sin `IF NOT EXISTS`). Este es
 *     exactamente el fallo duro: la segunda migración aborta el `up` completo.
 *  2. ERROR — prefijo de timestamp repetido, salvo excepción documentada abajo. Un prefijo repetido
 *     hace que el orden de ejecución dependa del resto del NOMBRE, no de la intención cronológica.
 *  3. ERROR — nombre de archivo fuera del patrón `<14 dígitos>-<kebab-case>.ts`.
 *  4. ERROR — migración sin `up` o sin `down` exportado (reversibilidad).
 *  5. AVISO — la misma tabla creada por dos migraciones, todas idempotentes. No rompe el arranque,
 *     pero es duplicación real que hay que resolver; se reporta sin fallar.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATIONS_DIR = resolve(process.cwd(), 'src/database/migrations');
const FILE_NAME_PATTERN = /^(\d{14})-[a-z0-9]+(?:-[a-z0-9]+)*\.ts$/;

/**
 * Prefijos de timestamp repetidos que ya existen en el historial y NO se pueden renombrar sin
 * romper la tabla `SequelizeMeta` de los entornos que ya los aplicaron. Cada excepción necesita su
 * razón; la lista no debe crecer.
 */
const ALLOWED_DUPLICATE_TIMESTAMPS: Record<string, string> = {
  '20260705113000':
    'add-systems-business-metadata-governance y add-systems-ops-rich-metadata-tables aplican el mismo ' +
    'cambio de metadatos de systems-ops escrito dos veces. Ambas son idempotentes (ADD COLUMN/CREATE TABLE ' +
    'IF NOT EXISTS), así que el orden entre ellas no altera el esquema resultante. Ya están aplicadas en ' +
    'entornos existentes: renombrarlas rompería SequelizeMeta.',
};

type TableCreation = { table: string; migration: string; idempotent: boolean };

/** `queryInterface.createTable('x', ...)` — nunca es idempotente: falla si la tabla ya existe. */
const SEQUELIZE_CREATE_TABLE = /createTable\(\s*'([a-z0-9_]+)'/g;
/** Estilo `schema-part-*`: `const TABLES: TableSpec[] = [{ ..., tableName: 'x', ... }]`. */
const TABLE_SPEC_NAME = /tableName:\s*'([a-z0-9_]+)'/g;
/**
 * SQL crudo. El nombre puede venir literal (`system_domain_catalog`), calificado por schema
 * (`platform_ops.foo`) o interpolado desde una constante del propio archivo
 * (`${DEFINITIONS}`, declarada como `` const DEFINITIONS = `${atlasSchemaFor('x')}.x` ``).
 * El lookahead negativo impide que `IF` se tome como nombre de tabla cuando lo que sigue a
 * `IF NOT EXISTS` es una interpolación y el grupo opcional intentaría retroceder.
 */
const RAW_CREATE_TABLE =
  /CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(?!IF\s+NOT\s+EXISTS)(?:\$\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}|(?:[a-z0-9_]+\.)?([a-z0-9_]+))/gi;

/** `const DEFINITIONS = `${atlasSchemaFor('workflow_definitions')}.workflow_definitions`;` */
const TABLE_NAME_CONSTANT = /const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*`?\$?\{?\s*(?:atlasSchemaFor\(\s*'([a-z0-9_]+)'\s*\))?[^`';\n]*`?/g;

function tableNameConstants(source: string): Map<string, string> {
  const constants = new Map<string, string>();
  for (const match of source.matchAll(TABLE_NAME_CONSTANT)) {
    if (match[2]) constants.set(match[1], match[2]);
  }
  return constants;
}

function createdTables(migration: string, source: string): TableCreation[] {
  const creations: TableCreation[] = [];
  const constants = tableNameConstants(source);

  for (const match of source.matchAll(SEQUELIZE_CREATE_TABLE)) {
    creations.push({ table: match[1], migration, idempotent: false });
  }

  // `tableName:` solo se interpreta como declaración de tabla en los archivos que declaran el array
  // `TABLES` del split de esquema; en el resto aparece en specs de índice y no crea nada.
  if (/const TABLES\s*:/.test(source)) {
    for (const match of source.matchAll(TABLE_SPEC_NAME)) {
      creations.push({ table: match[1], migration, idempotent: false });
    }
  }

  for (const match of source.matchAll(RAW_CREATE_TABLE)) {
    const table = match[2] ? constants.get(match[2]) : match[3];
    // Una interpolación cuya constante no se pudo resolver se reporta como error propio: es peor
    // ignorarla en silencio (dejaría de cubrir esa tabla) que fallar y obligar a nombrarla.
    if (!table) {
      creations.push({ table: `<no resuelto: ${match[2] ?? match[3]}>`, migration, idempotent: false });
      continue;
    }
    creations.push({ table, migration, idempotent: Boolean(match[1]) });
  }

  return creations;
}

function main(): void {
  const errors: string[] = [];
  const warnings: string[] = [];

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((entry) => entry.endsWith('.ts'))
    .sort();

  const byTimestamp = new Map<string, string[]>();
  const byTable = new Map<string, TableCreation[]>();

  for (const file of files) {
    const nameMatch = FILE_NAME_PATTERN.exec(file);
    if (!nameMatch) {
      errors.push(`${file}: el nombre no sigue el patrón <14 dígitos>-<kebab-case>.ts.`);
      continue;
    }

    const timestamp = nameMatch[1];
    byTimestamp.set(timestamp, [...(byTimestamp.get(timestamp) ?? []), file]);

    const source = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8');
    if (!/export\s+(?:async\s+function|const)\s+up\b/.test(source)) errors.push(`${file}: no exporta \`up\`.`);
    if (!/export\s+(?:async\s+function|const)\s+down\b/.test(source)) errors.push(`${file}: no exporta \`down\` (migración irreversible).`);

    for (const creation of createdTables(file, source)) {
      byTable.set(creation.table, [...(byTable.get(creation.table) ?? []), creation]);
    }
  }

  for (const [timestamp, group] of byTimestamp) {
    if (group.length < 2) continue;
    const justification = ALLOWED_DUPLICATE_TIMESTAMPS[timestamp];
    if (justification) {
      warnings.push(`Prefijo ${timestamp} repetido (excepción documentada): ${group.join(', ')}.`);
      continue;
    }
    errors.push(
      `Prefijo de timestamp ${timestamp} repetido en ${group.join(', ')}. Umzug ordena por nombre, ` +
        'así que el orden de ejecución quedaría decidido por el texto que sigue al prefijo, no por la ' +
        'intención cronológica. Renombra una de ellas con un timestamp propio.',
    );
  }

  for (const [table, creations] of byTable) {
    const migrations = [...new Set(creations.map((creation) => creation.migration))];
    if (migrations.length < 2) continue;

    const blocking = creations.filter((creation) => !creation.idempotent);
    if (blocking.length > 0) {
      errors.push(
        `La tabla \`${table}\` se crea en ${migrations.join(' y ')}; al menos una creación no es ` +
          `idempotente (${[...new Set(blocking.map((creation) => creation.migration))].join(', ')}). ` +
          '`yarn db:migration:up` sobre una base vacía abortará con "relation already exists".',
      );
      continue;
    }

    warnings.push(
      `La tabla \`${table}\` se crea en ${migrations.join(' y ')} (todas con IF NOT EXISTS): duplicación sin riesgo de arranque.`,
    );
  }

  if (warnings.length > 0) {
    console.warn(`ℹ️  ${warnings.length} aviso(s) de migraciones:`);
    warnings.forEach((warning) => console.warn(`   - ${warning}`));
  }

  if (errors.length > 0) {
    console.error('❌ Las migraciones no pueden aplicarse sobre una base vacía:');
    errors.forEach((error) => console.error(`   - ${error}`));
    process.exit(1);
  }

  console.log(`✅ ${files.length} migraciones verificadas: sin colisiones de tabla, sin timestamps repetidos y todas reversibles.`);
}

main();
