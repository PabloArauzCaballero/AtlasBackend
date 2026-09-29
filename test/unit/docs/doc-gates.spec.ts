import { citedPath, isIgnored, pathExists } from '../../../scripts/docs/check-doc-paths';
import {
  describeDrift,
  isKnownCommand,
  referenceExists,
  rewriteMarkers,
  routeReference,
  yarnCommands,
} from '../../../scripts/docs/lib/doc-markers';

/**
 * Los gates de deriva de la documentación (`check:docs-figures`, `check:doc-routes`, `check:doc-paths`)
 * sólo valen si fallan cuando la documentación miente: cada caso «negativo» de aquí es esa prueba.
 */
describe('gates de deriva de la documentación', () => {
  const known = { scripts: new Set(['build', 'db:seed:pull', 'db:seed:status']), binaries: new Set(['tsx']) };

  describe('comandos yarn', () => {
    it('reconoce un script de package.json y un binario', () => {
      expect(yarnCommands('yarn build && yarn run db:seed:pull')).toEqual(['build', 'db:seed:pull']);
      expect(isKnownCommand('build', known)).toBe(true);
      expect(isKnownCommand('tsx', known)).toBe(true);
      expect(isKnownCommand('db:seed:*', known)).toBe(true);
    });

    it('NEGATIVO: un comando que ya no existe se detecta', () => {
      expect(yarnCommands('yarn db:seed:up')).toEqual(['db:seed:up']);
      expect(isKnownCommand('db:seed:up', known)).toBe(false);
      expect(isKnownCommand('check:seed-profiles', known)).toBe(false);
      expect(isKnownCommand('reseed:*', known)).toBe(false);
    });
  });

  describe('cifras marcadas', () => {
    const figures = { 'openapi.paths': 539 };

    it('las reescribe y describe la deriva', () => {
      const stale = 'Hay <!-- fig:openapi.paths -->252<!-- /fig --> rutas.';
      const { text, unknown } = rewriteMarkers(stale, figures, {});
      expect(text).toBe('Hay <!-- fig:openapi.paths -->539<!-- /fig --> rutas.');
      expect(unknown).toEqual([]);
      expect(describeDrift(stale, text)).toEqual(['fig:openapi.paths: dice 252, el código da 539']);
    });

    it('NEGATIVO: una marca con clave inventada no pasa en silencio', () => {
      expect(rewriteMarkers('<!-- fig:no.existe -->1<!-- /fig -->', figures, {}).unknown).toEqual(['fig:no.existe']);
    });

    it('una cifra al día no reporta deriva', () => {
      const fresh = '<!-- fig:openapi.paths -->539<!-- /fig -->';
      expect(describeDrift(fresh, rewriteMarkers(fresh, figures, {}).text)).toEqual([]);
    });
  });

  describe('rutas HTTP citadas', () => {
    const routes = new Set(['GET /customers/{}', 'POST /credit/decisions']);

    it('lee `MÉTODO /ruta` y acepta `:id` o `{id}`', () => {
      expect(referenceExists(routeReference('GET /customers/{id}')!, routes)).toBe(true);
      expect(referenceExists(routeReference('GET /customers/*')!, routes)).toBe(true);
    });

    it('NEGATIVO: una ruta inexistente o con otro método se detecta', () => {
      expect(referenceExists(routeReference('POST /risk/evaluations')!, routes)).toBe(false);
      expect(referenceExists(routeReference('DELETE /customers/{id}')!, routes)).toBe(false);
      expect(routeReference('yarn build')).toBeNull();
    });
  });

  describe('rutas de archivo citadas', () => {
    it('distingue una ruta de archivo de la prosa y de las plantillas', () => {
      expect(citedPath('src/config/app-role.ts:12')).toBe('src/config/app-role.ts');
      expect(citedPath('src/modules/<A>/')).toBeNull();
      expect(citedPath('docs/foo')).toBeNull();
      expect(citedPath('AtlasOtroRepo/src/x.ts')).toBeNull();
      expect(citedPath('package.json')).toBe('package.json');
    });

    it('comprueba contra el árbol real', () => {
      expect(pathExists('src/config/app-role.ts')).toBe(true);
      expect(pathExists('src/modules/*/README.md')).toBe(true);
    });

    it('NEGATIVO: una ruta que no existe se detecta; un artefacto ignorado por git no se exige', () => {
      expect(pathExists('src/database/seeders/20260704121000-seed-internal-rbac-and-pablo.ts')).toBe(false);
      expect(pathExists('config/app-role.ts')).toBe(false);
      expect(isIgnored('.env')).toBe(true);
      expect(isIgnored('src/config/app-role.ts')).toBe(false);
    });
  });
});
