#!/bin/sh
# Instala (o refresca) el respaldo de las apps ligeras en /opt/atlas/respaldo-ligeros/.
# Uso, en Contabo como root, desde esta carpeta copiada al servidor: sh instalar.sh
# Vuelca variables de cada principal, etiqueta `:estable` la imagen que corre HOY (sólo si está
# healthy) y levanta los respaldos. No toca Traefik (el failover se copia aparte).
set -eu
DEST=/opt/atlas/respaldo-ligeros
mkdir -p "$DEST"
cp docker-compose.yml "$DEST/"

# app servicio_principal imagen servicio_respaldo
TABLA="
5 portal atlas-admin-portal admin-web
7 frontend atlas-engine-frontend motor-web
14 web atlas-consumer-web consumer-web
9 mock atlas-provider-mockup-server mock
"
# compose valida el proyecto entero: cada env_file tiene que existir aunque su servicio no se levante.
(umask 077; for n in admin-web motor-web consumer-web mock; do [ -f "$DEST/$n.env" ] || : > "$DEST/$n.env"; done)
echo "$TABLA" | while read -r app svc imagen nombre; do
  [ -z "${app:-}" ] && continue
  p=$(docker ps -q --filter "label=coolify.applicationId=$app" --filter "label=com.docker.compose.service=$svc" --filter status=running | head -n 1)
  if [ -z "$p" ]; then echo "  app $app: sin principal en marcha, se salta"; continue; fi
  salud=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$p")
  if [ "$salud" != healthy ]; then echo "  app $app: principal $salud, se salta"; continue; fi
  ( umask 077
    docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$p" |
      grep -vE '^(COOLIFY_|SERVICE_|SOURCE_COMMIT=|PATH=|HOSTNAME=|HOME=|NODE_VERSION=|YARN_VERSION=|YARN_CACHE_FOLDER=|$)' > "$DEST/$nombre.env" )
  docker tag "$(docker inspect -f '{{.Image}}' "$p")" "$imagen:estable"
  echo "  $imagen:estable <- app $app"
  (cd "$DEST" && docker compose up -d "$nombre-respaldo")
done
docker ps --filter name=-respaldo --format '{{.Names}} {{.Status}}'
