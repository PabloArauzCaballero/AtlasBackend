#!/bin/sh
# Instala (o refresca) el respaldo de los tableros en /opt/atlas/respaldo-tableros/.
# Uso, en Contabo como root, desde esta carpeta copiada al servidor: sh instalar.sh
#
# 1. Vuelca las variables de los contenedores principales (apps 4 y 8 de Coolify) a api.env y
#    web.env (600), sin las que pone Coolify ni las de la imagen.
# 2. Etiqueta como `:estable` la imagen que corre HOY en la principal (sólo si está sana).
# 3. Levanta los respaldos. No toca Traefik: el fichero de failover se copia aparte (README.md).
set -eu
DEST=/opt/atlas/respaldo-tableros
mkdir -p "$DEST"
cp docker-compose.yml "$DEST/"

principal() { # app_id servicio
  docker ps -q --filter "label=coolify.applicationId=$1" --filter "label=com.docker.compose.service=$2" --filter status=running | head -n 1
}

volcar() { # contenedor fichero
  umask 077
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$1" |
    grep -vE '^(COOLIFY_|SERVICE_|SOURCE_COMMIT=|PATH=|HOSTNAME=|HOME=|NODE_VERSION=|YARN_VERSION=|YARN_CACHE_FOLDER=|$)' > "$2.tmp"
  mv "$2.tmp" "$2"
}

estable() { # contenedor repo
  salud=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$1")
  if [ "$salud" != healthy ]; then echo "  $1 no está healthy ($salud): no se etiqueta"; return 1; fi
  docker tag "$(docker inspect -f '{{.Image}}' "$1")" "$2:estable"
  echo "  $2:estable <- $1"
}

api=$(principal 4 api); web=$(principal 8 portal)
[ -n "$api" ] && [ -n "$web" ] || { echo "Falta un contenedor principal en marcha (api=$api web=$web)"; exit 1; }
volcar "$api" "$DEST/api.env"
volcar "$web" "$DEST/web.env"
estable "$api" atlas-dashboards-backend
estable "$web" atlas-dashboards-frontend
cd "$DEST" && docker compose up -d
docker ps --filter name=atlas-tableros- --format '{{.Names}} {{.Status}}'
