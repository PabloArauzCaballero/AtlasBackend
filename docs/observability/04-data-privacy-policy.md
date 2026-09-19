# Fase 18 — Política de datos en las trazas

AtlasBackend trata identidad (KYC), crédito y datos personales cifrados. El riesgo concreto que
este documento existe para evitar es que **Jaeger se convierta en la copia sin cifrar y sin
control de acceso de la base de datos**: un almacén que se consulta desde una UI, sin las
restricciones por inquilino, sin auditoría de lectura y sin cifrado de PII.

## Datos prohibidos

Nunca, en ningún span, evento, atributo, nombre de span ni recurso:

- Contraseñas, hashes de contraseña, tokens de acceso o de refresco, claves de API, cookies,
  cabeceras `Authorization`.
- Documentos de identidad, números de carnet, nombres, apellidos, teléfonos, correos,
  direcciones.
- Números de cuenta, importes de crédito, límites, saldos, datos de tarjeta.
- Cuerpos de petición o de respuesta, completos o parciales.
- Valores de parámetros SQL, valores almacenados en Redis, contenido de archivos, imágenes.
- Variables de entorno, cadenas de conexión, secretos.
- Cadenas de consulta de URL (`?identifier=`, `?documentNumber=`, `?email=` son reales en este
  backend).
- Mensajes de excepción como descripción de estado del span.

## Datos permitidos

- Método HTTP, **ruta** (sin query), código de estado.
- Nombre de operación de base de datos y **texto** de la sentencia sin valores.
- Comando de Redis sin argumentos.
- Host y puerto de destino de una llamada saliente.
- Identificadores internos opacos: `app.entity.id`, `app.tenant.id`, `app.event.type`.
- Desenlaces de catálogo cerrado: `decision.outcome`, `auth.outcome`, `notification.channel`,
  `risk.decision.source`, `app.job.outcome`.
- Códigos de error estables (`error.type`), nunca su mensaje.

## Cómo se aplica, capa por capa

La política no es una promesa: cada prohibición tiene un mecanismo que la sostiene.

| Riesgo | Mecanismo | Archivo |
| --- | --- | --- |
| Cabeceras con credenciales | **No** se activa `headersToSpanAttributes` | `telemetry.instrumentations.ts` |
| Valores de parámetros SQL | `PgInstrumentation({ enhancedDatabaseReporting: false })` | ídem |
| **Literales incrustados en el SQL** | `redactSqlLiterals` dentro de `RedactingSpanProcessor`, sobre `db.query.text` **y** `db.statement` | `sql-redaction.ts` |
| **Métricas y registros del propio SDK** | `OTEL_METRICS_EXPORTER`/`OTEL_LOGS_EXPORTER` se declaran `none`: sus atributos NO pasan por el saneador de spans | `tracing.ts` |
| **Credencial en una URL firmada de MinIO** | `RedactingSpanProcessor` borra `url.query` y recorta `url.full` | `redacting-span-processor.ts` |
| Valores de Redis | `dbStatementSerializer: (command) => command` | ídem |
| Cuerpo de petición | Ninguna instrumentación de cuerpo está activa | ídem |
| Mensaje de excepción como estado | `recordSpanError` usa un **código estable** | `trace-error.ts` |
| Valor lanzado que no es `Error` | Se sustituye por su código antes de registrarlo | ídem |
| Datos en el payload del outbox | El portador viaja en `metadata_json`, **fuera** del payload, que ya filtra `FORBIDDEN_PAYLOAD_KEYS` | `sequelize-outbox-writer.ts` |
| Nombres de span con identificadores | Los nombres son constantes, no plantillas | `telemetry.constants.ts` |
| Cadena de consulta | `url.query` se borra en el Collector | `otel-collector.config.yml` |
| Cualquier atributo nuevo que se cuele | `attributes/redact` en el Collector | ídem |
| Sondas de salud con ruido | Exclusión en el proceso **y** filtro en el Collector | ambos |

