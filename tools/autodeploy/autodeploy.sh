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
#   tools/autodeploy/autodeploy.sh salud           # comprueba los seis puertos y levanta lo caído
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
#
# Los fronts son los que ve el tester: el túnel apunta a SU puerto. Los backends no se tunelizan
# nunca —cada front hace de proxy de su API desde el servidor de Next—, pero si un backend no
# escucha, el tester ve la interfaz y cada llamada falla. Por eso están todos aquí.
SERVICIOS=(
  "atlas:AtlasBackend:3005:APP_PORT:/api/v1/health/liveness:"
  "erp:AtlasERPBackend:3020:PORT:/api/v1/health:"
  "decision:AtlasDecisionEngineBackend:3100:PORT:/health:runtime"
  "front-admin:AtlasAdminPortal:5273:PORT:/:"
  "front-decision:AtlasDecisionEngineFrontend:5173:PORT:/login:"
  "front-erp:AtlasERPFrontend:3010:PORT:/:"
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

  # `.env` y `.env.local` NO están versionados —son de esta máquina— así que el worktree sale sin
  # ellos. Para un backend da igual (lee el entorno al arrancar), pero un front de Next incrusta sus
  # `NEXT_PUBLIC_*` en el paquete del navegador AL CONSTRUIR: sin copiarlos, el portal se construiría
  # contra los valores por defecto y el tester acabaría llamando a un origen que no es el suyo.
  local archivo
  for archivo in .env .env.local .env.production.local; do
    [ -f "$RAIZ/$repo/$archivo" ] && cp "$RAIZ/$repo/$archivo" "$trabajo/$archivo"
  done
  # Y los recursos pesados que tampoco se versionan: los intérpretes del cuaderno de datos
  # (public/pyodide, public/webr) se bajan con `yarn setup:interpretes` y no caben en git. Si están en
  # la máquina, viajan a la imagen; si no, el front se construye sin ellos.
  if [ -d "$RAIZ/$repo/public" ]; then
    mkdir -p "$trabajo/public" && cp -r "$RAIZ/$repo/public/." "$trabajo/public/" 2>/dev/null
  fi

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
  # `HEALTHCHECK_PORT` se pasa aunque la imagen no lo mire, porque cuando sí lo mira evita un fallo
  # sutil: el `.env` del motor de decisiones lleva `WORKER_HEALTH_PORT=3001`, que en su sonda tiene
  # prioridad sobre `PORT`. El contenedor de la API acababa sondeando un puerto vacío y Docker lo
  # marcaba `unhealthy` mientras servía de maravilla — un aviso falso, de los que enseñan a ignorar
  # los avisos.
  #
  # `--env-file` sólo si lo hay: los fronts no tienen `.env` (su configuración ya viajó incrustada
  # al construir), y pasar un archivo inexistente aborta el arranque.
  local entorno=()
  [ -f "$RAIZ/$repo/.env" ] && entorno=(--env-file "$RAIZ/$repo/.env")
  docker run -d --name "$nombre" \
    --network host \
    "${entorno[@]}" \
    -e "$var=$puerto" \
    -e "HEALTHCHECK_PORT=$puerto" \
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

# ── Vigilancia de salud ───────────────────────────────────────────────────────────────────────────
#
# Desplegar por commits no basta. `una_vez` compara SHAs y, si el desplegado coincide con la punta
# de la rama, no hace nada más — pero un servicio puede estar en el commit correcto y aun así no
# servir: se le cayó la base, se quedó sin memoria, el anfitrión volvió de un apagón a medias. El
# 21-ago-2026 el backend del ERP pasó la mañana en bucle de reinicio, con el puerto 3020 muerto,
# porque para el desplegador ya estaba al día y no había nada que desplegar.
#
# Lo que se vigila es el PUERTO, que es lo que el túnel tiene delante. Y se vigilan los seis, no
# sólo los tres que el tester abre: los fronts hacen de proxy de su API desde el servidor de Next,
# así que un backend caído deja la interfaz en pie con todas las llamadas fallando. Para el tester
# ese enlace está igual de roto, sólo que de una forma que parece un bug del producto.
FALLOS_PARA_ACTUAR="${AUTODEPLOY_FALLOS_PARA_ACTUAR:-3}"

sondear() { # puerto ruta -> 0 si responde 200
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 "http://127.0.0.1:$1$2" 2>/dev/null)" = "200" ]
}

