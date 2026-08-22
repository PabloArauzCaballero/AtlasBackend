/**
 * @file Puerto de persistencia: encapsula consultas y escrituras del intento de verificación.
 * @business Esta pieza preserva la evidencia de que una persona se verificó, y con qué resultado.
 * @system escribe y lee `identity_verification_attempts` para el canal móvil.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { IdentityVerificationAttemptModel } from '../../database/models/index.js';

/**
 * El canal con el que se marcan los intentos de este flujo.
 *
 * La columna existía y nadie la escribía. Ponerla es lo que permite medir el
 * canal móvil por separado del de sucursal: son dos poblaciones distintas —una
 * fotografía con la mano y luz variable, la otra con un escáner— y sus tasas de
 * revisión no se pueden comparar si comparten fila.
 */
export const MOBILE_CHANNEL = 'MOBILE_APP';

/** Estado inicial: aceptado y sin resolver. */
export const PENDING_RESULT = 'PENDING';

export type AttemptUpdate = {
  finalResult: string;
  reasonCodes: Record<string, unknown>;
  selfieMatchScore: string | null;
  documentForensicsScore: string | null;
  completedAt: Date;
};

/**
 * Lecturas y escrituras del intento de verificación móvil.
 *
 * **No se guarda ninguna imagen.** Las fotos viajan al motor y ahí termina su
 * vida en este repositorio: lo que queda es el veredicto y sus puntajes. Un
 * carnet y una cara guardados «por si acaso» son exactamente el dato que una
 * fuga convierte en suplantación, y para responder «¿esta persona se verificó?»
 * no hacen falta.
 */
@Injectable()
export class MobileIdentityRepository {
  constructor(
    @InjectModel(IdentityVerificationAttemptModel)
    private readonly attemptModel: typeof IdentityVerificationAttemptModel,
  ) {}

  async createPending(tenantId: string, customerId: string | null): Promise<IdentityVerificationAttemptModel> {
    const ahora = new Date();
    return this.attemptModel.create({
      tenantId,
      customerId,
      verificationChannel: MOBILE_CHANNEL,
      finalResult: PENDING_RESULT,
      requestedAt: ahora,
      /*
        `_created_at` a mano, como en `customer-identity-evidence.repository.ts`.

        El modelo lleva `timestamps: false` y declara la columna `allowNull: false`, asi que
        Sequelize VALIDA antes de mandar la sentencia: sin este campo el insert no llega siquiera a
        Postgres. Y el sintoma no delata la causa —sale como `409 CONFLICT`, que se lee como choque
        de indice unico— asi que el trámite entero moria antes de preguntarle nada al motor. Es el
        mismo defecto que ya se corrigio en `subject-reference.service.ts`.
      */
      createdAtValue: ahora,
    });
  }

  findById(tenantId: string, id: string): Promise<IdentityVerificationAttemptModel | null> {
    // El tenant va en el `where` y no se comprueba después: una consulta que
    // trae la fila de otro inquilino para descartarla ya la trajo.
    return this.attemptModel.findOne({ where: { tenantId, id } });
  }

  async complete(tenantId: string, id: string, update: AttemptUpdate): Promise<void> {
    await this.attemptModel.update(
      {
        finalResult: update.finalResult,
        reasonCodesJson: update.reasonCodes,
        selfieMatchScore: update.selfieMatchScore,
        documentForensicsScore: update.documentForensicsScore,
        completedAt: update.completedAt,
      },
      { where: { tenantId, id } },
    );
  }
}
