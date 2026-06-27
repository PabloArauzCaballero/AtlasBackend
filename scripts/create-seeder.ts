import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function normalizeName(rawName: string): string {
  const normalized = rawName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!normalized) {
    throw new Error('El nombre del seeder no puede estar vacío.');
  }

  return normalized;
}

function buildTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear().toString();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

function buildSeederTemplate(): string {
  return `import { QueryInterface } from 'sequelize';\n\nexport async function up({ context: queryInterface }: { context: QueryInterface }): Promise<void> {\n  await queryInterface.sequelize.transaction(async (transaction) => {\n    // Agrega aquí los datos mínimos de prueba.\n  });\n}\n\nexport async function down({ context: queryInterface }: { context: QueryInterface }): Promise<void> {\n  await queryInterface.sequelize.transaction(async (transaction) => {\n    // Revierte aquí los datos mínimos de prueba en orden inverso.\n  });\n}\n`;
}

const rawName = process.argv[2];

if (!rawName) {
  throw new Error('Uso: npm run db:seed:create -- nombre-del-seeder');
}

const seedersDirectory = join(process.cwd(), 'src', 'database', 'seeders');

if (!existsSync(seedersDirectory)) {
  mkdirSync(seedersDirectory, { recursive: true });
}

const fileName = `${buildTimestamp()}-${normalizeName(rawName)}.ts`;
const filePath = join(seedersDirectory, fileName);

writeFileSync(filePath, buildSeederTemplate(), { encoding: 'utf8', flag: 'wx' });

console.log(`Seeder creado: ${filePath}`);
