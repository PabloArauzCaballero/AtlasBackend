#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const tscBin = join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc');

process.env.NODE_ENV = 'development';

if (!existsSync(tscBin)) {
  console.error('[start:dev] No encontré TypeScript local en node_modules/typescript/bin/tsc.');
  console.error('[start:dev] Ejecuta primero: yarn install --network-timeout 600000');
  process.exit(1);
}

console.log('[start:dev] Compilando TypeScript con tsconfig.json...');
const tsc = spawnSync(process.execPath, [tscBin, '-p', 'tsconfig.json', '--pretty', 'false'], {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: false,
  env: {
    ...process.env,
    NODE_ENV: 'development',
    FORCE_COLOR: '0',
  },
});

if (tsc.error) {
  console.error('[start:dev] No se pudo ejecutar TypeScript:', tsc.error.message);
  process.exit(1);
}

if (tsc.status !== 0) {
  console.error(`[start:dev] TypeScript falló con exit code ${tsc.status}. Corrige los errores de arriba antes de levantar Nest.`);
  process.exit(tsc.status ?? 1);
}

console.log('[start:dev] TypeScript OK. Levantando Nest...');
await import('../dist/src/main.js');
