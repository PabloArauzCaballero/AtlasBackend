# ADR-0003: Sincronización de logs a MongoDB como visor operativo opcional

- **Estado:** Aceptado
- **Fecha:** 2026-07-16
- **Decisores:** equipo backend
- **Relacionado:** [`log-sync.service.ts`](../../src/modules/log-sync/log-sync.service.ts), [`mongo-logs.controller.ts`](../../src/modules/log-sync/mongo-logs.controller.ts), [`src/config/env.ts`](../../src/config/env.ts) (`MONGO_DB_URL_CONNECTION`), plan 10/10 Fase 3.1

## Contexto

El backend escribe un log de archivo local (`Archivo.log`). El módulo `log-sync`
sigue (tail) ese archivo y sincroniza los fragmentos nuevos a **MongoDB**, donde
`mongo-logs.controller.ts` expone un **visor operativo consultable** (por rango de
offset, arranque, etc.).

La auditoría del plan 10/10 (Fase 3.1) cuestiona esta duplicación **archivo → Mongo**:
en la mayoría de despliegues, la plataforma ya ofrece un pipeline de logs nativo
(CloudWatch, Loki, OpenSearch) a partir de stdout, y mantener Mongo añade una conexión,
almacenamiento y red sin beneficio demostrado. La decisión pendiente era: **retirar
Mongo** o **conservarlo como requisito explícito y acotado**.

## Decisión

Se **conserva** la sincronización a MongoDB como **visor operativo propio y opcional**,
con estas condiciones:

1. **Apagado por defecto y desacoplado del arranque.** Si `MONGO_DB_URL_CONNECTION`
   está vacío, la sincronización no se activa; el backend arranca y funciona sin Mongo.
   Ningún camino crítico depende de Mongo.
2. **Es un visor secundario, no la fuente de verdad de logs.** La fuente primaria sigue
   siendo el log de aplicación / stdout que consume la plataforma. Mongo es una
   comodidad operativa consultable para el portal interno, no el sistema de retención de
   registros de auditoría (esos viven en PostgreSQL).
3. **Retención acotada.** El destino Mongo debe tener una política de retención/TTL para
   que no crezca sin límite. **Actualización 2026-07-21 (hardening O-A1/DB-M5):** además de
   la política de infraestructura, `log-sync.service.ts` ahora crea un **índice TTL** sobre
   `capturedAt` (retención por defecto 30 días, constante local) — el TTL deja de depender
   solo de que alguien lo configure fuera. No se conserva historial indefinido.
4. **Sin PII ni secretos.** Aplica la misma política de no-PII/no-secretos que el resto de
   logs de aplicación (ver [`SECURITY.md`](../../SECURITY.md) y plan Fase 3.2).
   **Actualización 2026-07-21:** se aplica una redacción activa por patrón
   (`redactSensitiveText`) tanto en el logger de archivo (`AppFileLogger`) como en el
   `content` antes de insertar en Mongo — segunda capa defensiva, no solo política.

**Formato del log (actualización 2026-07-21, O-A1):** `Archivo.log` (y por tanto el `content`
sincronizado a Mongo) pasó de texto plano a **JSON estructurado por línea**
(`{ ts, level, context, correlationId, traceId, message, stack? }`), con el `correlationId` del
request (vía `AsyncLocalStorage`) y el `traceId` del span OTel activo. El visor de Mongo hace
búsqueda full-text sobre `content` y `log-sync` solo cuenta líneas, así que el cambio de formato
es transparente para ambos. La CONSOLA sigue siendo human-readable.

## Alternativas consideradas

- **Retirar Mongo y depender solo de stdout + plataforma** — es lo más barato y lo
  recomendado por la auditoría en el caso general. Se descarta *por ahora* porque el
  visor consultable propio (independiente del proveedor de plataforma) es un requisito
  operativo del portal interno de Atlas. Queda como la evolución preferida si ese
  requisito desaparece.
- **Mover el visor a OpenSearch/Loki** — sustituye Mongo por otro almacén indexado. Es
  una mejora válida a futuro, pero no aporta sobre Mongo mientras el volumen sea el
  actual y el visor ya esté implementado sobre Mongo.

## Consecuencias

- **Positivas:** visor de logs consultable e independiente de la plataforma; opcional y
  sin impacto en el arranque; costo cero cuando está apagado.
- **Negativas / costos asumidos:** cuando está activo, es una conexión y un almacén
  extra que operar y del que hacer backup/retención; hay una ruta de datos duplicada
  (archivo + Mongo) que mantener alineada.
- **Condición de revisión (trigger):** retirar Mongo (volviendo a stdout + plataforma)
  en cuanto se cumpla **cualquiera**: (a) el requisito de un visor propio deja de existir;
  (b) la plataforma de despliegue provee un visor equivalente aceptable para operaciones;
  (c) el costo/retención de Mongo supera el valor del visor medido en uso real.
