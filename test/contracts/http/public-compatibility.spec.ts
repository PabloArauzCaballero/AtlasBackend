/**
 * @file AT-005 — contrato público congelado: rutas, métodos, códigos, cabeceras, parámetros y seguridad.
 * @business Un cliente (portal, app, ERP) que hoy funciona debe seguir funcionando tras la transición: la
 *   proyección de la superficie pública se compara con la golden versionada; cualquier ruta, código de
 *   respuesta, cabecera obligatoria, parámetro de paginación o esquema de seguridad que cambie rompe aquí,
 *   con el diff exacto. Sin valores: sólo nombres (nunca tokens, contraseñas ni PII).
 * @system Proyecta `docs/endpoints/openapi.yaml` (que `check:openapi` mantiene igual a la aplicación real)
 *   a `test/contracts/http/__golden__/public-surface.json`. Regenerar a propósito:
 *   `UPDATE_GOLDEN=1 yarn jest test/contracts/http/public-compatibility.spec.ts` y revisar el diff en el PR.
 */
import { describe, expect, it } from '@jest/globals';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

const ROOT = join(__dirname, '..', '..', '..');
const GOLDEN = join(__dirname, '__golden__', 'public-surface.json');

type Operation = {
  operationId?: string;
  parameters?: Array<{ name: string; in: string; required?: boolean }>;
  responses?: Record<string, unknown>;
  security?: Array<Record<string, unknown>>;
  requestBody?: { required?: boolean };
};
type Projection = Record<
  string,
  { operationId: string | null; responses: string[]; headers: string[]; query: string[]; path: string[]; security: string[]; body: boolean }
>;

function project(): Projection {
  const document = yaml.load(readFileSync(join(ROOT, 'docs', 'endpoints', 'openapi.yaml'), 'utf8')) as {
    paths: Record<string, Record<string, Operation>>;
  };
  const projection: Projection = {};
  for (const [path, methods] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      const parameters = operation.parameters ?? [];
      const names = (where: string, onlyRequired = false) =>
        parameters
          .filter((parameter) => parameter.in === where && (!onlyRequired || parameter.required))
          .map((parameter) => parameter.name)
          .sort();
      projection[`${method.toUpperCase()} ${path}`] = {
        operationId: operation.operationId ?? null,
        responses: Object.keys(operation.responses ?? {}).sort(),
        headers: names('header', true),
        query: names('query'),
        path: names('path'),
        security: (operation.security ?? []).flatMap((entry) => Object.keys(entry)).sort(),
        body: Boolean(operation.requestBody?.required),
      };
    }
  }
  return projection;
}

describe('AT-005 · contrato HTTP público congelado', () => {
  const current = project();

  it('la superficie pública coincide con la golden versionada (rutas, códigos, cabeceras, parámetros, seguridad)', () => {
    if (process.env.UPDATE_GOLDEN === '1') {
      mkdirSync(join(__dirname, '__golden__'), { recursive: true });
      writeFileSync(GOLDEN, `${JSON.stringify(current, null, 2)}\n`);
    }
    expect(existsSync(GOLDEN)).toBe(true);
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Projection;
    expect(current).toEqual(golden);
  });

  it('la golden no contiene valores sensibles: sólo nombres', () => {
    const text = readFileSync(GOLDEN, 'utf8');
    expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}|password=|Bearer [A-Za-z0-9]/);
  });

  it('paginación por cursor: toda operación con `cursor` declara `limit`', () => {
    const cursorOps = Object.entries(current).filter(([, op]) => op.query.includes('cursor'));
    expect(cursorOps.length).toBeGreaterThan(0);
    // Excepciones heredadas y congeladas: colas de operación que paginan por cursor sin `limit` explícito.
    const withoutLimit = [
      'GET /operations/manual-review-cases',
      'GET /operations/fraud-cases',
      'GET /operations/audit/customer/{customerId}/feed',
    ];
    for (const [key, op] of cursorOps) {
      expect({ key, hasLimit: op.query.includes('limit') || withoutLimit.includes(key) }).toEqual({ key, hasLimit: true });
    }
  });

  it('toda operación declara al menos un esquema de seguridad o es una ruta pública conocida (health, auth, onboarding)', () => {
    const publicPrefixes = [
      '/health',
      '/auth',
      '/internal/auth',
      '/merchant/auth',
      '/onboarding',
      '/customers/onboarding',
      '/metrics',
      '/partners/auth',
    ];
    const unprotected = Object.entries(current)
      .filter(([, op]) => op.security.length === 0)
      .map(([key]) => key)
      .filter((key) => !publicPrefixes.some((prefix) => key.split(' ')[1].startsWith(prefix)));
    // Lista congelada: si aparece una ruta nueva sin seguridad y fuera de los prefijos públicos, falla.
    const goldenPath = join(__dirname, '__golden__', 'unprotected-routes.json');
    if (process.env.UPDATE_GOLDEN === '1') writeFileSync(goldenPath, `${JSON.stringify(unprotected.sort(), null, 2)}\n`);
    expect(unprotected.sort()).toEqual(JSON.parse(readFileSync(goldenPath, 'utf8')));
  });
});
