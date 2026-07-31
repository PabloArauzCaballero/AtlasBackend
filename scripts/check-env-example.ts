/**
 * Verifica que la plantilla local documente todo el contrato tipado de configuración.
 *
 * Las variables dinámicas de proveedores/OTel pueden existir solo en `.env.example`, pero ninguna
 * clave del esquema Zod puede faltar ni aparecer duplicada: ambas situaciones generan despliegues
 * difíciles de reproducir y documentación engañosa.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { envBaseSchema } from '../src/config/env.schema.js';
import { PRODUCTION_CREDENTIAL_REQUIREMENTS } from '../src/modules/external-data/application/external-data-policy.util.js';

function templateKeys(source: string): string[] {
  return source
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
    .filter((key): key is string => key !== undefined);
}

function duplicates(keys: string[]): string[] {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key)
    .sort();
}

/**
 * Credenciales que el código exige por `process.env` directo y que, por eso, NO están en
 * `envBaseSchema`: `PRODUCTION_CREDENTIAL_REQUIREMENTS` las lee con `envValue(...)` para decidir si
 * un proveedor puede operar en modo `production`.
 *
 * Sin esta comprobación, ese contrato no lo cubría NADIE: al escribir
 * docs/config/credenciales-requeridas.md se descubrió que 8 de las 14 claves que el código exige no
 * estaban en ninguna plantilla. Un operador no tenía forma de saber que existían hasta que el
 * proceso se negaba a arrancar.
 */
function externalProviderCredentialKeys(): string[] {
  return [...new Set(Object.values(PRODUCTION_CREDENTIAL_REQUIREMENTS).flat())].sort();
}

function main(): void {
  const examplePath = resolve(process.cwd(), '.env.example');
  const productionExamplePath = resolve(process.cwd(), '.env.production.example');
  const keys = templateKeys(readFileSync(examplePath, 'utf-8'));
  const productionKeys = templateKeys(readFileSync(productionExamplePath, 'utf-8'));
  const present = new Set(keys);
  const schemaKeys = envBaseSchema.keyof().options;
  const credentialKeys = externalProviderCredentialKeys();
  const presentInProduction = new Set(productionKeys);
  const missing = schemaKeys.filter((key) => !present.has(key)).sort();
  // Las credenciales de proveedor se exigen en AMBAS plantillas: la de desarrollo documenta que
  // existen, y la de producción es la que un operador copia para desplegar.
  const missingCredentials = credentialKeys.filter((key) => !present.has(key) || !presentInProduction.has(key)).sort();
  const repeated = duplicates(keys);
  const repeatedInProduction = duplicates(productionKeys);

  if (missing.length > 0 || missingCredentials.length > 0 || repeated.length > 0 || repeatedInProduction.length > 0) {
    console.error('❌ Las plantillas de entorno no representan un contrato íntegro.');
    if (missing.length > 0) console.error(`   Faltan: ${missing.join(', ')}`);
    if (missingCredentials.length > 0) {
      console.error(
        `   Credenciales de proveedor externo ausentes en alguna plantilla: ${missingCredentials.join(', ')}. ` +
          'Las exige PRODUCTION_CREDENTIAL_REQUIREMENTS — ver docs/config/credenciales-requeridas.md.',
      );
    }
    if (repeated.length > 0) console.error(`   Duplicadas en .env.example: ${repeated.join(', ')}`);
    if (repeatedInProduction.length > 0) console.error(`   Duplicadas en .env.production.example: ${repeatedInProduction.join(', ')}`);
    process.exit(1);
  }

  console.log(
    `✅ .env.example cubre ${schemaKeys.length} variables tipadas y ${credentialKeys.length} credenciales de proveedor externo; ` +
      'ambas plantillas están libres de duplicados.',
  );
}

main();
