/**
 * @file Contrato del correo que un sistema interno (el ERP) manda por el canal de ATLAS.
 * @business Una propuesta comercial o una factura tiene que llegarle al comercio desde la cuenta de ATLAS.
 * @system valida destinatario, asunto, texto y adjuntos PDF acotados antes de tocar Gmail.
 */
import { z } from 'zod';

/** 7 MB en base64 (~5 MB de PDF): por encima, Gmail lo rechaza o el correo no se abre en el móvil. */
const MAX_BASE64 = 7 * 1024 * 1024;

export const internalMailSchema = z.object({
  to: z.string().trim().toLowerCase().email().max(254),
  subject: z.string().trim().min(1).max(200),
  text: z.string().min(1).max(20_000),
  /** Versión HTML del mismo mensaje; el texto sigue siendo obligatorio para los clientes que no la pintan. */
  html: z.string().min(1).max(200_000).optional(),
  /** A quién le llegan las respuestas: la persona que envía, no el buzón genérico de ATLAS. */
  replyTo: z.string().trim().toLowerCase().email().max(254).optional(),
  /** Nombre visible del remitente («Ana Pérez · ATLAS»). La dirección sigue siendo la de ATLAS. */
  fromName: z.string().trim().min(1).max(80).optional(),
  /** Referencia de negocio (p. ej. `proposal:PROP-2026-000002`): semilla MIME y rastro en el log. */
  reference: z.string().trim().min(1).max(120),
  attachments: z
    .array(
      z.object({
        filename: z.string().trim().min(1).max(120),
        contentType: z.literal('application/pdf'),
        contentBase64: z.string().min(1).max(MAX_BASE64),
      }),
    )
    .max(3)
    .default([]),
});

export type InternalMailDto = z.infer<typeof internalMailSchema>;
