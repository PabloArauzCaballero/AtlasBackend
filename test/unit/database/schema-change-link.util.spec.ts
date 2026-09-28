import { describe, expect, it, jest } from '@jest/globals';
import { linkSchemaChangeToMigration } from '../../../src/database/migration-support/schema-change-link.util.js';

/**
 * Enlace «cambio aprobado → migración que lo aplica» (P-35, hallazgo A4). Sólo toca filas aprobadas
 * y sin enlace previo, y no falla si el cambio no existe en esta base.
 */
describe('linkSchemaChangeToMigration', () => {
  const build = (returned: unknown[]) => {
    const query = jest.fn(async (..._args: unknown[]) => [returned, undefined] as never);
    return { qi: { sequelize: { query } } as never, query };
  };

  it('enlaza un cambio aprobado y devuelve cuántas filas tocó', async () => {
    const { qi, query } = build([{ _id: '42' }]);
    await expect(linkSchemaChangeToMigration(qi, '42', '20261001120000-create-foo')).resolves.toBe(1);
    const [sql, options] = query.mock.calls[0] as [string, { replacements: Record<string, string> }];
    expect(sql).toContain("approval_status = 'approved'");
    expect(sql).toContain('applied_by_migration IS NULL');
    expect(sql).toContain('platform_ops.schema_change_log');
    expect(options.replacements).toEqual({ changeId: '42', migrationName: '20261001120000-create-foo' });
  });

  it('no falla si el cambio no está en esta base: devuelve 0', async () => {
    const { qi } = build([]);
    await expect(linkSchemaChangeToMigration(qi, '999', 'x')).resolves.toBe(0);
  });
});
