#!/usr/bin/env bash
# Dev tunnels de los fronts de ATLAS — los mismos que genera VS Code.
#
# ## Qué es esto
#
# VS Code, cuando reenvía un puerto y lo hace público, usa el servicio *dev
# tunnels* de Microsoft a través de la CLI `devtunnel`. Esto hace lo mismo sin
# depender del editor: un túnel con nombre fijo por cada front, de modo que la
# URL que le pasas a los testers **no cambia** entre reinicios. Un túnel de
# nombre aleatorio (los quick tunnels de trycloudflare) sortea hostname nuevo
# cada vez que arranca, y obliga a reenviar el enlace en cada despliegue.
#
# ## Por qué basta con tunelizar el front
#
# Los tres fronts hacen de proxy de su propia API: `next.config.ts` reescribe
# `/api/v1/*` hacia el backend desde el **servidor** de Next, no desde el
# navegador. El tester habla sólo con el front; el salto al backend lo da esta
# máquina, donde el backend ya vive. Por eso no se expone ningún backend, no
# hay CORS y no hay cookies de terceros.
#
# ## Uso
#
#   tools/devtunnels/devtunnels.sh todo      # lo hace todo: backends, fronts, túneles y enlaces
#   tools/devtunnels/devtunnels.sh backends  # levanta las APIs (3005/3020/3100)
#   tools/devtunnels/devtunnels.sh fronts    # levanta los dev servers que falten
#   tools/devtunnels/devtunnels.sh crear     # una vez: crea los túneles (cerrados, exigen login)
#   tools/devtunnels/devtunnels.sh acceso org <org>  # da entrada a los testers de tu organización
#   tools/devtunnels/devtunnels.sh host      # levanta los túneles (en segundo plano)
#   tools/devtunnels/devtunnels.sh systemd   # los deja en systemd: vuelven solos tras un apagón
#   tools/devtunnels/devtunnels.sh urls      # los enlaces para los testers
#   tools/devtunnels/devtunnels.sh estado    # qué está vivo y qué no
#   tools/devtunnels/devtunnels.sh parar     # baja los túneles (no toca los fronts)
#
#   DEVTUNNELS_OMITIR=alovida tools/devtunnels/devtunnels.sh todo   # todo menos ese front
#
# Requiere un login previo, una sola vez:  devtunnel user login -d -g
set -uo pipefail

# El script vive dentro de AtlasBackend pero orquesta TODO el ecosistema: los tres backends y los
# tres fronts de ATLAS, más el front de ALOVIDA que corre en Docker. Por eso hay dos raíces — el
# repositorio que lo versiona y el workspace que contiene a los demás repositorios como hermanos.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RAIZ="$(dirname "$REPO")"
ESTADO="$REPO/tools/devtunnels/estado"
mkdir -p "$ESTADO"

DEVTUNNEL="${DEVTUNNEL_BIN:-$HOME/bin/devtunnel}"
LOG="$ESTADO/devtunnels.log"
URL_FILE="$ESTADO/URLS.txt"

# front:puerto — el id del túnel se deriva del slug, así que es estable.
# front:puerto:directorio — el id del túnel se deriva del slug, así que es estable.
# Un directorio "-" significa que el front NO se levanta desde aquí: corre en Docker, en otro
# workspace. Se tuneliza igual, pero `fronts` no intenta arrancarlo.
FRONTS=(
  "admin:5273:AtlasAdminPortal"
  "decision:5173:AtlasDecisionEngineFrontend"
  "erp:3010:AtlasERPFrontend"
  "alovida:4200:-"
)

