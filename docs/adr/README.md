# Architecture Decision Records (ADRs)

Este directorio registra las **decisiones de arquitectura** de AtlasBackend: qué se
decidió, por qué, qué alternativas se descartaron y bajo qué condiciones se
revisaría. Un ADR convierte el conocimiento tribal ("¿por qué el outbox está en
Postgres y no en una cola?") en un activo versionado del proyecto.

## Formato

Cada ADR es un archivo `NNNN-titulo-en-kebab-case.md` con la plantilla de
[`_template.md`](_template.md). Los ADRs son **inmutables una vez aceptados**: si una
decisión cambia, se escribe un ADR nuevo que _supersede_ al anterior y se marca el
viejo como `Superseded by ADR-XXXX` en vez de editarlo.

## Estados

- **Propuesto** — en discusión, aún no vinculante.
- **Aceptado** — decisión vigente.
- **Superado** — reemplazado por un ADR posterior (enlazado).
- **Deprecado** — ya no aplica pero se conserva por trazabilidad.

## Índice

| ADR | Título | Estado | Fase del plan 10/10 |
|-----|--------|--------|---------------------|
| [0001](0001-outbox-en-postgresql.md) | Outbox transaccional en PostgreSQL (no cola dedicada) | Aceptado | 5.3 |
| [0002](0002-redis-solo-en-produccion.md) | Redis obligatorio solo en producción para rate limiting distribuido | Aceptado | Infra/Costo |
| [0003](0003-mongo-log-sync.md) | Sincronización de logs a MongoDB como visor operativo opcional | Aceptado | 3.1 |
| [0004](0004-kms-envelope-encryption.md) | Envelope encryption con proveedor de claves intercambiable (local/KMS) | Aceptado | 3.3 |
| [0005](0005-paginacion-por-cursor.md) | Paginación por cursor como camino por defecto de alto volumen | Aceptado | 5.1 |

## Cómo añadir un ADR

1. Copia [`_template.md`](_template.md) a `NNNN-tu-titulo.md` (siguiente número libre).
2. Rellena contexto, decisión, alternativas y consecuencias.
3. Añade la fila al índice de arriba.
4. Enlázalo desde el código/PR relevante para que la decisión sea descubrible.
