# syntax=docker/dockerfile:1.7
# Imagen de Atlas Backend. UNA sola imagen para los tres roles de proceso (api, worker y el job
# one-shot de migraciones): comparten el 100 % del árbol de dependencias, así que dos imágenes
# significarían dos builds, dos escaneos de vulnerabilidades y dos oportunidades de divergir. Lo que
# cambia entre roles es el `command` y la variable `APP_ROLE`.
#
# Hallazgo A-06 de docs/audit/auditoria-integral-2026-07-30.md: no existía ningún artefacto de
# despliegue en el repositorio, pese a que docs/runbooks/despliegue-produccion.md describe un
# despliegue. Ver también docs/architecture/background-processing.md.
#
# Multi-stage:
#   deps    → dependencias completas (necesarias para compilar TypeScript)
#   build   → compila a dist/
#   runtime → solo dependencias de producción + dist/, con usuario sin privilegios
#
# La versión de Node se fija con un ARG por defecto igual a .nvmrc; CI puede sobrescribirla leyendo
# ese archivo, de modo que local, CI e imagen no vuelvan a divergir.
ARG NODE_VERSION=22.16.0

# ---------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
# Solo el manifiesto y el lockfile: así esta capa se reaprovecha mientras las dependencias no cambien.
COPY package.json yarn.lock .yarnrc ./
# La caché de yarn se MONTA en vez de copiarse: sobrevive entre builds sin engordar ninguna capa.
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn,sharing=locked \
    yarn install --frozen-lockfile

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

# Etiquetas OCI: permiten rastrear una imagen de un registro hasta su commit sin ejecutarla.
LABEL org.opencontainers.image.title="atlas-backend" \
      org.opencontainers.image.description="Backend fintech Atlas: identidad, onboarding KYC, elegibilidad, credito, riesgo y operaciones." \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${APP_COMMIT_SHA}" \
      org.opencontainers.image.created="${APP_BUILT_AT}" \
      org.opencontainers.image.licenses="UNLICENSED"

# `tini` como PID 1: reenvía SIGTERM al proceso Node y cosecha zombis. Sin él, Node corre como PID 1
# y el drenado ordenado (SHUTDOWN_DRAIN_MS, hallazgo A-07) nunca llega a ejecutarse porque la señal
# no se entrega igual.
#
# `curl` ya NO se instala: el HEALTHCHECK lo hace un script de Node (ops/docker/healthcheck.mjs).
# Un binario menos en una imagen de producción es una superficie de CVE menos que parchear, y el
# runtime ya trae un cliente HTTP perfectamente capaz.
RUN apt-get update \
  && apt-get install --no-install-recommends -y tini \
  && rm -rf /var/lib/apt/lists/*

# Dependencias de PRODUCCIÓN únicamente: las de desarrollo (typescript, jest, eslint…) no tienen por
# qué viajar en la imagen ni ampliar su superficie de vulnerabilidades.
COPY package.json yarn.lock .yarnrc ./
# Sin `yarn cache clean`: con la caché montada, el directorio no forma parte de ninguna capa de la
# imagen —limpiarlo no ahorraría un solo byte— y además el propio montaje lo mantiene ocupado, así
# que el `rmdir` fallaba con EBUSY y tumbaba el build.
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn,sharing=locked \
    yarn install --frozen-lockfile --production

COPY --from=build /app/dist ./dist
# Las migraciones y los seeders se ejecutan con `tsx` desde el fuente (ver src/database/migrate.ts),
# así que el árbol de base de datos viaja también: es lo que permite correr `db:migration:up` como
# job de despliegue usando esta misma imagen.
COPY --from=build /app/src/database ./src/database
COPY ops/docker/healthcheck.mjs ./ops/docker/healthcheck.mjs

# `node` es el usuario sin privilegios que ya trae la imagen oficial. El proceso no necesita escribir
# en ningún sitio salvo el archivo de log, cuyo directorio se le entrega explícitamente.
RUN mkdir -p /app/logs && chown -R node:node /app/logs
USER node

# APP_ROLE=all por defecto: sin configurar nada, la imagen se comporta como el proceso único de
# siempre. Un despliegue separado fija `api` y `worker` en cada conjunto de réplicas.
ENV APP_ROLE=all \
    APP_PORT=3005 \
    WORKER_PROBE_PORT=3006 \
    LOG_SYNC_FILE_PATH=/app/logs/Archivo.log
EXPOSE 3005 3006

# El chequeo elige puerto y ruta según APP_ROLE, así que la MISMA imagen se sonda correctamente
# tanto siendo API como siendo worker. Comprueba READINESS y no liveness a propósito: durante el
# drenado por SIGTERM readiness responde 503, que es la señal que saca la instancia del balanceador.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "/app/ops/docker/healthcheck.mjs"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/src/main.js"]