# Fronts que esta sesión NO quiere levantar ni hostear, separados por comas:
#
#   DEVTUNNELS_OMITIR=alovida tools/devtunnels/devtunnels.sh todo
#
# Existe porque el front de ALOVIDA corre en Docker en otro workspace y hay jornadas en que
# se deja caído a propósito, para devolverle los ~7 GB de RAM de sus contenedores a los tres
# backends de ATLAS. Sin esto, cada `todo` volvía a hostear su túnel contra un puerto 4200
# que ya no escucha: el enlace existe, responde 502 y parece un fallo del despliegue.
#
# Sólo afecta a lo que ARRANCA (`fronts`, `crear`, `host`). `estado` y `parar` siguen viendo
# la lista entera a propósito: hay que poder ver y bajar un túnel que quedó vivo de antes.
OMITIR="${DEVTUNNELS_OMITIR:-}"

omitido() {
  case ",$OMITIR," in *",$1,"*) return 0 ;; *) return 1 ;; esac
}

log() { printf '%s | %s\n' "$(date -Is)" "$*" | tee -a "$LOG"; }

comprobar_cli() {
  [ -x "$DEVTUNNEL" ] || { echo "No encuentro la CLI en $DEVTUNNEL"; exit 1; }
  if ! "$DEVTUNNEL" user show 2>&1 | grep -qv 'Not logged in'; then
    echo "No hay sesión iniciada. Ejecuta una vez:  $DEVTUNNEL user login -d -g"
    exit 1
  fi
}

# --- fronts --------------------------------------------------------------
# Arranca los dev servers que falten. `AtlasAdminPortal` declara engines
# `>=20.11 <23` y `AtlasDecisionEngineFrontend` `>=20.9 <24`; el node por
# defecto de esta máquina es v24 y yarn se niega a arrancar. v22 satisface a
# los tres, así que se antepone en el PATH sólo para estos procesos — el
# `nvm alias default` del usuario queda intacto.
NODE22="$HOME/.nvm/versions/node/v22.23.2/bin"
YARN="${YARN_BIN:-$HOME/.nvm/versions/node/v24.19.0/bin/yarn}"

fronts() {
  for entry in "${FRONTS[@]}"; do
    IFS=: read -r slug puerto dir <<<"$entry"
    if omitido "$slug"; then
      log "[$slug] omitido por DEVTUNNELS_OMITIR"
      continue
    fi
    if [ "$dir" = "-" ]; then
      log "[$slug] corre fuera de este workspace (Docker); sólo se tuneliza"
      continue
    fi
    if ss -ltn "sport = :$puerto" 2>/dev/null | grep -q LISTEN; then
      log "[$slug] el front ya escucha en $puerto — no lo toco"
      continue
    fi
    ( cd "$RAIZ/$dir" && PATH="$NODE22:$PATH" nohup "$YARN" dev >"$ESTADO/front-$slug.log" 2>&1 & \
      log "[$slug] dev server arrancando en $puerto (pid $!)" )
  done
}

# --- backends ------------------------------------------------------------
# Los fronts sólo hacen de proxy: sin estos escuchando, el tester ve la interfaz
# pero cada llamada a /api/v1/* devuelve error. Van con el node por defecto
# (v24): AtlasBackend pide >=22 y los otros dos no declaran engines.
BACKENDS=(
  "atlas:3005:AtlasBackend"
  "erp:3020:AtlasERPBackend"
  "decision:3100:AtlasDecisionEngineBackend"
)

backends() {
  # El backend del ERP habla con su propio postgres, que no vive en el compose
  # de los otros dos y suele quedarse parado entre sesiones.
  docker start atlas-erp-postgres >/dev/null 2>&1 && log "[erp] postgres levantado"
  for entry in "${BACKENDS[@]}"; do
    IFS=: read -r slug puerto dir <<<"$entry"
    if ss -ltn "sport = :$puerto" 2>/dev/null | grep -q LISTEN; then
      log "[back-$slug] ya escucha en $puerto — no lo toco"
      continue
    fi
    ( cd "$RAIZ/$dir" && nohup "$YARN" start:dev >"$ESTADO/back-$slug.log" 2>&1 & \
      log "[back-$slug] arrancando en $puerto (pid $!)" )
  done
}

