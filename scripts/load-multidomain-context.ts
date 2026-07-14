import { loadMultidomainContextPackage } from '../src/database/context-seed/multidomain-context-loader.js';
import { createSequelizeInstance } from '../src/database/sequelize.js';

function readFlag(name: string): boolean {
  return process.argv.includes(name);
}

function readOption(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const packageDirectory = readOption('--package-dir') ?? process.env.ATLAS_CONTEXT_SEED_DIR;
  if (!packageDirectory) {
    throw new Error('Indica --package-dir <ruta> o configura ATLAS_CONTEXT_SEED_DIR.');
  }

  const dryRun = readFlag('--dry-run');
  const sequelize = dryRun ? undefined : createSequelizeInstance();
  try {
    const report = await loadMultidomainContextPackage({
      packageDirectory,
      sequelize,
      dryRun,
      force: readFlag('--force'),
      allowProduction: readFlag('--allow-production'),
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await sequelize?.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
