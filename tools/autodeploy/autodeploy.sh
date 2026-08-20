#!/usr/bin/env bash
# Auto-despliegue local — lo que hace Render, pero en esta máquina.
#
# ## Qué imita
#
# Render vigila una rama y, ante cada commit nuevo, construye la imagen, arranca la versión nueva,
# la comprueba y sólo entonces retira la vieja; si la nueva no responde, el despliegue queda en
# fallo y **lo que estaba sirviendo sigue sirviendo**. Eso mismo hace esto, contra los repositorios
# de este workspace, sin cuenta ni proveedor: `git fetch` de `dev`, `docker build` del commit,
# canario, cambio y vuelta atrás si hace falta.
#
# ## La regla que manda sobre todas: el enlace del tester no cambia
#
# Esta máquina hace de servidor y los testers entran por los dev tunnels, cuyo hostname lo fija el
# nombre del túnel (ver tools/devtunnels/). De ahí tres restricciones que este script respeta:
#
#   1. **Nunca toca un proceso `devtunnel`.** Los túneles siguen arriba durante el despliegue; lo
#      único que ven es que su puerto deja de responder unos segundos.
#   2. **Cada servicio vuelve a su MISMO puerto.** El túnel apunta a un puerto, no a un contenedor:
#      mientras el puerto sea el de siempre, el enlace sigue valiendo.
#   3. **El canario se comprueba en un puerto aparte**, así que una imagen que no arranca se
#      descarta sin haber tocado el puerto bueno. El servicio en producción ni se entera.
#
# ## Qué NO hace, a propósito
#
# - **No toca tu copia de trabajo.** Construye desde un `git worktree` desprendido en el commit
#   exacto, en /tmp. Nunca hace `checkout` ni `pull` sobre el repositorio donde estás editando: un
#   desplegador que te mueve la rama bajo los pies es peor que no tener desplegador.
# - **No se apropia de un puerto que no es suyo.** Si en el puerto hay un `yarn start:dev` tuyo, se
#   niega y te dice el pid. Con AUTODEPLOY_TOMAR_PUERTO=1 lo relevas tú, a sabiendas.
# - **No declara `no-new-privileges`.** En esta máquina esa opción mata cualquier contenedor con
#   "operation not permitted" (fallo del anfitrión, no de los repos). Se omite deliberadamente.
#
# ## Uso
#
#   tools/autodeploy/autodeploy.sh estado          # qué está desplegado y qué commit espera
#   tools/autodeploy/autodeploy.sh una-vez         # una pasada: despliega lo que tenga commits nuevos
#   tools/autodeploy/autodeploy.sh vigilar         # bucle, para dejarlo corriendo como servidor
#   tools/autodeploy/autodeploy.sh desplegar atlas # fuerza el despliegue de un servicio
#   tools/autodeploy/autodeploy.sh canario atlas   # construye y comprueba SIN tocar el puerto bueno
#   tools/autodeploy/autodeploy.sh historial       # los despliegues, como el panel de Render
#   tools/autodeploy/autodeploy.sh parar [slug]    # baja contenedores (no toca los túneles)
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RAIZ="$(dirname "$REPO")"
ESTADO="$REPO/tools/autodeploy/estado"
mkdir -p "$ESTADO"

LOG="$ESTADO/autodeploy.log"
HISTORIAL="$ESTADO/historial.tsv"
RAMA="${AUTODEPLOY_RAMA:-dev}"
REMOTO="${AUTODEPLOY_REMOTO:-origin}"
INTERVALO="${AUTODEPLOY_INTERVALO:-60}"
ESPERA_SALUD="${AUTODEPLOY_ESPERA_SALUD:-90}"
PUERTO_CANARIO="${AUTODEPLOY_PUERTO_CANARIO:-39100}"
PREFIJO="atlas-auto"

# slug : repositorio : puerto : variable-de-puerto : ruta-de-salud : etapa-del-Dockerfile
#
# El puerto es el CONTRATO con el túnel y con los fronts (que hacen de proxy hacia estas APIs desde
# el servidor de Next). Cambiar uno aquí rompe el enlace del tester, que es justo lo que esto evita.
#
# La etapa hace falta cuando el Dockerfile es multi-etapa y la última NO es el servicio: la del motor
# de decisiones termina en `pdf-worker`, así que un `docker build` sin `--target` produce una imagen
# que no es la API y arranca otra cosa. Vacío = la etapa final.
SERVICIOS=(
  "atlas:AtlasBackend:3005:APP_PORT:/api/v1/health/liveness:"
  "erp:AtlasERPBackend:3020:PORT:/api/v1/health:"
  "decision:AtlasDecisionEngineBackend:3100:PORT:/health:runtime"
)