# --- crear ---------------------------------------------------------------
# Idempotente: si el túnel ya existe, se deja como está. Borrarlo y recrearlo
# cambiaría la URL, que es justo lo que este script existe para evitar.
crear() {
  comprobar_cli
  for entry in "${FRONTS[@]}"; do
    IFS=: read -r slug puerto _dir <<<"$entry"
    omitido "$slug" && continue
    local id="atlas-$slug"
    if "$DEVTUNNEL" show "$id" >/dev/null 2>&1; then
      log "[$slug] el túnel $id ya existe — intacto (su URL no cambia)"
    else
      # SIN `-a` a propósito: el túnel exige que quien entre inicie sesión. La autenticación de
      # acceso es parte de lo que se está probando en esta fase, así que un enlace abierto a
      # cualquiera no probaría lo que hay que probar. Para dar entrada a un tester hace falta
      # concederle acceso explícitamente — ver `acceso` más abajo.
      "$DEVTUNNEL" create "$id" --description "ATLAS $slug (front $puerto)" >>"$LOG" 2>&1 \
        && log "[$slug] túnel $id creado" \
        || { log "[$slug] ERROR al crear $id"; continue; }
    fi
    "$DEVTUNNEL" port create "$id" -p "$puerto" --protocol http >>"$LOG" 2>&1 \
      && log "[$slug] puerto $puerto publicado" \
      || log "[$slug] el puerto $puerto ya estaba publicado"
  done
  urls
}

# --- acceso ---------------------------------------------------------------
# Con los túneles cerrados, entrar exige cuenta Y permiso. Esto concede el permiso.
#
# `devtunnel access create` NO permite autorizar cuentas sueltas una por una: las únicas
# unidades que entiende son el tenant de Entra, una organización de GitHub y el acceso a un
# repositorio. Por eso la vía práctica aquí es la organización — los testers ya tienen cuenta
# de GitHub y pertenencia, y no hay altas que gestionar.
#
#   ./devtunnels.sh acceso org mantra-core-technologies   → miembros de la organización
#   ./devtunnels.sh acceso repo owner/repositorio          → quien tenga acceso a ese repo
#   ./devtunnels.sh acceso tenant                          → todo el tenant de Entra ID
#
# La caducidad por defecto es de 30 días: un enlace de pruebas que no caduca acaba siendo un
# enlace de producción que nadie recuerda haber abierto. Se ajusta con DEVTUNNEL_ACCESS_EXPIRY.
EXPIRACION="${DEVTUNNEL_ACCESS_EXPIRY:-30d}"

acceso() {
  comprobar_cli
  local modo="${2:-}" valor="${3:-}"
  local -a opciones
  case "$modo" in
    org)    [ -n "$valor" ] || { echo "uso: $0 acceso org <organizacion>"; return 1; }
            opciones=(--organization "$valor") ;;
    repo)   [ -n "$valor" ] || { echo "uso: $0 acceso repo <owner/repo>"; return 1; }
            opciones=(--repo "$valor") ;;
    tenant) opciones=(--tenant) ;;
    *)      echo "uso: $0 acceso {org <organizacion>|repo <owner/repo>|tenant}"; return 1 ;;
  esac
  for entry in "${FRONTS[@]}"; do
    IFS=: read -r slug _puerto _dir <<<"$entry"
    local id="atlas-$slug"
    if "$DEVTUNNEL" access create "$id" "${opciones[@]}" --expiration "$EXPIRACION" >>"$LOG" 2>&1; then
      log "[$slug] acceso concedido ($modo ${valor:-}) durante $EXPIRACION"
    else
      log "[$slug] ERROR concediendo acceso — revisa $LOG"
    fi
  done
}

