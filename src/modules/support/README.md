# Motor de soporte, atención, casos y conocimiento

Contexto acotado de *Service Management* de Atlas. Sirve a la vez al consumidor de la app, al usuario
del portal de comercio, al comercio como organización y al equipo interno de soporte.

No es un chat con un operador al otro lado: es un expediente trazable, auditable y medible, con una
transcripción que se puede verificar.

## La decisión que gobierna todo lo demás

**El caso es el expediente; el chat es un canal.** Un caso vive sin ningún chat y sobrevive a todos
los que tenga. Cerrar la conversación no cierra el caso, y una caída de conexión no resuelve nada.

| Concepto | Tabla | Qué responde |
| --- | --- | --- |
| Caso | `support_cases` | Cómo está el expediente ahora |
| Historia del caso | `support_case_events` | Cómo llegó hasta ahí (append-only, encadenada) |
| Canal | `support_channels` | Dónde ocurre la conversación |
| Transcripción | `support_messages` | Qué se dijo, en qué orden (append-only, encadenada) |
| Auditoría | `audit.operational_audit_logs` | Qué hicieron las personas con el sistema, incluidas las lecturas |

Las cuatro primeras son cosas distintas a propósito. La auditoría es un objeto **separado** de la
historia del caso: un agente que abre veinte expedientes que no tiene asignados no genera ningún
evento de caso —no cambió nada— y es justo el comportamiento que hay que poder detectar.

## Lo que no se puede hacer, por diseño

- **Editar o borrar un mensaje.** No existe `PUT /messages/{id}` ni `DELETE`. Corregir crea un
  mensaje nuevo enlazado como `CORRECTS`; el original se queda porque la otra parte ya lo leyó.
  Triggers en PostgreSQL rechazan `UPDATE` y `DELETE` sobre la transcripción y la historia del caso.
- **Borrar un expediente.** Borrado lógico y triggers de `no delete` sobre caso, canal, asignaciones,
  resoluciones, enlaces, referencias, encuestas y adjuntos.
- **Modificar un dominio crítico desde soporte.** No hay ninguna ruta que apruebe un crédito, salde
  una cuota o toque el ledger. Soporte consulta, documenta, referencia y escala.
- **Cerrar automáticamente** un incidente de seguridad, un fraude, un reclamo formal, una solicitud
  de privacidad o cualquier caso con bloqueo legal.
- **Buscar sin filtro de autorización.** La audiencia del conocimiento la deriva el servidor del
  actor; nunca llega como parámetro.

## Cómo se ordena y se verifica la conversación

`server_sequence` se reserva incrementando `support_channels.last_message_sequence` en la **misma
sentencia** que lo lee (`UPDATE … RETURNING`), lo que serializa por canal. Cada mensaje firma el hash
del anterior:

```
integrity_hash = SHA-256(channel_id ‖ server_sequence ‖ emisor ‖ created_at ‖ content_hash ‖ previous_hash)
```

Alterar o quitar un mensaje del medio rompe todo lo posterior. `GET /internal/support/desk/channels/:id/integrity`
recalcula la cadena y dice **en qué posición** dejó de cuadrar. Un resultado inválido es un incidente
de seguridad, no un dato curioso: significa que alguien escribió sorteando los triggers.

`client_message_id` es único por canal: reintentar por mala red devuelve el mensaje que ya existe en
vez de duplicar la pregunta del cliente.

## Enrutado y capacidad

`SupportAgentRepository.reserveAvailableAgent` reserva un agente con un solo `UPDATE … WHERE
active_channel_count < max_concurrent_channels … FOR UPDATE SKIP LOCKED`. Es un compare-and-set
atómico: dos solicitudes simultáneas no pueden quedarse con el mismo agente, y la segunda no espera
a la primera. La presencia es efímera y puede degradarse; la **capacidad** no, por eso vive en
PostgreSQL y no sólo en Redis.

## SLA

Los relojes (`support_sla_clocks`) guardan la **versión** de política que se les aplicó. Publicar
plazos nuevos no reescribe el pasado. Las pausas son explícitas y sólo ocurren si la política lo
permite: si bastara con poner un caso «en espera» para congelar el reloj, ningún caso incumpliría
jamás. El cálculo respeta horario hábil, zona horaria y feriados de la política.

## Mapa de archivos

```
domain/          reglas puras, sin base ni red (estados, hash, prioridad, DLP, horario hábil)
application/     casos de uso; toda transición pasa por SupportCaseTransitionService
*.repository.ts  persistencia; el SQL crudo vive aquí y sólo aquí
*.controller.ts  adaptadores HTTP; validan con Zod, resuelven el actor y delegan
support.constants.ts  taxonomía única: tipos, dominios, estados, transiciones y códigos
```

## Puntos de entrada

| Audiencia | Prefijo |
| --- | --- |
| Consumidor | `mobile/support` |
| Comercio | `merchant/support` |
| Conversación (todas) | `support/channels` |
| Equipo de soporte | `internal/support/cases`, `internal/support/desk` |
| Editores de conocimiento | `admin/support/knowledge` |

## Lo que falta antes de producción

Decisiones de negocio, no de código: horarios oficiales por tipo de cliente, plazos de SLA
definitivos, ventana de reapertura, periodo de confirmación antes del cierre, plazos legales de
retención (las cinco clases están sembradas **inactivas** y declaradas en
`RETENTION_POLICIES_PENDING_DECISION`), y qué adjuntos pueden viajar por chat frente a cuáles exigen
el uploader seguro.

Y en el producto: la interfaz del centro de ayuda en la app, el centro de soporte del portal de
comercio y la consola del agente. El backend está completo para las tres.
