# POST /operations/jobs/process-events

Procesa eventos pendientes y dispara efectos secundarios internos.

Body:

```json
{
  "limit": 50,
  "dryRun": true
}
```

`dryRun: true` solo selecciona eventos.  
`dryRun: false` procesa, orquesta notificaciones y actualiza estados.
