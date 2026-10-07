/**
 * @file Servicio de aplicación: recibe la agenda del dispositivo y la persiste cifrada.
 * @business Esta pieza guarda los contactos que el cliente autorizó a compartir, para verificar referencias y detectar anillos de fraude.
 * @system cifra cada ficha, hashea sus números para poder cruzarlos, y actualiza en vez de duplicar.
 */
import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { createHash } from 'node:crypto';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { assertOwnCustomerResourceOrInternalOperational } from '../../../common/utils/auth/ownership.util.js';
import { DeviceSignalsJournalRepository } from '../repositories/device-signals-journal.repository.js';
import { DeviceSignalsAccessService, type DeviceSignalContext } from './device-signals-access.service.js';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { InternalRbacRepository } from '../../internal-users/internal-rbac.repository.js';
import { CustomerDeviceContactsRepository, type ContactRow } from '../repositories/customer-device-contacts.repository.js';
import { toContactRow } from './device-contact-row.js';
import { type AddressBookSyncDto, type AddressBookSyncView } from '../customer-device-signals.schemas.js';

/** La finalidad que ampara este tratamiento. Es el `document_code` del consentimiento sembrado. */
export const ADDRESS_BOOK_PURPOSE = 'device_address_book';

/** Lo que se le exige a un operador interno para borrar la agenda de un cliente. */
const PURGE_PERMISSION = 'privacy.requests.manage';

/**
 * La agenda del teléfono, guardada entera y cifrada.
 *
 * Comprueba el permiso (`DeviceSignalsAccessService`), convierte cada ficha
 * (`device-contact-row.ts`), e inserta lo nuevo actualizando lo que ya estaba: un contacto se
 * reconoce por su identificador de origen, así que resincronizar no duplica.
 *
 * ## Por qué se cifra si de todas formas se guarda
 *
 * Porque el cliente consintió; sus contactos no. Cifrar con sobre no borra ese desequilibrio, pero
 * hace que una copia de la base de datos —un volcado, un backup mal guardado, una consulta directa a
 * PostgreSQL— no entregue las libretas de direcciones de todos los clientes en texto plano. Lo que
 * queda legible es lo que hace falta para cruzar: hashes y recuentos.
 *
 * No devuelve análisis: quien sube la agenda es el teléfono de la persona analizada, y decirle
 * cuántos de sus contactos coinciden con otros expedientes le enseña qué borrar.
 */
@Injectable()
export class CustomerAddressBookService {
  private readonly logger = new Logger(CustomerAddressBookService.name);

  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly access: DeviceSignalsAccessService,
    private readonly journal: DeviceSignalsJournalRepository,
    private readonly contacts: CustomerDeviceContactsRepository,
    private readonly rbac: InternalRbacRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async sync(input: {
    tenantId: string;
    customerId: string;
    body: AddressBookSyncDto;
    currentUser: AuthenticatedUser;
    ipAddress: string | null;
  }): Promise<AddressBookSyncView> {
    const contexto = await this.access.resolve({
      tenantId: input.tenantId,
      customerId: input.customerId,
      deviceId: input.body.deviceId,
      sessionId: input.body.sessionId,
      purposeCode: ADDRESS_BOOK_PURPOSE,
      currentUser: input.currentUser,
    });

    const now = new Date();
    const capturedAt = new Date(input.body.capturedAt);

    /*
     * La huella se calcula sobre la FORMA del lote, no sobre su contenido.
     *
     * Sirve para reconocer un reenvío idéntico y para poder afirmar después que la ejecución no se
     * tocó. Incluir nombres o números la convertiría en un dato personal más que custodiar, y no
     * añadiría nada: lo que interesa comprobar es que este teléfono mandó estos tantos contactos en
     * este momento.
     */
    const integrityHash = createHash('sha256')
      .update(
        [
          input.customerId,
          input.body.deviceId,
          input.body.algorithmVersion,
          input.body.capturedAt,
          input.body.accessScope,
          input.body.totalContactsInDevice,
          input.body.contacts.length,
        ].join('|'),
      )
      .digest('hex');

    // Cifrar es asíncrono y toca al proveedor de llaves; se hace ANTES de abrir la transacción para
    // no retener locks durante la latencia de KMS con quinientas fichas por delante.
    const todas = await Promise.all(
      input.body.contacts.map((contacto) =>
        toContactRow(contacto, {
          tenantId: input.tenantId,
          customerId: input.customerId,
          deviceId: contexto.deviceId,
          sessionId: input.body.sessionId ?? null,
          consentId: contexto.consentId,
          capturedAt,
          receivedAt: now,
        }),
      ),
    );

    // Un mismo contacto dos veces en el lote chocaría con la unicidad al insertar y tumbaría el lote
    // entero: manda la última aparición, que es la que el teléfono dejó en pie.
    const filas = [...new Map(todas.map((fila) => [fila.contactExternalIdHash, fila])).values()];

    const resultado = await this.persistWithRetry({ input, filas, contexto, integrityHash, capturedAt, now });
    const solapamiento = resultado.solapamiento;

    this.logger.log(
      `Agenda del cliente ${input.customerId}: recibidos=${String(filas.length)} ` +
        (solapamiento === null ? '' : `expedientes_que_comparten=${String(solapamiento)} `) +
        `nuevos=${String(resultado.creados)} actualizados=${String(resultado.actualizados)} ` +
        `almacenados=${String(resultado.totalStored)}.`,
    );

    return {
      customerId: input.customerId,
      computationRunId: resultado.runId,
      received: filas.length,
      created: resultado.creados,
      updated: resultado.actualizados,
      totalStored: resultado.totalStored,
      receivedAt: now.toISOString(),
    };
  }

