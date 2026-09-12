/**
 * @file Contratos de entrada: valida y normaliza antes de que nada toque el dominio.
 * @business Lo que se busca en la ayuda y lo que un editor propone publicar como respuesta oficial.
 * @system esquemas Zod de búsqueda, creación de versiones y flujo de aprobación del conocimiento.
 */
import { z } from 'zod';

const positiveId = z.string().regex(/^[1-9][0-9]*$/u, 'Identificador inválido.');

/**
 * La búsqueda.
 *
 * La audiencia NO se acepta como parámetro: la deriva el servidor del actor autenticado. Dejar que
 * el cliente pida `audience=INTERNAL_SUPPORT` habría convertido el buscador en la puerta abierta a
 * las guías internas, que es la fuga más común de una base de conocimiento.
 */
export const knowledgeSearchSchema = z.object({
  q: z.string().trim().min(2).max(200),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});
export type KnowledgeSearchDto = z.infer<typeof knowledgeSearchSchema>;

export const knowledgeFeedbackSchema = z.object({
  helpful: z.boolean(),
  reason: z.string().trim().max(400).optional(),
  /** Qué escribió la persona antes de llegar aquí: es lo que revela el vocabulario que falta. */
  searchQuery: z.string().trim().max(200).optional(),
  /** Si el artículo evitó abrir un caso. Alimenta la tasa de deflexión. */
  avoidedCase: z.boolean().optional(),
});
export type KnowledgeFeedbackDto = z.infer<typeof knowledgeFeedbackSchema>;

/** Crear el artículo: sólo su identidad y su gobierno. El texto llega con la primera versión. */
export const createArticleSchema = z.object({
  articleKey: z
    .string()
    .trim()
    .min(3)
    .max(120)
    .regex(/^[a-z0-9][a-z0-9-]*$/u, 'Usa minúsculas, dígitos y guiones.'),
  audience: z.enum(['PUBLIC_CONSUMER', 'AUTHENTICATED_CONSUMER', 'PARTNER', 'INTERNAL_SUPPORT']),
  categoryCode: z.string().trim().max(80).optional(),
  ownerTeam: z.string().trim().min(2).max(80),
  isFaq: z.boolean().default(false),
  isFeatured: z.boolean().default(false),
  productScope: z.string().trim().max(60).optional(),
  reviewCycleDays: z.number().int().min(30).max(1095).default(180),
});
export type CreateArticleDto = z.infer<typeof createArticleSchema>;

/**
 * Una versión nueva.
 *
 * `escalateWhen` no es opcional por capricho: un artículo de ayuda que no dice cuándo dejar de
 * intentarlo solo convierte a la persona en alguien que insiste con una guía que ya no aplica a su
 * caso. Es la diferencia entre una guía y un folleto.
 */
export const createArticleVersionSchema = z.object({
  locale: z.string().trim().max(10).default('es-BO'),
  title: z.string().trim().min(4).max(200),
  question: z.string().trim().max(300).optional(),
  shortAnswer: z.string().trim().max(600).optional(),
  bodyMarkdown: z.string().trim().min(20).max(40_000),
  tags: z.array(z.string().trim().min(2).max(40)).max(20).default([]),
  canonicalQueryTerms: z.array(z.string().trim().min(2).max(60)).max(30).default([]),
  escalateWhen: z.string().trim().min(10).max(2000),
  changeReason: z.string().trim().min(4).max(400),
});
export type CreateArticleVersionDto = z.infer<typeof createArticleVersionSchema>;

export const reviewDecisionSchema = z.object({
  note: z.string().trim().max(400).optional(),
});
export type ReviewDecisionDto = z.infer<typeof reviewDecisionSchema>;

export const publishVersionSchema = z.object({
  /** Publicar retira la versión anterior del mismo idioma; se pide confirmarlo explícitamente. */
  retirePrevious: z.boolean().default(true),
  note: z.string().trim().max(400).optional(),
});
export type PublishVersionDto = z.infer<typeof publishVersionSchema>;

export const articleIdParamSchema = z.object({ articleId: positiveId });
