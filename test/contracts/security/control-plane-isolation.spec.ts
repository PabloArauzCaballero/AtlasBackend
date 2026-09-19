/**
 * @file AT-049 — el plano de control no ejecuta DDL ni expone logs sin rol.
 * @business Proponer un cambio de esquema escribe una propuesta, nunca ALTER TABLE; la lectura de logs exige
 *   un rol interno; el runtime no tiene privilegios extra por existir estos módulos.
 * @system Inspección del código fuente de los servicios (sin `queryInterface`/DDL) y de los decoradores de
 *   los controladores.
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = resolve(__dirname, '../../..');
const read = (path: string) => readFileSync(resolve(rootDir, path), 'utf8');

describe('aislamiento del plano de control (AT-049)', () => {
  it('el servicio de propuestas de esquema no ejecuta DDL: escribe en el registro de cambios', () => {
    const source = read('src/modules/schema-management/services/schema-management.service.ts');
    expect(source).not.toMatch(/ALTER TABLE|CREATE TABLE|DROP TABLE|queryInterface|\.sync\(/);
    expect(source).toMatch(/createChangeLogEntry/);
  });

  it('proponer una tabla exige roles de operación; consultar logs exige un rol interno explícito', () => {
    const schema = read('src/modules/schema-management/schema-management.controller.ts');
    expect(schema).toMatch(/@Post\('tables'\)\s*\n\s*@Roles\(/);
    const logs = read('src/modules/log-sync/mongo-logs.controller.ts');
    expect(logs).toMatch(/@Roles\(/);
  });

  it('los módulos del plano de control están declarados como plataforma o lectores gobernados, no como dueños de negocio', () => {
    const map = JSON.parse(read('docs/architecture/microservices/context-map.json')) as {
      modules: Record<string, { context: string; role: string }>;
    };
    for (const name of ['schema-management', 'log-sync', 'systems-ops', 'audit']) expect(map.modules[name].context).toBe('platform');
    expect(map.modules['sql-console'].role).toBe('reader');
  });
});
