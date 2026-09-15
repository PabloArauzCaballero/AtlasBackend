/**
 * @file Datos extra y visibilidad del push que decide el propio mensaje.
 * @business Tocar el aviso de una campaña abre la pantalla que la campaña indicó, y el aviso se ve
 *   aunque la app esté cerrada: un push de campaña que llega sólo como datos no lo ve nadie.
 * @system El mensaje puede traer `payload.pushData` (pares texto→texto) y `payload.visible`. Todo lo
 *   demás del payload NO viaja al dispositivo: el `data` de FCM/APNs se lee en claro en el teléfono.
 */

/**
 * El canal de Android donde se pinta el aviso. Tiene que coincidir con el que crea la app
 * (`CANAL_AVISOS` en `consumer-app/src/device/push.ts`): un aviso a un canal inexistente se descarta
 * sin rastro.
 */
export const ANDROID_PUSH_CHANNEL = 'default';

const RESERVED = new Set(['notificationMessageId', 'channel', 'correlationId']);

export function extraPushData(payload: Record<string, unknown> | null | undefined): Record<string, string> {
  const raw = payload?.pushData;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (RESERVED.has(key) || typeof value !== 'string' || value.length === 0) continue;
    data[key] = value.slice(0, 300);
  }
  return data;
}

export function wantsVisiblePush(payload: Record<string, unknown> | null | undefined): boolean {
  return payload?.visible === true;
}