# --- host ----------------------------------------------------------------
host() {
  comprobar_cli
  for entry in "${FRONTS[@]}"; do
    IFS=: read -r slug puerto _dir <<<"$entry"
    if omitido "$slug"; then
      log "[$slug] omitido por DEVTUNNELS_OMITIR — su túnel sigue existiendo, sin hostear"
      continue
    fi
    local id="atlas-$slug" pid_file="$ESTADO/$slug.pid"
    if [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file" 2>/dev/null)" 2>/dev/null; then
      log "[$slug] ya está hosteado (pid $(cat "$pid_file"))"
      continue
    fi
    nohup "$DEVTUNNEL" host "$id" >"$ESTADO/$slug.host.log" 2>&1 &
    echo $! >"$pid_file"
    log "[$slug] hosteando $id (pid $!) -> localhost:$puerto"
  done
  sleep 6
  urls
}

# --- systemd -------------------------------------------------------------
# Deja los túneles en manos de systemd y retira los procesos sueltos que hubiera.
#
# `host` servía para levantarlos a mano, pero lo que se levanta a mano se muere en el primer
# apagón y nadie se entera: el enlace deja de abrir y parece un despliegue roto. Una unidad por
# túnel, con `Restart=always` y linger, es lo único que hace verdad la promesa de que el enlace
# no cambia nunca.
#
# El túnel de ALOVIDA se queda fuera a propósito: lo hospeda su propio redespliegue
# (`mantra-core-health/tools/redeploy/redeploy.sh`), que lo comprueba en cada pasada. Ponerlo
# también aquí serían dos gestores hospedando el mismo túnel.
systemd() {
  comprobar_cli
  local unidades="$HOME/.config/systemd/user"
  mkdir -p "$unidades" "$ESTADO"
  ln -sf "$REPO/tools/devtunnels/systemd/atlas-devtunnel@.service" "$unidades/"
  systemctl --user daemon-reload
  for entry in "${FRONTS[@]}"; do
    IFS=: read -r slug _puerto dir <<<"$entry"
    [ "$dir" = "-" ] && continue          # el de ALOVIDA lo gobierna su redespliegue
    omitido "$slug" && continue
    local id="atlas-$slug" pid_file="$ESTADO/$slug.pid"
    # Primero el proceso suelto, si lo hay: dos hosts del mismo túnel es ruido innecesario.
    if [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file" 2>/dev/null)" 2>/dev/null; then
      kill "$(cat "$pid_file")" 2>/dev/null
      log "[$slug] proceso suelto retirado; a partir de ahora manda systemd"
    fi
    rm -f "$pid_file"
    systemctl --user enable --now "atlas-devtunnel@$id.service" >/dev/null 2>&1 \
      && log "[$slug] hospedado por systemd ($(systemctl --user is-active "atlas-devtunnel@$id.service"))" \
      || log "[$slug] ERROR al instalar la unidad"
  done
  # Sin linger, las unidades de usuario sólo viven mientras haya sesión iniciada.
  loginctl enable-linger "$USER" >/dev/null 2>&1 \
    && log "linger activo — los túneles suben con la máquina, sin que nadie entre" \
    || log "⚠ no se pudo activar linger; sólo subirán con sesión iniciada"
  sleep 6
  urls
}

# --- urls ----------------------------------------------------------------
urls() {
  : >"$URL_FILE"
  for entry in "${FRONTS[@]}"; do
    IFS=: read -r slug puerto _dir <<<"$entry"
    if omitido "$slug"; then
      printf '%-10s puerto %-6s (omitido — no se está hosteando)\n' "$slug" "$puerto" | tee -a "$URL_FILE"
      continue
    fi
    local id="atlas-$slug" url
    # Se pregunta al servicio en vez de raspar el log de `host`: ahí la URL aparece a veces en la
    # forma `host:puerto` y seguida de coma, que no es la que se pega en un navegador. La buena es
    # la de `<id>-<puerto>.<cluster>`, y `show` la da siempre igual.
    url="$("$DEVTUNNEL" show "$id" 2>/dev/null | grep -oE 'https://[a-z0-9-]+-[0-9]+\.[a-z0-9]+\.devtunnels\.ms' | head -1)"
    [ -n "$url" ] || url="$(grep -ohE 'https://[a-z0-9-]+-[0-9]+\.[a-z0-9]+\.devtunnels\.ms' "$ESTADO/$slug.host.log" 2>/dev/null | head -1)"
    printf '%-10s puerto %-6s %s\n' "$slug" "$puerto" "${url:-(sin URL todavía)}" | tee -a "$URL_FILE"
  done
}

# --- estado --------------------------------------------------------------
estado() {
  for entry in "${BACKENDS[@]}"; do
    IFS=: read -r slug puerto dir <<<"$entry"
    local back="caído"
    ss -ltn "sport = :$puerto" 2>/dev/null | grep -q LISTEN && back="arriba"
    printf '%-10s %-30s api:%s\n' "back-$slug" "$dir" "$back"
  done
  for entry in "${FRONTS[@]}"; do
    IFS=: read -r slug puerto dir <<<"$entry"
    local front="caído" tunel="caído" pid_file="$ESTADO/$slug.pid"
    [ "$dir" = "-" ] && dir="(Docker, otro workspace)"
    ss -ltn "sport = :$puerto" 2>/dev/null | grep -q LISTEN && front="arriba"
    # Un túnel puede estar hospedado de dos maneras y ninguna ve a la otra: por un proceso suelto
    # de `host`, que deja su pid aquí, o por su unidad de systemd, que no lo deja. Mirar sólo el
    # pid hacía que tras un reinicio —cuando systemd los levanta y nadie escribe pid— los tres
    # salieran «caído» con los enlaces funcionando: el peor informe posible, el que miente.
    if [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file" 2>/dev/null)" 2>/dev/null; then
      tunel="arriba (proceso suelto)"
    elif systemctl --user is-active --quiet "atlas-devtunnel@atlas-$slug.service" 2>/dev/null; then
      tunel="arriba (systemd)"
    fi
    printf '%-10s %-30s front:%-7s túnel:%s\n' "$slug" "$dir" "$front" "$tunel"
  done
}

# --- parar ---------------------------------------------------------------
# Baja sólo los procesos que hostean; los túneles siguen existiendo en el
# servicio, así que al volver a `host` la URL es la misma de antes.
parar() {
  for entry in "${FRONTS[@]}"; do
    IFS=: read -r slug _puerto _dir <<<"$entry"
    local pid_file="$ESTADO/$slug.pid" unidad="atlas-devtunnel@atlas-$slug.service"
    if [ -f "$pid_file" ]; then
      kill "$(cat "$pid_file" 2>/dev/null)" 2>/dev/null && log "[$slug] túnel detenido"
      rm -f "$pid_file"
    fi
    # Contra una unidad de systemd, matar el proceso no para nada: `Restart=always` lo devuelve a
    # los diez segundos. Hay que pararla a ella, y dejarla habilitada para que vuelva en el
    # siguiente arranque —parar no es desinstalar—.
    if systemctl --user is-active --quiet "$unidad" 2>/dev/null; then
      systemctl --user stop "$unidad" && log "[$slug] unidad detenida (sigue habilitada para el próximo arranque)"
    fi
  done
}

# Todo de una vez: comprueba la sesión, levanta lo que falte, crea los túneles y los hostea.
todo() {
  comprobar_cli
  backends
  fronts
  crear
  host
}

case "${1:-estado}" in
  todo)   todo ;;
  fronts) fronts ;;
  backends) backends ;;
  crear)  crear ;;
  acceso) acceso "$@" ;;
  host)   host ;;
  systemd) systemd ;;
  urls)   urls ;;
  estado) estado ;;
  parar)  parar ;;
  *) echo "uso: $0 {todo|fronts|backends|crear|acceso|host|systemd|urls|estado|parar}"; exit 1 ;;
esac
