/**
 * @file Implementación del puerto de baja de tokens sobre la tabla `device_tokens`.
 * @business Cierra el circuito que el catálogo de sistemas ya prometía: «`is_active` permite
 *   desactivar tokens que el proveedor push reporta como inválidos, evitando reintentos que degradan
 *   la reputación de envío». Hasta ahora la columna existía y nadie la ponía en `false`.
 * @system Busca por HUELLA, no por el token: la fila guarda `token_hash` y el token cifrado, y la
 *   huella es la única forma de localizarla sin descifrar la tabla entera.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { DeviceTokenModel } from '../../../database/models/index.js';
import { deviceTokenFingerprint } from './persistence/device-token-fingerprint.js';
import type { DeviceTokenRegistryPort } from '../application/ports/device-token-registry.port.js';

@Injectable()
export class SequelizeDeviceTokenRegistryAdapter implements DeviceTokenRegistryPort {
  constructor(@InjectModel(DeviceTokenModel) private readonly deviceTokenModel: typeof DeviceTokenModel) {}

  async deactivate(tokens: string[]): Promise<number> {
    const unique = [...new Set(tokens.filter((token) => token.length > 0))];
    if (unique.length === 0) return 0;

    /*
      Sin acotar por tenant ni por cliente a propósito: cuando Apple responde 410, ese token está
      muerto para TODO el mundo. Si el mismo aparato se registró bajo dos cuentas, las dos filas
      sobran. Se filtra por `isActive` para no reescribir lo ya dado de baja.
    */
    const [affected] = await this.deviceTokenModel.update(
      { isActive: false, updatedAtValue: new Date() },
      { where: { tokenHash: { [Op.in]: unique.map(deviceTokenFingerprint) }, isActive: true } },
    );
    return affected;
  }
}
