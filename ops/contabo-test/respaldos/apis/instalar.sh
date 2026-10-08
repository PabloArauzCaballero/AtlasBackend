#!/bin/sh
# Instala (o refresca) el respaldo de las APIs de AtlasBackend y del Motor en /opt/atlas/respaldo-apis/.
# Uso, en Contabo como root, desde esta carpeta copiada al servidor: sh instalar.sh
# Vuelca variables de cada principal (600, sin las de Coolify), etiqueta `:estable` la imagen que
# corre HOY (sólo si está healthy) y levanta los respaldos de uno en uno. No toca Traefik.
set -eu
DEST=/opt/atlas/respaldo-apis
mkdir -p "$DEST"
cp docker-compose.yml "$DEST/"
(umask 077; for n in atlas-backend motor; do [ -f "$DEST/$n.env" ] || : > "$DEST/$n.env"; done)

# app imagen nombre
TABLA="
1 atlas-backend atlas-backend
2 atlas-decision motor
"
# Coolify 4.4.2 sólo pone `coolify.applicationUuid`; lo desplegado antes, sólo `coolify.applicationId`.
principal_de() { # app_id servicio -> contenedor en marcha
  u=$(docker exec coolify-db psql -U coolify -d coolify -Atc "select uuid from applications where id=$1")
  { docker ps -q --filter "label=coolify.applicationId=$1" --filter "label=com.docker.compose.service=$2" --filter status=running
    [ -n "$u" ] && docker ps -q --filter "label=coolify.applicationUuid=$u" --filter "label=com.docker.compose.service=$2" --filter status=running
  } | head -n 1
}
echo "$TABLA" | while read -r app imagen nombre; do
  [ -z "${app:-}" ] && continue
  p=$(principal_de "$app" api)
  if [ -z "$p" ]; then echo "  app $app: sin principal en marcha, se salta"; continue; fi
  salud=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$p")
  if [ "$salud" != healthy ]; then echo "  app $app: principal $salud, se salta"; continue; fi
  ( umask 077
    docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$p" |
      grep -vE '^(COOLIFY_|SERVICE_|SOURCE_COMMIT=|PATH=|HOSTNAME=|HOME=|NODE_VERSION=|YARN_VERSION=|YARN_CACHE_FOLDER=|$)' > "$DEST/$nombre.env" )
  docker tag "$(docker inspect -f '{{.Image}}' "$p")" "$imagen:estable"
  echo "  $imagen:estable <- app $app"
  (cd "$DEST" && docker compose up -d "$nombre-respaldo")
  # De uno en uno: el arranque de una API Nest pesa; no se solapan dos.
  i=0; while [ $i -lt 30 ]; do
    s=$(docker inspect -f '{{.State.Health.Status}}' "$( [ "$nombre" = motor ] && echo atlas-motor-respaldo || echo atlas-backend-respaldo )")
    [ "$s" = healthy ] && break; i=$((i+1)); sleep 5
  done
  echo "  $nombre-respaldo: $s"
done
