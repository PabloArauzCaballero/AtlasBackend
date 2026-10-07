/**
 * @file Guarda de arranque: comprueba que la PII cifrada que ya hay guardada se sigue pudiendo leer.
 * @business Evita que un cambio de la clave de cifrado deje a los clientes sin códigos, avisos ni recuperación de PIN sin que nadie se entere.
 * @system lee unos pocos contactos cifrados al arrancar, los descifra y registra un error si no se pueden abrir; nunca impide el arranque.
 */
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { decryptSecretEnvelope } from '../../../common/utils/crypto/envelope-encryption.util.js';
import { CustomerContactMethodModel } from '../../../database/models/index.js';

const MUESTRA = 20;

export type PiiKeyCheck = { revisados: number; ilegibles: number };

/**
 * Por qué existe. El 2026-10-06 en TEST el correo de un cliente dejó de descifrarse a media tarde
 * (`unable to authenticate data`) porque la clave maestra ya no era la que lo cifró. Todo lo que
 * manda un mensaje lee la dirección con la misma función, así que ningún canal —Gmail incluido— podía
 * entregar nada, y el único síntoma era un `CONTACT_VALUE_UNREADABLE` en una tabla de intentos.
 *
 * Aquí el síntoma aparece al ARRANCAR y con un texto que dice la causa y el remedio. Es una alarma,
 * no una puerta: tumbar la API por esto convertiría un problema de unos clientes en uno de todos.
 */
@Injectable()
export class PiiKeyCanaryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PiiKeyCanaryService.name);

  constructor(@InjectModel(CustomerContactMethodModel) private readonly contactMethods: typeof CustomerContactMethodModel) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const resultado = await this.comprobar();
      if (resultado.ilegibles > 0) {
        this.logger.error(
          `CLAVE DE CIFRADO: ${resultado.ilegibles} de ${resultado.revisados} contactos recientes NO se pueden descifrar. ` +
            'Casi seguro que NOTIFICATION_TOKEN_ENCRYPTION_KEY cambió: ningún código, aviso ni recuperación de PIN llegará a esos clientes. ' +
            'Restaura la clave anterior o añádela a NOTIFICATION_TOKEN_ENCRYPTION_PREVIOUS_KEYS (separadas por coma).',
        );
      }
    } catch (error) {
      this.logger.warn(`No se pudo comprobar la clave de cifrado al arrancar: ${(error as Error).message}`);
    }
  }

  async comprobar(): Promise<PiiKeyCheck> {
    const filas = await this.contactMethods.findAll({
      attributes: ['id', 'contactValueEncrypted'],
      order: [['id', 'DESC']],
      limit: MUESTRA,
      raw: true,
    });
    const cifradas = filas.filter((fila) => fila.contactValueEncrypted);
    let ilegibles = 0;
    for (const fila of cifradas) {
      if ((await decryptSecretEnvelope(fila.contactValueEncrypted)) === null) ilegibles += 1;
    }
    return { revisados: cifradas.length, ilegibles };
  }
}
