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
- **Almacén:** `minio` **(por defecto)** — cualquier almacén compatible con S3; `local` (disco del
  nodo), sólo para desarrollo.

El valor de serie es `minio` a propósito. Antes lo era `local`, y un despliegue que olvidara
declarar la variable guardaba el carnet y la selfie de una persona en el disco de un contenedor:
se perdían en el siguiente despliegue, sin error y sin aviso. Que el defecto sea el almacén durable
convierte ese olvido en una configuración incompleta que falla al arrancar, en vez de en una
pérdida de datos que nadie nota hasta que hace falta el documento.

Cloudinary u otro destino se suman implementando `FileStorageAdapter` y añadiendo su nombre al enum
de [`env.files.schema.ts`](../../src/config/env.files.schema.ts). Ningún consumidor cambia.

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
FILE_STORAGE_ADAPTER=minio
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

## Sobre este servicio: el expediente

Un archivo guardado no es todavía un expediente. `FileService` responde «¿esto se puede guardar y
dónde quedó?»; no responde «¿de quién es?», «¿quién puede verlo?» ni «¿quién lo abrió?». Esas tres
las contesta [`src/modules/expedientes/`](../../src/modules/expedientes/), que se apoya en este
servicio para los bytes y añade encima:

- un **árbol por sujeto** con ruta materializada (`expediente_nodos`), donde el onboarding deja lo
  que sube el cliente ya ordenado en `auth` y `extractos`;
- **autorización por carpeta** (`expediente_concesiones`), heredada hacia abajo, que es lo que
  `@Roles(...)` no sabe expresar: «este analista, esta carpeta, por este motivo»;
- una **bitácora append-only** (`expediente_actividad`) que incluye las LECTURAS, no sólo los
  cambios — en una carpeta con la cara y el carnet de alguien, «quién lo abrió» es la pregunta que
  se hace después;
- un **manifiesto firmado** al enviarse la solicitud: la foto de qué había en ese momento.

El expediente **nunca guarda datos que ya vivan en la base**. Los contactos y las referencias de una
persona se componen al pedirlos y se enmascaran salvo permiso explícito; escribirlos como un JSON en
el almacén habría creado una segunda copia de datos personales que envejece sola, que no responde a
una rectificación y que hay que acordarse de borrar aparte.

Detalle operativo en [`docs/operations/expedientes.md`](../operations/expedientes.md) y la decisión
en [ADR-0010](../adr/0010-expediente-de-archivos-por-sujeto.md).

## Pruebas

`test/unit/files/` — 57 pruebas: firma y verificación de tickets, guardia anti-traversal, traducción
de multer, y la cadena completa de verificación del servicio.

`test/unit/expedientes/` — 27 pruebas: la escala de niveles, la resolución de acceso efectivo
(herencia, revocación y los dos techos) y las reglas del árbol.
