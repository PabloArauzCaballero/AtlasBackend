/**
 * @file Guard: aplica autenticación o autorización antes del caso de uso.
 * @business Esta pieza impide que un comercio opere sobre el expediente de otro.
 * @system resuelve el dueño del expediente indicado en la ruta y lo compara con el actor del token.
 */
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { assertOwnPartnerResource } from '../../common/utils/auth/ownership.util.js';
import { RequestWithAuth } from '../../common/types/auth.types.js';
import { firstHeaderValue } from '../../common/utils/http/headers.util.js';
import { PartnerOnboardingRepository } from './partner-onboarding.repository.js';

interface RequestWithPartnerParam extends RequestWithAuth {
  params?: Record<string, string | undefined>;
}

/**
 * Propiedad del expediente, comprobada en el BORDE y no dentro de cada caso de uso.
 *
 * El onboarding es autoservicio: sus endpoints admiten el rol `merchant` y el expediente viaja
 * como `:partnerId` en la URL. Sin esta comprobación —y no la había— cualquier usuario de comercio
 * autenticado podía operar sobre el expediente de otro comercio del mismo tenant: sus
 * representantes legales, sus terminales y sus QR de cobro, que dicen a qué cuenta va el dinero.
 * Hallazgo de la revisión de seguridad del 20-ago-2026.
 *
 * Va como guard y no como una línea dentro de cada servicio a propósito. Hay diez caminos que
 * cargan el expediente y bastaría olvidarla en uno para reabrir el agujero; un endpoint nuevo, que
 * es cuando de verdad se olvida, la hereda del controlador sin que su autor tenga que saber que
 * existe.
 *
 * Las rutas sin `:partnerId` —abrir un expediente— pasan de largo: todavía no hay nada de lo que
 * ser dueño. Quién queda como dueño lo decide `PartnerProfileService.start`.
 */
@Injectable()
export class PartnerOwnershipGuard implements CanActivate {
  constructor(private readonly repository: PartnerOnboardingRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithPartnerParam>();
    const partnerId = request.params?.partnerId;
    if (!partnerId) return true;

    const user = request.user;
    if (!user) return true; // Sin actor no decide este guard: `JwtAuthGuard` ya rechazó antes.

    /*
     * El tenant sale del token y, si no lo lleva —un `platform_user` opera sobre cualquiera—, de
     * la cabecera que `TenantGuard` ya cruzó contra el token. Resolverlo aquí de otra forma
     * permitiría preguntar por el expediente de un tenant ajeno.
     */
    const tenantId = user.tenantId ?? firstHeaderValue(request.headers['x-tenant-id']);
    if (!tenantId) return true;

    const profile = await this.repository.findProfileById(tenantId, partnerId);
    // Un expediente inexistente no es cosa del guard: el caso de uso responde 404 con su mensaje.
    if (!profile) return true;

    assertOwnPartnerResource(user, profile.ownerMerchantUserId);
    return true;
  }
}
