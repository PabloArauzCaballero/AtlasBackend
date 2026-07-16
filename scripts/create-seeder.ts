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

const SEED_PROFILES = ['production', 'development', 'demo', 'test'] as const;
type SeedProfile = (typeof SEED_PROFILES)[number];

function parseProfile(argv: string[]): SeedProfile {
  const flag = argv.find((arg) => arg.startsWith('--profile='));
  const value = flag ? flag.slice('--profile='.length) : 'development';
  if (!(SEED_PROFILES as readonly string[]).includes(value)) {
    throw new Error(`Perfil inválido: "${value}". Válidos: ${SEED_PROFILES.join(', ')}.`);
  }
  return value as SeedProfile;
}

const rawName = process.argv.slice(2).find((arg) => !arg.startsWith('--'));

if (!rawName) {
  throw new Error('Uso: yarn db:seed:create -- nombre-del-seeder [--profile=production|development|demo|test]');
}

const profile = parseProfile(process.argv.slice(2));
const seedersDirectory = join(process.cwd(), 'src', 'database', 'seeders', profile);

if (!existsSync(seedersDirectory)) {
  mkdirSync(seedersDirectory, { recursive: true });
}

const fileName = `${buildTimestamp()}-${normalizeName(rawName)}.ts`;
const filePath = join(seedersDirectory, fileName);

writeFileSync(filePath, buildSeederTemplate(), { encoding: 'utf8', flag: 'wx' });

console.log(`Seeder creado: ${filePath}`);
