#!/bin/sh
# Guardián de TEST (Contabo). Lo lanza atlas-guardian-test.timer cada minuto, con flock.
#
# Para cada app de Atlas en Coolify (tabla APPS):
#   1. SANA el estado `created`: si un despliegue dejó un contenedor creado y sin arrancar
#      («removal of container … already in progress») y no hay despliegue en curso, lo arranca.
#      Es lo que tumbó el ERP 4 h 40 min y los tableros 36 h el 2026-10-01/02.
#   2. Si una app se quedó SIN contenedor de su servicio principal y su último despliegue falló,
#      lo AVISA (no redespliega solo: un build más sobre un host cargado es lo que lo provoca).
#   3. Anota cada cambio de estado en el journal (y en Telegram si hay token en .env).
#
# POSIX sh: los códigos se miran con $? justo después de cada orden, nunca tras una tubería.
set -u

ESTADO=/var/lib/atlas-guardian
mkdir -p "$ESTADO"
# Avisos por la librería común (Telegram y correo): /opt/atlas/lib/avisar.sh + avisar.env.
# Define `log` y `avisar`. Lee sin protegerlas las variables de correo, y aquí rige `set -u`.
AVISO_MAIL_TO=${AVISO_MAIL_TO:-}; AVISO_MAIL_SECRET=${AVISO_MAIL_SECRET:-}; AVISO_MAIL_URL=${AVISO_MAIL_URL:-}
TELEGRAM_TOKEN=${TELEGRAM_TOKEN:-}; TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID:-}
. /opt/atlas/lib/avisar.sh

# id_coolify  servicio_principal  nombre
APPS="
1 api atlas-backend
2 api motor-backend
3 api erp-backend
4 api tableros-backend
5 portal portal-admin
6 frontend erp-frontend
7 frontend motor-frontend
8 portal tableros-frontend
9 mock mock-proveedores
12 pdf-worker pdf-worker
14 web app-web-cliente
"

# Respaldos fuera de Coolify (/opt/atlas/respaldo-*), uno por fila:
# id servicio_principal imagen_estable carpeta servicio_respaldo contenedor_respaldo alias_prestado env
#   alias_prestado: alias de la principal que el respaldo toma mientras la principal no está en marcha
#                   (sólo APIs a las que otro contenedor llama por alias, no por Traefik); `-` si no.
#   env: fichero que se vuelve a volcar del contenedor principal al promover (`-` si usa el .env de Coolify).
RESPALDOS="
3 api atlas-erp-backend /opt/atlas/respaldo-erp erp-api-respaldo atlas-erp-api-respaldo erp -
6 frontend atlas-erp-frontend /opt/atlas/respaldo-erp erp-web-respaldo atlas-erp-web-respaldo - -
4 api atlas-dashboards-backend /opt/atlas/respaldo-tableros tableros-api-respaldo atlas-tableros-api-respaldo atlas-dashboards-backend api.env
8 portal atlas-dashboards-frontend /opt/atlas/respaldo-tableros tableros-web-respaldo atlas-tableros-web-respaldo - web.env
5 portal atlas-admin-portal /opt/atlas/respaldo-ligeros admin-web-respaldo atlas-admin-web-respaldo - admin-web.env
7 frontend atlas-engine-frontend /opt/atlas/respaldo-ligeros motor-web-respaldo atlas-motor-web-respaldo - motor-web.env
14 web atlas-consumer-web /opt/atlas/respaldo-ligeros consumer-web-respaldo atlas-consumer-web-respaldo - consumer-web.env
9 mock atlas-provider-mockup-server /opt/atlas/respaldo-ligeros mock-respaldo atlas-mock-respaldo external-providers-mock mock.env
1 api atlas-backend /opt/atlas/respaldo-apis atlas-backend-respaldo atlas-backend-respaldo atlas-backend atlas-backend.env
2 api atlas-decision /opt/atlas/respaldo-apis motor-respaldo atlas-motor-respaldo motor motor.env
"
ESTABLE_TRAS_S=600

sql() { docker exec coolify-db psql -U coolify -d coolify -Atc "$1" 2>/dev/null; }

# Contenedores de una app de Coolify. Coolify 4.4.2 (2026-10-07) dejó de poner `coolify.applicationId`
# y sólo pone `coolify.applicationUuid`: con el filtro viejo el guardián dejó de VER las apps
# desplegadas desde entonces, las dio por caídas y prestó `atlas-backend` y `motor` a sus respaldos sin
# devolverlos (el nombre resolvía a las dos instancias y la mitad de las peticiones iban a la imagen
# anterior, con otra configuración). Se buscan por las dos etiquetas: las de antes de la
# actualización sólo traen la vieja.
uuid_de() { sql "select uuid from applications where id=$1"; }
ps_app() { # id_app [opciones de docker ps…] -> ids, uno por línea
  a=$1; shift
  u=$(uuid_de "$a")
  {
    docker ps "$@" --filter "label=coolify.applicationId=$a"
    [ -n "$u" ] && docker ps "$@" --filter "label=coolify.applicationUuid=$u"
  } | awk '!visto[$0]++'
}

despliegue_en_curso() {
  n=$(sql "select count(*) from application_deployment_queues where application_id='$1' and status in ('in_progress','queued')")
  [ "${n:-0}" != "0" ]
}

cambio() { # clave estado texto
  antes=$(cat "$ESTADO/$1" 2>/dev/null || echo OK)
  [ "$antes" = "$2" ] && return 0
  echo "$2" > "$ESTADO/$1"
  avisar "$3"
}

