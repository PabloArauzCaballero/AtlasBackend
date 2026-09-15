/**
 * @file Esquemas zod de campañas y segmentos de audiencia.
 * @business Lo que operaciones puede pedir al programar una campaña, y los límites que la protegen de
 *   un envío a destiempo, a nadie o a demasiada gente.
 * @system Valida contra el vocabulario CERRADO del contrato de audiencia; una regla que pase aquí es una
 *   regla que Clientes sabe traducir a SQL.
 */
import { z } from 'zod';
import { AUDIENCE_ATTRIBUTES, AUDIENCE_OPERATORS, AUDIENCE_OPERATORS_BY_ATTRIBUTE } from '../../../platform/contracts/campaign-audience.js';

export const CAMPAIGN_STATUSES = ['draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled', 'failed'] as const;
export const CAMPAIGN_CHANNELS = ['in_app', 'push', 'email'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number];

const idSchema = z.string().regex(/^[1-9][0-9]*$/);

export const audienceRuleSchema = z
  .object({
    attribute: z.enum(AUDIENCE_ATTRIBUTES),
    operator: z.enum(AUDIENCE_OPERATORS),
    value: z
      .union([
        z.string().trim().min(1).max(120),
        z.number().int().min(0).max(36_500),
        z.array(z.string().trim().min(1).max(120)).min(1).max(50),
      ])
      .optional(),
  })
  .superRefine((rule, ctx) => {
    if (!AUDIENCE_OPERATORS_BY_ATTRIBUTE[rule.attribute].includes(rule.operator)) {
      ctx.addIssue({
        code: 'custom',
        path: ['operator'],
        message: `El atributo ${rule.attribute} no admite el operador ${rule.operator}.`,
      });
      return;
    }
    const needsValue = !['is_true', 'is_false'].includes(rule.operator);
    if (needsValue && (rule.value === undefined || rule.value === '')) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: `La regla ${rule.attribute} ${rule.operator} necesita un valor.` });
    }
    if (['gte', 'lte'].includes(rule.operator) && typeof rule.value !== 'number') {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Los operadores gte/lte esperan un número.' });
    }
  });

export const audienceDefinitionSchema = z.object({
  match: z.enum(['all', 'any']).default('all'),
  rules: z.array(audienceRuleSchema).max(10).default([]),
});

/** Ruta de la app a la que lleva tocar el aviso. Sólo rutas internas: nunca una URL externa. */
const deepLinkSchema = z
  .string()
  .trim()
  .max(300)
  .regex(/^\/[A-Za-z0-9/_\-()[\].?=&]*$/, 'El enlace debe ser una ruta interna de la app, por ejemplo /pagos.');

const campaignFields = {
  name: z.string().trim().min(3).max(140),
  purpose: z.enum(['marketing', 'operational']).default('marketing'),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(1_000),
  category: z.string().trim().min(1).max(60).default('campaign'),
  icon: z.string().trim().min(1).max(60).optional().nullable(),
  deepLink: deepLinkSchema.optional().nullable(),
  channels: z
    .array(z.enum(CAMPAIGN_CHANNELS))
    .min(1)
    .max(3)
    .refine((channels) => new Set(channels).size === channels.length, 'Un canal no puede repetirse.'),
  audienceSegmentId: idSchema.optional().nullable(),
  audience: audienceDefinitionSchema.optional(),
  startsAt: z.coerce.date().optional().nullable(),
  endsAt: z.coerce.date().optional().nullable(),
  ratePerMinute: z.coerce.number().int().min(10).max(6_000).default(600),
  maxRecipients: z.coerce.number().int().min(1).max(1_000_000).optional().nullable(),
};

function windowIsCoherent(value: { startsAt?: Date | null; endsAt?: Date | null }): boolean {
  return !value.startsAt || !value.endsAt || value.endsAt.getTime() > value.startsAt.getTime();
}

const windowMessage = { message: 'La fecha de fin debe ser posterior a la de inicio.', path: ['endsAt'] };

export const createCampaignSchema = z.object(campaignFields).refine(windowIsCoherent, windowMessage);
export const updateCampaignSchema = z
  .object({
    ...campaignFields,
    purpose: campaignFields.purpose.optional(),
    category: campaignFields.category.optional(),
    ratePerMinute: campaignFields.ratePerMinute.optional(),
    channels: campaignFields.channels.optional(),
    name: campaignFields.name.optional(),
    title: campaignFields.title.optional(),
    body: campaignFields.body.optional(),
  })
  .refine(windowIsCoherent, windowMessage);

export const listCampaignsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(CAMPAIGN_STATUSES).optional(),
  search: z.string().trim().max(120).optional(),
});

export const campaignIdParamsSchema = z.object({ campaignId: idSchema });
export const segmentIdParamsSchema = z.object({ segmentId: idSchema });

export const cancelCampaignSchema = z.object({ reason: z.string().trim().min(8).max(400) });
export const testSendCampaignSchema = z.object({ customerId: idSchema });
export const estimateAudienceSchema = z.object({
  purpose: z.enum(['marketing', 'operational']).default('marketing'),
  audienceSegmentId: idSchema.optional().nullable(),
  audience: audienceDefinitionSchema.optional(),
});

export const createSegmentSchema = z.object({
  name: z.string().trim().min(3).max(140),
  description: z.string().trim().max(400).optional().nullable(),
  definition: audienceDefinitionSchema,
});
export const updateSegmentSchema = z.object({
  name: z.string().trim().min(3).max(140).optional(),
  description: z.string().trim().max(400).optional().nullable(),
  definition: audienceDefinitionSchema.optional(),
  status: z.enum(['active', 'archived']).optional(),
});
export const listSegmentsQuerySchema = z.object({ status: z.enum(['active', 'archived']).default('active') });

export type CreateCampaignDto = z.infer<typeof createCampaignSchema>;
export type UpdateCampaignDto = z.infer<typeof updateCampaignSchema>;
export type ListCampaignsQueryDto = z.infer<typeof listCampaignsQuerySchema>;
export type CancelCampaignDto = z.infer<typeof cancelCampaignSchema>;
export type TestSendCampaignDto = z.infer<typeof testSendCampaignSchema>;
export type EstimateAudienceDto = z.infer<typeof estimateAudienceSchema>;
export type CreateSegmentDto = z.infer<typeof createSegmentSchema>;
export type UpdateSegmentDto = z.infer<typeof updateSegmentSchema>;
export type AudienceDefinitionDto = z.infer<typeof audienceDefinitionSchema>;
