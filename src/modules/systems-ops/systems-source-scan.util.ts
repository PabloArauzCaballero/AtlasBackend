import { readFile, readdir, stat } from 'node:fs/promises';
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
 *
 * Usa `node:fs/promises` (no las variantes `*Sync`) a propósito: este escaneo recorre todo el
 * árbol de un módulo y lee cada archivo `.ts`, y ambos servicios se invocan desde handlers HTTP
 * (`POST /systems/.../infer-*`). Node es single-threaded para JS: I/O síncrono de cientos de
 * archivos bloquearía el event loop completo (incluidos health checks y requests de otros
 * usuarios) durante todo el escaneo. Cachear la Promise en curso (no solo el resultado final)
 * también evita que dos inferencias disparadas en paralelo escaneen el mismo directorio dos veces.
 */
const sourceCacheByModuleDir = new Map<string, Promise<string>>();

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const entryPath = join(directory, entry.name);
      return entry.isDirectory() ? walk(entryPath) : Promise.resolve([entryPath]);
    }),
  );
  return files.flat();
}

async function readSources(files: string[]): Promise<string> {
  const contents = await Promise.all(files.map((file) => readFile(file, 'utf8').catch(() => '')));
  return contents.join('\n');
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function sourceFilesForModuleDir(moduleDir: string, extraFile: string | null): Promise<string[]> {
  const files = new Set<string>();
  if (extraFile) files.add(extraFile);
  if (await directoryExists(moduleDir)) {
    for (const path of await walk(moduleDir)) {
      if (path.endsWith('.ts')) files.add(path);
    }
  }
  return Array.from(files);
}

export function readSourcesForEndpoint(endpoint: SystemEndpointCatalogModel): Promise<string> {
  const sourceFile = endpoint.sourceFile ? join(process.cwd(), endpoint.sourceFile) : null;
  const moduleDir = sourceFile ? dirname(sourceFile) : join(process.cwd(), 'src', 'modules', endpoint.module);

  const cached = sourceCacheByModuleDir.get(moduleDir);
  if (cached !== undefined) return cached;

  // Si el escaneo falla (permisos, directorio borrado a mitad del walk), no se cachea la promise
  // rechazada — de lo contrario un fallo transitorio envenenaría el cache para el resto de la
  // vida del proceso y toda inferencia futura sobre ese módulo fallaría sin volver a intentarlo.
  const pending = sourceFilesForModuleDir(moduleDir, sourceFile)
    .then(readSources)
    .catch((error: unknown) => {
      sourceCacheByModuleDir.delete(moduleDir);
      throw error;
    });
  sourceCacheByModuleDir.set(moduleDir, pending);
  return pending;
}

/** Solo para tests: evita que resultados de un test se filtren al siguiente vía el cache module-level. */
export function clearSourceScanCacheForTests(): void {
  sourceCacheByModuleDir.clear();
}