echo "$APPS" | while read -r app svc nombre; do
  [ -z "${app:-}" ] && continue

  # 1. Contenedores que un despliegue dejó creados sin arrancar.
  for c in $(ps_app "$app" -aq --filter status=created); do
    cn=$(docker inspect -f '{{.Name}}' "$c" | sed 's#^/##')
    case "$cn" in migrate-*|seed-*|*minio-init*|*minio-bucket*|*db-roles*|*kafka-topics*) continue ;; esac
    creado=$(date -d "$(docker inspect -f '{{.Created}}' "$c")" +%s 2>/dev/null || echo 0)
    edad=$(( $(date +%s) - creado ))
    [ "$edad" -lt 120 ] && continue
    if despliegue_en_curso "$app"; then continue; fi
    docker start "$c" >/dev/null 2>&1
    if [ $? -eq 0 ]; then
      avisar "$nombre: el despliegue dejó $cn creado sin arrancar ($edad s). Arrancado por el guardián."
    else
      avisar "$nombre: $cn quedó creado sin arrancar y docker start FALLÓ. Mirar a mano."
    fi
  done

  # 2. ¿Está vivo el servicio principal?
  vivo=$(ps_app "$app" -q --filter "label=com.docker.compose.service=$svc" --filter status=running | head -n 1)
  if [ -n "$vivo" ]; then
    cambio "app-$app" OK "$nombre: RECUPERADO, el servicio principal vuelve a estar en marcha."
  elif despliegue_en_curso "$app"; then
    : # el hueco del redespliegue no es una caída
  else
    ultimo=$(sql "select id||' '||status from application_deployment_queues where application_id='$app' order by id desc limit 1")
    cambio "app-$app" CAIDO "$nombre: SIN contenedor en marcha y sin despliegue en curso (último: ${ultimo:-?}). Redesplegar desde Coolify."
  fi
done

# 4. Respaldos: alias prestado y promoción de `:estable`.
tiene_alias() { # contenedor alias
  docker inspect -f '{{json .NetworkSettings.Networks.coolify.Aliases}}' "$1" 2>/dev/null | grep -q "\"$2\""
}
reconectar() { # contenedor alias...
  r=$1; shift
  args=""; for a in "$@"; do args="$args --alias $a"; done
  docker network disconnect coolify "$r" >/dev/null 2>&1
  # shellcheck disable=SC2086
  docker network connect $args coolify "$r" >/dev/null 2>&1
}

echo "$RESPALDOS" | while read -r app svc imagen dir rsvc rcont prestado envf; do
  [ -z "${app:-}" ] && continue
  docker inspect "$rcont" >/dev/null 2>&1 || continue
  p=$(ps_app "$app" -q --filter "label=com.docker.compose.service=$svc" --filter status=running | head -n 1)
  salud=none
  [ -n "$p" ] && salud=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$p")
  sana=no
  [ -n "$p" ] && [ "$salud" != unhealthy ] && [ "$salud" != starting ] && sana=si

  # 4a. Alias prestado: la principal falta o está unhealthy → el respaldo responde por su nombre.
  if [ "$prestado" != - ]; then
    if [ "$sana" = no ] && [ -z "$p" -o "$salud" = unhealthy ] && ! tiene_alias "$rcont" "$prestado"; then
      reconectar "$rcont" "$rsvc" "$prestado"
      avisar "$rcont: la principal de la app $app no está sana ($salud); el respaldo atiende como '$prestado'."
    elif [ "$sana" = si ] && tiene_alias "$rcont" "$prestado"; then
      reconectar "$rcont" "$rsvc"
      avisar "$rcont: la principal de la app $app vuelve a estar sana; '$prestado' devuelto."
    fi
  fi

  # 4b. Promoción: la principal lleva ESTABLE_TRAS_S sana con otra imagen → esa pasa a `:estable`.
  [ "$sana" = si ] || continue
  if despliegue_en_curso "$app"; then continue; fi
  ip=$(docker inspect -f '{{.Image}}' "$p")
  ie=$(docker image inspect -f '{{.Id}}' "$imagen:estable" 2>/dev/null || echo -)
  [ "$ip" = "$ie" ] && continue
  inicio=$(date -d "$(docker inspect -f '{{.State.StartedAt}}' "$p")" +%s 2>/dev/null || echo 0)
  [ $(( $(date +%s) - inicio )) -lt "$ESTABLE_TRAS_S" ] && continue
  [ "$ie" != - ] && docker tag "$ie" "$imagen:estable-anterior"
  docker tag "$ip" "$imagen:estable"
  if [ "$envf" != - ]; then
    ( umask 077
      docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$p" |
        grep -vE '^(COOLIFY_|SERVICE_|SOURCE_COMMIT=|PATH=|HOSTNAME=|HOME=|NODE_VERSION=|YARN_VERSION=|YARN_CACHE_FOLDER=|$)' > "$dir/$envf.tmp" &&
        mv "$dir/$envf.tmp" "$dir/$envf" )
  fi
  docker compose -f "$dir/docker-compose.yml" up -d --no-deps --force-recreate "$rsvc" >/dev/null 2>&1
  if [ $? -eq 0 ]; then
    log "respaldo $rsvc al día con la imagen de la principal (app $app)"
  else
    avisar "$rsvc: no se pudo recrear con la imagen nueva (app $app). El respaldo sigue con la anterior."
  fi
done
log "pasada completa"
