<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/rules/. Lo que edites aca se pierde. -->

# 96 — Backend

El backend ya tiene contratos, patrones y convenciones. **La obligación por defecto es encontrarlos
y seguirlos.** Inventar una pieza paralela porque no buscaste la existente es el defecto más caro
de este sistema: duplica la verdad y la deja desincronizada.

## 96.1 Buscar antes de crear

1. **Antes de agregar un endpoint**, localizá el controlador o router existente del recurso.
2. **Antes de agregar un DTO o esquema**, localizá el contrato de petición y respuesta existente.
3. **Antes de agregar un servicio o repositorio**, ubicá el patrón arquitectónico real del proyecto
   y seguilo. Ver `native-code-patterns`.
4. **Antes de agregar un evento, cola o job**, verificá si ya existe el equivalente.
5. **Antes de integrar un proveedor nuevo** (medios, correo, notificaciones, mapas), reusá el
   pipeline existente. Un segundo proveedor para lo mismo exige decisión registrada.
6. Si hay dos implementaciones posibles, elegí la **coherente con el patrón ya presente** y dejá
   constancia. Ver `anti-hallucination-guard`.

## 96.2 Validación

1. **Toda mutación se valida en el servidor.** Sin excepción, aunque el cliente ya valide.
2. **Lista blanca de campos** en la entrada. Los campos no declarados se rechazan, no se ignoran
   en silencio.
3. **Los tipos no validan**: en el borde del sistema, la validación es en tiempo de ejecución.
   Ver `typescript-standards`.
4. La entrada inválida devuelve un error del contrato, nunca un 500.

## 96.3 Transacciones y concurrencia

1. **Toda transición de estado con riesgo de concurrencia es atómica.** Si se lee y después se
   escribe, hay una carrera hasta que demuestres lo contrario.
2. **La precondición va en la escritura**, no en un `if` previo: el `UPDATE` incluye la condición
   que lo hace válido.
3. **Toda operación que el cliente puede reintentar es idempotente**, con clave de idempotencia
   cuando corresponde.
4. **Los efectos secundarios se disparan después del commit**, no dentro de la transacción.
5. **El reintento automático solo ante errores reintentables** declarados. Reintentar a ciegas
   duplica efectos.
6. Ver `concurrency-and-locking` y `state-machines-workflows`.

## 96.4 Contratos y compatibilidad

1. **Mantené la compatibilidad de los contratos existentes, o versioná explícitamente.**
   Romper un contrato en silencio está prohibido.
2. **Todo cambio de contrato se refleja en la documentación de la API** en el mismo trabajo.
   Ver `api-openapi-docs`.
3. **Un cambio que rompe un contrato consumido por otro repo** exige coordinación y orden de
   despliegue. Ver `github-multirepo-coordination`.
4. **El contrato de errores es parte del contrato**: los códigos de error que el cliente
   distingue son estables y están documentados. Ver `error-handling-contract`.
5. **Prohibido devolver `200` con un cuerpo de error.** El estado HTTP es parte de la semántica.

## 96.5 Autorización y datos expuestos

1. **La interfaz nunca es barrera de autorización** (regla 95.6.1). Todo endpoint valida por sí mismo.
2. **Verificación a nivel de objeto en cada endpoint** que lee o muta un recurso identificado.
3. **No devuelvas más datos personales de los que esa vista necesita.** La respuesta se diseña por
   vista, no por comodidad del ORM.
4. **En sistemas multi-organización**, toda consulta filtra por el contexto de la organización.
   Las rutas agnósticas son una excepción **declarada**, no un olvido. Ver `multi-tenancy`.
5. Ver `authz-access-control` y la regla 90.

## 96.6 Listados y búsqueda

1. **Todo listado tiene paginación**, con filtros y ordenamiento coherentes con el patrón del
   proyecto. Prohibido devolver una colección sin límite.
2. **El ordenamiento es determinista**: incluí un desempate estable o la paginación se vuelve
   inconsistente entre páginas.
3. **El campo de ordenamiento se resuelve por lista blanca**, nunca por interpolación de la entrada.
4. **Toda búsqueda se normaliza** (acentos, mayúsculas) y se respalda con un índice justificado por
   plan de consulta o razonamiento documentado.
5. **Las búsquedas de personas no exponen datos sin base legal verificada** (regla 90.2.8).
6. Ver `search-and-filtering` y `postgresql-advanced`.

## 96.7 Trabajo asíncrono

1. **Notificaciones, correos e integraciones son idempotentes** y toleran fallo parcial:
   que falle un canal no puede abortar el resto ni duplicar los que ya salieron.
2. **Los eventos que deben ocurrir sí o sí se publican con el cambio en la misma transacción**
   (patrón outbox), no con una llamada dentro del handler.
3. **Todo consumidor es idempotente**: la entrega es al menos una vez.
4. **Todo job tiene timeout, política de reintento y visibilidad** de su último éxito.
5. **El contexto de organización y de actor viaja con el job.** Un job sin contexto filtra datos.
6. Ver `async-messaging-events`, `background-jobs-scheduling` y `notifications-delivery`.

## 96.8 Observabilidad

1. **Todo error registrado lleva identificador de correlación** para poder cruzarlo con el cliente.
2. **Prohibido registrar datos de personas** (regla 90.2.1).
3. **Toda operación sensible deja rastro de auditoría** (regla 90.2.7).
4. Ver `backend-observability`.

## 96.9 Skills relacionadas

`backend-development` · `nestjs-development` · `database-design` · `error-handling-contract` ·
`concurrency-and-locking` · `state-machines-workflows` · `authz-access-control` · `multi-tenancy` ·
`api-openapi-docs` · `search-and-filtering` · `postgresql-advanced` · `async-messaging-events` ·
`background-jobs-scheduling` · `notifications-delivery` · `backend-observability` ·
`native-code-patterns` · `anti-hallucination-guard`
