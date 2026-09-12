/**
 * @file Tipos de dominio: hacen explícitos estados y contratos internos.
 * @business Esta pieza evita que ATLAS envíe correo a direcciones que no pueden existir.
 * @system valida el dominio del destinatario contra los TLD reservados por RFC 2606 y RFC 6761.
 */
import { Logger } from '@nestjs/common';

/**
 * Dominios de primer nivel que NUNCA van a resolver, por norma.
 *
 * `test`, `example`, `invalid` y `localhost` los reserva el RFC 2606; `local` es mDNS (RFC 6762) e
 * `internal` es de uso privado y no delegado en la raíz. Ninguno tiene servidor de correo público,
 * y ninguno lo tendrá.
 */
const UNROUTABLE_TLDS = new Set(['test', 'example', 'invalid', 'localhost', 'local', 'internal']);

const logger = new Logger('MailRecipient');

/**
 * ¿Se puede entregar de verdad un correo a esta dirección?
 *
 * Los datos de semilla y de demo usan direcciones como `pablo@atlas.internal` o `ana@atlas.test`.
 * Entregarlas al proveedor no es inocuo: el proveedor acepta el envío, intenta resolver el dominio,
 * falla, y devuelve un REBOTE al remitente. Como el remitente es un buzón real, cada uno de esos
 * intentos termina en la bandeja de una persona, y no una vez: los rebotes se reintentan. Es ruido
 * que no señala nada, porque el fallo es seguro desde antes de enviar.
 *
 * Se corta aquí, y no en cada llamante, porque el llamante no elige la dirección: la trae del actor
 * que tiene delante y no puede saber si ese actor es de semilla o de verdad.
 */
export function isDeliverableAddress(address: string): boolean {
  const at = address.lastIndexOf('@');
  if (at <= 0 || at === address.length - 1) return false;
  const domain = address.slice(at + 1).toLowerCase();
  const tld = domain.slice(domain.lastIndexOf('.') + 1);
  return domain.includes('.') && !UNROUTABLE_TLDS.has(tld);
}

/** Registra el descarte con el dominio, nunca con la dirección: el buzón es dato personal. */
export function logUndeliverable(address: string, template: string): void {
  const domain = address.slice(address.lastIndexOf('@') + 1);
  logger.warn(
    `Correo '${template}' no enviado: el dominio '${domain}' está reservado y no puede recibir. ` +
      'Es una dirección de semilla o de demo; asigna una real a la cuenta si esperabas el correo.',
  );
}
