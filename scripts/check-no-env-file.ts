/**
 * Gate de seguridad: CI falla si encuentra archivos `.env*` reales en la raíz del repo.
 */
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

function isAllowedTemplate(name: string): boolean {
  return name.endsWith('.example');
}

function main(): void {
  const rootDir = resolve(process.cwd());
  const entries = readdirSync(rootDir, { withFileTypes: true });

  const offendingFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name === '.env' || (name.startsWith('.env.') && !isAllowedTemplate(name)));

  if (offendingFiles.length > 0) {
    console.error('❌ Se encontraron archivos .env reales en el repositorio:');
    offendingFiles.forEach((file) => console.error(`   - ${file}`));
    console.error('   Elimínalos del repo/paquete. Usa .env.example como referencia y crea tu .env localmente.');
    process.exit(1);
  }

  console.log('✅ No se encontraron archivos .env reales en el repositorio.');
}

main();
