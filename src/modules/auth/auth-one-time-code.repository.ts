/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza controla quién entra al sistema y con qué credenciales vigentes.
 * @system emite, consulta y consume los códigos de un solo uso de cada actor.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Transaction, literal } from 'sequelize';
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

  /**
   * Reserva un intento ANTES de comparar el código, en un solo UPDATE (`attempts = attempts + 1`
   * condicionado a que quede alguno y el código siga vivo).
   *
   * Antes el intento se contaba DESPUÉS, sumando sobre la fila leída (`code.attempts += 1; save()`):
   * N peticiones en paralelo leían 0, escribían 1 y cada una probaba un código distinto, así que el
   * tope de intentos no frenaba nada bajo concurrencia. `false` = ya no quedan intentos: el llamador
   * responde como ante un código incorrecto sin llegar a compararlo.
   */
  async reserveOneTimeCodeAttempt(code: AuthOneTimeCodeModel, maxAttempts: number): Promise<boolean> {
    const [reserved] = await this.oneTimeCodeModel.update({ attempts: literal('"attempts" + 1') } as never, {
      where: { id: code.id, consumedAt: null, attempts: { [Op.lt]: maxAttempts } } as never,
    });
    return reserved > 0;
  }

  /**
   * El código no casó. El intento ya se contó al reservarlo; aquí sólo se consume si con él se
   * agotaron, para que ni siquiera el código correcto sirva después.
   */
  async registerOneTimeCodeFailedAttempt(code: AuthOneTimeCodeModel, maxAttempts: number): Promise<void> {
    await this.oneTimeCodeModel.update({ consumedAt: new Date() } as never, {
      where: { id: code.id, consumedAt: null, attempts: { [Op.gte]: maxAttempts } } as never,
    });
  }

  /**
   * Consume el código sólo si sigue vivo. `false` = otra petición lo consumió antes: dos canjes
   * concurrentes del mismo código correcto ya no dan dos sesiones ni dos cambios de contraseña.
   */
  async consumeOneTimeCode(code: AuthOneTimeCodeModel): Promise<boolean> {
    const [consumed] = await this.oneTimeCodeModel.update({ consumedAt: new Date() } as never, {
      where: { id: code.id, consumedAt: null } as never,
    });
    return consumed > 0;
  }
}
