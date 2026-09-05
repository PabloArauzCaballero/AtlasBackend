/**
 * Gate de seguridad: CI falla si Git rastrea archivos `.env*` reales.
 *
 * El archivo `.env` local forma parte del flujo de desarrollo documentado y está ignorado. Revisar
 * el filesystem hacía que el gate fallara precisamente después de configurar el proyecto. La
 * frontera de seguridad correcta es el índice de Git: un secreto solo puede llegar al repositorio o
 * al checkout de CI si está rastreado (incluso mediante `git add -f`).
 */
import { execFileSync } from 'node:child_process';

function isAllowedTemplate(name: string): boolean {
  return name.endsWith('.example');
}

function trackedEnvFiles(): string[] {
  try {
    return execFileSync('git', ['ls-files', '--', '.env', '.env.*'], { encoding: 'utf-8' })
      .split('\n')
      .map((line) => line.trim())
      .filter((name) => name.length > 0 && !isAllowedTemplate(name));
  } catch (error) {
    throw new Error(`No se pudo verificar el índice de Git: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

function main(): void {
  const offendingFiles = trackedEnvFiles();

  if (offendingFiles.length > 0) {
    console.error('❌ Se encontraron archivos .env reales en el repositorio:');
    offendingFiles.forEach((file) => console.error(`   - ${file}`));
    console.error('   Sácalos del índice. Usa .env.example como referencia y conserva tu .env solo localmente.');
    process.exit(1);
  }

  console.log('✅ Git no rastrea archivos .env reales; las plantillas .example están permitidas.');
}

main();
