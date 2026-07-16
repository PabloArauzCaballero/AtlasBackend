/**
 * Gate de CI para la separación de seeders por perfil (Fase 1 del plan de mejora del modelo de
 * datos, §11 y §27). Es un chequeo ESTÁTICO (sin base de datos) que falla el build si:
 *
 *   1. Quedan seeders sueltos en `src/database/seeders/` (deben vivir en un directorio de perfil).
 *   2. Hay directorios de seeders desconocidos (fuera de production/development/demo/test).
 *   3. Un seeder del directorio `production` tiene un nombre con tokens de datos ficticios
 *      (`demo`, `dev`, `fixture`, `mock`, `sample`).
 *   4. Un seeder del directorio `production` contiene marcadores de datos ficticios en su contenido
 *      (hash de credenciales dev, correos `.test`, hashes Argon2 versionados).
 *
 * Ejecutar con `yarn check:seed-profiles`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findForbiddenProductionTokens, SEED_PROFILES } from '../src/database/seed-profiles.js';

const SEEDERS_ROOT = resolve(process.cwd(), 'src', 'database', 'seeders');

/**
 * Patrones de datos ficticios buscados SOLO en el contenido de seeders `production`. Son
 * deliberadamente estrechos para no dar falsos positivos con referencias legítimas (p. ej. la
 * palabra "Argon2" en documentación, o llamadas `/regex/.test(...)`): exigen el contexto real del
 * dato (prefijo `@` antes de un dominio `.test`, prefijo `$` del hash Argon2, etc.).
 */
const PRODUCTION_CONTENT_RED_FLAGS: { pattern: RegExp; label: string }[] = [
  { pattern: /dev_seed_hash/, label: 'marcador de hash de credenciales de desarrollo (dev_seed_hash)' },
  { pattern: /@[\w.-]+\.test\b/, label: 'dirección de correo con dominio .test' },
  { pattern: /\$argon2/, label: 'hash de contraseña Argon2 versionado ($argon2...)' },
];

function listSeederFiles(directory: string): string[] {
  try {
    return readdirSync(directory)
      .filter((name) => name.endsWith('.ts'))
      .sort();
  } catch {
    return [];
  }
}

function main(): void {
  const errors: string[] = [];
  const rootEntries = readdirSync(SEEDERS_ROOT, { withFileTypes: true });

  const strayRootFiles = rootEntries.filter((entry) => entry.isFile() && entry.name.endsWith('.ts')).map((entry) => entry.name);
  for (const file of strayRootFiles) {
    errors.push(
      `Seeder suelto en la raíz: src/database/seeders/${file}. Muévelo a un directorio de perfil (production/development/demo/test).`,
    );
  }

  const knownProfiles = SEED_PROFILES as readonly string[];
  const unknownDirs = rootEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !knownProfiles.includes(name));
  for (const dir of unknownDirs) {
    errors.push(`Directorio de seeders desconocido: src/database/seeders/${dir}. Perfiles válidos: ${knownProfiles.join(', ')}.`);
  }

  const productionDir = join(SEEDERS_ROOT, 'production');
  const productionFiles = listSeederFiles(productionDir);
  if (productionFiles.length === 0) {
    errors.push('El directorio src/database/seeders/production/ no contiene seeders. Debe existir al menos el baseline de arranque.');
  }

  for (const file of productionFiles) {
    const forbiddenTokens = findForbiddenProductionTokens(file);
    if (forbiddenTokens.length > 0) {
      errors.push(`production/${file}: el nombre contiene token(s) prohibido(s) [${forbiddenTokens.join(', ')}].`);
    }

    const content = readFileSync(join(productionDir, file), 'utf8');
    for (const flag of PRODUCTION_CONTENT_RED_FLAGS) {
      if (flag.pattern.test(content)) {
        errors.push(`production/${file}: contiene ${flag.label}. Los seeders de producción no pueden incluir datos ficticios.`);
      }
    }
  }

  if (errors.length > 0) {
    console.error('❌ Violaciones en la separación de perfiles de seeds:');
    errors.forEach((error) => console.error(`   - ${error}`));
    process.exit(1);
  }

  const counts = SEED_PROFILES.map((profile) => `${profile}=${listSeederFiles(join(SEEDERS_ROOT, profile)).length}`).join(', ');
  console.log(`✅ Separación de perfiles de seeds válida (${counts}).`);
}

main();