  /**
   * Borra la agenda guardada de este cliente.
   *
   * Es lo que el texto del consentimiento promete al retirarlo, y por eso el borrado es FÍSICO: una
   * fila marcada como borrada sigue conteniendo el nombre y el teléfono de cada contacto. Se puede
   * llamar sin haber retirado el consentimiento —alguien puede querer limpiar y volver a
   * sincronizar— y no falla si no había nada que borrar.
   *
   * Borrar la agenda de un cliente es irreversible: el cliente puede hacerlo con la suya, pero un
   * operador interno sólo con `privacy.requests.manage` —el permiso de quien atiende al titular—, no
   * por el mero rol operativo.
   */
  async purge(input: {
    tenantId: string;
    customerId: string;
    currentUser: AuthenticatedUser;
    ipAddress: string | null;
  }): Promise<{ customerId: string; deleted: number; purgedAt: string }> {
    assertOwnCustomerResourceOrInternalOperational(input.currentUser, input.customerId);
    await this.assertMayPurge(input.tenantId, input.currentUser);
    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');

    const now = new Date();
    const deleted = await this.sequelize.transaction(async (transaction) => {
      const borradas = await this.contacts.deleteAllFor(input.tenantId, input.customerId, { transaction });
      await this.journal.createAuditLog(
        {
          tenantId: input.tenantId,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actionCode: 'customer_device_signals.address_book_purge',
          targetType: 'customer',
          targetId: input.customerId,
          ipAddress: input.ipAddress,
          payloadJson: { deleted: borradas },
          occurredAt: now,
        },
        { transaction },
      );
      return borradas;
    });

    return { customerId: input.customerId, deleted, purgedAt: now.toISOString() };
  }

  private async assertMayPurge(tenantId: string, user: AuthenticatedUser): Promise<void> {
    if (user.role === 'customer') return;
    const allowed = user.internalUserId ? await this.rbac.hasPermissions(tenantId, user.internalUserId, [PURGE_PERMISSION]) : false;
    if (!allowed) throw new ForbiddenException(`El usuario interno no tiene los permisos requeridos para esta operación: ${PURGE_PERMISSION}.`);
  }

  /**
   * Un reenvío concurrente del mismo lote choca con la unicidad al insertar la misma ficha: el
   * segundo intento ya ve las filas del primero y las actualiza en vez de crearlas.
   */
  private async persistWithRetry(args: Parameters<CustomerAddressBookService['persistBatch']>[0]) {
    try {
      return await this.persistBatch(args);
    } catch (error) {
      if ((error as { name?: string }).name !== 'SequelizeUniqueConstraintError') throw error;
      return this.persistBatch(args);
    }
  }

