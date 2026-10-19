/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Un carnet solo pertenece a una cuenta. Si llega el de otra persona, quien lo intenta queda fuera: su IP, su teléfono y su cuenta.
 * @system compara el hash del número con los documentos de OTROS clientes del tenant y, si coincide, bloquea IP, dispositivo y cuenta y corta el alta.
 */
import { ConflictException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { hashSensitiveText } from '../../../common/utils/crypto/hash.util.js';
import { CustomerLifecycleService } from '../../customers/application/customer-lifecycle.service.js';
import { ONBOARDING_IP_BLOCKED } from '../onboarding-ip-block.guard.js';
import { CustomerIdentityEvidenceRepository } from '../repositories/customer-identity-evidence.repository.js';
import { OnboardingOffenderDeviceRepository } from '../repositories/onboarding-offender-device.repository.js';
import { OnboardingIpBlockService } from './onboarding-ip-block.service.js';
import { ONBOARDING_STRIKE_LIMIT, OnboardingStrikeService } from './onboarding-strike.service.js';

/** Primera y segunda vez: se avisa sin bloquear. */
const DOCUMENT_ALREADY_REGISTERED = 'IDENTITY_DOCUMENT_ALREADY_REGISTERED';

@Injectable()
export class IdentityDocumentDuplicateService {
  private readonly logger = new Logger(IdentityDocumentDuplicateService.name);

  constructor(
    private readonly evidenceRepository: CustomerIdentityEvidenceRepository,
    private readonly ipBlock: OnboardingIpBlockService,
    private readonly strikes: OnboardingStrikeService,
    private readonly devices: OnboardingOffenderDeviceRepository,
    private readonly lifecycle: CustomerLifecycleService,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  /**
   * Rechaza un carnet que ya figura en otro cliente. Equivocarse no bloquea; reincidir sí.
   *
   * La primera y la segunda vez responde 409 `IDENTITY_DOCUMENT_ALREADY_REGISTERED`: la persona se
   * entera de que ese carnet ya tiene cuenta y puede corregir el número o ingresar a la suya. A partir
   * del tercer carnet DISTINTO ya registrado en 24 h (por IP, por dispositivo o por cuenta; repetir el
   * mismo no suma) responde 403 `ONBOARDING_IP_BLOCKED` y bloquea tres cosas: la IP, que corta la
   * conexión pero es fácil de cambiar; la huella del dispositivo, que corta el teléfono aunque cambie
   * de red; y la cuenta, que pasa a `blocked` y es lo único que sobrevive a un teléfono nuevo, a otra
   * red y a que Redis pierda sus claves (el inicio de sesión ya rechaza a un cliente `blocked` y un
   * analista lo levanta con una revisión). Intentar el MISMO carnet desde otra IP o dispositivo vuelve a
   * chocar aquí, porque la comparación es por el número y no por quien lo manda.
   *
   * `blockCaller` es falso cuando quien envía es personal interno que opera por un cliente: se rechaza
   * el envío, pero no se anota ni se castiga a la IP ni a la cuenta del cliente por lo que tecleó otra persona.
   *
   * Un cliente que reenvía SU propio carnet (reintento tras un rechazo) no cuenta.
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

    if (!input.blockCaller) throw new ConflictException(DOCUMENT_ALREADY_REGISTERED);
    const fingerprints = await this.fingerprintsOf(input);
    const strikes = await this.strikes.record(
      [`ip:${input.ipAddress}`, `customer:${input.customerId}`, ...fingerprints.map((fingerprint) => `device:${fingerprint}`)],
      [...hashes][0] as string,
    );
    this.logger.warn(
      `Carnet ya registrado a otro cliente (cliente ${input.customerId}, documento de ${other.customerId}, tenant ${input.tenantId}, IP ${input.ipAddress ?? 'desconocida'}, ${strikes} distintos en 24 h).`,
    );
    if (strikes < ONBOARDING_STRIKE_LIMIT) throw new ConflictException(DOCUMENT_ALREADY_REGISTERED);
    await this.blockCaller(input, fingerprints);
    throw new ForbiddenException(ONBOARDING_IP_BLOCKED);
  }

  private async fingerprintsOf(input: { tenantId: string; customerId: string }): Promise<string[]> {
    try {
      return await this.devices.fingerprintsOfCustomer(input.tenantId, input.customerId);
    } catch (error) {
      this.logger.error(
        `No se pudieron leer los dispositivos del cliente ${input.customerId}: ${error instanceof Error ? error.message : error}`,
      );
      return [];
    }
  }

  /** Los bloqueos de IP y dispositivo no lanzan (degradan a memoria); el de la cuenta se intenta aparte para que su fallo no tape el 403. */
  private async blockCaller(
    input: { tenantId: string; customerId: string; ipAddress: string | null },
    fingerprints: string[],
  ): Promise<void> {
    const reason = 'IDENTITY_DOCUMENT_ALREADY_REGISTERED' as const;
    await this.ipBlock.block(input.ipAddress, reason);
    for (const fingerprint of fingerprints) await this.ipBlock.blockDevice(fingerprint, reason);
    try {
      await this.sequelize.transaction((transaction) =>
        this.lifecycle.advance({
          tenantId: input.tenantId,
          customerId: input.customerId,
          toStatus: 'blocked',
          reasonCode: 'identity_document_already_registered',
          changedByType: 'system',
          notes: 'Reincidió con carnets que ya pertenecen a otras cuentas: posible suplantación de identidad.',
          transaction,
        }),
      );
    } catch (error) {
      this.logger.error(`No se pudo bloquear la cuenta ${input.customerId}: ${error instanceof Error ? error.message : error}`);
    }
  }
}
