import { describe, expect, it, jest } from '@jest/globals';
import { CustomerCampaignAudienceAdapter } from '../../../src/modules/customers/infrastructure/customer-campaign-audience.adapter.js';

describe('CustomerCampaignAudienceAdapter', () => {
  function build(rows: unknown[]) {
    const query = jest.fn(async (..._args: unknown[]) => rows);
    const adapter = new CustomerCampaignAudienceAdapter({ sequelize: { query } } as never);
    return { adapter, query };
  }

  it('estima con recuentos por canal y acota al tenant', async () => {
    const { adapter, query } = build([{ total: 12, with_push: 5, with_email: 3 }]);
    const estimate = await adapter.estimate('7', { match: 'all', rules: [] }, { requireMarketingConsent: true });
    expect(estimate).toMatchObject({ total: 12, withPushDevice: 5, withVerifiedEmail: 3 });
    const [sql, options] = query.mock.calls[0] as [string, { replacements: Record<string, unknown> }];
    expect(sql).toContain('COUNT(*) FILTER');
    expect(options.replacements.tenantId).toBe('7');
  });

  it('una base sin filas estima cero, no revienta', async () => {
    const { adapter } = build([]);
    expect((await adapter.estimate('1', { match: 'all', rules: [] }, { requireMarketingConsent: false })).total).toBe(0);
  });

  it('pagina por identificador: sin cursor empieza en 0 y respeta el límite', async () => {
    const { adapter, query } = build([{ customer_id: '44', has_push: true, has_email: false }]);
    const members = await adapter.listMembers(
      '1',
      { match: 'all', rules: [] },
      { requireMarketingConsent: false },
      { afterCustomerId: null, limit: 50 },
    );
    expect(members).toEqual([{ customerId: '44', hasPushDevice: true, hasVerifiedEmail: false }]);
    const [sql, options] = query.mock.calls[0] as [string, { replacements: Record<string, unknown> }];
    expect(sql).toContain('ORDER BY c._id ASC');
    expect(options.replacements).toMatchObject({ afterCustomerId: '0', limit: 50 });
  });

  it('sin conexión falla con un código explícito', async () => {
    const adapter = new CustomerCampaignAudienceAdapter({ sequelize: null } as never);
    await expect(adapter.estimate('1', { match: 'all', rules: [] }, { requireMarketingConsent: false })).rejects.toThrow(
      'AUDIENCE_DATABASE_UNAVAILABLE',
    );
  });
});
