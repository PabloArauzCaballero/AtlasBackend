/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Entrega a quien investiga un caso el fraude abierto y la última verificación de identidad del cliente.
 * @system lee fraud_cases e identity_verification_attempts del cliente, sin escribir.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op } from 'sequelize';
import { FraudCaseModel, IdentityVerificationAttemptModel } from '../../database/models/index.js';

@Injectable()
export class CustomerInvestigationRepository {
  constructor(
    @InjectModel(FraudCaseModel) private readonly fraudCaseModel: typeof FraudCaseModel,
    @InjectModel(IdentityVerificationAttemptModel) private readonly identityAttemptModel: typeof IdentityVerificationAttemptModel,
  ) {}

  /**
   * El último intento de verificación de identidad del cliente, de cualquier canal.
   *
   * De CUALQUIER canal a propósito: quien investiga un caso necesita el estado
   * actual de la identidad, no el de una vía concreta. Filtrar por canal aquí
   * escondería una verificación de sucursal a quien mira un caso que llegó por el
   * móvil, y al revés — que es exactamente la información que hace falta para
   * saber si el expediente ya tiene respuesta.
   */
  /*
   * Sin filtro por `deleted`: esa columna NO existe en `identity_verification_attempts`.
   *
   * El filtro estaba copiado de las consultas de `customers`, donde sí existe, y hacía que
   * Sequelize generara `WHERE ... AND "IdentityVerificationAttemptModel"."deleted" != true`
   * contra una columna inexistente: PostgreSQL respondía 42703 y el endpoint devolvía 500 en
   * producción (medido el 2026-09-07 en `system_action_logs`, y detectado por Flujos al cruzar el
   * catálogo con esas corridas). Los intentos de verificación no se borran ni lógicamente: son
   * evidencia, y por eso la tabla no tiene la columna.
   */
  findLatestIdentityAttempt(tenantId: string, customerId: string): Promise<IdentityVerificationAttemptModel | null> {
    return this.identityAttemptModel.findOne({
      where: { tenantId, customerId },
      order: [['_id', 'DESC']],
    } as FindOptions);
  }

  findFraudCasesForCustomer(tenantId: string, customerId: string): Promise<FraudCaseModel[]> {
    return this.fraudCaseModel.findAll({
      where: {
        tenantId,
        customerId,
        deleted: { [Op.ne]: true },
      },
      order: [
        ['openedAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit: 10,
    } as FindOptions);
  }
}
