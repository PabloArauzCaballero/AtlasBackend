# SQL de sesiones contra PostgreSQL 16 real (contenedor desechable)

Tablas `internal_users` y `auth_refresh_tokens` con las columnas del modelo; filas sintéticas:
usuario 5 y 6 (tenant 1), 7 (tenant 2), 8 (tenant 1, `_deleted = true`); tokens vivos, revocados,
vencidos y uno de `customer`. `now = 2026-10-17T12:00Z`.

```text
p1 [["1","5","2026-10-17T11:30:00.000Z"],["4","6","2026-10-17T08:00:00.000Z"]] total 3 people 2
p2 [["3","5"]]
revoked 2
revoked again 0
after [["4","6"]] total 1
reasons [{"_id":"1","revoked_reason":"admin_revoked"},{"_id":"2","revoked_reason":null},{"_id":"3","revoked_reason":"admin_revoked"},{"_id":"8","revoked_reason":null}]
```

Demuestra: aislamiento por tenant (7 fuera), usuario borrado fuera (8), vencido fuera (5), revocado
fuera (2), token de cliente fuera y sin tocar (8 en `reasons`), orden por renovación desc, paginación,
recuento de personas, y revocación idempotente acotada a una persona.
