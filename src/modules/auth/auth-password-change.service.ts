/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza impide que una contraseña se cambie con solo tener la sesión abierta.
 * @system resuelve actores, credenciales, JWT, códigos de un solo uso y rotación/revocación de refresh tokens.
 */
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { env } from '../../config/env.js';
import { hashPassword, isSecretValidFor, secretRequirementMessage, verifyPassword } from '../../common/utils/crypto/password.util.js';
import {
  generateChallengeToken,
  generateNumericCode,
  hashOneTimeCode,
  verifyOneTimeCode,
} from '../../common/utils/crypto/one-time-code.util.js';
import { TokenRevocationService } from '../../common/services/token-revocation.service.js';
import { MailSenderService } from '../mail-sender/mail-sender.service.js';
import { AuthActorResolverService } from './auth-actor-resolver.service.js';
import { AuthOneTimeCodeRepository } from './auth-one-time-code.repository.js';
import { AuthPasswordChangeRepository } from './auth-password-change.repository.js';
import { PasswordChangeChallengeResponseDto } from './auth.dtos.js';
import type { ActorType } from './auth-vocabulary.js';

/** Quién pide el cambio, tomado del access token y NUNCA del cuerpo de la petición. */
type Requester = {
  actorType: ActorType;
  actorId: string;
  tenantId: string | null;
  ip: string | null;
  userAgent: string | null;
};

/** Mismo cooldown por destino que el reset: un correo cada 60 s por actor. */
const PASSWORD_CHANGE_RESEND_COOLDOWN_MS = 60_000;

/**
 * Cambio de contraseña de un actor YA autenticado, en dos pasos y con el mismo segundo factor por
 * correo que el login.
 *
 * ## Por qué existe
 *
 * Cada alta de usuario interno pone `mustChangePassword = true` y le entrega una contraseña
 * temporal por correo. Hasta ahora no había ningún endpoint con el que cumplir esa obligación: el
 * único camino a una contraseña nueva era `password-reset`, es decir, declararse *incapaz de
 * entrar* estando dentro. La bandera se quedaba en `true` para siempre y la contraseña temporal
 * —la que viajó por correo, en texto plano, y que probablemente sigue en esa bandeja— seguía
 * siendo la buena.
 *
 * ## Por qué en dos pasos y no en uno
 *
 * Un cambio de contraseña en un solo POST convierte cualquier sesión robada en la pérdida
 * definitiva de la cuenta: quien tenga el access token cambia la contraseña y el dueño ya no
 * vuelve a entrar. Exigir un código entregado por correo mueve la barrera a un canal que el ladrón
 * de un token no controla, y de paso le AVISA al dueño mientras el ataque ocurre.
 *
 * La contraseña actual se exige en el primer paso, no en el segundo: así ni se gasta un correo ni
 * se abre un desafío para quien no puede probar que ya es el dueño de la sesión.
 *
 * ## Fail-closed, sin la degradación del login
 *
 * `AuthSecondFactorService.isRequired` degrada a un solo factor cuando no hay canal de correo, para
 * no dejar el backend inaccesible en desarrollo. Aquí NO existe esa salida: sin canal se responde
 * 503 y no se cambia nada. Quedarse sin poder cambiar la contraseña es una molestia; cambiarla sin
 * segundo factor porque el proveedor de correo está caído es la escalada que este servicio existe
 * para impedir.
 */
@Injectable()
export class AuthPasswordChangeService {
  constructor(
    private readonly oneTimeCodeRepository: AuthOneTimeCodeRepository,
    private readonly passwordChangeRepository: AuthPasswordChangeRepository,
    private readonly tokenRevocationService: TokenRevocationService,
    private readonly mailSenderService: MailSenderService,
    private readonly actorResolver: AuthActorResolverService,
  ) {}

