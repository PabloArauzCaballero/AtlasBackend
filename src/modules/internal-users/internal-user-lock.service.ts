/**
 * @file Caso de uso: ver y levantar el bloqueo por intentos fallidos de una cuenta interna.
 * @business Quien se equivocó de contraseña cinco veces no debería depender de que alguien abra la base para volver a entrar.
 * @system lee `locked_until` de `auth_credentials`, lo limpia con el contador y deja auditoría con motivo.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { AuthCredentialModel } from '../../database/models/index.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { InternalRbacRepository } from './internal-rbac.repository.js';
import { assertInternalActor } from './internal-users.policy.js';
import { UnlockInternalUserDto } from './internal-users.schemas.js';
import { InternalAccessProfile } from './internal-users.types.js';

/** El bloqueo tal como lo ve quien administra: si está vigente, hasta cuándo, y cuántos fallos lleva. */
export type InternalUserLockState = {
  locked: boolean;
  lockedUntil: string | null;
  failedLoginAttempts: number;
};

const SIN_BLOQUEO: InternalUserLockState = { locked: false, lockedUntil: null, failedLoginAttempts: 0 };

/**
 * El bloqueo vive en la CREDENCIAL, no en el usuario.
 *
 * `internal_users.status = 'locked'` es una decisión de un administrador y ya tiene su vía
 * (`PATCH /internal/users/:id`). Lo de aquí es el bloqueo automático tras N intentos fallidos
 * (`auth.repository.ts → reserveLoginAttempt`), que pone `locked_until` en el futuro y, hasta hoy,
 * sólo se levantaba esperando o por SQL — y por SQL con la trampa de escribir un hash por ssh.
 *
 * Va en un servicio aparte porque `InternalRbacRepository` está congelado en la línea base de
 * `check:file-size` y porque el resto de `InternalUsersService` no necesita saber de credenciales.
 */
@Injectable()
export class InternalUserLockService {
  constructor(
    private readonly rbacRepository: InternalRbacRepository,
    @InjectModel(AuthCredentialModel) private readonly credentialModel: typeof AuthCredentialModel,
  ) {}

  private findCredential(internalUserId: string): Promise<AuthCredentialModel | null> {
    return this.credentialModel.findOne({ where: { actorType: 'internal_user', actorId: internalUserId, deleted: false } as never });
  }

  async lockState(internalUserId: string, now: Date = new Date()): Promise<InternalUserLockState> {
    const credential = await this.findCredential(internalUserId);
    if (!credential) return SIN_BLOQUEO;
    const lockedUntil = credential.lockedUntil ? new Date(credential.lockedUntil) : null;
    return {
      locked: lockedUntil !== null && lockedUntil.getTime() > now.getTime(),
      lockedUntil: lockedUntil ? lockedUntil.toISOString() : null,
      failedLoginAttempts: credential.failedLoginAttempts ?? 0,
    };
  }

  /** La ficha del usuario con su estado de bloqueo al lado: el portal decide con esto si ofrece «Desbloquear». */
  async withLockState<T extends InternalAccessProfile>(profile: T): Promise<T & { lock: InternalUserLockState }> {
    return { ...profile, lock: await this.lockState(profile.user.id) };
  }

  /**
   * Levanta el bloqueo: `locked_until` a nulo y el contador a cero, como hace un login correcto.
   *
   * No sube `token_version`: desbloquear no revoca nada —la persona no tenía sesión que cerrar— y
   * revocar aquí echaría a quien, bloqueado desde otro dispositivo, sigue trabajando en éste.
   * 409 si no hay bloqueo vigente: el botón de la ficha puede haberse quedado viejo, y «desbloquear»
   * una cuenta que no lo estaba dejaría en la auditoría una acción que no ocurrió.
   */
  async unlock(
    currentUser: AuthenticatedUser,
    internalUserId: string,
    dto: UnlockInternalUserDto,
    requestContext: { ipAddress: string | null; userAgent: string | null },
    now: Date = new Date(),
  ): Promise<InternalAccessProfile & { lock: InternalUserLockState }> {
    const actor = assertInternalActor(currentUser);
    const targetUserId = parsePositiveId(internalUserId, 'internalUserId');
    const user = await this.rbacRepository.findUserById(actor.tenantId, targetUserId);
    if (!user) throw new NotFoundException('Usuario interno no encontrado.');

    const credential = await this.findCredential(targetUserId);
    const lockedUntil = credential?.lockedUntil ? new Date(credential.lockedUntil) : null;
    if (!credential || !lockedUntil || lockedUntil.getTime() <= now.getTime()) {
      throw new ConflictException('INTERNAL_USER_NOT_LOCKED');
    }

    const previousFailedLoginAttempts = credential.failedLoginAttempts ?? 0;
    credential.lockedUntil = null;
    credential.failedLoginAttempts = 0;
    credential.updatedAtValue = now;
    await credential.save();

    await this.rbacRepository.createAudit({
      tenantId: actor.tenantId,
      actorInternalUserId: actor.internalUserId,
      actionCode: 'internal_users.unlock',
      targetType: 'internal_user',
      targetId: targetUserId,
      reason: dto.reason,
      metadata: { previousLockedUntil: lockedUntil.toISOString(), previousFailedLoginAttempts },
      ipAddress: requestContext.ipAddress,
      userAgent: requestContext.userAgent,
    });

    return this.withLockState(await this.rbacRepository.buildAccessProfile(user));
  }
}
