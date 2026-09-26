# Runbook · reversión del piloto de Mensajería después de escrituras nuevas (AT-060)

Prueba: `test/integration/messaging/rollback-after-writes.spec.ts`.

## Estrategia elegida: mismo dueño de datos, transferencia inversa

Durante el piloto la base sigue siendo la compartida y `messaging.*` sigue teniendo un solo dueño físico. Revertir es
**otra transferencia de propiedad** con época nueva (`messaging-worker → monolith`), no una restauración de datos:

- Todo lo confirmado por el piloto (mensajes, entregas, eventos del outbox) sigue en su sitio y el monolito lo procesa.
- Lo que el piloto entregó y el proveedor aceptó **no se repite**: el evento está `processed` y, aunque alguien lo
  devuelva a `pending`, el inbox del consumidor lo absorbe.
- El piloto que siga vivo queda cercado (`fenced`) y no confirma nada con su testigo viejo.
- No se intenta deshacer un email/SMS enviado: se reconcilia (`notification_deliveries`) y se conserva el historial.

## Procedimiento

1. Leer época y dueño (`context_ownership`). 2. Transferir `from: 'messaging-worker', to: 'monolith'` con esa época y
`requeueInFlight: true` (lo en vuelo del piloto se reentrega; el inbox deduplica). 3. Confirmar en el log del piloto
`OWNERSHIP_FENCED` y en el monolito `published` creciendo. 4. Apagar el piloto cuando se quiera: ya no manda.

## Lo que NO cubre

- Un piloto con **base propia** (posterior a AT-061): entonces la reversión exige sincronización inversa de `messaging.*`
  hacia la base compartida con la misma herramienta de copia y un corte nuevo; no está ensayado porque esa base no existe.
- Restaurar rutas/DNS sin transferir la propiedad **no** es una reversión y no aprueba.
