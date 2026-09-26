/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza decide si el código de un teléfono puede llegar al correo del mismo cliente.
 * @system resuelve y descifra el contacto de correo del cliente; Mensajería nunca lo busca por su cuenta.
 */
import { Logger } from '@nestjs/common';
import { decryptSecretEnvelope } from '../../../common/utils/crypto/envelope-encryption.util.js';
import type { CustomerContactMethodModel } from '../../../database/models/index.js';

/**
 * Lo único que hace falta del repositorio, escrito como forma y no como clase.
 *
 * Así la utilidad se ejercita con un doble de tres líneas en vez de arrastrar el repositorio entero
 * —y su conexión— a una prueba que sólo comprueba a qué dirección va el código.
 */
export type BuscadorDeContactos = {
  findCustomerContactMethod(tenantId: string, customerId: string, contactType: string): Promise<CustomerContactMethodModel | null>;
};

const logger = new Logger('OtpFallbackEmail');

/**
 * El correo al que llevar un código de TELÉFONO cuando el SMS no puede entregarse, o `null`.
 *
 * Quién decide qué, y por qué está repartido así:
 *
 * - **El despliegue** decide si la reserva existe (`OTP_SMS_FALLBACK_TO_EMAIL`, apagada por
 *   defecto, y que llega aquí como `habilitada` para poder ejercitarlo sin montar el entorno).
 *   Un código de teléfono entregado por correo NO demuestra que el número sea de quien
 *   escribe: en producción un SMS que no sale es un incidente del proveedor, no algo que rodear.
 * - **Onboarding** —aquí— decide a qué dirección, porque es el dueño del contacto y el único que
 *   puede afirmar que ese correo es de ESTE cliente. Mensajería recibe la dirección ya autorizada.
 * - **El canal** no se toca: la reserva sólo entra si el envío pedido falló (ver `conReserva`).
 *
 * Un sobre ilegible degrada a `null` y se registra: sin poder leer el correo no hay reserva, y el
 * fallo que se le enseña a la persona sigue siendo el del SMS, que es el que de verdad ocurrió.
 */
export async function resolveOtpFallbackEmail(
  repository: BuscadorDeContactos,
  input: { tenantId: string; customerId: string; contactType: string; habilitada: boolean },
): Promise<string | null> {
  if (!input.habilitada) return null;
  // Para el propio correo la reserva no existe: repetir el canal que falló es repetir el fallo.
  if (input.contactType === 'email') return null;

  const contactMethod = await repository.findCustomerContactMethod(input.tenantId, input.customerId, 'email');
  if (!contactMethod?.contactValueEncrypted) return null;

  try {
    const correo = await decryptSecretEnvelope(contactMethod.contactValueEncrypted);
    return correo && correo.trim().length > 0 ? correo.trim() : null;
  } catch (error) {
    logger.error(`No se pudo descifrar el correo ${contactMethod.id} para la reserva del código: ${(error as Error).message}`);
    return null;
  }
}
