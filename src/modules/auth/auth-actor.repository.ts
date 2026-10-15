/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Localiza al operador interno o de plataforma que intenta autenticarse, sin distinguir mayúsculas en el correo.
 * @system consulta internal_users y platform_users por correo o por id, ignorando los dados de baja.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, fn, where, col } from 'sequelize';
import { InternalUserModel, PlatformUserModel } from '../../database/models/index.js';

@Injectable()
export class AuthActorRepository {
  constructor(
    @InjectModel(InternalUserModel) private readonly internalUserModel: typeof InternalUserModel,
    @InjectModel(PlatformUserModel) private readonly platformUserModel: typeof PlatformUserModel,
  ) {}

  // ATLAS-P10-045: antes esta búsqueda era case-sensitive tal como estaba almacenado en la
  // base de datos (ver docs/architecture/assumptions.md, "emails de internal_users/platform_users
  // tratados como case-sensitive"). Hoy el único punto de alta es el seeder de desarrollo, que
  // ya inserta en minúsculas, pero comparar con `LOWER(email) = LOWER(:input)` hace la búsqueda
  // robusta independientemente de cómo se haya insertado el registro (seed manual, migración
  // futura, o el módulo de gestión de usuarios internos de ATLAS-PEND-108 cuando exista), sin
  // requerir una migración de datos para los registros ya existentes.
  async findInternalUserByEmail(email: string, tenantId?: string): Promise<InternalUserModel | null> {
    const filters: unknown[] = [where(fn('lower', col('email')), email.trim().toLowerCase()), { deleted: { [Op.ne]: true } }];
    if (tenantId) filters.push({ tenantId });

    return this.internalUserModel.findOne({
      where: { [Op.and]: filters } as never,
    });
  }

  async findPlatformUserByEmail(email: string): Promise<PlatformUserModel | null> {
    return this.platformUserModel.findOne({
      where: { [Op.and]: [where(fn('lower', col('email')), email.trim().toLowerCase()), { deleted: { [Op.ne]: true } }] } as never,
    });
  }

  async findInternalUserById(id: string): Promise<InternalUserModel | null> {
    return this.internalUserModel.findOne({ where: { id } as never });
  }

  async findPlatformUserById(id: string): Promise<PlatformUserModel | null> {
    return this.platformUserModel.findOne({ where: { id } as never });
  }
}
