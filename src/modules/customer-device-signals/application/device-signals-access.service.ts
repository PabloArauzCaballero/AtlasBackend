/**
 * @file Servicio de aplicación: resuelve el contexto que autoriza una entrega del dispositivo.
 * @business Esta pieza impide que la agenda o el rastro de una persona se cuelguen del expediente de otra.
 * @system comprueba cliente, consentimiento vigente, dispositivo vinculado y sesión propia antes de escribir.
 */
import { ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { assertOwnCustomerResourceOrInternalOperational } from '../../../common/utils/auth/ownership.util.js';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { CustomerDeviceContactsRepository } from '../repositories/customer-device-contacts.repository.js';

/** Lo que las dos señales necesitan saber antes de escribir una sola fila. */
export type DeviceSignalContext = {
  /** El identificador interno del dispositivo, no el que mandó el cliente. */
  readonly deviceId: string | null;
  readonly consentId: string;
};

/**
 * Las cuatro comprobaciones que preceden a cualquier escritura, en un sitio.
 *
 * Las hacen igual la sincronización de agenda y el rastreo de ubicación, y son justo las que no se
 * pueden olvidar: la tercera es la que impide que un token filtrado cuelgue la agenda de un teléfono
 * cualquiera del expediente de otra persona, y la segunda es la que distingue tener acceso técnico
 * al dato de tener permiso para guardarlo.
 *
 * ## Por qué el consentimiento se comprueba aquí y no en un guard de Nest
 *
 * Porque el código de finalidad depende del caso de uso —`device_address_book` o
 * `location_tracking`—, y un guard que reciba la finalidad por metadatos acaba siendo la misma
 * comprobación escrita en un sitio donde no se lee. Aquí está al lado de quien la necesita.
 */
@Injectable()
export class DeviceSignalsAccessService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly contacts: CustomerDeviceContactsRepository,
  ) {}

  async resolve(input: {
    tenantId: string;
    customerId: string;
    deviceId: string;
    sessionId?: string | null;
    purposeCode: string;
    currentUser: AuthenticatedUser;
  }): Promise<DeviceSignalContext> {
    assertOwnCustomerResourceOrInternalOperational(input.currentUser, input.customerId);

    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');

    const consent = await this.contacts.findGrantedConsent(input.tenantId, input.customerId, input.purposeCode);
    if (!consent) throw new UnprocessableEntityException(`CONSENT_NOT_GRANTED: ${input.purposeCode}`);

    /*
     * Un operador interno puede escribir sin vínculo de dispositivo —reprocesos, reconstrucción de
     * un expediente— pero un `customer` no: si el dispositivo no es suyo, la petición viene de un
     * token que se está usando fuera de su sitio.
     */
    const deviceLink = await this.contacts.findCustomerDeviceLink(input.tenantId, input.customerId, input.deviceId);
    if (!deviceLink && input.currentUser.role === 'customer') {
      throw new ForbiddenException('El dispositivo no está vinculado al cliente.');
    }

    if (input.sessionId) {
      const session = await this.contacts.findCustomerSession(input.tenantId, input.customerId, input.sessionId);
      if (!session && input.currentUser.role === 'customer') {
        throw new ForbiddenException('La sesión no pertenece al cliente.');
      }
    }

    return { deviceId: deviceLink ? String(deviceLink.deviceId) : null, consentId: String(consent.id) };
  }
}
