/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza impide que una sesión robada baste para desviar el dinero de un comercio: cambiar la cuenta de cobro exige repetir la contraseña.
 * @system emite y canjea la prueba de reautenticación (un solo uso, 5 minutos, ligada al actor) con el mismo bloqueo por intentos que el login.
 */
import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { env } from '../../config/env.js';
import { generateChallengeToken, hashOneTimeCode } from '../../common/utils/crypto/one-time-code.util.js';
import { verifyPassword } from '../../common/utils/crypto/password.util.js';
import { AuthActorResolverService } from './auth-actor-resolver.service.js';
import { AuthOneTimeCodeRepository } from './auth-one-time-code.repository.js';
import { AuthRepository } from './auth.repository.js';
import type { ActorType } from './auth-vocabulary.js';

/** Cabecera con la que viaja la prueba hasta la operación sensible. */
export const REAUTH_TOKEN_HEADER = 'x-reauth-token';

/** Código de error que el cliente reconoce para pedir la contraseña y reintentar. */
export const REAUTH_REQUIRED_CODE = 'REAUTH_REQUIRED';

/** Vida de la prueba: lo justo para confirmar el cambio que se está haciendo, no una sesión elevada. */
export const REAUTH_TTL_SECONDS = 300;

const PURPOSE = 'sensitive_reauth' as const;

type Requester = { actorType: ActorType; actorId: string; tenantId: string | null; ip: string | null; userAgent: string | null };

export type ReauthProof = { reauthToken: string; expiresInSeconds: number; expiresAt: string };

/**
 * Reautenticación antes de una operación sensible (ASVS 2.x, ISO 27002 8.5).
 *
 * ## Por qué esto y no un segundo factor en el login del comercio
 *
 * El comercio entra con su contraseña sola (`AuthSecondFactorService.isRequired`: MFA opt-in) y con
 * esa sesión podía cambiar el QR bancario al que le pagan sus clientes: una contraseña robada
 * desviaba fondos. Un segundo factor obligatorio en el login dependería de un canal (SMS, correo)
 * que hoy no es fiable en todos los entornos y dejaría fuera a comercios legítimos. Lo que se exige
 * aquí es que la persona que tiene la sesión DEMUESTRE otra vez que sabe la contraseña justo antes
 * del cambio: un token de sesión robado (cookie, equipo desatendido) ya no basta.
 *
 * ## La prueba
 *
 * Un token opaco de 48 bytes, guardado sólo como huella en `auth_one_time_codes` con propósito
 * `sensitive_reauth`: vive {@link REAUTH_TTL_SECONDS} segundos, se gasta al usarse y sólo lo acepta
 * el mismo actor que lo pidió. Emitir uno nuevo invalida el anterior.
 *
 * ## El bloqueo es el del login, a propósito
 *
 * Cada contraseña errada aquí cuenta en el MISMO contador que el login (`reserveLoginAttempt`) y lo
 * desbloquea igual. A diferencia del cambio de contraseña —que no lo toca para no regalar un botón de
 * bloqueo—, aquí el bloqueo no le da al atacante nada que no tenga ya: el login es público y basta el
 * correo para agotarlo. Lo que sí evita es que una sesión robada sirva para probar contraseñas sin
 * límite contra el único control que protege la cuenta de cobro.
 */
