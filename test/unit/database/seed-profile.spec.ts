import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  assertProfileAllowedForEnv,
  assertReseedAllowed,
  findForbiddenProductionTokens,
  isSeedProfile,
  resolveSeedProfile,
  SEED_PROFILE_STAGES,
} from '../../../src/database/seed-profiles.js';

describe('seed profiles', () => {
  describe('resolveSeedProfile', () => {
    it('prioriza el flag explícito sobre todo lo demás', () => {
      expect(resolveSeedProfile({ explicit: 'demo', envProfile: 'production', nodeEnv: 'production' })).toBe('demo');
    });

    it('usa SEED_PROFILE de entorno cuando no hay flag', () => {
      expect(resolveSeedProfile({ explicit: null, envProfile: 'test', nodeEnv: 'development' })).toBe('test');
    });

    it('deriva el default de NODE_ENV', () => {
      expect(resolveSeedProfile({ nodeEnv: 'production' })).toBe('production');
      expect(resolveSeedProfile({ nodeEnv: 'test' })).toBe('test');
      expect(resolveSeedProfile({ nodeEnv: 'development' })).toBe('development');
      expect(resolveSeedProfile({ nodeEnv: 'anything-else' })).toBe('development');
    });

    it('lanza ante un perfil inválido', () => {
      expect(() => resolveSeedProfile({ explicit: 'staging', nodeEnv: 'development' })).toThrow(/inválido/i);
      expect(() => resolveSeedProfile({ envProfile: 'prod', nodeEnv: 'development' })).toThrow(/SEED_PROFILE/);
    });
  });

  describe('assertProfileAllowedForEnv', () => {
    it('bloquea perfiles con datos ficticios bajo NODE_ENV=production', () => {
      expect(() => assertProfileAllowedForEnv('development', 'production')).toThrow(/prohibido/i);
      expect(() => assertProfileAllowedForEnv('demo', 'production')).toThrow(/prohibido/i);
      expect(() => assertProfileAllowedForEnv('test', 'production')).toThrow(/prohibido/i);
    });

    it('permite el perfil production en cualquier entorno y perfiles no productivos fuera de producción', () => {
      expect(() => assertProfileAllowedForEnv('production', 'production')).not.toThrow();
      expect(() => assertProfileAllowedForEnv('production', 'development')).not.toThrow();
      expect(() => assertProfileAllowedForEnv('development', 'development')).not.toThrow();
      expect(() => assertProfileAllowedForEnv('demo', 'staging')).not.toThrow();
    });
  });

  describe('assertReseedAllowed', () => {
    it('prohíbe reseed en producción y lo permite en el resto', () => {
      expect(() => assertReseedAllowed('production')).toThrow(/no está permitido/i);
      expect(() => assertReseedAllowed('development')).not.toThrow();
      expect(() => assertReseedAllowed('demo')).not.toThrow();
      expect(() => assertReseedAllowed('test')).not.toThrow();
    });
  });

  describe('findForbiddenProductionTokens', () => {
    it('detecta tokens de datos ficticios como segmentos', () => {
      expect(findForbiddenProductionTokens('20260101000000-seed-portal-demo-data.ts')).toEqual(['demo']);
      expect(findForbiddenProductionTokens('20260101000000-seed-mock-providers.ts')).toEqual(['mock']);
      expect(findForbiddenProductionTokens('20260101000000-seed-sample-fixture.ts').sort()).toEqual(['fixture', 'sample']);
    });

    it('no da falsos positivos con palabras que contienen los tokens como substring', () => {
      expect(findForbiddenProductionTokens('20260101000000-seed-device-catalog.ts')).toEqual([]);
      expect(findForbiddenProductionTokens('20260101000000-seed-external-data-providers.ts')).toEqual([]);
      expect(findForbiddenProductionTokens('20260101000000-seed-development-note.ts')).toEqual([]);
    });
  });

  describe('isSeedProfile', () => {
    it('valida los perfiles conocidos', () => {
      expect(isSeedProfile('production')).toBe(true);
      expect(isSeedProfile('nope')).toBe(false);
      expect(isSeedProfile(42)).toBe(false);
    });
  });

  describe('SEED_PROFILE_STAGES', () => {
    it('production corre un solo stage', () => {
      expect(SEED_PROFILE_STAGES.production.map((stage) => stage.directory)).toEqual(['production']);
    });

    it('los perfiles superiores incluyen production primero y en orden', () => {
      expect(SEED_PROFILE_STAGES.development.map((stage) => stage.directory)).toEqual(['production', 'development']);
      expect(SEED_PROFILE_STAGES.demo.map((stage) => stage.directory)).toEqual(['production', 'development', 'demo']);
      expect(SEED_PROFILE_STAGES.test.map((stage) => stage.directory)).toEqual(['production', 'test']);
    });

    it('cada stage usa una tabla de tracking distinta', () => {
      const allTracking = Object.values(SEED_PROFILE_STAGES)
        .flat()
        .map((stage) => `${stage.directory}:${stage.trackingModelName}`);
      const unique = new Set(allTracking);
      // production aparece en varios perfiles pero siempre con la MISMA tabla → colapsa a un valor único.
      expect(unique.has('production:SequelizeDataSeedersProduction')).toBe(true);
      expect(unique.has('development:SequelizeDataSeedersDevelopment')).toBe(true);
      expect(unique.has('demo:SequelizeDataSeedersDemo')).toBe(true);
      expect(unique.has('test:SequelizeDataSeedersTest')).toBe(true);
    });
  });

  describe('el directorio production real no contiene datos ficticios en nombres', () => {
    it('ningún archivo de production/ dispara los tokens prohibidos', () => {
      const productionDir = resolve(process.cwd(), 'src', 'database', 'seeders', 'production');
      const files = readdirSync(productionDir).filter((name) => name.endsWith('.ts'));
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        expect(findForbiddenProductionTokens(join('production', file))).toEqual([]);
      }
    });
  });
});
