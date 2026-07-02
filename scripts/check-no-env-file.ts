/**
 * ATLAS-AUDIT-004 (cerrado en este patch): el paquete entregado originalmente incluía un
 * `.env` real (con `DB_PASSWORD=root` y otros valores de desarrollo) pese a que
 * `CONTRIBUTING.md`, `BACKEND_DEVELOPMENT_CONTEXT.md` y `CLAUDE.md` prohíben explícitamente
 * commitear `.env` reales. `.gitignore` ya lo excluye, pero eso no protege contra un
 * empaquetado manual (zip de carpeta de trabajo) que lo incluya de todas formas.
 *
 * Este script se ejecuta en CI (ver .github/workflows/ci.yml) y falla el build si encuentra
 * cualquier archivo `.env*` que no sea `.env.example` en la raíz del repo.
 */
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ALLOWED_ENV_FILES = new Set(['.env.example']);

function main(): void {
  const rootDir = resolve(process.cwd());
  const entries = readdirSync(rootDir, { withFileTypes: true });

  const offendingFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name === '.env' || (name.startsWith('.env.') && !ALLOWED_ENV_FILES.has(name)));

  if (offendingFiles.length > 0) {
    console.error('❌ Se encontraron archivos .env reales en el repositorio (prohibido, ver ATLAS-AUDIT-004):');
    offendingFiles.forEach((file) => console.error(`   - ${file}`));
    console.error('   Elimínalos del repo/paquete. Usa .env.example como referencia y crea tu .env localmente.');
    process.exit(1);
  }

  console.log('✅ No se encontraron archivos .env reales en el repositorio.');
}

main();
