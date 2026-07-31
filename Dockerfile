# Imagen de producción de Atlas Backend.
#
# Hallazgo A-06 de docs/audit/auditoria-integral-2026-07-30.md: no existía ningún artefacto de
# despliegue en el repositorio — ni Dockerfile, ni compose, ni manifiesto — pese a que
# docs/runbooks/despliegue-produccion.md describe un despliegue y el plan asume "la imagen de prod"
# para @aws-sdk/client-kms. El artefacto que se despliega era, literalmente, indefinido.
#
# Multi-stage:
#   deps    → dependencias completas (necesarias para compilar TypeScript)
#   build   → compila a dist/
#   runtime → solo dependencias de producción + dist/, con usuario sin privilegios
#
# La versión de Node se fija con un ARG por defecto igual a .nvmrc; CI puede sobrescribirla
# leyendo ese archivo, de modo que local, CI e imagen no vuelvan a divergir.
ARG NODE_VERSION=22.16.0

# ---------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
# Solo el manifiesto y el lockfile: así esta capa se reaprovecha mientras las dependencias no cambien.
COPY package.json yarn.lock .yarnrc ./
RUN yarn install --frozen-lockfile

# ---------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN yarn build

# ---------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app

# Metadatos del build. El pipeline los inyecta con --build-arg y `/health` los reporta, para poder
# responder "qué build está corriendo" sin adivinar (hallazgo A-05).
ARG APP_VERSION
ARG APP_COMMIT_SHA
ARG APP_BUILT_AT
ENV APP_VERSION=${APP_VERSION} \
    APP_COMMIT_SHA=${APP_COMMIT_SHA} \
    APP_BUILT_AT=${APP_BUILT_AT} \
    NODE_ENV=production \
    LOG_FORMAT=json

# `tini` como PID 1: reenvía SIGTERM al proceso Node y cosecha zombis. Sin él, Node corre como PID 1
# y el drenado ordenado (SHUTDOWN_DRAIN_MS, hallazgo A-07) nunca llega a ejecutarse porque la señal
# no se entrega igual. `curl` lo usa el HEALTHCHECK.
RUN apt-get update \
  && apt-get install --no-install-recommends -y tini curl \
  && rm -rf /var/lib/apt/lists/*

# Dependencias de PRODUCCIÓN únicamente: las de desarrollo (typescript, jest, eslint…) no tienen por
# qué viajar en la imagen ni ampliar su superficie de vulnerabilidades.
COPY package.json yarn.lock .yarnrc ./
RUN yarn install --frozen-lockfile --production && yarn cache clean

COPY --from=build /app/dist ./dist
# Las migraciones y los seeders se ejecutan con `tsx` desde el fuente (ver src/database/migrate.ts),
# así que el árbol de base de datos viaja también: es lo que permite correr `db:migration:up` como
# job de despliegue usando esta misma imagen.
COPY --from=build /app/src/database ./src/database

# `node` es el usuario sin privilegios que ya trae la imagen oficial. El proceso no necesita escribir
# en ningún sitio salvo el archivo de log, cuyo directorio se le entrega explícitamente.
RUN mkdir -p /app/logs && chown -R node:node /app/logs
USER node

ENV APP_PORT=3005 \
    LOG_SYNC_FILE_PATH=/app/logs/Archivo.log
EXPOSE 3005

# El probe usa readiness, no liveness: durante el drenado por SIGTERM readiness responde 503 y esa
# es exactamente la señal que debe sacar la instancia del balanceador.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${APP_PORT}/api/v1/health/readiness" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/src/main.js"]
