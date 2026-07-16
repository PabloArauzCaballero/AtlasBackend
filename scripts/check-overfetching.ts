/**
 * Gate estático anti-overfetching para la capa de lectura (Fase 7, §33).
 *
 * Es un chequeo SIN base de datos que falla el build si:
 *   1. La definición de una vista de `read_api` usa `SELECT *` (deben enumerar columnas, §19/§23.1).
 *   2. Algún call site consulta una vista de `read_api` con `SELECT *` (overfetching en el backend).
 *
 * No intenta detectar `.findAll()` sin `attributes` (demasiados falsos positivos); se enfoca en el
 * contrato de `read_api`, donde la proyección explícita es obligatoria.
 *
 * Ejecutar con `yarn check:overfetching`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC_ROOT = resolve(process.cwd(), 'src');
const SELECT_STAR_FROM_READ_API = /select\s+\*\s+from\s+read_api\./i;
const READ_API_VIEW_DEFINITION = /create(\s+or\s+replace)?\s+view\s+read_api\./i;
const SELECT_STAR_ANYWHERE = /select\s+\*/i;

function walk(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...walk(fullPath));
    } else if (entry.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function main(): void {
  const errors: string[] = [];
  const files = walk(SRC_ROOT);

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const rel = relative(process.cwd(), file);

    content.split(/\r?\n/).forEach((line, index) => {
      if (SELECT_STAR_FROM_READ_API.test(line)) {
        errors.push(`${rel}:${index + 1}: consulta una vista de read_api con "SELECT *" (overfetching). Enumera columnas.`);
      }
    });

    // Si el archivo define vistas de read_api y en alguna parte hay "SELECT *", es sospechoso:
    // ninguna definición de vista de read_api debe proyectar con estrella (incluye `SELECT alias.*`).
    if (READ_API_VIEW_DEFINITION.test(content)) {
      content.split(/\r?\n/).forEach((line, index) => {
        // Ignora líneas de comentario (JSDoc `*`, `//`, `/*`, SQL `--`) para no dar falsos positivos
        // con documentación que menciona `SELECT *`.
        if (/^\s*(\*|\/\/|\/\*|--)/.test(line)) return;
        const withoutLineComment = line.replace(/\/\/.*$/, '');
        if (SELECT_STAR_ANYWHERE.test(withoutLineComment)) {
          errors.push(`${rel}:${index + 1}: definición de vista read_api con "SELECT *". Enumera columnas explícitamente.`);
        }
      });
    }
  }

  if (errors.length > 0) {
    console.error('❌ Overfetching detectado en la capa de lectura:');
    errors.forEach((error) => console.error(`   - ${error}`));
    process.exit(1);
  }

  console.log(`✅ Sin overfetching en read_api (${files.length} archivos escaneados).`);
}

main();
