import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SystemEndpointCatalogModel } from '../../database/models/index.js';

/**
 * Compartido por `SystemsDataImpactInferenceService` y `SystemsToolInferenceService` (antes cada
 * uno tenía su propia copia de `sourceFilesForEndpoint`/`walk`/`readSources`, ver hallazgo de
 * revisión de patrones sobre `systems-ops`). Ambos servicios iteran TODOS los endpoints activos e
 * infieren tools/impactos de datos leyendo el código fuente de cada uno — cuando varios endpoints
 * comparten el mismo directorio de módulo (el caso común: varios endpoints por controller), sin
 * cache esto re-lee el mismo árbol de archivos una vez por endpoint. `readSourcesForEndpoint`
 * cachea por directorio de módulo resuelto, así que el filesystem solo se escanea una vez por
 * directorio único, sin importar cuántos endpoints lo compartan.
 */
const sourceCacheByModuleDir = new Map<string, string>();

function walk(directory: string): string[] {
  const entries = readdirSync(directory).map((entry) => join(directory, entry));
  return entries.flatMap((entry) => (statSync(entry).isDirectory() ? walk(entry) : [entry]));
}

function readSources(files: string[]): string {
  return files
    .filter((file) => existsSync(file))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
}

function sourceFilesForModuleDir(moduleDir: string, extraFile: string | null): string[] {
  const files = new Set<string>();
  if (extraFile) files.add(extraFile);
  if (existsSync(moduleDir)) {
    for (const file of walk(moduleDir).filter((path) => path.endsWith('.ts'))) files.add(file);
  }
  return Array.from(files);
}

export function readSourcesForEndpoint(endpoint: SystemEndpointCatalogModel): string {
  const sourceFile = endpoint.sourceFile ? join(process.cwd(), endpoint.sourceFile) : null;
  const moduleDir = sourceFile ? dirname(sourceFile) : join(process.cwd(), 'src', 'modules', endpoint.module);

  const cached = sourceCacheByModuleDir.get(moduleDir);
  if (cached !== undefined) return cached;

  const source = readSources(sourceFilesForModuleDir(moduleDir, sourceFile));
  sourceCacheByModuleDir.set(moduleDir, source);
  return source;
}

/** Solo para tests: evita que resultados de un test se filtren al siguiente vía el cache module-level. */
export function clearSourceScanCacheForTests(): void {
  sourceCacheByModuleDir.clear();
}
