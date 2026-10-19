/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Un carnet solo pertenece a una cuenta. Si llega el de otra persona, la conexión se bloquea porque lo normal es un intento de suplantación.
 * @system compara el hash del número con los documentos de OTROS clientes del tenant y, si coincide, bloquea la IP y corta el alta.
 */
import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { hashSensitiveText } from '../../../common/utils/crypto/hash.util.js';
import { ONBOARDING_IP_BLOCKED } from '../onboarding-ip-block.guard.js';
import { CustomerIdentityEvidenceRepository } from '../repositories/customer-identity-evidence.repository.js';
import { OnboardingIpBlockService } from './onboarding-ip-block.service.js';

@Injectable()
export class IdentityDocumentDuplicateService {
  private readonly logger = new Logger(IdentityDocumentDuplicateService.name);

  constructor(
    private readonly evidenceRepository: CustomerIdentityEvidenceRepository,
    private readonly ipBlock: OnboardingIpBlockService,
  ) {}

  /**
   * Lanza `ONBOARDING_IP_BLOCKED` (403) y deja la IP bloqueada si el documento ya figura en otro cliente.
   *
   * No dice que el carnet existe: responder «ya está registrado» permitiría sondear la base con
   * números de carnet. La persona solo ve que su conexión quedó bloqueada.
   * Un cliente que reenvía SU propio carnet (reintento tras un rechazo) no cuenta: se excluye por id.
   */
  async assertNotRegisteredToAnotherCustomer(input: {
    tenantId: string;
    customerId: string;
    /** Número en claro, si el cliente lo manda. El servidor calcula el hash él mismo: no se fía del que declara el teléfono. */
    documentNumber?: string | null;
    /** Hash declarado por el teléfono, para cuando el número en claro no viaja. */
    documentNumberHash?: string | null;
    ipAddress: string | null;
  }): Promise<void> {
    const hashes = new Set<string>();
    if (input.documentNumber) hashes.add(hashSensitiveText(input.documentNumber));
    if (input.documentNumberHash) hashes.add(input.documentNumberHash.trim().toLowerCase());
    if (hashes.size === 0) return;

    const other = await this.evidenceRepository.findIdentityDocumentOfAnotherCustomer(input.tenantId, input.customerId, [...hashes]);
    if (!other) return;

    await this.ipBlock.block(input.ipAddress, 'IDENTITY_DOCUMENT_ALREADY_REGISTERED');
    this.logger.warn(
      `Carnet ya registrado a otro cliente: se bloquea la IP ${input.ipAddress ?? 'desconocida'} ` +
        `(cliente ${input.customerId}, documento de ${other.customerId}, tenant ${input.tenantId}).`,
    );
    throw new ForbiddenException(ONBOARDING_IP_BLOCKED);
  }
}