La fila de los literales del SQL no es teórica: se midió. Una sola petición de login publicaba
`… WHERE "identifier_hash" = '2a91be56…'` —el identificador seudonimizado de quien intentaba
entrar— porque Sequelize no usa parámetros ligados en todas sus consultas. La regla del
repositorio ya lo decía para los logs y no se estaba aplicando al canal nuevo.

La fila de las métricas se descubrió midiendo, no leyendo. `NodeSDK` arranca un proveedor de
métricas y otro de registros cuando sus variables de entorno no están declaradas —su valor por
defecto es `otlp`, no `none`—, así que la aplicación exportaba una señal que nadie había pedido.
El síntoma visible era un `OTLPExporterError: Not Found` por minuto contra Jaeger; el riesgo real
es que las métricas de las instrumentaciones llevan sus propios atributos y **no** atraviesan
`RedactingSpanProcessor`, que sólo actúa sobre spans. Una barrera que cubre un canal y deja otro
abierto no es una barrera.

El saneado del SQL vive en el PROCESADOR y no en el `requestHook` de `pg` por una razón medida:
la instrumentación cambió el nombre del atributo entre minors —`db.statement` pasó a
`db.query.text`— y durante la transición publica los dos. Acertar con un nombre deja el otro
entero, en silencio; el procesador cubre los dos y cualquier atributo futuro que se añada a la
lista, venga de la instrumentación que venga.

Las dos últimas filas son **defensa en profundidad**: el código ya no emite esos datos, pero una
instrumentación nueva o una actualización de biblioteca podría empezar a hacerlo sin que nadie lo
note, y el Collector lo corta antes de que se persista.

## Logs correlacionados

Los logs llevan `trace_id`, `span_id` y `trace_flags`, y pasan por `redactSensitiveText` **antes**
de salir tanto a stdout como a `Archivo.log`. La correlación añade identificadores de traza, no
contenido: **la superficie de datos personales en los logs no cambia por haber añadido trazas**.

## Retención y acceso

| | |
| --- | --- |
| Retención en producción | 7 días (ver `03-production-topology.md`) |
| Acceso a la UI | Sólo tras el proxy autenticado de consolas internas; nunca publicada |
| Acceso al Collector | Sólo desde la red de aplicación |
| Auditoría de lectura | **No la hay en Jaeger.** Es la razón por la que no puede contener datos personales: no se puede auditar quién los miró |

Esa última fila es el argumento central de todo el documento. La base de datos registra quién
leyó qué; un backend de trazas, no. Lo que no puede auditarse, no puede contener PII.

## Procedimiento ante una fuga

Si se detecta un dato prohibido en una traza:

1. **Cortar el emisor.** Desactivar la instrumentación o el atributo culpable y desplegar. No se
   empieza por borrar: mientras el emisor siga vivo, el dato vuelve.
2. **Redactar en el Collector.** Añadir la clave a `attributes/redact` como parada inmediata
   mientras el despliegue del paso 1 avanza.
3. **Acotar el alcance.** Qué servicio, qué versión, desde cuándo, cuántas trazas.
4. **Eliminar.** Con Badger, purgar el volumen es la vía realista; con OpenSearch, borrar los
   índices afectados. La retención de 7 días acota el peor caso por diseño.
5. **Revisar accesos.** Quién pudo consultar la UI en la ventana afectada.
6. **Documentar el incidente** y añadir una prueba que impida la reaparición — el patrón de este
   repositorio: bloqueo, regla y memoria.

## Responsables

| Rol | Responsabilidad |
| --- | --- |
| Quien escribe un span nuevo | Justificar cada atributo en `02-business-spans-catalog.md`, incluida su fila de privacidad |
| Quien revisa el cambio | Rechazar cualquier atributo cuyo valor no pertenezca a un catálogo cerrado o no sea un identificador opaco |
| Operación | Retención, acceso a la UI y aislamiento de red |

## Revisión

Esta política se revisa cuando se **añade una instrumentación**, se **sube de versión** el SDK o
se **añade un span de negocio**. No en un calendario: en los tres momentos en los que la
superficie puede cambiar de verdad.