  /**
   * La escritura, entera dentro de UNA transacción.
   *
   * La ejecución, las fichas y las dos trazas van juntas o no va ninguna: una fila de ejecución sin
   * fichas sería una captura que dice haber leído la agenda y no deja ver qué leyó, y unas fichas
   * sin ejecución serían contactos guardados sin nada que diga con qué permiso ni de qué teléfono.
   */
  private persistBatch(args: {
    input: { tenantId: string; customerId: string; body: AddressBookSyncDto; currentUser: AuthenticatedUser; ipAddress: string | null };
    filas: readonly ContactRow[];
    contexto: DeviceSignalContext;
    integrityHash: string;
    capturedAt: Date;
    now: Date;
  }): Promise<{ runId: string; creados: number; actualizados: number; totalStored: number; solapamiento: number | null }> {
    const { input, filas, contexto, integrityHash, capturedAt, now } = args;
    return this.sequelize.transaction(async (transaction) => {
      const flow = await this.journal.findLatestOnboardingFlow(input.tenantId, input.customerId, { transaction });

      const run = await this.contacts.createRun(
        {
          tenantId: input.tenantId,
          customerId: input.customerId,
          deviceId: contexto.deviceId,
          sessionId: input.body.sessionId ?? null,
          consentId: contexto.consentId,
          onboardingFlowId: flow ? String(flow.id) : null,
          algorithmVersion: input.body.algorithmVersion,
          // `partial` mientras queden lotes: una ejecución marcada como completa a mitad de la
          // agenda haría creer que esa persona tiene 500 contactos cuando tiene 3.000.
          status: input.body.isFinalBatch ? 'completed' : 'partial',
          integrityHash,
          computedAtDevice: capturedAt,
          receivedAtServer: now,
        },
        { transaction },
      );

      const existentes = await this.contacts.findByExternalIdHashes(
        input.tenantId,
        input.customerId,
        filas.map((fila) => fila.contactExternalIdHash),
        { transaction },
      );
      const porHash = new Map(existentes.map((fila) => [fila.contactExternalIdHash, String(fila.id)]));

      let creados = 0;
      let actualizados = 0;
      for (const fila of filas) {
        const conRun: ContactRow = { ...fila, computationRunId: String(run.id) };
        const existente = porHash.get(fila.contactExternalIdHash);
        if (existente) {
          await this.contacts.update(existente, conRun, { transaction });
          actualizados += 1;
        } else {
          await this.contacts.create(conRun, { transaction });
          creados += 1;
        }
      }

      const totalStored = await this.contacts.countFor(input.tenantId, input.customerId, { transaction });

      /*
       * El cruce contra las agendas de OTROS expedientes, sólo en el último lote.
       *
       * Es la señal que justifica guardar `phone_hashes` en claro: contesta «¿varias solicitudes
       * distintas comparten los mismos números?» sin descifrar ni una ficha. Se calcula sobre TODA la
       * agenda guardada del cliente (el último lote ya está escrito dentro de esta transacción), no
       * sobre el lote: con la agenda troceada, el último lote trae a veces un puñado de contactos y
       * el cruce sólo vería esos. Sólo al cerrar la sincronización, porque hacerlo en cada lote daría
       * un número distinto según cuánta agenda llevara subida.
       *
       * No se le devuelve al teléfono: queda en el paso del expediente, que es donde lo lee quien
       * revisa. Decírselo a la persona analizada le enseñaría qué contacto borrar.
       */
      const solapamiento = input.body.isFinalBatch
        ? await this.contacts.countPhoneOverlapWithOtherCustomers(
            {
              tenantId: input.tenantId,
              customerId: input.customerId,
              phoneHashes: await this.contacts.findStoredPhoneHashes(input.tenantId, input.customerId, { transaction }),
            },
            { transaction },
          )
        : null;

      await this.journal.recordAddressBookSync(
        {
          tenantId: input.tenantId,
          customerId: input.customerId,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          ipAddress: input.ipAddress,
          onboardingFlowId: flow ? String(flow.id) : null,
          computationRunId: String(run.id),
          consentId: contexto.consentId,
          algorithmVersion: input.body.algorithmVersion,
          isFinalBatch: input.body.isFinalBatch,
          accessScope: input.body.accessScope,
          totalContactsInDevice: input.body.totalContactsInDevice,
          created: creados,
          updated: actualizados,
          totalStored,
          customersSharingContacts: solapamiento,
          occurredAt: now,
        },
        { transaction },
      );

      return { runId: String(run.id), creados, actualizados, totalStored, solapamiento };
    });
  }
}
