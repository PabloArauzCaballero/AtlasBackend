import { afterAll, describe, expect, it } from '@jest/globals';
import { Sequelize } from 'sequelize-typescript';
import { atlasSchemaFor } from '../../../src/database/domain-schemas.js';
import { databaseModels } from '../../../src/database/sequelize.module.js';

const sequelize = new Sequelize({
  dialect: 'postgres',
  database: 'atlas_schema_contract',
  username: 'contract',
  password: 'contract',
  logging: false,
  models: databaseModels,
});

afterAll(async () => sequelize.close());

describe('contrato de schemas del ORM', () => {
  it('inicializa todos los modelos canónicos con el schema físico esperado', () => {
    expect(databaseModels.length).toBeGreaterThan(100);
    for (const model of databaseModels) {
      const table = model.getTableName() as { tableName: string; schema?: string };
      expect({ model: model.name, table: table.tableName, schema: table.schema }).toEqual({
        model: model.name,
        table: table.tableName,
        schema: atlasSchemaFor(table.tableName),
      });
      expect(table.schema).not.toBe('public');
    }
  });
});
