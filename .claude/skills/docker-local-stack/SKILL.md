---
name: docker-local-stack
description: Stack de desarrollo local reproducible con Docker Compose — servicios (API, Postgres, Redis, worker), redes y volúmenes con nombre, variables por `.env`, healthchecks, `depends_on` con condición, seeds al levantar, arranque selectivo por perfiles y paridad razonable con producción. Usar al armar o arreglar el `docker-compose.yml` de desarrollo, al sumar un servicio (base, caché, cola), cuando "en mi máquina anda y en la de al lado no", o cuando la API arranca antes que la base y se cae.
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Stack local con Docker Compose

Que cualquiera clone el repo, corra un comando y tenga el sistema entero corriendo igual que
el de al lado. La imagen de producción se arma aparte (`dockerfile-production`); acá el foco es
el entorno de desarrollo. Verificado contra docs.docker.com (Compose file reference).

## 1. Principios

- **Un comando levanta todo**: `docker compose up -d`. Si hace falta un README de diez pasos,
  el compose está incompleto.
- **Reproducible**: versiones de imagen fijadas (`postgres:16.4`, no `postgres:latest`), nunca
  `latest` en un servicio del que dependés.
- **Config por `.env`**, nunca hardcodeada; el archivo va en `.gitignore` y hay un
  `.env.example` versionado (ver `environment-secrets-config`).
- **Datos que sobreviven** al `down` en volúmenes con nombre; datos descartables, no.
- **Paridad razonable** con producción: la misma versión mayor de Postgres/Redis. No busques
  paridad total (en dev no corrés detrás del proxy TLS ni con réplicas).

## 2. Esqueleto

```yaml
services:
  db:
    image: postgres:16.4
    environment:
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: ${DB_NAME}
    ports: ["5432:5432"]           # exponer solo si te conectás desde el host
    volumes: ["db-data:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER} -d ${DB_NAME}"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 10s
  redis:
    image: redis:7.4
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10
  api:
    build: { context: ., target: dev }
    env_file: [.env]
    ports: ["3000:3000"]
    depends_on:
      db: { condition: service_healthy }
      redis: { condition: service_healthy }
    volumes:
      - .:/app                     # código montado para hot reload
      - /app/node_modules          # no pisar deps del contenedor con las del host

volumes:
  db-data:
```

## 3. `depends_on` con condición — el error más común

`depends_on` a secas solo espera a que el contenedor **arranque**, no a que esté listo. Postgres
tarda segundos en aceptar conexiones: la API arranca, no puede conectar y se cae. La solución es
condicionar al **healthcheck**:

| Condición | Significado |
|---|---|
| `service_started` | El contenedor arrancó (equivale al `depends_on` corto). Casi nunca alcanza. |
| `service_healthy` | El `healthcheck` del servicio da healthy. Usá esta para bases y colas. |
| `service_completed_successfully` | El servicio corrió y terminó con éxito (útil para un job de seeds/migración). |

Sin `healthcheck` definido, `service_healthy` nunca se cumple: cada dependencia que condiciones
tiene que tener su chequeo.

## 4. Healthcheck

Campos: `test`, `interval`, `timeout`, `retries`, `start_period` (gracia inicial, sin contar
fallos), `start_interval` (intervalo más corto durante el arranque). Reglas:
- El `test` prueba la dependencia real, no que el proceso exista: `pg_isready` para Postgres,
  `redis-cli ping` para Redis, `curl -f localhost:$PORT/health` para la API.
- `start_period` generoso en servicios que tardan (bases), así los primeros fallos no cuentan.
- No pongas `interval` de 30s en dev: querés que `up` termine rápido.

## 5. Seeds al levantar

Corré la carga como un servicio de un solo uso que **termina** y del que la API depende con
`service_completed_successfully`:

```yaml
  seed:
    build: { context: ., target: dev }
    env_file: [.env]
    depends_on: { db: { condition: service_healthy } }
    command: ["python", "salud-db/load_seeds.py", "--refresh"]
    profiles: ["seed"]             # solo corre si lo pedís
```

Los seeds deben ser idempotentes (la segunda corrida no duplica): ver `seed-data-catalogs`. En
un modelo dirigido por diagrama, la creación del esquema también sale del generador, nunca de un
`ALTER` a mano (ver `model-driven-schema`).

## 6. Levantar solo lo necesario — perfiles

No todos necesitan todo. Con `profiles`, un servicio solo arranca si activás su perfil:

- `docker compose up -d` → los servicios sin perfil (db, redis, api).
- `docker compose --profile seed up seed` → corre la carga y sale.
- `docker compose --profile tools up -d` → suma un adminer/pgweb opcional.

Para trabajar solo en el backend, no levantes el front. Menos contenedores, máquina más liviana
(ver `agent-resource-control`).

## 7. Redes y volúmenes

- **Red por defecto**: Compose crea una red y los servicios se resuelven por nombre (`db`,
  `redis`). Dentro del stack, la API conecta a `db:5432`, no a `localhost`.
- **`ports` solo cuando te conectás desde el host** (psql, un cliente). La comunicación entre
  contenedores no necesita publicar puertos, y publicar Postgres expone la base a la LAN.
- **Volúmenes con nombre** para datos que querés conservar; `docker compose down -v` los borra
  (útil para empezar de cero, peligroso por accidente).

## 8. Trampas frecuentes

- Montar el código del host y que `node_modules` del host (otra plataforma) pise al del
  contenedor → volumen anónimo sobre `/app/node_modules`.
- Cambios en el `Dockerfile` que no se ven: `docker compose up --build`.
- `latest` que cambió bajo tus pies: fijá versiones.
- Puerto ocupado en el host (`5432`, `3000`): ver `windows-dev-environment`.
- CRLF en scripts de arranque montados desde Windows → el shebang falla; ver `.gitattributes`
  en `windows-dev-environment`.

## Checklist

- [ ] `docker compose up -d` levanta el sistema entero sin pasos manuales.
- [ ] Imágenes con versión fijada, no `latest`.
- [ ] Cada base/cola tiene `healthcheck`; las dependencias usan `condition: service_healthy`.
- [ ] Config por `.env`, con `.env.example` versionado; `.env` en `.gitignore`.
- [ ] Datos a conservar en volúmenes con nombre; `ports` solo donde el host los usa.
- [ ] Seeds idempotentes en un servicio que termina; perfiles para lo opcional.
