# Autorización del piloto de Mensajería — propuesta para acordar

Este documento existe porque el expediente de aptitud del piloto
([`pilot-readiness.json`](../architecture/microservices/pilot-readiness.json)) tiene once
comprobaciones técnicas en verde y una sola abierta: **`deployment-authorization`**, que decía
literalmente «responsables, autorización y criterio de cancelación no acordados».

Aquí está todo lo que se puede dejar decidido sin una persona: el alcance, lo que ya está medido,
los umbrales de cancelación y el procedimiento de reversión. **Lo que no está y no puede estarlo es
la firma.** Mientras la sección 6 siga en blanco, el piloto sigue siendo `NOT_READY` y nadie debe
transferir la propiedad del contexto en producción.

## 1. Qué se autoriza exactamente

Que el proceso `messaging-worker` pase a ser el **único escritor** del contexto `messaging` —es
decir, quien reclama y entrega los eventos de notificación— en un entorno concreto, sustituyendo al
monolito.

| | |
|---|---|
| **Entra** | Notificaciones no críticas que ya existen: estado de solicitud, recordatorios, difusiones |
| **NO entra** | OTP de verificación de contacto, restablecimiento de contraseña, mensajes con secreto o plazo legal. Siguen en el monolito y este documento no los toca |
| **Sigue igual** | La base es la misma (el piloto tiene identidad propia, `atlas_ctx_messaging`, no base propia). Ninguna API pública cambia |

## 2. Lo que ya está probado (no hace falta volver a discutirlo)

Cada punto tiene su evidencia en el repositorio; la revisión de esta autorización consiste en
leerlos, no en repetirlos.

- **Arranca solo y no alcanza lo que no es suyo.** PostgreSQL le deniega Crédito y Clientes aunque
  quiera (`test/integration/bootstrap/messaging-standalone.spec.ts`).
- **Está cercado hasta que se le transfiera.** Con dueño `monolith` no reclama ni un evento.
- **El corte y la reversión se ensayaron de punta a punta EN DEV**, con los dos procesos vivos
  (`docs/testing/evidence/pilot-cutover-2026-09-13.md`): el monolito entregó como dueño, la
  transferencia condicionada invirtió los papeles en caliente, el piloto entregó con recibo, la
  reversión devolvió la propiedad y una transferencia con la época vieja no hizo nada.
- **Lee los contactos por HTTP con identidad de servicio**, no por la base de Clientes.
- **La difusión a usuarios internos se queda en el monolito**, y un gate lo vigila.

## 3. Lo que hay que configurar antes del corte (y hoy no está)

Sin esto el piloto arranca pero no entrega:

- `CONTEXT_SERVICE_TOKEN_SECRET` — el mismo valor en el monolito y en el worker.
- `CUSTOMERS_DIRECTORY_URL` — a dónde pregunta el worker por los contactos, por red interna.
- `EVENTS_RELAY_V2_ENABLED=true` en el entorno donde se corta (encendido en dev el 2026-09-13).
- `MESSAGING_DB_USER` / `MESSAGING_DB_PASSWORD` — su identidad propia de base.

## 4. Criterio de cancelación

**Cualquiera de estas condiciones revierte el piloto sin más discusión.** Están escritas para que la
decisión no dependa de la interpretación de quien esté mirando la pantalla esa noche.

| Señal | Umbral | Dónde se ve |
|---|---|---|
| Eventos pendientes acumulándose | El más antiguo supera **15 minutos** sin reclamar | `platform_ops.outbox_events` con `status='pending'` |
| Entregas fallidas | Más del **2 %** de los mensajes de una hora terminan en `failed` | `messaging.notification_messages` |
| Entregas duplicadas | **Una sola** entrega repetida confirmada | Recibos de `platform_ops.inbox_receipts` |
| El worker no está | Ausencia de `atlas_app_info{role="worker"}` durante **5 minutos** | Métricas |
| Latencia | p95 de entrega peor que el del monolito **+20 %** sostenido una hora | Comparación con la línea base |
| Cualquier mensaje excluido entregado por el piloto | **Uno** | OTP o reset saliendo del worker: es un fallo de alcance, no de rendimiento |

La reversión es la transferencia inversa descrita en
[`messaging-single-writer-cutover.md`](messaging-single-writer-cutover.md) y
[`messaging-rollback-after-writes.md`](messaging-rollback-after-writes.md): devuelve la propiedad al
monolito por época, lo que el piloto ya escribió sobrevive, lo entregado no se repite y el piloto
queda cercado. Ensayada contra PostgreSQL (`test/integration/messaging/rollback-after-writes.spec.ts`)
y en dev.

**Ventana de observación propuesta:** 72 horas con los dos procesos vivos antes de dar el piloto por
estable. Durante ese plazo, revertir es la respuesta por omisión ante la duda.

## 5. Quién decide qué

Los papeles están descritos; los NOMBRES los pone quien firme. Un papel sin nombre no está cubierto.

| Papel | Qué le toca | Nombre |
|---|---|---|
| Responsable del corte | Ejecuta la transferencia y se queda mirando la ventana de observación | _(por designar)_ |
| Responsable de la reversión | Puede revertir sin pedir permiso a nadie si se cumple un criterio de la sección 4 | _(por designar)_ |
| Responsable del producto | Confirma que el alcance de la sección 1 es el que quiere | _(por designar)_ |
| Guardia durante la ventana | A quién se llama si algo se tuerce fuera de horario | _(por designar)_ |

## 6. Firma

Este documento NO está autorizado. Nadie ha firmado y ningún agente puede firmarlo.

- Entorno autorizado: _(por decidir)_
- Fecha y hora del corte: _(por decidir)_
- Autoriza: _(por designar)_ — fecha: _______

Cuando esto se complete, actualizar `deployment-authorization` a `PASS` en
`docs/architecture/microservices/pilot-readiness.json` **citando este documento y la fecha**, y sólo
entonces cambiar `decision` a `READY`.
