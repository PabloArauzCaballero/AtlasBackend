# Ensayo del corte del piloto de Mensajería en dev — 2026-09-13

Ejecutado de punta a punta contra el entorno de dev (no en pruebas): el monolito y el worker del piloto
corriendo a la vez, con el relay v2 encendido. Cada línea de abajo se leyó de la base o del log del
contenedor; los dos eventos sembrados se borraron al terminar y el entorno quedó como estaba.

## 1. Punto de partida

| Hecho                                               | Valor                                                                                   |
| --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Dueño de `messaging`                                | `monolith`, época 1                                                                     |
| `EVENTS_RELAY_V2_ENABLED` en el worker del monolito | `true` (encendida para el ensayo)                                                       |
| Worker del piloto                                   | `messaging-worker` Up (healthy), identidad `atlas_ctx_messaging`                        |
| Piloto antes del corte                              | `OWNERSHIP_FENCED messaging: dueño monolith (época 1); este relay no reclama`, cada 5 s |
| Cola                                                | 0 pendientes, 0 en vuelo                                                                |

## 2. El monolito entrega mientras es dueño

Evento sembrado (`credit.application.submitted`, tenant 1). Resultado del job `process_events`:

```json
{ "dryRun": false, "failed": 0, "skipped": 0, "eventIds": ["4919"], "selected": 1, "processed": 1 }
```

## 3. Corte: transferencia condicionada

```sql
UPDATE platform_ops.context_ownership SET owner='messaging-worker', epoch = epoch + 1
 WHERE context='messaging' AND owner='monolith' AND epoch=1;   -- UPDATE 1 → época 2
```

Los papeles se invierten **en caliente**, sin reiniciar nada:

- el piloto deja de emitir `OWNERSHIP_FENCED` (0 mensajes en 15 s);
- el monolito pasa a registrarlo: `OWNERSHIP_FENCED messaging: dueño messaging-worker (época 2); este relay (monolith) no reclama`.

## 4. El piloto entrega

Segundo evento sembrado tras el corte: pasa a `processed` en segundos, con `attempts=1`, y el consumidor
deja su recibo en el inbox (`notifications.orchestrator status=processed`).

## 5. Reversión y cercado

```sql
UPDATE … SET owner='monolith', epoch = epoch + 1
 WHERE context='messaging' AND owner='messaging-worker' AND epoch=2;   -- UPDATE 1 → época 3
UPDATE … WHERE context='messaging' AND owner='monolith' AND epoch=1;  -- UPDATE 0 (época vieja: no hace nada)
```

El piloto vuelve a `OWNERSHIP_FENCED … dueño monolith (época 3)`. La segunda sentencia demuestra el
fencing: una transferencia que llega con la época anterior no cambia nada, así que dos operadores (o un
proceso resucitado) no pueden dejar dos dueños.

## 6. Estado al terminar

Dueño `monolith` época 3; 0 eventos pendientes; api, worker y messaging-worker healthy; los dos eventos
de prueba y sus recibos, borrados.

## Lo que este ensayo NO demuestra

- No hubo carga: un evento por fase. El protocolo de `transition-performance-protocol.md` sigue sin ejecutarse.
- El piloto comparte base con el monolito: la separación física de datos no está probada.
- Se hizo en dev, no en staging con tráfico real, y la autorización de despliegue sigue sin acordarse.
