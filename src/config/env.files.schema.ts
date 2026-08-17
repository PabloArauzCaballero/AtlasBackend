/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system declara la configuración del servicio de archivos por adaptadores intercambiables.
 */
import { z } from 'zod';

/**
 * Servicio de archivos con estructura de puertos y adaptadores (`src/common/files`).
 *
 * Son DOS ejes independientes —cómo llegan los bytes y dónde quedan— para que cambiar el destino no
 * obligue a reimplementar la ingesta. Bloque propio, como el de base de datos y el de trabajos de
 * fondo: se compone en `envBaseSchema` con un spread, así que para quien lee `env.X` no cambia nada.
 *
 * NO sustituye a `STORAGE_S3_*`: la evidencia documental KYC conserva su camino prefirmado, con sus
 * mismas garantías. Ver `docs/architecture/file-services.md`.
 */
export const filesEnvShape = {
  FILE_INGEST_ADAPTER: z.enum(['multer']).default('multer'),
  FILE_STORAGE_ADAPTER: z.enum(['local']).default('local'),

  FILE_UPLOAD_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(100 * 1024 * 1024)
    .default(15 * 1024 * 1024),
  FILE_UPLOAD_MAX_FILES: z.coerce.number().int().positive().max(50).default(5),

  // Solo se admiten tipos con firma mágica conocida; `FileAdapterRegistry` falla al arrancar si se
  // declara uno que el backend no sabe verificar, en vez de aceptarlo a ciegas.
  FILE_UPLOAD_ALLOWED_MIME_TYPES: z.string().min(1).default('image/jpeg,image/png,application/pdf'),
  FILE_UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(300),

  FILE_STORAGE_LOCAL_ROOT: z.string().min(1).default('var/files'),
  FILE_STORAGE_LOCAL_BASE_URL: z.string().url().default('http://localhost:3005/api/v1/files'),

  // Firma HMAC de los tickets de subida locales: el equivalente al prefirmado SigV4 de S3. Sin
  // secreto no se emiten tickets; la escritura directa por multipart sigue disponible. En producción
  // `env-cross-checks.ts` lo exige con longitud mínima y distinto del secreto de JWT.
  FILE_STORAGE_LOCAL_URL_SECRET: z.string().optional(),
};
