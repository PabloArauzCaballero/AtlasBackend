# Semillas — Proyecto Atlas

## Dónde viven los datos de semilla

**Fuera del repositorio.** Viven en una **rama** de PostgreSQL gestionado (Neon) que publica el
conjunto ya materializado, y el backend lo trae con un comando:

```bash
yarn db:migration:up   # el esquema lo siguen definiendo las migraciones versionadas
yarn db:seed:pull      # los datos los trae la rama
```

Antes eran ~24 000 líneas de seeders versionados bajo `src/database/seeders/`. El motivo del cambio
no fue sólo el peso. Un seeder es **código que se ejecuta**, y cuando el esquema evoluciona por
debajo deja de ser reproducible en silencio: al capturar esta instantánea se descubrió que el
catálogo de sistemas llevaba meses sin poder correr contra una base limpia porque una migración
había añadido `system_code` a dos índices únicos y sus `ON CONFLICT` se quedaron atrás. Nadie lo
notaba porque en las bases existentes el seeder ya constaba como aplicado. Un conjunto ya
materializado no puede derivar de esa forma: o las filas encajan en el esquema del destino, o la
carga falla entera y se ve.

## La rama es el perfil

No hay `--profile`. Lo que antes elegía un argumento del comando ahora lo elige **a qué rama se
apunta**, y como cada rama de Neon tiene su propio endpoint, apuntar a otra es cambiar un host:

| Rama          | Qué publica                                                            |
| ------------- | ---------------------------------------------------------------------- |
| desarrollo    | Dato maestro **más** usuarios internos, comercios y casos de prueba.    |
| producción    | Sólo dato maestro: RBAC, catálogos, definiciones técnicas, baselines.   |

La diferencia con el `--profile` de antes no es cosmética: a la rama de producción **no se le puede
pedir** que entregue fixtures que no tiene. El error de sembrar datos ficticios en un entorno real
deja de ser un argumento mal escrito para pasar a ser imposible.

## Configuración

Dos formas, en este orden de precedencia (ver `src/database/seed-source.ts`):

1. `SEED_SOURCE_DATABASE_URL` — cadena completa. Gana sobre todo lo demás; es la vía para CI y para
   un secreto inyectado de una pieza.
2. `SEED_SOURCE_HOST` + `SEED_SOURCE_DB` + `SEED_SOURCE_USER` + `SEED_SOURCE_PASSWORD` — la vía
   cómoda cuando **sólo cambia la rama**: se toca el host y el resto queda igual.

`SEED_SOURCE_SSL` está activo por defecto porque la fuente es una base gestionada remota; sólo se
apaga para apuntar a un PostgreSQL local sin certificado.

## Comandos

| Comando               | Qué hace                                                                        |
| --------------------- | ------------------------------------------------------------------------------- |
| `yarn db:seed:pull`   | Trae el conjunto publicado. **Destructivo** sobre las tablas del manifiesto.     |
| `yarn db:seed:status` | Compara lo publicado con lo que hay aquí. No escribe nada.                       |

## Cómo carga, y por qué así

La carga entera ocurre dentro de **una transacción** que retira las claves foráneas, copia y las
vuelve a crear. Dos razones:

- **El grafo de Atlas tiene ciclos reales** (`customers` ↔ `customer_profile_versions`,
  `risk_assessment_runs` ↔ `risk_assessment_results`): no existe ningún orden topológico válido, así
  que ordenar las tablas no es una opción. La alternativa habitual,
  `session_replication_role = replica`, exige un privilegio que el PostgreSQL gestionado no concede
  al rol propietario.
- **Recrear las restricciones es lo que valida el resultado.** Una fila huérfana aborta el `ALTER` y
  revierte la carga completa, de modo que la base nunca queda a medias ni —lo importante— sin
  restricciones.

Los disparadores de usuario se apagan durante la carga porque hay tablas protegidas como
append-only —la cadena de auditoría rechaza `TRUNCATE`— y porque un `BEFORE INSERT` que recalcule
marcas de tiempo o hashes reescribiría filas que ya vienen calculadas del origen.

Los valores viajan como **texto** (`col::text` al leer, `$n::tipo` al escribir): la representación
textual de PostgreSQL es la inversa de su entrada para todos los tipos que usa Atlas —arrays,
`jsonb`, `bytea`, enums, rangos, `citext`—, así que el copiado no depende de cómo el driver traduzca
cada tipo a JavaScript ni de que ambas puntas usen la misma versión de `pg`.

Al terminar se reposicionan las secuencias por encima del máximo copiado; sin eso el primer `INSERT`
del runtime chocaría contra una clave ya usada.

## Credenciales propias de tu máquina

El conjunto publicado es el mismo para todos: trae el correo y el hash por defecto del administrador
de desarrollo, que es lo que espera CI. Para apuntar esa cuenta a un buzón real —necesario si se
quiere **recibir** el PIN del segundo factor— siguen existiendo las mismas variables de `.env`, que
ahora se aplican **después** de la copia, sobre las filas ya traídas
(`src/database/seed-local-identities.ts`):

- `DEV_ADMIN_EMAIL`, `DEV_ADMIN_PASSWORD` — administrador interno de desarrollo.
- `DEV_PARTNER_PASSWORD` — identidades de comercio de desarrollo.

La contraseña se hashea **en tu máquina** y nunca sale de `.env`, que está en `.gitignore`. Es la
misma regla de ATLAS-P0-002: un hash que entra al historial de git se considera comprometido para
siempre.

## Siembra al arrancar

`DATABASE_SEED_ON_STARTUP=true` trae las semillas al arrancar **sólo si la base está vacía**. La
condición no es un detalle: la carga es destructiva, así que hacerlo en cada arranque borraría el
trabajo de la sesión anterior. Cuando los seeders eran código versionado la salvaguarda la ponía
Umzug, que sólo corría lo no aplicado; ahora es explícita. Para resembrar a propósito está
`yarn db:seed:pull`, que es un acto deliberado de una persona y no un efecto colateral de reiniciar
un proceso.

Sólo corre en el proceso que ejecuta trabajo de fondo (`APP_ROLE` ∈ `all`, `worker`): con N réplicas
de API arrancando a la vez, N procesos harían la misma carga destructiva en paralelo.

## Publicar una instantánea nueva

Cuando cambie el dato maestro, se actualiza **la rama**, no el repositorio. El camino reproducible es
el mismo que se usó para crearla:

1. Base limpia, `yarn db:migration:up`.
2. Cargar los datos por el medio que corresponda (portal, API o SQL).
3. Empujar esa base a la rama con la misma lógica de copia, en sentido inverso.

Conviene dejar constancia de qué se publicó: la rama lleva un esquema `atlas_seed` con `manifest`
(tablas y filas) y `snapshot` (fecha, backend y `git sha` del código con el que se capturó).
