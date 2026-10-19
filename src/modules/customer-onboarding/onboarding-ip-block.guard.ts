/**
 * @file Guardia HTTP: corta el alta de una IP bloqueada antes de autenticar o tocar la base.
 * @business Quien intentó registrar un carnet ya registrado por otra persona no puede seguir ni crear otra cuenta desde la misma conexión.
 * @system consulta `OnboardingIpBlockService`; solo se aplica a los controladores del alta, no al inicio de sesión de clientes existentes.
 */
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { OnboardingIpBlockService } from './application/onboarding-ip-block.service.js';

export const ONBOARDING_IP_BLOCKED = 'ONBOARDING_IP_BLOCKED';

@Injectable()
export class OnboardingIpBlockGuard implements CanActivate {
  constructor(private readonly ipBlock: OnboardingIpBlockService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ ip?: string }>();
    if (await this.ipBlock.isBlocked(request.ip)) throw new ForbiddenException(ONBOARDING_IP_BLOCKED);
    return true;
  }
}
