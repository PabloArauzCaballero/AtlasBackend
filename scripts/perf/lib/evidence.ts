/**
 * Persistencia de la evidencia de la fase de higiene.
 *
 * Cada corrida deja un archivo con marca de tiempo (histórico, para comparar antes/después) y
 * sobrescribe `latest.json` (lo que leen `prestart:verify` y los reportes). Sin el histórico, la
 * comparación "memoria antes de limpiar / después de limpiar / después de arrancar" que exige el
 * procedimiento no es reconstruible al día siguiente.
 *
 * Va a `artifacts/`, fuera de Git: son datos de una máquina y un instante concretos, no fuente.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const ARTIFACTS_DIR = 'artifacts/performance/backend/reports';

export type HygienePhase = 'diagnose' | 'cleanup' | 'verify' | 'stop' | 'load';

function reportsDir(projectRoot: string): string {
  const dir = resolve(projectRoot, ARTIFACTS_DIR);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Escribe el informe con marca de tiempo y actualiza `<phase>-latest.json`. Devuelve la ruta histórica. */
export function writeEvidence(projectRoot: string, phase: HygienePhase, payload: unknown): string {
  const dir = reportsDir(projectRoot);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const historic = join(dir, `${phase}-${stamp}.json`);
  const body = JSON.stringify(payload, null, 2);
  writeFileSync(historic, body, 'utf8');
  writeFileSync(join(dir, `${phase}-latest.json`), body, 'utf8');
  return historic;
}

/** Lee el último informe de una fase. `null` si nunca se ejecutó: el llamador decide si eso es un fallo. */
export function readLatestEvidence<T>(projectRoot: string, phase: HygienePhase): T | null {
  const path = join(resolve(projectRoot, ARTIFACTS_DIR), `${phase}-latest.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}
