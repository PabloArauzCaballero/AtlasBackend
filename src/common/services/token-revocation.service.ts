import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { AuthCredentialModel } from '../../database/models/index.js';

/**
 * Cierra ATLAS-AUDIT-026: hasta este patch, `AuthenticatedUser.tokenVersion` se extraía del
 * JWT pero nunca se comparaba contra nada — el campo existía sin ninguna lógica de revocación
 * detrás, lo que podía dar una falsa sensación de que "la revocación de tokens ya funciona".
 *
 * Este servicio es la única fuente de verdad sobre la versión vigente de token de un actor.
 * `JwtAuthGuard` la consulta en cada request autenticado; `AuthService` la incrementa al
 * cambiar contraseña o forzar cierre de sesión ("logout de todos los dispositivos").
 *
 * Es un servicio `@Global()` (ver `common-auth.module.ts`) para que cualquier guard pueda
 * inyectarlo sin que cada módulo de negocio tenga que importar el módulo de auth completo.
 *
 * Nota de rendimiento: hoy consulta la base de datos en cada request autenticado (una fila
 * por PK, indexada). Es la implementación correcta y simple. Si el volumen de tráfico lo
 * justifica más adelante, se puede agregar una capa de caché en Redis (ya disponible en el
 * proyecto, ver `src/common/redis/redis.module.ts`) delante de esta consulta, invalidando la
 * clave de caché en el mismo punto donde hoy se llama a `bumpTokenVersion`.
 */
@Injectable()
export class TokenRevocationService {
  constructor(@InjectModel(AuthCredentialModel) private readonly credentialModel: typeof AuthCredentialModel) {}

  async getCurrentTokenVersion(actorType: string, actorId: string): Promise<number | null> {
    const record = await this.credentialModel.findOne({
      where: { actorType, actorId, deleted: false } as never,
      attributes: ['tokenVersion'],
    });
    return record ? record.tokenVersion : null;
  }

  async bumpTokenVersion(actorType: string, actorId: string): Promise<number> {
    const record = await this.credentialModel.findOne({ where: { actorType, actorId, deleted: false } as never });
    if (!record) {
      throw new Error(`No existen credenciales para ${actorType}:${actorId}.`);
    }
    record.tokenVersion += 1;
    await record.save();
    return record.tokenVersion;
  }
}
