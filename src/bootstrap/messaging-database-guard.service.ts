/**
 * @file Guarda de arranque del worker de Mensajería (AT-057): sin SU base y SU identidad, no arranca.
 * @business Readiness no puede mentir: `SequelizeModule.forRoot` construye la conexión sin autenticar, así
 *   que un proceso con credencial mala quedaría «listo» hasta la primera consulta. Y el piloto no debe
 *   correr por descuido con la identidad del monolito (`atlas_app_rw`), que sí puede leer Crédito.
 * @system `OnModuleInit`: `authenticate()` y comprobación de `current_user` contra `MESSAGING_DB_USER`
 *   cuando está definido. Cualquier fallo aborta el arranque con la causa.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { env } from '../config/env.js';

@Injectable()
export class MessagingDatabaseGuardService implements OnModuleInit {
  private readonly logger = new Logger(MessagingDatabaseGuardService.name);

  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  async onModuleInit(): Promise<void> {
    await this.sequelize.authenticate();
    const rows = await this.sequelize.query<{ u: string }>('SELECT current_user AS u', { type: QueryTypes.SELECT });
    const actual = rows[0]?.u;
    // Revisión independiente A, hallazgo 2: antes la comprobación se saltaba si la variable faltaba, así que
    // el proceso arrancaba con la identidad del monolito y lo registraba como «verificado». Ahora falta = fallo.
    if (!env.MESSAGING_DB_USER) {
      throw new Error('MESSAGING_DB_USER_MISSING: el worker de Mensajería exige su identidad propia (atlas_ctx_messaging).');
    }
    if (actual !== env.MESSAGING_DB_USER) {
      throw new Error(`MESSAGING_DB_IDENTITY_MISMATCH: conectado como ${actual}, se esperaba ${env.MESSAGING_DB_USER}.`);
    }
    this.logger.log(`Base de Mensajería verificada como ${actual}.`);
  }
}
