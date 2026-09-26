---
name: maps-geolocation
description: Mapas y geolocalización en la API sobre PostGIS — tipo geography, consultas de cercanía con ST_DWithin y nearest-neighbor con el operador `<->`, índices espaciales GiST, cálculo de distancia del lado servidor, privacidad de la ubicación (guardar el mínimo, precisión reducida) y términos de uso de los proveedores de mapas. Usar al modelar una entidad con ubicación, implementar "lugares/entidades de salud cercanos", buscar por radio, ordenar por distancia, o al elegir y consumir un proveedor de mapas y geocodificación.
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Mapas y geolocalización

La ubicación es a la vez un problema de datos espaciales (que escale y sea correcto) y de
privacidad (dónde está una persona es dato sensible). Base espacial en PostgreSQL:
`postgresql-advanced`; el detalle geográfico está acá. La disponibilidad y versión de PostGIS y
del proveedor de mapas se definen en el CLAUDE.md del proyecto.

## 1. Modelado: geography, no dos floats

- Guardá la ubicación como columna **`geography(Point, 4326)`** (PostGIS), no como `lat`/`lng`
  sueltos. `geography` mide en **metros** sobre la esfera y evita los errores de calcular
  distancias con Pitágoras sobre grados.
- SRID **4326** (WGS84, el de GPS y de los proveedores de mapas). Sé consistente en todo el
  sistema.
- `geometry` (plano) es para cálculos planares en una proyección local; para "puntos en el mundo
  y distancias en metros", `geography` es lo correcto y lo más simple.

```sql
ALTER TABLE facility ADD COLUMN location geography(Point, 4326);
-- índice espacial: sin esto, toda consulta de cercanía es un seq scan
CREATE INDEX idx_facility_location_gix ON facility USING gist (location);
```

## 2. Cercanía: "dentro de X metros"

`ST_DWithin(a, b, metros)` sobre `geography` devuelve verdadero si están dentro de esa distancia,
en **metros**, y **usa el índice GiST**:

```sql
-- ✅ entidades de salud dentro de 5 km del punto dado (usa idx GiST)
SELECT id, name
FROM facility
WHERE ST_DWithin(location, ST_MakePoint($lng, $lat)::geography, 5000);
```

- La distancia va en metros; no la conviertas a grados.
- `use_spheroid` es `true` por defecto (más preciso, algo más lento); `false` mide sobre la
  esfera, más rápido y suele alcanzar para "cercanía". Elegí según necesidad.
- Ojo el orden de coordenadas: `ST_MakePoint(lng, lat)` — **longitud primero**. Es el error #1.

## 3. Nearest-neighbor: "los N más cercanos"

Para "las 10 farmacias más cercanas a mi receta", ordená por el operador de distancia `<->`, que
usa el índice espacial cuando está en el `ORDER BY` contra un punto constante:

```sql
-- ✅ KNN indexado: los 10 más cercanos, con su distancia en metros
SELECT id, name, location <-> ST_MakePoint($lng, $lat)::geography AS distancia_m
FROM facility
ORDER BY location <-> ST_MakePoint($lng, $lat)::geography
LIMIT 10;
```

- Combinalo con `ST_DWithin` en el `WHERE` si además querés acotar el radio ("los 10 más
  cercanos **dentro de** 20 km").
- El punto de referencia debe ser una **constante** (parámetro), no una subconsulta, para que el
  índice se use.
- Todo esto va con `EXPLAIN (ANALYZE)` que confirme uso del índice (`postgresql-advanced`).

## 4. Cálculo del lado servidor

- Distancias, radios y "cercanos" se calculan en la **base/servidor**, no en el cliente trayendo
  todo y filtrando en memoria (no escala y expone datos de más).
- Distancia exacta entre dos puntos: `ST_Distance(a, b)` sobre `geography` → metros.
- Rutas/tiempos de viaje reales (por calle) **no** los da PostGIS: requieren un servicio de
  routing/mapas. Pedilos al proveedor, del lado servidor, con caché (`caching-strategy`) por sus
  límites de cuota y costo.

## 5. Privacidad de la ubicación

La ubicación de una persona es dato sensible; combinada con salud, más aún (`data-privacy-sensitive`).

- **Minimizá**: guardá la ubicación solo si el feature la necesita, y con la **precisión mínima**
  que sirva. Para "hay servicios en tu zona" no necesitás la posición exacta del paciente:
  redondeá/aproximá.
- No registres un historial de ubicaciones del usuario salvo requisito explícito y consentido
  (`data-privacy-sensitive`); un rastro de dónde estuvo alguien es altamente sensible.
- La ubicación de un paciente no viaja en logs, URLs ni notificaciones (`notifications-delivery`).
- Distinguí ubicación **pública** (dirección de un consultorio publicada) de **privada** (dónde
  está el usuario ahora): reglas de acceso distintas.
- La geolocalización del navegador/dispositivo requiere permiso del usuario; pedilo con propósito
  claro y funcioná sin ella (degradación).

## 6. Proveedores de mapas y geocodificación

- Geocodificar (dirección ↔ coordenadas), tiles del mapa, autocompletado de direcciones y routing
  son servicios de terceros con **términos de uso, cuotas y costo**. Leé y respetá los términos
  (varios prohíben guardar resultados o exigen mostrar su mapa): validá con el responsable legal/comercial.
- Cacheá geocodificaciones estables (una dirección no se mueve) dentro de lo que permita la
  licencia; no vuelvas a pagar por lo mismo.
- La API key del proveedor es secreto (`environment-secrets-config`); restringila por
  dominio/referrer y por API. No la expongas de más en el cliente.
- Aislá el proveedor tras una interfaz propia (`clean-code`, límites con terceros): cambiar de
  proveedor no debería tocar el dominio.

## Anti-patrones

- Guardar `lat`/`lng` como floats y calcular distancias con fórmulas a mano.
- Olvidar el índice GiST (todas las cercanías en seq scan) o `ST_MakePoint(lat, lng)` invertido.
- Traer todos los puntos al cliente/servicio y filtrar por distancia en memoria.
- Guardar posición exacta o historial de ubicación sin necesidad ni consentimiento.
- Ubicación del paciente en logs/URLs; API key sin restringir; ignorar términos del proveedor.

## Checklist

- [ ] Ubicación como `geography(Point, 4326)`; SRID consistente; `ST_MakePoint(lng, lat)`.
- [ ] Índice GiST sobre la columna; `EXPLAIN` confirma que las consultas lo usan.
- [ ] Cercanía con `ST_DWithin` (metros); "más cercanos" con `<->` en `ORDER BY` contra constante.
- [ ] Distancias y filtros calculados en el servidor, no en el cliente; routing real vía proveedor con caché.
- [ ] Ubicación guardada al mínimo y con la menor precisión útil; sin historial salvo consentido.
- [ ] Ubicación privada fuera de logs/URLs/notificaciones; acceso público vs privado diferenciado.
- [ ] Términos y cuotas del proveedor respetados; geocodificaciones cacheadas según licencia; API key restringida y secreta.
