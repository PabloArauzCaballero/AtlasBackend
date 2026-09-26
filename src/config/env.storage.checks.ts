/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza evita que las subidas del cliente fallen por una dirección que sólo existe en el equipo del desarrollador.
 * @system valida que el endpoint PÚBLICO del almacén de evidencia no apunte a localhost fuera de desarrollo.
 */
import { z } from 'zod';
import type { RawAppEnv } from './env.schema.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * `STORAGE_S3_PUBLIC_ENDPOINT` es la dirección que viaja en la URL firmada AL TELÉFONO. Con
 * `localhost` funciona en el simulador y falla en cualquier dispositivo real, y el fallo se lee como
 * «no podemos recibir documentos». Fuera de desarrollo y pruebas es un error de configuración, y
 * conviene que muerda al arrancar y no en la primera subida de un cliente.
 */
export function checkStoragePublicEndpoint(data: RawAppEnv, ctx: z.RefinementCtx): void {
  const publicEndpoint = data.STORAGE_S3_PUBLIC_ENDPOINT?.trim();
  if (!publicEndpoint || data.NODE_ENV === 'development' || data.NODE_ENV === 'test') return;

  let host: string;
  try {
    host = new URL(publicEndpoint).hostname.toLowerCase();
  } catch {
    return; // El formato ya lo valida el esquema base.
  }
  if (LOCAL_HOSTS.has(host)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['STORAGE_S3_PUBLIC_ENDPOINT'],
      message:
        `STORAGE_S3_PUBLIC_ENDPOINT apunta a ${host}: esa dirección viaja en la URL firmada al teléfono del cliente y sólo ` +
        'existe en esta máquina. Fuera de development/test tiene que ser la dirección pública del almacén.',
    });
  }
}
