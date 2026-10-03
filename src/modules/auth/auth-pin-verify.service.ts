/**
 * @file Caso de uso: comprobar el PIN de quien ya tiene sesión, sin abrir otra.
 * @business Antes de enseñar a una persona todo lo que Atlas sabe de ella se le vuelve a pedir el PIN: una sesión
 *   abierta en un teléfono prestado o perdido no basta para leer su expediente.
 * @system compara el PIN contra la credencial del actor del token; deja rastro en la bitácora de autenticación.
 */
import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { verifyPassword } from '../../common/utils/crypto/password.util.js';
import { AuthActorResolverService } from './auth-actor-resolver.service.js';
import { AuthPasswordChangeRepository } from './auth-password-change.repository.js';
import type { ActorType } from './auth-vocabulary.js';

/** Quién pide la comprobación, tomado del access token y NUNCA del cuerpo de la petición. */
export type PinVerifyRequester = {
  actorType: ActorType;
  actorId: string;
  tenantId: string | null;
  ip: string | null;
  userAgent: string | null;
};

/**
 * Re-autenticación («step-up») para acciones sensibles: responde si el PIN que se escribe es el de la
 * cuenta de la sesión. No crea sesión, no manda correo y no abre desafío.
 *
 * ## Por qué NO suma al contador de bloqueo del login
 *
 * Es la misma decisión que `AuthPasswordChangeService`: quien llega aquí ya tiene una sesión válida, así
 * que bloquear la credencial no le quita nada a un atacante y sí deja al dueño legítimo fuera de su
 * propia cuenta —sería regalarle un botón de denegación de servicio—. La fuerza bruta la contiene el
 * `@Throttle` del controlador (5 por minuto) y cada intento queda en la bitácora.
 *
 * ## 400 y no 401
 *
 * Lo que está mal es el dato que se escribió, no la sesión. Con 401 el cliente lo leería como «sesión
 * caducada» y expulsaría a la persona al login por un dedo torpe.
 */
@Injectable()
export class AuthPinVerifyService {
  constructor(
    private readonly actorResolver: AuthActorResolverService,
    private readonly passwordChangeRepository: AuthPasswordChangeRepository,
  ) {}

  async verify(input: PinVerifyRequester & { pin: string }): Promise<{ verified: true; verifiedAt: string }> {
    const actor = await this.actorResolver.reResolveActorWithEmail(input.actorType, input.actorId, input.tenantId);
    const credential = actor ? await this.passwordChangeRepository.findCredential(input.actorType, actor.id) : null;
    if (!actor || !credential) {
      throw new UnauthorizedException('Tu cuenta ya no está disponible.');
    }

    const correct = await verifyPassword(credential.passwordHash, input.pin);
    await this.passwordChangeRepository.recordEvent({
      tenantId: actor.tenantId,
      actorType: input.actorType,
      actorId: input.actorId,
      eventType: 'pin_verify',
      successful: correct,
      failureReasonCode: correct ? null : 'invalid_pin',
      ip: input.ip,
      userAgent: input.userAgent,
    });
    if (!correct) {
      throw new BadRequestException({ code: 'PIN_INCORRECT', message: 'El PIN no es correcto.' });
    }

    return { verified: true, verifiedAt: new Date().toISOString() };
  }
}
