/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza evita operar con parámetros inseguros o ambiguos.
 * @system valida las combinaciones inválidas de configuración del servicio de archivos.
 */
import { z } from 'zod';
import type { RawAppEnv } from './env.schema.js';

/**
 * Almacén local de archivos: el ticket de subida es una URL firmada con HMAC, así que su secreto es
 * lo único que separa "el servidor impone la ruta y el tamaño" de "cualquiera escribe donde quiera".
 *
 * NO se exige su presencia, ni siquiera en producción: sin secreto el adaptador se niega a emitir
 * tickets (503 `FILE_STORAGE_LOCAL_URL_SECRET_MISSING`), que ya es la postura cerrada correcta y es
 * el mismo criterio con el que `STORAGE_S3_*` vacío deja los endpoints en 503. Exigirlo aquí haría
 * que un despliegue que solo usa la subida multipart dejara de arrancar por una capacidad que no
 * utiliza.
 *
 * Lo que sí se valida es su CALIDAD cuando existe: un secreto corto o reutilizado da una falsa
 * sensación de firma, y ese es justamente el fallo que no se manifestaría en runtime.
 */
export function checkFileStorage(data: RawAppEnv, ctx: z.RefinementCtx): void {
  const secret = data.FILE_STORAGE_LOCAL_URL_SECRET?.trim() ?? '';
  if (secret.length === 0) return;

  if (secret.length < 32) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['FILE_STORAGE_LOCAL_URL_SECRET'],
      message: 'FILE_STORAGE_LOCAL_URL_SECRET debe tener al menos 32 caracteres: firma los permisos de subida del almacén local.',
    });
  }

  if (secret === data.JWT_ACCESS_TOKEN_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['FILE_STORAGE_LOCAL_URL_SECRET'],
      message: 'FILE_STORAGE_LOCAL_URL_SECRET debe ser distinto de JWT_ACCESS_TOKEN_SECRET: comprometer uno comprometería ambos usos.',
    });
  }
}
