/**
 * @file Caso de uso: comprobar el PIN de quien ya tiene sesión, sin abrir otra.
 * @business Antes de enseñar a una persona todo lo que Atlas sabe de ella se le vuelve a pedir el PIN: una sesión
 *   abierta en un teléfono prestado o perdido no basta para leer su expediente.
 * @system compara el PIN contra la credencial del actor del token; deja rastro en la bitácora de autenticación.
 */
import { BadRequestException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { verifyPassword } from '../../common/utils/crypto/password.util.js';
import { AuthActorResolverService } from './auth-actor-resolver.service.js';
import { AuthPasswordChangeRepository } from './auth-password-change.repository.js';
import type { ActorType } from './auth-vocabulary.js';

/** Fallos seguidos que se toleran por cuenta dentro de la ventana, y cuánto dura la ventana. */
export const PIN_VERIFY_MAX_FAILURES = 5;
export const PIN_VERIFY_WINDOW_MS = 15 * 60_000;

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
 * `@Throttle` del controlador (5 por minuto, por IP) y, por CUENTA, una pausa: con `PIN_VERIFY_MAX_FAILURES` fallos
 * en `PIN_VERIFY_WINDOW_MS` se responde 429 sin mirar el PIN. La pausa afecta sólo a esta comprobación —no al login
 * ni a la credencial—, así que no es el botón de denegación que se quería evitar: lo peor que consigue quien la
 * provoca es que el dueño espere unos minutos para ver sus datos. Un PIN de cuatro dígitos pasa de barrerse en horas
 * rotando de IP a necesitar semanas. Cada intento queda en la bitácora.
 *
 * ## 400 y no 401
 *
 * Lo que está mal es el dato que se escribió, no la sesión. Con 401 el cliente lo leería como «sesión
 * caducada» y expulsaría a la persona al login por un dedo torpe.
 */
@Injectable()
export class AuthPinVerifyService {
  /** Comprobaciones en vuelo por cuenta: el recuento de fallos sólo ve las ya registradas y las ráfagas lo burlarían. */
  private readonly enCurso = new Map<string, number>();

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

    const fallos = await this.passwordChangeRepository.countRecentPinFailures(input.actorId, new Date(Date.now() - PIN_VERIFY_WINDOW_MS));
    const key = `${input.actorType}:${input.actorId}`;
    const previas = this.enCurso.get(key) ?? 0;
    if (fallos + previas >= PIN_VERIFY_MAX_FAILURES) {
      // No se registra como fallo: contaría contra la ventana y la pausa no terminaría nunca para quien insiste.
      throw new HttpException(
        { code: 'PIN_VERIFY_COOLDOWN', message: 'Demasiados intentos con el PIN. Espera unos minutos y vuelve a intentarlo.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Reserva síncrona tras el recuento: N peticiones simultáneas ya no leen todas el mismo número (por proceso).
    this.enCurso.set(key, previas + 1);
    let correct: boolean;
    try {
      correct = await verifyPassword(credential.passwordHash, input.pin);
      await this.registrar(actor.tenantId, input, correct);
    } finally {
      const quedan = (this.enCurso.get(key) ?? 1) - 1;
      if (quedan > 0) this.enCurso.set(key, quedan);
      else this.enCurso.delete(key);
    }
    if (!correct) {
      throw new BadRequestException({ code: 'PIN_INCORRECT', message: 'El PIN no es correcto.' });
    }

    return { verified: true, verifiedAt: new Date().toISOString() };
  }

  private async registrar(tenantId: string | null, input: PinVerifyRequester, correct: boolean): Promise<void> {
    await this.passwordChangeRepository.recordEvent({
      tenantId,
      actorType: input.actorType,
      actorId: input.actorId,
      eventType: 'pin_verify',
      successful: correct,
      failureReasonCode: correct ? null : 'invalid_pin',
      ip: input.ip,
      userAgent: input.userAgent,
    });
  }
}
