/**
 * @file AT-047 — toda ruta entre contextos exige identidad de servicio, y eso no depende del OpenAPI.
 * @business Las rutas `internal/contexts/**` sirven datos de un contexto a otro (incluidas direcciones de
 *   contacto en claro). Aparecen en el OpenAPI con `security: []` porque llevan `@Public()` —el guard
 *   global de sesión no entiende sus tokens, que son de otra audiencia—, así que la golden de rutas sin
 *   seguridad no las protege: si alguien borrara `@UseGuards(ServiceTokenGuard)`, esa golden no cambiaría.
 *   Esta prueba es la que sí lo nota (revisión independiente A, hallazgo 11).
 * @system Lee las fuentes de los controladores cuyo `@Controller` empieza por `internal/contexts/` y exige
 *   `ServiceTokenGuard` + `@ServiceScope` en cada uno, y una huella de recurso por ruta que devuelva datos
 *   personales.
 */
import { describe, expect, it } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');
const SRC = join(ROOT, 'src');

function controllers(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) controllers(path, found);
    else if (entry.endsWith('.controller.ts')) found.push(path);
  }
  return found;
}

const interContext = controllers(SRC).filter((file) => /@Controller\('internal\/contexts\//.test(readFileSync(file, 'utf8')));

describe('AT-047 · rutas entre contextos', () => {
  it('hay al menos una ruta entre contextos que comprobar', () => {
    expect(interContext.map((file) => relative(ROOT, file))).toEqual(['src/modules/customers/customer-recipient-directory.controller.ts']);
  });

  it('cada controlador entre contextos monta ServiceTokenGuard y declara @ServiceScope', () => {
    for (const file of interContext) {
      const source = readFileSync(file, 'utf8');
      const label = relative(ROOT, file);
      expect({ label, guard: /@UseGuards\(\s*ServiceTokenGuard\s*\)/.test(source) }).toEqual({ label, guard: true });
      expect({ label, scope: /@ServiceScope\(/.test(source) }).toEqual({ label, scope: true });
      // Ninguna ruta entre contextos puede depender del guard de sesión de usuario: otra audiencia.
      expect({ label, jwtGuard: /JwtAuthGuard/.test(source) }).toEqual({ label, jwtGuard: false });
    }
  });

  it('cada ruta entre contextos ata su token a un recurso concreto (no vale un token de tenant)', () => {
    for (const file of interContext) {
      // Sin bloques de comentario: el docblock del archivo también menciona `@ServiceScope`.
      const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      const label = relative(ROOT, file);
      const routes = (source.match(/@(Get|Post|Put|Patch|Delete)\(/g) ?? []).length;
      const scopes = [...source.matchAll(/@ServiceScope\(/g)];
      const withResource = scopes.filter(({ index }) => /resourceFingerprint/.test(source.slice(index ?? 0, (index ?? 0) + 400))).length;
      expect({ label, routes, scopes: scopes.length, withResource }).toEqual({ label, routes, scopes: routes, withResource: routes });
    }
  });
});
