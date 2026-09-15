import { describe, expect, it } from '@jest/globals';
import {
  audienceRuleSchema,
  createCampaignSchema,
  updateCampaignSchema,
} from '../../../../src/modules/notifications/campaigns/notification-campaigns.schemas.js';

const base = { name: 'Recordatorio', title: 'Hola', body: 'Texto', channels: ['in_app'] };

describe('esquemas de campaña', () => {
  it('aplica los valores por defecto', () => {
    const parsed = createCampaignSchema.parse(base);
    expect(parsed).toMatchObject({ purpose: 'marketing', category: 'campaign', ratePerMinute: 600 });
  });

  it('rechaza una ventana invertida, canales repetidos y enlaces externos', () => {
    expect(createCampaignSchema.safeParse({ ...base, startsAt: '2026-09-20T10:00:00Z', endsAt: '2026-09-20T09:00:00Z' }).success).toBe(
      false,
    );
    expect(createCampaignSchema.safeParse({ ...base, channels: ['push', 'push'] }).success).toBe(false);
    expect(createCampaignSchema.safeParse({ ...base, deepLink: 'https://evil.example' }).success).toBe(false);
    expect(createCampaignSchema.safeParse({ ...base, deepLink: '/pagar/[installmentId]' }).success).toBe(true);
    expect(updateCampaignSchema.safeParse({ startsAt: '2026-09-20T10:00:00Z', endsAt: '2026-09-19T10:00:00Z' }).success).toBe(false);
  });

  it('editar NO repone valores por omisión: lo ausente se queda como está', () => {
    // Medido contra la base: `.default(x).optional()` resuelve el default antes que el opcional, así
    // que un PATCH de sólo el título convertía una campaña operativa en comercial y su audiencia
    // pasaba a exigir consentimiento — al programar salía «audiencia vacía» sin que nadie la tocara.
    const parsed = updateCampaignSchema.parse({ title: 'Nuevo' });
    expect(parsed).toEqual({ title: 'Nuevo' });
    expect(Object.keys(parsed)).not.toContain('purpose');
    expect(updateCampaignSchema.parse({ purpose: 'operational' })).toEqual({ purpose: 'operational' });
    expect(updateCampaignSchema.safeParse({ purpose: 'otra' }).success).toBe(false);
    expect(updateCampaignSchema.safeParse({ ratePerMinute: 5 }).success).toBe(false);
  });

  it('una regla sólo pasa con un operador de su atributo y el valor que ese operador espera', () => {
    expect(audienceRuleSchema.safeParse({ attribute: 'city', operator: 'gte', value: 1 }).success).toBe(false);
    expect(audienceRuleSchema.safeParse({ attribute: 'city', operator: 'eq' }).success).toBe(false);
    expect(audienceRuleSchema.safeParse({ attribute: 'daysSinceSignup', operator: 'gte', value: '30' }).success).toBe(false);
    expect(audienceRuleSchema.safeParse({ attribute: 'daysSinceSignup', operator: 'gte', value: 30 }).success).toBe(true);
    expect(audienceRuleSchema.safeParse({ attribute: 'hasActiveLoan', operator: 'is_true' }).success).toBe(true);
    expect(audienceRuleSchema.safeParse({ attribute: 'inventado', operator: 'eq', value: 'x' }).success).toBe(false);
  });
});