# A stderr, no a stdout. `construir` y `canario` DEVUELVEN la etiqueta de la imagen por stdout, así
# que una traza que saliera por ahí acabaría dentro de `$(...)` y el nombre de la imagen sería el log
# entero — que es exactamente como falló la primera versión: «docker: invalid reference format».
log() { printf '%s | %s\n' "$(date -Is)" "$*" | tee -a "$LOG" >&2; }

anotar() { # slug sha resultado detalle
  printf '%s\t%s\t%s\t%s\t%s\n' "$(date -Is)" "$1" "${2:0:12}" "$3" "${4:-}" >>"$HISTORIAL"
}

buscar_servicio() { # slug -> imprime la entrada, o falla
  local entrada
  for entrada in "${SERVICIOS[@]}"; do
    [ "${entrada%%:*}" = "$1" ] && { printf '%s\n' "$entrada"; return 0; }
  done
  return 1
}

sha_desplegado() { cat "$ESTADO/$1.sha" 2>/dev/null || echo ""; }

sha_remoto() { # repo -> sha de la punta de la rama en el remoto
  git -C "$RAIZ/$1" fetch -q "$REMOTO" "$RAMA" 2>/dev/null
  git -C "$RAIZ/$1" rev-parse "$REMOTO/$RAMA" 2>/dev/null
}

# ¿Responde el servicio? Es la única prueba que vale: que el proceso viva no significa que sirva.
esperar_salud() { # puerto ruta segundos
  local fin=$(( SECONDS + $3 )) codigo
  while [ "$SECONDS" -lt "$fin" ]; do
    codigo=$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 "http://127.0.0.1:$1$2" 2>/dev/null)
    [ "$codigo" = "200" ] && return 0
    sleep 3
  done
  return 1
}

# Quién ocupa el puerto, si no es nuestro contenedor. Un `yarn start:dev` tuyo tiene prioridad: el
# desplegador se aparta y lo dice, en vez de matarte la sesión de desarrollo por sorpresa.
duenio_del_puerto() { # puerto
  ss -ltnp "sport = :$1" 2>/dev/null | tail -n +2 | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2
}

construir() { # slug repo sha etapa -> imprime la etiqueta de la imagen
  local slug="$1" repo="$2" sha="$3" etapa="${4:-}"
  local imagen="$PREFIJO/$slug:${sha:0:12}"
  local trabajo="/tmp/$PREFIJO-$slug-${sha:0:12}"

  # Copia desprendida en el commit exacto: ni tu rama ni tus cambios entran en la imagen.
  rm -rf "$trabajo"
  git -C "$RAIZ/$repo" worktree add -q --detach "$trabajo" "$sha" 2>>"$LOG" || {
    log "[$slug] no pude crear el worktree en $sha"; return 1; }

  local nodo="22.16.0"
  [ -f "$trabajo/.nvmrc" ] && nodo="$(tr -d ' \n' <"$trabajo/.nvmrc")"

  log "[$slug] construyendo $imagen${etapa:+ (etapa $etapa)}"
  docker build -q \
    ${etapa:+--target "$etapa"} \
    --build-arg "NODE_VERSION=$nodo" \
    --build-arg "APP_COMMIT_SHA=$sha" \
    --build-arg "APP_BUILT_AT=$(date -Is)" \
    -t "$imagen" "$trabajo" >>"$LOG" 2>&1
  local codigo=$?

  git -C "$RAIZ/$repo" worktree remove --force "$trabajo" >/dev/null 2>&1
  git -C "$RAIZ/$repo" worktree prune >/dev/null 2>&1

  [ $codigo -eq 0 ] || { log "[$slug] la construcción falló — mira $LOG"; return 1; }
  printf '%s\n' "$imagen"
}

