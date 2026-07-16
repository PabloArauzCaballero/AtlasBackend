/**
 * Perfiles de seeds de Atlas.
 *
 * Cada perfil es una secuencia ordenada de "stages", donde cada stage es un directorio de seeders
 * con SU PROPIA tabla de tracking Umzug. Esto implementa el enfoque preferido del plan (§9): un
 * `Umzug` por directorio en vez de un único glob que mezcla producción, desarrollo, demo y test.
 *
 * Reglas clave:
 * - `production` corre SOLO seeders de arranque (sin personas, clientes ni operaciones ficticias).
 * - Los perfiles superiores incluyen a los inferiores: development = production + development, etc.
 * - El directorio `production` siempre se rastrea en la MISMA tabla (`SequelizeDataSeedersProduction`)
 *   sin importar qué perfil lo dispare, así los seeders de arranque se aplican una sola vez.
 * - Un archivo movido entre perfiles queda rastreado sin ambigüedad porque cada directorio usa su
 *   propia tabla de tracking.
 */

export const SEED_PROFILES = ['production', 'development', 'demo', 'test'] as const;
export type SeedProfile = (typeof SEED_PROFILES)[number];

/** Un directorio de seeders con su tabla de tracking dedicada. */
export interface SeedStage {
  /** Nombre del directorio bajo `src/database/seeders/`. */
  readonly directory: SeedProfile;
  /** `modelName` de `SequelizeStorage` (tabla de tracking) para este directorio. */
  readonly trackingModelName: string;
}

const STAGE: Record<SeedProfile, SeedStage> = {
  production: { directory: 'production', trackingModelName: 'SequelizeDataSeedersProduction' },
  development: { directory: 'development', trackingModelName: 'SequelizeDataSeedersDevelopment' },
  demo: { directory: 'demo', trackingModelName: 'SequelizeDataSeedersDemo' },
  test: { directory: 'test', trackingModelName: 'SequelizeDataSeedersTest' },
};

/**
 * Stages ordenados por perfil. `production` siempre corre primero (crea catálogos y baselines de
 * los que dependen los seeders demo/dev, p. ej. el ruleset de riesgo `_id = 101`).
 */
export const SEED_PROFILE_STAGES: Record<SeedProfile, readonly SeedStage[]> = {
  production: [STAGE.production],
  development: [STAGE.production, STAGE.development],
  demo: [STAGE.production, STAGE.development, STAGE.demo],
  test: [STAGE.production, STAGE.test],
};

/** Tokens prohibidos en nombres de archivo del directorio `production` (§11). */
export const FORBIDDEN_PRODUCTION_FILENAME_TOKENS = ['demo', 'dev', 'fixture', 'mock', 'sample'] as const;

/**
 * Devuelve los tokens prohibidos presentes en un nombre de archivo, comparando por SEGMENTOS
 * (separados por caracteres no alfanuméricos) para no dar falsos positivos con palabras como
 * "device" o "data" que contienen "dev"/"dat" como substring.
 */
export function findForbiddenProductionTokens(fileName: string): string[] {
  const segments = fileName
    .toLowerCase()
    .replace(/\.ts$/, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return FORBIDDEN_PRODUCTION_FILENAME_TOKENS.filter((token) => segments.includes(token));
}

export function isSeedProfile(value: unknown): value is SeedProfile {
  return typeof value === 'string' && (SEED_PROFILES as readonly string[]).includes(value);
}

/**
 * Resuelve el perfil efectivo a partir de (en orden): flag explícito, `SEED_PROFILE` de entorno, y
 * finalmente un default derivado de `NODE_ENV` (production→production, test→test, resto→development).
 */
export function resolveSeedProfile(input: { explicit?: string | null; envProfile?: string | null; nodeEnv: string }): SeedProfile {
  const explicit = input.explicit?.trim();
  if (explicit) {
    if (!isSeedProfile(explicit)) {
      throw new Error(`Perfil de seed inválido: "${explicit}". Válidos: ${SEED_PROFILES.join(', ')}.`);
    }
    return explicit;
  }

  const envProfile = input.envProfile?.trim();
  if (envProfile) {
    if (!isSeedProfile(envProfile)) {
      throw new Error(`SEED_PROFILE inválido: "${envProfile}". Válidos: ${SEED_PROFILES.join(', ')}.`);
    }
    return envProfile;
  }

  if (input.nodeEnv === 'production') return 'production';
  if (input.nodeEnv === 'test') return 'test';
  return 'development';
}

/**
 * Verifica combinaciones perfil↔entorno prohibidas. Lanza si se pide un perfil con datos ficticios
 * bajo `NODE_ENV=production`. Es el guard de nivel runner del plan (§7.2); cada paquete de
 * desarrollo crítico repite su propio guard como defensa en profundidad.
 */
export function assertProfileAllowedForEnv(profile: SeedProfile, nodeEnv: string): void {
  if (nodeEnv === 'production' && profile !== 'production') {
    throw new Error(
      `Perfil de seed "${profile}" está prohibido con NODE_ENV=production. En producción solo se ` +
        'permite el perfil "production" (catálogos y baselines de arranque, sin datos ficticios).',
    );
  }
}

/** El perfil `production` nunca debe reseedearse (truncar+recargar) — §8, §10, §41. */
export function assertReseedAllowed(profile: SeedProfile): void {
  if (profile === 'production') {
    throw new Error(
      'reseed (truncar + recargar) no está permitido para el perfil production. Corrige producción con ' +
        'seeders nuevos idempotentes o migraciones de datos explícitas, nunca truncando.',
    );
  }
}