@Injectable()
export class AuthReauthenticationService {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly oneTimeCodeRepository: AuthOneTimeCodeRepository,
    private readonly actorResolver: AuthActorResolverService,
  ) {}

  async issue(input: Requester & { password: string }): Promise<ReauthProof> {
    const actor = await this.actorResolver.reResolveActorRole(input.actorType, input.actorId, input.tenantId);
    const credential = actor ? await this.authRepository.findCredentialsByActor(input.actorType, actor.id) : null;
    if (!actor || !credential) {
      throw new UnauthorizedException('Tu cuenta ya no está disponible.');
    }

    if (credential.lockedUntil && credential.lockedUntil.getTime() > Date.now()) {
      await this.recordEvent(input, actor.tenantId, false, 'account_locked');
      throw lockedError(credential.lockedUntil);
    }
    const locked = await this.authRepository.reserveLoginAttempt(credential.id, {
      maxAttempts: env.AUTH_MAX_FAILED_LOGIN_ATTEMPTS,
      lockoutMinutes: env.AUTH_LOCKOUT_MINUTES,
    });
    if (locked) {
      await this.recordEvent(input, actor.tenantId, false, 'account_locked');
      throw lockedError(locked.lockedUntil);
    }

    if (!(await verifyPassword(credential.passwordHash, input.password))) {
      await this.recordEvent(input, actor.tenantId, false, 'invalid_password');
      // 400 y no 401: la sesión es buena, lo errado es lo que se tecleó. Con 401 el portal entiende
      // «sesión caducada» y expulsa al usuario por una contraseña mal escrita.
      throw new BadRequestException({ code: 'REAUTH_INVALID_PASSWORD', message: 'La contraseña no es correcta.' });
    }
    await this.authRepository.clearFailedAttempts(credential.id);

    const reauthToken = generateChallengeToken();
    const tokenHash = hashOneTimeCode(reauthToken);
    const expiresAt = new Date(Date.now() + REAUTH_TTL_SECONDS * 1000);
    await this.oneTimeCodeRepository.createOneTimeCode({
      tenantId: actor.tenantId,
      actorType: input.actorType,
      actorId: actor.id,
      purpose: PURPOSE,
      codeHash: tokenHash,
      challengeHash: tokenHash,
      expiresAt,
    });
    await this.recordEvent(input, actor.tenantId, true, null);

    return { reauthToken, expiresInSeconds: REAUTH_TTL_SECONDS, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Comprueba la prueba SIN gastarla. Sirve para fallar rápido, antes de trabajo caro (descargar y
   * leer la imagen del QR); la que cuenta es {@link consume}, justo antes de escribir.
   */
  async assertValid(input: { actorType: ActorType; actorId: string; reauthToken: string | null | undefined }): Promise<void> {
    await this.findUsable(input);
  }

  /** Gasta la prueba. Dos usos concurrentes del mismo token: sólo uno pasa. */
  async consume(input: { actorType: ActorType; actorId: string; reauthToken: string | null | undefined }): Promise<void> {
    const proof = await this.findUsable(input);
    if (!(await this.oneTimeCodeRepository.consumeOneTimeCode(proof))) throw reauthRequired('La confirmación ya se usó.');
  }

  private async findUsable(input: { actorType: ActorType; actorId: string; reauthToken: string | null | undefined }) {
    const token = input.reauthToken?.trim();
    if (!token) throw reauthRequired('Confirma tu contraseña para hacer este cambio.');

    const proof = await this.oneTimeCodeRepository.findActiveOneTimeCodeByChallenge(hashOneTimeCode(token));
    const usable =
      proof !== null &&
      proof.purpose === PURPOSE &&
      proof.actorType === input.actorType &&
      String(proof.actorId) === String(input.actorId) &&
      proof.expiresAt.getTime() > Date.now();
    // Inexistente, de otro actor, vencida o ya usada: la misma respuesta para las cuatro.
    if (!usable || !proof) throw reauthRequired('La confirmación con tu contraseña venció o ya se usó. Vuelve a confirmarla.');
    return proof;
  }

  private recordEvent(input: Requester, tenantId: string | null, successful: boolean, failureReasonCode: string | null) {
    return this.authRepository.recordLoginAttemptEvent({
      tenantId,
      actorType: input.actorType,
      actorId: input.actorId,
      eventType: 'sensitive_reauth',
      successful,
      failureReasonCode,
      ipAddress: input.ip,
      userAgent: input.userAgent,
    });
  }
}

function reauthRequired(message: string): ForbiddenException {
  return new ForbiddenException({ code: REAUTH_REQUIRED_CODE, message });
}

/** 429 con la hora: igual que el login, quien se equivocó sabe cuánto esperar. */
function lockedError(lockedUntil: Date | null): HttpException {
  const until = lockedUntil ?? new Date(Date.now() + env.AUTH_LOCKOUT_MINUTES * 60_000);
  return new HttpException(
    {
      code: 'ACCOUNT_LOCKED',
      message: 'Cuenta bloqueada temporalmente por múltiples intentos fallidos.',
      lockedUntil: until.toISOString(),
      retryAfterSeconds: Math.max(1, Math.ceil((until.getTime() - Date.now()) / 1000)),
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}
