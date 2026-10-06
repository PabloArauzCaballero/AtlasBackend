/**
 * @file Parser JSON con límite propio para las rutas de correo interno.
 * @business Una propuesta o una factura con PDF y XML tiene que poder viajar por el canal de ATLAS.
 * @system `internalMailSchema` admite 3 adjuntos de 7 MB en base64; con el límite global de 2 MB el
 * parser respondía 413 antes de la firma y del esquema. Se registra ANTES del parser global: el primero
 * que lee el cuerpo gana, y los demás lo saltan.
 */
import express from 'express';
import type { RequestHandler } from 'express';

/** 3 adjuntos de 7 MB en base64 + texto (20 KB) y HTML (200 KB) con holgura para el JSON. */
export const INTERNAL_MAIL_BODY_LIMIT = '22mb';

export function internalMailRoutes(apiPrefix: string): string[] {
  const prefix = `/${apiPrefix.replace(/^\/+|\/+$/g, '')}`;
  return [`${prefix}/internal/integration/erp/mail`, `${prefix}/operations/notifications/internal-mail`];
}

export function internalMailBodyParser(verify: (request: never, response: unknown, buffer: Buffer) => void): RequestHandler {
  return express.json({ limit: INTERNAL_MAIL_BODY_LIMIT, verify: verify as never });
}
