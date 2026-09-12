/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza protege el acceso de clientes y operadores, la recuperación de cuenta y la continuidad segura de sesiones.
 * @system resuelve actores, credenciales, JWT, códigos de un solo uso y rotación/revocación de refresh tokens.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, col, fn, where } from 'sequelize';
import { MerchantUserModel } from '../../database/models/index.js';

/**
 * Lectura de la identidad del comercio afiliado, la cuarta población autenticable
 * (`ActorType = 'merchant_user'`).
 *
 * Vive fuera de `AuthRepository` a propósito: ese archivo arrastra deuda de tamaño congelada y la
 * regla del repositorio es no empeorarla. La separación además deja explícito que esta población
 * comparte credenciales, refresh tokens y bloqueo por intentos con las demás, y se distingue sólo
 * por la tabla que la resuelve.
 */
@Injectable()
export class MerchantActorRepository {
  constructor(@InjectModel(MerchantUserModel) private readonly merchantUserModel: typeof MerchantUserModel) {}

  /**
   * Busca por correo normalizado (`lower(btrim(...))`), que es exactamente lo que indexa el índice
   * único parcial de la migración: buscar de una forma distinta a como indexa la base es como
   * aparecen los "existe pero no puede entrar".
   */
  async findMerchantUserByEmail(email: string, tenantId?: string): Promise<MerchantUserModel | null> {
    const filters: unknown[] = [where(fn('lower', fn('btrim', col('email'))), email.trim().toLowerCase()), { deleted: { [Op.ne]: true } }];
    if (tenantId) filters.push({ tenantId });

    return this.merchantUserModel.findOne({ where: { [Op.and]: filters } as never });
  }

  async findMerchantUserById(id: string): Promise<MerchantUserModel | null> {
    return this.merchantUserModel.findOne({ where: { id, deleted: { [Op.ne]: true } } as never });
  }

  async touchMerchantUserLogin(id: string): Promise<void> {
    await this.merchantUserModel.update({ lastLoginAt: new Date(), updatedAtValue: new Date() } as never, { where: { id } as never });
  }
}
