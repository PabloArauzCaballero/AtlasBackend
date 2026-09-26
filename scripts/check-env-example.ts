/**
 * Verifica que la plantilla local documente todo el contrato tipado de configuración.
 *
 * Las variables dinámicas de proveedores/OTel pueden existir solo en `.env.example`, pero ninguna
 * clave del esquema Zod puede faltar ni aparecer duplicada: ambas situaciones generan despliegues
 * difíciles de reproducir y documentación engañosa.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyEnvCrossChecks } from '../src/config/env-cross-checks.js';
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

/** Marcas inequívocas de «esto hay que rellenarlo»: nunca deben llegar a un arranque real. */
const PLACEHOLDER = /^<.*>$|^(change-me|changeme|tu-.*|secret-manager|<secret-manager>)$/i;

function templateValues(source: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of source.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match) values[match[1]] = match[2].trim();
  }
  return values;
}

/**
 * La plantilla de producción tiene que ser un punto de partida VÁLIDO.
 *
 * No basta con que nombre las variables: si un valor de ejemplo es sintácticamente inválido —una URL
 * con `<host>` dentro, una cadena vacía donde el esquema pide longitud mínima—, quien la copia
 * recibe un error que habla de otra cosa y pierde la tarde buscando el problema equivocado. Aquí se
 * carga tal cual, con `NODE_ENV=production`, y se exige que TODO lo que falle sea un secreto por
 * rellenar (lo que es correcto y esperable) y nada más.
 *
 * Es el gate que faltaba: hasta ahora nadie comprobaba que esa plantilla sirviera para arrancar.
 */
function checkProductionTemplateBoots(values: Record<string, string>): string[] {
  const schema = envBaseSchema.superRefine(applyEnvCrossChecks);
  const result = schema.safeParse({ ...values, NODE_ENV: 'production' });
  if (result.success) return [];

  const problemas: string[] = [];
  for (const issue of result.error.issues) {
    const key = issue.path.join('.');
    const value = values[key];
    // Un secreto todavía por rellenar es el fallo CORRECTO: la plantilla no trae credenciales.
    if (value !== undefined && PLACEHOLDER.test(value)) continue;
    if (value === undefined && issue.code === 'invalid_type') continue;
    problemas.push(`${key || '(raíz)'}: ${issue.message} (valor de la plantilla: ${value === undefined ? 'ausente' : `"${value}"`})`);
  }
  return problemas;
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
  const productionBootProblems = checkProductionTemplateBoots(templateValues(readFileSync(productionExamplePath, 'utf-8')));

  if (
    missing.length > 0 ||
    missingCredentials.length > 0 ||
    repeated.length > 0 ||
    repeatedInProduction.length > 0 ||
    productionBootProblems.length > 0
  ) {
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
    if (productionBootProblems.length > 0) {
      console.error(
        '   .env.production.example no arrancaría por motivos que NO son «falta rellenar el secreto»:\n' +
          productionBootProblems.map((problema) => `     - ${problema}`).join('\n'),
      );
    }
    process.exit(1);
  }

  console.log(
    `✅ .env.example cubre ${schemaKeys.length} variables tipadas y ${credentialKeys.length} credenciales de proveedor externo; ` +
      'ambas plantillas están libres de duplicados, y .env.production.example sólo falla por los secretos que hay que rellenar.',
  );
}

main();
