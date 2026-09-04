/**
 * @file Tipos de dominio: hacen explícitos estados y contratos internos.
 * @business Valida en el borde lo que entra al expediente, antes de tocar el almacén.
 * @system declara los esquemas Zod de parámetros, consultas y cuerpos del módulo.
 */
import { z } from 'zod';
import { NIVELES } from './expedientes.types.js';

const idPositivo = z.string().regex(/^[1-9][0-9]*$/, 'Identificador inválido.');

export const expedienteParamsSchema = z.object({ id: idPositivo }).strict();
export type ExpedienteParamsDto = z.infer<typeof expedienteParamsSchema>;

export const nodoParamsSchema = z.object({ id: idPositivo, nodoId: idPositivo }).strict();
export type NodoParamsDto = z.infer<typeof nodoParamsSchema>;

export const sujetoParamsSchema = z
  .object({ subjectType: z.enum(['customer', 'partner', 'claim']), subjectId: idPositivo })
  .strict();
export type SujetoParamsDto = z.infer<typeof sujetoParamsSchema>;

const paginaSchema = {
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
};

export const listarExpedientesQuerySchema = z
  .object({
    ...paginaSchema,
    subjectType: z.enum(['customer', 'partner', 'claim']).optional(),
    estado: z.enum(['abierto', 'enviado', 'cerrado', 'purgado']).optional(),
    q: z.string().trim().min(1).max(80).optional(),
  })
  .strict();
export type ListarExpedientesQueryDto = z.infer<typeof listarExpedientesQuerySchema>;

export const listarNodosQuerySchema = z
  .object({
    parentId: idPositivo.optional(),
    incluirPapelera: z
      .enum(['true', 'false'])
      .default('false')
      .transform((valor) => valor === 'true'),
    q: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
export type ListarNodosQueryDto = z.infer<typeof listarNodosQuerySchema>;

export const contenidoQuerySchema = z
  .object({ disposition: z.enum(['inline', 'attachment']).default('inline') })
  .strict();
export type ContenidoQueryDto = z.infer<typeof contenidoQuerySchema>;

export const crearCarpetaSchema = z.object({ parentId: idPositivo.nullish(), nombre: z.string().min(1).max(255) }).strict();
export type CrearCarpetaDto = z.infer<typeof crearCarpetaSchema>;

/**
 * El SHA-256 es OBLIGATORIO al pedir el ticket.
 *
 * Se calcula en el navegador con `crypto.subtle` antes de subir. Sin él, la confirmación no puede
 * comprobar que lo que llegó al almacén es lo que la persona eligió: quedaría el tamaño y el tipo,
 * que no distinguen un archivo de otro del mismo peso. Es el mismo dato que ya exige la evidencia
 * KYC en `identity-package`.
 */
export const crearSubidaSchema = z
  .object({
    parentId: idPositivo.nullish(),
    nombre: z.string().min(1).max(255),
    contentType: z.string().min(3).max(100),
    sizeBytes: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i, 'SHA-256 en hexadecimal de 64 caracteres.'),
  })
  .strict();
export type CrearSubidaDto = z.infer<typeof crearSubidaSchema>;

/** Renombrar y mover comparten endpoint porque son la misma operación sobre el árbol. */
export const actualizarNodoSchema = z
  .object({ nombre: z.string().min(1).max(255).optional(), parentId: idPositivo.nullish() })
  .strict()
  .refine((valor) => valor.nombre !== undefined || valor.parentId !== undefined, {
    message: 'Indica un nombre nuevo o una carpeta de destino.',
  });
export type ActualizarNodoDto = z.infer<typeof actualizarNodoSchema>;

export const purgarSchema = z.object({ motivo: z.string().trim().min(8).max(500) }).strict();
export type PurgarDto = z.infer<typeof purgarSchema>;

export const concederSchema = z
  .object({
    principalTipo: z.enum(['rol', 'usuario_interno']),
    principalId: z.string().trim().min(1).max(64),
    nivel: z.enum(NIVELES),
    motivo: z.string().trim().min(8).max(500),
    venceEn: z.string().datetime().optional(),
  })
  .strict();
export type ConcederDto = z.infer<typeof concederSchema>;

export const concesionParamsSchema = z.object({ id: idPositivo, nodoId: idPositivo, grantId: idPositivo }).strict();
export type ConcesionParamsDto = z.infer<typeof concesionParamsSchema>;

export const contactosQuerySchema = z
  .object({
    revelar: z
      .enum(['true', 'false'])
      .default('false')
      .transform((valor) => valor === 'true'),
    motivo: z.string().trim().max(500).optional(),
  })
  .strict();
export type ContactosQueryDto = z.infer<typeof contactosQuerySchema>;

export const actividadQuerySchema = z.object({ ...paginaSchema, nodoId: idPositivo.optional() }).strict();
export type ActividadQueryDto = z.infer<typeof actividadQuerySchema>;
