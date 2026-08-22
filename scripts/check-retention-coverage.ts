/**
 * Gate estático: ninguna política de retención sembrada puede quedar sin destino ejecutable.
 *
 * `apply_retention_policies` solo actúa sobre los `policy_code` presentes en `RETENTION_TARGETS`
 * (`src/modules/runtime-jobs/runtime-jobs.service.ts`). El resto se reportan como `unmappedPolicies`
 * dentro del JSON de resultado del job — un campo que nadie mira. La auditoría integral del
 * 2026-08-06 encontró SEIS políticas sembradas (varias en el perfil de PRODUCCIÓN, con base legal
 * declarada: `kyc_aml_record_keeping`, 1825 días, acción `anonymize`) y solo TRES tablas mapeadas.
 *
 * En un backend KYC eso no es deuda técnica: es una política de retención escrita, aprobada y
 * sembrada en la base que ningún proceso aplica. El sistema documenta un control que no ejerce.
 *
 * Este gate obliga a una decisión EXPLÍCITA por cada política sembrada:
 *   - mapearla en `RETENTION_TARGETS` (se ejecuta), o
 *   - declararla en `RETENTION_POLICIES_PENDING_DECISION` con el motivo por el que todavía no puede
 *     ejecutarse (típicamente: su alcance necesita una decisión de producto/legal).
 *
 * Lo que ya no se admite es el tercer estado — sembrada, activa y silenciosamente inerte.
 *
 * Es estático (parsea fuentes, no consulta Postgres) para correr en CI sin base de datos, igual que
 * `check:entity-narratives` y `check:domain-schemas`.
 *
 * Ejecutar con `yarn check:retention-coverage`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { RETENTION_POLICIES_PENDING_DECISION, RETENTION_TARGETS } from '../src/modules/runtime-jobs/retention-targets.js';

const SEEDERS_DIR = resolve(process.cwd(), 'src/database/seeders');
const POLICY_CODE_LITERAL = /policy_code:\s*'([a-z0-9_-]+)'/g;
const POLICY_CODE_CONSTANT = /const\s+[A-Z_]*RETENTION_POLICY_CODE[A-Z_]*\s*=\s*'([a-z0-9_-]+)'/g;

type SeededPolicy = { code: string; file: string };

function seederFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) seederFiles(full, found);
    else if (entry.endsWith('.ts')) found.push(full);
  }
  return found;
}

function seededPolicies(): SeededPolicy[] {
  const seen = new Map<string, string>();
  for (const file of seederFiles(SEEDERS_DIR)) {
    const source = readFileSync(file, 'utf8');
    for (const pattern of [POLICY_CODE_LITERAL, POLICY_CODE_CONSTANT]) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        const code = match[1];
        if (!seen.has(code)) seen.set(code, relative(process.cwd(), file).replace(/\\/g, '/'));
      }
    }
  }
  return [...seen.entries()].map(([code, file]) => ({ code, file }));
}

function main(): void {
  const seeded = seededPolicies();
  const executable = new Set(Object.keys(RETENTION_TARGETS));
  const declaredPending = new Set(Object.keys(RETENTION_POLICIES_PENDING_DECISION));

  const undecided = seeded.filter((policy) => !executable.has(policy.code) && !declaredPending.has(policy.code));

  // Una entrada de "pendiente de decisión" que ya nadie siembra es ruido que envejece: se avisa para
  // que se borre, del mismo modo que los otros trinquetes del repo reportan sus mejoras.
  const seededCodes = new Set(seeded.map((policy) => policy.code));
  const stalePending = [...declaredPending].filter((code) => !seededCodes.has(code));
  const staleTargets = Object.keys(RETENTION_TARGETS).filter((code) => !seededCodes.has(code));

  if (stalePending.length > 0) {
    console.warn(`ℹ️  Declaradas como pendientes pero ya no sembradas (se pueden borrar): ${stalePending.join(', ')}`);
  }
  if (staleTargets.length > 0) {
    console.warn(`ℹ️  Mapeadas en RETENTION_TARGETS pero no sembradas por ningún seeder: ${staleTargets.join(', ')}`);
  }

  if (undecided.length > 0) {
    console.error('❌ Políticas de retención sembradas sin destino ejecutable ni decisión declarada:\n');
    for (const policy of undecided) {
      console.error(`   - ${policy.code}  (${policy.file})`);
    }
    console.error(
      '\n   Cada una debe resolverse de una de estas dos formas, en src/modules/runtime-jobs/retention-targets.ts:\n' +
        '     1. Añadirla a RETENTION_TARGETS con su tabla y acción -> el job la ejecutará.\n' +
        '     2. Añadirla a RETENTION_POLICIES_PENDING_DECISION con el motivo por el que aún no puede ejecutarse.\n' +
        '\n   Una política sembrada, activa y sin ejecutar es un control declarado que no se ejerce.',
    );
    process.exit(1);
  }

  console.log(
    `✅ ${seeded.length} políticas de retención sembradas: ${executable.size} ejecutables, ` +
      `${declaredPending.size} con decisión pendiente declarada, 0 en silencio.`,
  );
}

main();
