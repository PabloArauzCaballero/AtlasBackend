/**
 * @file Alta o refresco de un token de dispositivo en `device_tokens`.
 * @business Un teléfono avisa sólo a la cuenta que lo registró la última vez, no a todas las que pasaron por él.
 * @system Escritura acotada a la tabla de tokens; el repositorio de notificaciones delega aquí.
 */
import { Op } from 'sequelize';
import { lastCharacters } from '../../../../common/utils/crypto/hash.util.js';
import { encryptSecretEnvelope } from '../../../../common/utils/crypto/envelope-encryption.util.js';
import { DeviceTokenModel } from '../../../../database/models/index.js';
import { UpsertDeviceTokenDto } from '../../notifications.schemas.js';
import { deviceTokenFingerprint } from './device-token-fingerprint.js';

/**
 * El mismo token en dos clientes es el mismo teléfono: si A cerró sesión y B entró, los push de A
 * (pago confirmado, KYC) llegarían al teléfono de B. Por eso, antes de dejarlo activo para este
 * cliente, se apaga en cualquier otro cliente del tenant que lo tuviera activo.
 */
export async function upsertDeviceTokenRow(
  deviceTokenModel: typeof DeviceTokenModel,
  tenantId: string,
  customerId: string,
  body: UpsertDeviceTokenDto,
): Promise<DeviceTokenModel> {
  const tokenHash = deviceTokenFingerprint(body.token);
  const now = new Date();
  await deviceTokenModel.update(
    { isActive: false, updatedAtValue: now },
    { where: { tenantId, tokenHash, isActive: true, customerId: { [Op.ne]: customerId } } as never },
  );
  const existing = await deviceTokenModel.findOne({ where: { tenantId, customerId, platform: body.platform, tokenHash } });
  if (existing) {
    existing.isActive = true;
    existing.lastSeenAt = now;
    existing.tokenEncrypted = await encryptSecretEnvelope(body.token);
    existing.tokenLast4 = lastCharacters(body.token, 4);
    existing.deviceId = body.deviceId ?? existing.deviceId;
    existing.updatedAtValue = now;
    await existing.save();
    return existing;
  }
  return deviceTokenModel.create({
    tenantId,
    customerId,
    platform: body.platform,
    tokenHash,
    tokenEncrypted: await encryptSecretEnvelope(body.token),
    tokenLast4: lastCharacters(body.token, 4),
    deviceId: body.deviceId ?? null,
    isActive: true,
    lastSeenAt: now,
    createdAtValue: now,
    updatedAtValue: now,
  });
}
