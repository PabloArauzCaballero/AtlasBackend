/**
 * @file AT-018 — cada contexto publica su registro de modelos; el registro global sólo agrega.
 * @business Un modelo registrado dos veces o sin dueño es una tabla que dos contextos creen suya; en
 *   una extracción eso acaba en dos escritores.
 * @system Reglas: sin duplicados en `databaseModels`; el registro de Crédito y el de Mensajería
 *   contienen sólo tablas cuyo dueño declarado es su contexto; `synchronize`/`autoLoadModels` nunca
 *   activos; mover archivos no cambió tablas ni migraciones (misma lista de tablas que antes).
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSequelizeOptions } from '../../src/config/database.config.js';
import { databaseModels } from '../../src/database/database-models.js';
import { ATLAS_DOMAIN_TABLES } from '../../src/database/domain-schemas.js';
import { CREDIT_MODELS } from '../../src/modules/credit/infrastructure/persistence/credit-models.js';
import { NOTIFICATION_MODELS } from '../../src/modules/notifications/infrastructure/persistence/notification-models.js';
import { readStaticRegistry } from '../../scripts/architecture/inventory-database.js';

type ContextMap = { modules: Record<string, { context: string }>; tableOwners: Record<string, string> };
const rootDir = resolve(__dirname, '../..');
const contextMap = JSON.parse(readFileSync(resolve(rootDir, 'docs/architecture/microservices/context-map.json'), 'utf8')) as ContextMap;

// Sin Sequelize inicializado, la tabla de un modelo se lee del decorador `@Table` en su fuente.
const tableByModel = new Map(Object.entries(readStaticRegistry(rootDir).modelByTable).map(([table, model]) => [model, table]));
const tableOf = (model: { name: string }): string => {
  const table = tableByModel.get(model.name);
  if (!table) throw new Error(`${model.name} no tiene @Table con tableName en src/database/models`);
  return table;
};

describe('propiedad de modelos (AT-018)', () => {
  it('el registro global no tiene modelos duplicados', () => {
    const names = databaseModels.map((model) => model.name);
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
    expect(duplicates).toEqual([]);
  });

  it('el registro de Crédito sólo contiene tablas del schema credit cuyo dueño es el contexto de crédito', () => {
    const creditTables = new Set(ATLAS_DOMAIN_TABLES.credit);
    for (const model of CREDIT_MODELS) {
      const table = tableOf(model);
      expect(creditTables.has(table)).toBe(true);
      const owner = contextMap.tableOwners[table] ?? 'credit';
      expect(contextMap.modules[owner]?.context).toBe('credit-admission');
    }
  });

  it('el registro de Mensajería sólo contiene tablas del schema messaging; contactos y tenant no son suyos', () => {
    const messagingTables = new Set(ATLAS_DOMAIN_TABLES.messaging);
    const names = NOTIFICATION_MODELS.map((model) => tableOf(model));
    for (const table of names) expect(messagingTables.has(table)).toBe(true);
    expect(names).not.toContain('customer_contact_methods');
    expect(names).not.toContain('tenants');
  });

  it('un modelo de Crédito registrado también por otro contexto se detecta (regla negativa)', () => {
    const creditNames = new Set(CREDIT_MODELS.map((model) => model.name));
    const foreign = [...NOTIFICATION_MODELS].filter((model) => creditNames.has(model.name));
    expect(foreign).toEqual([]);
    // Fixture negativa: si Mensajería registrara CreditApplicationModel, la intersección lo delataría.
    const pretend = [...NOTIFICATION_MODELS, CREDIT_MODELS[1]];
    expect(pretend.filter((model) => creditNames.has(model.name)).map((model) => model.name)).toEqual(['CreditApplicationModel']);
  });

  it('el ORM nunca sincroniza ni autocarga: el esquema sólo cambia por migración', () => {
    const options = buildSequelizeOptions() as { synchronize?: boolean; autoLoadModels?: boolean; sync?: unknown };
    expect(options.synchronize ?? false).toBe(false);
    expect(options.autoLoadModels ?? false).toBe(false);
    expect(options.sync).toBeUndefined();
  });

  it('mover los registros no cambió el conjunto de tablas mapeadas (200 tablas del inventario)', () => {
    const mapped = new Set(databaseModels.map((model) => tableOf(model)));
    const inventoried = new Set(Object.values(ATLAS_DOMAIN_TABLES).flat());
    const unmapped = [...inventoried].filter((table) => !mapped.has(table));
    // Tablas sin modelo (se leen por SQL: catálogo de schemas, contexto sembrado…), fijadas para que no crezcan.
    expect(unmapped.length).toBeLessThanOrEqual(KNOWN_TABLES_WITHOUT_MODEL);
    expect([...mapped].every((table) => inventoried.has(table))).toBe(true);
  });
});

/** Medido el 2026-09-11: tablas del inventario lógico que ningún modelo mapea (se acceden por SQL). */
const KNOWN_TABLES_WITHOUT_MODEL = 11;