arrancar() { # slug repo imagen puerto varPuerto nombre
  local slug="$1" repo="$2" imagen="$3" puerto="$4" var="$5" nombre="$6"
  docker rm -f "$nombre" >/dev/null 2>&1
  # `--network host`: esta máquina ES el servidor y los .env ya apuntan a localhost (postgres 5432,
  # redis 6381, ...). Con red puente habría que reescribir cada .env a host.docker.internal para no
  # ganar nada. Sin `no-new-privileges`: en este anfitrión esa opción mata el contenedor al arrancar.
  docker run -d --name "$nombre" \
    --network host \
    --env-file "$RAIZ/$repo/.env" \
    -e "$var=$puerto" \
    --restart unless-stopped \
    --log-driver json-file --log-opt max-size=20m --log-opt max-file=5 \
    "$imagen" >>"$LOG" 2>&1
}

# Construye y comprueba en un puerto aparte. Es la fase que hace que una imagen rota NUNCA llegue a
# tocar el puerto que sirve a los testers.
canario() { # slug repo sha puerto varPuerto salud etapa -> imprime la imagen validada
  local slug="$1" repo="$2" sha="$3" var="$5" salud="$6" etapa="${7:-}"
  local imagen nombre="$PREFIJO-$slug-canario"

  imagen="$(construir "$slug" "$repo" "$sha" "$etapa")" || return 1

  log "[$slug] canario en $PUERTO_CANARIO"
  arrancar "$slug" "$repo" "$imagen" "$PUERTO_CANARIO" "$var" "$nombre" || {
    log "[$slug] el canario no arrancó"; docker rm -f "$nombre" >/dev/null 2>&1; return 1; }

  if ! esperar_salud "$PUERTO_CANARIO" "$salud" "$ESPERA_SALUD"; then
    log "[$slug] el canario no respondió $salud en ${ESPERA_SALUD}s — últimas líneas:"
    docker logs --tail 25 "$nombre" 2>&1 | tee -a "$LOG"
    docker rm -f "$nombre" >/dev/null 2>&1
    return 1
  fi

  docker rm -f "$nombre" >/dev/null 2>&1
  log "[$slug] canario sano"
  printf '%s\n' "$imagen"
}

desplegar() { # slug [sha]
  local entrada slug repo puerto var salud etapa sha imagen nombre anterior
  entrada="$(buscar_servicio "$1")" || { echo "servicio desconocido: $1"; return 1; }
  IFS=: read -r slug repo puerto var salud etapa <<<"$entrada"
  sha="${2:-$(sha_remoto "$repo")}"
  [ -n "$sha" ] || { log "[$slug] no pude resolver $REMOTO/$RAMA"; return 1; }
  nombre="$PREFIJO-$slug"

  imagen="$(canario "$slug" "$repo" "$sha" "$puerto" "$var" "$salud" "$etapa")" || {
    anotar "$slug" "$sha" "fallo" "canario"; return 1; }

  local pid; pid="$(duenio_del_puerto "$puerto")"
  if [ -n "$pid" ] && ! docker inspect "$nombre" >/dev/null 2>&1; then
    if [ "${AUTODEPLOY_TOMAR_PUERTO:-0}" != "1" ]; then
      log "[$slug] el puerto $puerto lo tiene el pid $pid ($(ps -p "$pid" -o comm= 2>/dev/null)), que no es mío."
      log "[$slug] la imagen $imagen quedó construida y comprobada. Para relevarlo: AUTODEPLOY_TOMAR_PUERTO=1 $0 desplegar $slug"
      anotar "$slug" "$sha" "detenido" "puerto ocupado por pid $pid"
      return 1
    fi
    log "[$slug] relevando al pid $pid en el puerto $puerto (AUTODEPLOY_TOMAR_PUERTO=1)"
    kill "$pid" 2>/dev/null; sleep 3
  fi

  anterior="$(docker inspect -f '{{.Config.Image}}' "$nombre" 2>/dev/null)"

  log "[$slug] cambiando al commit ${sha:0:12} en el puerto $puerto"
  arrancar "$slug" "$repo" "$imagen" "$puerto" "$var" "$nombre"

  if esperar_salud "$puerto" "$salud" "$ESPERA_SALUD"; then
    printf '%s' "$sha" >"$ESTADO/$slug.sha"
    printf '%s' "$imagen" >"$ESTADO/$slug.imagen"
    log "[$slug] ✔ en línea con ${sha:0:12} — el túnel sigue apuntando a $puerto"
    anotar "$slug" "$sha" "vivo" "$imagen"
    return 0
  fi

  # Vuelta atrás: lo que estaba sirviendo vuelve a servir. Es la mitad del valor de todo esto.
  log "[$slug] ✖ no respondió tras el cambio"
  if [ -n "$anterior" ]; then
    log "[$slug] volviendo a $anterior"
    arrancar "$slug" "$repo" "$anterior" "$puerto" "$var" "$nombre"
    esperar_salud "$puerto" "$salud" "$ESPERA_SALUD" \
      && log "[$slug] restaurada la versión anterior" \
      || log "[$slug] ATENCIÓN: ni la anterior responde — el servicio está caído"
    anotar "$slug" "$sha" "revertido" "$anterior"
  else
    docker rm -f "$nombre" >/dev/null 2>&1
    anotar "$slug" "$sha" "fallo" "sin versión anterior a la que volver"
  fi
  return 1
}

