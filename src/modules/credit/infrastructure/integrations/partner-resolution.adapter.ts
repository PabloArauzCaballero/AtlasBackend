/**
 * @file Adaptador local del puerto de resolución de comercios (AT-026).
 * @business Un expediente no aprobado se rechaza como comercio no disponible; una caja que no es del
 *   comercio no se atribuye.
 * @system Envuelve los servicios de Comercios; los errores salen como `ApplicationError` y la frontera
 *   HTTP los traduce con el mismo código de siempre (422 PARTNER_NOT_AVAILABLE).
 */
import { Injectable } from '@nestjs/common';
import { ApplicationError } from '../../../../platform/contracts/application-error.js';
import { PartnerDirectoryService } from '../../../partner-onboarding/application/partner-directory.service.js';
import { PartnerProfileService } from '../../../partner-onboarding/application/partner-profile.service.js';
import type { PartnerResolution, PartnerResolutionPort } from '../../application/ports/partner-resolution.port.js';

@Injectable()
export class PartnerResolutionAdapter implements PartnerResolutionPort {
  constructor(
    private readonly profiles: PartnerProfileService,
    private readonly directory: PartnerDirectoryService,
  ) {}

  async resolve(tenantId: string, partnerProfileId: string | undefined, posTerminalId: string | undefined): Promise<PartnerResolution> {
    if (!partnerProfileId) return { partnerProfileId: null, posTerminalId: null };
    const profile = await this.profiles.requireProfile(tenantId, partnerProfileId);
    if (profile.onboardingStatus !== 'approved') throw new ApplicationError({ kind: 'unprocessable', code: 'PARTNER_NOT_AVAILABLE' });
    let terminalId: string | null = null;
    if (posTerminalId) {
      const terminal = await this.directory.findOwnedTerminal(tenantId, String(profile.id), posTerminalId);
      terminalId = terminal ? String(terminal.id) : null;
    }
    return { partnerProfileId: String(profile.id), posTerminalId: terminalId };
  }
}
