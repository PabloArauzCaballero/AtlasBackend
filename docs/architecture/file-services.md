# Servicio de archivos por adaptadores

Estructura de puertos y adaptadores para subir, verificar y almacenar archivos.
Código: [`src/common/files/`](../../src/common/files/).

## Los dos ejes

Un archivo pasa por dos decisiones **independientes**, y cada una tiene su propio puerto y su propia
variable de entorno:

| Eje | Pregunta | Puerto | Variable |
|---|---|---|---|
| **Ingesta** | ¿cómo llegan los bytes al proceso? | `FileIngestAdapter` | `FILE_INGEST_ADAPTER` |
| **Almacén** | ¿dónde quedan? | `FileStorageAdapter` | `FILE_STORAGE_ADAPTER` |

Mezclarlos en una sola interfaz obligaría a reimplementar la ingesta cada vez que cambia el destino.
Separarlos es lo que permite que añadir Cloudinary no toque nada del camino multipart.

```
HTTP multipart ──▶ MulterIngestAdapter ──┐
                                          ├──▶ FileService (verifica) ──▶ FileStorageAdapter ──▶ disco / objetos
ticket firmado ──▶ el cliente sube ──────┘        │
                                                   └── tamaño · allowlist · firma mágica · SHA-256 · antimalware
```

### Adaptadores disponibles

- **Ingesta:** `multer` (multipart a través de la API, bytes en memoria).
- **Almacén:** `local` (disco del nodo).

Cloudinary y S3 se suman implementando `FileStorageAdapter` y añadiendo su nombre al enum de
[`env.files.schema.ts`](../../src/config/env.files.schema.ts). Ningún consumidor cambia.

## Toda la verificación vive en un solo sitio

[`FileService.verify`](../../src/common/files/file.service.ts) es el único lugar donde se decide si
un archivo es aceptable, y corre **igual venga por multipart o por ticket firmado**. El orden no es
casual: primero lo barato y local, el antimalware al final porque es lo más caro y no tiene sentido
pagarlo por un archivo que ya falló el tipo.

| # | Comprobación | Motivo de rechazo |
|---|---|---|
| 1 | No está vacío | `FILE_EMPTY` |
| 2 | No excede `FILE_UPLOAD_MAX_BYTES` | `FILE_TOO_LARGE` |
| 3 | El tipo declarado está en la allowlist | `FILE_CONTENT_TYPE_NOT_ALLOWED` |
| 4 | Los primeros bytes respaldan el tipo declarado | `FILE_CONTENT_TYPE_MISMATCH` |
| 5 | `clamd` no lo marca (o el escáner está apagado) | `FILE_MALWARE_DETECTED` / `FILE_SCAN_UNAVAILABLE` |

La tabla de firmas mágicas vive en
[`file-content-type.util.ts`](../../src/common/files/file-content-type.util.ts) y la **comparte** el
flujo de evidencia KYC sobre S3: dos tablas habrían permitido que un tipo quedara verificado en un
camino y sin verificar en el otro.

Un tipo declarado en `FILE_UPLOAD_ALLOWED_MIME_TYPES` sin firma mágica conocida **impide arrancar**
(`FileAdapterRegistry.onModuleInit`), en vez de admitirse sin verificación.

## El almacén local no es una versión relajada

"Probar en local" no significa "probar sin garantías". `LocalFileStorageAdapter`:

- **impone la ruta** `tenant/owner/categoría/uuid.ext`; el nombre que envía el cliente nunca se
  reutiliza y cada segmento se reduce a `[A-Za-z0-9_-]`;
- **rechaza claves fuera de la raíz** (`FILE_STORAGE_KEY_OUTSIDE_ROOT`), lo que impide que un
  endpoint de descarga sirva cualquier archivo del host;
- **escribe en dos pasos** (temporal + `rename`) y con permisos `0600`;
- **firma los tickets de subida** con HMAC-SHA256 y vencimiento, atando `Content-Type` y
  `Content-Length` —el equivalente local del prefirmado SigV4 que usa S3, en
  [`local-signature.util.ts`](../../src/common/files/local-signature.util.ts).

Sin `FILE_STORAGE_LOCAL_URL_SECRET` no se emiten tickets (503 explícito); la subida multipart sigue
funcionando. El secreto **no es obligatorio para arrancar** —exigirlo dejaría sin arrancar a un
despliegue que solo usa multipart— pero si se define debe tener 32+ caracteres y ser distinto de
`JWT_ACCESS_TOKEN_SECRET`.

> En producción, `FILE_STORAGE_ADAPTER=local` apunta al disco del nodo: **no es durable ni
> replicado**. Es una opción válida para desarrollo y despliegues de una sola pieza; para producción
> real conviene el adaptador de objetos en cuanto exista.

## Qué NO cambió

El flujo de **evidencia documental KYC** de [`src/common/storage/`](../../src/common/storage/) sigue
intacto: URL prefirmada de S3, el cliente sube directo al bucket y el backend descarga después para
recalcular el SHA-256, comprobar bytes mágicos y escanear. Lo consume `customer-onboarding` y
conserva sus mismas garantías y sus mismas variables `STORAGE_S3_*`.

Este módulo es una vía **alterna y aditiva**, no un reemplazo.

## Configuración

```dotenv
FILE_INGEST_ADAPTER=multer
FILE_STORAGE_ADAPTER=local
FILE_UPLOAD_MAX_BYTES=15728640
FILE_UPLOAD_MAX_FILES=5
FILE_UPLOAD_ALLOWED_MIME_TYPES=image/jpeg,image/png,application/pdf
FILE_UPLOAD_URL_TTL_SECONDS=300
FILE_STORAGE_LOCAL_ROOT=var/files
FILE_STORAGE_LOCAL_BASE_URL=http://localhost:3005/api/v1/files
FILE_STORAGE_LOCAL_URL_SECRET=
```

Tipos con firma mágica conocida: `image/jpeg`, `image/png`, `application/pdf`, `image/gif`,
`image/webp`.

## Uso desde un módulo de dominio

`FilesModule` exporta `FileService` y `MulterModule` ya configurado con los límites del entorno, así
que un controlador no puede relajarlos por su cuenta:

```ts
@Post('documents')
@UseInterceptors(FileInterceptor('file'))
async upload(@UploadedFile() file: unknown, @CurrentUser() user: AuthenticatedUser) {
  const incoming = this.files.normalizeIncoming(file);
  return this.files.storeOrThrow({ tenantId: user.tenantId, ownerId: user.id, category: 'contract' }, incoming);
}
```

`storeOrThrow` traduce cada rechazo a su excepción HTTP (413, 415 o 400). `store` devuelve la unión
discriminada si el llamador prefiere decidir por su cuenta.

## Pruebas

`test/unit/files/` — 57 pruebas: firma y verificación de tickets, guardia anti-traversal, traducción
de multer, y la cadena completa de verificación del servicio.
