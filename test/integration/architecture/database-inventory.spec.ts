/**
 * @file AT-004 — el inventario de datos detecta lo que el TypeScript no cuenta: FKs entre schemas,
 *   vistas y funciones que leen otro schema, y tablas sin propietario.
 * @business Separar una base por «carpetas» ignorando estas relaciones rompe integridad referencial
 *   y lecturas que nadie importa desde código.
 * @system PostgreSQL real y migrado (`atlas_test`). El rol runtime no tiene DDL, así que las fixtures
 *   negativas no crean tablas: se ejercitan sobre el catálogo real y sobre entradas sintéticas a las
 *   funciones puras del inventario.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assignOwnership,
  readCatalog,
  readStaticRegistry,
  validateOwnership,
  type DatabaseCatalog,
} from '../../../scripts/architecture/inventory-database.js';
import type { IntegrationDatabase } from '../support/database.js';
import { openIntegrationDatabase } from '../support/database.js';

let database: IntegrationDatabase | null = null;
let catalog: DatabaseCatalog | null = null;
const rootDir = resolve(__dirname, '../../..');

beforeAll(async () => {
  database = await openIntegrationDatabase();
  if (database) catalog = await readCatalog(database.sequelize);
});

afterAll(async () => {
  await database?.close();
});

describe('AT-004 · inventario de la base', () => {
  it('detecta claves foráneas entre schemas con tabla de origen y destino', () => {
    if (!catalog) return;
    const cross = catalog.foreignKeys.filter((fk) => fk.crossSchema);
    expect(cross.length).toBeGreaterThan(0);
    expect(cross.every((fk) => fk.fromSchema !== fk.toSchema && fk.fromColumns.length > 0 && fk.toColumns.length > 0)).toBe(true);
    // Hallazgo del inventario (2026-09-11): `credit.credit_applications` no tiene NINGUNA FK —ni a
    // clientes, ni al producto, ni a la evaluación que la autoriza—; el enlace es lógico. Se fija aquí
    // para que el día que AT-021 la añada, esta prueba obligue a decir cómo se protege la referencia.
    const admissionFks = catalog.foreignKeys.filter((fk) => fk.fromTable === 'credit_applications');
    expect(admissionFks).toEqual([]);
  });

  it('las vistas read_api aparecen con las tablas que leen aunque ningún módulo importe su modelo', () => {
    if (!catalog) return;
    const readApi = catalog.views.filter((view) => view.schema === 'read_api');
    expect(readApi.length).toBeGreaterThan(0);
    expect(readApi.every((view) => view.referencedTables.length > 0)).toBe(true);
    expect(readApi.some((view) => view.referencedTables.some((table) => !table.startsWith('read_api.')))).toBe(true);
  });

  it('los disparadores y funciones quedan inventariados con su tabla', () => {
    if (!catalog) return;
    expect(catalog.triggers.length).toBeGreaterThan(0);
    expect(catalog.triggers.every((trigger) => trigger.table && trigger.function)).toBe(true);
  });

  it('cada tabla física de negocio tiene schema lógico y propietario candidato (con el mapa de contextos)', () => {
    if (!catalog) return;
    const registry = readStaticRegistry(rootDir);
    const declared = JSON.parse(readFileSync(resolve(rootDir, 'docs/architecture/microservices/context-map.json'), 'utf8')) as {
      tableOwners: Record<string, string>;
    };
    const ownership = assignOwnership(catalog, registry, declared.tableOwners);
    expect(ownership.filter((entry) => entry.issues.includes('sin_schema_logico'))).toEqual([]);
    expect(validateOwnership(ownership)).toEqual([]);
  });

  it('una tabla nueva sin propietario hace fallar la validación; no se asigna a plataforma por defecto', () => {
    const synthetic: DatabaseCatalog = {
      tables: [{ schema: 'platform_ops', table: 'tabla_nueva_sin_dueno', owner: 'atlas' }],
      foreignKeys: [],
      views: [],
      triggers: [],
      functions: [],
      grants: [],
    };
    const ownership = assignOwnership(synthetic, {
      modelByTable: {},
      registrationsByModule: {},
      rawSqlByModule: {},
      transactionOpenersByModule: {},
    });
    const entry = ownership.find((candidate) => candidate.table === 'tabla_nueva_sin_dueno');
    expect(entry?.ownerCandidate).toBeNull();
    expect(validateOwnership(ownership)).toEqual(['platform_ops.tabla_nueva_sin_dueno']);
  });

  it('el rol runtime no tiene privilegios de DDL: sólo DML sobre las tablas de negocio', () => {
    if (!catalog) return;
    const runtime = catalog.grants.filter((grant) => grant.grantee === 'atlas_app_rw');
    expect(runtime.length).toBeGreaterThan(0);
    // information_schema sólo lista privilegios de tabla (DML + TRUNCATE/REFERENCES/TRIGGER); el DDL
    // se mide por ownership del schema en `check:db-privileges --strict`. Aquí se fija que no sea dueño.
    expect(catalog.tables.every((table) => table.owner !== 'atlas_app_rw')).toBe(true);
  });
});
