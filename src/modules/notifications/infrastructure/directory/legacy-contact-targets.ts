/**
 * @file Lectura legada de contactos del cliente para entrega (AT-039, transitorio).
 * @business Es lo que Mensajería hacía antes de tener el directorio por puerto: leer y descifrar los
 *   contactos de Clientes. Se conserva sólo para la construcción sin composición (pruebas, scripts).
 * @system Se retira junto con `CustomerContactMethodModel` del módulo cuando ningún consumidor lo use.
 */
import { Op } from 'sequelize';
import type { CustomerContactMethodModel } from '../../../../database/models/index.js';
import { decryptSecretEnvelope } from '../../../../common/utils/crypto/envelope-encryption.util.js';
import { channelContactType, encryptedValueToString, mergeDeliveryTargets } from '../../notification-delivery-targets.util.js';
import type { DeliveryTarget, NotificationChannel } from '../../notification-types.js';

export async function legacyCustomerContactTargets(
  contactMethodModel: typeof CustomerContactMethodModel,
  tenantId: string,
  customerId: string,
  channel: NotificationChannel,
): Promise<DeliveryTarget[]> {
  const spec = channelContactType(channel);
  if (!spec) return [];
  const rows = await contactMethodModel.findAll({
    where: {
      tenantId,
      customerId,
      contactType: spec.contactType,
      contactValueEncrypted: { [Op.ne]: null },
      deleted: { [Op.ne]: true },
    } as never,
    order: [
      ['isPrimary', 'DESC'],
      ['lastSeenAt', 'DESC'],
      ['id', 'ASC'],
    ],
  });
  const resolvedTargets = await Promise.all(
    rows.map(async (row) => {
      const encrypted = encryptedValueToString(row.contactValueEncrypted as string | Buffer | null);
      const address = await decryptSecretEnvelope(encrypted);
      return address ? [{ kind: spec.kind, address }] : [];
    }),
  );
  return mergeDeliveryTargets(resolvedTargets.flat());
}