  /**
   * Paso 1: valida la contraseña actual y manda el código al correo del actor.
   *
   * A diferencia del reset, aquí NO hay respuesta genérica anti-enumeración: quien llama ya está
   * autenticado y pregunta por su propia cuenta, así que no hay ninguna existencia que ocultarle y
   * un "listo" mentiroso solo lo dejaría esperando un correo que nunca llega.
   */
  async requestPasswordChange(input: Requester & { currentPassword: string }): Promise<PasswordChangeChallengeResponseDto> {
    if (!this.mailSenderService.isEnabled()) {
      throw new ServiceUnavailableException(
        'El cambio de contraseña exige un código por correo y el canal de entrega no está disponible. No se cambia la contraseña sin segundo factor.',
      );
    }

    const { actor, credential } = await this.resolveSelf(input);

    if (!(await verifyPassword(credential.passwordHash, input.currentPassword))) {
      // No se toca el contador de bloqueo del login a propósito. Quien llega aquí ya tiene una
      // sesión válida, así que bloquear la credencial no le quita nada al atacante y sí deja al
      // dueño legítimo fuera de su propia cuenta: sería regalarle un botón de denegación de
      // servicio. La fuerza bruta la contiene el `@Throttle` del controlador, y el intento queda
      // registrado en la bitácora de autenticación.
      await this.recordEvent(actor.tenantId, input, 'password_change_request', false, 'invalid_current_password');
      // 400 y NO 401. Quien llama está autenticado: lo que está mal es el dato que escribió, no su
      // sesión. Con 401, el cliente del portal lo leía como «sesión caducada» y EXPULSABA al
      // usuario al login por una contraseña mal tecleada — medido en navegador.
      throw new BadRequestException('La contraseña actual no es correcta.');
    }

    if (!actor.email) {
      throw new ServiceUnavailableException('Tu cuenta no tiene un correo registrado al que enviar el código de confirmación.');
    }

    const ttlMinutes = env.AUTH_ONE_TIME_CODE_TTL_MINUTES;
    const active = await this.oneTimeCodeRepository.findActiveOneTimeCodeByActor(input.actorType, input.actorId, 'password_change');
    if (active?.createdAtValue && Date.now() - active.createdAtValue.getTime() < PASSWORD_CHANGE_RESEND_COOLDOWN_MS) {
      // 429: es exactamente lo que ocurre —demasiadas peticiones en poco tiempo— y evita que el
      // cliente lo confunda con un problema de sesión.
      // Nest no expone una excepción con nombre para 429, así que se construye a mano.
      throw new HttpException(
        'Ya te enviamos un código hace menos de un minuto. Revisa tu correo antes de pedir otro.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = generateNumericCode();
    const challengeToken = generateChallengeToken();
    await this.oneTimeCodeRepository.createOneTimeCode({
      tenantId: actor.tenantId,
      actorType: input.actorType,
      actorId: input.actorId,
      purpose: 'password_change',
      codeHash: hashOneTimeCode(code),
      challengeHash: hashOneTimeCode(challengeToken),
      expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
    });

    await this.mailSenderService.sendPasswordChangeCode({
      to: actor.email,
      recipientName: actor.displayName,
      code,
      ttlMinutes,
      reference: `password-change-${input.actorType}-${input.actorId}`,
    });

    await this.recordEvent(actor.tenantId, input, 'password_change_request', true, null);

    return { pinChallengeRequired: true, challengeToken, expiresInMinutes: ttlMinutes };
  }

  /**
   * Paso 2: canjea el desafío + el código por la contraseña nueva.
   *
   * Al terminar, TODA sesión del actor queda revocada —incluida la que hizo la llamada—: el front
   * debe mandar al login. Es lo mismo que hace el reset, y por la misma razón: si el cambio se
   * pidió porque la sesión estaba comprometida, dejar viva la sesión del atacante convertiría el
   * remedio en teatro.
   */
  async confirmPasswordChange(
    input: Requester & { challengeToken: string; code: string; newPassword: string },
  ): Promise<{ passwordChanged: true }> {
    // Mismo criterio que arriba: la sesión es válida y lo que falla es la entrada, así que 400.
    // El mensaje sigue siendo el mismo para desafío inexistente, expirado y código incorrecto —
    // tres estados que quien ataca no debe poder distinguir.
    const invalidCodeError = new BadRequestException('Código inválido o expirado.');

    // La regla depende de QUIEN cambia: PIN para el cliente, contrasena larga para el resto.
    if (!isSecretValidFor(input.actorType, input.newPassword)) {
      throw new BadRequestException(secretRequirementMessage(input.actorType));
    }

    const challenge = await this.oneTimeCodeRepository.findActiveOneTimeCodeByChallenge(hashOneTimeCode(input.challengeToken));
    // La comprobación de dueño es lo que impide que un desafío ajeno —o uno de otro propósito, como
    // el PIN del login que también viaja como `challengeToken`— sirva para escribir una contraseña
    // aquí. Sin ella, el token opaco por sí solo bastaría para cambiar la contraseña de otro.
    const belongsToRequester =
      challenge?.actorType === input.actorType && challenge?.actorId === input.actorId && challenge?.purpose === 'password_change';
    if (!challenge || !belongsToRequester || challenge.expiresAt.getTime() < Date.now()) {
      throw invalidCodeError;
    }

    if (!verifyOneTimeCode(input.code, challenge.codeHash)) {
      await this.oneTimeCodeRepository.registerOneTimeCodeFailedAttempt(challenge, env.AUTH_ONE_TIME_CODE_MAX_ATTEMPTS);
      throw invalidCodeError;
    }

    const { actor, credential } = await this.resolveSelf(input);

    // Repetir la contraseña que ya se tenía deja la cuenta exactamente igual de expuesta y, cuando
    // el cambio venía forzado por `mustChangePassword`, bajaría la bandera sin cambiar nada: la
    // contraseña temporal que viajó por correo seguiría siendo la válida, ahora sin aviso.
    if (await verifyPassword(credential.passwordHash, input.newPassword)) {
      throw new BadRequestException('La contraseña nueva debe ser distinta de la actual.');
    }

    await this.oneTimeCodeRepository.consumeOneTimeCode(challenge);
    await this.passwordChangeRepository.applyNewPassword({
      actorType: input.actorType,
      actorId: input.actorId,
      credential,
      passwordHash: await hashPassword(input.newPassword),
    });
    // La caché de `JwtAuthGuard` vive en Redis, fuera de la base: sin este empujón los access
    // tokens ya emitidos seguirían pasando hasta que venciera su TTL.
    await this.tokenRevocationService.bumpTokenVersion(input.actorType, input.actorId);

    await this.recordEvent(actor.tenantId, input, 'password_change', true, null);

    return { passwordChanged: true };
  }

  /**
   * El actor y su credencial, resueltos desde el token de quien llama.
   *
   * Se vuelve a leer el estado en vez de confiar en los claims: una cuenta dada de baja o suspendida
   * cuyo access token todavía no vence no debe poder fijar una contraseña nueva.
   */
  private async resolveSelf(input: Requester) {
    const actor = await this.actorResolver.reResolveActorWithEmail(input.actorType, input.actorId, input.tenantId);
    const credential = actor ? await this.passwordChangeRepository.findCredential(input.actorType, actor.id) : null;
    if (!actor || !credential) {
      throw new UnauthorizedException('Tu cuenta ya no está disponible para cambiar la contraseña.');
    }
    return { actor, credential };
  }

  private async recordEvent(
    tenantId: string | null,
    input: Requester,
    eventType: 'password_change_request' | 'password_change',
    successful: boolean,
    failureReasonCode: string | null,
  ): Promise<void> {
    await this.passwordChangeRepository.recordEvent({
      tenantId,
      actorType: input.actorType,
      actorId: input.actorId,
      eventType,
      successful,
      failureReasonCode,
      ip: input.ip,
      userAgent: input.userAgent,
    });
  }
}
