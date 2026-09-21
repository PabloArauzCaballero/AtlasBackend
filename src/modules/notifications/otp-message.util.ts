/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza hace que el código de verificación llegue igual por SMS que por WhatsApp.
 * @system compone el texto y los huecos de plantilla del OTP en un solo sitio, para los dos caminos de entrega.
 */

/** Los nombres de los huecos de la plantilla de WhatsApp. Cambiarlos obliga a cambiar la plantilla. */
export const OTP_TEMPLATE_PARAMS = { code: 'codigo', minutes: 'minutos' } as const;

/** El texto del código, tal y como lo lee el cliente en un SMS. */
export function otpMessageBody(code: string, ttlMinutes: number): string {
  return `Tu código de verificación ATLAS es ${code}. Vence en ${ttlMinutes} minutos.`;
}

/**
 * El payload del mensaje de OTP, con el código también como HUECO de plantilla.
 *
 * Existe porque WhatsApp no deja mandar texto libre a alguien que no escribió primero: el código
 * tiene que ir DENTRO de una plantilla aprobada, y una plantilla sin sus parámetros llega vacía —el
 * cliente recibe un WhatsApp que dice «Tu código es» y nada más—. Es el fallo más caro posible,
 * porque el proveedor lo da por entregado y todo parece verde.
 *
 * Se comparte entre los dos caminos de entrega del OTP (el puerto y el camino previo del servicio de
 * verificación) para que no puedan divergir: si sólo uno mandara los parámetros, el código llegaría
 * o no según qué rama de configuración esté activa, que es indistinguible de un fallo de red.
 *
 * Los nombres son los de Brevo (`{{params.codigo}}`); la lista posicional es la de Meta Cloud
 * (`{{1}}`, `{{2}}`). Van las dos para que el mismo mensaje salga por cualquiera de los dos.
 */
export function otpMessagePayload(reference: string, code: string, ttlMinutes: number): Record<string, unknown> {
  return {
    reference,
    whatsappTemplateParams: { [OTP_TEMPLATE_PARAMS.code]: code, [OTP_TEMPLATE_PARAMS.minutes]: String(ttlMinutes) },
    whatsappTemplateParameters: [code, String(ttlMinutes)],
  };
}
