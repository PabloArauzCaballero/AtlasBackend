/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza impide que una contraseña se cambie con solo tener la sesión abierta.
 * @system resuelve actores, credenciales, JWT, códigos de un solo uso y rotación/revocación de refresh tokens.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { InternalUserModel, MerchantUserModel } from '../../database/models/index.js';
import { AuthCredentialModel } from '../../database/models/index.js';
import { AuthRepository } from './auth.repository.js';
import type { ActorType, AuthEventType } from './auth-vocabulary.js';

/**
 * Todo lo que el cambio de contraseña escribe, en un solo sitio.
 *
 * Compone `AuthRepository` en vez de duplicarlo —la credencial, los refresh tokens y la bitácora
 * siguen siendo suyos— y añade lo único que le faltaba: bajar `must_change_password`. Ese añadido
 * no cabía en `AuthRepository`, que arrastra deuda de tamaño congelada; es la misma razón por la
 * que existe `MerchantActorRepository`.
 *
 * Que el conjunto de escrituras viva junto no es sólo orden: `applyNewPassword` fija el ORDEN en
 * que ocurren, y ese orden es la diferencia entre un cambio a medias inofensivo y uno peligroso.
 */
@Injectable()
export class AuthPasswordChangeRepository {
  constructor(
    private readonly authRepository: AuthRepository,
    @InjectModel(InternalUserModel) private readonly internalUserModel: typeof InternalUserModel,
    @InjectModel(MerchantUserModel) private readonly merchantUserModel: typeof MerchantUserModel,
  ) {}

  findCredential(actorType: ActorType, actorId: string): Promise<AuthCredentialModel | null> {
    return this.authRepository.findCredentialsByActor(actorType, actorId);
  }

  /**
   * Guarda la contraseña nueva, baja la bandera de contraseña temporal y revoca los refresh tokens.
   *
   * El orden importa. La contraseña se guarda PRIMERO: al revés —bajar la bandera y después fallar
   * al guardar— dejaría una cuenta con su contraseña temporal intacta y sin nada que le recuerde al
   * usuario que sigue siéndolo. Y la revocación va al final, cuando ya no queda nada por escribir:
   * revocar antes de guardar echaría al usuario de su sesión para después dejarle la contraseña
   * vieja, que es la peor combinación de las cuatro.
   */
  async applyNewPassword(input: {
    actorType: ActorType;
    actorId: string;
    credential: AuthCredentialModel;
    passwordHash: string;
  }): Promise<void> {
    await this.authRepository.updatePasswordHash(input.credential, input.passwordHash);
    await this.clearMustChangePassword(input.actorType, input.actorId);
    await this.authRepository.revokeAllRefreshTokensForActor(input.actorType, input.actorId, 'password_change');
  }

  async recordEvent(input: {
    tenantId: string | null;
    actorType: ActorType;
    actorId: string;
    eventType: AuthEventType;
    successful: boolean;
    failureReasonCode: string | null;
    ip: string | null;
    userAgent: string | null;
  }): Promise<void> {
    await this.authRepository.recordLoginAttemptEvent({
      tenantId: input.tenantId,
      actorType: input.actorType,
      actorId: input.actorId,
      eventType: input.eventType,
      successful: input.successful,
      failureReasonCode: input.failureReasonCode,
      ipAddress: input.ip,
      userAgent: input.userAgent,
    });
  }

  /**
   * La bandera existe en `iam.internal_users` y en `iam.merchant_users` — las dos poblaciones a las
   * que se les entrega una contraseña temporal. `customer` y `platform_user` no la tienen: para
   * ellos esto es deliberadamente un no-op, y no un error, porque el flujo de cambio sí les aplica.
   */
  private async clearMustChangePassword(actorType: ActorType, actorId: string): Promise<void> {
    const values = { mustChangePassword: false, updatedAtValue: new Date() } as never;

    if (actorType === 'internal_user') {
      await this.internalUserModel.update(values, { where: { id: actorId } as never });
      return;
    }
    if (actorType === 'merchant_user') {
      await this.merchantUserModel.update(values, { where: { id: actorId } as never });
    }
  }
}
