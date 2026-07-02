import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function normalizeMigrationName(rawName: string): string {
  return rawName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function timestamp(): string {
  const now = new Date();
  const pad = (value: number): string => value.toString().padStart(2, '0');

  return [
    now.getUTCFullYear().toString(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
    pad(now.getUTCSeconds()),
  ].join('');
}

const requestedName = process.argv[2];

if (!requestedName) {
  throw new Error('Debes indicar el nombre de la migración. Ejemplo: yarn db:migration:create -- create-users');
}

const migrationName = normalizeMigrationName(requestedName);

if (!migrationName) {
  throw new Error('El nombre de la migración no contiene caracteres válidos.');
}

const migrationsDir = join(process.cwd(), 'src', 'database', 'migrations');
mkdirSync(migrationsDir, { recursive: true });

const filePath = join(migrationsDir, `${timestamp()}-${migrationName}.ts`);

if (existsSync(filePath)) {
  throw new Error(`La migración ya existe: ${filePath}`);
}

writeFileSync(
  filePath,
  `import { QueryInterface } from 'sequelize';

export async function up({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  // TODO: implementar migración.
  void queryInterface;
}

export async function down({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  // TODO: revertir migración.
  void queryInterface;
}
`,
  'utf8',
);

console.log(`Migración creada: ${filePath}`);
