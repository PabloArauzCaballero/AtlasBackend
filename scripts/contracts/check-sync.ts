/**
 * Comprueba que la copia del contrato atlas-integration-v1 en el ERP es la de Core (P-14).
 *
 * Una prueba de Core no puede leer otro repositorio en CI, así que la sincronía se verifica con este
 * guion cuando los dos están a mano (el orquestador, o un job que haga checkout de ambos):
 *
 *   yarn contracts:check-sync ../AtlasERPBackend
 *   ERP_REPO_PATH=../AtlasERPBackend yarn contracts:check-sync
 *
 * Falla (código 1) si algún archivo difiere o falta, si `ORIGIN.json` del ERP no existe o si su
 * `checksums` no es la `CHECKSUMS.sha256` de Core. Avisa (sin fallar) si el commit de origen que cita
 * el ERP no es el último commit de Core que tocó el contrato: la copia puede ser idéntica y venir de
 * un commit anterior con el mismo contenido.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const CONTRACT = 'contracts/atlas-integration-v1';

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

function main(): void {
  const erpRepo = process.argv[2] ?? process.env.ERP_REPO_PATH;
  if (!erpRepo) {
    console.error('Uso: yarn contracts:check-sync <ruta-al-repo-del-ERP> (o ERP_REPO_PATH).');
    process.exit(2);
  }
  const core = resolve(process.cwd(), CONTRACT);
  const erp = resolve(erpRepo, CONTRACT);
  if (!existsSync(erp)) {
    console.error(`❌ El ERP no tiene ${CONTRACT} en ${erp}.`);
    process.exit(1);
  }

  const errors: string[] = [];
  const coreFiles = listFiles(core)
    .map((file) => relative(core, file))
    .sort();
  const erpFiles = new Set(listFiles(erp).map((file) => relative(erp, file)));
  for (const file of coreFiles) {
    if (!erpFiles.has(file)) errors.push(`falta en el ERP: ${file}`);
    else if (sha256(join(core, file)) !== sha256(join(erp, file))) errors.push(`difiere: ${file}`);
  }
  for (const file of erpFiles) {
    if (file !== 'ORIGIN.json' && !coreFiles.includes(file)) errors.push(`sólo en el ERP: ${file}`);
  }

  const originPath = join(erp, 'ORIGIN.json');
  if (!existsSync(originPath)) errors.push('el ERP no tiene ORIGIN.json');
  else {
    const origin = JSON.parse(readFileSync(originPath, 'utf8')) as { sourceCommit?: string; checksumsSha256?: string };
    if (origin.checksumsSha256 !== sha256(join(core, 'CHECKSUMS.sha256'))) errors.push('ORIGIN.json cita otra CHECKSUMS.sha256');
    try {
      const last = execFileSync('git', ['log', '-1', '--format=%H', '--', CONTRACT], { encoding: 'utf8' }).trim();
      if (last && origin.sourceCommit !== last) {
        console.warn(`⚠️  ORIGIN.json cita ${origin.sourceCommit ?? '(nada)'}; el último commit de Core sobre el contrato es ${last}.`);
      }
    } catch {
      console.warn('⚠️  Sin git: no se contrasta el commit de origen.');
    }
  }

  if (errors.length > 0) {
    console.error('❌ La copia del contrato en el ERP no es la de Core:');
    for (const error of errors) console.error(`   - ${error}`);
    process.exit(1);
  }
  console.log(`✅ ${CONTRACT}: ${coreFiles.length} archivo(s) idénticos en Core y en el ERP.`);
}

main();
