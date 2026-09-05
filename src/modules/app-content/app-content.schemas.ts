/**
 * @file Contratos Zod: valida entrada y define el tipo del caso de uso.
 * @business Esta pieza saca del código lo que el cliente lee en la app y lo pone donde se edita.
 * @system valida el catálogo de contenidos de la app y sus acciones.
 */
import { z } from 'zod';

/** A qué pantalla va la pieza. Cerrado a propósito: la app tiene que saber pintar cada superficie. */
export const contentSurfaceSchema = z.enum(['onboarding', 'home', 'faq', 'help', 'legal', 'profile', 'credit']);

/**
 * Qué hace el botón del final de la pieza.
 *
 * `whatsapp` es su propio tipo y no un `link` con una URL: el número lo escribe alguien de negocio
 * en el portal, y obligarle a componer a mano `https://wa.me/591…` es pedirle que no se equivoque en
 * el prefijo del país. Aquí escribe el número y la app arma el enlace.
 */
export const contentActionKindSchema = z.enum(['whatsapp', 'link', 'screen', 'tour']);

export const contentBulletSchema = z.object({
  text: z.string().trim().min(1).max(500),
  icon: z.string().trim().max(40).nullable().optional(),
  emphasis: z.boolean().optional(),
});

export const listContentQuerySchema = z.object({
  surface: contentSurfaceSchema.optional(),
  locale: z.string().trim().min(2).max(10).default('es-BO'),
});

export const upsertContentSchema = z
  .object({
    surface: contentSurfaceSchema,
    contentKey: z.string().trim().min(1).max(120),
    locale: z.string().trim().min(2).max(10).default('es-BO'),
    title: z.string().trim().max(200).nullable().optional(),
    subtitle: z.string().trim().max(300).nullable().optional(),
    bodyMd: z.string().trim().max(8000).nullable().optional(),
    bullets: z.array(contentBulletSchema).max(20).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    actionKind: contentActionKindSchema.nullable().optional(),
    actionLabel: z.string().trim().max(120).nullable().optional(),
    actionValue: z.string().trim().max(500).nullable().optional(),
    displayOrder: z.number().int().min(0).max(10_000).default(100),
    isActive: z.boolean().default(true),
  })
  // Un botón sin destino es un botón que no lleva a ningún sitio: se rechaza aquí y no en la base,
  // para que quien edita lea por qué en lugar de un error de restricción.
  .refine((value) => !value.actionKind || (value.actionLabel && value.actionValue), {
    message: 'Una acción necesita etiqueta y destino.',
    path: ['actionValue'],
  });

export const contentIdParamsSchema = z.object({ contentId: z.string().regex(/^[1-9][0-9]*$/) });

export type ListContentQueryDto = z.infer<typeof listContentQuerySchema>;
export type UpsertContentDto = z.infer<typeof upsertContentSchema>;
export type ContentIdParamsDto = z.infer<typeof contentIdParamsSchema>;
