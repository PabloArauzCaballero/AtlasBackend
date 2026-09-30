/**
 * @file Contratos Zod: valida entrada y define el tipo del caso de uso.
 * @business Esta pieza saca del código lo que el cliente lee en la app y lo pone donde se edita.
 * @system valida el catálogo de contenidos de la app y sus acciones.
 */
import { z } from 'zod';
import { queryBooleanSchema } from '../../common/pipes/query-boolean.schema.js';

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

/** Tope del icono propio ya decodificado. Un icono de lista pesa unos pocos KB; más es una foto. */
export const MAX_CONTENT_ICON_BYTES = 32 * 1024;

/**
 * Icono propio de una viñeta, como `data:image/png|webp;base64,…`.
 *
 * Va DENTRO de la pieza y no en un almacén aparte porque la lectura de la app es pública y sin
 * sesión: una URL firmada caduca y una pública exige abrir el almacén. Se acepta sólo PNG y WebP
 * —los que pinta cualquier `Image` nativa— y se comprueba la FIRMA del archivo, no el prefijo que
 * declara quien lo sube: un `data:image/png` con otro contenido dentro no pasa. SVG queda fuera a
 * propósito: puede llevar script y la app nativa no lo pinta sin librería.
 */
export const contentIconImageSchema = z
  .string()
  .max(Math.ceil((MAX_CONTENT_ICON_BYTES * 4) / 3) + 40, 'El icono pesa más de 32 KB.')
  .regex(/^data:image\/(png|webp);base64,[A-Za-z0-9+/]+={0,2}$/, 'El icono debe ser un PNG o WebP.')
  .superRefine((value, ctx) => {
    const bytes = Buffer.from(value.slice(value.indexOf(',') + 1), 'base64');
    const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const webp = bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP';
    const declaredPng = value.startsWith('data:image/png');
    if (bytes.length > MAX_CONTENT_ICON_BYTES) ctx.addIssue({ code: 'custom', message: 'El icono pesa más de 32 KB.' });
    else if (declaredPng ? !png : !webp) ctx.addIssue({ code: 'custom', message: 'El archivo no es el PNG o WebP que dice ser.' });
  });

export const contentBulletSchema = z.object({
  text: z.string().trim().min(1).max(500),
  icon: z.string().trim().max(40).nullable().optional(),
  /** Icono cargado desde el portal. Gana sobre `icon`; si no se puede pintar, la app cae a `icon`. */
  iconImage: contentIconImageSchema.nullable().optional(),
  emphasis: z.boolean().optional(),
});

export const listContentQuerySchema = z.object({
  surface: contentSurfaceSchema.optional(),
  locale: z.string().trim().min(2).max(10).default('es-BO'),
});

/** El listado del portal, paginado. La app pública sigue con `listContentQuerySchema`: no pagina. */
export const listAdminContentQuerySchema = listContentQuerySchema.extend({
  /** Por partes: clave, título, subtítulo, texto y botón de la pieza. Sólo el listado del portal lo usa. */
  q: z.string().trim().min(1).max(120).optional(),
  /** Sólo visibles (`true`) o sólo ocultas (`false`) en la app. */
  active: queryBooleanSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
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
export type ListAdminContentQueryDto = z.infer<typeof listAdminContentQuerySchema>;
export type UpsertContentDto = z.infer<typeof upsertContentSchema>;
export type ContentIdParamsDto = z.infer<typeof contentIdParamsSchema>;
