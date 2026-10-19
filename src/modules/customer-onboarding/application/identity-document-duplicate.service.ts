/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Un carnet solo pertenece a una cuenta. Si llega el de otra persona, quien lo intenta queda fuera: su IP, su teléfono y su cuenta.
 * @system compara el hash del número con los documentos de OTROS clientes del tenant y, si coincide, bloquea IP, dispositivo y cuenta y corta el alta.
 */
import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { hashSensitiveText } from '../../../common/utils/crypto/hash.util.js';
import { CustomerLifecycleService } from '../../customers/application/customer-lifecycle.service.js';
import { ONBOARDING_IP_BLOCKED } from '../onboarding-ip-block.guard.js';
import { CustomerIdentityEvidenceRepository } from '../repositories/customer-identity-evidence.repository.js';
import { OnboardingOffenderDeviceRepository } from '../repositories/onboarding-offender-device.repository.js';
import { OnboardingIpBlockService } from './onboarding-ip-block.service.js';

@Injectable()
export class IdentityDocumentDuplicateService {
  private readonly logger = new Logger(IdentityDocumentDuplicateService.name);

  constructor(
    private readonly evidenceRepository: CustomerIdentityEvidenceRepository,
    private readonly ipBlock: OnboardingIpBlockService,
    private readonly devices: OnboardingOffenderDeviceRepository,
    private readonly lifecycle: CustomerLifecycleService,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  /**
   * Lanza `ONBOARDING_IP_BLOCKED` (403) si el documento ya figura en otro cliente.
   *
   * Qué se bloquea, y por qué los tres: la IP corta la conexión, pero cambiarla es trivial; la huella
   * del dispositivo corta el teléfono aunque cambie de red; y la cuenta pasa a `blocked`, que es lo
   * único que sobrevive a un teléfono nuevo, a otra red y a que Redis pierda sus claves: ese estado lo
   * lee el inicio de sesión y un analista lo levanta con una revisión (`blocked → under_review`).
   * Intentar el MISMO carnet desde otra IP o dispositivo vuelve a chocar aquí, porque la
   * comparación es por el número y no por quien lo manda.
   *
   * `blockCaller` es falso cuando quien envía es personal interno que opera por un cliente: se rechaza
   * el envío, pero no se castiga a la IP ni a la cuenta del cliente por algo que tecleó otra persona.
   *
   * No dice que el carnet existe: responder «ya está registrado» permitiría sondear la base con
   * números de carnet. Un cliente que reenvía SU propio carnet (reintento tras un rechazo) no cuenta.
   */
  async assertNotRegisteredToAnotherCustomer(input: {
    tenantId: string;
    customerId: string;
    /** Número en claro, si el cliente lo manda. El servidor calcula el hash él mismo: no se fía del que declara el teléfono. */
    documentNumber?: string | null;
    /** Hash declarado por el teléfono, para cuando el número en claro no viaja. */
    documentNumberHash?: string | null;
    ipAddress: string | null;
    blockCaller: boolean;
  }): Promise<void> {
    const hashes = new Set<string>();
    if (input.documentNumber) hashes.add(hashSensitiveText(input.documentNumber));
    if (input.documentNumberHash) hashes.add(input.documentNumberHash.trim().toLowerCase());
    if (hashes.size === 0) return;

    const other = await this.evidenceRepository.findIdentityDocumentOfAnotherCustomer(input.tenantId, input.customerId, [...hashes]);
    if (!other) return;

    if (input.blockCaller) await this.blockCaller(input);
    this.logger.warn(
      `Carnet ya registrado a otro cliente (cliente ${input.customerId}, documento de ${other.customerId}, tenant ${input.tenantId}, IP ${input.ipAddress ?? 'desconocida'}).`,
    );
    throw new ForbiddenException(ONBOARDING_IP_BLOCKED);
  }

  /** Cada bloqueo se intenta por separado: que falle uno (p. ej. Redis) no puede dejar sin los otros dos. */
  private async blockCaller(input: { tenantId: string; customerId: string; ipAddress: string | null }): Promise<void> {
    const reason = 'IDENTITY_DOCUMENT_ALREADY_REGISTERED' as const;
    await this.ipBlock.block(input.ipAddress, reason);
    try {
      for (const fingerprint of await this.devices.fingerprintsOfCustomer(input.tenantId, input.customerId)) {
        await this.ipBlock.blockDevice(fingerprint, reason);
      }
    } catch (error) {
      this.logger.error(
        `No se pudo bloquear el dispositivo del cliente ${input.customerId}: ${error instanceof Error ? error.message : error}`,
      );
    }
    try {
      await this.sequelize.transaction((transaction) =>
        this.lifecycle.advance({
          tenantId: input.tenantId,
          customerId: input.customerId,
          toStatus: 'blocked',
          reasonCode: 'identity_document_already_registered',
          changedByType: 'system',
          notes: 'Intentó registrar un carnet que ya pertenece a otra cuenta: posible suplantación de identidad.',
          transaction,
        }),
      );
    } catch (error) {
      this.logger.error(`No se pudo bloquear la cuenta ${input.customerId}: ${error instanceof Error ? error.message : error}`);
    }
  }
}