una_vez() {
  local entrada slug repo puerto var salud etapa remoto local_sha
  for entrada in "${SERVICIOS[@]}"; do
    IFS=: read -r slug repo puerto var salud etapa <<<"$entrada"
    remoto="$(sha_remoto "$repo")"
    local_sha="$(sha_desplegado "$slug")"
    if [ -z "$remoto" ]; then log "[$slug] sin $REMOTO/$RAMA"; continue; fi
    if [ "$remoto" = "$local_sha" ]; then continue; fi
    log "[$slug] commit nuevo en $RAMA: ${local_sha:0:12}..${remoto:0:12}"
    desplegar "$slug" "$remoto"
  done
}

vigilar() {
  log "vigilando $RAMA cada ${INTERVALO}s (${#SERVICIOS[@]} servicios)"
  while true; do una_vez; sleep "$INTERVALO"; done
}

estado() {
  printf '%-10s %-12s %-12s %-9s %-7s %s\n' SERVICIO DESPLEGADO EN-$RAMA PUERTO SALUD CONTENEDOR
  local entrada slug repo puerto var salud etapa remoto local_sha codigo cont
  for entrada in "${SERVICIOS[@]}"; do
    IFS=: read -r slug repo puerto var salud etapa <<<"$entrada"
    remoto="$(git -C "$RAIZ/$repo" rev-parse "$REMOTO/$RAMA" 2>/dev/null)"
    local_sha="$(sha_desplegado "$slug")"
    codigo=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$puerto$salud" 2>/dev/null)
    # `docker inspect` de un contenedor que no existe escupe una línea vacía ANTES de fallar, y sin
    # recortarla la tabla se parte en dos renglones.
    cont="$(docker inspect -f '{{.State.Status}}' "$PREFIJO-$slug" 2>/dev/null | head -1)"
    [ -n "$cont" ] || cont='—'
    printf '%-10s %-12s %-12s %-9s %-7s %s\n' \
      "$slug" "${local_sha:0:12}" "${remoto:0:12}" "$puerto" "${codigo:-—}" "$cont"
  done
  echo
  echo "Los túneles no los toca este script. Enlaces: tools/devtunnels/devtunnels.sh urls"
}

historial() { [ -f "$HISTORIAL" ] && column -t -s$'\t' "$HISTORIAL" | tail -30 || echo "sin despliegues todavía"; }

parar() {
  local entrada slug
  if [ -n "${1:-}" ]; then docker rm -f "$PREFIJO-$1" >/dev/null 2>&1 && log "[$1] contenedor parado"; return; fi
  for entrada in "${SERVICIOS[@]}"; do
    slug="${entrada%%:*}"
    docker rm -f "$PREFIJO-$slug" >/dev/null 2>&1 && log "[$slug] contenedor parado"
  done
  log "los túneles siguen arriba: esto no los toca"
}

# Un solo despliegue a la vez. Dos pasadas solapadas construirían el mismo commit dos veces y
# podrían cruzarse en el cambio de contenedor.
exec 9>"$ESTADO/.lock"
if ! flock -n 9; then echo "ya hay una pasada en marcha"; exit 0; fi

case "${1:-estado}" in
  estado)     estado ;;
  una-vez)    una_vez ;;
  vigilar)    vigilar ;;
  desplegar)  shift; desplegar "${1:?uso: $0 desplegar <slug>}" "${2:-}" ;;
  canario)    shift; entrada="$(buscar_servicio "${1:?uso: $0 canario <slug>}")" || exit 1
              IFS=: read -r s r p v h e <<<"$entrada"
              canario "$s" "$r" "$(sha_remoto "$r")" "$p" "$v" "$h" "$e" ;;
  historial)  historial ;;
  parar)      shift; parar "${1:-}" ;;
  *)          sed -n '2,50p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
