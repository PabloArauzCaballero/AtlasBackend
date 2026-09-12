/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza controla quién entra al sistema y con qué credenciales vigentes.
 * @system emite, consulta y consume los códigos de un solo uso de cada actor.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { AuthOneTimeCodeModel } from '../../database/models/index.js';
import { ActorType, OneTimeCodePurpose } from './auth.repository.js';

/**
 * Códigos de un solo uso: el PIN del login, el código de reset de contraseña y el OTP de
 * verificación de contacto.
 *
 * Es una tabla con ciclo de vida propio —se emite, se intenta, se agota o se consume— y sus reglas
 * (nunca más de un código vigente por actor y propósito, consumirlo al agotar los intentos) no
 * tienen nada que ver con las credenciales ni con los refresh tokens con los que compartía archivo.
 */
@Injectable()
export class AuthOneTimeCodeRepository {
  constructor(@InjectModel(AuthOneTimeCodeModel) private readonly oneTimeCodeModel: typeof AuthOneTimeCodeModel) {}

  /**
   * Crea un código de un solo uso y consume cualquier código anterior todavía activo del mismo
   * actor+propósito: nunca hay más de un código vigente, así reenviar un código invalida el
   * anterior en vez de multiplicar las combinaciones válidas.
   */
  /**
   * `options.transaction` existe para que la emisión del código pueda compartir la transacción de
   * quien la pide. La verificación de contacto creaba el código FUERA de su transacción: si el resto
   * del flujo hacía rollback quedaba un código vigente sin intento asociado, y el `submit` posterior
   * respondía `VERIFICATION_ATTEMPT_NOT_FOUND` sobre un código que el cliente sí había recibido.
   */
  async createOneTimeCode(
    input: {
      tenantId: string | null;
      actorType: ActorType;
      actorId: string;
      purpose: OneTimeCodePurpose;
      codeHash: string;
      challengeHash: string | null;
      expiresAt: Date;
    },
    options: { transaction?: Transaction } = {},
  ): Promise<AuthOneTimeCodeModel> {
    const now = new Date();
    await this.oneTimeCodeModel.update({ consumedAt: now } as never, {
      where: { actorType: input.actorType, actorId: input.actorId, purpose: input.purpose, consumedAt: null } as never,
      transaction: options.transaction,
    });

    return this.oneTimeCodeModel.create(
      {
        tenantId: input.tenantId,
        actorType: input.actorType,
        actorId: input.actorId,
        purpose: input.purpose,
        codeHash: input.codeHash,
        challengeHash: input.challengeHash,
        expiresAt: input.expiresAt,
        consumedAt: null,
        attempts: 0,
        createdAtValue: now,
      } as never,
      { transaction: options.transaction },
    );
  }

  async findActiveOneTimeCodeByActor(
    actorType: ActorType,
    actorId: string,
    purpose: OneTimeCodePurpose,
  ): Promise<AuthOneTimeCodeModel | null> {
    return this.oneTimeCodeModel.findOne({
      where: { actorType, actorId, purpose, consumedAt: null } as never,
      order: [['id', 'DESC']],
    });
  }

  async findActiveOneTimeCodeByChallenge(challengeHash: string): Promise<AuthOneTimeCodeModel | null> {
    return this.oneTimeCodeModel.findOne({ where: { challengeHash, consumedAt: null } as never });
  }

  async registerOneTimeCodeFailedAttempt(code: AuthOneTimeCodeModel, maxAttempts: number): Promise<void> {
    code.attempts += 1;
    if (code.attempts >= maxAttempts) {
      // Agotó los intentos: se consume para que ni siquiera el código correcto sirva después.
      code.consumedAt = new Date();
    }
    await code.save();
  }

  async consumeOneTimeCode(code: AuthOneTimeCodeModel): Promise<void> {
    code.consumedAt = new Date();
    await code.save();
  }
}