# Recuperar NO es desplegar: se levanta la última imagen que ya pasó por el canario, no la punta de
# la rama. Si dev trae un fallo, redesplegarlo aquí convertiría una caída en dos.
resucitar() { # slug repo puerto var salud nombre
  local slug="$1" repo="$2" puerto="$3" var="$4" salud="$5" nombre="$6" imagen

  if docker inspect "$nombre" >/dev/null 2>&1; then
    log "[$slug] no responde en $puerto — reiniciando el contenedor"
    docker restart "$nombre" >/dev/null 2>&1
    if esperar_salud "$puerto" "$salud" "$ESPERA_SALUD"; then
      log "[$slug] ✔ recuperado con un reinicio — el túnel sigue apuntando a $puerto"
      anotar "$slug" "$(sha_desplegado "$slug")" "recuperado" "reinicio del contenedor"
      return 0
    fi
  fi

  imagen="$(cat "$ESTADO/$slug.imagen" 2>/dev/null)"
  if [ -n "$imagen" ] && docker image inspect "$imagen" >/dev/null 2>&1; then
    log "[$slug] el reinicio no bastó — recreando desde $imagen"
    arrancar "$slug" "$repo" "$imagen" "$puerto" "$var" "$nombre"
    if esperar_salud "$puerto" "$salud" "$ESPERA_SALUD"; then
      log "[$slug] ✔ recuperado recreando el contenedor"
      anotar "$slug" "$(sha_desplegado "$slug")" "recuperado" "$imagen"
      return 0
    fi
  fi

  # Llegados aquí no es cosa del desplegador: casi siempre falta una dependencia de fuera (la base
  # del ERP en 5434, el disco, la red). Las últimas líneas van al log para no tener que ir a
  # buscarlas con `docker logs` cuando alguien avisa de que el enlace no va.
  log "[$slug] ✖ ATENCIÓN: sigue sin responder en $puerto. Últimas líneas del contenedor:"
  docker logs --tail 15 "$nombre" 2>&1 | sed 's/^/    /' | tee -a "$LOG" >&2
  anotar "$slug" "$(sha_desplegado "$slug")" "caido" "no responde en $puerto tras reiniciar"
  return 1
}

vigilar_salud() {
  local entrada slug repo puerto var salud etapa nombre fallos pid
  for entrada in "${SERVICIOS[@]}"; do
    IFS=: read -r slug repo puerto var salud etapa <<<"$entrada"
    nombre="$PREFIJO-$slug"

    # Nunca desplegado: no hay nada que vigilar ni imagen validada a la que volver.
    [ -n "$(sha_desplegado "$slug")" ] || continue

    if sondear "$puerto" "$salud"; then
      rm -f "$ESTADO/$slug.fallos"
      continue
    fi

    # Un puerto que no es nuestro no se toca, la misma regla que en `desplegar`: si ahí tienes un
    # `yarn start:dev`, el "fallo" es que estás desarrollando.
    if ! docker inspect "$nombre" >/dev/null 2>&1; then
      pid="$(duenio_del_puerto "$puerto")"
      if [ -n "$pid" ]; then
        log "[$slug] $puerto no responde pero lo tiene el pid $pid, que no es mío — no toco nada"
        continue
      fi
    fi

    fallos=$(( $(cat "$ESTADO/$slug.fallos" 2>/dev/null || echo 0) + 1 ))
    printf '%s' "$fallos" >"$ESTADO/$slug.fallos"

    # Margen deliberado: un arranque lento, un reinicio propio o una pasada que cae justo en el
    # cambio de contenedor no son una caída. Actuar al primer sondeo fallido produce reinicios en
    # cascada, que es peor que la avería que intentan arreglar.
    if [ "$fallos" -lt "$FALLOS_PARA_ACTUAR" ]; then
      log "[$slug] sin respuesta en $puerto ($fallos/$FALLOS_PARA_ACTUAR)"
      continue
    fi

    resucitar "$slug" "$repo" "$puerto" "$var" "$salud" "$nombre" && rm -f "$ESTADO/$slug.fallos"
  done
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

  # Después de desplegar, no antes: así un servicio que acaba de cambiar de contenedor ya ha tenido
  # su `esperar_salud` y no se cuenta como caído.
  vigilar_salud
}

vigilar() {
  log "vigilando $RAMA cada ${INTERVALO}s (${#SERVICIOS[@]} servicios)"
  while true; do una_vez; sleep "$INTERVALO"; done
}

estado() {
  printf '%-15s %-13s %-13s %-7s %-6s %s\n' SERVICIO DESPLEGADO EN-$RAMA PUERTO SALUD CONTENEDOR
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
    printf '%-15s %-13s %-13s %-7s %-6s %s\n' \
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

# Un solo despliegue a la vez. Dos pasadas solapadas construirían el mismo commit dos veces y podrían
# cruzarse en el cambio de contenedor.
#
# Sólo lo toman los comandos que DESPLIEGAN. `estado` e `historial` no tocan nada, y bloquearlos
# convertía la pregunta más frecuente —«¿cómo va aquello?»— en un «ya hay una pasada en marcha»
# justo cuando había algo interesante que mirar.
case "${1:-estado}" in
  una-vez|vigilar|desplegar|canario|parar|salud)
    exec 9>"$ESTADO/.lock"
    if ! flock -n 9; then echo "ya hay una pasada en marcha"; exit 0; fi ;;
esac

case "${1:-estado}" in
  estado)     estado ;;
  una-vez)    una_vez ;;
  salud)      vigilar_salud ;;
  vigilar)    vigilar ;;
  desplegar)  shift; desplegar "${1:?uso: $0 desplegar <slug>}" "${2:-}" ;;
  canario)    shift; entrada="$(buscar_servicio "${1:?uso: $0 canario <slug>}")" || exit 1
              IFS=: read -r s r p v h e <<<"$entrada"
              canario "$s" "$r" "$(sha_remoto "$r")" "$p" "$v" "$h" "$e" ;;
  historial)  historial ;;
  parar)      shift; parar "${1:-}" ;;
  *)          sed -n '2,50p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
