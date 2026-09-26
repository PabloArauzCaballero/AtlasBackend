/**
 * Gate estático: lo que dicen las fixtures es lo que vuelca la última migración de procesos.
 *
 * Los procesos llegan a la base por migración (`sync-workflow-catalog-N`), igual que los permisos
 * (`sync-internal-rbac-catalog-N`). El 15-09 un permiso existía en el código y no en la base, y nadie
 * —ni SUPER_ADMIN— podía aprobar el QR de un comercio. Este gate cierra esa clase de fallo para los
 * procesos y para los permisos: cada catálogo tiene un candado con la huella de lo que su última
 * migración vuelca; si el código cambia y el candado no, falla.
 *
 *   yarn check:process-sync                                  → comprueba
 *   yarn check:process-sync --update <migración-de-procesos> → reescribe el candado de procesos
 *   yarn check:process-sync --update-rbac <migración-rbac>   → reescribe el candado de permisos
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { INTERNAL_PERMISSION_SEEDS, ROLE_PERMISSION_CODES } from '../../src/modules/internal-users/internal-rbac.permissions.js';
import { definitionHash } from '../../src/modules/workflow-catalog/definitions/workflow-catalog.sync.js';
import { FIXTURES, ROOT, finish } from './process-catalog.lib.js';

const MIGRATIONS = join(ROOT, 'src/database/migrations');
const LOCK = join(ROOT, 'src/modules/workflow-catalog/definitions/workflow-catalog.sync-lock.json');

type Lock = { processes: { migration: string; hashes: Record<string, string> }; rbac: { migration: string; hash: string } };

const rbacHash = (): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        permissions: [...INTERNAL_PERMISSION_SEEDS].sort((a, b) => a.code.localeCompare(b.code)),
        grants: ROLE_PERMISSION_CODES,
      }),
    )
    .digest('hex')
    .slice(0, 16);
const processHashes = (): Record<string, string> => Object.fromEntries(FIXTURES.map((f) => [f.code, definitionHash(f)]));
const latest = (pattern: RegExp): string | undefined =>
  readdirSync(MIGRATIONS)
    .filter((f) => pattern.test(f))
    .sort()
    .at(-1)
    ?.replace(/\.ts$/, '');

const args = process.argv.slice(2);
const lock: Lock = existsSync(LOCK)
  ? (JSON.parse(readFileSync(LOCK, 'utf8')) as Lock)
  : { processes: { migration: '', hashes: {} }, rbac: { migration: '', hash: '' } };
const upd = args.indexOf('--update');
const updRbac = args.indexOf('--update-rbac');
if (upd >= 0 || updRbac >= 0) {
  if (upd >= 0) lock.processes = { migration: args[upd + 1] ?? '', hashes: processHashes() };
  if (updRbac >= 0) lock.rbac = { migration: args[updRbac + 1] ?? '', hash: rbacHash() };
  writeFileSync(LOCK, `${JSON.stringify(lock, null, 2)}\n`);
  console.log(`Candado reescrito: ${LOCK}`);
  process.exit(0);
}

const errors: string[] = [];
const current = processHashes();
for (const [code, hash] of Object.entries(current)) {
  if (lock.processes.hashes[code] !== hash) {
    errors.push(
      `proceso ${code}: la fixture cambió (huella ${hash}) y el candado dice ${lock.processes.hashes[code] ?? 'nada'}. Crea una migración sync-workflow-catalog-N y corre --update <su nombre>.`,
    );
  }
}
for (const code of Object.keys(lock.processes.hashes))
  if (!(code in current)) errors.push(`proceso ${code}: está en el candado y ya no en el registro.`);
const lastProcess = latest(/-sync-workflow-catalog-\d+\.ts$/);
if (lock.processes.migration !== lastProcess)
  errors.push(
    `el candado de procesos apunta a ${lock.processes.migration || '—'} y la última migración de procesos es ${lastProcess ?? '—'}.`,
  );
if (rbacHash() !== lock.rbac.hash)
  errors.push(`permisos: el catálogo RBAC cambió y el candado no. Crea sync-internal-rbac-catalog-N y corre --update-rbac <su nombre>.`);
const lastRbac = latest(/-sync-internal-rbac-catalog(-[\w-]+)?\.ts$/);
if (lock.rbac.migration !== lastRbac)
  errors.push(`el candado RBAC apunta a ${lock.rbac.migration || '—'} y la última migración RBAC es ${lastRbac ?? '—'}.`);

finish('check:process-sync', errors, [], FIXTURES.length);
