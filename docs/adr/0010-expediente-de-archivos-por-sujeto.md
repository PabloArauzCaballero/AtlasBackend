# ADR-0010: Un expediente de archivos por sujeto, con permisos por carpeta

- **Estado:** Aceptado
- **Fecha:** 2026-09-04
- **Decisores:** plataforma / riesgo / cumplimiento
- **Relacionado:** [ADR-0004](0004-kms-envelope-encryption.md), [servicio de archivos](../architecture/file-services.md), [operación del expediente](../operations/expedientes.md)

## Contexto

Los archivos de una persona existían, pero no formaban un conjunto. La evidencia de identidad vivía
en `evidence_documents`, los extractos en `bank_statement_reviews`, y lo que dejaba el Motor en sus
propias tablas. Cada uno con su clave de objeto, su tipo de dueño y su forma de autorizar.

Tres consecuencias medibles de eso:

1. **Nadie podía ver el conjunto.** Para revisar un caso había que abrir tres pantallas y saber de
   antemano qué buscar en cada una. En la práctica se decidía sin abrir los documentos.
2. **La autorización era del endpoint, no del archivo.** `@Roles(...)` dice qué ROL entra a una
   ruta; no sabe decir «este analista puede ver la carpeta de este cliente porque lleva su caso».
   El resultado es el permiso más ancho posible: quien podía ver un carnet podía ver todos.
3. **No había forma de afirmar qué había al decidir.** Los objetos se podían añadir o quitar después
   sin que quedara rastro de qué existía en el momento de la decisión.

## Decisión

Añadimos un **expediente por sujeto** (`expedientes` + `expediente_nodos`): un árbol de carpetas con
ruta materializada que referencia los objetos que ya existen, con autorización por carpeta
(`expediente_concesiones`), bitácora append-only (`expediente_actividad`) y un manifiesto firmado
que se escribe al enviarse la solicitud.

Tres restricciones que definen la decisión tanto como lo anterior:

- **No copia bytes.** Un nodo apunta a la clave de objeto que ya escribió el flujo de origen.
  Duplicar los archivos habría creado dos verdades que divergen y habría doblado lo que hay que
  borrar ante una solicitud de supresión.
- **No genera datos que ya estén en la base.** Los contactos y referencias del cliente se componen
  al pedirlos desde sus tablas y se enmascaran salvo permiso explícito. El único objeto que este
  módulo escribe es el `manifest.json`.
- **No sirve nada por URL pública.** Los bytes salen por la API autenticada, y cada acceso se
  registra.

## Alternativas consideradas

- **Dejar cada flujo con sus archivos y hacer una pantalla que los junte.** Es lo más barato y es lo
  que ya fallaba: la pantalla puede unir la lista, pero no puede dar permisos por carpeta, ni
  registrar quién abrió qué, ni afirmar qué había en el momento de decidir. El problema no era de
  presentación.
- **Un `contactos.json` generado en el almacén, junto a los documentos.** Era la propuesta inicial y
  se descartó: crea una segunda copia de datos personales que envejece sola, que no responde a una
  rectificación en la base y que hay que acordarse de borrar aparte. La base es la dueña de esos
  datos; el expediente los muestra, no los guarda.
- **Un servicio de archivos aparte, tipo gestor documental externo.** Añade un sistema más que
  autenticar, auditar y purgar, para un volumen que hoy cabe de sobra en el bucket que ya existe.
  Se revisará si aparecen consumidores fuera de este ecosistema.
- **ACL por archivo en vez de por carpeta.** Más preciso y peor: compartir la evidencia de un caso
  obligaría a conceder documento por documento, y en la práctica se acabaría concediendo el nivel
  ancho de siempre para no repetir el trámite.

## Consecuencias

- **Positivas:**
  - Quien revisa un caso llega al material desde donde decide, y el material está ordenado sin que
    nadie lo mueva a mano.
  - El acceso a datos personales pasa de ser una propiedad del rol a ser una decisión registrada,
    con motivo, sobre una carpeta concreta.
  - Una solicitud de supresión tiene un punto de entrada: `purgarPorSujeto` recorre el expediente y
    borra los bytes que ningún otro flujo referencia.
  - El manifiesto convierte «esto es lo que había» en algo comprobable.

- **Negativas / costos asumidos:**
  - Una tabla más que consultar por cada archivo, y un conteo de referencias antes de borrar bytes
    (`ObjectRefCounterService`) que ante la duda **no borra**: preferimos un objeto huérfano de unos
    kilobytes a un hueco en la evidencia de una decisión.
  - Los clientes anteriores a esta función necesitan un relleno histórico, y sus expedientes quedan
    **sin manifiesto** a propósito: fabricar la foto de un momento que nadie observó sería inventar
    evidencia con fecha falsa. La pantalla lo dice.
  - `EXPEDIENTES_ENABLED=false` deja los endpoints en 503 y apaga los ganchos: el interruptor existe
    porque el módulo se enchufa a flujos que no pueden fallar por él.

- **Condición de revisión (trigger):** si la resolución de acceso efectivo (herencia por prefijo de
  ruta) supera los 50 ms de p95, o si un expediente llega a `EXPEDIENTES_MAX_CHILDREN` en una
  carpeta, hay que reabrir la forma del árbol — probablemente partiendo las subcarpetas del Motor
  por fecha.
