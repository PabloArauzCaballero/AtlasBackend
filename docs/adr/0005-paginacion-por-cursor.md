# ADR-0005: Paginación por cursor como camino por defecto de alto volumen

- **Estado:** Aceptado
- **Fecha:** 2026-07-16
- **Decisores:** equipo backend
- **Relacionado:** módulos `audit`, `events`, `operations`, `data-quality` (`*.schemas.ts` / `*.repository.ts`), plan 10/10 Fase 5.1

## Contexto

La paginación por `OFFSET`/`LIMIT` degrada linealmente con la profundidad: `OFFSET N`
obliga a la base de datos a recorrer y descartar N filas, y un `count` exacto sobre
tablas grandes (eventos, auditoría, telemetría) es caro. En listados de alto volumen
esto se vuelve un problema de rendimiento y de estabilidad de resultados (las filas se
desplazan entre páginas si hay inserciones concurrentes).

## Decisión

La **paginación por cursor** (keyset) es el camino **por defecto para listados de alto
volumen**. Ya se aplica en `audit`, `events`, `operations` y `data-quality`. El cursor
opaco codifica la posición estable (p. ej. `(timestamp, id)`), permite avanzar en O(1)
por página y puede devolver resultados **sin un total exacto** cuando `count` encarece.

`OFFSET` se conserva **solo** para pantallas administrativas pequeñas y acotadas, donde
la profundidad es baja y un total exacto aporta más que lo que cuesta.

## Alternativas consideradas

- **OFFSET en todo** — simple pero no escala; profundiza mal y produce paginación
  inestable bajo escritura concurrente. Descartada para alto volumen.
- **Cursor en todo, incluido admin pequeño** — el cursor sin total exacto empeora la UX
  de pantallas administrativas que sí quieren "página 4 de 12". Se prefiere OFFSET ahí.

## Consecuencias

- **Positivas:** rendimiento estable independiente de la profundidad; resultados
  consistentes bajo concurrencia; se evita el `count` caro en las rutas calientes.
- **Negativas / costos asumidos:** el cliente no siempre tiene un total exacto ni
  "saltar a página N"; el cursor es opaco y debe versionarse con cuidado si cambia el
  criterio de orden.
- **Condición de revisión (trigger):** al añadir un nuevo listado, la decisión por
  defecto es cursor; usar OFFSET requiere justificar que es una pantalla administrativa
  de bajo volumen. Extender cursor a listados de alto volumen que aún usen OFFSET es
  trabajo de seguimiento del plan Fase 5.1.
