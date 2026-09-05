/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system declara la configuración del servicio de archivos por adaptadores intercambiables.
 */
import { z } from 'zod';
import { optionalBooleanEnvSchema, optionalNonEmptyStringEnvSchema, optionalUrlEnvSchema } from './env.primitives.js';

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

  /**
   * MinIO POR DEFECTO. Quien quiera disco tiene que escribir `local` a mano.
   *
   * Antes el defecto era `local`, y el defecto es lo que acaba corriendo: un despliegue que no
   * declara nada escribía en el disco del contenedor, que en Coolify se destruye en cada
   * publicación. `minio` de oficio invierte esa carga — si el almacén no está configurado, el
   * proceso NO ARRANCA (`FileAdapterRegistry.onModuleInit`) en vez de aceptar archivos que nadie
   * volverá a ver.
   */
  FILE_STORAGE_ADAPTER: z.enum(['minio', 'local']).default('minio'),

  /**
   * Configuración del almacén MinIO para ESTE servicio.
   *
   * Todas opcionales a propósito: cuando faltan se cae a las `STORAGE_S3_*`, que es el caso normal
   * porque hay UN MinIO por entorno y la evidencia KYC ya vive ahí. Declararlas sólo tiene sentido
   * para apuntar este servicio a otro bucket o a otro almacén; ver `FileAdapterConfigService`.
   */
  // Los primitivos que tratan `""` como ausente, y no como valor inválido: en Docker un `ARG` que
  // nadie pasa llega como cadena vacía, y con `z.string().optional()` eso tumba el arranque por una
  // variable que el operador dejó en blanco A PROPÓSITO para heredar la de arriba.
  FILE_STORAGE_MINIO_ENDPOINT: optionalUrlEnvSchema,
  FILE_STORAGE_MINIO_PUBLIC_ENDPOINT: optionalUrlEnvSchema,
  FILE_STORAGE_MINIO_BUCKET: optionalNonEmptyStringEnvSchema,
  FILE_STORAGE_MINIO_REGION: optionalNonEmptyStringEnvSchema,
  FILE_STORAGE_MINIO_ACCESS_KEY_ID: optionalNonEmptyStringEnvSchema,
  FILE_STORAGE_MINIO_SECRET_ACCESS_KEY: optionalNonEmptyStringEnvSchema,
  FILE_STORAGE_MINIO_FORCE_PATH_STYLE: optionalBooleanEnvSchema,

  /**
   * Prefijo común de todas las claves de este servicio dentro del bucket.
   *
   * Comparte bucket con la evidencia KYC —un solo almacén que operar— y el prefijo es lo que
   * mantiene los dos flujos distinguibles en un `mc ls`, y lo que permite una política de
   * retención distinta para cada uno sin mover un objeto.
   */
  FILE_STORAGE_MINIO_KEY_PREFIX: z.string().default('files'),

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

  /**
   * EXPEDIENTES: la carpeta de archivos de un sujeto, con permisos y bitácora.
   *
   * `EXPEDIENTES_ENABLED=false` deja los endpoints en 503 y apaga los ganchos del onboarding. Es la
   * salida de emergencia: si el catálogo diera problemas, el alta sigue funcionando —los archivos
   * se guardan igual, en `evidence_documents` y en el almacén— y sólo deja de haber explorador.
   */
  EXPEDIENTES_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  EXPEDIENTES_KEY_PREFIX: z.string().default('expedientes'),
  EXPEDIENTES_UPLOAD_TICKET_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(600),
  EXPEDIENTES_TRASH_RETENTION_DAYS: z.coerce.number().int().positive().max(3650).default(90),
  // Topes del árbol: una profundidad sin límite hace irresoluble la herencia de permisos, y una
  // carpeta con cien mil hijos convierte listarla en una descarga.
  EXPEDIENTES_MAX_DEPTH: z.coerce.number().int().positive().max(32).default(8),
  EXPEDIENTES_MAX_CHILDREN: z.coerce.number().int().positive().max(20000).default(2000),

  // Sólo se leen con `FILE_STORAGE_ADAPTER=local`.
  FILE_STORAGE_LOCAL_ROOT: z.string().min(1).default('var/files'),
  FILE_STORAGE_LOCAL_BASE_URL: z.string().url().default('http://localhost:3005/api/v1/files'),

  // Firma HMAC de los tickets de subida locales: el equivalente al prefirmado SigV4 de S3. Sin
  // secreto no se emiten tickets; la escritura directa por multipart sigue disponible. En producción
  // `env-cross-checks.ts` lo exige con longitud mínima y distinto del secreto de JWT.
  FILE_STORAGE_LOCAL_URL_SECRET: z.string().optional(),
};
