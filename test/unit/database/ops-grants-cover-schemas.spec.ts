import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ATLAS_SCHEMAS } from '../../../src/database/domain-schemas.js';

/**
 * Los scripts de provisión tienen que cubrir TODOS los schemas de dominio.
 *
 * `ops/postgres/grants.sql` y `ops/postgres/verify-privileges.sql` repiten la lista a mano, mientras
 * que `check:db-privileges --strict` la deriva de `ATLAS_SCHEMAS`. Las dos listas se separaron sin
 * que nada lo notara hasta que el gate falló en CI con `permission denied for schema credit`: el rol
 * de la aplicación no tenía acceso a un dominio entero —solicitudes, líneas y préstamos— en
 * cualquier base provisionada con esos scripts.
 *
 * Esta prueba no necesita base de datos: compara texto contra la única fuente de verdad, que es
 * exactamente el control que faltaba.
 */
describe('ops/postgres cubre todos los schemas de dominio', () => {
  const read = (file: string) => readFileSync(resolve(process.cwd(), 'ops/postgres', file), 'utf8');

  it.each(Object.values(ATLAS_SCHEMAS))('grants.sql otorga privilegios sobre %s', (schema) => {
    expect(read('grants.sql')).toContain(`'${schema}'`);
  });

  it.each(Object.values(ATLAS_SCHEMAS))('verify-privileges.sql reporta %s en la tabla de privilegios', (schema) => {
    expect(read('verify-privileges.sql')).toContain(`('${schema}')`);
  });

  /** Si la cobertura CRUD mira menos schemas que los que se otorgan, deja de ser una verificación. */
  it('la cobertura CRUD de verify-privileges.sql lista exactamente los schemas de dominio', () => {
    const sql = read('verify-privileges.sql');
    const inClause = /WHERE schemaname IN \(([^)]+)\)/.exec(sql)?.[1] ?? '';
    const listed = [...inClause.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    expect(listed.sort()).toEqual([...Object.values(ATLAS_SCHEMAS)].sort());
  });
});
